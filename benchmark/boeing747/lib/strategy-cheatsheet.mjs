// STRATEGY-CHEATSHEET memory for a brain-driven self-improve loop
// (ACE / "Dynamic Cheatsheet" pattern: a frozen actor stores + re-injects its
// OWN winning strategies and a contrastive bad-attempts bank, and rides that
// distilled experience to a much higher ceiling than one-shot prompting).
//
// GENERIC ON PURPOSE (rules/brain-driven-self-improvement.md,
// rules/bench-agi-purity.md): this file has NO Boeing-747 (or any other
// benchmark) word in its own logic. Every technique/criterion string is
// caller-supplied CONTENT; the CODE here only knows how to fingerprint,
// fold, rank, format and PURITY-GUARD generic "strategy events". It never
// stores or emits benchmark geometry — the AGI-purity guard
// (sanitizeStrategyForPurity) is TECHNIQUE-ONLY and hard-rejects any snippet
// or anti-example that carries answer-derived numeric geometry.
//
// EVENT-SOURCED, DELTA-ONLY (never a stored monolith): each iteration ingests
// ONE append-only strategy EVENT (see lib/self-learning.mjs::ingestStrategyEvent).
// The "cheatsheet" is a MATERIALIZED VIEW folded FRESH on read
// (foldStrategyEvents), never mutated in place — this structurally avoids the
// ACE "context-collapse" failure that a full-cheatsheet rewrite causes, and
// respects rules/mcp-single-source-of-truth.md (the brain is authoritative;
// there is no private persistent client cache substituting for it).
//
// R5 STRATEGY-PERSISTENCE PROMOTION GATE (July-2026 statistical-rigor findings;
// SkillOpt 2605.23904, SkillFoundry 2604.03964, memory-precedent caution
// 2606.04315): a strategy is only PROMOTED into the re-injected "winning" set
// after a CERTIFIED improvement — a Wilson lower bound on its win-rate-vs-
// baseline (successes = the fresh 'helpful' gate observations) over N>=3
// INDEPENDENT observations, above a floor (default LCB>0.5), DEFLATED by the
// number of candidate strategies considered (the selection premium / winner's
// curse — trying many strategies and re-injecting the best inflates the
// observed win-rate). A strategy whose net effect regresses (harmful>helpful) is
// DEMOTED. This closes the "memory-as-precedent" trap (2606.04315): a RETRIEVED
// past success must never by itself raise promotion confidence — only certified
// FRESH gate observations count toward the win-rate, so a recalled precedent
// event is bucketed separately (precedent_count) and is inert to the gate.

import {
  DEFAULT_ALPHA,
  DEFAULT_STRATEGY_MIN_EPISODES,
  DEFAULT_STRATEGY_WINRATE_FLOOR,
  selectionPremiumCharge,
  wilsonLCB,
} from './certification-stats.mjs';

/**
 * Generic English stopwords stripped when building a stable strategy slug.
 * Deliberately domain-free — no benchmark vocabulary here.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'so', 'that', 'the', 'then', 'this',
  'to', 'up', 'with', 'was', 'were', 'their', 'them', 'these', 'those',
]);

/**
 * Stable fingerprint slug for a technique phrase: lowercase -> strip
 * punctuation -> drop stopwords -> take the first ~12 significant tokens ->
 * join with '-'. Two events describing the SAME technique fold together
 * (emergent UPSERT) without any stored counter to corrupt. Empty/blank input
 * yields '' so the caller can decide how to group unfingerprintable events.
 * @param {string} text
 * @param {{maxTokens?:number}} [opts]
 * @returns {string}
 */
export function strategyFingerprint(text, { maxTokens = 12 } = {}) {
  if (typeof text !== 'string') return '';
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  return tokens.slice(0, maxTokens).join('-');
}

/**
 * Classify one gated edit's outcome from its measured total delta and the
 * calibration noise floor (Probe-B epsilon_total). ONE signal source so the
 * edit-gate and the strategy memory can never disagree:
 *   gateDelta >=  +eps -> 'helpful'   (gate accepted + improved)
 *   gateDelta <=  -eps -> 'harmful'   (regressed; also emit an anti event)
 *   otherwise          -> 'neutral'   (within measurement noise)
 * A non-finite delta is treated as 'neutral' (never invent a signal).
 * @param {number} gateDelta
 * @param {number} epsilonTotal
 * @returns {'helpful'|'harmful'|'neutral'}
 */
