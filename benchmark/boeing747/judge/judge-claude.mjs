// Claude Opus 4.8 VISION judge for the Boeing 747 primitives benchmark.
//
// A SEPARATE score track from the frozen gemma4 judge (judge/judge.mjs stays
// the published baseline). Per view, this sends the rig screenshot + the 2
// relevant reference photos + the frozen rubric to Claude Opus 4.8 vision and
// parses the SAME strict-JSON per-criterion scores the gemma judge parses.
//
// WHY the owner added it (directive 2026-07-05): gemma4:12b caps + fluctuates,
// which flattens the gradient near the top of the rubric. Opus 4.8 vision reads
// a good primitive 747 far better and gives a cleaner gradient toward 100. The
// two tracks are reported side by side.
//
// HOW it calls Opus vision: there is no ANTHROPIC_API_KEY in this environment,
// but the `claude` CLI (Claude Code, subscription OAuth) drives Opus 4.8 with
// image input via the Read tool in print mode. We spawn:
//   claude -p <prompt> --output-format json --allowedTools Read
//          --disallowedTools <web/edit> --strict-mcp-config --mcp-config {}
// and read the model's strict-JSON reply out of the CLI's `.result` field.
//
// SELF-FAMILY-BIAS CAVEAT (reported, not hidden): an Opus-4.8 judge scoring an
// Opus-4.8-built plane may be generous. This track is a gradient tool, not an
// impartial leaderboard — the gemma4 track remains the frozen baseline.
//
// Fail-open discipline (mirrors DEAD-JUDGE-1): a failed sample never zeroes a
// score — failed samples are dropped, unassessable criteria are null and
// excluded with weight renormalization, errors are recorded not swallowed.
//
// CLI:
//   node judge/judge-claude.mjs --shots <dir> [--views 1,2,3]
//     [--samples N] [--out <file>] [--force] [--model <id>]
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { VIEWS } from '../lib/cameras.mjs';
import { parseJudgeReply } from '../lib/judge-parse.mjs';
import { maskViewMedians, seedMedian, totalScore, viewScore, weakestCriterion } from '../lib/scoring.mjs';
import { loadRubric } from './judge.mjs';

const execFileAsync = promisify(execFile);
const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(BENCH_DIR, '..', '..');

const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_JUDGE_TIMEOUT_MS || 180000);
// Default model track for the report label; the CLI already defaults to the
// session's Opus 4.8, so we don't force --model unless overridden.
const DEFAULT_MODEL_LABEL = 'claude-opus-4-8';

