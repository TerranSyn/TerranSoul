// Minimal one-shot MCP tools/call client (streamable HTTP) — mirrors
// tmp/mcp-call.mjs's initialize -> notifications/initialized -> tools/call
// handshake, as an importable function instead of a CLI script.
//
// GENERIC ON PURPOSE: tool name + arguments are entirely caller-supplied.
// This module has no idea what a "Boeing 747" or an "actor edit" is — it
// only speaks the MCP wire protocol — so it is reusable by any future
// bench/harness loop that wants to read from or write to TerranSoul's brain
// (rules/brain-driven-self-improvement.md, rules/bench-agi-purity.md: the
// CODE that builds and sends an MCP call must not encode domain knowledge,
// only the content a caller supplies may be domain-specific).
//
// Fail-open by design for autonomous bench loops
// (rules/harness-reasoning-engineering.md): a brain that is down or
// unreachable must never crash or hang a multi-hour bench loop merely
// because a self-learning read/write could not complete. Callers get
// `{ok:false, error}` and decide what to do next (skip the prior-attempts
// context, skip the lesson ingest) — this module only throws if `strict:true`
// is explicitly requested.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LIB_DIR, '..', '..', '..');

const DEFAULT_MCP_URL = 'http://127.0.0.1:7423/mcp';
const DEFAULT_TIMEOUT_MS = 8000;

function resolveToken() {
  if (process.env.TERRANSOUL_MCP_TOKEN_MCP) return process.env.TERRANSOUL_MCP_TOKEN_MCP;
  for (const rel of ['mcp-data/mcp-token.txt', '.vscode/.mcp-token']) {
    try {
      const token = readFileSync(path.join(REPO_ROOT, rel), 'utf8').trim();
      if (token) return token;
    } catch {
      // try the next candidate
    }
  }
  return '';
}

/** Streamable HTTP may answer as SSE ("event: message\ndata: {...}") or plain JSON. */
function parseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const out = [];
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) out.push(JSON.parse(line.slice(5).trim()));
  }
  return out.length === 1 ? out[0] : out;
}

async function rpc(base, token, method, params, id, sessionId, timeoutMs) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const body = { jsonrpc: '2.0', method };
  if (params !== undefined) body.params = params;
  if (id !== undefined) body.id = id;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const newSession = res.headers.get('mcp-session-id') || sessionId;
    const text = await res.text();
    return { status: res.status, sessionId: newSession, body: text ? parseBody(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call ONE MCP tool over the streamable-HTTP tray and return its parsed text
 * content. Never throws unless `strict:true`.
 * @param {string} toolName
 * @param {Record<string, unknown>} [args]
 * @param {{mcpUrl?:string, token?:string, timeoutMs?:number, strict?:boolean}} [opts]
 * @returns {Promise<{ok:boolean, text:string|null, error?:string}>}
 */
export async function callMcpTool(toolName, args = {}, opts = {}) {
  const base = opts.mcpUrl || process.env.TERRANSOUL_MCP_URL || DEFAULT_MCP_URL;
  const token = opts.token ?? resolveToken();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const init = await rpc(
      base,
      token,
      'initialize',
      { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'terransoul-bench-harness', version: '1.0.0' } },
      1,
      undefined,
      timeoutMs,
    );
    if (init.status >= 400) throw new Error(`initialize failed (${init.status}): ${JSON.stringify(init.body)}`);
    await rpc(base, token, 'notifications/initialized', {}, undefined, init.sessionId, timeoutMs);
    const call = await rpc(base, token, 'tools/call', { name: toolName, arguments: args }, 2, init.sessionId, timeoutMs);
    if (call.status >= 400) throw new Error(`tools/call ${toolName} failed (${call.status}): ${JSON.stringify(call.body)}`);
    const result = call.body?.result ?? call.body;
    const texts = (result?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text);
    return { ok: true, text: texts.length > 0 ? texts.join('\n') : null };
  } catch (err) {
    if (opts.strict) throw err;
    return { ok: false, text: null, error: String(err.message || err) };
  }
}
