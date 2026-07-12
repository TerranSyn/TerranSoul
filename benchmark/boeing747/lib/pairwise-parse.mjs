// PURE parse + reconcile core for the `--judge opus-pairwise` gating track of
// the Boeing 747 primitives vision benchmark. No network, no CLI, no MCP —
// judge/judge-pairwise.mjs owns transport and injects the canned CLI JSON, so
// every rule in here (verdict -> signed magnitude, the no-logprobs evidence +
// confidence cap, and the order-swap reconciliation) is directly vitest-
// covered offline (mirrors lib/judge-parse.mjs's transport-free discipline).
//
// WHY PAIRWISE + ORDER-SWAP (recipe "VLMs flip ~94% of close calls"): the
// pointwise-absolute Opus judge was the proven-weakest link. Instead we ask
// Opus, per criterion, which of two blind renders (candidate vs a fixed
// reference build) depicts the real 747 more faithfully, and we issue the SAME
// comparison TWICE with the physical A/B files swapped. A verdict that FLIPS
// when the images are swapped is direct evidence the two renders are within
// noise on that criterion.
//
// REVIEW FIX #1 (blocking): an order-INCONSISTENT (strictly-opposite-sign)
// criterion is routed to UNDECIDED (it lowers decided_fraction), NEVER given a
// 0.5 parity credit — a 0.5 credit maps to per-view score 5.0 which, against a
// bar that floors at 4.5, would AUTO-CLEAR exactly the hard detail views the
// judge is most uncertain about. A view is "cleared" only from CONSISTENT
// parity evidence; see lib/pairwise-scoring.mjs.

/** Magnitude a verdict assigns to slot A (before any candidate-slot flip). */
const A_RELATIVE_MAGNITUDE = Object.freeze({
  A_much_better: 2,
  A_better: 1,
  tie: 0,
  B_better: -1,
  B_much_better: -2,
});

/** Every verdict token the prompt allows (NA = not assessable this angle). */
export const VALID_VERDICTS = Object.freeze([
  'A_much_better',
  'A_better',
  'tie',
  'B_better',
  'B_much_better',
  'NA',
]);

/**
 * Minimum concrete-evidence length (chars) the WINNING side must supply for a
 * `much_better` verdict to survive uncapped. ~20 chars distinguishes a real
 * cited visible feature from a vacuous "engines" / "the wing".
 */
export const MIN_EVIDENCE_CHARS = 20;

// A winning-side evidence string that itself states the feature is ABSENT
// contradicts the "much better" claim (the judge cited a lack, not a strength);
// such evidence cannot lift a criterion to the extreme |2| magnitude.
const LACK_STATEMENT_RE =
  /\b(?:lacks?|missing|absent|none|without|no\s+\w+|not\s+(?:present|visible|shown|there|clearly))\b/i;

/**
 * A-relative raw magnitude for a verdict token: A_much_better=+2 ... tie=0 ...
 * B_much_better=-2. Returns `null` for 'NA' and for any unknown/malformed
 * token (the criterion is then simply not decided this order).
 */
export function rawMagnitudeA(verdict) {
  if (typeof verdict !== 'string' || verdict === 'NA') return null;
  return Object.prototype.hasOwnProperty.call(A_RELATIVE_MAGNITUDE, verdict)
    ? A_RELATIVE_MAGNITUDE[verdict]
    : null;
}

/**
 * Candidate-relative signed magnitude m ∈ {-2,-1,0,+1,+2} (no evidence cap).
 * AB order (candidateSlot='A') uses the verdict directly; BA order
 * (candidateSlot='B') inverts it, so a "B_much_better" in the BA call — where B
 * IS the candidate — becomes +2 for the candidate. Returns null for NA/unknown.
 */
export function signedMagnitude(verdict, candidateSlot) {
  const a = rawMagnitudeA(verdict);
  if (a === null) return null;
  // `+ 0` normalizes the -0 that `-0` produces so callers never see negative zero.
  return (candidateSlot === 'B' ? -a : a) + 0;
}

/** Confidence token -> ordinal rank (low<medium<high); unknown => 0 (low). */
export function confidenceRank(confidence) {
  switch (confidence) {
    case 'high':
      return 2;
    case 'medium':
      return 1;
    default:
      return 0;
  }
}

/**
 * True when an evidence string is a concrete, non-vacuous cited visible feature:
 * at least MIN_EVIDENCE_CHARS long AND it does not itself state that the side
 * LACKS the feature. This is the qualitative half of the no-logprobs cap.
 */
export function isConcreteEvidence(evidence) {
  if (typeof evidence !== 'string') return false;
  const trimmed = evidence.trim();
  if (trimmed.length < MIN_EVIDENCE_CHARS) return false;
  return !LACK_STATEMENT_RE.test(trimmed);
}

