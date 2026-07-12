// Calibrate the Opus-4.8-panel per-view bar for the Boeing-747 bench.
// (owner decision 2026-07-12, option 4 = judge panel + CALIBRATED bar)
//
// "100%" for the opus-panel track = a candidate scores, on EVERY one of the 9
// views, at least as high as a fixed REFERENCE BUILD does under the SAME Opus
// 4.8 vision panel (reference-anchored against the real 747 photos). This script
// renders that reference build, runs the Opus panel on it, and writes the
// resulting per-view scores (minus a small robustness margin) into rubric.json
// as `view_threshold_calibrated` (a length-9 array indexed by view 1..9).
//
// WHY a reference BUILD, not an arbitrary 8.0: the audit (2026-07-12) proved a
// VLM scores pointwise-absolute in a compressed band, so an "8.0 on every view"
// bar is unreachable by ANY build — not even the reference (Opus scored the
// strong frozen build's views 4.3-6.1). Two capable judges agreed on ZERO views
// clearing 8.0. Anchoring the bar to what the Opus panel gives a strong, fixed
// reference 747 makes "100%" MEANINGFUL ("as good as the reference 747 from
// every angle") and ACHIEVABLE (a great mesh build can match/exceed it). The bar
// is fully inspectable and printed here; --write is required to mutate rubric.json.
//
// CLI:
//   node calibrate-opus-panel.mjs [--plane <ref plane.js>] [--samples N]
//     [--margin M] [--model claude-opus-4-8] [--write] [--tag <id>]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWS } from './lib/cameras.mjs';
import { judgeShotsClaude } from './judge/judge-claude.mjs';
import { runRig } from './rig/render-rig.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');
const RUBRIC_PATH = path.join(BENCH_DIR, 'rubric.json');
const DEFAULT_REF_PLANE = path.join(BENCH_DIR, 'candidates', 'terransoul-opus48', 'plane.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const refPlane = typeof args.plane === 'string' ? args.plane : DEFAULT_REF_PLANE;
  const samples = args.samples ? Number(args.samples) : 3;
  // Small robustness margin: the bar is (reference score - margin), so "100%"
  // means "within `margin` of the reference 747, or better" — absorbs judge
  // sample noise instead of demanding a candidate beat a noisy reference exactly.
  const margin = args.margin !== undefined ? Number(args.margin) : 0.3;
  const model = typeof args.model === 'string' ? args.model : 'claude-opus-4-8';
  const runId = `opus-panel-calibration-${typeof args.tag === 'string' ? args.tag : 'ref'}`;

  console.log(`CALIBRATION: rendering reference build ${path.relative(REPO_ROOT, path.resolve(refPlane))}`);
  const rig = await runRig({ planePath: refPlane, runId });

  console.log(`CALIBRATION: Opus 4.8 vision panel (samples=${samples}, model=${model}) scoring 9 views (reference-anchored)...`);
  const judged = await judgeShotsClaude({ shotsDir: rig.outDir, samples, model, force: true });
  if (!judged) throw new Error('Opus panel did not complete all 9 views');

  const byView = Object.fromEntries(judged.per_view.map((v) => [v.view, v.score]));
  const bars = VIEWS.map((v) => {
    const s = byView[v.id];
    return typeof s === 'number' ? Math.max(0, Math.round((s - margin) * 100) / 100) : null;
  });

  console.log('\nPER-VIEW CALIBRATION (Opus 4.8 panel on the reference build, margin ' + margin + '):');
  VIEWS.forEach((v, i) => {
    console.log(`  view ${v.id} (${v.key}): ref score ${byView[v.id]} -> bar ${bars[i]}`);
  });
  const calibratedTotal = Math.round((bars.reduce((a, b) => a + (b || 0), 0) / bars.length) * 1000) / 10;
  console.log(`\nview_threshold_calibrated = [${bars.join(', ')}]  (mean bar ~${calibratedTotal}/100)`);
  if (bars.some((b) => b === null)) {
    throw new Error('some views scored null — cannot calibrate; inspect the render/judge output');
  }

  if (args.write) {
    const rubric = JSON.parse(readFileSync(RUBRIC_PATH, 'utf8'));
    rubric.view_threshold_calibrated = bars;
    rubric.view_threshold_calibrated_meta = {
      method: 'opus-4.8-panel reference-build anchor',
      reference_plane: path.relative(REPO_ROOT, path.resolve(refPlane)),
      reference_plane_sha256: rig.planeSha256 || null,
      judge_model: model,
      samples,
      margin,
      per_view_reference_score: byView,
      note:
        '100% (opus-panel track) = candidate >= this per-view bar on ALL 9 views, i.e. as good as ' +
        'the reference 747 build under the Opus 4.8 vision panel. Re-baselines the opus-panel track ' +
        'only; the frozen gemma primitives record is unaffected. See the project_boeing_opus48_judge_panel ' +
        'memory + BOEING-COMPARISON.md.',
    };
    if (typeof rubric.version === 'number') rubric.version = Math.max(rubric.version, 3);
    writeFileSync(RUBRIC_PATH, `${JSON.stringify(rubric, null, 2)}\n`);
    console.log(`\nWROTE view_threshold_calibrated to rubric.json (version ${rubric.version}).`);
  } else {
    console.log('\n(dry run — pass --write to persist the calibrated bar into rubric.json)');
  }
}

main().catch((err) => {
  console.error(`CALIBRATE_FAIL ${err.message}`);
  process.exit(1);
});
