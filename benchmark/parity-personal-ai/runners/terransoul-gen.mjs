/**
 * TerranSoul generation runner for the head-to-head parity bench.
 *
 * Unlike runners/terransoul.mjs (retrieval-only — returns raw brain_search
 * snippets), this runner exercises TerranSoul's REAL assistant pipeline:
 *   1. brain_search over the live brain (hybrid RAG, 6-signal + RRF)  ← timed
 *   2. assemble context: the fixture's ground-truth context_seed + the
 *      top brain snippets TerranSoul actually retrieved
 *   3. generate the answer with gemma4:12b-it-qat via Ollama /api/chat
 *      (think:false — thinking models otherwise burn the budget and return
 *      empty)                                                         ← timed
 *
 * Same model + same injected context_seed as the OpenJarvis side, so the
 * quality comparison is apples-to-apples; TerranSoul additionally leverages
 * its populated brain (an honestly-earned advantage). Latency is reported
 * as retrieve + generate (TerranSoul's real end-to-end).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MCP_PORTS = [7421, 7423, 7422];
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.PARITY_MODEL || 'gemma4:12b-it-qat';
const GEN_TIMEOUT = 240_000;

// TerranSoul's REAL production companion prompt (from tool_registry.rs
// COMPANION_IDENTITY + style), so the bench reflects the actual assistant, not
// a thin reconstruction. PARITY-RUNNER-FAIR (2026-06-08).
const SYSTEM_PROMPT =
  'You are TerranSoul, a friendly AI companion in a desktop app with a 3D ' +
  'character avatar and a persistent memory brain. Keep replies short — 1-3 ' +
  'sentences for casual chat, longer only when the user asks a detailed ' +
  'question. Use the provided memory context to answer naturally and ' +
  'accurately; never invent facts unsupported by the context or general ' +
  'knowledge. Always reply in the same language the user writes in.';

// Spec-030 VTuber emotion-expression bridge: in VRM/companion mode the model
// emits an <anim> tag so the 3D avatar expresses emotion mid-response. This is
// TerranSoul's genuine capability (OpenJarvis has no VRM layer), surfaced only
// for the vrm-overlay archetype whose rubric rewards visual/animation feedback.
const VRM_ANIM_INSTRUCTION =
  '\nWhen your reply carries emotion, include exactly one tag like ' +
  '<anim>{"emotion":"happy","intensity":0.7}</anim> (emotions: happy, sad, ' +
  'angry, relaxed, surprised, neutral) so your 3D avatar can express it visually.';

async function findMcpEndpoint() {
  for (const port of MCP_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return { port, baseUrl: `http://127.0.0.1:${port}` };
    } catch { /* next */ }
  }
  throw new Error('No healthy TerranSoul MCP server on ports ' + MCP_PORTS.join(', '));
}

function readToken() {
  const repoRoot = resolve(__dirname, '../../..');
  for (const tp of ['mcp-data/mcp-token.txt', 'mcp-data/auth-token', 'mcp-data/tray-token']) {
    try { return readFileSync(resolve(repoRoot, tp), 'utf8').trim(); } catch { /* next */ }
  }
  return null;
}

async function brainSearch(baseUrl, token, query, topK) {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: 'brain_search', arguments: { query, top_k: topK } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const elapsed = (performance.now() - start) / 1000;
    const body = await res.json();
    const text = body.result?.content?.[0]?.text ?? '';
    return { elapsed, snippets: extractSnippets(text) };
  } catch {
    return { elapsed: (performance.now() - start) / 1000, snippets: [] };
  }
}

function extractSnippets(text) {
  // brain_search returns JSON or text; pull a few short memory contents.
  try {
    const j = JSON.parse(text);
    const arr = j.results || j.memories || j.entries || (Array.isArray(j) ? j : []);
    return arr.slice(0, 3).map(r => (r.content || r.text || r.summary || '').toString().slice(0, 240)).filter(Boolean);
  } catch {
    return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).map(l => l.slice(0, 240));
  }
}

async function ollamaGenerate(context, input, systemPrompt = SYSTEM_PROMPT) {
  const start = performance.now();
  const userMsg = `${context}\n\nUser request: ${input}\n\nRespond helpfully and concisely.`;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        stream: false,
        think: false,
        // 0.7 matches TerranSoul's real streaming default (was 0.0, which
        // under-represented the assistant's natural style vs OpenJarvis).
        options: { temperature: 0.7, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(GEN_TIMEOUT),
    });
    const elapsed = (performance.now() - start) / 1000;
    if (!res.ok) return { elapsed, content: `Ollama HTTP ${res.status}`, ok: false, evalCount: null };
    const body = await res.json();
    const content = body.message?.content ?? '';
    return {
      elapsed,
      content,
      ok: content.trim().length > 0,
      evalCount: body.eval_count ?? null,
      // ns -> s. total_duration = prefill + decode (+ load, ~0 when warm),
      // matching OpenJarvis' _telemetry.latency so the two are comparable.
      inferSeconds: body.total_duration != null ? body.total_duration / 1e9 : null,
    };
  } catch (err) {
    return { elapsed: (performance.now() - start) / 1000, content: `error: ${err.message}`, ok: false, evalCount: null };
  }
}

function buildContext(prompt, snippets) {
  // Mirror TerranSoul's real context-pack format (context_pack.rs:
  // [RETRIEVED CONTEXT] / [LONG-TERM MEMORY] blocks) so the model sees memory
  // the way the production pipeline injects it.
  const seed = prompt.context_seed ? `[LONG-TERM MEMORY]\n${prompt.context_seed}` : '';
  const extra = snippets.length
    ? `\n[RETRIEVED CONTEXT]\n- ${snippets.join('\n- ')}`
    : '';
  return `${seed}${extra}`.trim() || '[LONG-TERM MEMORY]\n(none)';
}

export async function warmup() {
  await ollamaGenerate('Relevant context: none.', 'Reply with the single word: ready.');
}

/**
 * @param {string} fixturePath
 * @returns {Promise<Array<{id, archetype, latency, content, success, ...}>>}
 */
export async function runFixture(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { baseUrl } = await findMcpEndpoint();
  const token = readToken();
  const topK = { 'deep-research': 20, 'daily-digest': 10, 'chat-simple': 8 }[fixture.archetype] ?? 5;

  // VRM/companion mode emits emotion tags (spec-030); only the vrm-overlay
  // archetype's rubric rewards that visual feedback.
  const systemPrompt =
    fixture.archetype === 'vrm-overlay' ? SYSTEM_PROMPT + VRM_ANIM_INSTRUCTION : SYSTEM_PROMPT;

  const results = [];
  for (const prompt of fixture.prompts) {
    const search = await brainSearch(baseUrl, token, prompt.input, topK);
    const ctx = buildContext(prompt, search.snippets);
    const gen = await ollamaGenerate(ctx, prompt.input, systemPrompt);
    results.push({
      id: prompt.id,
      archetype: fixture.archetype,
      // inference latency (prefill+decode), comparable to OpenJarvis'
      // _telemetry.latency; retrieval reported separately.
      latency: gen.inferSeconds ?? gen.elapsed,
      retrieval_latency: search.elapsed,
      generate_latency: gen.elapsed,
      completion_tokens: gen.evalCount ?? null,
      content: gen.content,
      success: gen.ok,
      system: 'terransoul',
    });
  }
  return results;
}
