// Generic "did anyone already try this, and did it help" retrieval +
// lesson write-back for any brain-driven self-improve loop. Built on
// lib/mcp-client.mjs.
//
// GENERIC ON PURPOSE (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md): every function here takes its domain content
// (query text, tag, criterion, summary, outcome...) as a plain CALLER-
// SUPPLIED argument. There is no Boeing-747 (or any other benchmark) word
// anywhere in this file's own logic — only the call site
// (loop-runner-terransoul.mjs today, any future bench loop-runner tomorrow)
// knows what benchmark it is running. The CONTENT that flows through is
// domain-specific; the CODE that builds and sends it is not.
import { callMcpTool } from './mcp-client.mjs';

/**
 * True when a memory row is a per-attempt self-improve BENCH lesson — the kind
 * that must live in the RUNTIME brain but must NEVER be baked into the committed
 * shared seed (mcp-data/shared/memory-seed.sql), because such lessons carry the
 * actor's own answer-derived, benchmark-specific geometry/detail (AGI-purity:
 * rules/bench-agi-purity.md). GENERIC by convention — it matches the
 * 'self-improve-attempt' category and the '<bench>-actor-attempt' tag/prefix
 * pattern every bench loop-runner uses, with NO benchmark name hardcoded here.
 * The seed-purity regression test uses this to keep the committed seed clean
 * (a stale MCP-brain binary once appended a Boeing geometry lesson to the seed
 * on 2026-07-13; this guard makes that class of leak fail CI).
 */
export function isBenchLesson({ content = '', tags = '', category = '' } = {}) {
  const cat = String(category);
  const tagStr = String(tags);
  const body = String(content).trimStart();
  return (
    cat === 'self-improve-attempt' ||
    /(^|[,\s])[a-z0-9]+(?:-[a-z0-9]+)*-actor-attempt(?=$|[,\s])/i.test(tagStr) ||
    /^LESSON \([a-z0-9-]*-actor-attempt\)/i.test(body)
  );
}

/**
 * Extract the leading JSON ARRAY from a tool-response text that may carry
 * trailing non-JSON decoration (live-caught 2026-07-16: the brain tray appends
 * an MCP-compliance banner to tool results in fresh sessions — strict
 * JSON.parse then throws and every self-learning READ silently failed open to
 * []). Returns the parsed array, or null when no parseable leading array
 * exists. PURE + exported for vitest.
 */
