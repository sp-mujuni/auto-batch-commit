const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

test('activation registers both commands and the output channel', () => {
	const registered = [];
	const subscriptions = [];

	const vscodeMock = {
		window: {
			createOutputChannel: name => ({
				name,
				appendLine() {},
				show() {},
				dispose() {}
			})
		},
		commands: {
			registerCommand: (id, callback) => {
				registered.push({ id, callback });
				return { dispose() {} };
			}
		},
		workspace: {
			getConfiguration: () => ({ get: () => false })
		},
		extensions: {
			getExtension: () => undefined
		}
	};

	const originalLoad = Module._load;
	Module._load = function load(request) {
		if (request === 'vscode') {
			return vscodeMock;
		}
		return originalLoad.apply(this, arguments);
	};

	try {
		const extension = require('../out/extension.js');
		extension.activate({ subscriptions });
		extension.deactivate();
	} finally {
		Module._load = originalLoad;
	}

	assert.deepEqual(
		registered.map(command => command.id),
		['autoBatchCommit.commitFiles', 'autoBatchCommit.commitAll']
	);
	assert.equal(typeof registered[0].callback, 'function');
	assert.equal(typeof registered[1].callback, 'function');
	assert.equal(subscriptions.length, 3);
});
