import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import * as path from 'node:path';

export interface GitResult {
	stdout: string;
	stderr: string;
}

export class GitCommandError extends Error {
	constructor(
		readonly args: string[],
		readonly stdout: string,
		readonly stderr: string,
		readonly code: number | null
	) {
		super(stderr.trim() || `git ${args[0] ?? ''} failed with exit code ${code ?? 'unknown'}`);
		this.name = 'GitCommandError';
	}
}

export function runGit(cwd: string, args: string[]): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		execFile(
			'git',
			args,
			{
				cwd,
				windowsHide: true,
				encoding: 'utf8',
				maxBuffer: 16 * 1024 * 1024,
				env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' }
			},
			(error, stdout, stderr) => {
				if (error) {
					const code = typeof error.code === 'number' ? error.code : null;
					reject(new GitCommandError(args, stdout, stderr, code));
					return;
				}
				resolve({ stdout, stderr });
			}
		);
	});
}

export function toRepoPath(root: string, file: string): string | undefined {
	const relative = path.relative(root, file);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative.split(path.sep).join('/');
}

export async function commitPaths(cwd: string, paths: string[], message: string): Promise<void> {
	const uniquePaths = [...new Set(paths.filter(Boolean))];
	if (uniquePaths.length === 0) {
		throw new Error('No files selected.');
	}

	// git commit --only handles tracked additions, modifications, deletions, and
	// staged renames. Untracked files must first be added so the pathspec matches.
	const { stdout } = await runGit(cwd, ['ls-files', '-z', '--', ...uniquePaths]);
	const tracked = new Set(stdout.split('\0').filter(Boolean));
	const untracked = uniquePaths.filter(file => !tracked.has(file) && existsInWorktree(cwd, file));

	if (untracked.length > 0) {
		await runGit(cwd, ['add', '--', ...untracked]);
	}

	await runGit(cwd, ['commit', '--only', '-m', message, '--', ...uniquePaths]);
}

function existsInWorktree(cwd: string, file: string): boolean {
	try {
		lstatSync(path.resolve(cwd, file));
		return true;
	} catch {
		return false;
	}
}

export async function commitAll(cwd: string, message: string): Promise<void> {
	await runGit(cwd, ['add', '-A']);
	await runGit(cwd, ['commit', '-m', message]);
}

export async function undoLastCommit(cwd: string): Promise<void> {
	await runGit(cwd, ['reset', '--soft', 'HEAD~1']);
}
