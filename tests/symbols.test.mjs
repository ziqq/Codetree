/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Bounded lexical symbol extraction regressions, independent of browser rendering.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';

const path = new URL('../src/shared/symbols.js', import.meta.url);
const implementation = existsSync(path) ? await import(path) : {};

/** Requires the capability before importing old-baseline behavior into a test. */
function extractor() {
  assert.equal(
    typeof implementation.extractSymbols,
    'function',
    'Supported source files expose a lexical symbol outline.',
  );
  return implementation.extractSymbols;
}

test('symbols: TypeScript functions, generators, arrows and class members retain exact declaration order', async () => {
  const text = [
    'export async function* stream<T>(value: T) {',
    '  function nested() {}',
    '}',
    'const map = async <T>(value: T): Promise<T> => value;',
    'let single = value => value;',
    'const worker = function process(value) { return value; };',
    'export class Store<T> extends Base<T> {',
    '  constructor(value: T) {}',
    '  async load<U>(',
    '    value: U,',
    '  ): Promise<U> { return value; }',
    '  get size(): number { return 1; }',
    '  set size(value: number) {}',
    '  handler = (value: T) => value;',
    '}',
  ].join('\n');
  const result = await extractor()(text, 'src/store.ts');
  assert.deepEqual(result, {
    supported: true,
    limited: false,
    symbols: [
      {name: 'stream', kind: 'function', line: 1},
      {name: 'nested', kind: 'function', line: 2, container: 'stream'},
      {name: 'map', kind: 'function', line: 4},
      {name: 'single', kind: 'function', line: 5},
      {name: 'worker', kind: 'function', line: 6},
      {name: 'Store', kind: 'class', line: 7},
      {name: 'constructor', kind: 'constructor', line: 8, container: 'Store'},
      {name: 'load', kind: 'method', line: 9, container: 'Store'},
      {name: 'size', kind: 'getter', line: 12, container: 'Store'},
      {name: 'size', kind: 'setter', line: 13, container: 'Store'},
      {name: 'handler', kind: 'method', line: 14, container: 'Store'},
    ],
  });
});

test('symbols: TypeScript interfaces, aliases, enums and abstract signatures are declarations, not calls', async () => {
  const result = await extractor()(
    [
      'export interface Reader<T> {',
      '  read(value: T): Promise<T>;',
      '}',
      'export type Result<T> = { value: T };',
      'enum Status { Ready, Done }',
      'abstract class Service {',
      '  abstract run<T>(value: T): T;',
      '  shape(): { value: string } { return { value: "ok" }; }',
      '}',
      'service.run();',
    ].join('\n'),
    'declarations.d.ts',
  );
  assert.deepEqual(result.symbols, [
    {name: 'Reader', kind: 'interface', line: 1},
    {name: 'read', kind: 'method', line: 2, container: 'Reader'},
    {name: 'Result', kind: 'type', line: 4},
    {name: 'Status', kind: 'enum', line: 5},
    {name: 'Service', kind: 'class', line: 6},
    {name: 'run', kind: 'method', line: 7, container: 'Service'},
    {name: 'shape', kind: 'method', line: 8, container: 'Service'},
  ]);
  assert.equal(result.limited, false);
});

test('symbols: Dart constructors, named factories, getters, setters and generic async methods', async () => {
  const result = await extractor()(
    [
      'typedef Factory<T> = T Function();',
      'abstract interface class Box<T> {',
      '  const Box(this.value);',
      '  factory Box.memory(T value) => Box(value);',
      '  final T value;',
      '  int get size => 1;',
      '  set size(int value) {}',
      '  @override',
      '  Future<T> load<U>(',
      '    U input,',
      '  ) async { return value; }',
      '}',
      'mixin class Cache { void clear() {} }',
      'extension StringTools on String { bool get empty => isEmpty; }',
      'extension type UserID(int value) {}',
      'enum Mode { compact, expanded }',
      'Future<List<T>> create<T>(T value) async => [value];',
    ].join('\n'),
    'lib/box.dart',
  );
  assert.deepEqual(result.symbols, [
    {name: 'Factory', kind: 'type', line: 1},
    {name: 'Box', kind: 'class', line: 2},
    {name: 'Box', kind: 'constructor', line: 3, container: 'Box'},
    {name: 'Box.memory', kind: 'constructor', line: 4, container: 'Box'},
    {name: 'size', kind: 'getter', line: 6, container: 'Box'},
    {name: 'size', kind: 'setter', line: 7, container: 'Box'},
    {name: 'load', kind: 'method', line: 9, container: 'Box'},
    {name: 'Cache', kind: 'mixin', line: 13},
    {name: 'clear', kind: 'method', line: 13, container: 'Cache'},
    {name: 'StringTools', kind: 'extension', line: 14},
    {name: 'empty', kind: 'getter', line: 14, container: 'StringTools'},
    {name: 'UserID', kind: 'extension', line: 15},
    {name: 'Mode', kind: 'enum', line: 16},
    {name: 'create', kind: 'function', line: 17},
  ]);
  assert.equal(result.limited, false);
});

