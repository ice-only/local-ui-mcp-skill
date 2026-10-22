import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, LIBRARY, SRC, DATA, LOGS, INDEX_FILE, OVERRIDES_FILE, safePath, scan as scanLibrary, loadIndex } from './library-core.mjs';

const SETTINGS_FILE = path.join(DATA, 'settings.json');
const PORT = Number(process.env.UI_LIBRARY_PORT || 49183);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };
const scan = scanLibrary;
async function loadSettings() {
  try {
    const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    return { gpuAcceleration: settings.gpuAcceleration === true, configured: true };
  } catch {
    return { gpuAcceleration: false, configured: false };
  }
}
async function saveSettings(update) {
  const current = await loadSettings();
  const next = { gpuAcceleration: typeof update.gpuAcceleration === 'boolean' ? update.gpuAcceleration : current.gpuAcceleration };
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return { ...next, configured: true };
}
async function readJsonBody(req) { let body=''; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {}; }
async function json(res, value, status=200) { const body = JSON.stringify(value); res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(body); }
function assetUrl(relative) { return '/preview/' + relative.split('/').map(encodeURIComponent).join('/'); }

const TW_SCALE = {0:'0rem',0.5:'0.125rem',1:'0.25rem',1.5:'0.375rem',2:'0.5rem',2.5:'0.625rem',3:'0.75rem',3.5:'0.875rem',4:'1rem',5:'1.25rem',6:'1.5rem',7:'1.75rem',8:'2rem',9:'2.25rem',10:'2.5rem',11:'2.75rem',12:'3rem',14:'3.5rem',16:'4rem',20:'5rem',24:'6rem',32:'8rem',40:'10rem',48:'12rem',56:'14rem',64:'16rem'};
const TW_COLORS = {white:'#fff',black:'#000',transparent:'transparent','green-500':'#22c55e','blue-500':'#3b82f6','purple-500':'#a855f7','pink-500':'#ec4899','purple-800':'#6b21a8','gray-900':'#111827','gray-200':'#e5e7eb','red-500':'#ef4444','yellow-400':'#facc15'};
function cssClass(value) { return value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`); }
function twValue(value) {
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replaceAll('_', ' ');
  if (value === 'full') return '100%';
  if (value === '1/2') return '50%';
  if (value === '1/3') return '33.333333%';
  if (value === '2/3') return '66.666667%';
  if (value === '1/4') return '25%';
  if (value === '3/4') return '75%';
  return TW_SCALE[value] ?? null;
}
function twColor(value) { return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : (TW_COLORS[value] || null); }
function twDeclarations(token) {
  const base = token.split(':').at(-1);
  const negative = base.startsWith('-');
  const raw = negative ? base.slice(1) : base;
  const value = (prefix) => { const v = raw.slice(prefix.length); const resolved = twValue(v); return resolved ? (negative ? `-${resolved}` : resolved) : null; };
  const color = (prefix) => twColor(raw.startsWith(prefix) ? raw.slice(prefix.length) : '');
  if (raw === 'relative') return 'position:relative';
  if (raw === 'absolute') return 'position:absolute';
  if (raw === 'fixed') return 'position:fixed';
  if (raw === 'sticky') return 'position:sticky';
  if (raw === 'flex') return 'display:flex';
  if (raw === 'inline-flex') return 'display:inline-flex';
  if (raw === 'grid') return 'display:grid';
  if (raw === 'block') return 'display:block';
  if (raw === 'hidden') return 'display:none';
  if (raw === 'flex-col') return 'flex-direction:column';
  if (raw === 'flex-row') return 'flex-direction:row';
  if (raw === 'items-center') return 'align-items:center';
  if (raw === 'items-start') return 'align-items:flex-start';
  if (raw === 'items-end') return 'align-items:flex-end';
  if (raw === 'justify-center') return 'justify-content:center';
  if (raw === 'justify-between') return 'justify-content:space-between';
  if (raw === 'justify-end') return 'justify-content:flex-end';
  if (raw === 'text-center') return 'text-align:center';
  if (raw === 'whitespace-nowrap') return 'white-space:nowrap';
  if (raw === 'overflow-hidden') return 'overflow:hidden';
  if (raw === 'overflow-auto') return 'overflow:auto';
  if (raw === 'pointer-events-none') return 'pointer-events:none';
  if (raw === 'cursor-pointer') return 'cursor:pointer';
  if (raw === 'select-none') return 'user-select:none';
  if (raw.startsWith('z-')) return `z-index:${raw.slice(2).startsWith('[') ? raw.slice(4,-1) : raw.slice(2)}`;
  if (raw === 'inset-0') return 'inset:0';
  if (raw === 'top-0') return 'top:0';
  if (raw === 'right-0') return 'right:0';
  if (raw === 'bottom-0') return 'bottom:0';
  if (raw === 'left-0') return 'left:0';
  if (raw.startsWith('left-')) { const v = value('left-'); return v ? `left:${v}` : null; }
  if (raw.startsWith('right-')) { const v = value('right-'); return v ? `right:${v}` : null; }
  if (raw.startsWith('top-')) { const v = value('top-'); return v ? `top:${v}` : null; }
  if (raw.startsWith('bottom-')) { const v = value('bottom-'); return v ? `bottom:${v}` : null; }
  if (raw.startsWith('w-')) { const v = raw === 'w-full' ? '100%' : raw === 'w-fit' ? 'fit-content' : value('w-'); return v ? `width:${v}` : null; }
  if (raw.startsWith('h-')) { const v = raw === 'h-full' ? '100%' : raw === 'h-fit' ? 'fit-content' : value('h-'); return v ? `height:${v}` : null; }
  if (raw.startsWith('min-h-')) { const v = raw === 'min-h-screen' ? '100vh' : value('min-h-'); return v ? `min-height:${v}` : null; }
  if (raw.startsWith('max-w-')) { const v = raw === 'max-w-none' ? 'none' : value('max-w-'); return v ? `max-width:${v}` : null; }
  for (const [prefix, property] of [['p-','padding'],['m-','margin'],['px-','padding-inline'],['py-','padding-block'],['pt-','padding-top'],['pr-','padding-right'],['pb-','padding-bottom'],['pl-','padding-left'],['mx-','margin-inline'],['my-','margin-block'],['mt-','margin-top'],['mr-','margin-right'],['mb-','margin-bottom'],['ml-','margin-left'],['gap-','gap']]) {
    if (raw.startsWith(prefix)) { const v = value(prefix); if (v) return `${property}:${v}`; }
  }
  if (raw === 'border') return 'border-width:1px;border-style:solid';
  if (raw.startsWith('border-') && /^border-(l|r|t|b)-/.test(raw)) { const match = raw.match(/^border-(l|r|t|b)-(.+)$/); const v = twValue(match[2]); return v ? `border-${({l:'left',r:'right',t:'top',b:'bottom'})[match[1]]}-width:${v};border-style:solid` : null; }
  if (raw.startsWith('border-')) { const c = color('border-'); return c ? `border-color:${c}` : null; }
  if (raw === 'rounded') return 'border-radius:.25rem';
  if (raw === 'rounded-sm') return 'border-radius:.125rem';
  if (raw === 'rounded-md') return 'border-radius:.375rem';
  if (raw === 'rounded-lg') return 'border-radius:.5rem';
  if (raw === 'rounded-xl') return 'border-radius:.75rem';
  if (raw === 'rounded-2xl') return 'border-radius:1rem';
  if (raw === 'rounded-full') return 'border-radius:9999px';
  if (raw.startsWith('bg-')) { const c = color('bg-'); return c ? `background-color:${c}` : null; }
  if (raw.startsWith('text-')) { const c = color('text-'); if (c) return `color:${c}`; if (raw === 'text-xs') return 'font-size:.75rem;line-height:1rem'; if (raw === 'text-sm') return 'font-size:.875rem;line-height:1.25rem'; if (raw === 'text-lg') return 'font-size:1.125rem;line-height:1.75rem'; if (raw === 'text-xl') return 'font-size:1.25rem;line-height:1.75rem'; }
  if (raw === 'font-medium') return 'font-weight:500';
  if (raw === 'font-semibold') return 'font-weight:600';
  if (raw === 'font-bold') return 'font-weight:700';
  if (raw === 'leading-tight') return 'line-height:1.25';
  if (raw === 'transition') return 'transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter;transition-duration:150ms';
  if (raw === 'transition-all') return 'transition-property:all';
  if (raw.startsWith('duration-')) return `transition-duration:${Number(raw.slice(9)) || 150}ms`;
  if (raw.startsWith('ease-')) return `transition-timing-function:${raw === 'ease-in' ? 'ease-in' : raw === 'ease-out' ? 'ease-out' : 'ease-in-out'}`;
  if (raw.startsWith('opacity-')) return `opacity:${Number(raw.slice(8)) / 100}`;
  if (raw.startsWith('rotate-')) return `transform:rotate(${negative ? '-' : ''}${raw.slice(7)}deg)`;
  if (raw.startsWith('translate-x-')) { const v = twValue(raw.slice(12)); return v ? `transform:translateX(${negative ? '-' : ''}${v})` : null; }
  if (raw.startsWith('translate-y-')) { const v = twValue(raw.slice(12)); return v ? `transform:translateY(${negative ? '-' : ''}${v})` : null; }
  if (raw.startsWith('blur-')) { const v = raw.slice(5).replace('[','').replace(']',''); return `filter:blur(${v || '8px'})`; }
  if (raw.startsWith('shadow')) return 'box-shadow:0 10px 15px -3px rgb(0 0 0 / .1),0 4px 6px -4px rgb(0 0 0 / .1)';
  return null;
}
function tailwindAdapter(html, includePreflight = false) {
  const tokens = new Set();
  for (const match of html.toString('utf8').matchAll(/class\s*=\s*["']([^"']+)["']/g)) match[1].split(/\s+/).filter(Boolean).forEach(token => tokens.add(token));
  const rules = [];
  for (const token of tokens) {
    const declarations = twDeclarations(token);
    if (!declarations) continue;
    const parts = token.split(':');
    const variant = parts.slice(0, -1).join(':');
    const selector = `.${cssClass(token)}`;
    if (variant === 'group-hover') rules.push(`.group:hover ${selector}{${declarations}}`);
    else if (variant === 'hover') rules.push(`${selector}:hover{${declarations}}`);
    else if (variant === 'focus') rules.push(`${selector}:focus{${declarations}}`);
    else if (!variant || variant === 'dark') rules.push(`${selector}{${declarations}}`);
  }
  const preflight = includePreflight ? '*,:before,:after{box-sizing:border-box;border-width:0;border-style:solid}button,input,optgroup,select,textarea{font:inherit;margin:0}button{background:transparent;text-transform:none}' : '';
  return rules.length || includePreflight ? `<style data-local-tailwind>/* offline utility adapter */${preflight}${rules.join('')}</style>` : '';
}
const MISSING_IMAGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#e5e7eb"/><text x="160" y="104" text-anchor="middle" fill="#6b7280" font-family="Arial" font-size="16">Local preview</text></svg>')}`;
async function repairMissingLocalRefs(file, html) {
  const replacements = new Map();
  const directory = path.dirname(file);
  for (const match of html.matchAll(/(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi)) {
    const original = match[3];
    const ref = original.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    if (!ref || ref.startsWith('#') || ref.startsWith('/') || /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:')) continue;
    const clean = ref.split('#')[0].split('?')[0];
    const candidate = path.resolve(directory, clean.replaceAll('/', path.sep));
    if (candidate.startsWith(LIBRARY + path.sep) && await fs.stat(candidate).catch(() => null)) continue;
    const replacement = /\.(png|jpe?g|gif|webp|svg)$/i.test(clean) ? MISSING_IMAGE : '#';
    replacements.set(original, replacement);
  }
  for (const [original, replacement] of replacements) html = html.replaceAll(original, replacement);
  return html;
}

const GSAP_SHIM = `
const list = value => {
  if (typeof value === 'string') return [...document.querySelectorAll(value)];
  if (value && value.nodeType) return [value];
  if (Array.isArray(value)) return value.flatMap(list);
  return [];
};
const apply = (value, vars = {}) => {
  const nodes = list(value);
  nodes.forEach(node => {
    if (vars.clearProps === 'all') { node.removeAttribute('style'); return; }
    const transforms = [];
    for (const [key, raw] of Object.entries(vars)) {
      if (['duration','delay','ease','overwrite','onStart','onUpdate','onComplete','scrollTrigger','stagger','repeat','yoyo','paused','clearProps'].includes(key)) continue;
      const n = typeof raw === 'number' ? raw : String(raw);
      if (key === 'x') transforms.push('translateX(' + (typeof raw === 'number' ? raw + 'px' : raw) + ')');
      else if (key === 'y') transforms.push('translateY(' + (typeof raw === 'number' ? raw + 'px' : raw) + ')');
      else if (key === 'xPercent') transforms.push('translateX(' + raw + '%)');
      else if (key === 'yPercent') transforms.push('translateY(' + raw + '%)');
      else if (key === 'rotation') transforms.push('rotate(' + raw + 'deg)');
      else if (key === 'scale') transforms.push('scale(' + raw + ')');
      else if (key in node.style) node.style[key] = n;
      else if (key === 'backgroundColor') node.style.backgroundColor = n;
    }
    if (transforms.length) node.style.transform = transforms.join(' ');
    if (typeof vars.onUpdate === 'function') vars.onUpdate();
    if (typeof vars.onComplete === 'function') vars.onComplete();
  });
};
const tween = (target, vars = {}) => { apply(target, vars); return { kill(){}, play(){ apply(target, vars); return this; }, pause(){ return this; }, reverse(){ return this; } }; };
const gsap = {
  set: apply,
  to: tween,
  from: tween,
  fromTo: (target, fromVars, toVars) => { apply(target, fromVars); return tween(target, toVars); },
  timeline: () => { const tl = { to(t,v){ apply(t,v); return tl; }, from(t,v){ apply(t,v); return tl; }, fromTo(t,a,v){ apply(t,a); apply(t,v); return tl; }, set(t,v){ apply(t,v); return tl; }, add(){ return tl; }, call(fn){ if (typeof fn === 'function') fn(); return tl; }, play(){ return tl; }, pause(){ return tl; }, reverse(){ return tl; }, kill(){} }; return tl; },
  delayedCall: (seconds, fn) => { const id = setTimeout(fn, Math.max(0, seconds * 1000)); return { kill(){ clearTimeout(id); } }; },
  killTweensOf(){},
  registerPlugin(){},
  utils: { toArray: list },
  matchMedia: () => ({ add(query, fn){ if (!query || matchMedia(query).matches) fn(); return this; }, revert(){} }),
  ticker: { add(){}, remove(){}, lagSmoothing(){} }
};
export { gsap };
export default gsap;
`;
const SCROLL_TRIGGER_SHIM = `
const instances = [];
const ScrollTrigger = { create(options = {}) { const item = { ...options, kill(){ const i = instances.indexOf(item); if (i >= 0) instances.splice(i, 1); } }; instances.push(item); return item; }, update(){}, refresh(){}, getAll(){ return [...instances]; } };
export { ScrollTrigger };
export default ScrollTrigger;
`;
const GSAP_CLASSIC_SHIM = GSAP_SHIM.replace(/\nexport \{ gsap \};\nexport default gsap;\n?/g, '\nglobalThis.gsap = gsap;\n');
const SCROLL_TRIGGER_CLASSIC_SHIM = SCROLL_TRIGGER_SHIM.replace(/\nexport \{ ScrollTrigger \};\nexport default ScrollTrigger;\n?/g, '\nglobalThis.ScrollTrigger = ScrollTrigger;\n');
const BARBA_CLASSIC_SHIM = `
(function () {
  const hooks = {
    beforeLeave(fn) { this._beforeLeave = fn; return this; },
    afterEnter(fn) { this._afterEnter = fn; return this; },
    after(fn) { this._after = fn; return this; },
    before(fn) { this._before = fn; return this; }
  };
  globalThis.barba = {
    hooks,
    init(options) { this.options = options || {}; return this; },
    go() { return Promise.resolve(); }
  };
})();
`;
const EMPTY_CLASSIC_SHIM = '/* external runtime dependency omitted in local preview */';
const PREVIEW_SCROLLBAR_HIDE_STYLE = '<style data-local-hide-preview-scrollbars>*,*::before,*::after{scrollbar-width:none!important;-ms-overflow-style:none!important}*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}</style>';
const SCROLL_REGION_STYLE = '<style data-local-scroll-region>html,body{overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain!important}</style>';
const LENIS_SHIM = `
export default class Lenis { constructor(){ this.handlers = {}; } on(name, fn){ (this.handlers[name] ||= []).push(fn); return this; } raf(){} start(){} stop(){} destroy(){} scrollTo(target, options = {}){ if (options.immediate && typeof target === 'number') window.scrollTo(0, target); } }
`;

function transformModule(data) {
  return Buffer.from(data.toString('utf8')
    .replace(/from\s+(['"])gsap\1/g, "from '/vendor/gsap.js'")
    .replace(/from\s+(['"])gsap\/ScrollTrigger\1/g, "from '/vendor/gsap-scrolltrigger.js'")
    .replace(/from\s+(['"])lenis\1/g, "from '/vendor/lenis.js'"), 'utf8');
}

function transformExternalRuntimeRefs(html) {
  const replaceTagRef = (tag, kind, value) => {
    if (!/^(https?:)?\/\//i.test(value)) return tag;
    if (kind === 'script') {
      if (/barba/i.test(value)) return tag.replace(value, '/vendor/barba.js');
      if (/scrolltrigger/i.test(value)) return tag.replace(value, '/vendor/gsap-scrolltrigger-classic.js');
      if (/gsap/i.test(value)) return tag.replace(value, '/vendor/gsap-classic.js');
      return tag.replace(value, '/vendor/empty.js');
    }
    if (kind === 'link') return /fonts\.(googleapis|gstatic)\.com/i.test(value) ? '' : tag.replace(value, '#');
    if (kind === 'img' || kind === 'source') return tag.replace(value, MISSING_IMAGE);
    return tag.replace(value, '#');
  };
  html = html.replace(/<(script|link|img|video|source)\b[^>]*?(?:src|href)\s*=\s*(["'])(https?:\/\/[^"']+)\2[^>]*>/gi, (tag, element, _quote, value) => replaceTagRef(tag, element.toLowerCase(), value));
  return html.replace(/url\(\s*(["']?)(https?:\/\/[^)"']+)\1\s*\)/gi, `url("${MISSING_IMAGE}")`);
}

function libraryRelative(file) {
  return path.relative(LIBRARY, file).split(path.sep).join('/');
}

async function transformPreview(file, data) {
  let text = data.toString('utf8');
  if (file.endsWith(path.join('curved-arc-carousel', 'preview.html'))) {
    const componentFile = path.join(path.dirname(file), 'src', 'curved-arc-carousel.html');
    try {
      const componentHtml = await fs.readFile(componentFile, 'utf8');
    text = text.replace(/import htmlContent from ['"]\.\/src\/curved-arc-carousel\.html\?raw['"];\s*document\.getElementById\('componentRoot'\)\.innerHTML = htmlContent;/, `document.getElementById('componentRoot').innerHTML = ${JSON.stringify(componentHtml)};`);
    text = text.replace(/import Lenis from ['"]lenis['"];/, `const Lenis = globalThis.Lenis || class { constructor(){this.handlers={}} on(){} raf(){} };`);
    } catch {}
  }
  const isUiverse = libraryRelative(file).startsWith('Uiverse.io/');
  text = await repairMissingLocalRefs(file, text);
  text = transformExternalRuntimeRefs(text);
  const adapter = tailwindAdapter(text, isUiverse);
  const shell = isUiverse ? '<style data-local-preview-shell>html,body{width:100%;min-height:100%;}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.25rem;overflow:hidden;background:#f4f4f4;}</style>' : '';
  const styles = PREVIEW_SCROLLBAR_HIDE_STYLE + SCROLL_REGION_STYLE + adapter + shell;
  if (styles) text = text.includes('</body>') ? text.replace('</body>', `${styles}</body>`) : `${styles}${text}`;
  return Buffer.from(text, 'utf8');
}
async function serveFile(res, file, runtime = true) {
  try { let data = await fs.readFile(file); if (runtime && file.endsWith('.html')) data = await transformPreview(file, data); if (runtime && file.endsWith('.js')) data = transformModule(data); res.writeHead(200, {'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}

function zipComponent(res, component) {
  const tmp = path.join(DATA, `${component.id}.zip`);
  safePath(LIBRARY, component.directory);
  const child = spawn(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-a', '-c', '-f', tmp, '-C', LIBRARY, component.directory]);
  child.on('error', () => json(res, {error:'未找到系统 tar 工具'}, 500));
  child.on('close', async code => { if (code !== 0) return json(res, {error:'压缩失败'}, 500); const data = await fs.readFile(tmp); await fs.rm(tmp, {force:true}); res.writeHead(200, {'content-type':'application/zip', 'content-disposition':`attachment; filename="${component.id}.zip"`}); res.end(data); });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/vendor/gsap.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(GSAP_SHIM); }
    if (url.pathname === '/vendor/gsap-classic.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(GSAP_CLASSIC_SHIM); }
    if (url.pathname === '/vendor/gsap-scrolltrigger.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(SCROLL_TRIGGER_SHIM); }
    if (url.pathname === '/vendor/gsap-scrolltrigger-classic.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(SCROLL_TRIGGER_CLASSIC_SHIM); }
    if (url.pathname === '/vendor/barba.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(BARBA_CLASSIC_SHIM); }
    if (url.pathname === '/vendor/empty.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(EMPTY_CLASSIC_SHIM); }
    if (url.pathname === '/vendor/lenis.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}); return res.end(LENIS_SHIM); }
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, await loadSettings());
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const update = await readJsonBody(req);
      if (typeof update.gpuAcceleration !== 'boolean') return json(res, { error: 'gpuAcceleration 必须是布尔值' }, 400);
      return json(res, await saveSettings(update));
    }
    if (url.pathname === '/api/components') return json(res, await loadIndex());
    if (url.pathname === '/api/scan' && req.method === 'POST') return json(res, await scan());
    if (url.pathname.startsWith('/api/component/') && req.method === 'POST') {
      const id = url.pathname.slice('/api/component/'.length); const index = await loadIndex(); const component = index.components.find(x => x.id === id); if (!component) return json(res, {error:'组件不存在'}, 404);
      const update = await readJsonBody(req); const allowed = {}; if (typeof update.name === 'string') allowed.name = update.name.trim().slice(0, 160); if (typeof update.category === 'string') allowed.category = update.category.trim().slice(0, 80); if (Array.isArray(update.tags)) allowed.tags = update.tags.filter(x => typeof x === 'string').map(x => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
      let overrides = {}; try { overrides = JSON.parse(await fs.readFile(OVERRIDES_FILE, 'utf8')); } catch {} overrides[id] = {...(overrides[id] || {}), ...allowed}; await fs.writeFile(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8'); Object.assign(component, allowed); await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8'); return json(res, component);
    }
    if (url.pathname === '/api/download') { const index = await loadIndex(); const c = index.components.find(x => x.id === url.searchParams.get('id')); if (!c) return json(res, {error:'组件不存在'}, 404); return zipComponent(res, c); }
    if (url.pathname.startsWith('/preview/')) { const relative = decodeURIComponent(url.pathname.slice('/preview/'.length)); return serveFile(res, safePath(LIBRARY, relative), !url.searchParams.has('raw')); }
    const file = url.pathname === '/' ? path.join(SRC, 'index.html') : safePath(SRC, url.pathname.slice(1));
    return serveFile(res, file, false);
  } catch (e) { return json(res, {error: e.message}, 400); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`UI Library running at http://127.0.0.1:${PORT}`));
