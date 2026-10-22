const assert = require('node:assert/strict');
const test = require('node:test');

const { formatCommitMessage, generateCommitMessage } = require('../out/message.js');

function message(path, kind, diff, oldPath) {
	return generateCommitMessage({ path, oldPath, kind, diff });
}

test('adds a new source file with its main symbol in the subject', () => {
	const result = message(
		'src/parser.ts',
		'untracked',
		[
			'+import { readFile } from "node:fs/promises";',
			'+',
			'+export async function parseFile(input: string) {',
			'+  return input;',
			'+}'
		].join('\n')
	);

	assert.equal(result.type, 'feat');
	assert.equal(result.scope, 'parser');
	assert.equal(result.subject, 'feat(parser): add parseFile');
	assert.match(result.body, /File: src\/parser\.ts/);
	assert.match(result.body, /Change: added/);
	assert.match(result.body, /Added: parseFile/);
});

test('uses added symbols when modifying an existing file', () => {
	const result = message(
		'src/git.ts',
		'modified',
		[
			'@@ -10,0 +11,3 @@',
			'+export async function syncRepository(root: string) {',
			'+  return root;',
			'+}'
		].join('\n')
	);

	assert.equal(result.type, 'feat');
	assert.equal(result.subject, 'feat(git): add syncRepository');
});

test('describes deleted files', () => {
	const result = message('src/legacy.ts', 'deleted', '-export function oldThing() {');

	assert.equal(result.type, 'chore');
	assert.equal(result.subject, 'chore(legacy): remove legacy');
});

test('describes renames with both names', () => {
	const result = message('src/newname.ts', 'renamed', '', 'src/oldname.ts');

	assert.equal(result.type, 'refactor');
	assert.equal(result.subject, 'refactor(newname): rename oldname to newname');
});

test('classifies documentation and configuration files', () => {
	const docs = message('README.md', 'modified', '+Usage');
	assert.equal(docs.type, 'docs');
	assert.equal(docs.subject, 'docs: update README');

	const config = message('package.json', 'modified', '+  "version": "0.2.0"');
	assert.equal(config.type, 'build');
	assert.equal(config.subject, 'build(deps): update package');
});

test('classifies tests and stylesheets', () => {
	const tests = message('test/cli.test.js', 'modified', '+test("works", () => {});');
	assert.equal(tests.type, 'test');
	assert.equal(tests.subject, 'test(cli): update cli');

	const style = message('src/theme.css', 'modified', '+.button { color: red; }');
	assert.equal(style.type, 'style');
	assert.equal(style.subject, 'style(theme): update theme');
});

test('classifies fixes when error handling is introduced', () => {
	const result = message(
		'src/api.ts',
		'modified',
		[
			'-  console.log("error");',
			'+  try {',
			'+    await request();',
			'+  } catch (error) {',
			'+    logger.error(error);',
			'+  }'
		].join('\n')
	);

	assert.equal(result.type, 'fix');
	assert.equal(result.subject, 'fix(api): handle failure in api');
});

test('detects formatting-only changes', () => {
	const result = message('src/x.ts', 'modified', ['-const x=1;', '+const  x = 1;'].join('\n'));

	assert.equal(result.type, 'style');
	assert.equal(result.subject, 'style(x): format x');
});

test('caps long subjects at 72 characters', () => {
	const result = message(
		'src/very-long-module-name.ts',
		'untracked',
		'+export function aVeryLongFunctionNameThatKeepsGoingAndGoingAndGoing() {}'
	);

	assert.ok(result.subject.length <= 72, result.subject);
	assert.match(result.subject, /^feat\([^)]+\): add /);
});

test('formats the full commit message with a blank line before the body', () => {
	const result = message('src/a.ts', 'untracked', '+export function run() {}');
	const formatted = formatCommitMessage(result);

	assert.match(formatted, /^feat\(a\): add run\n\nFile: src\/a\.ts/);
});
