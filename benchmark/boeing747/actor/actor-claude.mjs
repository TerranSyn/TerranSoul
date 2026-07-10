// Autonomous ACTOR-EDIT step for the Boeing 747 primitives vision benchmark —
// the "TerranSoul-Agent-driven" track (as opposed to the bare-CLI series in
// results/terransoul-opus48*/, where a human/agent hand-edited plane.js
// between loop-runner-claude.mjs invocations; see benchmark/BOEING-COMPARISON.md's
// 2026-07-05 ACTOR-FIDELITY CORRECTION note).
//
// Mirrors judge-claude.mjs's callClaudeVision subprocess-spawn pattern
// (execFile('claude', args, {cwd: REPO_ROOT, timeout, maxBuffer, windowsHide}))
// but grants Read+Edit (no Bash/Write/Web*/Task) instead of Read-only, scoped
// via --add-dir to the candidate's own directory AND the current run's shots
// directory, so the actor can genuinely open the 9 rendered PNGs + reference
// photos itself and apply ITS OWN edit to plane.js via the Edit tool — no
// human, no text-only hint-following.
//
// Effort: `claude --help` exposes `--effort <low|medium|high|xhigh|max>`; this
// is the highest available extended-thinking/effort level and is applied by
// default (DEFAULT_EFFORT). There is no separate "thinking" flag beyond this.
//
// Contract gate (mirrors run-baselines.mjs's `status: 'contract_failed'`):
// after the call returns, plane.js is re-read from disk (the Edit tool already
// applied the change as a side effect) and run through validatePlaneSource()
// (lib/contract.mjs, FROZEN). A violation is NOT accepted — the previous
// candidate source is restored verbatim and the violation is recorded; the
// contract is never relaxed and a failed edit is never silently retried with
// a weakened contract.
//
// CLI:
//   node actor/actor-claude.mjs --plane <plane.js> --shots <dir>
//     --gemma-results <results.json> --claude-results <results.json>
//     [--model claude-fable-5] [--effort max] [--out <result.json>]
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { VIEWS } from '../lib/cameras.mjs';
import { ALLOWED_GEOMETRIES, validatePlaneSource } from '../lib/contract.mjs';
import { loadRubric } from '../judge/judge.mjs';
import { sha256 } from '../rig/render-rig.mjs';

const execFileAsync = promisify(execFile);
const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');
const CONTRACT_PATH = path.join(BENCH_DIR, 'lib', 'contract.mjs');

const ACTOR_TIMEOUT_MS = Number(process.env.CLAUDE_ACTOR_TIMEOUT_MS || 600000);
const DEFAULT_MODEL = 'claude-fable-5';
// Highest effort level `claude --help` exposes (low/medium/high/xhigh/max) —
// applied by default per the doc's own "MAX thinking" language. If a future
// CLI build removes this flag, callers should override --effort explicitly;
// no invented flag is used in its place.
const DEFAULT_EFFORT = 'max';

/**
 * Extract the FORBIDDEN_PATTERNS reasons VERBATIM from the frozen
 * lib/contract.mjs source (never duplicated by hand — read from the file so
 * the actor prompt can never drift from the actual gate). Each array entry is
 * `[/regex/, 'human-readable reason'],` and the regex literals here contain no
 * quote characters, so every single-quoted string inside the block is exactly
 * one reason, in order.
 */
