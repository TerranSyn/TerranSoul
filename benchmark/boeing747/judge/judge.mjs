// FROZEN vision judge for the Boeing 747 primitives benchmark.
//
// Per view: sends the rig screenshot + the 2 most relevant reference images
// + the frozen rubric to gemma4 (Ollama /api/chat, temperature 0), takes the
// MEDIAN of 3 judge calls (fixed seeds 7/8/9 — JUDGE-STABILITY-1), computes
// the weighted per-view score, and TOTAL = mean of 9 views scaled to /100.
// The rubric (criteria, anchors, weights, prompts) lives in rubric.json and
// its sha256 is printed into every result.
//
// Fail-open discipline (DEAD-JUDGE-1): a failed/aborted judge call never
// zeroes a score — failed seeds are dropped, unassessable criteria are null
// and excluded with weight renormalization, and errors are recorded, never
// silently swallowed.
//
// Judge calls are SEQUENTIAL by design (never parallel — a 12B vision model
// may share the GPU with other benches) with generous per-call timeouts.
//
// CLI:
//   node judge/judge.mjs --shots <dir> [--views 1,2,3] [--out <file>] [--force]
//   node judge/judge.mjs --critic --results <results.json> --shots <dir>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWS } from '../lib/cameras.mjs';
import {
  callWithParseRetry,
  extractReplyText,
  parseJudgeBody,
  parseJudgeReply,
} from '../lib/judge-parse.mjs';
import { maskViewMedians, seedMedian, totalScore, viewScore, weakestCriterion } from '../lib/scoring.mjs';

// Re-exported for API stability; the implementation (plus extractReplyText /
// parseJudgeBody / callWithParseRetry) lives in lib/judge-parse.mjs so the
// parsing paths are pure and CI-tested (lib/judge-parse.test.mjs).
export { extractReplyText, parseJudgeReply };

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

export function loadRubric() {
  const rubricPath = path.join(BENCH_DIR, 'rubric.json');
  const raw = readFileSync(rubricPath);
  return {
    rubric: JSON.parse(raw.toString('utf8')),
    rubricSha256: createHash('sha256').update(raw).digest('hex'),
  };
}

function loadReferences(rubric) {
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
    const file = path.join(BENCH_DIR, 'references', 'prepared', entry.file);
    refs[key] = {
      key,
      depicts: entry.depicts,
      sha256: entry.sha256,
      b64: readFileSync(file).toString('base64'),
    };
  }
  return refs;
}

// NOTE (frozen, measured 2026-07-03): gemma4:12b-it-qat is a thinking model
// under Ollama — on the full rubric prompt it burns the entire num_predict
// budget inside message.thinking and returns EMPTY content with
// done_reason=length. `think:false` yields clean JSON (done_reason=stop).
// The judge protocol therefore pins think:false via rubric.json, and the
// parser (lib/judge-parse.mjs) still survives the thinking-swallow shape:
// content -> thinking fallback -> classified retryable empty/malformed with
// the frozen same-seed retry policy (rubric.json judge_parse_retries).
//
// Returns the RAW response body (plus convenience content/ms) — reply-text
// extraction is the parser's job, never done at the transport layer.
export async function ollamaChat({ model, messages, options, format, think, timeoutMs }) {
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, options, format, think, stream: false }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      return { body, content: body.message?.content ?? '', ms: Date.now() - started };
    } catch (err) {
      if (attempt === 2) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('unreachable');
}

function viewUserPrompt(rubric, view, refA, refB) {
  const lines = [
    `CAMERA ANGLE: view ${view.id} of 9 — ${view.name}.`,
    `IMAGE 1 = the candidate 3D render to judge.`,
    `IMAGE 2 = Boeing 747 reference: ${refA.depicts}.`,
    `IMAGE 3 = Boeing 747 reference: ${refB.depicts}.`,
    '',
    'CRITERIA (score the candidate 0-10 per the anchors; null only if not assessable from this angle):',
  ];
  for (const c of rubric.criteria) {
    const anchors = Object.entries(c.anchors)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    lines.push(`- ${c.id} (${c.name}): ${anchors}`);
  }
  lines.push(
    '',
    'Respond with STRICT JSON only: {"scores": {"' +
      rubric.criteria.map((c) => c.id).join('": ..., "') +
      '": ...}, "weakest_visible_feature": "<criterion_id>", "notes": "<max 60 words>"}',
  );
  return lines.join('\n');
}

