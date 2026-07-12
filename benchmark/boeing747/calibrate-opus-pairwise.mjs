// Calibrate the `--judge opus-pairwise` per-view bar for the Boeing-747 bench and
// write the SIDECAR calibration/opus-pairwise.json (NOT rubric.json — the frozen
// rubric stays byte-identical, so the gemma primitives record is unaffected).
//
// This is the ONE step that needs the real rig (GPU/Playwright) and the live
// `claude`/gemma judges; it runs offline ONCE before any opus-pairwise loop. It:
//   1. renders the fixed REFERENCE BUILD (candidates/terransoul-opus48/plane.js)
//      through the frozen rig and caches the shots at calibration/ref-shots/
//      (judge-only — NEVER placed in the actor's --grant-dir), stamped with the
//      rig meta (camera_spec_version/three_revision/supersample) for review fix #6;
//   2. runs the Opus pairwise panel with candidate:=reference TWICE (PROBE A
//      identity/anchor ~5.0 + PROBE B noise band -> per-view sigma + epsilon_total);
//   3. runs the Opus pairwise panel with candidate:=a known-weaker build (the
//      committed `stub`) (PROBE C discrimination — must map clearly below the bar);
//   4. runs the FROZEN gemma pointwise judge on the reference (cross-family veto
//      reference scores);
//   5. derives the per-view bars (review fix #3: bar margin >= certified Probe-A
//      residual; epsilon_anchor forced below the smallest bar margin or ABORT) and
//      writes the sidecar — refusing to write when any health probe fails.
//
// The bar/margin/probe MATH is PURE (lib/pairwise-config.mjs) and unit-tested; the
// probe->sidecar ASSEMBLY (calibrateFromProbes / perViewScores) is PURE and tested
// here with canned judge-result objects — no GPU/CLI needed to validate the logic.
//
// CO-EVOLVE (owner-gated ratchet): `--promote <plane.js>` re-runs calibration with
// that build as the NEW reference (an explicit, logged re-baseline — same class as
// the never-regress / camera-spec re-baselines). A just-tying candidate then scores
// 5.0 against ITSELF and must find NEW gains; a single run cannot bank a static
// "tied-myself" 100% as the final answer. Never automatic mid-run.
//
// CLI:
//   node calibrate-opus-pairwise.mjs [--reference <plane.js>] [--weak <plane.js>]
//     [--samples K] [--model claude-opus-4-8] [--gemma-samples N] [--promote <plane.js>]
//     [--write] [--force]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWS } from './lib/cameras.mjs';
import {
  buildPairwiseSidecar,
  computeCalibration,
  DEFAULT_GEMMA_VETO_BAND,
} from './lib/pairwise-config.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');
const CALIBRATION_DIR = path.join(BENCH_DIR, 'calibration');
const REF_SHOTS_DIR = path.join(CALIBRATION_DIR, 'ref-shots');
const SIDECAR_PATH = path.join(CALIBRATION_DIR, 'opus-pairwise.json');
const DEFAULT_REF_PLANE = path.join(BENCH_DIR, 'candidates', 'terransoul-opus48', 'plane.js');
const DEFAULT_WEAK_PLANE = path.join(BENCH_DIR, 'candidates', 'stub', 'plane.js');

/**
 * PURE — extract the per-view score array (ordered by the frozen VIEWS 1..9) from
 * any judge result object ({ per_view:[{view, score}] }). A view missing from the
 * result (or with a non-numeric score) yields null in that slot so the downstream
 * probe predicates treat it as unjudged, never as a 0.
 *
 * @param {Object} judgeResult
 * @returns {Array<number|null>}
 */
export function perViewScores(judgeResult) {
  const byView = new Map();
  const list = judgeResult && Array.isArray(judgeResult.per_view) ? judgeResult.per_view : [];
  for (const v of list) {
    if (v && typeof v.view === 'number') byView.set(v.view, v.score);
  }
  return VIEWS.map((view) => {
    const s = byView.get(view.id);
    return typeof s === 'number' && Number.isFinite(s) ? s : null;
  });
}