export function classifyOutcome(gateDelta, epsilonTotal) {
  const delta = Number(gateDelta);
  if (!Number.isFinite(delta)) return 'neutral';
  const eps = Math.abs(Number(epsilonTotal)) || 0;
  if (delta >= eps && delta > 0) return 'helpful';
  if (delta <= -eps && delta < 0) return 'harmful';
  return 'neutral';
}

/** Effective grouping id for an event: its stored id, else fingerprint(technique). */
function eventId(ev) {
  const id = ev && typeof ev.strategyId === 'string' ? ev.strategyId.trim() : '';
  if (id) return id;
  return strategyFingerprint((ev && ev.technique) || '');
}

/**
 * True when an event is a RETRIEVED PRECEDENT (a recalled past success surfaced
 * from memory), NOT a fresh certified gate observation. Blocks the memory-as-
 * precedent trap (R5, 2606.04315): such an event is counted separately and is
 * INERT to the promotion gate — only fresh gate observations move the win-rate.
 * Recognised markers: `precedent === true`, `recalled === true`, `source ===
 * 'precedent'`, or `outcome === 'precedent'`.
 */
function isPrecedentEvent(ev) {
  return Boolean(
    ev &&
      (ev.precedent === true ||
        ev.recalled === true ||
        ev.source === 'precedent' ||
        ev.outcome === 'precedent'),
  );
}

/**
 * Fold an append-only event list into itemized strategy bullets at READ time
 * (never in-place — no stored monolith, no context-collapse). Groups by
 * strategy id and derives helpful/harmful/neutral counts + avg_gate_delta from
 * the raw events, so the counters are always a fresh function of the ledger.
 * Each event is `{strategyId?, scope?, criterion?, viewScope?, technique?,
 * snippetRef?, outcome, gateDelta?, iter?, runId?}`
 * (the shape lib/self-learning.mjs::fetchStrategyEvents returns).
 * @param {Array<object>} events
 * @returns {Array<object>} folded strategy items (see STRATEGY ITEM in the spec)
 */
export function foldStrategyEvents(events) {
  if (!Array.isArray(events)) return [];
  const groups = new Map();
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const id = eventId(ev);
    if (!id) continue;
    let item = groups.get(id);
    if (!item) {
      item = {
        id,
        scope: 'strategy',
        criterion: null,
        viewScope: null,
        technique: '',
        snippet: null,
        snippetRef: null,
        helpful_count: 0,
        harmful_count: 0,
        neutral_count: 0,
        // Retrieved-precedent recalls (R5 memory-as-precedent guard): counted but
        // INERT to promotion — they never touch the certified helpful/harmful/
        // neutral buckets the win-rate gate reads.
        precedent_count: 0,
        _deltaSum: 0,
        _deltaN: 0,
        avg_gate_delta: null,
        last_outcome: null,
        provenance: { first_iter: null, last_iter: null, run_id: null },
        _lastIter: -Infinity,
      };
      groups.set(id, item);
    }
    // A retrieved precedent recall is bucketed separately and left INERT to the
    // certified counts / delta / last-outcome (R5 memory-as-precedent guard):
    // only fresh gate observations may move the win-rate that drives promotion.
    if (isPrecedentEvent(ev)) {
      item.precedent_count += 1;
      const pIter = Number.isFinite(Number(ev.iter)) ? Number(ev.iter) : null;
      if (pIter !== null) {
        if (item.provenance.first_iter === null || pIter < item.provenance.first_iter) {
          item.provenance.first_iter = pIter;
        }
        if (item.provenance.last_iter === null || pIter > item.provenance.last_iter) {
          item.provenance.last_iter = pIter;
        }
      }
      continue;
    }
    const outcome = String(ev.outcome || 'neutral');
    if (outcome === 'helpful') item.helpful_count += 1;
    else if (outcome === 'harmful') item.harmful_count += 1;
    else item.neutral_count += 1;
    const delta = Number(ev.gateDelta);
    if (Number.isFinite(delta)) {
      item._deltaSum += delta;
      item._deltaN += 1;
    }
    const iter = Number.isFinite(Number(ev.iter)) ? Number(ev.iter) : null;
    if (iter !== null) {
      if (item.provenance.first_iter === null || iter < item.provenance.first_iter) {
        item.provenance.first_iter = iter;
      }
      if (item.provenance.last_iter === null || iter > item.provenance.last_iter) {
        item.provenance.last_iter = iter;
      }
    }
    // The latest-iter event wins for the descriptive fields (technique/scope/etc).
    const rank = iter === null ? item._lastIter : iter;
    if (rank >= item._lastIter) {
      item._lastIter = rank;
      if (typeof ev.scope === 'string' && ev.scope) item.scope = ev.scope;
      if (typeof ev.criterion === 'string' && ev.criterion) item.criterion = ev.criterion;
      if (typeof ev.viewScope === 'string' && ev.viewScope) item.viewScope = ev.viewScope;
      if (typeof ev.technique === 'string' && ev.technique) item.technique = ev.technique;
      if (typeof ev.runId === 'string' && ev.runId) item.provenance.run_id = ev.runId;
      item.last_outcome = outcome;
    }
    // Prefer a helpful event's snippet pointer (the code that actually worked).
    if (typeof ev.snippetRef === 'string' && ev.snippetRef) {
      if (item.snippetRef === null || outcome === 'helpful') item.snippetRef = ev.snippetRef;
    }
  }
  const out = [];
  for (const item of groups.values()) {
    item.avg_gate_delta = item._deltaN > 0 ? Math.round((item._deltaSum / item._deltaN) * 100) / 100 : null;
    delete item._deltaSum;
    delete item._deltaN;
    delete item._lastIter;
    out.push(item);
  }
  return out;
}

