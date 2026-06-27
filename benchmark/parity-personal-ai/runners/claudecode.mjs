/**
 * Claude Code runner — parity head-to-head, FRONTIER REFERENCE.
 *
 * This is GENesis-AGI's reasoning engine: GENesis invokes `claude -p` (Claude
 * Code headless) for its cognition (src/genesis/cc/invoker.py). The full
 * GENesis-AGI system (Incus container + Qdrant + months of accumulated memory +
 * an autonomous ego loop) is NOT reproducible in a single-session bench and is
 * Linux-native, so this runner measures the engine itself — the lower bound of
 * what GENesis-on-Claude can do (its memory layer would only add on top).
 *
 * IMPORTANT — NOT comparable to the gemma4:12b-it-qat rows: this runs on a
 * CLOUD Claude frontier model (recorded per-call in `model`), not the local
 * model the parity bench holds fixed. It is a *different-model reference* (like
 * the Sonnet-4.7 Zork baseline), and it costs real money (recorded in
 * `cost_usd`) rather than the $0-local basis of the other rows. Same 22 prompts,
 * same injected context, same judge; tools disabled for a single answer pass.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const CLAUDE_EXE = process.env.CLAUDE_EXE
  || join(process.env.USERPROFILE || process.env.HOME || '', '.local', 'bin', 'claude.exe');
const TIMEOUT = 240_000;
const NO_TOOLS = ['Bash', 'Edit', 'Write', 'Read', 'WebSearch', 'WebFetch', 'Glob', 'Grep', 'Task', 'NotebookEdit', 'TodoWrite'];

function ask(query) {
  const args = ['-p', query, '--output-format', 'json', '--disallowed-tools', ...NO_TOOLS];
  return new Promise((res) => {
    const t0 = performance.now();
    execFile(CLAUDE_EXE, args, { timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const wall = (performance.now() - t0) / 1000;
        let j = null;
        try { j = JSON.parse(String(stdout || '').trim()); } catch { /* noise */ }
        const text = j && typeof j.result === 'string' ? j.result.trim() : '';
        res({
          success: text.length > 0 && !(j && j.is_error),
          content: text || ((err ? `exec error: ${err.message}; ` : '') + String(stderr || stdout || '').slice(-300)),
          latency: wall, wall,
          model: (j && j.model) || (j && j.modelUsage && Object.keys(j.modelUsage)[0]) || null,
          cost_usd: (j && typeof j.total_cost_usd === 'number') ? j.total_cost_usd : null,
        });
      });
  });
}

function buildQuery(p) {
  const ctx = p.context_seed ? `Relevant context from memory:\n${p.context_seed}\n\n` : '';
  return `${ctx}User request: ${p.input}\n\nRespond helpfully and concisely.`;
}

export async function warmup() {
  if (!existsSync(CLAUDE_EXE)) throw new Error(`claude.exe not found: ${CLAUDE_EXE} (set CLAUDE_EXE)`);
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
      model: r.model, cost_usd: r.cost_usd,
      system: 'claude-code',
    });
  }
  return results;
}

export { buildQuery };
