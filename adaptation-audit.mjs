import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'C:/E/ui';
const LIBRARY = path.resolve(ROOT, 'library');
const DATA = path.resolve(ROOT, 'data/components.json');
const LOGS = path.resolve(ROOT, 'logs');
const BASE = `http://127.0.0.1:${Number(process.env.UI_LIBRARY_PORT || 49183)}`;
const TAILWIND_PREFIXES = /^(cursor-|font-|overflow-|relative$|absolute$|fixed$|sticky$|z-|border|rounded|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|w-|h-|min-h-|max-w-|flex$|inline-flex$|grid$|items-|justify-|gap-|space-|text-|bg-|from-|to-|via-|opacity-|transition|duration-|ease-|rotate-|translate-|inset-|top-|(?:right|left|bottom)-(?:0|[0-9]|\[)|shadow|blur|whitespace-|pointer-events-|select-|leading-|content-|ring)/;
const SUPPORTED_BARE_IMPORTS = new Set(['gsap', 'gsap/ScrollTrigger', 'lenis']);

const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const localFile = relative => path.resolve(LIBRARY, relative);
const isExternal = value => /^(https?:)?\/\//i.test(value);
const isIgnoredRef = value => !value || value.startsWith('#') || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:') || value.startsWith('mailto:') || value.startsWith('/') || isExternal(value);

function refsFrom(text) {
  return [...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(x => x[1])
    .concat([...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(x => x[1]))
    .map(value => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replace(/^["']|["']$/g, ''));
}
function importsFrom(text) {
  return [...text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)].map(x => x[1]);
}
function runtimeExternalRefs(text) {
  return [...text.matchAll(/<(?:script|link|img|video|source)[^>]+(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(x => x[1]).filter(isExternal)
    .concat([...text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(x => x[1]).filter(isExternal));
}
function tailwindTokens(text) {
  const out = new Set();
  for (const match of text.matchAll(/class\s*=\s*["']([^"']+)["']/gi)) {
    for (const token of match[1].split(/\s+/)) if (TAILWIND_PREFIXES.test(token.split(':').at(-1))) out.add(token);
  }
  return [...out];
}
async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}
async function inspectComponent(component) {
  const file = localFile(component.sourcePath);
  const raw = await readText(file);
  const relativeAssets = refsFrom(raw).filter(ref => !isIgnoredRef(ref));
  const missingAssets = [];
  for (const ref of relativeAssets) {
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const candidate = path.resolve(path.dirname(file), clean.replaceAll('/', path.sep));
    if (!candidate.startsWith(LIBRARY + path.sep) || !(await fs.stat(candidate).catch(() => null))) missingAssets.push(ref);
  }
  const externalRefs = refsFrom(raw).filter(isExternal);
  const sourceExternalRuntimeRefs = runtimeExternalRefs(raw);
  const scripts = [...raw.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)].map(x => x[1]).filter(ref => !isIgnoredRef(ref));
  let scriptText = '';
  for (const src of scripts) scriptText += `\n${await readText(path.resolve(path.dirname(file), src.replaceAll('/', path.sep).split('?')[0]))}`;
  const imports = [...new Set(importsFrom(raw).concat(importsFrom(scriptText)))];
  const unresolvedBareImports = imports.filter(specifier => !specifier.startsWith('.') && !specifier.startsWith('/') && !SUPPORTED_BARE_IMPORTS.has(specifier));
  const classes = tailwindTokens(raw);
  let previewStatus = 0;
  let runtime = '';
  try {
    const response = await fetch(`${BASE}/preview/${encodePath(component.sourcePath)}`);
    previewStatus = response.status;
    runtime = await response.text();
  } catch {}
  return {
    id: component.id,
    name: component.name,
    sourcePath: component.sourcePath,
    previewStatus,
    empty: !raw.trim(),
    missingAssets,
    unrepairedMissingAssets: missingAssets.filter(ref => runtime.includes(ref)),
    externalRefs,
    sourceExternalRuntimeRefs,
    externalRuntimeRefs: runtimeExternalRefs(runtime),
    unresolvedBareImports,
    tailwindTokens: classes.length,
    tailwindSample: classes.slice(0, 8),
    tailwindAdapter: classes.length ? runtime.includes('data-local-tailwind') : true,
    noStyleHint: !/<style\b|<link[^>]+stylesheet|style\s*=|class\s*=/.test(raw),
  };
}

const index = JSON.parse(await fs.readFile(DATA, 'utf8'));
const results = [];
for (let i = 0; i < index.components.length; i += 32) {
  results.push(...await Promise.all(index.components.slice(i, i + 32).map(inspectComponent)));
}
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  reachable: results.filter(x => x.previewStatus === 200 && !x.empty).length,
  badPreview: results.filter(x => x.previewStatus !== 200 || x.empty),
  sourceMissingAssets: results.filter(x => x.missingAssets.length),
  missingAssets: results.filter(x => x.unrepairedMissingAssets.length),
  unresolvedBareImports: results.filter(x => x.unresolvedBareImports.length),
  tailwind: {components: results.filter(x => x.tailwindTokens).length, adapterMissing: results.filter(x => x.tailwindTokens && !x.tailwindAdapter).length},
  externalDependencyComponents: results.filter(x => x.externalRuntimeRefs.length),
  noStyleHint: results.filter(x => x.noStyleHint),
  components: results,
};
await fs.mkdir(LOGS, {recursive: true});
const file = path.join(LOGS, `adaptation-audit-${new Date().toISOString().replaceAll(':', '-')}.json`);
await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({file, total: report.total, reachable: report.reachable, badPreview: report.badPreview.length, sourceMissingAssets: report.sourceMissingAssets.length, missingAssets: report.missingAssets.length, unresolvedBareImports: report.unresolvedBareImports.length, tailwindComponents: report.tailwind.components, tailwindAdapterMissing: report.tailwind.adapterMissing, externalDependencyComponents: report.externalDependencyComponents.length, noStyleHint: report.noStyleHint.length}));
