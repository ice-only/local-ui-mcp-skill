import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, LIBRARY, INDEX_FILE, loadIndex, scan, safePath } from './library-core.mjs';

const MCP_PORT = Number(process.env.UI_LIBRARY_MCP_PORT || 49184);
const WEB_PORT = Number(process.env.UI_LIBRARY_PORT || 49183);
const PROTOCOL_VERSION = '2025-06-18';
const MODERN_PROTOCOL = '2026-07-28';
const HANDSHAKE_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const TEXT_EXTENSIONS = /\.(html?|css|scss|sass|js|mjs|ts|tsx|jsx|vue|json|md|txt|svg|yml|yaml)$/i;

const tools = [
  {
    name: 'scan_ui_library',
    title: 'Scan local UI library',
    description: 'Manually scan C:/E/ui/library, detect UI entries, categories, source files, additions, updates, removals, and scan errors.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'search_ui_components',
    title: 'Search UI components',
    description: 'Search local UI metadata and source text using keywords. Vector search and external models are not used.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword(s) to search in name, category, tags, path, and source files.' },
        category: { type: 'string', description: 'Optional exact category filter.' },
        tag: { type: 'string', description: 'Optional exact tag filter.' },
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        includeSource: { type: 'boolean', default: false, description: 'Include a short matching source snippet.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'get_ui_component',
    title: 'Get UI component metadata',
    description: 'Read one indexed UI component by its stable id or source path.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sourcePath: { type: 'string' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'get_ui_source',
    title: 'Read UI source',
    description: 'Read the raw source of an indexed UI component or one of its associated files.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sourcePath: { type: 'string' },
        file: { type: 'string', description: 'Optional associated file path relative to C:/E/ui/library.' },
        maxChars: { type: 'integer', minimum: 1000, maximum: 500000, default: 120000 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'get_ui_preview',
    title: 'Get UI preview',
    description: 'Return the local browser preview URL and the raw preview entry HTML for an indexed component.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sourcePath: { type: 'string' },
        maxChars: { type: 'integer', minimum: 1000, maximum: 500000, default: 120000 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'find_similar_components',
    title: 'Find similar UI components',
    description: 'Recommend similar UI components with lexical overlap across names, categories, tags, paths, frameworks, and source tokens. No vectorization is used.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Use an indexed component as the similarity basis.' },
        sourcePath: { type: 'string', description: 'Use an indexed source path as the similarity basis.' },
        query: { type: 'string', description: 'Use free-text keywords when id/sourcePath is not supplied.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'get_library_status',
    title: 'Get UI library status',
    description: 'Return the local index status, component count, category counts, and current search capabilities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];

function tokens(value = '') {
  return [...new Set(String(value).toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])];
}

function text(value = '') { return String(value).toLocaleLowerCase(); }

function componentText(component) {
  return text([
    component.name,
    component.category,
    ...(component.tags || []),
    component.sourcePath,
    component.directory,
    component.author,
    component.framework
  ].join(' '));
}

function publicComponent(component) {
  return {
    id: component.id,
    name: component.name,
    category: component.category,
    tags: component.tags || [],
    sourcePath: component.sourcePath,
    directory: component.directory,
    author: component.author || '',
    framework: component.framework,
    size: component.size,
    modified: component.modified,
    files: component.files || [],
    previewUrl: previewUrl(component.sourcePath)
  };
}

function previewUrl(sourcePath) {
  return `http://127.0.0.1:${WEB_PORT}/preview/${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
}

function componentByRef(components, args = {}) {
  const id = typeof args.id === 'string' ? args.id : '';
  const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath.replaceAll('\\', '/') : '';
  return components.find(component => (id && component.id === id) || (sourcePath && component.sourcePath === sourcePath));
}

function clampChars(value, fallback = 120000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1000, Math.min(500000, Math.floor(number)));
}

async function readText(relative) {
  const file = safePath(LIBRARY, relative);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('不是文件');
  return fs.readFile(file, 'utf8');
}

function isTextFile(file = '') { return TEXT_EXTENSIONS.test(file); }

async function sourceForComponent(component, requestedFile) {
  const file = requestedFile ? requestedFile.replaceAll('\\', '/') : component.sourcePath;
  if (file !== component.sourcePath && !(component.files || []).includes(file)) throw new Error('文件不属于指定组件');
  if (!isTextFile(file)) throw new Error('该文件不是可读取的文本源码');
  return { file, content: await readText(file) };
}

function sourceSnippet(content, query) {
  const terms = tokens(query);
  const lower = text(content);
  const index = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (index === undefined) return '';
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + 260);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ')}${end < content.length ? '…' : ''}`;
}

async function sourceMatch(component, query, includeSnippet = false) {
  const terms = tokens(query);
  if (!terms.length) return { matched: false, score: 0, snippet: '' };
  let score = 0;
  let snippet = '';
  for (const file of component.files || [component.sourcePath]) {
    if (!isTextFile(file)) continue;
    try {
      const content = await readText(file);
      const lower = text(content);
      const matchedTerms = terms.filter(term => lower.includes(term));
      if (matchedTerms.length) score = Math.max(score, matchedTerms.length * 4);
      if (matchedTerms.length === terms.length) {
        if (includeSnippet) snippet = sourceSnippet(content, query);
        return { matched: true, score, snippet };
      }
    } catch {}
  }
  return { matched: false, score, snippet };
}

async function searchComponents(args = {}) {
  const index = await loadIndex();
  const components = index.components || [];
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const terms = tokens(query);
  const category = typeof args.category === 'string' ? args.category.trim() : '';
  const tag = typeof args.tag === 'string' ? args.tag.trim() : '';
  const page = Math.max(1, Number.isFinite(Number(args.page)) ? Math.floor(Number(args.page)) : 1);
  const limit = Math.max(1, Math.min(100, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 20));
  const includeSource = args.includeSource === true;
  const matches = [];

  for (const component of components) {
    if (category && component.category !== category) continue;
    if (tag && !(component.tags || []).includes(tag)) continue;
    const metadata = componentText(component);
    const metadataHits = terms.filter(term => metadata.includes(term));
    const metadataMatch = !terms.length || metadataHits.length === terms.length;
    let source = { matched: false, score: 0, snippet: '' };
    if (terms.length && !metadataMatch) source = await sourceMatch(component, query, includeSource);
    if (terms.length && !metadataMatch && !source.matched) continue;
    matches.push({
      ...publicComponent(component),
      score: terms.length ? metadataHits.length * 10 + source.score : 0,
      match: source.matched ? 'source' : 'metadata',
      ...(includeSource && source.snippet ? { snippet: source.snippet } : {})
    });
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const start = (page - 1) * limit;
  return {
    query,
    category: category || null,
    tag: tag || null,
    page,
    limit,
    total: matches.length,
    searchMode: 'metadata+source-text',
    vectorSearch: false,
    results: matches.slice(start, start + limit)
  };
}

function similarityTerms(component, query) {
  return new Set(tokens(query || [component.name, component.category, ...(component.tags || []), component.sourcePath, component.framework].join(' ')));
}

async function findSimilar(args = {}) {
  const index = await loadIndex();
  const components = index.components || [];
  const base = componentByRef(components, args);
  if (!base && !String(args.query || '').trim()) throw new Error('需要提供 id、sourcePath 或 query');
  const basis = base ? [base.name, base.category, ...(base.tags || []), base.sourcePath, base.framework].join(' ') : String(args.query);
  const basisTerms = similarityTerms(base, basis);
  const baseCategory = base?.category;
  const baseTags = new Set(base?.tags || []);
  const limit = Math.max(1, Math.min(50, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 12));
  const results = components.filter(component => component.id !== base?.id).map(component => {
    const candidateTerms = similarityTerms(component, '');
    const overlap = [...basisTerms].filter(term => candidateTerms.has(term)).length;
    const categoryScore = baseCategory && component.category === baseCategory ? 5 : 0;
    const tagScore = [...baseTags].filter(tag => (component.tags || []).includes(tag)).length * 3;
    const frameworkScore = base?.framework && component.framework === base.framework ? 1 : 0;
    return { ...publicComponent(component), score: overlap * 2 + categoryScore + tagScore + frameworkScore };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    basis: base ? publicComponent(base) : { query: String(args.query).trim() },
    method: 'lexical metadata similarity',
    vectorSearch: false,
    total: results.length,
    results: results.slice(0, limit)
  };
}

async function callTool(name, args = {}) {
  if (name === 'scan_ui_library') {
    const result = await scan();
    return { generatedAt: result.generatedAt, library: result.library, total: result.total, stats: result.stats, errors: result.errors.slice(0, 100) };
  }
  if (name === 'search_ui_components') return searchComponents(args);
  if (name === 'find_similar_components') return findSimilar(args);
  const index = await loadIndex();
  const components = index.components || [];
  if (name === 'get_library_status') {
    const categories = {};
    const frameworks = {};
    for (const component of components) {
      categories[component.category] = (categories[component.category] || 0) + 1;
      frameworks[component.framework] = (frameworks[component.framework] || 0) + 1;
    }
    return { library: LIBRARY, indexFile: INDEX_FILE, generatedAt: index.generatedAt || null, total: components.length, categories, frameworks, capabilities: { metadataSearch: true, sourceSearch: true, lexicalSimilarity: true, vectorSearch: false, ollama: false } };
  }
  const component = componentByRef(components, args);
  if (!component) throw new Error('找不到指定 UI 组件，请提供正确的 id 或 sourcePath');
  if (name === 'get_ui_component') return publicComponent(component);
  if (name === 'get_ui_source') {
    const source = await sourceForComponent(component, args.file);
    const maxChars = clampChars(args.maxChars);
    return { component: publicComponent(component), file: source.file, content: source.content.slice(0, maxChars), truncated: source.content.length > maxChars, length: source.content.length };
  }
  if (name === 'get_ui_preview') {
    const source = await sourceForComponent(component);
    const maxChars = clampChars(args.maxChars);
    return { component: publicComponent(component), previewUrl: previewUrl(component.sourcePath), file: source.file, html: source.content.slice(0, maxChars), truncated: source.content.length > maxChars, length: source.content.length, note: 'previewUrl 需要本地 UI Library 网站服务运行；html 为原始入口源码。' };
  }
  throw new Error(`未知工具：${name}`);
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message, data) { return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
const serverCapabilities = { tools: { listChanged: false } };
const serverInstructions = '本地 UI 资源库 MCP。当前使用 JSON 索引、关键词检索、源码全文检索和词法相似推荐，不使用 Ollama 或向量数据库。';

export async function handleRpc(message) {
  if (!message || message.jsonrpc !== '2.0') return rpcError(message?.id ?? null, -32600, 'Invalid Request');
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return null;
  const id = message.id ?? null;
  try {
    if (message.method === 'server/discover') {
      return rpcResult(id, { supportedVersions: SUPPORTED_PROTOCOLS, capabilities: serverCapabilities, instructions: serverInstructions, resultType: 'complete' });
    }
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: HANDSHAKE_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: serverCapabilities,
        serverInfo: { name: 'local-ui-library', version: '0.2.0' },
        instructions: serverInstructions
      });
    }
    if (message.method === 'ping') return rpcResult(id, {});
    if (message.method === 'tools/list') return rpcResult(id, { tools, ...(message.params?._meta?.['io.modelcontextprotocol/protocolVersion'] === MODERN_PROTOCOL ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}) });
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (!tools.some(tool => tool.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const structured = await callTool(name, message.params?.arguments || {});
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError: false });
      } catch (error) {
        const detail = { error: error.message || String(error) };
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(detail) }], structuredContent: detail, isError: true });
      }
    }
    if (message.method === 'resources/list') return rpcResult(id, { resources: [], ...(message.params?._meta?.['io.modelcontextprotocol/protocolVersion'] === MODERN_PROTOCOL ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}) });
    return rpcError(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    return rpcError(id, -32603, error.message || String(error));
  }
}