/** Assemble the exact frozen judge request for one view (shot + 2 refs + rubric). */
function buildViewJudgeRequest({ rubric, refs, shotsDir, view }) {
  const shotB64 = readFileSync(path.join(shotsDir, `view-${view.id}.png`)).toString('base64');
  const refKeys = rubric.view_references[String(view.id)];
  const [refA, refB] = refKeys.map((k) => refs[k]);
  return {
    refKeys,
    messages: [
      { role: 'system', content: rubric.judge_system_prompt },
      {
        role: 'user',
        content: viewUserPrompt(rubric, view, refA, refB),
        images: [shotB64, refA.b64, refB.b64],
      },
    ],
  };
}

async function judgeOneView({ rubric, refs, model, shotsDir, view }) {
  const criteriaIds = rubric.criteria.map((c) => c.id);
  const { refKeys, messages } = buildViewJudgeRequest({ rubric, refs, shotsDir, view });

  const seeds = [];
  for (const seed of rubric.judge_seeds) {
    const started = Date.now();
    try {
      // FROZEN same-seed retry policy (rubric judge_parse_retries): the call
      // closure pins THIS seed, so every parse retry re-requests identically.
      const call = async () =>
        ollamaChat({
          model,
          messages,
          options: { ...rubric.judge_options, seed },
          format: rubric.judge_format,
          think: rubric.judge_think,
          timeoutMs: rubric.judge_timeout_ms,
        });
      const parsed = await callWithParseRetry(call, criteriaIds, rubric.judge_parse_retries);
      seeds.push({
        seed,
        ok: true,
        ms: Date.now() - started,
        parse_retries: parsed.parse_retries,
        reply_source: parsed.reply_source,
        done_reason: parsed.done_reason,
        scores: parsed.scores,
        weakestVisible: parsed.weakestVisible,
        notes: parsed.notes,
      });
    } catch (err) {
      // Fail-open: record the error, keep the other seeds' signal.
      seeds.push({ seed, ok: false, ms: Date.now() - started, error: String(err.message || err) });
    }
  }

  const medians = {};
  for (const id of criteriaIds) {
    medians[id] = seedMedian(seeds.filter((s) => s.ok).map((s) => s.scores[id]));
  }
  // View-visibility mask (rubric v2): score only on views where each feature is
  // structurally assessable. criteria_medians stays RAW (what the judge said) for
  // audit; score is computed from the masked medians; score_unmasked is kept so
  // the mask's effect is transparent in every result.
  const masked = maskViewMedians(medians, view.id, rubric.view_visibility);
  const score = viewScore(masked, rubric.criteria);
  const scoreUnmasked = viewScore(medians, rubric.criteria);
  const maskedOut = criteriaIds.filter((id) => masked[id] === null && medians[id] !== null);
  return {
    view: view.id,
    key: view.key,
    refs: refKeys,
    score: score === null ? null : Math.round(score * 100) / 100,
    score_unmasked: scoreUnmasked === null ? null : Math.round(scoreUnmasked * 100) / 100,
    masked_out: maskedOut,
    criteria_medians: medians,
    judge_errors: seeds.filter((s) => !s.ok).length,
    seeds,
  };
}

/**
 * ONE live judge call for smoke-testing the Ollama integration (see
 * judge/live-smoke.mjs). Builds the exact frozen per-view request, performs a
 * SINGLE chat call with the given seed (default judge_seeds[0]) and returns
 * full diagnostics. Never writes partials; a parse failure throws the
 * classified error (kind empty/malformed) instead of failing open — a smoke
 * test exists to surface the failure, not survive it.
 */