/** Reference image FILE PATHS (Opus reads the files, not base64 blobs). */
export function loadReferencePaths(rubric) {
  const metaPath = path.join(BENCH_DIR, 'references', 'prepared', 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(
      'references not prepared — run: node benchmark/boeing747/references/fetch-references.mjs',
    );
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const refs = {};
  for (const key of Object.keys(rubric.reference_keys)) {
    const entry = meta.references[key];
    if (!entry) throw new Error(`reference '${key}' missing from prepared/meta.json`);
    refs[key] = {
      key,
      depicts: entry.depicts,
      sha256: entry.sha256,
      file: path.join(BENCH_DIR, 'references', 'prepared', entry.file),
    };
  }
  return refs;
}

/** Build the per-view judging prompt (Opus reads three image files by path). */
function buildClaudePrompt(rubric, view, shotPath, refA, refB) {
  const lines = [
    rubric.judge_system_prompt,
    '',
    'Use the Read tool to open these THREE image files, then judge:',
    `  CANDIDATE (the 3D model to score) = ${shotPath}`,
    `  REFERENCE A (real Boeing 747: ${refA.depicts}) = ${refA.file}`,
    `  REFERENCE B (real Boeing 747: ${refB.depicts}) = ${refB.file}`,
    '',
    `CAMERA ANGLE: view ${view.id} of 9 — ${view.name}.`,
    'Score ONLY the CANDIDATE image against how well it depicts a real Boeing 747;',
    'the two references define ground truth and are NOT scored. Be strict and',
    'literal: describe what is actually visible, never assume hidden parts exist.',
    'Do not use web search or outside knowledge — judge only what the images show.',
    '',
    'CRITERIA (score the candidate 0-10 per the anchors; null only if genuinely not assessable from this angle):',
  ];
  for (const c of rubric.criteria) {
    const anchors = Object.entries(c.anchors)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    lines.push(`- ${c.id} (${c.name}): ${anchors}`);
  }
  lines.push(
    '',
    'Your FINAL message must be STRICT JSON ONLY (no markdown, no code fence, no prose): {"scores": {"' +
      rubric.criteria.map((c) => c.id).join('": <int 0-10 or null>, "') +
      '": <int 0-10 or null>}, "weakest_visible_feature": "<criterion_id>", "notes": "<max 60 words of factual observations>"}',
  );
  return lines.join('\n');
}

/**
 * ONE `claude` CLI vision spawn — the SOLE transport seam, shared by the
 * pointwise judge (this file) and the `--judge opus-pairwise` gating judge
 * (judge/judge-pairwise.mjs). It sends `prompt` (which already names the image
 * files the model must Read) and returns the RAW `.result` string, cost and ms
 * — it does NOT parse, so each judge track owns its own reply grammar
 * (parseJudgeReply for pointwise, lib/pairwise-parse.mjs for pairwise).
 *
 * `execImpl` defaults to the real `execFileAsync` and is the injectable test
 * seam (mirrors actor-claude's pattern) so both judge tracks are unit-testable
 * with canned CLI JSON and no network. The argv (allowed/disallowed tools,
 * strict empty MCP config, --add-dir BENCH_DIR) and the per-call CLI timeout
 * are IDENTICAL to the shape this judge has always spawned — the extraction is
 * pure factoring, not a behavior change.
 *
 * @param {{prompt:string, model?:string, execImpl?:Function}} params
 * @returns {Promise<{resultText:string, cost:number, ms:number}>}
 */
export async function callClaudeCliVision({ prompt, model, execImpl = execFileAsync }) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--allowedTools',
    'Read',
    '--disallowedTools',
    'WebSearch,WebFetch,Bash,Edit,Write,Task',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--add-dir',
    BENCH_DIR,
  ];
  if (model) args.push('--model', model);
  const { stdout } = await execImpl('claude', args, {
    cwd: REPO_ROOT,
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI did not return JSON: ${String(stdout).slice(0, 200)}`);
  }
  if (outer.is_error || outer.subtype !== 'success' || typeof outer.result !== 'string') {
    throw new Error(`claude judge error (subtype=${outer.subtype}): ${String(outer.result).slice(0, 200)}`);
  }
  return { resultText: outer.result, cost: Number(outer.total_cost_usd) || 0, ms: Number(outer.duration_ms) || 0 };
}

/**
 * ONE Opus 4.8 vision call for one view (pointwise track). Thin wrapper: build
 * the per-view pointwise prompt, spawn via callClaudeCliVision, then parse with
 * the frozen parseJudgeReply. Returns { parsed, cost, ms } exactly as before.
 */
async function callClaudeVision({ rubric, view, shotPath, refA, refB, model, execImpl }) {
  const criteriaIds = rubric.criteria.map((c) => c.id);
  const prompt = buildClaudePrompt(rubric, view, shotPath, refA, refB);
  const { resultText, cost, ms } = await callClaudeCliVision({ prompt, model, execImpl });
  const parsed = parseJudgeReply(resultText, criteriaIds);
  return { parsed, cost, ms };
}

async function judgeOneViewClaude({ rubric, refs, model, shotsDir, view, samples }) {
  const criteriaIds = rubric.criteria.map((c) => c.id);
  const shotPath = path.join(shotsDir, `view-${view.id}.png`);
  const refKeys = rubric.view_references[String(view.id)];
  const [refA, refB] = refKeys.map((k) => refs[k]);

  const runs = [];
  for (let i = 0; i < samples; i++) {
    const started = Date.now();
    try {
      const { parsed, cost, ms } = await callClaudeVision({ rubric, view, shotPath, refA, refB, model });
      runs.push({
        sample: i,
        ok: true,
        ms: ms || Date.now() - started,
        cost,
        scores: parsed.scores,
        weakestVisible: parsed.weakestVisible,
        notes: parsed.notes,
      });
    } catch (err) {
      runs.push({ sample: i, ok: false, ms: Date.now() - started, error: String(err.message || err) });
    }
  }

  const medians = {};
  for (const id of criteriaIds) {
    medians[id] = seedMedian(runs.filter((r) => r.ok).map((r) => r.scores[id]));
  }
  // View-visibility mask (rubric v2) — see judge.mjs / lib/scoring.mjs.
  const masked = maskViewMedians(medians, view.id, rubric.view_visibility);
  const score = viewScore(masked, rubric.criteria);
  const scoreUnmasked = viewScore(medians, rubric.criteria);
  const maskedOut = criteriaIds.filter((id) => masked[id] === null && medians[id] !== null);
  const notes = runs.filter((r) => r.ok).map((r) => r.notes).filter(Boolean);
  return {
    view: view.id,
    key: view.key,
    refs: refKeys,
    score: score === null ? null : Math.round(score * 100) / 100,
    score_unmasked: scoreUnmasked === null ? null : Math.round(scoreUnmasked * 100) / 100,
    masked_out: maskedOut,
    criteria_medians: medians,
    notes: notes[0] || '',
    all_notes: notes,
    judge_errors: runs.filter((r) => !r.ok).length,
    cost_usd: Math.round(runs.reduce((a, r) => a + (r.cost || 0), 0) * 1e6) / 1e6,
    samples: runs,
  };
}

export async function judgeShotsClaude({ shotsDir, views, out, force, samples, model }) {
  const { rubric, rubricSha256 } = loadRubric();
  const refs = loadReferencePaths(rubric);
  const nSamples = Number.isInteger(samples) && samples > 0 ? samples : 1;
  const modelLabel = model || DEFAULT_MODEL_LABEL;
  const dir = path.resolve(shotsDir);
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const judgeDir = path.join(dir, 'judge-claude');
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
    process.stdout.write(`opus-judging view ${view.id} (${view.key}) x${nSamples}... `);
    const result = await judgeOneViewClaude({ rubric, refs, model, shotsDir: dir, view, samples: nSamples });
    writeFileSync(partial, JSON.stringify(result, null, 2));
    console.log(`score=${result.score} (errors=${result.judge_errors}, $${result.cost_usd})`);
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
  const { total, scoredViews, missingViews } = totalScore(perView.map((v) => v.score));
  const weakest = weakestCriterion(
    perView.map((v) => maskViewMedians(v.criteria_medians, v.view, rubric.view_visibility)),
    rubric.criteria,
  );
  const { total: totalUnmasked } = totalScore(perView.map((v) => v.score_unmasked ?? v.score));
  const totalCost = Math.round(perView.reduce((a, v) => a + (v.cost_usd || 0), 0) * 1e6) / 1e6;
  const results = {
    protocol: rubric.protocol,
    // Honest labeling: derive from whichever model actually ran (modelLabel
    // defaults to DEFAULT_MODEL_LABEL when --model is omitted, so the
    // already-committed opus48 track's label/shape is byte-identical to
    // before this fix — this is a pure relabeling, not a behavior change).
    judge_track: `${modelLabel}-vision`,
    rubric_version: rubric.version,
    rubric_sha256: rubricSha256,
    judge_model: modelLabel,
    judge_samples: nSamples,
    supersample: meta.supersample ?? 1,
    run_id: meta.runId,
    plane_path: meta.planePath,
    plane_sha256: meta.planeSha256,
    camera_spec_version: meta.cameraSpecVersion,
    three_revision: meta.threeRevision,
    reference_sha256: Object.fromEntries(Object.values(refs).map((r) => [r.key, r.sha256])),
    per_view: perView.map((v) => ({
      view: v.view,
      key: v.key,
      score: v.score,
      score_unmasked: v.score_unmasked,
      masked_out: v.masked_out,
      criteria_medians: v.criteria_medians,
      notes: v.notes,
      // SCORING v3 success signal (adversarial-review fix 2026-07-16): this
      // projection used to strip BOTH `judge_errors` and the per-run ok-array,
      // which made lib/scoring.mjs's viewJudgeSucceeded() return false for
      // every claude view — applyScoringV3 silently degraded to the v2
      // null-drop on the whole claude-vision track (the hide-a-view exploit
      // stayed open there while the result was stamped scoring_version:3).
      // `samples` is deliberately reduced to ok-only so results.json stays
      // lean; the full runs still live in the per-view partials.
      judge_errors: v.judge_errors,
      samples: Array.isArray(v.samples) ? v.samples.map((s) => ({ ok: s?.ok === true })) : undefined,
    })),
    total_0_100: total,
    total_0_100_unmasked: totalUnmasked,
    scored_views: scoredViews,
    missing_views: missingViews,
    weakest_feature: weakest,
    total_cost_usd: totalCost,
    created_at: new Date().toISOString(),
  };
  const outFile = path.resolve(out || path.join(judgeDir, 'results.json'));
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`TOTAL ${total}/100 over ${scoredViews} views (missing ${missingViews}) — Opus 4.8 vision, $${totalCost}`);
  console.log(`WEAKEST_FEATURE ${weakest ? weakest.id : 'n/a'}`);
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
    if (!args.shots) {
      throw new Error('usage: judge-claude.mjs --shots <dir> [--views 1,2,3] [--samples N] [--out <file>] [--force] [--model <id>]');
    }
    const views = typeof args.views === 'string' ? args.views.split(',').map(Number) : null;
    await judgeShotsClaude({
      shotsDir: args.shots,
      views,
      out: args.out,
      force: args.force === true,
      samples: args.samples ? Number(args.samples) : 1,
      model: typeof args.model === 'string' ? args.model : undefined,
    });
  };
  run().catch((err) => {
    console.error(`JUDGE_CLAUDE_FAIL ${err.message}`);
    process.exit(1);
  });
}
