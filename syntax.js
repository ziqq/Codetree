(() => {
  'use strict';
  const extensions = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    dart: 'dart', go: 'go', rs: 'rust', py: 'python', rb: 'ruby', php: 'php', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', sh: 'shell', bash: 'shell', zsh: 'shell',
    json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', css: 'css', scss: 'css', sql: 'sql',
    html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', md: 'markdown', mdx: 'markdown',
  };
  const keywords = Object.fromEntries(Object.entries({
    javascript: 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield',
    typescript: 'abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new number of private protected public readonly require return set static string super switch symbol throw try type typeof unique unknown var void while yield',
    dart: 'abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for get hide if implements import in interface is late library mixin new of on operator part required rethrow return sealed set show static super switch sync this throw try typedef var void when while with yield',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    rust: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
    python: 'and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield',
    ruby: 'alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield',
    shell: 'case do done elif else esac export fi for function if in local readonly return select then time until while',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public record return short static strictfp super switch synchronized this throw throws transient try var void volatile while',
    kotlin: 'abstract actual annotation as break by catch class companion const constructor continue crossinline data delegate do dynamic else enum expect external field file final finally for fun get if import in infix init inline inner interface internal is lateinit noinline object open operator out override package param private property protected public receiver reified return sealed set setparam super suspend tailrec this throw try typealias val var vararg when where while',
    swift: 'actor as associatedtype async await break case catch class continue convenience default defer deinit didSet do dynamic else enum extension fallthrough fileprivate final for func get guard if import in indirect infix init inout internal is lazy let mutating nonmutating open operator optional override postfix precedencegroup prefix private protocol public repeat required rethrows return self Self set some static struct subscript super switch throws throw try typealias unowned var weak where while willSet',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
    cpp: 'alignas alignof asm auto bool break case catch char class concept const constexpr consteval constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern final float for friend goto if inline int long mutable namespace new noexcept nullptr operator override private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union unsigned using virtual void volatile wchar_t while',
    csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref required return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield',
    php: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield',
    sql: 'add all alter and as asc begin between by case check column commit constraint create cross database default delete desc distinct drop else end except exists foreign from full group having in index inner insert intersect into is join key left like limit not null offset on or order outer over primary references right rollback select set table then union unique update using values view when where with',
  }).map(([language, value]) => [language, new Set(value.split(' '))]));
  const constants = new Set(['true', 'false', 'null', 'nil', 'none', 'undefined', 'nan', 'inf', 'yes', 'no']);
  const identifier = /[$a-zA-Z_][$\w]*/y;
  const number = /(?:0[xob][\da-f_]+|\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?\d[\d_]*)?)(?:n|[ulfd])?/iy;
  function language(path) {
    const name = path.split('/').at(-1).toLowerCase();
    if (['dockerfile', 'makefile', '.bashrc', '.zshrc'].includes(name)) return 'shell';
    return extensions[name.split('.').at(-1)] || '';
  }
  async function tokenize(text, path, current = () => true) {
    const name = language(path); const lines = globalThis.CodeTree.lines(text);
    if (!name) return {lines: [], language: '', limited: false};
    const result = []; let count = 0; let scanned = 0; let quote = ''; let block = ''; let inTag = false;
    const hashComment = ['python', 'ruby', 'shell', 'yaml', 'toml'].includes(name);
    const slashComment = !['python', 'ruby', 'shell', 'sql', 'yaml', 'toml', 'markup', 'markdown', 'css'].includes(name);
    for (const line of lines) {
      const tokens = []; result.push(tokens); let position = 0;
      const emit = (start, end, type) => { if (end > start) { tokens.push({start, end, type}); count++; } position = end; };
      while (position < line.length) {
        if (scanned >= 16384) { scanned = 0; await new Promise(resolve => setTimeout(resolve, 0)); if (!current()) return {lines: [], language: name, cancelled: true}; }
        const start = position; const character = line[position];
        if (block) {
          const end = line.indexOf(block, position);
          emit(start, end < 0 ? line.length : end + block.length, 'comment'); if (end >= 0) block = '';
        } else if (quote) {
          while (position < line.length) {
            if (line[position] === '\\' && name !== 'sql') { position += Math.min(2, line.length - position); continue; }
            if (line.startsWith(quote, position)) {
              position += quote.length;
              if (name === 'sql' && line.startsWith(quote, position)) { position += quote.length; continue; }
              quote = ''; break;
            }
            position++;
          }
          const property = name === 'json' && !quote && /^\s*:/.test(line.slice(position));
          emit(start, position, property ? 'property' : 'string');
          if (quote && quote.length === 1 && quote !== '`' && !['shell', 'ruby', 'sql'].includes(name)) quote = '';
        } else if ((hashComment && character === '#') || (slashComment && line.startsWith('//', position)) || (name === 'sql' && line.startsWith('--', position))) emit(start, line.length, 'comment');
        else if ((slashComment || name === 'css' || name === 'sql') && line.startsWith('/*', position)) { block = '*/'; }
        else if (['markup', 'markdown'].includes(name) && line.startsWith('<!--', position)) { block = '-->'; }
        else if ((character === '"' || (character === "'" && name !== 'json') || (character === '`' && ['javascript', 'typescript', 'go', 'shell', 'markdown'].includes(name))) &&
            !(name === 'rust' && character === "'" && /[a-zA-Z_]/.test(line[position + 1] || '') && line[position + 2] !== "'")) {
          quote = ['python', 'dart', 'swift'].includes(name) && line.startsWith(character.repeat(3), position) ? character.repeat(3) : character;
          emit(start, start + quote.length, 'string');
        } else if (name === 'markdown' && position === 0 && /^\s{0,3}#{1,6}(?:\s|$)/.test(line)) emit(start, line.length, 'heading');
        else if (name === 'markup' && character === '<') { inTag = true; emit(start, start + 1, 'punctuation'); }
        else if (name === 'markup' && character === '>') { inTag = false; emit(start, start + 1, 'punctuation'); }
        else if (name === 'markup' && !inTag) position++;
        else if (/\d/.test(character)) {
          number.lastIndex = position; const match = number.exec(line); emit(start, start + match[0].length, 'number');
        } else if (/[$a-zA-Z_]/.test(character)) {
          identifier.lastIndex = position; const word = identifier.exec(line)[0]; position += word.length;
          const value = name === 'sql' ? word.toLowerCase() : word;
          const rest = line.slice(position); let type = '';
          if (keywords[name]?.has(value)) type = 'keyword';
          else if (constants.has(word.toLowerCase())) type = 'constant';
          else if (name === 'markup') type = /^<\/?$/.test(line.slice(Math.max(0, start - 2), start)) || line[start - 1] === '<' ? 'tag' : 'property';
          else if (['yaml', 'toml', 'css'].includes(name) && /^\s*[:=]/.test(rest)) type = 'property';
          else if (/^\s*\(/.test(rest)) type = 'function';
          if (type) emit(start, position, type);
        } else if (/[{}()[\];,.?:]/.test(character)) emit(start, start + 1, 'punctuation');
        else if (/[+\-*/%=!<>&|^~]/.test(character)) emit(start, start + 1, 'operator');
        else position++;
        scanned += Math.max(1, position - start);
        if (count > 200000) return {lines: [], language: name, limited: true};
      }
    }
    return {lines: result, language: name, limited: false};
  }
  globalThis.CodeTreeSyntax = Object.freeze({tokenize, language});
})();