/**
 * R5 STRATEGY-PERSISTENCE PROMOTION GATE. Decide whether ONE folded strategy item
 * has earned a place in the re-injected "winning" set. A strategy is PROMOTED only
 * on a CERTIFIED improvement:
 *   - it has N >= `minEpisodes` INDEPENDENT fresh gate observations
 *     (n = helpful + harmful + neutral; retrieved-precedent recalls are excluded
 *     upstream by foldStrategyEvents, closing the memory-as-precedent trap);
 *   - its net effect does NOT regress (harmful <= helpful) — else it is DEMOTED;
 *   - the one-sided WILSON lower bound on its win-rate-vs-baseline (successes =
 *     the 'helpful' observations), DEFLATED by the selection-premium charge for
 *     having been chosen as the best of `numCandidates` noisy candidates, sits
 *     STRICTLY above `winrateFloor` (default 0.5).
 * The selection-premium deflation is `E[max of numCandidates std-normals]` times
 * the win-rate's own binomial standard error (winner's-curse; SkillOpt 2605.23904)
 * — so cherry-picking the best of many strategies is charged back before promotion.
 *
 * @param {object} item folded strategy item (from foldStrategyEvents).
 * @param {object} [opts]
 * @param {number} [opts.minEpisodes]  min independent observations (default 3).
 * @param {number} [opts.winrateFloor] win-rate LCB floor (default 0.5).
 * @param {number} [opts.alpha]        one-sided level for the Wilson LCB (default 0.05).
 * @param {number} [opts.numCandidates] candidates the item was selected among (default 1).
 * @returns {{promoted:boolean, demoted:boolean, n:number, winRate:number,
 *   winRateLCB:number, deflatedLCB:number, selectionPenalty:number,
 *   numCandidates:number, minEpisodes:number, winrateFloor:number, reasons:string[]}}
 */
