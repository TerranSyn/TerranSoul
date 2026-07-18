// Autonomous ACTOR-EDIT step for the Boeing 747 primitives vision benchmark —
// the "TerranSoul-Agent-driven" track (as opposed to the bare-CLI series in
// results/terransoul-opus48*/, where a human/agent hand-edited plane.js
// between loop-runner-claude.mjs invocations; see benchmark/BOEING-COMPARISON.md's
// 2026-07-05 ACTOR-FIDELITY CORRECTION note).
//
// WIRE-CLI-PARITY-GAP-3 REWIRE (2026-07-10): this module used to spawn the
// bare `claude` binary directly (`--allowedTools "Read Edit" --add-dir ...`).
// It now spawns TerranSoul's OWN generic agentic-edit CLI capability instead
// — `terransoul-cli --agent-task <prompt> --grant-dir <dir> [--grant-dir
// <dir> ...] [--model <m>] [--effort <e>]` (src-tauri/src/cli.rs) — which:
//   - gates the call through the SAME `action_trust` earned-autonomy ledger
//     `SelfImproveEngine`'s own DAG uses (a DENY returns before `claude` is
//     ever spawned — no second gating mechanism, no bypass);
//   - internally drives the exact same Read+Edit-scoped `claude` invocation
//     via `crates/brain/src/agentic_cli.rs::AgenticCliClient` — production
//     infrastructure, not a bench-only shell-out;
//   - reports its outcome as ONE line of JSON on stdout on success
//     (`result_text`/`cost_usd`/`duration_ms`/`tool_calls`, already tallied
//     for us — no stream reconstruction needed on the happy path) and
//     human-readable progress lines on stderr throughout (`[tool] <name>
//     ...` / `[tool-result] <name> (ok|FAILED)`), classified by
//     lib/actor-stream.mjs so a killed/timed-out/denied call still leaves a
//     real tool-call tally instead of a black box (LESSON BOEING-747-ACTOR-
//     RETRY-1's fix 3, ported to the new transport).
// KNOWN GAP (not fixable from this Node-only phase): the old bespoke call
// passed `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` to prevent
// the actor's `claude` session from auto-loading any ambient project
// `.mcp.json`. `AgenticCliClient::build_command` (Rust) does not set this —
// confirmed by reading crates/brain/src/agentic_cli.rs in full before this
// rewire. Fixing it requires a Rust change, out of scope for this phase;
// flagged here (and in the task report) as a real, un-silenced regression
// for a future Rust-touching pass, not swept under the rug.
//
// Effort: `claude --help` exposes `--effort <low|medium|high|xhigh|max>`; this
// is the highest available extended-thinking/effort level and is applied by
// default (DEFAULT_EFFORT), forwarded through terransoul-cli's own `--effort`
// flag. There is no separate "thinking" flag beyond this.
//
// Contract gate (mirrors run-baselines.mjs's `status: 'contract_failed'`):
// after the call returns, plane.js is re-read from disk (the Edit tool already
// applied the change as a side effect) and run through validatePlaneSource()
// (lib/contract.mjs, FROZEN). A violation is NOT accepted — the previous
// candidate source is restored verbatim and the violation is recorded; the
// contract is never relaxed and a failed edit is never silently retried with
// a weakened contract. UNCHANGED by this rewire (harness-side, correct as-is).
//
// RETRY/BACKOFF (fix 1) lives in loop-runner-terransoul.mjs, which calls
// runActorEdit() again on an `actor_failed` outcome with a longer
// `timeoutMs`; this module stays retry-agnostic — it just accepts an
// optional per-call `timeoutMs` override. A NEW failure mode introduced by
// this rewire — `action_trust` DENIAL — is surfaced as `denied: true` on the
// thrown error/returned result so a retry loop can recognize that a longer
// timeout can never fix a ledger decision (see lib/actor-retry.mjs's
// `shouldRetryActor(attemptIndex, maxRetries, {denied})`).
//
// PRIOR-ATTEMPTS CONTEXT / LESSON INGEST (fix 4, self-learning): wired at the
// loop-runner-terransoul.mjs level (fetchPriorAttempts/
// formatPriorAttemptsSection build the `priorAttemptsSection` this module's
// buildActorPrompt() already accepts and injects; ingestAttemptLesson runs
// there once the next iteration's judge scores make an edit's effect
// observable) — unchanged by this rewire, still runs ALONGSIDE the
// TerranSoul-CLI-driven edit, not instead of it.
//
// CLI:
//   node actor/actor-claude.mjs --plane <plane.js> --shots <dir>
//     --gemma-results <results.json> --claude-results <results.json>
//     [--model claude-fable-5] [--effort max] [--timeout-ms N]
//     [--cli-bin <path>] [--cli-data-dir <dir>] [--out <result.json>]
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { VIEWS } from '../lib/cameras.mjs';
import { ALLOWED_GEOMETRIES, validatePlaneSource } from '../lib/contract.mjs';
// Runtime smoke-check — extracted VERBATIM to lib/candidate-smoke.mjs (BRU-3)
// so the best-of-N judge-once filter cascade reuses the exact same check;
// semantics unchanged (see that module's header for the original rationale).
import { smokeCheckPlane } from '../lib/candidate-smoke.mjs';
import { loadRubric } from '../judge/judge.mjs';
import { sha256 } from '../rig/render-rig.mjs';
import { parseActorStreamBuffer, summarizeActorStream } from '../lib/actor-stream.mjs';

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
// `terransoul-cli`'s own build output — mirrors `.cargo/config.toml`'s
// `target-dir = "src-tauri/target"` pin; this is not a new build-output
// convention, just where cargo already puts every workspace binary.
const CLI_BIN_NAME = process.platform === 'win32' ? 'terransoul-cli.exe' : 'terransoul-cli';
const DEFAULT_CARGO_TARGET_DIR = path.join(REPO_ROOT, 'src-tauri', 'target');

