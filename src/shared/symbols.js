/*
 * https://github.com/ziqq/Codetree
 * Copyright (C) 2026 Anton Ustinoff
 * https://github.com/ziqq/Codetree/blob/main/LICENSE
 *
 * Original bounded lexical declaration outlines for JavaScript, TypeScript and Dart.
 * This is deliberately not an AST or a semantic language service.
 */

const maxSource = 1000000;
const maxLines = 100000;
const maxTokens = 120000;
const maxSymbols = 2000;
const lookahead = 512;
const declarationKinds = new Map([
  ['class', 'class'],
  ['interface', 'interface'],
  ['enum', 'enum'],
  ['mixin', 'mixin'],
  ['extension', 'extension'],
]);
const controls = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'assert']);
const expressionStarts = new Set([
  '=',
  '(',
  '[',
  '{',
  ',',
  ':',
  ';',
  '!',
  '?',
  '=>',
  'return',
  'case',
  'throw',
  'yield',
]);
const modifiers = new Set([
  'export',
  'default',
  'declare',
  'async',
  'abstract',
  'static',
  'public',
  'private',
  'protected',
  'override',
  'final',
  'external',
  'factory',
  'const',
  'late',
  'covariant',
  'required',
  'base',
  'sealed',
]);
const forbidden = new Set([
  'return',
  'throw',
  'new',
  'await',
  'yield',
  'case',
  'else',
  'import',
  'export',
  'class',
  'interface',
  'enum',
  'mixin',
  'extension',
  'type',
  'typedef',
  'function',
  'get',
  'set',
  ...controls,
]);

/** Whether a source character can start an unescaped lexical identifier. */
function identifierStart(character) {
  return (
    Boolean(character) &&
    (/[$A-Z_a-z]/.test(character) || (character.charCodeAt(0) > 127 && /\p{ID_Start}/u.test(character)))
  );
}

/** Whether a source character continues an unescaped lexical identifier. */
function identifierPart(character) {
  return (
    Boolean(character) &&
    (/[$\w]/.test(character) || (character.charCodeAt(0) > 127 && /\p{ID_Continue}/u.test(character)))
  );
}

/** Whether a token is an ordinary identifier rather than a declaration/control keyword. */
function nameToken(token) {
  return token?.word && !forbidden.has(token.value);
}

/** Lets the browser paint and delivers cancellation before the next bounded chunk. */
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

