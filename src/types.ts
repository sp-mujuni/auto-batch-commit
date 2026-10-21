import type * as vscode from 'vscode';

export interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): GitAPI;
}

export interface GitAPI {
	readonly repositories: Repository[];
}

export interface Repository {
	readonly rootUri: vscode.Uri;
	readonly inputBox: { value: string };
	readonly state: RepositoryState;
	status(): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];
}

export interface Branch {
	readonly name?: string;
}

export interface Change {
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri?: vscode.Uri;
	readonly status: Status;
}

export enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}