export function promoteStrategy(item, opts = {}) {
  const {
    minEpisodes = DEFAULT_STRATEGY_MIN_EPISODES,
    winrateFloor = DEFAULT_STRATEGY_WINRATE_FLOOR,
    alpha = DEFAULT_ALPHA,
    numCandidates = 1,
  } = opts;
  const it = item && typeof item === 'object' ? item : {};
  const helpful = Math.max(0, Number(it.helpful_count) || 0);
  const harmful = Math.max(0, Number(it.harmful_count) || 0);
  const neutral = Math.max(0, Number(it.neutral_count) || 0);
  // Independent CERTIFIED-FRESH observations only (precedent recalls excluded at
  // fold time). A neutral (within-noise) result is a non-win — it stays in the
  // denominator so a mostly-neutral strategy cannot masquerade as a proven winner.
  const n = helpful + harmful + neutral;
  const winRate = n > 0 ? helpful / n : 0;
  const winRateLCB = wilsonLCB(helpful, n, alpha);
  // Winner's-curse deflation in win-rate units: charge E[max of numCandidates
  // std-normals] * the win-rate's binomial standard error.
  const se = n > 0 ? Math.sqrt((winRate * (1 - winRate)) / n) : 0;
  const selectionPenalty = selectionPremiumCharge({ sigma: se, numCandidates });
  const deflatedLCB = Math.max(0, winRateLCB - selectionPenalty);
  const demoted = harmful > helpful; // net-negative effect => flip out of the set
  const enoughEpisodes = n >= minEpisodes;
  const clearsFloor = deflatedLCB > winrateFloor;
  const promoted = enoughEpisodes && !demoted && clearsFloor;
  const reasons = [];
  if (!enoughEpisodes) {
    reasons.push(`only ${n} of ${minEpisodes} required independent observations`);
  }
  if (demoted) reasons.push(`regressing (harmful ${harmful} > helpful ${helpful}) — demote`);
  if (!clearsFloor) {
    reasons.push(
      `win-rate LCB ${deflatedLCB.toFixed(3)} (deflated by ${selectionPenalty.toFixed(3)} for ` +
        `${numCandidates} candidate(s)) not above floor ${winrateFloor}`,
    );
  }
  return {
    promoted,
    demoted,
    n,
    winRate: Math.round(winRate * 1e4) / 1e4,
    winRateLCB: Math.round(winRateLCB * 1e4) / 1e4,
    deflatedLCB: Math.round(deflatedLCB * 1e4) / 1e4,
    selectionPenalty: Math.round(selectionPenalty * 1e4) / 1e4,
    numCandidates,
    minEpisodes,
    winrateFloor,
    reasons,
  };
}

/**
 * Rank folded strategy items for re-injection. Sort key: (helpful - harmful)
 * descending, tie-broken by avg_gate_delta descending, then id for stability.
 * Options:
 *  - scope     : keep only items of this scope ('strategy' | 'anti')
 *  - criterion : keep only items for this criterion (plus 'global' when
 *                includeGlobal); undefined ⇒ keep all criteria
 *  - includeGlobal : also keep criterion==='global' items (default true)
 *  - demoteThreshold : for scope==='strategy', DEMOTE (drop) any item whose
 *                harmful_count >= helpful_count + threshold — the
 *                Dynamic-Cheatsheet counter loop that flips a soured bullet out
 *                of re-injection (default 2; disabled for scope==='anti').
 *  - promote   : for scope!=='anti', apply the R5 PROMOTION GATE — keep ONLY
 *                strategies with a CERTIFIED win-rate LCB above floor over
 *                >= minEpisodes independent observations, deflated by the pool
 *                size as the selection premium (default false ⇒ byte-identical
 *                legacy ranking for every existing caller/test).
 *  - minEpisodes / winrateFloor / alpha : promotion-gate knobs (see promoteStrategy).
 *  - limit     : cap the returned count.
 * @param {Array<object>} items
 * @param {object} [opts]
 * @returns {Array<object>}
 */
export function rankStrategies(items, opts = {}) {
  if (!Array.isArray(items)) return [];
  const {
    scope,
    criterion,
    includeGlobal = true,
    demoteThreshold = 2,
    limit,
    promote = false,
    minEpisodes,
    winrateFloor,
    alpha,
  } = opts;
  let pool = items.filter((it) => it && typeof it === 'object');
  if (scope) pool = pool.filter((it) => it.scope === scope);
  if (criterion !== undefined && criterion !== null) {
    pool = pool.filter(
      (it) => it.criterion === criterion || (includeGlobal && it.criterion === 'global'),
    );
  }
  if (scope !== 'anti' && Number.isFinite(demoteThreshold)) {
    pool = pool.filter((it) => (it.harmful_count || 0) < (it.helpful_count || 0) + demoteThreshold);
  }
  // R5 promotion gate (opt-in; scope!=='anti'). numCandidates == the surviving
  // candidate pool size at selection time, so a larger field of contenders is
  // charged a larger winner's-curse premium before any one is promoted.
  if (promote && scope !== 'anti') {
    const numCandidates = pool.length;
    pool = pool.filter(
      (it) => promoteStrategy(it, { minEpisodes, winrateFloor, alpha, numCandidates }).promoted,
    );
  }
  const score = (it) => (Number(it.helpful_count) || 0) - (Number(it.harmful_count) || 0);
  pool = [...pool].sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    const da = (Number(b.avg_gate_delta) || 0) - (Number(a.avg_gate_delta) || 0);
    if (da !== 0) return da;
    return String(a.id).localeCompare(String(b.id));
  });
  return Number.isFinite(limit) ? pool.slice(0, limit) : pool;
}

