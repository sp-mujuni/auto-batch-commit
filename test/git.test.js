const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { commitAll, commitPaths, toRepoPath, undoLastCommit } = require('../out/git.js');

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(t) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-batch-commit-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	git(dir, ['init', '-q']);
	git(dir, ['config', 'user.name', 'Test User']);
	git(dir, ['config', 'user.email', 'test@example.com']);
	writeFileSync(path.join(dir, 'a.txt'), 'a1');
	writeFileSync(path.join(dir, 'b.txt'), 'b1');
	git(dir, ['add', '.']);
	git(dir, ['commit', '-q', '-m', 'initial']);
	return dir;
}

function committedFiles(cwd) {
	return git(cwd, ['show', '--pretty=format:', '--name-only', 'HEAD'])
		.split(/\r?\n/)
		.filter(Boolean)
		.sort();
}

test('commits only the selected files and leaves the rest alone', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	writeFileSync(path.join(dir, 'c.txt'), 'c1');

	await commitPaths(dir, ['a.txt', 'c.txt'], 'batch a and c');

	assert.deepEqual(committedFiles(dir), ['a.txt', 'c.txt']);
	assert.equal(git(dir, ['show', 'HEAD:a.txt']).trim(), 'a2');
	assert.match(git(dir, ['status', '--porcelain']), /^ M b\.txt/m);
	assert.doesNotMatch(git(dir, ['status', '--porcelain']), /c\.txt/);
});

test('commits a deletion when the deleted file is selected', async t => {
	const dir = makeRepo(t);
	rmSync(path.join(dir, 'b.txt'));

	await commitPaths(dir, ['b.txt'], 'remove b');

	assert.deepEqual(committedFiles(dir), ['b.txt']);
	assert.equal(git(dir, ['show', '--name-status', '--pretty=format:', 'HEAD']).trim(), 'D\tb.txt');
});

test('commits a rename when both the old and new paths are selected', async t => {
	const dir = makeRepo(t);
	git(dir, ['mv', 'a.txt', 'renamed.txt']);

	await commitPaths(dir, ['renamed.txt', 'a.txt'], 'rename a');

	assert.equal(
		git(dir, ['show', '--name-status', '--pretty=format:', 'HEAD']).trim(),
		'R100\ta.txt\trenamed.txt'
	);
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('keeps other staged work staged when committing selected files', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	git(dir, ['add', 'b.txt']);
	writeFileSync(path.join(dir, 'b.txt'), 'b3');

	await commitPaths(dir, ['a.txt'], 'only a');

	assert.deepEqual(committedFiles(dir), ['a.txt']);
	assert.match(git(dir, ['status', '--porcelain']), /^MM b\.txt/m);
	assert.equal(git(dir, ['show', ':b.txt']).trim(), 'b2');
});

test('commitAll commits modified and untracked files together', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	writeFileSync(path.join(dir, 'c.txt'), 'c1');

	await commitAll(dir, 'everything at once');

	assert.deepEqual(committedFiles(dir), ['a.txt', 'b.txt', 'c.txt']);
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('rejects an empty file selection', async t => {
	const dir = makeRepo(t);
	await assert.rejects(() => commitPaths(dir, [], 'nothing'), /No files selected/);
});

test('undoLastCommit keeps the changes staged', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	await commitPaths(dir, ['a.txt'], 'a change');

	await undoLastCommit(dir);

	assert.match(git(dir, ['status', '--porcelain']), /^M  a\.txt/m);
	assert.equal(git(dir, ['show', 'HEAD:a.txt']).trim(), 'a1');
});

test('toRepoPath converts absolute paths to repository-relative paths', () => {
	const root = path.resolve(path.sep === '\\' ? 'C:\\repo' : '/repo');
	assert.equal(toRepoPath(root, path.join(root, 'src', 'file.ts')), 'src/file.ts');
	assert.equal(toRepoPath(root, path.join(path.dirname(root), 'outside', 'file.ts')), undefined);
	assert.equal(toRepoPath(root, root), undefined);
});
