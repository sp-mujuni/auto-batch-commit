#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describeKind, displayPath, type FileChange } from './changes';
import {
	assertRemoteAccess,
	commitPaths,
	currentBranch,
	defaultRemote,
	findRepositoryRoot,
	getChangeDiff,
	getRemoteUrl,
	GitCommandError,
	isGithubUrl,
	readChanges,
	resetIndex,
	stagePaths,
	syncRepository
} from './git';
import { formatCommitMessage, generateCommitMessage } from './message';

interface CliOptions {
	readonly dryRun: boolean;
	readonly push: boolean;
	readonly pull: boolean;
	readonly remote?: string;
}

interface Failure {
	readonly change: FileChange;
	readonly error: unknown;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		writeError(`Error: ${friendlyError(error)}`);
		writeError('');
		writeError(usage());
		return 2;
	}

	if (parsed.help) {
		write(usage());
		return 0;
	}
	if (parsed.version) {
		write(version());
		return 0;
	}

	const options = parsed.options;

	try {
		const root = await findRepositoryRoot(process.cwd());
		const changes = await readChanges(root);

		if (changes.length === 0) {
			write('Nothing to commit. The working tree is clean.');
			return 0;
		}

		let remote: string | undefined;
		let remoteUrl: string | undefined;
		let remoteError: unknown;

		try {
			remote = await defaultRemote(root, options.remote);
			remoteUrl = await getRemoteUrl(root, remote);
		} catch (error) {
			remoteError = error;
		}

		if (options.remote && remoteError) {
			throw remoteError;
		}
		if (options.push && !options.dryRun && !remote) {
			throw remoteError instanceof Error
				? remoteError
				: new Error('No GitHub remote is configured.');
		}

		write('Auto Batch Commit');
		write(`Repository: ${root}`);
		if (remote) {
			write(`Remote:     ${remote} (${remoteUrl})`);
		}
		write('');

		write(
			`Found ${changes.length} changed file${changes.length === 1 ? '' : 's'}; each will become its own commit:`
		);
		changes.forEach((change, index) => {
			write(
				`  ${String(index + 1).padStart(2)}. ${describeKind(change.kind).padEnd(9)} ${displayPath(change)}`
			);
		});
		write('');

		if (options.push && !options.dryRun && remote) {
			const branch = await currentBranch(root);
			if (!branch) {
				throw new Error('Cannot sync while HEAD is detached. Check out a branch first.');
			}
			if (remoteUrl && !isGithubUrl(remoteUrl)) {
				write(`Warning: "${remoteUrl}" does not look like a GitHub remote. Continuing anyway.`);
				write('');
			}

			write(`Checking access to ${remote}...`);
			await assertRemoteAccess(root, remote);
			write('Access confirmed.');
			write('');
		}

		const failures: Failure[] = [];
		let committed = 0;

		for (let index = 0; index < changes.length; index += 1) {
			const change = changes[index];
			const prefix = `[${index + 1}/${changes.length}]`;

			try {
				let diff = '';
				try {
					diff = await getChangeDiff(root, change);
				} catch (error) {
					writeError(
						`${prefix} warning: could not read the diff for ${displayPath(change)}: ${friendlyError(error)}`
					);
				}

				const message = generateCommitMessage({
					path: change.path,
					oldPath: change.oldPath,
					kind: change.kind,
					diff
				});

				if (options.dryRun) {
					write(`${prefix} ${displayPath(change)}`);
					write(indent(formatCommitMessage(message)));
					write('');
					continue;
				}

				await resetIndex(root);
				await stagePaths(root, change.paths);
				await commitPaths(root, message.subject, message.body);
				committed += 1;
				write(`${prefix} committed ${displayPath(change)} -> ${message.subject}`);
			} catch (error) {
				failures.push({ change, error });
				writeError(`${prefix} failed ${displayPath(change)}: ${friendlyError(error)}`);
			}
		}

		if (options.dryRun) {
			write('');
			write(`Dry run: ${changes.length} file(s) would be committed separately. Nothing was changed.`);
			return 0;
		}

		write('');

		if (failures.length > 0) {
			writeError(
				`${committed} file(s) committed, ${failures.length} failed. Sync skipped; fix the errors above and run the command again.`
			);
			return 1;
		}

		if (!options.push) {
			write(
				`Committed ${committed} file(s) in ${committed} separate commit(s). Sync skipped (--no-push).`
			);
			return 0;
		}

		if (!remote) {
			throw new Error('No GitHub remote is configured.');
		}

		write(`Syncing ${remote}...`);
		const result = await syncRepository(root, remote, { pull: options.pull });
		write(
			`Synced ${result.branch} with ${result.remote}${result.pulled ? ' (pulled, then pushed)' : ''}.`
		);
		write(`Done: ${committed} file(s) committed in ${committed} separate commit(s).`);
		return 0;
	} catch (error) {
		writeError(`Error: ${friendlyError(error)}`);
		return 1;
	}
}