export async function liveSmokeCall({ shotsDir, viewId = 1, seed, model: modelOverride }) {
  const { rubric, rubricSha256 } = loadRubric();
  const refs = loadReferences(rubric);
  const model = modelOverride || rubric.judge_model;
  const view = VIEWS.find((v) => v.id === Number(viewId));
  if (!view) throw new Error(`unknown view ${viewId}`);
  const criteriaIds = rubric.criteria.map((c) => c.id);
  const { messages } = buildViewJudgeRequest({ rubric, refs, shotsDir: path.resolve(shotsDir), view });
  const useSeed = seed ?? rubric.judge_seeds[0];
  const { body, ms } = await ollamaChat({
    model,
    messages,
    options: { ...rubric.judge_options, seed: useSeed },
    format: rubric.judge_format,
    think: rubric.judge_think,
    timeoutMs: rubric.judge_timeout_ms,
  });
  const extracted = extractReplyText(body);
  const parsed = parseJudgeBody(body, criteriaIds); // throws classified on bad reply
  return {
    rubric_sha256: rubricSha256,
    model,
    seed: useSeed,
    view: view.id,
    key: view.key,
    ms,
    done_reason: extracted.doneReason,
    reply_source: extracted.source,
    content_len: extracted.contentLen,
    thinking_len: extracted.thinkingLen,
    parsed,
  };
}

export async function judgeShots({ shotsDir, views, out, force, model: modelOverride }) {
  const { rubric, rubricSha256 } = loadRubric();
  const refs = loadReferences(rubric);
  const model = modelOverride || rubric.judge_model;
  const dir = path.resolve(shotsDir);
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const judgeDir = path.join(dir, 'judge');
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
    process.stdout.write(`judging view ${view.id} (${view.key}) with ${model} x${rubric.judge_seeds.length} seeds... `);
    const result = await judgeOneView({ rubric, refs, model, shotsDir: dir, view });
    writeFileSync(partial, JSON.stringify(result, null, 2));
    console.log(`score=${result.score} (errors=${result.judge_errors})`);
  }

  // Aggregate once all nine views are judged.
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
  // Weakest feature is computed on the MASKED medians so the critic never steers
  // the loop toward a feature that is only "weak" because it was graded on views
  // where it cannot be seen.
  const weakest = weakestCriterion(
    perView.map((v) => maskViewMedians(v.criteria_medians, v.view, rubric.view_visibility)),
    rubric.criteria,
  );
  const { total: totalUnmasked } = totalScore(perView.map((v) => v.score_unmasked ?? v.score));
  const results = {
    protocol: rubric.protocol,
    rubric_version: rubric.version,
    rubric_sha256: rubricSha256,
    judge_model: model,
    judge_seeds: rubric.judge_seeds,
    judge_options: rubric.judge_options,
    supersample: meta.supersample ?? 1,
    run_id: meta.runId,
    plane_path: meta.planePath,
    plane_sha256: meta.planeSha256,
    camera_spec_version: meta.cameraSpecVersion,
    three_revision: meta.threeRevision,
    reference_sha256: Object.fromEntries(Object.values(refs).map((r) => [r.key, r.sha256])),
    per_view: perView,
    total_0_100: total,
    total_0_100_unmasked: totalUnmasked,
    scored_views: scoredViews,
    missing_views: missingViews,
    weakest_feature: weakest,
    created_at: new Date().toISOString(),
  };
  const outFile = path.resolve(out || path.join(judgeDir, 'results.json'));
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`RUBRIC_SHA256 ${rubricSha256}`);
  console.log(`TOTAL ${total}/100 over ${scoredViews} views (missing ${missingViews})`);
  console.log(`WEAKEST_FEATURE ${weakest ? weakest.id : 'n/a'}`);
  console.log(`JUDGE_OK ${outFile}`);
  return results;
}

