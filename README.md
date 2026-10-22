# Auto Batch Commit

A terminal command that turns every changed file into its own commit, with an
automatically generated message, and then syncs the branch with GitHub.

Instead of one large "batch" commit, each file gets a separate, independent
commit:

```text
src/cli.ts        -> feat(cli): add main
src/git.ts        -> feat(git): add syncRepository
README.md         -> docs: update README
```

After the last file is committed, the branch is pulled and pushed automatically
to complete the cycle.

## Requirements

- **You must already be signed in to GitHub.** This tool never asks for or
  stores credentials. It uses your existing Git credential helper, GitHub CLI
  login (`gh auth login`), or SSH key.
- Git installed and available on `PATH`.
- Node.js 18 or newer.
- A repository with a GitHub remote (`origin` or an upstream remote).

## Install

### From this folder (global command)

```powershell
npm install
npm install -g .
```

### From source (linked command)

```powershell
npm install
npm link
```

Either method makes `auto-batch-commit` available in any terminal. A short alias,
`abc`, is installed as well.

## Usage

Open a terminal in the repository you are working on, then run:

```powershell
auto-batch-commit
```

or:

```powershell
abc
```

That is the whole workflow. When you press Enter, the command:

1. Verifies that a GitHub remote is configured and reachable with your existing
   credentials. If you are not signed in, it stops before changing anything and
   tells you to sign in.
2. Lists every changed, added, deleted, and renamed file.
3. For each file, one at a time:
   - stages that file,
   - reads its diff,
   - generates a relevant commit message from the change,
   - commits it as its own independent commit.
4. Pulls the current branch with rebase and pushes it to GitHub.

No prompts and no manual staging are required.

### Example

```text
Auto Batch Commit
Repository: C:\work\my-project
Remote:     origin (https://github.com/me/my-project.git)

Found 3 changed files; each will become its own commit:
   1. modified  src/git.ts
   2. added     src/cli.ts
   3. deleted   src/legacy.ts

Checking access to origin...
Access confirmed.

[1/3] committed src/git.ts -> feat(git): add syncRepository
[2/3] committed src/cli.ts -> feat(cli): add main
[3/3] committed src/legacy.ts -> chore(legacy): remove legacy

Syncing origin...
Synced main with origin (pulled, then pushed).
Done: 3 file(s) committed in 3 separate commit(s).
```

## Options

| Option | Description |
| --- | --- |
| `-n`, `--dry-run` | Print the generated commits without changing the repository. |
| `--no-push` | Create the per-file commits locally and skip pulling/pushing. |
| `--no-pull` | Push without pulling first. |
| `-r`, `--remote <name>` | Use a specific remote instead of the upstream remote or `origin`. |
| `-h`, `--help` | Show usage. |
| `-V`, `--version` | Show the version. |

Examples:

```powershell
abc --dry-run
abc --no-push
auto-batch-commit --remote upstream
```

## How commit messages are generated

Messages are generated locally from each file's diff. No API key, model, or
network request is involved. The generator looks at:

- the file path and extension (source, tests, docs, CI, build files, styles),
- the kind of change (added, modified, deleted, renamed, copied),
- symbols added or removed by the diff (functions, classes, interfaces, types,
  variables, methods),
- whether the change is formatting-only,
- error-handling keywords that suggest a fix.

It then writes a Conventional Commit-style subject (for example
`feat(parser): add parseFile`) and a short body with the file, change type, line
counts, and notable symbols.

### Message examples

| Change | Generated message |
| --- | --- |
| New `src/parser.ts` with `parseFile()` | `feat(parser): add parseFile` |
| Modified `src/git.ts` adding `syncRepository()` | `feat(git): add syncRepository` |
| Deleted `src/legacy.ts` | `chore(legacy): remove legacy` |
| Renamed `src/old.ts` to `src/new.ts` | `refactor(new): rename old to new` |
| Updated `README.md` | `docs: update README` |
| Updated `package.json` | `build(deps): update package` |
| Added `try`/`catch` error handling | `fix(api): handle failure in api` |
| Whitespace-only source change | `style(x): format x` |

## How it works

For each file, the command resets the Git index to `HEAD`, stages only that
file's paths, and commits the staged index:

```text
git reset --quiet                  # index = HEAD, discards previous staging
git add -A -- <file paths>         # stage only this file
git commit -m <subject> -m <body>  # one file per commit
```

Resetting the index before every file is what guarantees independent commits.
Pre-existing staged changes are not lost from the working tree; they are simply
restaged file by file as the command walks through all changes. Partial line
staging is not preserved.

Renames are committed with both the old and new paths so Git records a rename.
Untracked files and deletions are staged with `git add -A`.

After all files are committed, syncing runs:

```text
git pull --rebase --autostash      # only when an upstream exists
git push <remote> <branch>
```

If the branch has no upstream yet, the command uses
`git push --set-upstream <remote> <branch>` instead.

The GitHub account is never handled by this tool. Access is verified with
`git ls-remote` using terminal prompts disabled; authentication comes from your
existing credential helper, `gh` login, or SSH key.

## Safety and behavior

- Every commit contains exactly one changed file (or the two paths of a rename).
- If one file fails to commit, the remaining files are still attempted, the
  failed file's change stays in your working tree, and syncing is skipped so you
  can fix the problem and run the command again.
- A clean working tree exits successfully without creating commits.
- Detached HEAD, missing remote, missing Git identity, and authentication
  failures produce a clear message instead of a partial sync.
- Commit hooks still run. If a hook rejects a file, that file is reported and
  syncing is skipped.

## Development

```powershell
npm install
npm run clean     # remove build output
npm run compile   # build the CLI into out/
npm run lint      # type-check only
npm test          # unit and temporary-repository integration tests
```

The tests exercise status parsing, message generation, per-file commits,
renames, deletions, untracked files, index reset behavior, remote checking, local
sync, and the CLI end to end.

## Limitations

- The message generator is heuristic, not an AI model. It is deterministic and
  offline; unusual changes fall back to a file-level message such as
  `refactor(git): update git`.
- Rename detection depends on Git's similarity detection. A heavily rewritten
  file may be committed as a deletion plus an addition.
- Binary changes are committed normally but get a file-level message because
  there is no text diff to read.
- Only Git repositories are supported. The remote does not have to be GitHub for
  `--no-push`, but syncing assumes a GitHub-compatible remote.
