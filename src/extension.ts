import * as vscode from 'vscode';
import { type BatchQuickPickItem, collectBatchFiles } from './changes';
import { commitAll, commitPaths, GitCommandError, undoLastCommit } from './git';
import type { GitAPI, GitExtension, Repository } from './types';

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
	output = vscode.window.createOutputChannel('Auto Batch Commit');
	context.subscriptions.push(
		output,
		vscode.commands.registerCommand('autoBatchCommit.commitFiles', () => commitSelectedFiles()),
		vscode.commands.registerCommand('autoBatchCommit.commitAll', () => commitAllChanges())
	);
}

export function deactivate(): void {
	// Nothing to clean up; disposables are registered in the extension context.
}

async function commitSelectedFiles(): Promise<void> {
	const repo = await pickRepository();
	if (!repo) {
		return;
	}

	await refresh(repo);
	const files = collectBatchFiles(repo);
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Auto Batch Commit: there are no changes to commit.');
		return;
	}

	const items: BatchQuickPickItem[] = files.map(file => ({
		label: file.label,
		description: file.statuses.join(' · '),
		iconPath: new vscode.ThemeIcon(file.staged ? 'pass' : 'circle-outline'),
		picked: true,
		file
	}));

	const picked = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		ignoreFocusOut: true,
		matchOnDescription: true,
		placeHolder: `Select the files to commit (${files.length} changed)`
	});
	if (!picked || picked.length === 0) {
		return;
	}

	const message = await askCommitMessage(repo, picked.length);
	if (!message) {
		return;
	}

	const paths = picked.flatMap(item => item.file.repoPaths);
	const subject = firstLine(message);
	output.appendLine(`> commit ${picked.length} file(s): ${subject}`);

	try {
		await commitPaths(repo.rootUri.fsPath, paths, message);
	} catch (error) {
		reportError('Commit failed', error);
		return;
	}

	repo.inputBox.value = '';
	await refresh(repo);
	await afterCommit(repo, `Committed ${fileCount(picked.length)}: ${subject}`);
}

async function commitAllChanges(): Promise<void> {
	const repo = await pickRepository();
	if (!repo) {
		return;
	}

	await refresh(repo);
	const files = collectBatchFiles(repo);
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Auto Batch Commit: there are no changes to commit.');
		return;
	}

	const message = await askCommitMessage(repo, files.length);
	if (!message) {
		return;
	}

	const subject = firstLine(message);
	output.appendLine(`> commit all (${files.length} file(s)): ${subject}`);

	try {
		await commitAll(repo.rootUri.fsPath, message);
	} catch (error) {
		reportError('Commit failed', error);
		return;
	}

	repo.inputBox.value = '';
	await refresh(repo);
	await afterCommit(repo, `Committed ${fileCount(files.length)}: ${subject}`);
}

async function pickRepository(): Promise<Repository | undefined> {
	const git = await getGitApi();
	if (!git) {
		void vscode.window.showErrorMessage(
			'Auto Batch Commit: the built-in Git extension is not available. Enable it and try again.'
		);
		return undefined;
	}

	if (git.repositories.length === 0) {
		void vscode.window.showInformationMessage(
			'Auto Batch Commit: no Git repository found. Open a folder containing a Git repository first.'
		);
		return undefined;
	}

	if (git.repositories.length === 1) {
		return git.repositories[0];
	}

	const items = git.repositories.map(repository => ({
		label: vscode.workspace.asRelativePath(repository.rootUri, false),
		description: repository.state.HEAD?.name ? `on ${repository.state.HEAD.name}` : 'detached HEAD',
		repository
	}));
	const picked = await vscode.window.showQuickPick(items, {
		ignoreFocusOut: true,
		placeHolder: 'Select the repository to commit to'
	});
	return picked?.repository;
}

async function getGitApi(): Promise<GitAPI | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}

	const exports = extension.isActive ? extension.exports : await extension.activate();
	return exports.enabled ? exports.getAPI(1) : undefined;
}

async function askCommitMessage(repo: Repository, count: number): Promise<string | undefined> {
	const initialValue = repo.inputBox.value.trim() ? repo.inputBox.value : undefined;
	if (initialValue && /[\r\n]/.test(initialValue)) {
		return initialValue.trim();
	}

	const message = await vscode.window.showInputBox({
		title: `Batch Commit · ${fileCount(count)}`,
		prompt: initialValue ? 'Commit message (pre-filled from Source Control)' : 'Commit message',
		value: initialValue,
		placeHolder: 'Summarize these changes',
		ignoreFocusOut: true,
		validateInput: value => (value.trim() ? undefined : 'A commit message is required.')
	});
	return message?.trim();
}

