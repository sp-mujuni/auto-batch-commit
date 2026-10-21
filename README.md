# Auto Batch Commit

A VS Code extension that commits several changed files together with one commit message. Pick the files from a checklist, type one message, and commit. No manual staging required.

## Features

- **Commit selected files** – multi-select modified, added, deleted, renamed, and untracked files, then commit exactly those files with one message.
- **Commit all changes** – one message for everything in the working tree.
- **Works from Source Control** – two extra buttons appear in the Source Control title bar, plus commands in the Command Palette.
- **Reuses the SCM message box** – if you already typed a message in VS Code's Source Control input, the command uses it (multi-line messages included).
- **Push with VS Code credentials** – optional push uses the built-in Git extension, so it works with the GitHub account you signed in with in VS Code. No tokens are stored by this extension.
- **Undo commit** – the success notification can soft-reset the last commit before you push.

## Quick start

1. **Reload VS Code after installing.** Open the Command Palette (`Ctrl+Shift+P`) and run **Developer: Reload Window**.
2. **Open a Git repository.** Use **File → Open Folder...**. If the folder is not a repository yet, open **Source Control** (`Ctrl+Shift+G`) and choose **Initialize Repository**. To put it on GitHub, choose **Publish to GitHub** and sign in with your account.
3. **Make some changes** and save the files.
4. **Open Source Control** (`Ctrl+Shift+G`) and click the **checklist icon** in the Source Control title bar. You can also run **Batch Commit: Commit Selected Files...** from the Command Palette.
5. **Choose the files.** Every changed file is ticked. Untick anything you want to leave out, then press `Enter`.
6. **Write the message.** Type it when prompted, or type it in the normal Source Control message box first and the extension will reuse it.
7. **Commit.** After the commit succeeds, click **Push** in the notification to send it to GitHub, or **Undo Commit** to move it back into Source Control.

To commit everything in one go, run **Batch Commit: Commit All Changes...** instead of selecting files.

### If the buttons do not appear

- Reload the window again (**Developer: Reload Window**).
- Check that the extension is enabled in the Extensions view (`Ctrl+Shift+X`, search for **Auto Batch Commit**).
- Make sure the opened folder is a Git repository; Source Control should list changes.
- If pushing asks for authentication, sign in to GitHub in VS Code. If the repository has no remote, run **Publish to GitHub** first.

## Install

### From a VSIX (recommended)

```powershell
npm install
npm run compile
npx --yes @vscode/vsce package
code --install-extension auto-batch-commit-0.1.0.vsix
```

Reload VS Code after installing.

### From source

Open this folder in VS Code, run `npm install`, then press `F5` to launch an Extension Development Host.

## Usage

1. Make changes in a Git repository.
2. Open **Source Control** and click the checklist icon in the title bar, or run **Batch Commit: Commit Selected Files...** from the Command Palette (`Ctrl+Shift+P`).
3. Untick any files you want to leave out. All files are ticked initially.
4. Press `Enter`, then type the commit message (or type it in the Source Control box first).
5. After committing, use **Push** in the notification to push, or **Undo Commit** to move the commit back into Source Control.

**Batch Commit: Commit All Changes...** skips the file picker and commits every change.

## How it works

The extension reads repository status from VS Code's built-in Git extension API, so the file list matches Source Control. It then runs:

```text
git add -A -- <selected paths>
git commit --only -m <message> -- <selected paths>
```

`git commit --only` guarantees that only the selected paths go into the commit. Unrelated staged files stay staged and are not included. Selected files are committed at their full current working-tree content; partial line staging is not preserved for those files.

Pushing calls the built-in Git extension's `push()`, which uses VS Code's GitHub authentication or your configured Git credential manager. If the repository has no remote yet, use VS Code's **Publish to GitHub** first. Commits are authored with your normal `git user.name` / `git user.email` settings.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `autoBatchCommit.pushAfterCommit` | `false` | Push automatically after every batch commit. When off, the success notification offers a **Push** action. |

## Development

```powershell
npm install
npm run lint   # type-check
npm test       # runs real Git integration tests in temporary repositories
```

The tests exercise selective commits, deleted/renamed/untracked files, preservation of other staged work, commit-all, undo, command registration, and path conversion.

## Limitations

- File selection happens in a Quick Pick, because the Source Control tree does not expose multi-select to extensions.
- Commit history in Source Control still shows one commit per batch, as expected.
- **Undo Commit** uses `git reset --soft HEAD~1`; do not use it after pushing.
