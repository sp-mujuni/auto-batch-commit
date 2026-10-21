import type * as vscode from 'vscode';
import { toRepoPath } from './git';
import { type Change, type Repository, Status } from './types';

export interface BatchFile {
	readonly key: string;
	readonly label: string;
	readonly repoPaths: string[];
	readonly statuses: string[];
	readonly staged: boolean;
}

interface Entry {
	change: Change;
	label: string;
	repoPaths: Set<string>;
	statuses: Set<string>;
	staged: boolean;
}

const STATUS_LABELS: Partial<Record<Status, string>> = {
	[Status.INDEX_MODIFIED]: 'Staged, modified',
	[Status.INDEX_ADDED]: 'Staged, added',
	[Status.INDEX_DELETED]: 'Staged, deleted',
	[Status.INDEX_RENAMED]: 'Staged, renamed',
	[Status.INDEX_COPIED]: 'Staged, copied',
	[Status.MODIFIED]: 'Modified',
	[Status.DELETED]: 'Deleted',
	[Status.UNTRACKED]: 'Untracked',
	[Status.IGNORED]: 'Ignored',
	[Status.INTENT_TO_ADD]: 'Intent to add',
	[Status.INTENT_TO_RENAME]: 'Intent to rename',
	[Status.TYPE_CHANGED]: 'Type changed',
	[Status.ADDED_BY_US]: 'Added by us',
	[Status.ADDED_BY_THEM]: 'Added by them',
	[Status.DELETED_BY_US]: 'Deleted by us',
	[Status.DELETED_BY_THEM]: 'Deleted by them',
	[Status.BOTH_ADDED]: 'Added by both',
	[Status.BOTH_DELETED]: 'Deleted by both',
	[Status.BOTH_MODIFIED]: 'Modified by both'
};

export function statusLabel(status: Status): string {
	return STATUS_LABELS[status] ?? 'Changed';
}

export function collectBatchFiles(repo: Repository): BatchFile[] {
	const root = repo.rootUri.fsPath;
	const entries = new Map<string, Entry>();

	const add = (change: Change, staged: boolean): void => {
		const relative = toRepoPath(root, change.uri.fsPath);
		if (!relative) {
			return;
		}

		const key = change.uri.fsPath;
		let entry = entries.get(key);
		if (!entry) {
			entry = {
				change,
				label: relative,
				repoPaths: new Set([relative]),
				statuses: new Set(),
				staged
			};
			entries.set(key, entry);
		}

		entry.staged ||= staged;
		entry.statuses.add(statusLabel(change.status));

		if (change.originalUri.scheme === 'file') {
			const original = toRepoPath(root, change.originalUri.fsPath);
			if (original) {
				entry.repoPaths.add(original);
			}
		}
	};

	for (const change of repo.state.indexChanges ?? []) {
		add(change, true);
	}
	for (const change of repo.state.workingTreeChanges ?? []) {
		add(change, false);
	}
	for (const change of repo.state.untrackedChanges ?? []) {
		add(change, false);
	}

	return [...entries.values()]
		.map(entry => ({
			key: entry.change.uri.fsPath,
			label: entry.label,
			repoPaths: [...entry.repoPaths],
			statuses: [...entry.statuses],
			staged: entry.staged
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export interface BatchQuickPickItem extends vscode.QuickPickItem {
	readonly file: BatchFile;
}
