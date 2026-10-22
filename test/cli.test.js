const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const cli = path.join(__dirname, '..', 'out', 'cli.js');

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(t) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-batch-commit-cli-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', 'user.name', 'Test User']);
	git(dir, ['config', 'user.email', 'test@example.com']);
	writeFileSync(path.join(dir, 'a.txt'), 'a1');
	writeFileSync(path.join(dir, 'b.txt'), 'b1');
	git(dir, ['add', '.']);
	git(dir, ['commit', '-q', '-m', 'initial']);
	return dir;
}

function makeBareRemote(t) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-batch-commit-cli-remote-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const bare = path.join(dir, 'remote.git');
	git(dir, ['init', '--bare', '-q', bare]);
	return { bare, url: pathToFileURL(bare).href };
}

function runCli(cwd, args = []) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
	});
}

test('commits every changed file separately and syncs the branch', async t => {
	const dir = makeRepo(t);
	const { bare, url } = makeBareRemote(t);
	git(dir, ['remote', 'add', 'origin', url]);
	git(dir, ['push', '-u', 'origin', 'main']);

	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	writeFileSync(path.join(dir, 'c.txt'), 'c1');

	const result = runCli(dir);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Found 3 changed files/);
	assert.equal((result.stdout.match(/^\[\d+\/\d+\] committed /gm) ?? []).length, 3);
	assert.match(result.stdout, /Done: 3 file\(s\) committed in 3 separate commit\(s\)\./);

	const commits = git(dir, ['log', '--format=%H', '-3']).trim().split(/\r?\n/);
	for (const commit of commits) {
		const files = git(dir, ['show', '--pretty=format:', '--name-only', commit])
			.split(/\r?\n/)
			.filter(Boolean);
		assert.equal(files.length, 1);
	}

	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');

	const localHead = git(dir, ['rev-parse', 'HEAD']).trim();
	const remoteHead = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], {
		encoding: 'utf8'
	}).trim();
	assert.equal(remoteHead, localHead);
});

test('supports --no-push without a configured remote', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');

	const result = runCli(dir, ['--no-push']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Sync skipped \(--no-push\)/);

	const count = git(dir, ['rev-list', '--count', 'HEAD']).trim();
	assert.equal(count, '3');
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('--dry-run prints generated messages without changing the repository', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');

	const before = git(dir, ['rev-parse', 'HEAD']).trim();
	const result = runCli(dir, ['--dry-run']);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Dry run: 1 file\(s\) would be committed separately/);
	assert.match(result.stdout, /^\s+[a-z]+(\([^)]+\))?: /m);
	assert.equal(git(dir, ['rev-parse', 'HEAD']).trim(), before);
	assert.match(git(dir, ['status', '--porcelain']), /^ M a\.txt/m);
});

test('reports a clean working tree', async t => {
	const dir = makeRepo(t);
	const result = runCli(dir, ['--no-push']);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Nothing to commit/);
});

test('rejects unknown options with a usage message', t => {
	const dir = makeRepo(t);
	const result = runCli(dir, ['--unknown']);

	assert.equal(result.status, 2);
	assert.match(result.stderr, /Unknown option: --unknown/);
	assert.match(result.stderr, /Usage: auto-batch-commit/);
});

test('prints help and version', t => {
	const dir = makeRepo(t);

	const help = runCli(dir, ['--help']);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /Usage: auto-batch-commit/);

	const version = runCli(dir, ['--version']);
	assert.equal(version.status, 0, version.stderr);
	assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});