test('symbols: comments, quoted strings, templates, regular expressions and calls do not invent declarations', async () => {
  const text = [
    '// function commentFake() {}',
    '/* class CommentFake { methodFake() {} } */',
    'const quoted = "function stringFake() {}";',
    'const template = `class TemplateFake { methodFake() {} } ${"function interpolationFake() {}"}`;',
    'const pattern = /function regexFake() {}/g;',
    'if (quoted) /class RegexClass { methodFake() {} }/.test(quoted);',
    'invoke(); object.method();',
    'class Real {',
    '  field = create();',
    '  static { invoke(); }',
    '  run() { invoke(); object.method(); }',
    '}',
  ].join('\n');
  const result = await extractor()(text, 'source.js');
  assert.deepEqual(result.symbols, [
    {name: 'Real', kind: 'class', line: 8},
    {name: 'run', kind: 'method', line: 11, container: 'Real'},
  ]);
});

test('symbols: JSX/TSX markup and embedded template text stay opaque while outer components remain visible', async () => {
  const text = [
    'export const App = () => <section title="function attrFake() {}">',
    '  class TextFake { methodFake() {} }; function textFake() {}',
    '  <Widget value={"class ExpressionFake {}"} />',
    '</section>;',
    'export function next() { return <><span>function fake() {}</span></>; }',
  ].join('\n');
  for (const path of ['view.jsx', 'view.tsx']) {
    const result = await extractor()(text, path);
    assert.deepEqual(
      result.symbols,
      [
        {name: 'App', kind: 'function', line: 1},
        {name: 'next', kind: 'function', line: 5},
      ],
      path,
    );
    assert.equal(result.limited, false);
  }
});

test('symbols: Dart raw/triple strings and nested comments cannot leak declarations', async () => {
  const text = [
    "final raw = r'ends with a backslash\\';",
    "final triple = '''function fake() {}\nclass Fake {}''';",
    '/* outer /* nested */ void commentFake() {} */',
    'void real() { invoke(); }',
  ].join('\n');
  const result = await extractor()(text, 'strings.dart');
  assert.deepEqual(result.symbols, [{name: 'real', kind: 'function', line: 5}]);
});

test('symbols: Unicode names and CRLF source preserve exact one-based declaration lines', async () => {
  const text = [
    '// Unicode 😀 does not shift source rows',
    'export function café() {}',
    '',
    'class Пример {',
    '  метод() {}',
    '}',
  ].join('\r\n');
  const result = await extractor()(text, 'UNICODE.JS');
  assert.deepEqual(result.symbols, [
    {name: 'café', kind: 'function', line: 2},
    {name: 'Пример', kind: 'class', line: 4},
    {name: 'метод', kind: 'method', line: 5, container: 'Пример'},
  ]);
  for (const separator of ['\u2028', '\u2029', '\r']) {
    const physical = await extractor()(
      `function first() {}${separator}function sameRow() {}\n\nfunction third() {}`,
      'physical.js',
    );
    assert.deepEqual(
      physical.symbols,
      [
        {name: 'first', kind: 'function', line: 1},
        {name: 'sameRow', kind: 'function', line: 1},
        {name: 'third', kind: 'function', line: 3},
      ],
      'Unicode separators and standalone CR do not invent viewer rows.',
    );
    const comment = await extractor()(`// function hidden() {}${separator}function visible() {}`, 'comment.js');
    assert.deepEqual(
      comment.symbols,
      [{name: 'visible', kind: 'function', line: 1}],
      'Lexical comments still terminate at source-language line separators.',
    );
  }
});

test('symbols: incomplete input returns only confident preceding declarations and never throws', async () => {
  const extract = extractor();
  const result = await extract('function before() {}\nconst unfinished = `class Fake {', 'incomplete.js');
  assert.deepEqual(result.symbols, [{name: 'before', kind: 'function', line: 1}]);
  for (const text of ['class', 'function name(', 'class A { run(', 'const arrow = <T>(', '}}})', '/* unclosed']) {
    const value = await extract(text, 'broken.ts');
    assert.equal(value.supported, true);
    assert.equal(value.limited, false);
  }
});

test('symbols: unsupported files do not scan or consult ownership', async () => {
  const extract = extractor();
  assert.deepEqual(
    await extract('function fake() {}', 'source.py', () => {
      throw new Error('Must not scan');
    }),
    {symbols: [], supported: false, limited: false},
  );
  assert.deepEqual(await extract('', 'source.js'), {symbols: [], supported: true, limited: false});
});