/**
 * Critic mode: the weakest FEATURE is computed deterministically from the
 * scores (lib/scoring.mjs weakestCriterion); the LLM contributes only the
 * concrete geometric fix suggestion, with a deterministic fallback if the
 * LLM call fails (fail-open — the loop's steering signal must survive).
 */
export async function criticPass({ resultsFile, shotsDir, model: modelOverride }) {
  const { rubric } = loadRubric();
  const results = JSON.parse(readFileSync(path.resolve(resultsFile), 'utf8'));
  const weakest = results.weakest_feature;
  if (!weakest) throw new Error('results contain no weakest_feature (no scoreable criteria)');
  const criterion = rubric.criteria.find((c) => c.id === weakest.id);
  const model = modelOverride || rubric.judge_model;

  const table = rubric.criteria
    .map((c) => `- ${c.id}: mean ${weakest.perCriterion[c.id] ?? 'null'} (weight ${c.weight})`)
    .join('\n');
  const userText =
    `Per-criterion mean scores (0-10) of the candidate across the nine views:\n${table}\n\n` +
    `Deterministically computed weakest feature: ${weakest.id} (${criterion.name}), mean ${weakest.mean}.\n` +
    `IMAGE 1 is the 3x3 contact sheet of the nine views.\n` +
    `Give ONE concrete geometric fix for ${weakest.id}. STRICT JSON: {"weakest_feature": "${weakest.id}", "fix_suggestion": "..."}`;

  let critic;
  try {
    const sheetB64 = readFileSync(path.join(path.resolve(shotsDir), 'contact-sheet.png')).toString('base64');
    const { body } = await ollamaChat({
      model,
      messages: [
        { role: 'system', content: rubric.critic_system_prompt },
        { role: 'user', content: userText, images: [sheetB64] },
      ],
      options: { ...rubric.judge_options, seed: rubric.judge_seeds[0] },
      format: rubric.judge_format,
      think: rubric.judge_think,
      timeoutMs: rubric.judge_timeout_ms,
    });
    // Same extraction path as the judge (content -> thinking fallback); the
    // critic is single-call fail-open — a bad reply falls to the
    // deterministic fallback below rather than a retry.
    const { text } = extractReplyText(body);
    const obj = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    critic = {
      weakest_feature: weakest.id,
      fix_suggestion: String(obj.fix_suggestion || '').slice(0, 800),
      source: 'llm',
    };
    if (!critic.fix_suggestion) throw new Error('empty fix_suggestion');
  } catch (err) {
    critic = {
      weakest_feature: weakest.id,
      fix_suggestion:
        `Improve '${criterion.name}' (mean ${weakest.mean}/10). Target the 8-10 anchor: ` +
        `${criterion.anchors['8']}; then: ${criterion.anchors['10']}.`,
      source: 'fallback',
      llm_error: String(err.message || err),
    };
  }

  results.critic = critic;
  writeFileSync(path.resolve(resultsFile), JSON.stringify(results, null, 2));
  console.log(`CRITIC ${critic.weakest_feature} (${critic.source}): ${critic.fix_suggestion}`);
  return critic;
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
    if (args.critic) {
      if (!args.results || !args.shots) {
        throw new Error('usage: judge.mjs --critic --results <results.json> --shots <dir>');
      }
      await criticPass({ resultsFile: args.results, shotsDir: args.shots, model: args.model });
      return;
    }
    if (!args.shots) {
      throw new Error(
        'usage: judge.mjs --shots <dir> [--views 1,2,3] [--out <file>] [--force] | --critic --results <f> --shots <dir>',
      );
    }
    const views = typeof args.views === 'string' ? args.views.split(',').map(Number) : null;
    await judgeShots({ shotsDir: args.shots, views, out: args.out, force: args.force === true, model: args.model });
  };
  run().catch((err) => {
    console.error(`JUDGE_FAIL ${err.message}`);
    process.exit(1);
  });
}
