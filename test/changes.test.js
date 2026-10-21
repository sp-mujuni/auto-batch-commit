const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { collectBatchFiles, statusLabel } = require('../out/changes.js');
const { Status } = require('../out/types.js');

const root = path.resolve(path.sep === '\\' ? 'C:\\repo' : '/repo');
const at = (...parts) => path.join(root, ...parts);
const uri = fsPath => ({ scheme: 'file', fsPath });

function change(fsPath, status, options = {}) {
	return {
		uri: uri(fsPath),
		originalUri: options.originalUri ?? uri(fsPath),
		renameUri: options.renameUri,
		status
	};
}

function repository(state) {
	return {
		rootUri: uri(root),
		inputBox: { value: '' },
		state: {
			HEAD: undefined,
			indexChanges: [],
			workingTreeChanges: [],
			untrackedChanges: [],
			...state
		},
		status: async () => undefined,
		push: async () => undefined
	};
}

test('merges staged and working tree changes into one entry per file', () => {
	const repo = repository({
		indexChanges: [change(at('a.txt'), Status.INDEX_MODIFIED)],
		workingTreeChanges: [
			change(at('a.txt'), Status.MODIFIED),
			change(at('b.txt'), Status.UNTRACKED)
		],
		untrackedChanges: [change(at('b.txt'), Status.UNTRACKED)]
	});

	assert.deepEqual(collectBatchFiles(repo), [
		{
			key: at('a.txt'),
			label: 'a.txt',
			repoPaths: ['a.txt'],
			statuses: ['Staged, modified', 'Modified'],
			staged: true
		},
		{
			key: at('b.txt'),
			label: 'b.txt',
			repoPaths: ['b.txt'],
			statuses: ['Untracked'],
			staged: false
		}
	]);
});

test('includes the old path for renamed files', () => {
	// VS Code's Git API reports uri = new path, originalUri = old path, renameUri = new path.
	const repo = repository({
		indexChanges: [
			change(at('new.txt'), Status.INDEX_RENAMED, {
				originalUri: uri(at('old.txt')),
				renameUri: uri(at('new.txt'))
			})
		]
	});

	const [file] = collectBatchFiles(repo);
	assert.equal(file.label, 'new.txt');
	assert.deepEqual(file.repoPaths.sort(), ['new.txt', 'old.txt']);
});

test('sorts files by path and ignores changes outside the repository', () => {
	const outside = path.join(path.dirname(root), 'outside.txt');
	const repo = repository({
		workingTreeChanges: [
			change(at('z.txt'), Status.MODIFIED),
			change(at('a.txt'), Status.MODIFIED),
			change(outside, Status.MODIFIED)
		]
	});

	assert.deepEqual(
		collectBatchFiles(repo).map(file => file.label),
		['a.txt', 'z.txt']
	);
});

test('status values match the VS Code Git API order', () => {
	assert.equal(Status.INTENT_TO_ADD, 9);
	assert.equal(Status.INTENT_TO_RENAME, 10);
	assert.equal(Status.TYPE_CHANGED, 11);
	assert.equal(Status.ADDED_BY_US, 12);
	assert.equal(Status.BOTH_MODIFIED, 18);
});

test('returns a friendly label for every known status', () => {
	assert.equal(statusLabel(Status.INDEX_RENAMED), 'Staged, renamed');
	assert.equal(statusLabel(Status.DELETED), 'Deleted');
	assert.equal(statusLabel(Status.INTENT_TO_RENAME), 'Intent to rename');
	assert.equal(statusLabel(Status.TYPE_CHANGED), 'Type changed');
	assert.equal(statusLabel(Status.BOTH_MODIFIED), 'Modified by both');
	assert.equal(statusLabel(999), 'Changed');
});