// --- AGI-PURITY GUARD (TECHNIQUE-ONLY) ---------------------------------------
//
// The cheatsheet re-injects the actor's OWN prior snippets/prose back into the
// next prompt, so it is a direct smuggling vector for answer-derived numeric
// geometry — the exact AGI-purity violation this repo forbids
// (rules/bench-agi-purity.md). The DEMONSTRATED contamination
// (mcp-data/shared/seed-lessons.sql boeing747-actor-attempt lessons) was PROSE
// with derived measurements ('6.5 -> 4.9', 'L/D 1.58', '0.767 x 8 = 6.14', a
// wingChordY helper) plus scalar assignments and THREE.Vector3(x,y,z) calls —
// NONE of which a lone coordinate-array regex catches. So the guard below is
// measured and multi-pronged: it stores only PARAMETRIC TECHNIQUE PHRASES and
// hard-rejects raw numeric geometry in ANY form.

/** Coordinate-triple array, e.g. `[-30.6, 11.4, -27.3` (the escalation-test regex). */
const COORD_TRIPLE = /\[\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*,/;

/**
 * three.js geometry-API tokens and vector/scalar setters. Matches the CLASSES
 * (Vector3/Euler/Quaternion/Matrix3/Matrix4/Float32Array), the `.setX/…/
 * setXYZ/setScalar(` and bare `.set(` mutators, and `position/rotation/scale
 * .set`. Deliberately does NOT match bare words like "matrix" or "position" in
 * prose (a legit technique may say "shear with a basis matrix") — only the
 * API-shaped forms that carry memorized coordinates.
 */
const GEOMETRY_API =
  /\b(?:vector3|euler|quaternion|matrix3|matrix4|float32array)\b|\bset[a-z]*\s*\(|\b(?:position|rotation|scale)\s*\.\s*set\b|\bnew\s+three\./i;

/** A derived measurement/ratio quoted in prose: `6.5 -> 4.9`, `0.767 x 8 = 6.14`. */
const DERIVED_MEASUREMENT =
  /-?\d+(?:\.\d+)?\s*(?:->|→|=>|=|×|\*|\/|\bx\b)\s*[−±-]?\s*\d+(?:\.\d+)?/i;

/** A named ratio followed by a number, e.g. `L/D 1.58`. */
const RATIO_LABEL = /\b[a-z]\s*\/\s*[a-z]\s+[−±-]?\d+(?:\.\d+)?/i;

/** An axis literal bound to a value, e.g. `x −30.6`, `y 11.4`, `z ±27.3`. */
const AXIS_VALUE = /(?:^|[\s(=,])[xyz]\s*(?:[=:]\s*)?[−±-]?\s*\d+(?:\.\d+)?/i;

/** Collect the purity-relevant text from a string or a strategy/anti item. */
function purityText(input) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  return [input.technique, input.snippet, input.anti_pattern, input.description, input.regressed_by]
    .filter((s) => typeof s === 'string' && s)
    .join('\n');
}

/**
 * TECHNIQUE-ONLY AGI-purity gate. Returns `{ ok, reasons }`. `ok:false` when
 * the strategy/anti CONTENT carries answer-derived numeric geometry in ANY of
 * the demonstrated forms: coordinate-triple arrays, three.js vector/setter API
 * calls, derived measurements/ratios quoted in prose, axis-bound literals, or
 * simply too many precise numeric literals (memorized geometry) — well beyond a
 * small structural count. A PARAMETRIC technique phrase ("rebuild the feature
 * as a swept LatheGeometry profile") passes; a memorized-coordinate snippet
 * does not. Used as a store-time filter AND a re-injection defense-in-depth
 * guard so contamination cannot round-trip through the cheatsheet.
 * @param {string|object} input technique string, or a strategy/anti item
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function sanitizeStrategyForPurity(input) {
  const text = purityText(input);
  const reasons = [];
  if (!text) return { ok: true, reasons };
  if (COORD_TRIPLE.test(text)) reasons.push('coordinate-triple array');
  if (GEOMETRY_API.test(text)) reasons.push('three.js vector/setter geometry API call');
  if (DERIVED_MEASUREMENT.test(text)) reasons.push('derived measurement/ratio quoted in prose');
  if (RATIO_LABEL.test(text)) reasons.push('named ratio bound to a number');
  if (AXIS_VALUE.test(text)) reasons.push('axis literal bound to a value');
  const nums = text.match(/-?\d+(?:\.\d+)?/g) || [];
  const decimals = nums.filter((n) => n.includes('.'));
  const words = text.split(/\s+/).filter(Boolean);
  if (decimals.length >= 2) reasons.push(`${decimals.length} precise decimal literals`);
  if (nums.length >= 6) reasons.push(`${nums.length} numeric literals (high count)`);
  if (words.length > 0 && nums.length / words.length > 0.25) {
    reasons.push('numeric-literal density exceeds threshold');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Shared bounded-bullet renderer for the two cheatsheet sections. Applies the
 * purity guard (defense-in-depth) so a leaked item can never reach the prompt,
 * then bounds by maxItems / maxCharsPerItem. Returns the bullet lines (without
 * a header); `[]` when nothing survives.
 */
function renderBullets(items, { maxItems, maxCharsPerItem, sanitize, line }) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (out.length >= maxItems) break;
    if (!it || typeof it !== 'object') continue;
    if (sanitize && !sanitizeStrategyForPurity(it).ok) continue;
    let text = line(it, out.length + 1);
    if (typeof text !== 'string' || !text) continue;
    if (text.length > maxCharsPerItem) text = `${text.slice(0, maxCharsPerItem)}...`;
    out.push(text);
  }
  return out;
}