/** Tokenizes only declaration-relevant words and punctuation, retaining source line numbers and delimiter pairs. */
async function lex(text, dart, jsx, current) {
  const tokens = [],
    stack = [];
  const limit = Math.min(text.length, maxSource);
  let position = 0,
    line = 1,
    checkpoint = 16384;
  let mode = '',
    quote = '',
    escaped = false,
    triple = false,
    raw = false,
    commentDepth = 0,
    regexClass = false;
  let jsxDepth = 0,
    jsxTag = false,
    jsxClosing = false,
    jsxBraces = 0,
    jsxQuote = '',
    jsxComment = '';
  let limited = text.length > limit;

  /** Counts LF-delimited physical rows, matching shared/diff.js and the source viewer's navigation coordinates. */
  function advance(count = 1) {
    for (let end = position + count; position < end; position++) {
      if (text[position] === '\n') line++;
    }
  }

  /** Adds one compact token and matches braces/parentheses without reparsing their contents. */
  function emit(value, word = false) {
    const token = {value, word, line};
    const index = tokens.push(token) - 1;
    if (['(', '[', '{'].includes(value)) stack.push(index);
    else if ([')', ']', '}'].includes(value)) {
      const open = stack.at(-1);
      if (tokens[open]?.value === {')': '(', ']': '[', '}': '{'}[value]) {
        stack.pop();
        tokens[open].pair = index;
        token.pair = open;
      } else stack.length = 0;
    }
  }

  while (position < limit) {
    if (position >= checkpoint) {
      checkpoint = position + 16384;
      await pause();
      if (!current()) return {tokens: [], cancelled: true, limited: false};
    }
    if (line > maxLines || tokens.length >= maxTokens) {
      limited = true;
      break;
    }
    const character = text[position],
      next = text[position + 1];
    const lineEnd = character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029';
    if (mode === 'line') {
      if (lineEnd) mode = '';
      advance();
      continue;
    }
    if (mode === 'comment') {
      if (dart && character === '/' && next === '*') {
        commentDepth++;
        advance(2);
      } else if (character === '*' && next === '/') {
        if (!--commentDepth) mode = '';
        advance(2);
      } else advance();
      continue;
    }
    if (mode === 'string') {
      if (escaped) {
        escaped = false;
        advance();
      } else if (character === '\\' && !raw) {
        escaped = true;
        advance();
      } else if (triple ? text.startsWith(quote.repeat(3), position) : character === quote) {
        advance(triple ? 3 : 1);
        mode = '';
      } else advance();
      continue;
    }
    if (mode === 'regex') {
      if (escaped) {
        escaped = false;
        advance();
      } else if (character === '\\') {
        escaped = true;
        advance();
      } else if (character === '[') {
        regexClass = true;
        advance();
      } else if (character === ']') {
        regexClass = false;
        advance();
      } else if ((character === '/' && !regexClass) || lineEnd) {
        mode = '';
        advance();
        if (character === '/') {
          let flags = 0;
          while (/[a-z]/i.test(text[position] || '') && position < limit && flags++ < 32) advance();
          if (flags > 32) {
            limited = true;
            break;
          }
        }
      } else advance();
      continue;
    }
    if (mode === 'jsx') {
      if (jsxComment) {
        if (jsxComment === 'line' && lineEnd) jsxComment = '';
        else if (jsxComment === 'block' && character === '*' && next === '/') {
          jsxComment = '';
          advance(2);
          continue;
        }
        advance();
        continue;
      }
      if (jsxQuote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === jsxQuote) jsxQuote = '';
        advance();
        continue;
      }
      if ((jsxTag || jsxBraces) && ['"', "'", '`'].includes(character)) jsxQuote = character;
      else if (jsxBraces && character === '/' && ['/', '*'].includes(next)) {
        jsxComment = next === '/' ? 'line' : 'block';
        advance(2);
        continue;
      } else if (character === '{') jsxBraces++;
      else if (character === '}' && jsxBraces) jsxBraces--;
      else if (!jsxBraces && character === '<' && (identifierStart(next) || next === '/' || next === '>')) {
        jsxTag = true;
        jsxClosing = next === '/';
      } else if (!jsxBraces && jsxTag && character === '>') {
        jsxDepth += jsxClosing ? -1 : text[position - 1] === '/' ? 0 : 1;
        jsxTag = false;
        if (jsxDepth <= 0) mode = '';
      }
      advance();
      continue;
    }
    if (/\s/u.test(character)) {
      advance();
      continue;
    }
    if (character === '/' && next === '/') {
      mode = 'line';
      advance(2);
      continue;
    }
    if (character === '/' && next === '*') {
      mode = 'comment';
      commentDepth = 1;
      advance(2);
      continue;
    }
    if (['"', "'", '`'].includes(character) || (dart && /[rR]/.test(character) && ['"', "'"].includes(next))) {
      emit('@literal');
      raw = dart && /[rR]/.test(character);
      if (raw) advance();
      quote = text[position];
      triple = dart && text.startsWith(quote.repeat(3), position);
      mode = 'string';
      escaped = false;
      advance(triple ? 3 : 1);
      continue;
    }
    const previous = tokens.at(-1);
    if (
      character === '/' &&
      (!previous ||
        expressionStarts.has(previous.value) ||
        previous.value === '}' ||
        (previous.value === ')' && controls.has(tokens[previous.pair - 1]?.value)))
    ) {
      emit('@literal');
      mode = 'regex';
      regexClass = escaped = false;
      advance();
      continue;
    }
    if (
      jsx &&
      character === '<' &&
      (identifierStart(next) || next === '>') &&
      !/^<[$\w]+\s*,/.test(text.slice(position, position + 512)) &&
      (!previous || expressionStarts.has(previous.value))
    ) {
      emit('@literal');
      mode = 'jsx';
      jsxDepth = jsxBraces = 0;
      jsxTag = true;
      jsxClosing = false;
      advance();
      continue;
    }
    if (identifierStart(character)) {
      const start = position;
      advance();
      while (position < limit && identifierPart(text[position]) && position - start <= 512) advance();
      if (position - start > 512) {
        limited = true;
        break;
      }
      emit(text.slice(start, position), true);
      continue;
    }
    if (/\d/.test(character)) {
      emit('@number');
      advance();
      continue;
    }
    if (character === '=' && next === '>') {
      emit('=>');
      advance(2);
    } else {
      emit(character);
      advance();
    }
  }
  return {tokens, limited};
}

/** Skips one bounded generic parameter/argument group without interpreting its type expressions. */
function genericEnd(tokens, start) {
  if (tokens[start]?.value !== '<') return start;
  let depth = 0;
  for (let index = start; index < Math.min(tokens.length, start + lookahead); index++) {
    if (tokens[index].value === '<') depth++;
    else if (tokens[index].value === '>' && !--depth) return index + 1;
    else if ([';', '{', '}'].includes(tokens[index].value)) return -1;
  }
  return -1;
}