export function extractForbiddenReasons() {
  const src = readFileSync(CONTRACT_PATH, 'utf8');
  const block = src.match(/const FORBIDDEN_PATTERNS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('could not locate FORBIDDEN_PATTERNS in lib/contract.mjs');
  const reasons = [];
  const reasonRe = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let m;
  while ((m = reasonRe.exec(block[1])) !== null) reasons.push(m[1]);
  if (reasons.length === 0) throw new Error('FORBIDDEN_PATTERNS block parsed but yielded zero reasons');
  return reasons;
}

/** Same weakest-feature mechanism anchorHint() already uses in loop-runner-claude.mjs. */
function anchorHint(rubric, weakest, label) {
  if (!weakest) return null;
  const criterion = rubric.criteria.find((c) => c.id === weakest.id);
  if (!criterion) return null;
  return (
    `[${label}] weakest feature: '${criterion.name}' (${weakest.id}, mean ${weakest.mean}/10). ` +
    `Target the 8 anchor: ${criterion.anchors['8']}; then the 10 anchor: ${criterion.anchors['10']}.`
  );
}

/** gemma judge.mjs's per_view entries carry notes only inside each seed's `notes` — surface the first ok one. */
function perViewNotesGemma(gemmaResult) {
  const out = {};
  for (const v of gemmaResult.per_view) {
    const okNotes = (v.seeds || []).filter((s) => s.ok).map((s) => s.notes).filter(Boolean);
    out[v.view] = okNotes[0] || '';
  }
  return out;
}

/**
 * Copy the prepared reference photos alongside the shots dir (idempotent) so
 * they are reachable under the SAME `--add-dir <shotsDir>` grant used for the
 * rendered views — no third add-dir beyond "candidate's own directory AND the
 * current run's shots directory" is introduced.
 */
export function copyReferenceImages(shotsDir) {
  const metaPath = path.join(BENCH_DIR, 'references', 'prepared', 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error('references not prepared — run: node benchmark/boeing747/references/fetch-references.mjs');
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const refsDir = path.join(shotsDir, 'actor-refs');
  mkdirSync(refsDir, { recursive: true });
  const out = {};
  for (const [key, entry] of Object.entries(meta.references)) {
    const src = path.join(BENCH_DIR, 'references', 'prepared', entry.file);
    const dest = path.join(refsDir, entry.file);
    if (!existsSync(dest)) copyFileSync(src, dest);
    out[key] = { depicts: entry.depicts, file: dest };
  }
  return out;
}

function buildActorPrompt({
  rubric,
  gemmaResult,
  claudeResult,
  candidatePath,
  shotsDir,
  refPaths,
  gemmaHint,
  claudeHint,
  forbiddenReasons,
}) {
  const gemmaNotes = perViewNotesGemma(gemmaResult);
  const lines = [];
  lines.push(
    'You are the TerranSoul benchmark ACTOR for the Boeing-747 primitives-only vision self-improve loop.',
  );
  lines.push(
    'You must inspect the rendered images YOURSELF with the Read tool (genuine vision inspection) and then make ONE targeted, concrete edit to the candidate source with the Edit tool.',
  );
  lines.push('');
  lines.push(`CANDIDATE FILE (edit ONLY this file): ${candidatePath}`);
  lines.push(
    'It is a single self-contained ES module exporting exactly `export function buildPlane(THREE)` returning a THREE.Group. Do not change the export signature.',
  );
  lines.push('');
  lines.push('HARD CONTRACT (frozen — never violate, never work around):');
  lines.push(`- Allowed geometries ONLY: ${ALLOWED_GEOMETRIES.join(', ')}. Any other *Geometry identifier fails the gate.`);
  lines.push('- Forbidden (verbatim reasons from lib/contract.mjs FORBIDDEN_PATTERNS):');
  for (const r of forbiddenReasons) lines.push(`    - ${r}`);
  lines.push('- Orientation: nose along +X, up +Y, wings span the Z axis.');
  lines.push('- No imports, network, DOM, storage, eval/Function, workers — the module must stay fully self-contained.');
  lines.push('');
  lines.push('RUBRIC CRITERIA (0-10 each; anchors describe the 0/3/5/8/10 points on the scale):');
  for (const c of rubric.criteria) {
    const anchors = Object.entries(c.anchors)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    lines.push(`- ${c.id} (${c.name}, weight ${c.weight}): ${anchors}`);
  }
  lines.push('');
  lines.push(`RENDERED VIEWS live at: ${shotsDir}`);
  lines.push('(view-1.png .. view-9.png, contact-sheet.png — open several of these yourself, do not rely on the text scores/notes alone).');
  lines.push('');
  lines.push('REFERENCE PHOTOS (copied next to the shots as actor-refs/<file>; each view lists its 2 rubric-relevant references):');
  for (const view of VIEWS) {
    const refKeys = rubric.view_references[String(view.id)] || [];
    const files = refKeys.map((k) => (refPaths[k] ? refPaths[k].file : `<missing:${k}>`));
    lines.push(`  view ${view.id} (${view.key}): ${files.join(', ')}`);
  }
  lines.push('');
  lines.push('CURRENT ITERATION JUDGE FEEDBACK (this exact candidate, just rendered):');
  lines.push('gemma4:12b judge (frozen baseline track) — per view score /10 + notes:');
  for (const v of gemmaResult.per_view) {
    lines.push(`  view ${v.view} (${v.key}): score=${v.score ?? 'null'}  notes="${gemmaNotes[v.view] || ''}"`);
  }
  if (gemmaHint) lines.push(`  ${gemmaHint}`);
  lines.push('');
  lines.push(`Claude ${claudeResult.judge_model} vision judge (second track) — per view score /10 + notes:`);
  for (const v of claudeResult.per_view) {
    lines.push(`  view ${v.view} (${v.key}): score=${v.score ?? 'null'}  notes="${v.notes || ''}"`);
  }
  if (claudeHint) lines.push(`  ${claudeHint}`);
  lines.push('');
  lines.push('YOUR TASK:');
  lines.push('1. Use the Read tool to open several rendered view PNGs above yourself, plus the reference photos most relevant to the weakest-scoring feature named above.');
  lines.push(`2. Use the Read tool to open the current source: ${candidatePath}`);
  lines.push(
    '3. Make ONE focused, concrete geometric edit (or a small tightly-related set of edits) that fixes the weakest feature identified above, WITHOUT regressing any criterion that already scores well (>=7) on either judge track.',
  );
  lines.push(`4. Apply the change using the Edit tool DIRECTLY to ${candidatePath}. Do not create, write, or touch any other file.`);
  lines.push(
    '5. Keep the file a single self-contained ES module exporting exactly `export function buildPlane(THREE)` returning a THREE.Group. Stay strictly inside the primitives-only contract above — do not invent a geometry class or import anything.',
  );
  lines.push('When you are done editing, reply with a short PLAIN-TEXT summary of exactly what you changed and why (no JSON needed here).');
  return lines.join('\n');
}

/** ONE Claude actor-edit call. Mirrors judge-claude.mjs's callClaudeVision subprocess pattern. */
async function callClaudeActor({ prompt, candidateDir, shotsDirAbs, model, effort }) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--allowedTools',
    'Read Edit',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--add-dir',
    candidateDir,
    '--add-dir',
    shotsDirAbs,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  const { stdout } = await execFileAsync('claude', args, {
    cwd: REPO_ROOT,
    timeout: ACTOR_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI did not return JSON: ${String(stdout).slice(0, 200)}`);
  }
  if (outer.is_error || outer.subtype !== 'success') {
    throw new Error(`claude actor error (subtype=${outer.subtype}): ${String(outer.result).slice(0, 300)}`);
  }
  return outer;
}

/**
 * Run one autonomous actor-edit step: build the prompt from the rubric,
 * contract, and this iteration's two judge tracks; spawn the `claude` CLI
 * with Read+Edit scoped to the candidate dir + shots dir; re-validate the
 * edited source against the FROZEN contract; restore-and-record on any
 * violation or CLI failure rather than accepting/relaxing/retrying.
 */
export async function runActorEdit({ candidatePath, shotsDir, gemmaResult, claudeResult, model, effort }) {
  const { rubric } = loadRubric();
  const forbiddenReasons = extractForbiddenReasons();
  const shotsDirAbs = path.resolve(shotsDir);
  const refPaths = copyReferenceImages(shotsDirAbs);

  const candidateAbs = path.resolve(candidatePath);
  const candidateDir = path.dirname(candidateAbs);
  const originalSource = readFileSync(candidateAbs, 'utf8');
  const originalSha = sha256(originalSource);

  const gemmaHint = anchorHint(rubric, gemmaResult.weakest_feature, 'gemma4');
  const claudeHint = anchorHint(rubric, claudeResult.weakest_feature, `claude ${claudeResult.judge_model}`);
  const prompt = buildActorPrompt({
    rubric,
    gemmaResult,
    claudeResult,
    candidatePath: candidateAbs,
    shotsDir: shotsDirAbs,
    refPaths,
    gemmaHint,
    claudeHint,
    forbiddenReasons,
  });

  const useModel = model || DEFAULT_MODEL;
  const useEffort = effort || DEFAULT_EFFORT;
  const started = Date.now();
  let outer = null;
  let actorError = null;
  try {
    outer = await callClaudeActor({ prompt, candidateDir, shotsDirAbs, model: useModel, effort: useEffort });
  } catch (err) {
    actorError = String(err.message || err);
  }
  const ms = outer ? Number(outer.duration_ms) || Date.now() - started : Date.now() - started;
  const costUsd = outer ? Number(outer.total_cost_usd) || 0 : 0;

  const editedSource = existsSync(candidateAbs) ? readFileSync(candidateAbs, 'utf8') : '';
  const editedSha = sha256(editedSource);
  const changed = editedSha !== originalSha;

  const base = { model: useModel, effort: useEffort, ms, cost_usd: costUsd };

  if (actorError) {
    // A failed/errored call must never leave a half-applied edit in place.
    if (changed) writeFileSync(candidateAbs, originalSource);
    return {
      ...base,
      status: 'actor_failed',
      actor_error: actorError,
      plane_sha256_before: originalSha,
      plane_sha256_after: originalSha,
      changed: false,
    };
  }

  if (!changed) {
    return {
      ...base,
      status: 'no_change',
      plane_sha256_before: originalSha,
      plane_sha256_after: originalSha,
      changed: false,
      claude_result_text: typeof outer?.result === 'string' ? outer.result.slice(0, 2000) : null,
    };
  }

  const contract = validatePlaneSource(editedSource);
  if (!contract.ok) {
    // Do NOT accept the edit — restore the previous candidate verbatim and
    // record the violation (mirrors run-baselines.mjs's contract_failed
    // status). Never silently relax the contract or retry with it weakened.
    writeFileSync(candidateAbs, originalSource);
    return {
      ...base,
      status: 'contract_failed',
      contract_violations: contract.violations,
      plane_sha256_before: originalSha,
      plane_sha256_after: originalSha,
      plane_sha256_rejected: editedSha,
      changed: false,
    };
  }

  return {
    ...base,
    status: 'edited',
    plane_sha256_before: originalSha,
    plane_sha256_after: editedSha,
    changed: true,
    claude_result_text: typeof outer?.result === 'string' ? outer.result.slice(0, 2000) : null,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const run = async () => {
    if (!args.plane || !args.shots || !args['gemma-results'] || !args['claude-results']) {
      throw new Error(
        'usage: actor-claude.mjs --plane <plane.js> --shots <dir> --gemma-results <results.json> --claude-results <results.json> [--model claude-fable-5] [--effort max] [--out <result.json>]',
      );
    }
    const gemmaResult = JSON.parse(readFileSync(path.resolve(args['gemma-results']), 'utf8'));
    const claudeResult = JSON.parse(readFileSync(path.resolve(args['claude-results']), 'utf8'));
    const result = await runActorEdit({
      candidatePath: args.plane,
      shotsDir: args.shots,
      gemmaResult,
      claudeResult,
      model: typeof args.model === 'string' ? args.model : undefined,
      effort: typeof args.effort === 'string' ? args.effort : undefined,
    });
    if (args.out) writeFileSync(path.resolve(args.out), JSON.stringify(result, null, 2));
    console.log(`ACTOR_${result.status.toUpperCase()} ${JSON.stringify(result)}`);
    if (result.status === 'actor_failed' || result.status === 'contract_failed') process.exitCode = 1;
  };
  run().catch((err) => {
    console.error(`ACTOR_FAIL ${err.message}`);
    process.exit(1);
  });
}
