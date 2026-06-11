/**
 * OpenJarvis Runner — executes the parity prompts through the OpenJarvis CLI.
 *
 * Mirrors the runFixture/warmup interface of terransoul.mjs so the
 * head-to-head orchestrator (run-headtohead.mjs) can drive both systems
 * through the same fixtures + judge.
 *
 * OpenJarvis (Stanford, Apache-2.0) is installed at $OPENJARVIS_HOME
 * (default %LOCALAPPDATA%\OpenJarvis) and invoked via `uv run jarvis ask`.
 * It uses the SAME local Ollama (127.0.0.1:11434) and the SAME model
 * (gemma4:12b-it-qat) as the TerranSoul side, so the comparison isolates
 * the assistant pipeline, not the model.
 *
 * Fairness protocol (see run-headtohead.mjs header):
 *  - Single generation pass, direct-to-engine (`--agent ''`) so both systems
 *    do one inference over the SAME injected context (the fixture's
 *    context_seed). OpenJarvis' own memory store is empty, so `--no-context`
 *    avoids polluting the comparison with an unseeded retrieval.
 *  - Latency reported is OpenJarvis' own inference latency (_telemetry.latency),
 *    NOT wall-clock — wall-clock would unfairly include the `uv` subprocess
 *    cold-start, an artifact of CLI invocation (a deployed OpenJarvis runs as
 *    a resident FastAPI server).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = process.env.PARITY_MODEL || 'gemma4:12b-it-qat';
const PER_CALL_TIMEOUT = 240_000; // 12B can be slow on first decode
const MAX_TOKENS = 512;

function openjarvisHome() {
  if (process.env.OPENJARVIS_HOME) return process.env.OPENJARVIS_HOME;
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(local, 'OpenJarvis');
}

function uvBin() {
  if (process.env.UV_BIN && existsSync(process.env.UV_BIN)) return process.env.UV_BIN;
  const candidate = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (existsSync(candidate)) return candidate;
  return 'uv'; // assume on PATH
}

/**
 * Extract the first complete JSON object from a noisy stdout string
 * (OpenJarvis prints a version notice / banner before the JSON and a
 * profile table after it). Brace-matches from the first '{'.
 */
function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function jarvisAsk(query) {
  const OJ = openjarvisHome();
  const uv = uvBin();
  const args = [
    'run', '--project', OJ, 'jarvis', 'ask', query,
    '-m', MODEL,
    '--no-stream',
    '--no-context',      // OJ memory is empty; context is injected inline
    '--agent', '',       // direct-to-engine: single inference pass
    '--json', '--profile',
    '--max-tokens', String(MAX_TOKENS),
  ];
  return new Promise((resolveP) => {
    const t0 = performance.now();
    execFile(uv, args, { timeout: PER_CALL_TIMEOUT, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const wall = (performance.now() - t0) / 1000;
        const out = `${stdout || ''}\n${stderr || ''}`;
        const j = extractJson(out);
        if (!j || typeof j.content !== 'string') {
          resolveP({
            success: false,
            content: (err ? `exec error: ${err.message}; ` : '') + out.slice(-400),
            latency: wall, wall,
          });
          return;
        }
        const tel = j._telemetry || {};
        resolveP({
          success: j.content.trim().length > 0,
          content: j.content,
          // inference latency (excludes uv cold-start); fall back to wall
          latency: typeof tel.latency === 'number' && tel.latency > 0 ? tel.latency : wall,
          wall,
          ttft: tel.ttft ?? null,
          completion_tokens: j.usage?.completion_tokens ?? null,
          throughput: tel.throughput_tok_per_sec ?? null,
          energy_joules: tel.energy_joules || null, // 0/null on GPUs w/o power telemetry
          model: j.model || MODEL,
        });
      });
  });
}

/** Build the injected-context query (same shape both systems receive). */
function buildQuery(prompt) {
  const ctx = prompt.context_seed ? `Relevant context from memory:\n${prompt.context_seed}\n\n` : '';
  return `${ctx}User request: ${prompt.input}\n\nRespond helpfully and concisely.`;
}

export async function warmup() {
  await jarvisAsk('Reply with the single word: ready.');
}

/**
 * Run all prompts from a fixture file through OpenJarvis.
 * @param {string} fixturePath
 * @returns {Promise<Array<{id, archetype, latency, content, success, ...}>>}
 */
export async function runFixture(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const results = [];
  for (const prompt of fixture.prompts) {
    const r = await jarvisAsk(buildQuery(prompt));
    results.push({
      id: prompt.id,
      archetype: fixture.archetype,
      latency: r.latency,
      wall: r.wall,
      ttft: r.ttft ?? null,
      completion_tokens: r.completion_tokens ?? null,
      throughput: r.throughput ?? null,
      energy_joules: r.energy_joules ?? null,
      content: r.content,
      success: r.success,
      system: 'openjarvis',
    });
  }
  return results;
}

export { buildQuery, openjarvisHome, uvBin };
