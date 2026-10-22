import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type FileChange, parseStatus } from './changes';

export interface GitResult {
	stdout: string;
	stderr: string;
}

export interface GitOptions {
	readonly timeout?: number;
	readonly env?: NodeJS.ProcessEnv;
}

export class GitCommandError extends Error {
	constructor(
		readonly args: string[],
		readonly stdout: string,
		readonly stderr: string,
		readonly code: number | null,
		readonly killed = false
	) {
		super(stderr.trim() || `git ${args[0] ?? ''} failed with exit code ${code ?? 'unknown'}`);
		this.name = 'GitCommandError';
	}
}

export function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
	return new Promise((resolve, reject) => {
		execFile(
			'git',
			args,
			{
				cwd,
				windowsHide: true,
				encoding: 'utf8',
				maxBuffer: 32 * 1024 * 1024,
				timeout: options.timeout,
				env: {
					...process.env,
					GIT_LITERAL_PATHSPECS: '1',
					...options.env
				}
			},
			(error, stdout, stderr) => {
				if (error) {
					const code = typeof error.code === 'number' ? error.code : null;
					reject(new GitCommandError(args, stdout, stderr, code, Boolean(error.killed)));
					return;
				}
				resolve({ stdout, stderr });
			}
		);
	});
}

export async function findRepositoryRoot(cwd: string): Promise<string> {
	const { stdout } = await runGit(cwd, ['rev-parse', '--show-toplevel']);
	return stdout.trim();
}

export async function readChanges(root: string): Promise<FileChange[]> {
	const { stdout } = await runGit(root, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all'
	]);
	return parseStatus(stdout);
}

export async function getChangeDiff(root: string, change: FileChange): Promise<string> {
	if (change.kind === 'untracked') {
		return readNewFile(root, change.path);
	}

	const { stdout } = await runGit(root, [
		'diff',
		'--no-color',
		'--no-ext-diff',
		'--unified=0',
		'HEAD',
		'--',
		...change.paths
	]);
	return stdout;
}

async function readNewFile(root: string, relativePath: string): Promise<string> {
	try {
		const content = await readFile(path.resolve(root, relativePath));
		if (content.includes(0)) {
			return '';
		}
		return content
			.toString('utf8')
			.split(/\r?\n/)
			.map(line => `+${line}`)
			.join('\n');
	} catch {
		return '';
	}
}

export async function resetIndex(root: string): Promise<void> {
	if (await hasHead(root)) {
		await runGit(root, ['reset', '--quiet']);
	} else {
		await runGit(root, ['read-tree', '--empty']);
	}
}

async function hasHead(root: string): Promise<boolean> {
	try {
		await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
		return true;
	} catch {
		return false;
	}
}

export async function stagePaths(root: string, paths: string[]): Promise<void> {
	const uniquePaths = [...new Set(paths.filter(Boolean))];
	if (uniquePaths.length === 0) {
		throw new Error('No files to stage.');
	}
	await runGit(root, ['add', '-A', '--', ...uniquePaths]);
}

export async function commitPaths(root: string, subject: string, body?: string): Promise<void> {
	const args = ['commit', '-m', subject];
	if (body?.trim()) {
		args.push('-m', body.trim());
	}
	await runGit(root, args);
}

export async function currentBranch(root: string): Promise<string | undefined> {
	try {
		const { stdout } = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

export async function listRemotes(root: string): Promise<string[]> {
	const { stdout } = await runGit(root, ['remote']);
	return stdout
		.split(/\r?\n/)
		.map(remote => remote.trim())
		.filter(Boolean);
}

export async function getRemoteUrl(root: string, remote: string): Promise<string> {
	const { stdout } = await runGit(root, ['remote', 'get-url', remote]);
	return stdout.trim();
}

export async function getUpstream(root: string): Promise<string | undefined> {
	try {
		const { stdout } = await runGit(root, [
			'rev-parse',
			'--abbrev-ref',
			'--symbolic-full-name',
			'@{u}'
		]);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

export async function defaultRemote(root: string, preferred?: string): Promise<string> {
	const remotes = await listRemotes(root);

	if (preferred) {
		if (!remotes.includes(preferred)) {
			throw new Error(
				`The "${preferred}" remote is not configured. Available remotes: ${remotes.join(', ') || 'none'}.`
			);
		}
		return preferred;
	}

	const upstream = await getUpstream(root);
	if (upstream) {
		const remote = upstream.split('/')[0];
		if (remotes.includes(remote)) {
			return remote;
		}
	}

	if (remotes.includes('origin')) {
		return 'origin';
	}
	if (remotes.length > 0) {
		return remotes[0];
	}

	throw new Error(
		'No GitHub remote is configured. Add one with "git remote add origin <url>" or publish the repository first.'
	);
}

export async function assertRemoteAccess(root: string, remote: string): Promise<void> {
	try {
		await runGit(root, ['ls-remote', '--heads', remote], {
			timeout: 20_000,
			env: {
				GIT_TERMINAL_PROMPT: '0',
				GCM_INTERACTIVE: 'never'
			}
		});
	} catch (error) {
		if (!(error instanceof GitCommandError)) {
			throw error;
		}

		if (error.killed) {
			throw new Error(
				`Could not reach the "${remote}" remote before the timeout. Check your network connection.`
			);
		}

		const text = `${error.stdout}\n${error.stderr}`.toLowerCase();
		if (AUTH_FAILURE_PATTERNS.some(pattern => text.includes(pattern))) {
			throw new Error(
				'GitHub authentication is required. Sign in to GitHub first (for example with "gh auth login" or your Git credential manager), then run the command again.'
			);
		}

		throw new Error(
			`Could not access the "${remote}" remote: ${firstLine(error.stderr) || error.message}`
		);
	}
}

const AUTH_FAILURE_PATTERNS = [
	'authentication failed',
	'could not read username',
	'could not read password',
	'terminal prompts disabled',
	'invalid username or password',
	'permission denied',
	'access denied',
	'host key verification failed',
	'returned error: 403',
	'returned error: 401'
];

export interface SyncOptions {
	readonly pull?: boolean;
}

export interface SyncResult {
	readonly remote: string;
	readonly branch: string;
	readonly pulled: boolean;
}

export async function syncRepository(
	root: string,
	remote: string,
	options: SyncOptions = {}
): Promise<SyncResult> {
	const branch = await currentBranch(root);
	if (!branch) {
		throw new Error('Cannot sync while HEAD is detached. Check out a branch first.');
	}

	const upstream = await getUpstream(root);
	const shouldPull = options.pull !== false && upstream !== undefined;

	if (shouldPull) {
		await runGit(root, ['pull', '--rebase', '--autostash']);
	}

	if (upstream) {
		await runGit(root, ['push', remote, branch]);
	} else {
		await runGit(root, ['push', '--set-upstream', remote, branch]);
	}

	return { remote, branch, pulled: shouldPull };
}

export function isGithubUrl(url: string): boolean {
	return /github\.com[:/]/i.test(url);
}

function firstLine(value: string): string {
	return value.trim().split(/\r?\n/)[0] ?? '';
}
