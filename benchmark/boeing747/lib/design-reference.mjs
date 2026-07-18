// Query TerranSoul's own real, isolated `--cli-data-dir` memory (via
// `terransoul-cli --ask ... --mode chat`, the SAME transport the actor's own
// `--agent-task` edit call already uses — see actor/actor-claude.mjs's
// callTerranSoulAgentTask) for reference material ingested into that store
// ahead of time. Distinct from lib/self-learning.mjs's fetchPriorAttempts,
// which targets the SHARED dev MCP tray (a different brain, used for cross-
// run self-improve-attempt lessons) — this module targets the bench's own
// ISOLATED `--cli-data-dir` SQLite store, the same one the actor edits
// through, so ingesting a reference document there makes it retrievable via
// TerranSoul's real hybrid_search_rrf/retrieve_prompt_memories chat path —
// zero bench-specific retrieval logic, just the product's own memory feature
// pointed at a dedicated data dir.
//
// GENERIC ON PURPOSE (same discipline as lib/self-learning.mjs): the QUERY
// text is entirely caller-supplied. This file has no Boeing-747 (or any
// other benchmark) word anywhere in its own logic — only the call site
// (loop-runner-terransoul.mjs today) knows what benchmark it is running.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCH_DIR = path.resolve(LIB_DIR, '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

const DEFAULT_TIMEOUT_MS = 120000;

/** Default location of the built CLI binary (mirrors actor-claude.mjs's own resolver). */
export function resolveTerranSoulCliBinary() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(REPO_ROOT, 'src-tauri', 'target', 'release', `terransoul-cli${ext}`);
}

/**
 * Ask TerranSoul's real chat pipeline (`--ask --mode chat`) a question
 * against the given `cliDataDir`'s isolated memory store. Fails open — any
 * spawn error, non-zero exit, timeout, or empty reply returns
 * `{ok:false, error}` rather than throwing, matching lib/self-learning.mjs's
 * fail-open discipline: a design-reference READ must never block the actor
 * loop. `execImpl` is the sole spawn seam (mirrors self-learning.mjs's
 * injectable `callTool`) so this function's own logic is directly
 * vitest-covered without spawning a real subprocess.
 * @returns {Promise<{ok:boolean, text?:string, error?:string}>}
 */
export async function askDesignReference({
  query,
  cliBinary,
  cliDataDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  execImpl = execFileAsync,
} = {}) {
  if (!query) return { ok: false, error: 'askDesignReference requires a query' };
  const binary = cliBinary || resolveTerranSoulCliBinary();
  const env = cliDataDir ? { ...process.env, TERRANSOUL_HEADLESS_DATA_DIR: cliDataDir } : process.env;
  try {
    const result = await execImpl(binary, ['--ask', query, '--mode', 'chat'], {
      cwd: REPO_ROOT,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env,
    });
    const text = (result.stdout || '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'empty reply' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * Render `askDesignReference`'s answer into a compact prompt section.
 * Returns `null` when there is nothing to show (never injects an empty or
 * failed-lookup section into a prompt) — mirrors
 * lib/self-learning.mjs::formatPriorAttemptsSection.
 */
export function formatDesignReferenceSection(answer, { header, maxChars = 1200 } = {}) {
  if (!answer || !answer.ok || typeof answer.text !== 'string' || !answer.text.trim()) return null;
  const body = answer.text.length > maxChars ? `${answer.text.slice(0, maxChars)}...` : answer.text;
  const lines = [
    header ||
      'DESIGN REFERENCE (from TerranSoul memory — human-curated reference material retrieved for this iteration, not a rubric answer key):',
    body,
  ];
  return lines.join('\n');
}

/**
 * DESIGN-REFERENCE TRACK (owner-authorized methodology pivot, see
 * rules/milestones.md): once a prior AGI-purity-only track had proven the
 * frozen-model-plus-generic-scaffolding thesis, ask TerranSoul's own memory
 * (pointed at THIS run's `--cli-data-dir`) for whatever reference material a
 * human operator ingested into it ahead of time (`terransoul-cli
 * --ingest-resume <path>` against the same data dir), scoped to the current
 * weakest feature. Fails open (askDesignReference never throws) — an empty
 * store, an unbuilt binary, or any spawn error simply means no
 * design-reference section this iteration. `weakestId`/`subject` are plain
 * caller-supplied strings — this function stays GENERIC (no domain word of
 * its own; `subject` is what lets the call site name its own domain, e.g.
 * "Boeing 747", without this file hardcoding it). A direct, concrete-fact
 * question retrieves measurably better than a meta-question ABOUT the
 * reference material — verified live: asking "what does the reference say
 * about X" surfaced only a section heading with no content, while asking the
 * X question directly ("what is the wing sweep angle") correctly retrieved
 * the cited figures.
 */
export async function buildDesignReferenceSection({
  weakestId,
  subject,
  criterionLabel,
  criterionText,
  cliBinary,
  cliDataDir,
}) {
  const query = buildDesignReferenceQuery({ weakestId, subject, criterionLabel, criterionText });
  const answer = await askDesignReference({ query, cliBinary, cliDataDir });
  return formatDesignReferenceSection(answer);
}

/**
 * PURE + exported (so it is directly vitest-covered without spawning the CLI):
 * derive the per-iteration retrieval query. When the caller supplies the
 * weakest criterion's own label (`criterionLabel`) and/or description text
 * (`criterionText`) -- its rubric name and anchor prose -- the query is built
 * FROM that text, so the semantic search matches the criterion's actual
 * subject. This replaces a fixed geometry-biased template ("geometry,
 * dimensions, proportions") that retrieved poorly for TECHNIQUE-shaped criteria
 * (a craftsmanship-class feature is about assembly/joins/artifacts, not
 * dimensions), which was a documented live retrieval miss. The phrasing stays a
 * DIRECT concrete question (never a meta-question ABOUT the reference material,
 * per this module's header note) and stays GENERIC: `subject`/`criterionLabel`/
 * `criterionText` are all caller-supplied -- no criterion name is hardcoded
 * here. With neither label nor text supplied, it falls back to the prior
 * id-derived template (byte-identical query for that legacy call shape).
 */
export function buildDesignReferenceQuery({ weakestId, subject, criterionLabel, criterionText } = {}) {
  const label = String(criterionLabel || '').trim();
  const detail = String(criterionText || '').trim();
  if (label || detail) {
    const focus = [subject, label].map((s) => String(s || '').trim()).filter(Boolean).join(' ') || 'this feature';
    const parts = [`What are the key dimensions, proportions, and construction techniques for ${focus}?`];
    if (detail) parts.push(detail);
    parts.push('Give concrete numbers and specifics, not generalities.');
    return parts.join(' ');
  }
  const topic = String(weakestId || 'overall design').replace(/_/g, ' ');
  const scope = subject ? `${subject}'s ${topic}` : topic;
  return `What are the specific geometry, dimensions, proportions, or design facts about ${scope}? Give concrete numbers and details, not generalities.`;
}
