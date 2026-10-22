const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
	assertRemoteAccess,
	commitPaths,
	currentBranch,
	defaultRemote,
	findRepositoryRoot,
	getChangeDiff,
	isGithubUrl,
	readChanges,
	resetIndex,
	stagePaths,
	syncRepository
} = require('../out/git.js');
const { generateCommitMessage } = require('../out/message.js');

function git(cwd, args) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' }
	});
}

function makeRepo(t) {
	const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-batch-commit-'));
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
	const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-batch-commit-remote-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const bare = path.join(dir, 'remote.git');
	git(dir, ['init', '--bare', '-q', bare]);
	return { bare, url: pathToFileURL(bare).href };
}

async function commitEveryChange(dir) {
	const changes = await readChanges(dir);
	for (const change of changes) {
		const diff = await getChangeDiff(dir, change);
		const message = generateCommitMessage({
			path: change.path,
			oldPath: change.oldPath,
			kind: change.kind,
			diff
		});
		await resetIndex(dir);
		await stagePaths(dir, change.paths);
		await commitPaths(dir, message.subject, message.body);
	}
	return changes;
}

function committedFiles(cwd, revision = 'HEAD') {
	return git(cwd, ['show', '--pretty=format:', '--name-only', revision])
		.split(/\r?\n/)
		.filter(Boolean)
		.sort();
}

test('commits every changed file as an independent commit', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	writeFileSync(path.join(dir, 'c.txt'), 'c1');

	const changes = await commitEveryChange(dir);
	assert.equal(changes.length, 3);

	const commits = git(dir, ['log', '--format=%H', '-3']).trim().split(/\r?\n/);
	assert.equal(commits.length, 3);
	for (const commit of commits) {
		assert.equal(committedFiles(dir, commit).length, 1);
	}

	const subjects = git(dir, ['log', '--format=%s', '-3']).trim().split(/\r?\n/);
	assert.equal(new Set(subjects).size, 3);
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('commits a deletion as its own commit', async t => {
	const dir = makeRepo(t);
	rmSync(path.join(dir, 'b.txt'));

	const [change] = await readChanges(dir);
	assert.equal(change.kind, 'deleted');
	await resetIndex(dir);
	await stagePaths(dir, change.paths);
	await commitPaths(dir, 'chore(b): remove b');

	assert.equal(
		git(dir, ['show', '--name-status', '--pretty=format:', 'HEAD']).trim(),
		'D\tb.txt'
	);
});

test('commits a rename with both paths', async t => {
	const dir = makeRepo(t);
	git(dir, ['mv', 'a.txt', 'renamed.txt']);

	const changes = await readChanges(dir);
	assert.equal(changes.length, 1);
	assert.equal(changes[0].kind, 'renamed');
	assert.deepEqual(changes[0].paths.slice().sort(), ['a.txt', 'renamed.txt']);

	const diff = await getChangeDiff(dir, changes[0]);
	const message = generateCommitMessage({
		path: changes[0].path,
		oldPath: changes[0].oldPath,
		kind: changes[0].kind,
		diff
	});
	await resetIndex(dir);
	await stagePaths(dir, changes[0].paths);
	await commitPaths(dir, message.subject, message.body);

	assert.equal(
		git(dir, ['show', '--name-status', '--pretty=format:', 'HEAD']).trim(),
		'R100\ta.txt\trenamed.txt'
	);
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('commits untracked files whose names contain spaces', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'new file.txt'), 'hello');

	const changes = await readChanges(dir);
	assert.equal(changes.length, 1);
	assert.equal(changes[0].path, 'new file.txt');

	const diff = await getChangeDiff(dir, changes[0]);
	assert.match(diff, /^\+hello$/m);

	await resetIndex(dir);
	await stagePaths(dir, changes[0].paths);
	await commitPaths(dir, 'feat: add new file');

	assert.deepEqual(committedFiles(dir), ['new file.txt']);
	assert.equal(git(dir, ['status', '--porcelain']).trim(), '');
});

test('resets pre-staged work before creating a per-file commit', async t => {
	const dir = makeRepo(t);
	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	git(dir, ['add', 'b.txt']);
	writeFileSync(path.join(dir, 'b.txt'), 'b3');

	await resetIndex(dir);
	await stagePaths(dir, ['a.txt']);
	await commitPaths(dir, 'feat(a): update a');

	assert.deepEqual(committedFiles(dir), ['a.txt']);
	assert.match(git(dir, ['status', '--porcelain']), /^ M b\.txt/m);
	assert.equal(git(dir, ['show', 'HEAD:b.txt']).trim(), 'b1');
});

test('finds the repository root from a subdirectory', async t => {
	const dir = makeRepo(t);
	const sub = path.join(dir, 'nested', 'folder');
	mkdirSync(sub, { recursive: true });
	writeFileSync(path.join(sub, 'file.txt'), 'x');

	assert.equal(path.resolve(await findRepositoryRoot(sub)), path.resolve(dir));
});

test('selects origin when no upstream exists', async t => {
	const dir = makeRepo(t);
	const { url } = makeBareRemote(t);
	git(dir, ['remote', 'add', 'origin', url]);

	assert.equal(await defaultRemote(dir), 'origin');
	assert.equal(await currentBranch(dir), 'main');
});

test('verifies remote access without prompting for credentials', async t => {
	const dir = makeRepo(t);
	const { url } = makeBareRemote(t);
	git(dir, ['remote', 'add', 'origin', url]);

	await assertRemoteAccess(dir, 'origin');
	await assert.rejects(() => defaultRemote(dir, 'missing'), /not configured/);
});

test('syncs commits to the remote and pulls first when an upstream exists', async t => {
	const dir = makeRepo(t);
	const { bare, url } = makeBareRemote(t);
	git(dir, ['remote', 'add', 'origin', url]);
	git(dir, ['push', '-u', 'origin', 'main']);

	writeFileSync(path.join(dir, 'a.txt'), 'a2');
	writeFileSync(path.join(dir, 'b.txt'), 'b2');
	await commitEveryChange(dir);

	const result = await syncRepository(dir, 'origin');
	assert.equal(result.pulled, true);

	const localHead = git(dir, ['rev-parse', 'HEAD']).trim();
	const remoteHead = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main'], {
		encoding: 'utf8'
	}).trim();
	assert.equal(remoteHead, localHead);
});

test('recognises GitHub remote URLs', () => {
	assert.equal(isGithubUrl('https://github.com/user/repo.git'), true);
	assert.equal(isGithubUrl('git@github.com:user/repo.git'), true);
	assert.equal(isGithubUrl('https://gitlab.com/user/repo.git'), false);
});