/** Finds a declaration's body while skipping paired superclass arguments and generic types. */
function declarationBody(tokens, start) {
  for (let index = start; index < Math.min(tokens.length, start + lookahead); index++) {
    const token = tokens[index];
    if (token.value === '{') return index;
    if ([';', '=', '=>', '}'].includes(token.value)) return -1;
    if (token.value === '(' || token.value === '[') {
      if (token.pair === undefined) return -1;
      index = token.pair;
    }
  }
  return -1;
}

/** Finds a callable's body/arrow/abstract terminator, rejecting ordinary calls and incomplete signatures. */
function signature(tokens, close) {
  let index = close + 1;
  if (tokens[index]?.value === 'async' || tokens[index]?.value === 'sync') index++;
  if (tokens[index]?.value === '*') index++;
  if (tokens[index]?.value === ':') {
    for (let end = Math.min(tokens.length, index + lookahead); ++index < end;) {
      const token = tokens[index];
      if (token.value === '{') {
        const following = tokens[token.pair + 1]?.value;
        if (token.pair !== undefined && ['{', '=>'].includes(following)) {
          index = token.pair;
          continue;
        }
        return {marker: '{', body: index};
      }
      if (['=>', ';', '}'].includes(token.value)) return {marker: token.value};
      if (['(', '[', '<'].includes(token.value)) {
        const next = token.value === '<' ? genericEnd(tokens, index) - 1 : token.pair;
        if (next === undefined || next < index) return null;
        index = next;
      }
    }
    return null;
  }
  const marker = tokens[index]?.value;
  return ['{', '=>', ';'].includes(marker)
    ? {
        marker,
        ...(marker === '{'
          ? {body: index}
          : marker === '=>' && tokens[index + 1]?.value === '{'
            ? {body: index + 1}
            : {}),
      }
    : null;
}

/** Reads a bounded declaration prefix up to the nearest member/statement boundary. */
function prefix(tokens, index) {
  const result = [];
  for (let start = Math.max(0, index - lookahead); --index >= start;) {
    if (['{', '}', ';'].includes(tokens[index].value)) break;
    result.push(tokens[index].value);
  }
  return result.reverse();
}

/** Recognizes a common arrow/function initializer without treating an ordinary call as a declaration. */
function functionValue(tokens, equals) {
  let start = equals + 1;
  if (tokens[start]?.value === 'async') start++;
  const expression = tokens[start]?.value === 'function';
  if (expression) {
    start++;
    if (tokens[start]?.value === '*') start++;
    if (nameToken(tokens[start])) start++;
  } else start = genericEnd(tokens, start);
  const close = tokens[start]?.value === '(' ? tokens[start].pair : nameToken(tokens[start]) ? start : undefined;
  const end = close === undefined ? null : signature(tokens, close);
  return end && (end.marker === '=>' || expression) ? end : null;
}

/**
 * Extracts lexical declaration locations from supported complete source text.
 *
 * Limits are 1,000,000 UTF-16 source units, 100,000 lines, 120,000 tokens and
 * 2,000 symbols. Every long pass yields and checks ownership; partial output
 * is explicitly marked limited. JSX subtrees and template text are opaque.
 *
 * @param {string} text Source text.
 * @param {string} path Repository file path used only to choose the language.
 * @param {Function} [current] Whether this source still belongs to its viewer.
 * @returns {Promise<{symbols: Array<{name: string, kind: string, line: number, container?: string}>, supported: boolean, limited: boolean, cancelled?: boolean}>} Bounded lexical outline.
 */
