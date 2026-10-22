import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createMcpHttpServer, handleRpc } from './mcp-server.mjs';

const response = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
assert.equal(response.result.serverInfo.name, 'local-ui-library');
const discovery = await handleRpc({ jsonrpc: '2.0', id: 11, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
assert.ok(discovery.result.supportedVersions.includes('2026-07-28'));
assert.equal(discovery.result.resultType, 'complete');

const listed = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const toolNames = listed.result.tools.map(tool => tool.name);
for (const required of ['scan_ui_library', 'search_ui_components', 'get_ui_component', 'get_ui_source', 'get_ui_preview', 'find_similar_components']) assert.ok(toolNames.includes(required), `缺少 MCP 工具：${required}`);

const status = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_library_status', arguments: {} } });
assert.equal(status.result.isError, false);
assert.ok(status.result.structuredContent.total > 0);

const search = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_ui_components', arguments: { query: 'button', limit: 3, includeSource: true } } });
assert.equal(search.result.isError, false);
assert.ok(search.result.structuredContent.results.length > 0);
const first = search.result.structuredContent.results[0];
const source = await handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_ui_source', arguments: { id: first.id, maxChars: 2000 } } });
assert.equal(source.result.isError, false);
assert.ok(source.result.structuredContent.content.length > 0);
const preview = await handleRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_ui_preview', arguments: { id: first.id, maxChars: 2000 } } });
assert.equal(preview.result.isError, false);
assert.match(preview.result.structuredContent.previewUrl, /^http:\/\/127\.0\.0\.1:/);
const similar = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'find_similar_components', arguments: { id: first.id, limit: 3 } } });
assert.equal(similar.result.isError, false);

const rescanned = await handleRpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'scan_ui_library', arguments: {} } });
assert.equal(rescanned.result.isError, false);
assert.equal(rescanned.result.structuredContent.total, status.result.structuredContent.total);

const child = spawn(process.execPath, ['mcp-server.mjs'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => { output += chunk; });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} }) + '\n');
for (let i = 0; i < 50 && !output.includes('\n'); i++) await new Promise(resolve => setTimeout(resolve, 20));
assert.ok(output.includes('"jsonrpc":"2.0"'), 'stdio MCP 没有返回 JSON-RPC 响应');
child.stdin.end();
await once(child, 'close');

const httpServer = createMcpHttpServer();
await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
const address = httpServer.address();
const httpResponse = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'ping', params: {} }) });
assert.equal(httpResponse.status, 200);
assert.equal((await httpResponse.json()).result !== undefined, true);
const httpDiscovery = await fetch(`http://127.0.0.1:${address.port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover', 'Mcp-Name': 'local-ui-library-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }) });
assert.equal(httpDiscovery.headers.get('mcp-protocol-version'), '2026-07-28');
assert.ok((await httpDiscovery.json()).result.supportedVersions.includes('2026-07-28'));
await new Promise(resolve => httpServer.close(resolve));

console.log(JSON.stringify({ ok: true, tools: toolNames.length, stdio: true, http: true, indexed: status.result.structuredContent.total, source: true, preview: true, similar: true, scan: true }));