test('symbols: ownership cancellation before lexing, during long literals and during declaration traversal', async () => {
  const extract = extractor();
  assert.deepEqual(await extract('function no() {}', 'source.js', () => false), {
    symbols: [],
    supported: true,
    limited: false,
    cancelled: true,
  });
  let checks = 0;
  const literal = await extract(
    'const text = "' + 'x'.repeat(40000) + '"; function after() {}',
    'source.js',
    () => ++checks < 2,
  );
  assert.equal(literal.cancelled, true);
  assert.deepEqual(literal.symbols, []);
  checks = 0;
  const declarations = await extract(
    Array.from({length: 1100}, (_, index) => `function f${index}(){}`).join('\n'),
    'source.js',
    () => ++checks < 4,
  );
  assert.equal(declarations.cancelled, true);
  assert.deepEqual(declarations.symbols, []);
  assert.ok(checks >= 4);
});

test('symbols: source, line, token and retained-symbol limits explicitly report partial output', async () => {
  const extract = extractor();
  const source = await extract(
    'function kept() {}\nconst text = "' + 'x'.repeat(1000000) + '"; function outside() {}',
    'source.js',
  );
  assert.equal(source.limited, true);
  assert.deepEqual(source.symbols, [{name: 'kept', kind: 'function', line: 1}]);
  const lines = await extract('function kept() {}\n' + '\n'.repeat(100000) + 'function outside() {}', 'source.js');
  assert.equal(lines.limited, true);
  assert.deepEqual(lines.symbols, [{name: 'kept', kind: 'function', line: 1}]);
  const tokens = await extract(';'.repeat(120010) + 'function outside() {}', 'source.js');
  assert.equal(tokens.limited, true);
  assert.deepEqual(tokens.symbols, []);
  const symbols = await extract(
    Array.from({length: 2005}, (_, index) => `function f${index}(){}`).join('\n'),
    'source.js',
  );
  assert.equal(symbols.limited, true);
  assert.equal(symbols.symbols.length, 2000);
  assert.equal(symbols.symbols.at(-1).name, 'f1999');
});

test('symbols: overlong identifiers and regex flag sequences cannot bypass bounded scanning', async () => {
  const extract = extractor();
  const flags = await extract(
    'function kept() {}\nconst pattern = /x/' + 'g'.repeat(50000) + '; function outside() {}',
    'source.js',
  );
  assert.equal(flags.limited, true);
  assert.deepEqual(flags.symbols, [{name: 'kept', kind: 'function', line: 1}]);
  const name = await extract(
    'function kept() {}\nconst ' + 'a'.repeat(10000) + '=1; function outside() {}',
    'source.js',
  );
  assert.equal(name.limited, true);
  assert.deepEqual(name.symbols, [{name: 'kept', kind: 'function', line: 1}]);
});

test('symbols: Dart abstract getters and setters remain navigable without implementation bodies', async () => {
  const result = await extractor()(
    'abstract class Readable<T> {\n  T get value;\n  set value(T next);\n}',
    'readable.dart',
  );
  assert.deepEqual(result.symbols, [
    {name: 'Readable', kind: 'class', line: 1},
    {name: 'value', kind: 'getter', line: 2, container: 'Readable'},
    {name: 'value', kind: 'setter', line: 3, container: 'Readable'},
  ]);
});

test('symbols: private methods preserve their names and unsupported compound bindings never take another name', async () => {
  const result = await extractor()(
    'class Secret {\n  #hidden() {}\n  #handler = () => { function nested() {} };\n}\nlet plain, callback = value => value;',
    'private.js',
  );
  assert.deepEqual(result.symbols, [
    {name: 'Secret', kind: 'class', line: 1},
    {name: '#hidden', kind: 'method', line: 2, container: 'Secret'},
    {name: '#handler', kind: 'method', line: 3, container: 'Secret'},
    {name: 'nested', kind: 'function', line: 3, container: '#handler'},
  ]);
});

test('symbols: TSX generic arrow parameters do not swallow subsequent declarations as markup', async () => {
  const result = await extractor()(
    'const identity = <T,>(value: T) => value;\nexport function after() {}',
    'generic.tsx',
  );
  assert.deepEqual(result.symbols, [
    {name: 'identity', kind: 'function', line: 1},
    {name: 'after', kind: 'function', line: 2},
  ]);
});

test('symbols: semicolonless statements preserve declarations and multiline modifiers without naming expressions twice', async () => {
  const result = await extractor()(
    [
      "import x from 'x'",
      'export function run() {}',
      'const value = 1',
      'async function loaded() {}',
      'export',
      'default',
      'async',
      'function fetchIt() {}',
      'const expression =',
      '  async function inner() {}',
      'run()',
      'object.method()',
    ].join('\n'),
    'semicolonless.js',
  );
  assert.deepEqual(result.symbols, [
    {name: 'run', kind: 'function', line: 2},
    {name: 'loaded', kind: 'function', line: 4},
    {name: 'fetchIt', kind: 'function', line: 8},
    {name: 'expression', kind: 'function', line: 9},
  ]);
});
