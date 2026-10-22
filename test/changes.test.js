const assert = require('node:assert/strict');
const test = require('node:test');

const { describeKind, displayPath, parseStatus } = require('../out/changes.js');

test('parses modified, renamed, untracked, deleted, and added entries', () => {
	const output = [
		' M b.txt',
		'R  renamed.txt',
		'a.txt',
		'?? c.txt',
		' D d.txt',
		'!! ignored.log',
		'A  e.txt',
		''
	].join('\0');

	assert.deepEqual(parseStatus(output), [
		{ path: 'b.txt', oldPath: undefined, kind: 'modified', indexStatus: ' ', worktreeStatus: 'M', paths: ['b.txt'] },
		{ path: 'c.txt', oldPath: undefined, kind: 'untracked', indexStatus: '?', worktreeStatus: '?', paths: ['c.txt'] },
		{ path: 'd.txt', oldPath: undefined, kind: 'deleted', indexStatus: ' ', worktreeStatus: 'D', paths: ['d.txt'] },
		{ path: 'e.txt', oldPath: undefined, kind: 'added', indexStatus: 'A', worktreeStatus: ' ', paths: ['e.txt'] },
		{
			path: 'renamed.txt',
			oldPath: 'a.txt',
			kind: 'renamed',
			indexStatus: 'R',
			worktreeStatus: ' ',
			paths: ['a.txt', 'renamed.txt']
		}
	]);
});

test('keeps both paths for copies', () => {
	const [change] = parseStatus('C  copy.txt\0source.txt\0');

	assert.equal(change.kind, 'copied');
	assert.equal(change.path, 'copy.txt');
	assert.equal(change.oldPath, 'source.txt');
	assert.deepEqual(change.paths, ['source.txt', 'copy.txt']);
});

test('parses paths containing spaces', () => {
	const [change] = parseStatus('?? folder/a file.txt\0');

	assert.equal(change.path, 'folder/a file.txt');
	assert.equal(change.kind, 'untracked');
});

test('returns no changes for empty status output', () => {
	assert.deepEqual(parseStatus(''), []);
});

test('describes and displays changes', () => {
	assert.equal(describeKind('untracked'), 'added');
	assert.equal(describeKind('modified'), 'modified');
	assert.equal(describeKind('deleted'), 'deleted');
	assert.equal(
		displayPath({ path: 'new.txt', oldPath: 'old.txt', kind: 'renamed', indexStatus: 'R', worktreeStatus: ' ', paths: [] }),
		'old.txt -> new.txt'
	);
	assert.equal(
		displayPath({ path: 'a.txt', kind: 'modified', indexStatus: ' ', worktreeStatus: 'M', paths: [] }),
		'a.txt'
	);
});