export function extractJsonArray(text) {
  const s = String(text ?? '');
  const start = s.indexOf('[');
  if (start < 0) return null;
  const end = s.lastIndexOf(']');
  if (end <= start) return null;
  // Try widest-first, then shrink to the first parseable close bracket — the
  // banner could itself contain `]`.
  for (let e = end; e > start; e = s.lastIndexOf(']', e - 1)) {
    try {
      const parsed = JSON.parse(s.slice(start, e + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      // keep shrinking
    }
  }
  return null;
}

/**
 * True when a comma/space-delimited tag string contains `tag` as a WHOLE
 * token (never a substring). GENERIC — used to keep the read path from
 * confusing a track tag with a longer one that merely shares its prefix
 * (e.g. a shorter track name is a prefix of a longer one), which a naive
 * `tags.includes(tag)` would wrongly match. Exported so callers/tests can
 * reuse the exact token semantics the read filter applies.
 */
export function tagsIncludeToken(tags, tag) {
  if (!tag) return false;
  return String(tags)
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .includes(String(tag).trim());
}

/**
 * Query the brain for prior attempts relevant to `query`. Fails open: any
 * MCP error, unreachable tray, or unparsable response returns `[]` rather
 * than throwing — a self-learning READ must never block the caller's loop.
 * `callTool` defaults to the real MCP transport (lib/mcp-client.mjs) but is
 * injectable so this function's OWN logic (args built, response parsed,
 * fail-open behavior) is directly vitest-covered without a live tray —
 * mirrors lib/judge-parse.mjs's callWithParseRetry(call, ...) pattern.
 *
 * TRACK-SCOPED READ (`actorTag`): the WRITE path already stamps each lesson
 * with the running track's name (ingestAttemptLesson's `extraTags:[actorName]`).
 * When `actorTag` is supplied, this read RESTRICTS the returned lessons to that
 * track — a lesson whose `tags` does not carry the token is dropped — so two
 * tracks sharing one brain (e.g. a purity track and a taught track) can never
 * cross-contaminate each other's per-attempt lessons. Client-side is the only
 * reliable filter here: `brain_search` is a semantic search, not a tag-filtered
 * query (lib/mcp-client.mjs forwards whatever `args` a caller passes, but the
 * brain_search tool contract exposes only `query`/`limit`, no tag predicate),
 * so we OVER-FETCH (`overFetch`× the caller's `limit`, bounded) and filter the
 * hits down here, then slice back to `limit`. With NO `actorTag`, the call is
 * byte-identical to the prior behavior (`{query, limit}`, no filtering).
 * @returns {Promise<Array<{content:string, tags:string, score:number}>>}
 */
export async function fetchPriorAttempts({
  query,
  limit = 5,
  actorTag = null,
  overFetch = 5,
  mcpUrl,
  token,
  timeoutMs,
  callTool = callMcpTool,
} = {}) {
  if (!query) return [];
  // Over-fetch ONLY when a track filter is active, so a filtered result set can
  // still fill `limit` even if the top semantic hits belong to other tracks.
  const fetchLimit = actorTag ? Math.min(limit * Math.max(1, overFetch), 100) : limit;
  const res = await callTool('brain_search', { query, limit: fetchLimit }, { mcpUrl, token, timeoutMs });
  if (!res.ok || !res.text) return [];
  try {
    const parsed = extractJsonArray(res.text);
    if (!Array.isArray(parsed)) return [];
    let mapped = parsed.map((m) => ({
      content: String(m.content || ''),
      tags: String(m.tags || ''),
      score: Number(m.score) || 0,
    }));
    if (actorTag) mapped = mapped.filter((m) => tagsIncludeToken(m.tags, actorTag));
    return mapped.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Render a compact "prior attempts" prompt section from fetchPriorAttempts'
 * output. Returns `null` when there is nothing to show (never injects an
 * empty/noise section into a prompt). `maxItems`/`maxCharsPerItem` bound the
 * prompt-size impact of a large recall set.
 */
export function formatPriorAttemptsSection(priorAttempts, { header, maxItems = 5, maxCharsPerItem = 400 } = {}) {
  if (!Array.isArray(priorAttempts) || priorAttempts.length === 0) return null;
  const lines = [
    header ||
      'PRIOR ATTEMPTS ON THIS BENCHMARK (from brain memory — do not blindly repeat something already shown not to help):',
  ];
  for (const attempt of priorAttempts.slice(0, maxItems)) {
    const text =
      attempt.content.length > maxCharsPerItem ? `${attempt.content.slice(0, maxCharsPerItem)}...` : attempt.content;
    lines.push(`- ${text}`);
  }
  return lines.join('\n');
}

/**
 * Ingest a lesson about ONE genuine (non-infra-failure) self-improve
 * iteration. Every domain-specific word here is a caller-supplied argument;
 * this function only knows how to assemble a generic lesson envelope and
 * hand it to brain_ingest_lesson. Fails open (never throws by default).
 * @returns {Promise<{ok:boolean, text?:string|null, error?:string}>}
 */
export async function ingestAttemptLesson({
  tag,
  category,
  criterion,
  summary,
  scoreDeltas,
  outcome,
  extraTags = [],
  importance = 6,
  mcpUrl,
  token,
  timeoutMs,
  callTool = callMcpTool,
} = {}) {
  if (!tag || !outcome) {
    return { ok: false, error: 'ingestAttemptLesson requires at least tag + outcome' };
  }
  const lines = [`LESSON (${tag}): outcome=${outcome}${criterion ? `, targeted criterion=${criterion}` : ''}.`];
  if (summary) lines.push(`Change: ${summary}`);
  if (scoreDeltas) lines.push(`Score delta: ${JSON.stringify(scoreDeltas)}`);
  const content = lines.join(' ');
  const tags = [tag, criterion, outcome, ...extraTags].filter(Boolean).join(',');
  return callTool(
    'brain_ingest_lesson',
    { content, category: category || 'self-improve-attempt', tags, importance },
    { mcpUrl, token, timeoutMs },
  );
}

// --- STRATEGY-CHEATSHEET events (ACE / Dynamic-Cheatsheet) --------------------
//
// Append-only, delta-only event sourcing for a self-improve loop's own winning
// strategies + contrastive anti-examples. GENERIC exactly like the functions
// above: every domain word (tag, criterion, technique...) is a caller-supplied
// argument; this file never names a benchmark. The FOLD/RANK/FORMAT of these
// events into a live "cheatsheet" lives in lib/strategy-cheatsheet.mjs — here
// we only own the brain write (ingest) and read (fetch) of one flat event.
//
// A strategy event is stored as a human-readable lesson line PLUS a trailing
// machine-readable `STRATEGY_EVENT_JSON: {...}` marker, so fetchStrategyEvents
// can round-trip the structured payload back out of brain_search text. The
// category is 'self-improve-attempt' so isBenchLesson() keeps these per-attempt
// events OUT of the committed shared seed (AGI-purity: rules/bench-agi-purity.md).

/** The trailing structured payload marker in a strategy-event lesson body. */
const STRATEGY_EVENT_MARKER = 'STRATEGY_EVENT_JSON:';

/**
 * Ingest ONE append-only strategy event (the edit-gate signal for a single
 * iteration). Emits a lesson tagged by the caller ('...-strategy-event' for a
 * winning technique, '...-anti' for a rejected/regressing one). The scope is
 * derived generically from the tag/outcome (an 'anti'-suffixed tag or a
 * 'harmful' outcome ⇒ scope 'anti', else 'strategy') so callers need not pass
 * it. Fails open (returns `{ok:false,...}` rather than throwing) unless the
 * injected callTool throws — mirrors ingestAttemptLesson.
 *
 * The event is folded into an itemized cheatsheet at READ time by
 * lib/strategy-cheatsheet.mjs::foldStrategyEvents — nothing is ever rewritten
 * in place, which structurally avoids the ACE context-collapse failure.
 * @returns {Promise<{ok:boolean, text?:string|null, error?:string}>}
 */
export async function ingestStrategyEvent({
  tag,
  strategyId,
  criterion,
  viewScope,
  technique,
  snippetRef,
  outcome,
  gateDelta,
  iter,
  runId,
  actorName,
  importance = 6,
  mcpUrl,
  token,
  timeoutMs,
  callTool = callMcpTool,
} = {}) {
  if (!tag || !outcome) {
    return { ok: false, error: 'ingestStrategyEvent requires at least tag + outcome' };
  }
  const scope =
    /(^|[-_\s])anti(?=$|[-_\s])/i.test(String(tag)) || outcome === 'harmful' ? 'anti' : 'strategy';
  const delta = Number.isFinite(Number(gateDelta)) ? Number(gateDelta) : null;
  const payload = {
    strategyId: strategyId || null,
    scope,
    criterion: criterion || null,
    viewScope: viewScope || null,
    technique: technique || null,
    snippetRef: snippetRef || null,
    outcome,
    gateDelta: delta,
    iter: Number.isFinite(Number(iter)) ? Number(iter) : null,
    runId: runId || null,
    actorName: actorName || null,
  };
  const parts = [`STRATEGY (${tag}): scope=${scope}, outcome=${outcome}`];
  if (criterion) parts[0] += `, criterion=${criterion}`;
  parts[0] += '.';
  if (technique) parts.push(`Technique: ${technique}`);
  if (delta !== null) parts.push(`gate_delta=${delta}`);
  const content = `${parts.join(' ')}\n${STRATEGY_EVENT_MARKER} ${JSON.stringify(payload)}`;
  const tags = [tag, criterion, viewScope, outcome, scope, actorName].filter(Boolean).join(',');
  return callTool(
    'brain_ingest_lesson',
    { content, category: 'self-improve-attempt', tags, importance },
    { mcpUrl, token, timeoutMs },
  );
}

/**
 * Query the brain for strategy events relevant to `criterion` (or an explicit
 * `query`) and parse each result's trailing `STRATEGY_EVENT_JSON` payload back
 * into a flat event object for lib/strategy-cheatsheet.mjs::foldStrategyEvents.
 * Fails open to `[]` on any MCP error / unparsable response — a self-learning
 * READ must never block the loop (mirrors fetchPriorAttempts). Results whose
 * body lacks a parseable payload marker are skipped (fail-open per item), so a
 * legacy/foreign lesson in the same search hit cannot corrupt the fold.
 * @returns {Promise<Array<object>>} parsed strategy-event payloads
 */
export async function fetchStrategyEvents({
  criterion,
  query,
  tag,
  limit = 10,
  actorTag = null,
  overFetch = 5,
  mcpUrl,
  token,
  timeoutMs,
  callTool = callMcpTool,
} = {}) {
  // Query construction (live-caught fix, 2026-07-16): searching the BARE
  // criterion word ranks taught-KB/document chunks far above the strategy
  // events themselves (measured on the running v4 track: 25 hits, 0 events,
  // while a marker-anchored query surfaced 6/10). Anchor the semantic query
  // to the events' own content shape — `STRATEGY (<tag>): ... criterion=<id>
  // ... gate_delta=` — so events outrank documents. An explicit `query`
  // still overrides entirely (legacy behavior).
  const q = (query || ['STRATEGY', tag, criterion, 'gate_delta'].filter(Boolean).join(' ')).trim();
  if (!q || q === 'STRATEGY gate_delta') return [];
  // TRACK-SCOPED READ (same rationale + over-fetch shape as fetchPriorAttempts'
  // actorTag): the write half stamps payload.actorName, and a measurement-era
  // change means one era's gate events must never steer another era's actor.
  const fetchLimit = actorTag ? Math.min(limit * Math.max(1, overFetch), 100) : limit;
  const res = await callTool('brain_search', { query: q, limit: fetchLimit }, { mcpUrl, token, timeoutMs });
  if (!res.ok || !res.text) return [];
  const rows = extractJsonArray(res.text);
  if (!Array.isArray(rows)) return [];
  const events = [];
  for (const row of rows) {
    const content = String((row && row.content) || '');
    const at = content.indexOf(STRATEGY_EVENT_MARKER);
    if (at < 0) continue;
    const jsonStart = content.indexOf('{', at);
    if (jsonStart < 0) continue;
    try {
      const payload = JSON.parse(content.slice(jsonStart));
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        if (actorTag && payload.actorName !== actorTag) continue;
        events.push(payload);
      }
    } catch {
      // fail-open per item: skip an unparseable payload, keep the rest
    }
  }
  return events.slice(0, limit);
}