/** PURE — the run total (0..100) from a judge result, or null. */
function totalOf(judgeResult) {
  const t = judgeResult ? judgeResult.total_0_100 : null;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

/**
 * PURE probe->sidecar assembly: derive the calibration (bars, margins, probe
 * verdicts) from the collected judge-result objects and build the sidecar. No
 * I/O, so this is unit-testable with canned results (see the test at the bottom
 * of this file's sibling spec). The caller decides whether to WRITE based on
 * `calibration.abort`.
 *
 * @param {Object} p
 * @param {Object[]} p.identityResults  >=2 identity (candidate:=reference) panel results (Probe A+B).
 * @param {Object}   p.weakResult       discrimination panel result (candidate:=weak build, Probe C).
 * @param {Object}   p.gemmaResult      frozen gemma pointwise result on the reference.
 * @param {Object}   p.referenceMeta    reference-render meta.json (rig stamp).
 * @param {string}   p.refShotsDir      cached reference-shots dir (relative, judge-only).
 * @param {Object}   [p.options]        margin/z/floor/epsilonAnchor/drop/gemmaVetoBand.
 * @param {string}   [p.judgeModel]
 * @returns {{calibration:Object, sidecar:Object}}
 */
export function calibrateFromProbes({
  identityResults,
  weakResult,
  gemmaResult,
  referenceMeta,
  refShotsDir,
  options = {},
  judgeModel = 'claude-opus-4-8',
}) {
  const panels = (Array.isArray(identityResults) ? identityResults : []).map(perViewScores);
  const totals = (Array.isArray(identityResults) ? identityResults : []).map(totalOf);
  const weakPerView = perViewScores(weakResult);
  const calibration = computeCalibration({
    identityPanels: panels,
    identityTotals: totals,
    weakPerView,
    options,
  });
  const sidecar = buildPairwiseSidecar({
    calibration,
    referenceMeta,
    refShotsDir,
    K: calibration.recommendedK,
    gemmaReferencePerView: perViewScores(gemmaResult),
    options,
    judgeModel,
  });
  return { calibration, sidecar };
}

/** Log the per-view calibration table + probe verdicts to the console. */
function printCalibration(calibration) {
  console.log('\nPER-VIEW PAIRWISE CALIBRATION (candidate-vs-reference; parity 5.0 = ties the reference build):');
  VIEWS.forEach((v, i) => {
    const d = calibration.barDetails[i];
    console.log(
      `  view ${v.id} (${v.key}): P_hat ${calibration.pHatPerView[i]} sigma ${calibration.perViewSigma[i]} ` +
        `-> bar ${d.bar} (margin ${d.marginScore}, residual ${d.residualScore}${d.floored ? ', FLOORED' : ''})`,
    );
  });
  console.log(`\nbars = [${calibration.bars.join(', ')}]`);
  console.log(`epsilon_total = ${calibration.epsilonTotal}   epsilon_view = ${calibration.epsilonView}   recommended K = ${calibration.recommendedK}`);
  console.log(
    `PROBE A (anchor): ${calibration.anchor.passed ? 'PASS' : 'FAIL'} ` +
      `(epsilon_anchor ${calibration.anchor.epsilonAnchor} <= smallest bar margin ${calibration.anchor.smallestBarMargin}: ${calibration.anchor.epsilonBelowBars})`,
  );
  console.log(`PROBE C (discrimination): ${calibration.discrimination.passed ? 'PASS' : 'FAIL'} (drop ${calibration.discrimination.drop})`);
  if (calibration.abort) {
    console.log('\nABORT — calibration is NOT trustworthy:');
    for (const r of calibration.abortReasons) console.log(`  - ${r}`);
  }
}

/**
 * LIVE orchestration (guarded — never runs at import). Renders the reference +
 * weak builds through the frozen rig, runs the three Opus pairwise probes + the
 * frozen gemma pointwise judge, assembles the sidecar via calibrateFromProbes,
 * and writes it (only with --write, and only when no health probe aborted).
 */
async function runCalibration(args) {
  // Lazy import the heavy live deps so `import`-ing this module for its pure
  // helpers (and the tests) never loads Playwright / the judges.
  const { runRig } = await import('./rig/render-rig.mjs');
  const { judgeShotsPairwise } = await import('./judge/judge-pairwise.mjs');
  const { judgeShots } = await import('./judge/judge.mjs');

  const promote = typeof args.promote === 'string' ? args.promote : null;
  const refPlane = promote || (typeof args.reference === 'string' ? args.reference : DEFAULT_REF_PLANE);
  const weakPlane = typeof args.weak === 'string' ? args.weak : DEFAULT_WEAK_PLANE;
  const samples = args.samples ? Number(args.samples) : 1;
  const model = typeof args.model === 'string' ? args.model : undefined;

  if (promote) {
    console.log(`PROMOTE (owner-gated re-baseline): the new reference build is ${path.relative(REPO_ROOT, path.resolve(promote))}`);
  }
  mkdirSync(CALIBRATION_DIR, { recursive: true });

  // 1. Render the reference build ONCE and cache the shots (judge-only).
  console.log(`CALIBRATION: rendering reference build ${path.relative(REPO_ROOT, path.resolve(refPlane))} -> calibration/ref-shots`);
  const refRig = await runRig({ planePath: refPlane, runId: 'ref-shots', outRoot: CALIBRATION_DIR });

  // 2. PROBE A + B: identity panels (candidate:=reference), run twice for the
  //    noise band. Force each so the second run re-judges rather than caching.
  console.log('CALIBRATION: PROBE A/B identity panels (candidate:=reference) x2...');
  const identityResults = [];
  for (let panel = 0; panel < 2; panel++) {
    const res = await judgeShotsPairwise({
      shotsDir: refRig.outDir,
      referenceShotsDir: refRig.outDir,
      samples,
      model,
      force: true,
      out: path.join(CALIBRATION_DIR, `probe-identity-${panel + 1}.json`),
    });
    if (!res) throw new Error(`identity probe panel ${panel + 1} did not complete all 9 views`);
    identityResults.push(res);
  }

  // 3. PROBE C: discrimination panel (candidate:=weak build).
  console.log(`CALIBRATION: PROBE C discrimination panel (candidate:=${path.relative(REPO_ROOT, path.resolve(weakPlane))})...`);
  const weakRig = await runRig({ planePath: weakPlane, runId: 'weak-probe', outRoot: CALIBRATION_DIR });
  const weakResult = await judgeShotsPairwise({
    shotsDir: weakRig.outDir,
    referenceShotsDir: refRig.outDir,
    samples,
    model,
    force: true,
    out: path.join(CALIBRATION_DIR, 'probe-discrimination.json'),
  });
  if (!weakResult) throw new Error('discrimination probe did not complete all 9 views');

  // 4. Frozen gemma pointwise reference scores (cross-family veto reference).
  console.log('CALIBRATION: frozen gemma pointwise judge on the reference build...');
  const gemmaResult = await judgeShots({
    shotsDir: refRig.outDir,
    force: true,
    out: path.join(CALIBRATION_DIR, 'probe-gemma-reference.json'),
  });
  if (!gemmaResult) throw new Error('gemma reference judge did not complete all 9 views');

  // 5. Assemble + validate.
  const options = {
    gemmaVetoBand: args['gemma-veto-band'] ? Number(args['gemma-veto-band']) : DEFAULT_GEMMA_VETO_BAND,
  };
  const { calibration, sidecar } = calibrateFromProbes({
    identityResults,
    weakResult,
    gemmaResult,
    referenceMeta: refRig,
    refShotsDir: path.relative(REPO_ROOT, REF_SHOTS_DIR).replace(/\\/g, '/'),
    options,
    judgeModel: model || 'claude-opus-4-8',
  });
  printCalibration(calibration);

  if (calibration.abort) {
    throw new Error('calibration aborted by a failed health probe (see reasons above) — NOT writing the sidecar');
  }
  if (args.write) {
    writeFileSync(SIDECAR_PATH, `${JSON.stringify(sidecar, null, 2)}\n`);
    console.log(`\nWROTE ${path.relative(REPO_ROOT, SIDECAR_PATH)} (rubric.json untouched — gemma record unaffected).`);
  } else {
    console.log('\n(dry run — pass --write to persist calibration/opus-pairwise.json)');
  }
  return sidecar;
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
  runCalibration(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`CALIBRATE_PAIRWISE_FAIL ${err.message}`);
    process.exit(1);
  });
}