/**
 * "PROVEN STRATEGIES" prompt section — the actor's own techniques that IMPROVED
 * the target, ranked, with helpful counts + avg gate delta + the winning
 * snippet when present. Returns `null` when nothing survives (never injects an
 * empty/noise section). Parallels
 * lib/self-learning.mjs::formatPriorAttemptsSection; bounded by maxItems /
 * maxCharsPerItem to cap prompt bloat near the CLI timeout.
 * @param {Array<object>} items folded+ranked 'strategy' items
 * @param {object} [opts]
 * @returns {string|null}
 */
export function formatStrategyCheatsheetSection(
  items,
  { header, maxItems = 5, maxCharsPerItem = 400, sanitize = true } = {},
) {
  const bullets = renderBullets(items, {
    maxItems,
    maxCharsPerItem,
    sanitize,
    line: (it, n) => {
      const scope = it.criterion ? `[${it.criterion}] ` : '';
      const helped = it.helpful_count ? ` — helped ${it.helpful_count}x` : '';
      const last =
        typeof it.avg_gate_delta === 'number'
          ? `, avg ${it.avg_gate_delta >= 0 ? '+' : ''}${it.avg_gate_delta}`
          : '';
      const snip = it.snippet ? ` — ${it.snippet}` : '';
      return `${n}. ${scope}${it.technique || '(unnamed technique)'}${helped}${last}${snip}`;
    },
  });
  if (bullets.length === 0) return null;
  return [
    header ||
      'PROVEN STRATEGIES (your own, that improved the target — reuse and build on these):',
    ...bullets,
  ].join('\n');
}

/**
 * "ANTI-PATTERNS" prompt section — the actor's own techniques that REGRESSED or
 * were rejected; a contrastive bad-attempts bank the actor must not repeat.
 * Returns `null` when nothing survives. Bounded like the section above.
 * @param {Array<object>} items folded 'anti' items (or harmful strategy items)
 * @param {object} [opts]
 * @returns {string|null}
 */
export function formatBadAttemptsSection(
  items,
  { header, maxItems = 3, maxCharsPerItem = 300, sanitize = true } = {},
) {
  const bullets = renderBullets(items, {
    maxItems,
    maxCharsPerItem,
    sanitize,
    line: (it, n) => {
      const scope = it.criterion ? `[${it.criterion}] ` : '';
      const desc = it.anti_pattern || it.technique || '(unnamed attempt)';
      const regressed = it.harmful_count ? ` — regressed ${it.harmful_count}x` : '';
      return `${n}. ${scope}${desc}${regressed}`;
    },
  });
  if (bullets.length === 0) return null;
  return [
    header ||
      'ANTI-PATTERNS (your own, that regressed or were rejected — do NOT repeat these):',
    ...bullets,
  ].join('\n');
}
