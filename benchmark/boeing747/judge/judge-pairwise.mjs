// Claude Opus 4.8 BLIND, ORDER-SWAPPED, REFERENCE-BUILD-ANCHORED PAIRWISE judge
// for the Boeing 747 primitives vision benchmark — the `--judge opus-pairwise`
// gating track.
//
// WHY (PAIRWISE_JUDGE_SPEC): the pointwise-absolute Opus judge (judge-claude.mjs)
// was the proven-weakest link — it compressed the gradient near the top of the
// rubric and no build ever reached the uniform 8.0 bar. Instead, per view, we
// ask Opus which of TWO blind renders — the CANDIDATE and a FIXED reference-build
// render — depicts the real 747 (as shown in the two committed reference photos)
// MORE FAITHFULLY, and we issue the SAME comparison TWICE with the physical A/B
// files swapped. The parity of the candidate against a strong photo-anchored
// build is scored on the FROZEN scoring pipeline so the emitted object is
// byte-shape-identical to judgeShotsClaude and every downstream consumer
// (bookkeepTrack / filterGenuineIterationsForStopConditions /
// evaluateStopConditions / buildActorPrompt) reads it with ZERO shape changes.
//
// HONEST LABEL: clearing the per-view parity bar means ">= the reference BUILD
// (itself photo-anchored)", NOT "indistinguishable from a real 747 photograph".
// The reference build's own residual gap to a real 747 is a disclosed bound.
//
// TRANSPORT: reuses the SAME `claude` CLI spawn as the pointwise judge via the
// exported callClaudeCliVision (judge-claude.mjs) — `execImpl` is the injectable
// test seam, so this whole file is unit-testable with canned CLI JSON and NO
// network / GPU (see judge/judge-pairwise.test.mjs).
//
// REVIEW FIX #1 (blocking): order-INCONSISTENT (flipped) and NA panels are
// routed to UNDECIDED upstream (lib/pairwise-parse.mjs reconcileOrders) — they
// only lower decided_fraction and can NEVER manufacture a hollow 0.5-parity
// (per-view 5.0) clear on the hard detail views. See lib/pairwise-scoring.mjs.
//
// REVIEW FIX #6 (blocking): the cached reference render is compared to the
// candidate only when the rig meta (camera_spec_version + three_revision +
// supersample) MATCHES; a mismatch means the two renders were produced under
// DIFFERENT rigs — an invalid, silently-biased comparison — so we REFUSE to
// score and tell the operator to re-render the cached reference shots.
//
// CLI:
//   node judge/judge-pairwise.mjs --shots <dir> --reference <ref-shots-dir>
//     [--views 1,2,3] [--samples K] [--out <file>] [--force] [--model <id>]
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { VIEWS } from '../lib/cameras.mjs';
import { parseComparisonsReply, reconcilePanel } from '../lib/pairwise-parse.mjs';
import { aggregateViews, isVisibleCriterion, scoreView } from '../lib/pairwise-scoring.mjs';
import { median } from '../lib/scoring.mjs';
import { callClaudeCliVision, loadReferencePaths } from './judge-claude.mjs';
import { loadRubric } from './judge.mjs';

const execFileAsync = promisify(execFile);

// Default model track for the report label; the CLI already defaults to the
// session's Opus 4.8, so we don't force --model unless overridden. The pairwise
// track stamps its own `-pairwise-vision` suffix so it never collides with the
// pointwise `-vision` label in reports.
const DEFAULT_MODEL_LABEL = 'claude-opus-4-8';

/** Round a USD cost to 6 decimals (matches the pointwise judge). */
function round6(x) {
  return Math.round((x || 0) * 1e6) / 1e6;
}

/**
 * REVIEW FIX #6 — refuse to score a candidate against a STALE cached reference
 * render. The cached reference shots are rendered ONCE at calibration while the
 * candidate re-renders every iteration; if the rig changed (SSAA supersample,
 * camera_spec_version, three_revision) the two are no longer pixel-comparable.
 * Stamp equality is asserted here; a mismatch throws (the caller must re-render
 * the reference via calibrate-opus-pairwise.mjs). supersample is normalized to
 * its frozen default (1) so an unstamped legacy meta compares cleanly.
 *
 * @param {Object} candidateMeta  the shots-dir meta.json.
 * @param {Object} referenceMeta  the reference-shots-dir meta.json.
 */