async function readRequestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4 * 1024 * 1024) throw new Error('请求体过大');
  }
  return body ? JSON.parse(body) : null;
}

function writeJson(res, value, status = 200, protocolVersion = PROTOCOL_VERSION) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'MCP-Protocol-Version': protocolVersion,
    'access-control-allow-origin': 'http://127.0.0.1',
    'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

export function createMcpHttpServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': 'http://127.0.0.1', 'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }
    if (req.method === 'GET' && req.url === '/health') return writeJson(res, { ok: true, transport: 'streamable-http-json', protocolVersion: PROTOCOL_VERSION, vectorSearch: false });
    if (req.method !== 'POST' || new URL(req.url, 'http://127.0.0.1').pathname !== '/mcp') { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Not found' })); }
    try {
      const request = await readRequestBody(req);
      const requestProtocol = req.headers['mcp-protocol-version'] === MODERN_PROTOCOL || request?.method === 'server/discover' ? MODERN_PROTOCOL : PROTOCOL_VERSION;
      if (Array.isArray(request)) {
        const responses = [];
        for (const item of request) { const response = await handleRpc(item); if (response) responses.push(response); }
        if (!responses.length) { res.writeHead(202); return res.end(); }
        return writeJson(res, responses, 200, requestProtocol);
      }
      const response = await handleRpc(request);
      if (!response) { res.writeHead(202); return res.end(); }
      return writeJson(res, response, 200, requestProtocol);
    } catch (error) {
      return writeJson(res, rpcError(null, -32700, error.message || 'Parse error'), 400);
    }
  });
}

export function startStdio() {
  let buffer = '';
  let queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let response;
        try { response = await handleRpc(JSON.parse(line)); }
        catch (error) { response = rpcError(null, -32700, error.message || 'Parse error'); }
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      });
    }
  });
  process.stdin.on('end', () => { queue.finally(() => process.exit(0)); });
}

export function startHttp(port = MCP_PORT) {
  const server = createMcpHttpServer();
  server.listen(port, '127.0.0.1', () => console.error(`Local UI Library MCP HTTP running at http://127.0.0.1:${port}/mcp`));
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes('--http')) startHttp();
  else startStdio();
}