/**
 * Extract the FORBIDDEN_PATTERNS reasons VERBATIM from the frozen
 * lib/contract.mjs source (never duplicated by hand — read from the file so
 * the actor prompt can never drift from the actual gate). Each array entry is
 * `[/regex/, 'human-readable reason'],` and the regex literals here contain no
 * quote characters, so every single-quoted string inside the block is exactly
 * one reason, in order.
 *
 * `contractPath` defaults to the FROZEN lib/contract.mjs (byte-identical to
 * the prior no-arg behavior); the open track passes lib/contract-open.mjs so
 * the actor prompt lists that contract's forbidden reasons instead. Both
 * files share the exact same FORBIDDEN_PATTERNS block shape (quote-free
 * regexes, single-quoted reasons), so this parser works unchanged for either.
 */
export function extractForbiddenReasons(contractPath = CONTRACT_PATH) {
  const src = readFileSync(contractPath, 'utf8');
  const block = src.match(/const FORBIDDEN_PATTERNS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error(`could not locate FORBIDDEN_PATTERNS in ${contractPath}`);
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
  claudeResult = null,
  candidatePath,
  shotsDir,
  refPaths,
  gemmaHint,
  claudeHint,
  forbiddenReasons,
  priorAttemptsSection,
  designReferenceSection = null,
  // opus-pairwise-only additive sections (loop-runner-terransoul.mjs pairwise
  // path). Each defaults to null so the FROZEN / opus-panel / gemma actor prompt
  // is BYTE-IDENTICAL when they are omitted (they are only ever passed on the
  // `--judge opus-pairwise` path): the ACE strategy-cheatsheet ("your own proven
  // techniques"), its contrastive anti-patterns bank, and the backtracked
  // rejected-edit ledger ("do not repeat these").
  strategyCheatsheetSection = null,
  badAttemptsSection = null,
  rejectedEditsSection = null,
  plateauEscalation = null,
  burstStatusSection = null,
  measuredFeedbackSection = null,
  contractOpen = false,
  contractPathLabel = 'lib/contract.mjs',
  antiSmugglingRule = null,
  allowedGeometries = ALLOWED_GEOMETRIES,
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
  if (contractOpen) {
    lines.push('HARD CONTRACT (open medium, closed world — never violate, never work around):');
    lines.push(
      '- Geometry/material medium is OPEN: arbitrary COMPUTED meshes (hand-built ' +
        'BufferGeometry, THREE.Shape/ExtrudeGeometry freeform, LatheGeometry with arbitrary profiles, ' +
        'groups/instancing) and COMPUTED textures (DataTexture/CanvasTexture, vertex colors, ' +
        `in-code normal/bump maps) are ALL allowed. Reference primitives still available: ${allowedGeometries.join(', ')}.`,
    );
    if (antiSmugglingRule) lines.push(`- ANTI-SMUGGLING (still enforced): ${antiSmugglingRule}`);
    lines.push(`- Forbidden (verbatim reasons from ${contractPathLabel} FORBIDDEN_PATTERNS):`);
    for (const r of forbiddenReasons) lines.push(`    - ${r}`);
    lines.push('- Orientation: nose along +X, up +Y, wings span the Z axis.');
    lines.push('- No imports, network, DOM, storage, eval/Function, workers, asset loaders — the module must stay fully self-contained (BUILD, do not download).');
  } else {
    lines.push('HARD CONTRACT (frozen — never violate, never work around):');
    lines.push(`- Allowed geometries ONLY: ${allowedGeometries.join(', ')}. Any other *Geometry identifier fails the gate.`);
    lines.push('- Forbidden (verbatim reasons from lib/contract.mjs FORBIDDEN_PATTERNS):');
    for (const r of forbiddenReasons) lines.push(`    - ${r}`);
    lines.push('- Orientation: nose along +X, up +Y, wings span the Z axis.');
    lines.push('- No imports, network, DOM, storage, eval/Function, workers — the module must stay fully self-contained.');
  }
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
  if (claudeResult) {
    lines.push(`Claude ${claudeResult.judge_model} vision judge (second track) — per view score /10 + notes:`);
    for (const v of claudeResult.per_view) {
      lines.push(`  view ${v.view} (${v.key}): score=${v.score ?? 'null'}  notes="${v.notes || ''}"`);
    }
    if (claudeHint) lines.push(`  ${claudeHint}`);
    lines.push('');
  }
  if (priorAttemptsSection) {
    lines.push(priorAttemptsSection);
    lines.push('');
  }
  if (designReferenceSection) {
    lines.push(designReferenceSection);
    lines.push('');
  }
  if (strategyCheatsheetSection) {
    lines.push(strategyCheatsheetSection);
    lines.push('');
  }
  if (badAttemptsSection) {
    lines.push(badAttemptsSection);
    lines.push('');
  }
  if (rejectedEditsSection) {
    lines.push(rejectedEditsSection);
    lines.push('');
  }
  if (plateauEscalation) {
    lines.push(plateauEscalation);
    lines.push('');
  }
  if (burstStatusSection) {
    lines.push(burstStatusSection);
    lines.push('');
  }
  if (measuredFeedbackSection) {
    lines.push(measuredFeedbackSection);
    lines.push('');
  }
  // ASSEMBLY COHERENCE SELF-CHECK (shared prompt, domain-GENERIC — serves every
  // track): the single most common failure mode of a procedurally-assembled
  // model is that the individual parts look plausible in isolation but do not
  // form ONE connected object — components float in empty space, sit detached,
  // sink into the ground/base, or scatter apart — and an actor steered only by
  // the critic's abstract per-feature text never notices it, because the critic
  // names a feature, not the assembly. This check runs FIRST, before any edit is
  // chosen. It names no domain, no part, and no measurement — only the generic
  // property that the object must read as a single connected whole.
  lines.push('ASSEMBLY COHERENCE SELF-CHECK (do this BEFORE choosing an edit):');
  lines.push(
    'Open the rendered views yourself and verify the model reads as ONE coherent, connected object:',
  );
  lines.push(
    '  - every component is attached to the structure it belongs to — nothing floating in empty space, detached, sunk into the ground/base, or scattered away from the main body;',
  );
  lines.push(
    '  - the parts assemble into a single connected object from EVERY view, not a loose pile of separate shapes seen from different angles;',
  );
  lines.push('  - relative positions and proportions of the parts are plausible for the target object.');
  lines.push(
    'If ANY incoherence is visible (a detached, floating, sunken, or scattered part; the object failing to read as one connected whole), then FIXING that attachment/placement takes PRIORITY over the critic\'s named weakest feature this iteration — a structurally incoherent assembly caps every criterion no matter how well-shaped the individual parts are.',
  );
  lines.push('');
  lines.push('CRAFT GUIDANCE (generic):');
  lines.push(
    '  - Prefer a parameterized, named-part structure: derive each part\'s size and position from a small set of shared, named variables rather than independent magic numbers, so the parts stay proportionate to one another and to the whole.',
  );
  lines.push(
    '  - Before editing, write yourself a brief COORDINATE PLAN — the intended position and dimensions of each major component — and confirm the parts actually connect in that plan.',
  );
  lines.push('  - Make ONE minimal, targeted change per iteration; do not rewrite unrelated, already-acceptable parts.');
  lines.push('');
  lines.push('YOUR TASK:');
  lines.push('1. Use the Read tool to open several rendered view PNGs above yourself, plus the reference photos most relevant to the weakest-scoring feature named above.');
  lines.push(`2. Use the Read tool to open the current source: ${candidatePath}`);
  lines.push(
    plateauEscalation
      ? '3. As directed by the PLATEAU section above, make exactly ONE bounded, targeted change to the named weakest feature\'s existing code block — set one parameter, add one missing element, or swap one named geometry one-for-one — leaving every other line of the file untouched. Do not rebuild, redesign, or recompose anything: in this loop a sequence of small kept changes is how progress is banked, and sprawling rewrites have always been rolled back. Keep the frozen export contract (`export function buildPlane(THREE)`) and stay strictly inside the contract stated above.'
      : '3. Make ONE focused, concrete geometric edit (or a small tightly-related set of edits) that fixes the weakest feature identified above, WITHOUT regressing any criterion that already scores well (>=7) on either judge track.',
  );
  lines.push(`4. Apply the change using the Edit tool DIRECTLY to ${candidatePath}. Do not create, write, or touch any other file.`);
  if (contractOpen) {
    lines.push(
      '5. Keep the file a single self-contained ES module exporting exactly `export function buildPlane(THREE)` returning a THREE.Group. ' +
        'You may build arbitrary COMPUTED geometry and COMPUTED textures, but stay strictly inside the OPEN contract above — do not import ' +
        `anything, use a loader, or embed a pre-baked binary asset (${antiSmugglingRule || 'textures must be computed, not embedded'}).`,
    );
  } else {
    lines.push(
      '5. Keep the file a single self-contained ES module exporting exactly `export function buildPlane(THREE)` returning a THREE.Group. Stay strictly inside the primitives-only contract above — do not invent a geometry class or import anything.',
    );
  }
  lines.push('When you are done editing, reply with a short PLAIN-TEXT summary of exactly what you changed and why (no JSON needed here).');
  return lines.join('\n');
}

/**
 * Resolve the built `terransoul-cli` binary this actor drives
 * (WIRE-CLI-PARITY-GAP-3 rewire — replaces the old bespoke direct `claude`
 * spawn). Resolution order:
 *   1. An explicit `TERRANSOUL_CLI_BIN` env var (absolute path, or a name
 *      resolvable on `$PATH`) wins outright.
 *   2. This repo's own `cargo build --bin terransoul-cli` output under
 *      `CARGO_TARGET_DIR` (or the default `src-tauri/target`) — release
 *      profile checked before debug.
 * Never invokes cargo itself (this is a Node-only phase); throws a clear,
 * actionable error naming the exact build command if neither profile has
 * been built yet, so a missing binary surfaces as an honest `actor_failed`
 * (never a silent fallback to the old bare-`claude` behavior).
 * `env`/`existsSyncFn` are injectable so this resolution logic is directly
 * vitest-covered without depending on this machine's actual build state.
 */
export function resolveTerranSoulCliBinary({ env = process.env, existsSyncFn = existsSync } = {}) {
  const explicit = env.TERRANSOUL_CLI_BIN;
  if (explicit && explicit.trim()) return explicit.trim();
  const targetDir = env.CARGO_TARGET_DIR || DEFAULT_CARGO_TARGET_DIR;
  const candidates = ['release', 'debug'].map((profile) => path.join(targetDir, profile, CLI_BIN_NAME));
  for (const candidate of candidates) {
    if (existsSyncFn(candidate)) return candidate;
  }
  throw new Error(
    `terransoul-cli binary not found (checked: ${candidates.join(', ')}). Build it first: ` +
      `cd src-tauri && cargo build --release --bin terransoul-cli — or set TERRANSOUL_CLI_BIN to an existing binary path.`,
  );
}

/**
 * ONE `terransoul-cli --agent-task` call (WIRE-CLI-PARITY-GAP-3 rewire —
 * replaces the OLD bespoke direct `claude --allowedTools "Read Edit" ...`
 * spawn). Contract:
 *   - exit 0: stdout is ONE line of JSON (`AgenticTaskOutcome`: result_text/
 *     cost_usd/duration_ms/tool_calls) — parsed directly, no stream
 *     reconstruction needed since the CLI already tallies tool calls.
 *   - a `timeout`-triggered kill, an `action_trust` DENIAL (exit 1, stderr
 *     starts with `agent-task denied:`), or any other non-zero exit: stderr
 *     carries terransoul-cli's own progress-line trace
 *     (lib/actor-stream.mjs's NEW stderr-line format) plus, on denial, the
 *     exact ledger message — both surfaced so a killed/denied call still
 *     leaves real evidence instead of a black box (LESSON BOEING-747-ACTOR-
 *     RETRY-1's fix 3, ported to the new transport).
 *
 * `execImpl` defaults to the real `execFileAsync` and is the sole spawn seam
 * — tests inject a fake implementation (mirrors lib/self-learning.mjs's
 * injectable `callTool` pattern) so this function's OWN logic (argv
 * assembly, exit-code/timeout/denial classification, JSON parsing) is
 * directly vitest-covered without ever spawning a real subprocess.
 * `cliDataDir`, when supplied, is forwarded to the child as
 * `TERRANSOUL_HEADLESS_DATA_DIR` (the SAME env var `boot_cli_app_state()`
 * already resolves — JD-DEMO-CLI-PARITY's isolation mechanism, reused
 * verbatim) so a bench run can optionally point `--agent-task` at a
 * dedicated data dir instead of the operator's real production one; when
 * omitted, the child inherits this process's environment unchanged, i.e.
 * the real production `action_trust` ledger/`coding_llm_config.json` —
 * matching exactly what a user running `terransoul-cli --agent-task`
 * themselves would get, which is the most honest default measurement.
 */
async function callTerranSoulAgentTask({
  prompt,
  candidateDir,
  shotsDirAbs,
  model,
  effort,
  timeoutMs,
  cliBinary,
  cliDataDir,
  execImpl = execFileAsync,
}) {
  const binary = cliBinary || resolveTerranSoulCliBinary();
  const args = ['--agent-task', prompt, '--grant-dir', candidateDir, '--grant-dir', shotsDirAbs];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : ACTOR_TIMEOUT_MS;
  const env = cliDataDir ? { ...process.env, TERRANSOUL_HEADLESS_DATA_DIR: cliDataDir } : process.env;

  let stdoutText;
  let stderrText;
  try {
    const result = await execImpl(binary, args, {
      cwd: REPO_ROOT,
      timeout: effectiveTimeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env,
    });
    stdoutText = result.stdout || '';
    stderrText = result.stderr || '';
  } catch (err) {
    stderrText = typeof err.stderr === 'string' ? err.stderr : '';
    const observability = summarizeActorStream(parseActorStreamBuffer(stderrText));
    const timedOut = Boolean(err.killed) || err.signal === 'SIGTERM';
    const denied = /\bagent-task denied:/.test(stderrText);
    const detail = stderrText.trim().slice(0, 500) || String(err.message || err);
    const reason = timedOut
      ? `terransoul-cli agent-task timed out after ${effectiveTimeout}ms (${observability.total_tool_calls} tool call(s) observed before kill)`
      : denied
        ? `terransoul-cli agent-task denied: ${detail}`
        : `terransoul-cli agent-task failed (exit ${err.code ?? 'unknown'}): ${detail}`;
    const wrapped = new Error(reason);
    wrapped.observability = observability;
    wrapped.timed_out = timedOut;
    wrapped.denied = denied;
    throw wrapped;
  }

  const observability = summarizeActorStream(parseActorStreamBuffer(stderrText));
  let outcome;
  try {
    outcome = JSON.parse(stdoutText.trim());
  } catch (parseErr) {
    const err = new Error(
      `terransoul-cli agent-task exited 0 but stdout was not the expected JSON outcome: ${String(parseErr.message || parseErr)}`,
    );
    err.observability = observability;
    throw err;
  }
  return {
    result: outcome.result_text,
    duration_ms: outcome.duration_ms,
    total_cost_usd: outcome.cost_usd,
    observability: { ...observability, tool_calls_reported: outcome.tool_calls || [] },
  };
}

/**
 * Run one autonomous actor-edit step: build the prompt from the rubric,
 * contract, and this iteration's two judge tracks; spawn `terransoul-cli
 * --agent-task` (Read+Edit scoped to the candidate dir + shots dir, gated
 * through the `action_trust` ledger — see callTerranSoulAgentTask's doc);
 * re-validate the edited source against the FROZEN contract; restore-and-
 * record on any violation or CLI failure rather than accepting/relaxing/
 * retrying. `cliBinary`/`cliDataDir`/`execImpl`/`copyReferenceImagesFn` are
 * optional overrides (operator convenience + test seam) — see
 * callTerranSoulAgentTask's doc for `cliBinary`/`cliDataDir`/`execImpl`'s
 * exact semantics; all four default to production behavior when omitted
 * (auto-resolve the built binary, inherit this process's env unchanged,
 * spawn a real subprocess, read the real prepared reference photos from
 * disk via `copyReferenceImages`). `copyReferenceImagesFn` exists because
 * the real `copyReferenceImages` reads `references/prepared/meta.json`,
 * which is a local-only, gitignored, fetched-not-committed artifact (see
 * `references/fetch-references.mjs`) — a test suite that calls this
 * function without injecting a fake here is not actually CI-safe even if
 * every subprocess call is mocked via `execImpl`.
 */
export async function runActorEdit({
  candidatePath,
  shotsDir,
  gemmaResult,
  claudeResult = null,
  model,
  effort,
  timeoutMs,
  priorAttemptsSection,
  designReferenceSection = null,
  strategyCheatsheetSection,
  badAttemptsSection,
  rejectedEditsSection,
  plateauEscalation,
  burstStatusSection,
  measuredFeedbackSection,
  cliBinary,
  cliDataDir,
  execImpl,
  copyReferenceImagesFn = copyReferenceImages,
  contractModulePath,
  contractLabel,
}) {
  const { rubric } = loadRubric();
  // Contract selection (default = the FROZEN lib/contract.mjs — byte-behavior
  // identical to the prior default). When an open-track module path is
  // supplied, dynamically load ITS validatePlaneSource/ALLOWED_GEOMETRIES/
  // ANTI_SMUGGLING_RULE and read ITS FORBIDDEN_PATTERNS for the prompt, so the
  // gate the actor is told about is exactly the gate its edit is checked
  // against. The frozen path never does a dynamic import.
  const openContractPath =
    contractModulePath && path.resolve(contractModulePath) !== CONTRACT_PATH
      ? path.resolve(contractModulePath)
      : null;
  let contractValidate = validatePlaneSource;
  let contractAllowedGeometries = ALLOWED_GEOMETRIES;
  let antiSmugglingRule = null;
  if (openContractPath) {
    const contractMod = await import(pathToFileURL(openContractPath).href);
    contractValidate = contractMod.validatePlaneSource;
    contractAllowedGeometries = contractMod.ALLOWED_GEOMETRIES;
    antiSmugglingRule = contractMod.ANTI_SMUGGLING_RULE ?? null;
  }
  const contractPathForReasons = openContractPath || CONTRACT_PATH;
  const forbiddenReasons = extractForbiddenReasons(contractPathForReasons);
  const shotsDirAbs = path.resolve(shotsDir);
  const refPaths = copyReferenceImagesFn(shotsDirAbs);

  const candidateAbs = path.resolve(candidatePath);
  const candidateDir = path.dirname(candidateAbs);
  const originalSource = readFileSync(candidateAbs, 'utf8');
  const originalSha = sha256(originalSource);

  const gemmaHint = anchorHint(rubric, gemmaResult.weakest_feature, 'gemma4');
  const claudeHint = claudeResult
    ? anchorHint(rubric, claudeResult.weakest_feature, `claude ${claudeResult.judge_model}`)
    : null;
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
    priorAttemptsSection,
    designReferenceSection,
    strategyCheatsheetSection,
    badAttemptsSection,
    rejectedEditsSection,
    plateauEscalation,
    burstStatusSection,
    measuredFeedbackSection,
    contractOpen: Boolean(openContractPath),
    contractPathLabel: contractLabel || (openContractPath ? path.basename(openContractPath) : 'lib/contract.mjs'),
    antiSmugglingRule,
    allowedGeometries: contractAllowedGeometries,
  });

  const useModel = model || DEFAULT_MODEL;
  const useEffort = effort || DEFAULT_EFFORT;
  const useTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : ACTOR_TIMEOUT_MS;
  const started = Date.now();
  let outer = null;
  let actorError = null;
  let observability;
  let timedOut = false;
  let denied = false;
  try {
    outer = await callTerranSoulAgentTask({
      prompt,
      candidateDir,
      shotsDirAbs,
      model: useModel,
      effort: useEffort,
      timeoutMs: useTimeoutMs,
      cliBinary,
      cliDataDir,
      execImpl,
    });
    observability = outer.observability || null;
  } catch (err) {
    actorError = String(err.message || err);
    observability = err.observability || null;
    timedOut = Boolean(err.timed_out);
    denied = Boolean(err.denied);
  }
  const ms = outer ? Number(outer.duration_ms) || Date.now() - started : Date.now() - started;
  const costUsd = outer ? Number(outer.total_cost_usd) || 0 : 0;

  const editedSource = existsSync(candidateAbs) ? readFileSync(candidateAbs, 'utf8') : '';
  const editedSha = sha256(editedSource);
  const changed = editedSha !== originalSha;

  const base = {
    model: useModel,
    effort: useEffort,
    ms,
    cost_usd: costUsd,
    timeout_ms: useTimeoutMs,
    observability,
    timed_out: timedOut,
    // NEW (WIRE-CLI-PARITY-GAP-3 rewire): whether this failure was an
    // `action_trust` ledger DENIAL rather than a timeout/crash — a longer
    // retry timeout can never change a trust decision, so callers (lib/
    // actor-retry.mjs's shouldRetryActor) use this to stop retrying
    // immediately instead of burning the whole backoff schedule on a call
    // that is guaranteed to be denied again.
    denied,
  };

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

  const contract = contractValidate(editedSource);
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

  // Static contract validation is text-only (forbidden tokens + geometry
  // whitelist) — it cannot see a runtime bug like an undefined variable
  // reference, which only throws when buildPlane() actually executes. That
  // gap let a broken edit reach disk once (`group.add(door)`, `door` never
  // declared): the edit was accepted as 'edited', and the NEXT iteration's
  // rig render crashed the whole loop process with an uncaught
  // ReferenceError. Smoke-test the edit the same way the rig will run it —
  // actually call buildPlane(THREE) with the real three.js the rig renders
  // with — before ever accepting it.
  const smoke = await smokeCheckPlane(candidateAbs);
  if (!smoke.ok) {
    writeFileSync(candidateAbs, originalSource);
    return {
      ...base,
      status: 'runtime_failed',
      runtime_error: smoke.error,
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
        'usage: actor-claude.mjs --plane <plane.js> --shots <dir> --gemma-results <results.json> --claude-results <results.json> [--model claude-fable-5] [--effort max] [--timeout-ms N] [--cli-bin <path>] [--cli-data-dir <dir>] [--out <result.json>]',
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
      timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
      cliBinary: typeof args['cli-bin'] === 'string' ? args['cli-bin'] : undefined,
      cliDataDir: typeof args['cli-data-dir'] === 'string' ? args['cli-data-dir'] : undefined,
    });
    if (args.out) writeFileSync(path.resolve(args.out), JSON.stringify(result, null, 2));
    console.log(`ACTOR_${result.status.toUpperCase()} ${JSON.stringify(result)}`);
    if (['actor_failed', 'contract_failed', 'runtime_failed'].includes(result.status)) process.exitCode = 1;
  };
  run().catch((err) => {
    console.error(`ACTOR_FAIL ${err.message}`);
    process.exit(1);
  });
}
