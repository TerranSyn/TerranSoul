/**
 * OpenClaw runner — parity head-to-head.
 *
 * Runs the REAL OpenClaw CLI (`openclaw agent --local`) on the SAME local
 * Ollama model (gemma4:12b-it-qat) + the SAME injected context_seed as the
 * other systems, so the comparison isolates the assistant pipeline, not the
 * model. Mirrors the warmup()/runFixture() interface of openjarvis.mjs.
 *
 * Prereq — an isolated, ollama-configured profile (default `bench`):
 *   openclaw --profile bench config set agents.defaults.model "ollama/gemma4:12b-it-qat"
 *   openclaw --profile bench config set models.providers.ollama.apiKey "ollama-local"
 *   openclaw --profile bench config set models.providers.ollama.baseUrl "http://127.0.0.1:11434/v1"
 *
 * Spawned as `node <openclaw.mjs>` because the npm global shim is a .cmd that
 * Node 24 refuses to execFile directly. The bench profile's memory is empty,
 * so OpenClaw's agent tools surface nothing — the scored output is its answer
 * at equal injected context. Latency is wall-clock (includes CLI cold-start,
 * an artifact of invocation — see the OpenJarvis runner header for the same caveat).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const PROFILE = process.env.OPENCLAW_BENCH_PROFILE || 'bench';
// resolveEntry(): prefer an explicit override, then the source-built monorepo
// entry (pnpm build → dist/entry.js behind openclaw.mjs), then the npm-global
// shim. Machine-local build artifact resolved by this path-fallback chain.
function resolveEntry() {
  const candidates = [
    process.env.OPENCLAW_ENTRY,
    'D:/Git/openclaw/openclaw.mjs',
    join(process.env.APPDATA || '', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || candidates[candidates.length - 1] || '';
}
const ENTRY = resolveEntry();
const TIMEOUT = 240_000;

/** First complete JSON object from noisy stdout (brace-matched). */
function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

function ask(query, sid) {
  const args = [ENTRY, '--profile', PROFILE, 'agent', '--local', '--session-id', sid,
    '--message', query, '--json', '--thinking', 'off'];
  // Inject OLLAMA_API_KEY so OpenClaw treats the local Ollama host as authed.
  // The `bench` profile config (~/.openclaw-bench/openclaw.json) carries the
  // REQUIRED models.providers.ollama.params.num_ctx=32768 — at the default ctx
  // OpenClaw's ~16K-token system prompt + ~39 tool schemas fills the window, the
  // model returns done_reason="length" after 1 token, and OpenClaw discards the
  // answer as incomplete_turn. num_ctx=32768 restores done_reason="stop".
  const env = { ...process.env, OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || 'ollama-local' };
  return new Promise((res) => {
    const t0 = performance.now();
    execFile(process.execPath, args, { env, timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const wall = (performance.now() - t0) / 1000;
        const j = extractJson(`${stdout || ''}\n${stderr || ''}`);
        const text = j && Array.isArray(j.payloads)
          ? j.payloads.map((p) => (p && typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n').trim()
          : '';
        res({
          success: text.length > 0,
          content: text || ((err ? `exec error: ${err.message}; ` : '') + String(stderr || stdout || '').slice(-300)),
          latency: wall, wall,
        });
      });
  });
}

function buildQuery(p) {
  const ctx = p.context_seed ? `Relevant context from memory:\n${p.context_seed}\n\n` : '';
  return `${ctx}User request: ${p.input}\n\nRespond helpfully and concisely.`;
}

export async function warmup() {
  if (!existsSync(ENTRY)) throw new Error(`OpenClaw entry not found: ${ENTRY} (set OPENCLAW_ENTRY)`);
  await ask('Reply with the single word: ready', 'oc-warmup');
}

export async function runFixture(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const results = [];
  for (const prompt of fixture.prompts) {
    const r = await ask(buildQuery(prompt), `oc-${prompt.id}`);
    results.push({
      id: prompt.id, archetype: fixture.archetype,
      latency: r.latency, wall: r.wall, content: r.content, success: r.success,
      system: 'openclaw',
    });
  }
  return results;
}

export { buildQuery };
