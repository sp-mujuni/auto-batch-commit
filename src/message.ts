import type { ChangeKind } from './changes';

export interface MessageInput {
	readonly path: string;
	readonly oldPath?: string;
	readonly kind: ChangeKind;
	readonly diff: string;
}

export interface CommitMessage {
	readonly subject: string;
	readonly body: string;
	readonly type: string;
	readonly scope?: string;
}

interface SymbolInfo {
	readonly name: string;
	readonly kind: string;
	readonly weight: number;
	readonly order: number;
}

interface DiffStats {
	readonly added: string[];
	readonly removed: string[];
	readonly addedSymbols: SymbolInfo[];
	readonly removedSymbols: SymbolInfo[];
}

const SYMBOL_PATTERNS: ReadonlyArray<{ readonly pattern: RegExp; readonly kind: string; readonly weight: number }> = [
	{
		pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
		kind: 'function',
		weight: 10
	},
	{
		pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+|sealed\s+|final\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+)*class\s+([A-Za-z_$][\w$]*)/,
		kind: 'class',
		weight: 10
	},
	{
		pattern: /^\s*(?:export\s+)?(?:default\s+)?interface\s+([A-Za-z_$][\w$]*)/,
		kind: 'interface',
		weight: 9
	},
	{
		pattern: /^\s*(?:export\s+)?(?:type|enum)\s+([A-Za-z_$][\w$]*)/,
		kind: 'type',
		weight: 8
	},
	{
		pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
		kind: 'function',
		weight: 9
	},
	{
		pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
		kind: 'variable',
		weight: 6
	},
	{
		pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
		kind: 'function',
		weight: 10
	},
	{
		pattern: /^\s*class\s+([A-Za-z_]\w*)/,
		kind: 'class',
		weight: 10
	},
	{
		pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
		kind: 'function',
		weight: 10
	},
	{
		pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
		kind: 'function',
		weight: 10
	},
	{
		pattern: /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/,
		kind: 'type',
		weight: 9
	},
	{
		pattern: /^\s*(?:public|private|protected|internal|static|final|abstract|override|async|virtual|sealed|partial|export|\s)+\s*(?:class|interface|enum|record|struct)\s+([A-Za-z_$][\w$]*)/,
		kind: 'type',
		weight: 9
	},
	{
		pattern: /^\s*(?:public|private|protected|internal|static|final|abstract|override|async|virtual|sealed|partial|synchronized)\s+(?:(?:static|final|abstract|override|async|virtual|sealed|partial|synchronized|new|unsafe|extern)\s+)*[\w<>\[\],.?]+\s+([A-Za-z_$][\w$]*)\s*\(/,
		kind: 'method',
		weight: 7
	}
];

const NOISE_NAMES = new Set([
	'if',
	'for',
	'while',
	'switch',
	'return',
	'new',
	'catch',
	'function',
	'const',
	'let',
	'var',
	'this',
	'super',
	'import',
	'export'
]);

