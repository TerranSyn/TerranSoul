/**
 * Hermes-Agent runner — parity head-to-head.
 *
 * Runs the REAL Hermes CLI one-shot (`hermes -z "…"`) on the SAME local Ollama
 * model (gemma4:12b-it-qat, via Hermes's generic `custom` provider) + the SAME
 * injected context_seed as the other systems. Mirrors openjarvis.mjs's
 * warmup()/runFixture() interface.
 *
 * Prereq — an isolated, ollama-configured Hermes home, pointed at via
 * HERMES_BENCH_HOME (so the user's real ~/AppData/Local/hermes config is never
 * touched). That home's config.yaml must set:
 *   model.provider = custom
 *   model.base_url = http://127.0.0.1:11434/v1
 *   model.default  = gemma4:12b-it-qat
 *   model.api_key  = ollama   (dummy; Ollama ignores it)
 *
 * Tools are disabled (`-t ''`) for a single answer pass at equal context.
 * Latency is wall-clock (includes the Python CLI cold-start — an artifact of
 * invocation; quality is the apples-to-apples metric).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const HERMES_EXE = process.env.HERMES_EXE
  || join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe');
const HOME = process.env.HERMES_BENCH_HOME || '';
const TIMEOUT = 240_000;

function ask(query) {
  const env = { ...process.env };
  if (HOME) env.HERMES_HOME = HOME;
  const args = ['-z', query, '--yolo', '-t', ''];
  return new Promise((res) => {
    const t0 = performance.now();
    execFile(HERMES_EXE, args, { env, timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const wall = (performance.now() - t0) / 1000;
        const text = String(stdout || '').trim();
        res({
          success: text.length > 0 && !err,
          content: text || ((err ? `exec error: ${err.message}; ` : '') + String(stderr || '').slice(-300)),
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
  if (!existsSync(HERMES_EXE)) throw new Error(`hermes.exe not found: ${HERMES_EXE} (set HERMES_EXE)`);
  if (!HOME) throw new Error('HERMES_BENCH_HOME not set (point it at an ollama-configured isolated HERMES_HOME)');
  await ask('Reply with the single word: ready');
}

export async function runFixture(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const results = [];
  for (const prompt of fixture.prompts) {
    const r = await ask(buildQuery(prompt));
    results.push({
      id: prompt.id, archetype: fixture.archetype,
      latency: r.latency, wall: r.wall, content: r.content, success: r.success,
      system: 'hermes',
    });
  }
  return results;
}

export { buildQuery };