function parseArgs(
	argv: string[]
):
	| { readonly help: true; readonly version: false; readonly options: CliOptions }
	| { readonly help: false; readonly version: true; readonly options: CliOptions }
	| { readonly help: false; readonly version: false; readonly options: CliOptions } {
	let dryRun = false;
	let push = true;
	let pull = true;
	let remote: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		switch (arg) {
			case '-h':
			case '--help':
				return { help: true, version: false, options: { dryRun, push, pull, remote } };
			case '-V':
			case '--version':
				return { help: false, version: true, options: { dryRun, push, pull, remote } };
			case '-n':
			case '--dry-run':
				dryRun = true;
				break;
			case '--no-push':
				push = false;
				break;
			case '--no-pull':
				pull = false;
				break;
			case '-r':
			case '--remote': {
				const value = argv[index + 1];
				if (!value || value.startsWith('-')) {
					throw new Error(`${arg} requires a remote name.`);
				}
				remote = value;
				index += 1;
				break;
			}
			default:
				if (arg.startsWith('--remote=')) {
					const value = arg.slice('--remote='.length);
					if (!value) {
						throw new Error('--remote requires a remote name.');
					}
					remote = value;
					break;
				}
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	return { help: false, version: false, options: { dryRun, push, pull, remote } };
}

function usage(): string {
	return `Usage: auto-batch-commit [options]

Commit every changed file as its own commit with an automatically generated
message, then sync the current branch with GitHub.

You must already be signed in to GitHub. This command never asks for
credentials; it relies on your existing Git credential helper.

Options:
  -n, --dry-run         Show the commits that would be created without doing anything
      --no-push         Commit locally but skip pulling and pushing
      --no-pull         Push without pulling first
  -r, --remote <name>   Remote to use (default: the upstream remote, or origin)
  -h, --help            Show this help
  -V, --version         Show the version

Examples:
  auto-batch-commit
  abc --dry-run
  auto-batch-commit --no-push`;
}

function version(): string {
	try {
		const packagePath = path.join(__dirname, '..', 'package.json');
		const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
		return packageJson.version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

function friendlyError(error: unknown): string {
	if (error instanceof GitCommandError) {
		const text = `${error.stdout}\n${error.stderr}`.toLowerCase();
		if (text.includes('nothing to commit') || text.includes('no changes added to commit')) {
			return 'there is nothing to commit for this file.';
		}
		if (text.includes('please tell me who you are') || text.includes('author identity unknown')) {
			return 'Git author identity is missing. Set git user.name and user.email.';
		}
		if (text.includes('not a git repository')) {
			return 'this folder is not a Git repository.';
		}
		if (text.includes('pathspec') && text.includes('did not match')) {
			return 'a file changed while the command was running. Run the command again.';
		}
		if (text.includes('no upstream') || text.includes('has no upstream branch')) {
			return 'the current branch has no upstream. Publish the branch first.';
		}
		if (text.includes('no remote') || text.includes('does not appear to be a git repository')) {
			return 'no remote is configured. Publish the repository to GitHub first.';
		}
		if (text.includes('conflict') || text.includes('rebase in progress')) {
			return 'syncing stopped because the branch conflicts with the remote. Resolve the conflicts, then commit or push again.';
		}
		if (text.includes('non-fast-forward') || text.includes('[rejected]')) {
			return 'the remote rejected the push because it has changes you do not have. Pull the branch, then run the command again.';
		}
		return firstLine(error.stderr) || error.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function firstLine(value: string): string {
	return value.trim().split(/\r?\n/)[0] ?? '';
}

function indent(value: string): string {
	return value
		.split(/\r?\n/)
		.map(line => `    ${line}`)
		.join('\n');
}

function write(value: string): void {
	process.stdout.write(`${value}\n`);
}

function writeError(value: string): void {
	process.stderr.write(`${value}\n`);
}

if (require.main === module) {
	void main().then(code => {
		process.exitCode = code;
	});
}