export async function extractSymbols(text, path, current = () => true) {
  const extension = typeof path === 'string' ? path.split('.').at(-1).toLowerCase() : '';
  const supported = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'dart'].includes(extension);
  if (!supported) return {symbols: [], supported: false, limited: false};
  if (!current()) return {symbols: [], supported: true, limited: false, cancelled: true};
  if (typeof text !== 'string') return {symbols: [], supported: true, limited: false};
  const dart = extension === 'dart';
  const lexical = await lex(text, dart, ['js', 'jsx', 'tsx'].includes(extension), current);
  if (lexical.cancelled || !current()) return {symbols: [], supported: true, limited: false, cancelled: true};
  const {tokens} = lexical;
  const symbols = [],
    frames = [],
    bodies = new Map(),
    declared = new Set();
  let limited = lexical.limited;

  /** Records one declaration and the named scope of its body, without duplicating named expressions. */
  function add(index, name, kind, body) {
    if (declared.has(index)) return;
    const container = frames.at(-1)?.scope;
    symbols.push({name, kind, line: tokens[index].line, ...(container ? {container} : {})});
    declared.add(index);
    if (body !== undefined) bodies.set(body, {name, kind});
  }

  for (let index = 0; index < tokens.length; index++) {
    if (index && index % 1024 === 0) {
      await pause();
      if (!current()) return {symbols: [], supported: true, limited: false, cancelled: true};
    }
    if (symbols.length >= maxSymbols) {
      limited = true;
      break;
    }
    const token = tokens[index],
      value = token.value,
      previous = tokens[index - 1]?.value;
    if (value === '{') {
      const body = bodies.get(index);
      frames.push({...body, scope: body?.name || frames.at(-1)?.scope});
      continue;
    }
    if (value === '}') {
      frames.pop();
      continue;
    }
    if (previous === '.' || declared.has(index)) continue;
    if (declarationKinds.has(value)) {
      let name = index + 1;
      if (
        (value === 'extension' && tokens[name]?.value === 'type') ||
        (value === 'mixin' && tokens[name]?.value === 'class')
      )
        name++;
      if (!nameToken(tokens[name]) || tokens[name].value === 'on') continue;
      const body = declarationBody(tokens, name + 1);
      if (body >= 0) add(name, tokens[name].value, declarationKinds.get(value), body);
      continue;
    }
    if ((value === 'type' && !dart) || (value === 'typedef' && dart)) {
      const name = index + 1,
        next = genericEnd(tokens, name + 1);
      if (nameToken(tokens[name]) && next >= 0 && tokens[next]?.value === '=') add(name, tokens[name].value, 'type');
      continue;
    }
    if (value === 'function') {
      let start = index;
      while (start > 0 && modifiers.has(tokens[start - 1].value)) start--;
      const before = tokens[start - 1];
      if (
        before &&
        !['{', '}', ';'].includes(before.value) &&
        !(before.line < tokens[start].line && !expressionStarts.has(before.value))
      )
        continue;
      let name = index + 1;
      if (tokens[name]?.value === '*') name++;
      const params = genericEnd(tokens, name + 1),
        close = tokens[params]?.pair;
      if (nameToken(tokens[name]) && tokens[params]?.value === '(' && close !== undefined) {
        const end = signature(tokens, close);
        if (end) add(name, tokens[name].value, 'function', end.body);
      }
      continue;
    }
    if (['const', 'let', 'var'].includes(value)) {
      const name = index + 1;
      if (!nameToken(tokens[name])) continue;
      let equals = name + 1;
      while (
        equals < Math.min(tokens.length, name + lookahead) &&
        !['=', ',', ';', '{', '}'].includes(tokens[equals].value)
      )
        equals++;
      if (tokens[equals]?.value !== '=') continue;
      const end = functionValue(tokens, equals);
      if (end) add(name, tokens[name].value, 'function', end.body);
      continue;
    }
    const frame = frames.at(-1);
    const member = frame && ['class', 'interface', 'enum', 'mixin', 'extension'].includes(frame.kind);
    if (!nameToken(token) || (!member && !dart)) continue;
    const before = prefix(tokens, index);
    if (before.some(word => ['=', '=>', '(', ')', ',', '.', 'return', 'throw', 'new'].includes(word))) continue;
    if (member && tokens[index + 1]?.value === '=') {
      const end = functionValue(tokens, index + 1);
      if (end) add(index, previous === '#' ? '#' + value : value, 'method', end.body);
      continue;
    }
    if (dart && previous === 'get' && ['{', '=>', ';'].includes(tokens[index + 1]?.value)) {
      add(index, value, 'getter', tokens[index + 1].value === '{' ? index + 1 : undefined);
      continue;
    }
    let params = genericEnd(tokens, index + 1),
      name = previous === '#' ? '#' + value : value,
      kind = member ? 'method' : 'function';
    if (dart && member && value === frame.name && tokens[index + 1]?.value === '.' && nameToken(tokens[index + 2])) {
      name += '.' + tokens[index + 2].value;
      params = index + 3;
      kind = 'constructor';
    }
    if (tokens[params]?.value === '?' || tokens[params]?.value === '!') params++;
    const close = tokens[params]?.value === '(' ? tokens[params].pair : undefined;
    if (close === undefined || controls.has(value)) continue;
    const end = signature(tokens, close);
    if (!end || (!member && end.marker === ';' && !before.length)) continue;
    if (before.some(word => forbidden.has(word) && !['get', 'set'].includes(word))) continue;
    if (previous === 'get') kind = 'getter';
    else if (previous === 'set') kind = 'setter';
    else if (member && (value === 'constructor' || (dart && value === frame.name))) kind = 'constructor';
    add(index, name, kind, end.body);
  }
  return {symbols, supported: true, limited};
}
