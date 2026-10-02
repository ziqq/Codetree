import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseDocument} from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = path => readFile(resolve(root, path), 'utf8');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const manifest = JSON.parse(await text('manifest.json'));
const development = JSON.parse(await text('package.json'));
const lock = JSON.parse(await text('package-lock.json'));
const files = [];

async function walk(directory = root) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    requireValue(!entry.isSymbolicLink(), `Symbolic link in project: ${relative(root, path)}`);
    if (entry.isDirectory()) await walk(path);
    else files.push(relative(root, path).replaceAll('\\', '/'));
  }
}
await walk();

async function asset(path) {
  requireValue(typeof path === 'string' && !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'), `Invalid asset path: ${path}`);
  requireValue(files.includes(path) && (await stat(resolve(root, path))).isFile(), `Missing asset: ${path}`);
}

requireValue(manifest.manifest_version === 3 && manifest.name === 'Code Tree', 'Expected the Code Tree Manifest V3 extension.');
requireValue(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest.version) && manifest.version.split('.').some(part => Number(part) > 0) && manifest.version.split('.').every(part => Number(part) <= 65535), 'Invalid release version.');
requireValue(development.private === true && !Object.keys(development.dependencies || {}).length, 'Development tooling must remain private with no runtime dependencies.');
requireValue(development.version === manifest.version && lock.version === manifest.version && lock.packages[''].version === manifest.version, 'Manifest and development-tool versions differ.');
requireValue((await text('options.html')).match(/class="version">v([\d.]+)</)?.[1] === manifest.version, 'The Settings version label differs from the manifest.');
requireValue((await text('README.md')).match(/\*\*Version ([\d.]+) /)?.[1] === manifest.version, 'The README version label differs from the manifest.');
requireValue(JSON.stringify(lock.packages[''].devDependencies) === JSON.stringify(development.devDependencies), 'package-lock.json differs from package.json; run npm install.');
requireValue(new Set(manifest.permissions).size === 3 && ['storage', 'scripting', 'activeTab'].every(value => manifest.permissions.includes(value)), 'Unexpected extension permissions.');
requireValue(manifest.host_permissions.every(value => ['https://github.com/*', 'https://api.github.com/*', 'https://gitlab.com/*'].includes(value)), 'Unexpected fixed host permission.');
const policy = manifest.content_security_policy.extension_pages;
requireValue(policy.includes("script-src 'self'") && policy.includes("object-src 'none'") && !/unsafe-|https?:|\*/.test(policy), 'Extension CSP must prohibit remote or unsafe executable code.');
await asset(manifest.background.service_worker);
await asset(manifest.options_page);
for (const script of manifest.content_scripts) {
  requireValue(script.matches.every(value => ['https://github.com/*', 'https://gitlab.com/*'].includes(value)), 'Unexpected fixed content-script host.');
  for (const path of [...script.js, ...(script.css || [])]) await asset(path);
}
for (const group of manifest.web_accessible_resources) for (const path of group.resources) await asset(path);
for (const [size, path] of Object.entries(manifest.icons)) {
  await asset(path);
  const data = await readFile(resolve(root, path));
  requireValue(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.readUInt32BE(16) === Number(size) && data.readUInt32BE(20) === Number(size), `Invalid PNG icon dimensions: ${path}`);
}

let scripts = 0;
let documents = 0;
for (const path of files) {
  if (/\.(?:js|mjs)$/.test(path)) {
    const result = spawnSync(process.execPath, ['--check', resolve(root, path)], {encoding: 'utf8'});
    requireValue(result.status === 0, `JavaScript syntax failed: ${path}\n${result.stderr}`);
    scripts++;
  }
  if (/\.(?:js|mjs|json|css|html|md|yml|yaml|py)$/.test(path)) {
    const source = await text(path);
    requireValue(source.endsWith('\n') && !source.includes('\r'), `Expected LF and a final newline: ${path}`);
    requireValue(!/(?:glpat-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/.test(source), `Possible credential in ${path}; inspect it without printing its value.`);
    if (path.endsWith('.md')) {
      for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        if (path.startsWith('.github/notify/templates/') && /^\{\{url\s+[a-zA-Z_][\w.]*\}\}$/.test(match[1])) continue;
        const target = match[1].split(/[\s#?]/)[0];
        if (!target || /^[a-z][a-z0-9+.-]*:|^#/i.test(target)) continue;
        const resolved = resolve(dirname(resolve(root, path)), decodeURIComponent(target));
        requireValue(files.includes(relative(root, resolved).replaceAll('\\', '/')), `Missing local link in ${path}: ${target}`);
      }
      documents++;
    }
    if (path.endsWith('.html')) {
      requireValue(!/<[^>]+\bon\w+\s*=|javascript:/i.test(source), `Inline executable HTML in ${path}`);
      for (const match of source.matchAll(/<(script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
        await asset(relative(root, resolve(dirname(resolve(root, path)), match[2])).replaceAll('\\', '/'));
      }
    }
    if (/\.ya?ml$/.test(path)) {
      const document = parseDocument(source, {uniqueKeys: true});
      requireValue(document.errors.length === 0, `Invalid YAML: ${path}: ${document.errors.map(error => error.message).join('; ')}`);
      if (path.startsWith('.github/workflows/')) {
        requireValue(document.get('on') && document.get('jobs'), `Missing workflow events or jobs: ${path}`);
        for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
          requireValue(match[1].startsWith('./.github/workflows/') || /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[a-f0-9]{40}$/.test(match[1]), `Pin an external action to its commit SHA: ${match[1]}`);
        }
      }
    }
  }
}
const changelog = await text('CHANGELOG.md');
const sections = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)$/gm)];
requireValue(sections[0]?.[1] === manifest.version, 'The newest changelog version must match manifest.json.');
const order = ['DEPRECATED', 'ADDED', 'CHANGED', 'FIXED'];
for (let index = 0; index < sections.length; index++) {
  const body = changelog.slice(sections[index].index, sections[index + 1]?.index);
  let previous = -1;
  for (const match of body.matchAll(/^- \*\*(\w+)\*\*:/gm)) {
    const current = order.indexOf(match[1]);
    requireValue(current >= previous && current !== -1, `Changelog categories are out of order in ${sections[index][1]}.`);
    previous = current;
  }
}
console.log(`Checked ${scripts} JavaScript files, manifest/CSP/assets, ${documents} documents, YAML, lockfile and changelog.`);