/**
 * A-relative magnitude AFTER the EVIDENCE + CONFIDENCE cap (symmetric, the
 * no-logprobs gate). |m|==2 is downgraded to |m|==1 (sign preserved) UNLESS the
 * winning side's evidence is concrete AND confidence>=medium. |m|<2 and null
 * pass through unchanged. `comparison` = {evidence_a, evidence_b, verdict,
 * confidence}.
 */
export function cappedMagnitudeA(comparison) {
  const c = comparison || {};
  const raw = rawMagnitudeA(c.verdict);
  if (raw === null || Math.abs(raw) < 2) return raw;
  const winningEvidence = raw > 0 ? c.evidence_a : c.evidence_b;
  const strong = isConcreteEvidence(winningEvidence) && confidenceRank(c.confidence) >= 1;
  return strong ? raw : Math.sign(raw);
}

/**
 * Parse ONE order of a criterion into a candidate-relative magnitude with the
 * evidence cap applied. `candidateSlot` is 'A' for the AB call and 'B' for the
 * BA call. Returns { m:number|null, decided:boolean } — decided=false when the
 * verdict is NA/unknown (this order gave no usable signal).
 */
export function parseOrder(comparison, candidateSlot) {
  const a = cappedMagnitudeA(comparison);
  if (a === null) return { m: null, decided: false };
  return { m: (candidateSlot === 'B' ? -a : a) + 0, decided: true };
}

/**
 * Reconcile the two order-swapped calls of ONE panel for ONE criterion.
 * `ab` / `ba` are parseOrder() results ({ m, decided }).
 *   - either order NA/undecided                 => UNDECIDED  (combined null)
 *   - strictly opposite signs (an order FLIP)   => INCONSISTENT (combined null,
 *       routed to the undecided fraction — REVIEW FIX #1, never a 0.5 credit)
 *   - same sign, or one side is exactly 0 (tie) => CONSISTENT (combined = mean)
 * Only a CONSISTENT panel is `decided` and can contribute a parity credit.
 * @returns {{combined:number|null, status:'consistent'|'inconsistent'|'undecided', decided:boolean}}
 */
export function reconcileOrders(ab, ba) {
  if (!ab || !ba || ab.m === null || ba.m === null) {
    return { combined: null, status: 'undecided', decided: false };
  }
  const signAB = Math.sign(ab.m);
  const signBA = Math.sign(ba.m);
  if (signAB !== 0 && signBA !== 0 && signAB !== signBA) {
    // Order flip = direct evidence of within-noise parity. Preserve N (this
    // panel still counts against decided_fraction) but grant NO parity credit.
    return { combined: null, status: 'inconsistent', decided: false };
  }
  return { combined: (ab.m + ba.m) / 2, status: 'consistent', decided: true };
}

/**
 * Reconcile a full panel from its two raw comparison objects. The AB call has
 * the candidate in physical slot A; the BA call swaps it to slot B. Thin
 * convenience over parseOrder + reconcileOrders for the canonical panel shape.
 */
export function reconcilePanel(comparisonAB, comparisonBA) {
  return reconcileOrders(parseOrder(comparisonAB, 'A'), parseOrder(comparisonBA, 'B'));
}

/** Normalize one raw criterion entry, or null when it is not a usable object. */
function normalizeComparison(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.verdict !== 'string' || !VALID_VERDICTS.includes(entry.verdict)) return null;
  return {
    evidence_a: typeof entry.evidence_a === 'string' ? entry.evidence_a : '',
    evidence_b: typeof entry.evidence_b === 'string' ? entry.evidence_b : '',
    verdict: entry.verdict,
    confidence: typeof entry.confidence === 'string' ? entry.confidence : 'low',
  };
}

/**
 * Parse the Opus reply text into per-criterion comparison entries. Tolerates a
 * stray code fence (extracts the first {...} block) exactly like the frozen
 * parseJudgeReply. FAIL-OPEN per criterion: a missing/malformed criterion entry
 * is DROPPED (listed in `dropped`) while the well-formed ones survive; only a
 * totally unparseable reply throws (the caller drops the whole panel fail-open).
 * @returns {{comparisons:Object, dropped:string[], notes:string}}
 */
export function parseComparisonsReply(text, criteriaIds) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('pairwise reply is empty');
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`pairwise reply is not JSON: ${text.slice(0, 120)}`);
    obj = JSON.parse(m[0]);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(`pairwise reply JSON is not an object: ${text.slice(0, 120)}`);
  }
  const raw =
    obj.comparisons && typeof obj.comparisons === 'object' && !Array.isArray(obj.comparisons)
      ? obj.comparisons
      : obj;
  const comparisons = {};
  const dropped = [];
  for (const id of criteriaIds) {
    const norm = normalizeComparison(raw[id]);
    if (norm) comparisons[id] = norm;
    else dropped.push(id);
  }
  return {
    comparisons,
    dropped,
    notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 400) : '',
  };
}