async function afterCommit(repo: Repository, summary: string): Promise<void> {
	const pushAfterCommit = vscode.workspace
		.getConfiguration('autoBatchCommit')
		.get<boolean>('pushAfterCommit', false);

	if (pushAfterCommit) {
		await pushRepository(repo);
		return;
	}

	const action = await vscode.window.showInformationMessage(summary, 'Push', 'Undo Commit');
	if (action === 'Push') {
		await pushRepository(repo);
	} else if (action === 'Undo Commit') {
		await undoCommit(repo);
	}
}

async function pushRepository(repo: Repository): Promise<void> {
	output.appendLine('> push');
	try {
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Pushing changes…' },
			() => repo.push()
		);
		void vscode.window.showInformationMessage('Auto Batch Commit: changes pushed.');
	} catch (error) {
		reportError('Push failed', error);
	}
}

async function undoCommit(repo: Repository): Promise<void> {
	const confirmation = await vscode.window.showWarningMessage(
		'Undo the last commit? Its changes stay in Source Control. Only do this before pushing.',
		{ modal: true },
		'Undo Commit'
	);
	if (confirmation !== 'Undo Commit') {
		return;
	}

	try {
		await undoLastCommit(repo.rootUri.fsPath);
		await refresh(repo);
		void vscode.window.showInformationMessage('Auto Batch Commit: last commit undone; its changes are back in Source Control.');
	} catch (error) {
		reportError('Undo failed', error);
	}
}

async function refresh(repo: Repository): Promise<void> {
	try {
		await repo.status();
	} catch {
		// The status refresh is best-effort; git operations report the real errors.
	}
}

function reportError(title: string, error: unknown): void {
	output.appendLine(`[error] ${title}`);
	if (error instanceof GitCommandError) {
		const printableArgs = error.args.map((arg, index) => (error.args[index - 1] === '-m' ? '<message>' : arg));
		output.appendLine(`$ git ${printableArgs.join(' ')}`);
		if (error.stderr.trim()) {
			output.appendLine(error.stderr.trim());
		}
		if (error.stdout.trim()) {
			output.appendLine(error.stdout.trim());
		}
	} else if (error instanceof Error) {
		output.appendLine(error.message);
	} else {
		output.appendLine(String(error));
	}

	const detail = friendlyError(error);
	void vscode.window
		.showErrorMessage(`${title}: ${detail}`, 'Show Output')
		.then(action => {
			if (action === 'Show Output') {
				output.show(true);
			}
		});
}

function friendlyError(error: unknown): string {
	if (!(error instanceof GitCommandError)) {
		return error instanceof Error ? error.message : String(error);
	}

	const text = `${error.stderr}\n${error.stdout}`.toLowerCase();
	if (text.includes('nothing to commit') || text.includes('no changes added to commit')) {
		return 'there is nothing to commit. Refresh Source Control and try again.';
	}
	if (text.includes('please tell me who you are') || text.includes('author identity unknown')) {
		return 'Git author identity is missing. Set git user.name and user.email.';
	}
	if (text.includes('not a git repository')) {
		return 'this folder is not a Git repository.';
	}
	if (text.includes('pathspec') && text.includes('did not match')) {
		return 'a selected file no longer matches the repository. Refresh Source Control and try again.';
	}
	if (text.includes('no upstream') || text.includes('has no upstream branch')) {
		return 'the current branch has no upstream. Publish the branch first.';
	}
	if (text.includes('no remote') || text.includes('does not appear to be a git repository')) {
		return 'no remote is configured. Publish the repository to GitHub first.';
	}
	if (text.includes('authentication failed') || text.includes('could not read username')) {
		return 'GitHub authentication failed. Sign in to GitHub in VS Code and try again.';
	}

	return error.stderr.trim().split(/\r?\n/)[0] || error.message;
}

function firstLine(message: string): string {
	const [line] = message.split(/\r?\n/);
	return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function fileCount(count: number): string {
	return `${count} file${count === 1 ? '' : 's'}`;
}
