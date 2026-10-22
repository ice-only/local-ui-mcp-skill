import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(process.env.UI_LIBRARY_ROOT?.trim() || 'C:/E/ui');
export const LIBRARY = path.resolve(ROOT, 'library');
export const SRC = path.resolve(ROOT, 'src');
export const DATA = path.resolve(ROOT, 'data');
export const LOGS = path.resolve(ROOT, 'logs');
export const INDEX_FILE = path.join(DATA, 'components.json');
export const OVERRIDES_FILE = path.join(DATA, 'overrides.json');

export function safePath(base, relative) {
  const resolved = path.resolve(base, relative || '');
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Invalid path');
  return resolved;
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file) { return path.relative(LIBRARY, file).replaceAll('\\', '/'); }

function titleFrom(file) {
  const base = path.basename(file, path.extname(file));
  const generic = ['preview', 'index', 'demo', 'fullscreen'];
  if (generic.includes(base.toLowerCase())) {
    return path.basename(path.dirname(file)).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function categoryFrom(file) {
  const parts = rel(file).split('/');
  const known = ['buttons', 'cards', 'tooltips', 'notifications', 'radio-buttons', 'toggle-switches', 'inputs', 'forms', 'patterns', 'preloaders', 'page-transitions', 'scroll-transitions', 'scroll-trigger', 'ui-components'];
  const lowerParts = parts.map(x => String(x).toLowerCase());
  const hit = [...lowerParts].reverse().find(x => known.includes(x));
  return hit ? hit.replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase()) : (parts.length > 1 ? parts[parts.length - 2] : 'Other');
}

function sourceFor(file, files) {
  const dir = path.dirname(file);
  const candidates = ['preview.html', 'index.html', 'demo.html', 'fullscreen.html'];
  const html = candidates.map(x => path.join(dir, x)).find(x => files.has(x));
  return html || file;
}

function frameworkFor(file, files) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.vue') return 'Vue';
  if (ext === '.jsx' || ext === '.tsx') return 'React';
  const siblings = [...files].filter(x => path.dirname(x) === path.dirname(file)).map(x => path.extname(x).toLowerCase());
  if (siblings.includes('.tsx') || siblings.includes('.jsx')) return 'React';
  if (siblings.includes('.vue')) return 'Vue';
  return 'HTML/CSS/JS';
}

function componentRootFor(file, files) {
  const preferred = ['preview.html', 'index.html', 'demo.html', 'fullscreen.html'];
  let dir = path.dirname(file);
  while (dir.startsWith(LIBRARY)) {
    if (preferred.some(x => files.has(path.join(dir, x)))) return dir;
    if (dir === LIBRARY) break;
    dir = path.dirname(dir);
  }
  return file;
}

export async function scan() {
  await fs.mkdir(DATA, { recursive: true });
  let previous = { components: [] };
  let overrides = {};
  try { previous = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8')); } catch {}
  try { overrides = JSON.parse(await fs.readFile(OVERRIDES_FILE, 'utf8')); } catch {}
  const all = await walk(LIBRARY);
  const fileSet = new Set(all);
  const entries = all.filter(f => ['.html', '.vue', '.jsx', '.tsx'].includes(path.extname(f).toLowerCase()));
  const preferred = ['preview.html', 'index.html', 'demo.html', 'fullscreen.html'];
  const selectedByRoot = new Map();
  const standalone = [];
  for (const file of entries) {
    let dir = path.dirname(file);
    let root = null;
    while (dir.startsWith(LIBRARY)) {
      const entry = preferred.map(x => path.join(dir, x)).find(x => fileSet.has(x));
      if (entry) { root = dir; selectedByRoot.set(root, entry); break; }
      if (dir === LIBRARY) break;
      dir = path.dirname(dir);
    }
    if (!root) standalone.push(file);
  }
  const selected = [...selectedByRoot.values(), ...standalone];
  const components = [];
  const errors = [];
  for (const file of selected) {
    try {
      const preview = sourceFor(file, fileSet);
      const relative = rel(preview);
      const componentRoot = componentRootFor(preview, fileSet);
      const bundleDir = path.extname(componentRoot) ? path.dirname(componentRoot) : componentRoot;
      const sourceFiles = all.filter(f => path.dirname(f) === bundleDir || path.dirname(f).startsWith(bundleDir + path.sep)).slice(0, 40);
      const source = await fs.stat(preview);
      const id = crypto.createHash('sha1').update(relative).digest('hex').slice(0, 12);
      const parts = relative.split('/');
      const author = parts.find(x => /_/.test(x) && !x.endsWith('.html')) || '';
      const category = categoryFrom(preview);
      const base = {
        id,
        name: titleFrom(preview),
        category,
        tags: [category.toLowerCase().replaceAll(' ', '-')],
        sourcePath: relative,
        directory: path.relative(LIBRARY, componentRoot).replaceAll('\\', '/'),
        author,
        framework: frameworkFor(preview, sourceFiles),
        size: source.size,
        modified: source.mtimeMs,
        files: sourceFiles.map(rel)
      };
      components.push({ ...base, ...(overrides[id] || {}) });
    } catch (error) {
      errors.push({ file: rel(file), message: error.message });
    }
  }
  const oldMap = new Map((previous.components || []).map(x => [x.id, x]));
  const newMap = new Map(components.map(x => [x.id, x]));
  const stats = {
    added: components.filter(x => !oldMap.has(x.id)).length,
    updated: components.filter(x => oldMap.has(x.id) && oldMap.get(x.id).modified !== x.modified).length,
    removed: (previous.components || []).filter(x => !newMap.has(x.id)).length,
    errors: errors.length
  };
  const result = { generatedAt: new Date().toISOString(), library: LIBRARY, total: components.length, stats, errors, components };
  await fs.writeFile(INDEX_FILE, JSON.stringify(result, null, 2), 'utf8');
  await fs.mkdir(LOGS, { recursive: true });
  await fs.writeFile(path.join(LOGS, `scan-${new Date().toISOString().replaceAll(':', '-')}.json`), JSON.stringify({ generatedAt: result.generatedAt, total: result.total, stats: result.stats, errors: result.errors }, null, 2), 'utf8');
  return result;
}

export async function loadIndex() {
  try { return JSON.parse(await fs.readFile(INDEX_FILE, 'utf8')); }
  catch { return scan(); }
}