export function assertReferenceRigMatches(candidateMeta, referenceMeta) {
  const cand = candidateMeta || {};
  const ref = referenceMeta || {};
  const mismatches = [];
  if (cand.cameraSpecVersion !== ref.cameraSpecVersion) {
    mismatches.push(`camera_spec_version: candidate=${cand.cameraSpecVersion} reference=${ref.cameraSpecVersion}`);
  }
  if (cand.threeRevision !== ref.threeRevision) {
    mismatches.push(`three_revision: candidate=${cand.threeRevision} reference=${ref.threeRevision}`);
  }
  if ((cand.supersample ?? 1) !== (ref.supersample ?? 1)) {
    mismatches.push(`supersample: candidate=${cand.supersample ?? 1} reference=${ref.supersample ?? 1}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      'pairwise reference-rig mismatch — the cached reference shots were rendered under a different rig ' +
        'and are no longer comparable to the candidate. Re-render them (calibrate-opus-pairwise.mjs) before ' +
        `judging. Mismatches: ${mismatches.join('; ')}`,
    );
  }
}

/**
 * Build the per-view pairwise prompt from the EXACT verbatim template
 * (EXACT_OPUS_PAIRWISE_PROMPT). Only the two RENDER paths differ between the AB
 * and BA orders — the prompt TEXT is otherwise byte-identical, so the judge is
 * BLIND to which render is the candidate being improved. `visible` is the view's
 * structurally-assessable criteria (masked criteria are omitted from the ask).
 *
 * @param {Object} params
 * @param {Object} params.view          camera view ({ id, name }).
 * @param {string} params.renderAPath   file path bound to RENDER-A.
 * @param {string} params.renderBPath   file path bound to RENDER-B.
 * @param {Object} params.refA          reference photo 1 ({ depicts, file }).
 * @param {Object} params.refB          reference photo 2 ({ depicts, file }).
 * @param {Array}  params.visible       visible rubric criteria for this view.
 * @returns {string}
 */
export function buildPairwisePrompt({ view, renderAPath, renderBPath, refA, refB, visible }) {
  const criteriaBlock = visible
    .map((c) => `- ${c.id} (${c.name}): 5=${c.anchors['5']}; 8=${c.anchors['8']}; 10=${c.anchors['10']}`)
    .join('\n');
  const criteriaJsonKeys = visible
    .map(
      (c) =>
        `"${c.id}": {"evidence_a": "<visible feature in RENDER-A>", "evidence_b": "<visible feature in RENDER-B>", ` +
        '"verdict": "A_much_better|A_better|tie|B_better|B_much_better|NA", "confidence": "low|medium|high"}',
    )
    .join(', ');
  return [
    'You are a meticulous aircraft-model judge for a 3D-modeling benchmark. Judge ONLY from the four images provided. Do not use web search or any outside knowledge — judge only what the images show.',
    '',
    'Use the Read tool to open these FOUR image files, then judge:',
    `  RENDER-A (a 3D model of an aircraft) = ${renderAPath}`,
    `  RENDER-B (a 3D model of an aircraft) = ${renderBPath}`,
    `  REAL-PHOTO-1 (a real Boeing 747: ${refA.depicts}) = ${refA.file}`,
    `  REAL-PHOTO-2 (a real Boeing 747: ${refB.depicts}) = ${refB.file}`,
    '',
    `RENDER-A and RENDER-B are two different Three.js models of a Boeing 747, rendered from the SAME camera (view ${view.id} of 9 — ${view.name}). REAL-PHOTO-1 and REAL-PHOTO-2 show the REAL aircraft and DEFINE GROUND TRUTH; they are NOT being scored. Neither render is "yours" and neither is privileged — judge them impartially and literally: describe what is actually rendered, never assume hidden parts exist.`,
    '',
    'For EACH criterion listed below, do THREE things IN THIS ORDER:',
    '  1. "evidence_a": name the ONE specific feature ACTUALLY VISIBLE in RENDER-A that is relevant to this criterion (a concrete visible fact, not a guess about hidden parts).',
    '  2. "evidence_b": the same concrete visible fact for RENDER-B.',
    '  3. "verdict": decide which render depicts the REAL 747 (as shown in the two photos) MORE FAITHFULLY on THIS criterion — exactly one of:',
    '       "A_much_better", "A_better", "tie", "B_better", "B_much_better", or "NA".',
    '     Reserve "A_much_better"/"B_much_better" for a clear, unmistakable difference you have JUST cited concrete visible evidence for. Use "tie" when the two are indistinguishable on this criterion. Use "NA" ONLY if this criterion genuinely cannot be assessed from this camera angle for BOTH renders.',
    'Also give "confidence": "low", "medium", or "high".',
    '',
    'CRITERIA (assess ONLY these; each anchor names the real-747 target for that criterion):',
    criteriaBlock,
    '',
    'Your FINAL message MUST be STRICT JSON ONLY — no markdown, no code fence, no prose before or after — exactly this shape:',
    `{"comparisons": {${criteriaJsonKeys}}, "notes": "<max 40 words of factual, cross-model observations>"}`,
    '',
    'Emit exactly one entry per criterion listed above and nothing else.',
  ].join('\n');
}

/**
 * Median CANDIDATE-relative combined magnitude across a criterion's decided
 * panels (used only to pick the sign for the actor-facing "candidate lost"
 * notes; the numeric score itself flows through the frozen scoring pipeline in
 * lib/pairwise-scoring.mjs). Returns null when nothing was decided.
 */
function medianCombined(panels) {
  const vals = (panels || [])
    .filter((p) => p && p.decided && p.combined !== null && Number.isFinite(p.combined))
    .map((p) => p.combined);
  return median(vals);
}

/**
 * Build the actor-facing per-view `notes`: the deciding evidence from the
 * criteria where the CANDIDATE LOST (median combined < 0) — richer, more
 * actionable feedback than a pointwise number ("on THIS view you trail the
 * reference specifically on X because it shows Y"). Falls back to the judge's
 * own cross-model observation when the candidate lost nothing.
 */
function buildViewNotes(criteriaPanels, evidenceByCrit, panelNotes) {
  const lost = [];
  for (const id of Object.keys(criteriaPanels)) {
    const m = medianCombined(criteriaPanels[id]);
    if (m !== null && m < 0) {
      const ev = evidenceByCrit[id];
      lost.push(ev ? `${id}: reference shows ${ev}` : `${id}: trails the reference`);
    }
  }
  const parts = lost.length > 0 ? lost : panelNotes.slice(0, 1);
  return parts.join(' | ').slice(0, 400);
}

/**
 * Judge ONE view: run K order-swapped panels (candidate vs the fixed reference
 * render) over the view's VISIBLE criteria, reconcile each panel via
 * lib/pairwise-parse.mjs, then score via the FROZEN lib/pairwise-scoring.mjs
 * pipeline. Fail-open: a panel whose CLI call or reply parse fails is DROPPED
 * (recorded in judge_errors / panels_dropped), never zeroing a score.
 */
async function judgeOneViewPairwise({ rubric, refs, model, candidateDir, referenceDir, view, K, execImpl }) {
  const candidateShot = path.join(candidateDir, `view-${view.id}.png`);
  const referenceShot = path.join(referenceDir, `view-${view.id}.png`);
  const refKeys = rubric.view_references[String(view.id)];
  const [refA, refB] = refKeys.map((k) => refs[k]);

  const visible = rubric.criteria.filter((c) => isVisibleCriterion(c.id, view.id, rubric.view_visibility));
  const visibleIds = visible.map((c) => c.id);

  // Blind labeling: only the two RENDER paths differ between AB and BA. The
  // reference render path lives under referenceDir (the calibration cache) and
  // is NEVER the actor's --grant-dir candidate path.
  const promptAB = buildPairwisePrompt({ view, renderAPath: candidateShot, renderBPath: referenceShot, refA, refB, visible });
  const promptBA = buildPairwisePrompt({ view, renderAPath: referenceShot, renderBPath: candidateShot, refA, refB, visible });

  const criteriaPanels = {};
  for (const id of visibleIds) criteriaPanels[id] = [];
  const evidenceByCrit = {};
  const panelNotes = [];
  const errors = [];
  let cost = 0;
  let panelsRun = 0;
  let panelsDropped = 0;

  for (let k = 0; k < K; k++) {
    let abParsed;
    let baParsed;
    try {
      // AB order: candidate=A, reference=B.
      const ab = await callClaudeCliVision({ prompt: promptAB, model, execImpl });
      cost += ab.cost;
      abParsed = parseComparisonsReply(ab.resultText, visibleIds);
      // BA order: reference=A, candidate=B (physical files swapped, same text).
      const ba = await callClaudeCliVision({ prompt: promptBA, model, execImpl });
      cost += ba.cost;
      baParsed = parseComparisonsReply(ba.resultText, visibleIds);
    } catch (err) {
      // A whole panel needs BOTH orders to reconcile; drop it fail-open.
      panelsDropped += 1;
      errors.push(String(err && err.message ? err.message : err));
      continue;
    }
    panelsRun += 1;
    if (abParsed.notes) panelNotes.push(abParsed.notes);
    for (const id of visibleIds) {
      const rec = reconcilePanel(abParsed.comparisons[id], baParsed.comparisons[id]);
      criteriaPanels[id].push(rec);
      // In the AB call the candidate is physical slot A, so the REFERENCE's
      // winning feature is evidence_b — capture the first one for the notes.
      if (!evidenceByCrit[id]) {
        const abComp = abParsed.comparisons[id];
        if (abComp && typeof abComp.evidence_b === 'string' && abComp.evidence_b.trim()) {
          evidenceByCrit[id] = abComp.evidence_b.trim();
        }
      }
    }
  }

  const scored = scoreView({
    view,
    criteriaPanels,
    criteria: rubric.criteria,
    viewVisibility: rubric.view_visibility,
  });

  return {
    ...scored,
    refs: refKeys,
    notes: buildViewNotes(criteriaPanels, evidenceByCrit, panelNotes),
    all_notes: panelNotes,
    panels_run: panelsRun,
    panels_dropped: panelsDropped,
    judge_errors: errors.length,
    judge_error_details: errors,
    cost_usd: round6(cost),
  };
}

/**
 * Run the full BLIND ORDER-SWAPPED PAIRWISE judge over the nine views and emit
 * an object BYTE-SHAPE-IDENTICAL to judgeShotsClaude (plus the pairwise-only
 * decided_fraction / inconclusive / reference_plane_sha256 fields) so the loop
 * runner, stop-conditions and actor-prompt builder consume it unchanged.
 *
 * @param {Object}   params
 * @param {string}   params.shotsDir           candidate render dir (view-N.png + meta.json).
 * @param {string}   params.referenceShotsDir  cached reference-build render dir (calibration).
 * @param {number[]} [params.views]            optional view-id subset (default all 9).
 * @param {string}   [params.out]              optional results.json path.
 * @param {boolean}  [params.force]            re-judge already-cached views.
 * @param {number}   [params.samples]          K panels per view (default 1 = order-swap only).
 * @param {string}   [params.model]            optional --model override.
 * @param {Function} [params.execImpl]         subprocess seam (default execFileAsync).
 * @param {Function} [params.loadReferencePathsFn] reference-photo loader seam (test-only).
 * @returns {Promise<Object|null>} the results object, or null if any view is unjudged.
 */
export async function judgeShotsPairwise({
  shotsDir,
  referenceShotsDir,
  views,
  out,
  force,
  samples,
  model,
  execImpl = execFileAsync,
  loadReferencePathsFn = loadReferencePaths,
}) {
  if (!referenceShotsDir) {
    throw new Error('judgeShotsPairwise requires referenceShotsDir (the cached reference-build render dir)');
  }
  const { rubric, rubricSha256 } = loadRubric();
  const refs = loadReferencePathsFn(rubric);
  const K = Number.isInteger(samples) && samples > 0 ? samples : 1;
  const modelLabel = model || DEFAULT_MODEL_LABEL;
  const dir = path.resolve(shotsDir);
  const refDir = path.resolve(referenceShotsDir);
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const refMeta = JSON.parse(readFileSync(path.join(refDir, 'meta.json'), 'utf8'));
  // REVIEW FIX #6: refuse to score against a stale/rig-mismatched reference.
  assertReferenceRigMatches(meta, refMeta);

  const judgeDir = path.join(dir, 'judge-pairwise');
  mkdirSync(judgeDir, { recursive: true });

  const wanted = views && views.length > 0 ? views : VIEWS.map((v) => v.id);
  for (const viewId of wanted) {
    const view = VIEWS.find((v) => v.id === viewId);
    if (!view) throw new Error(`unknown view ${viewId}`);
    const partial = path.join(judgeDir, `view-${view.id}.json`);
    if (existsSync(partial) && !force) {
      console.log(`SKIP view ${view.id} (already judged; --force to redo)`);
      continue;
    }
    process.stdout.write(`opus-pairwise-judging view ${view.id} (${view.key}) x${K} panels... `);
    const result = await judgeOneViewPairwise({
      rubric,
      refs,
      model,
      candidateDir: dir,
      referenceDir: refDir,
      view,
      K,
      execImpl,
    });
    writeFileSync(partial, JSON.stringify(result, null, 2));
    console.log(
      `score=${result.score} decided=${result.decided_fraction} (dropped=${result.panels_dropped}, $${result.cost_usd})`,
    );
  }

  const perView = [];
  for (const view of VIEWS) {
    const partial = path.join(judgeDir, `view-${view.id}.json`);
    if (!existsSync(partial)) {
      console.log(`INCOMPLETE: view ${view.id} not judged yet — rerun with --views ${view.id}`);
      return null;
    }
    perView.push(JSON.parse(readFileSync(partial, 'utf8')));
  }

  const agg = aggregateViews(perView, rubric.criteria, rubric.view_visibility);
  const totalCost = round6(perView.reduce((a, v) => a + (v.cost_usd || 0), 0));
  const results = {
    protocol: rubric.protocol,
    judge_track: `${modelLabel}-pairwise-vision`,
    rubric_version: rubric.version,
    rubric_sha256: rubricSha256,
    judge_model: modelLabel,
    judge_samples: K,
    supersample: meta.supersample ?? 1,
    run_id: meta.runId,
    plane_path: meta.planePath,
    plane_sha256: meta.planeSha256,
    camera_spec_version: meta.cameraSpecVersion,
    three_revision: meta.threeRevision,
    reference_plane: refMeta.planePath,
    reference_plane_sha256: refMeta.planeSha256,
    reference_shots_dir: refDir,
    reference_sha256: Object.fromEntries(Object.values(refs).map((r) => [r.key, r.sha256])),
    per_view: perView.map((v) => ({
      view: v.view,
      key: v.key,
      score: v.score,
      score_unmasked: v.score_unmasked,
      masked_out: v.masked_out,
      criteria_medians: v.criteria_medians,
      notes: v.notes,
      decided_fraction: v.decided_fraction,
      inconclusive: v.inconclusive,
    })),
    total_0_100: agg.total_0_100,
    total_0_100_unmasked: agg.total_0_100_unmasked,
    scored_views: agg.scored_views,
    missing_views: agg.missing_views,
    weakest_feature: agg.weakest_feature,
    total_cost_usd: totalCost,
    created_at: new Date().toISOString(),
  };
  const outFile = path.resolve(out || path.join(judgeDir, 'results.json'));
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(
    `TOTAL ${agg.total_0_100}/100 over ${agg.scored_views} views (missing ${agg.missing_views}) — ` +
      `Opus 4.8 pairwise vision, $${totalCost}`,
  );
  console.log(`WEAKEST_FEATURE ${agg.weakest_feature ? agg.weakest_feature.id : 'n/a'}`);
  console.log(`JUDGE_OK ${outFile}`);
  return results;
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
    if (!args.shots || !args.reference) {
      throw new Error(
        'usage: judge-pairwise.mjs --shots <dir> --reference <ref-shots-dir> [--views 1,2,3] [--samples K] [--out <file>] [--force] [--model <id>]',
      );
    }
    const parsedViews = typeof args.views === 'string' ? args.views.split(',').map(Number) : null;
    await judgeShotsPairwise({
      shotsDir: args.shots,
      referenceShotsDir: args.reference,
      views: parsedViews,
      out: args.out,
      force: args.force === true,
      samples: args.samples ? Number(args.samples) : 1,
      model: typeof args.model === 'string' ? args.model : undefined,
    });
  };
  run().catch((err) => {
    console.error(`JUDGE_PAIRWISE_FAIL ${err.message}`);
    process.exit(1);
  });
}