const FIX_INDICATORS =
	/try\s*\{|catch\s*\(|throw\s+new|\bfix(?:es|ed)?\b|\bbug\b|\bregression\b|\bcrash\b|\bguard\b|\bretry\b|\bfallback\b/i;

const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\.[^.]+$/i;
const DOCS_PATH = /\.(md|mdx|markdown|rst)$|(^|\/)docs?(\/|$)/i;
const CI_PATH = /(^|\/)\.github\/workflows\//i;
const BUILD_PATH =
	/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|jsconfig[^/]*\.json|dockerfile|makefile|\.dockerignore|\.gitignore|\.npmrc|\.nvmrc|requirements\.txt|pyproject\.toml|poetry\.lock|go\.mod|go\.sum|cargo\.toml|cargo\.lock|pom\.xml|build\.gradle|build\.gradle\.kts|gemfile|gemfile\.lock|composer\.json|composer\.lock)$/i;
const STYLE_PATH = /\.(css|scss|sass|less|styl|stylus)$/i;

const GENERIC_DIRECTORIES = new Set([
	'src',
	'lib',
	'app',
	'apps',
	'packages',
	'source',
	'sources',
	'modules',
	'test',
	'tests',
	'__tests__',
	'spec',
	'specs'
]);

export function generateCommitMessage(input: MessageInput): CommitMessage {
	const stats = analyseDiff(input.diff);
	const type = classify(input, stats);
	const scope = scopeFor(input.path, type);
	const detail = detailFor(input, stats, type);

	return {
		subject: buildSubject(type, scope, detail),
		body: buildBody(input, stats, type),
		type,
		scope
	};
}

export function formatCommitMessage(message: CommitMessage): string {
	return message.body ? `${message.subject}\n\n${message.body}` : message.subject;
}

function analyseDiff(diff: string): DiffStats {
	const added: string[] = [];
	const removed: string[] = [];

	for (const line of diff.split(/\r?\n/)) {
		if (isDiffMetadata(line)) {
			continue;
		}
		if (line.startsWith('+')) {
			added.push(line.slice(1));
		} else if (line.startsWith('-')) {
			removed.push(line.slice(1));
		}
	}

	return {
		added,
		removed,
		addedSymbols: extractSymbols(added),
		removedSymbols: extractSymbols(removed)
	};
}

function isDiffMetadata(line: string): boolean {
	return (
		line.startsWith('diff ') ||
		line.startsWith('index ') ||
		line.startsWith('--- ') ||
		line.startsWith('+++ ') ||
		line.startsWith('@@') ||
		line.startsWith('new file mode') ||
		line.startsWith('deleted file mode') ||
		line.startsWith('old mode') ||
		line.startsWith('new mode') ||
		line.startsWith('similarity index') ||
		line.startsWith('dissimilarity index') ||
		line.startsWith('rename from ') ||
		line.startsWith('rename to ') ||
		line.startsWith('copy from ') ||
		line.startsWith('copy to ') ||
		line.startsWith('Binary files ')
	);
}

function extractSymbols(lines: string[]): SymbolInfo[] {
	const symbols = new Map<string, SymbolInfo>();

	for (const [order, line] of lines.entries()) {
		for (const { pattern, kind, weight } of SYMBOL_PATTERNS) {
			const match = pattern.exec(line);
			const name = match?.[1];
			if (!name || NOISE_NAMES.has(name)) {
				continue;
			}

			const existing = symbols.get(name);
			if (!existing || existing.weight < weight) {
				symbols.set(name, { name, kind, weight, order });
			}
		}
	}

	return [...symbols.values()].sort(
		(left, right) => right.weight - left.weight || left.order - right.order
	);
}

function classify(input: MessageInput, stats: DiffStats): string {
	const lowerPath = input.path.replace(/\\/g, '/').toLowerCase();

	if (TEST_PATH.test(lowerPath)) {
		return 'test';
	}
	if (DOCS_PATH.test(lowerPath)) {
		return 'docs';
	}
	if (CI_PATH.test(lowerPath)) {
		return 'ci';
	}
	if (BUILD_PATH.test(lowerPath)) {
		return 'build';
	}
	if (STYLE_PATH.test(lowerPath)) {
		return 'style';
	}
	if (input.kind === 'deleted') {
		return 'chore';
	}
	if (input.kind === 'renamed' || input.kind === 'copied') {
		return 'refactor';
	}
	if (isFormattingOnly(stats)) {
		return 'style';
	}
	if (
		stats.added.length + stats.removed.length > 60 &&
		stats.addedSymbols.length > 0 &&
		stats.removedSymbols.length > 0
	) {
		return 'refactor';
	}
	if (introducesFix(stats)) {
		return 'fix';
	}
	if (stats.addedSymbols.length > 0 && stats.removedSymbols.length === 0) {
		return 'feat';
	}
	if (stats.removedSymbols.length > 0 && stats.addedSymbols.length === 0) {
		return 'refactor';
	}
	if (input.kind === 'added' || input.kind === 'untracked') {
		return 'feat';
	}
	return 'refactor';
}

function introducesFix(stats: DiffStats): boolean {
	return stats.added.some(line => FIX_INDICATORS.test(line)) && stats.removed.length > 0;
}

function isFormattingOnly(stats: DiffStats): boolean {
	if (stats.added.length === 0 || stats.removed.length === 0) {
		return false;
	}
	const normalise = (lines: string[]): string => lines.join('\n').replace(/\s+/g, '');
	return normalise(stats.added) === normalise(stats.removed);
}

function detailFor(input: MessageInput, stats: DiffStats, type: string): string {
	const base = stem(input.path);
	const oldBase = input.oldPath ? stem(input.oldPath) : undefined;

	if (input.kind === 'renamed' && oldBase) {
		return `rename ${oldBase} to ${base}`;
	}
	if (input.kind === 'copied' && oldBase) {
		return `copy ${oldBase} to ${base}`;
	}
	if (input.kind === 'deleted') {
		return `remove ${oldBase ?? base}`;
	}

	if (isFormattingOnly(stats)) {
		return `format ${base}`;
	}

	if (type === 'test' || type === 'docs' || type === 'ci' || type === 'build' || type === 'style') {
		if (input.kind === 'added' || input.kind === 'untracked') {
			return `add ${base}`;
		}
		return `update ${base}`;
	}

	if (input.kind === 'added' || input.kind === 'untracked') {
		const [symbol] = stats.addedSymbols;
		return `add ${symbol?.name ?? base}`;
	}

	if (input.kind === 'modified') {
		if (stats.addedSymbols.length > 0 && stats.removedSymbols.length === 0) {
			return `add ${listNames(stats.addedSymbols)}`;
		}
		if (stats.removedSymbols.length > 0 && stats.addedSymbols.length === 0) {
			return `remove ${listNames(stats.removedSymbols)}`;
		}
		if (stats.addedSymbols.length > 0 && stats.removedSymbols.length > 0) {
			const symbols = uniqueSymbols([...stats.addedSymbols, ...stats.removedSymbols]);
			return symbols.length > 3 ? `update ${base}` : `update ${listNames(symbols)}`;
		}
		if (type === 'fix') {
			return `handle failure in ${base}`;
		}
		return `update ${base}`;
	}

	return `update ${base}`;
}

function uniqueSymbols(symbols: SymbolInfo[]): SymbolInfo[] {
	const seen = new Set<string>();
	return symbols.filter(symbol => {
		if (seen.has(symbol.name)) {
			return false;
		}
		seen.add(symbol.name);
		return true;
	});
}

function listNames(symbols: SymbolInfo[]): string {
	return symbols
		.slice(0, 2)
		.map(symbol => symbol.name)
		.join(', ');
}

function buildSubject(type: string, scope: string | undefined, detail: string): string {
	const prefix = scope ? `${type}(${scope})` : type;
	const subject = `${prefix}: ${detail}`;
	return subject.length > 72 ? `${subject.slice(0, 71)}…` : subject;
}

function buildBody(input: MessageInput, stats: DiffStats, type: string): string {
	const lines = [
		`File: ${input.oldPath ? `${input.oldPath} -> ${input.path}` : input.path}`,
		`Change: ${input.kind === 'untracked' ? 'added' : input.kind}`,
		`Lines: +${stats.added.length} -${stats.removed.length}`
	];

	const fileLevelType =
		type === 'test' || type === 'docs' || type === 'ci' || type === 'build' || type === 'style';
	if (!fileLevelType) {
		const added = stats.addedSymbols.map(symbol => symbol.name).slice(0, 5);
		const removed = stats.removedSymbols.map(symbol => symbol.name).slice(0, 5);

		if (added.length > 0) {
			lines.push(`Added: ${added.join(', ')}`);
		}
		if (removed.length > 0) {
			lines.push(`Removed: ${removed.join(', ')}`);
		}
	}

	return lines.join('\n');
}

function scopeFor(filePath: string, type: string): string | undefined {
	if (type === 'ci') {
		return undefined;
	}

	const parts = filePath.replace(/\\/g, '/').split('/');
	const directories = parts
		.slice(0, -1)
		.filter(part => !GENERIC_DIRECTORIES.has(part.toLowerCase()));
	const candidate = directories.length > 0 ? directories[directories.length - 1] : stem(filePath);
	const scope = sanitiseScope(candidate);

	if (!scope) {
		return undefined;
	}
	if (type === 'docs' && (scope === 'readme' || scope === 'docs')) {
		return undefined;
	}
	if (
		type === 'build' &&
		['package', 'package-lock', 'npm-shrinkwrap', 'yarn', 'pnpm-lock'].includes(scope)
	) {
		return 'deps';
	}
	return scope;
}

function sanitiseScope(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^[.-]+|[.-]+$/g, '');
}

function stem(filePath: string): string {
	const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
	if (name.startsWith('.') && !name.slice(1).includes('.')) {
		return name;
	}
	return name.replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/i, '') || name;
}
