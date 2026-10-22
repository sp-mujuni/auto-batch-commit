export type ChangeKind =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'untracked';

export interface FileChange {
	readonly path: string;
	readonly oldPath?: string;
	readonly kind: ChangeKind;
	readonly indexStatus: string;
	readonly worktreeStatus: string;
	readonly paths: string[];
}

export function parseStatus(output: string): FileChange[] {
	const parts = output.split('\0');
	const changes: FileChange[] = [];

	for (let index = 0; index < parts.length; index += 1) {
		const entry = parts[index];
		if (!entry) {
			continue;
		}

		const indexStatus = entry[0] ?? ' ';
		const worktreeStatus = entry[1] ?? ' ';

		if (indexStatus === '!' && worktreeStatus === '!') {
			continue;
		}

		const path = entry.slice(3);
		if (!path) {
			continue;
		}

		let oldPath: string | undefined;
		if (isRenameOrCopy(indexStatus, worktreeStatus)) {
			oldPath = parts[index + 1];
			if (!oldPath) {
				continue;
			}
			index += 1;
		}

		changes.push({
			path,
			oldPath,
			kind: kindOf(indexStatus, worktreeStatus),
			indexStatus,
			worktreeStatus,
			paths: oldPath ? [oldPath, path] : [path]
		});
	}

	return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function isRenameOrCopy(indexStatus: string, worktreeStatus: string): boolean {
	return [indexStatus, worktreeStatus].some(status => status === 'R' || status === 'C');
}

function kindOf(indexStatus: string, worktreeStatus: string): ChangeKind {
	if (indexStatus === '?' && worktreeStatus === '?') {
		return 'untracked';
	}
	if (indexStatus === 'R' || worktreeStatus === 'R') {
		return 'renamed';
	}
	if (indexStatus === 'C' || worktreeStatus === 'C') {
		return 'copied';
	}
	if (indexStatus === 'A' || worktreeStatus === 'A') {
		return 'added';
	}
	if (indexStatus === 'D' || worktreeStatus === 'D') {
		return 'deleted';
	}
	return 'modified';
}

export function describeKind(kind: ChangeKind): string {
	switch (kind) {
		case 'added':
		case 'untracked':
			return 'added';
		case 'deleted':
			return 'deleted';
		case 'renamed':
			return 'renamed';
		case 'copied':
			return 'copied';
		default:
			return 'modified';
	}
}

export function displayPath(change: FileChange): string {
	return change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path;
}
