// SPDX-License-Identifier: MIT
//
// MILLION-RESUME-2 chat-pipeline reader (2026-07-04): pure helpers for the
// retrieval -> reader -> ranked-shortlist pipeline (jd-chat-pipeline.mjs).
//
// The reader stage mirrors how production TerranSoul chat answers "who fits
// this role": retrieval narrows the corpus to top-K, then the local LLM
// READS the retrieved resumes and produces the final ranked candidate list.
// AGI purity: the prompts below are fully generic product logic — they carry
// no job-area names, no skill lists, no language rules, no corpus/gold
// tokens. They work verbatim for any JD over any resume store.
//
// Everything in this module is pure (no I/O) so vitest can lock the
// mechanics: prompt shape, char-budget batching, robust ranked-ID parsing,
// and the map/reduce merge.

/** Render one candidate block: `[id] text` (single trailing newline). */
export function candidateBlock(candidate) {
  return `[${candidate.id}] ${candidate.text.trim()}\n`;
}

/**
 * Script-aware token estimate. The usual chars/4 heuristic is
 * English-biased: CJK scripts tokenize near 1 token/char and other
 * non-ASCII text (Vietnamese diacritics, etc.) near 1 token per 2 chars —
 * a 6,000-char Japanese batch is ~6K tokens, not ~1.5K, which overflowed
 * the reader ctx on the first live run. Generic tokenizer knowledge, no
 * language-specific product logic.
 */
export function estimateTokens(text) {
  let ascii = 0;
  let cjk = 0;
  let otherNonAscii = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 128) ascii += 1;
    else if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x4dbf)
      || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af)) cjk += 1;
    else otherNonAscii += 1;
  }
  return Math.ceil(ascii / 4 + cjk + otherNonAscii / 2);
}

/**
 * Split candidates into batches whose ESTIMATED TOKENS fit `maxTokens`
 * (prompt-budget guard for a fixed num_ctx; script-aware so a Japanese
 * batch does not overflow a budget calibrated on English). A single
 * oversized candidate still gets its own batch (never dropped). Order is
 * preserved.
 */
export function chunkByTokenBudget(candidates, maxTokens) {
  const batches = [];
  let current = [];
  let used = 0;
  for (const candidate of candidates) {
    const cost = estimateTokens(candidateBlock(candidate));
    if (current.length > 0 && used + cost > maxTokens) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(candidate);
    used += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const PROMPT_HEADER = (jdText, candidates) =>
  'You are a recruiter screening candidates for the role described below.\n\n'
  + `JOB DESCRIPTION:\n${jdText.trim()}\n\n`
  + 'CANDIDATES (each starts with its ID in square brackets):\n'
  + candidates.map(candidateBlock).join('');

/**
 * Map-phase prompt: qualification. Which of THIS BATCH's candidates satisfy
 * ALL explicit JD requirements (role/domain, every required skill, minimum
 * experience)? Returns a JSON array of qualifying IDs, strongest first.
 */
export function buildQualifyPrompt(jdText, candidates) {
  return PROMPT_HEADER(jdText, candidates)
    + '\nTask: identify which candidates satisfy ALL explicit requirements of the '
    + 'job description (the role/domain, every required skill or technology, and '
    + 'any minimum years of experience). Judge each resume only by what it states; '
    + 'resumes may be written in any language.\n\n'
    + 'Respond with ONLY a JSON array of the qualifying candidate IDs, ordered '
    + 'from strongest to weakest match, e.g. ["res-3","res-17"]. '
    + 'If none qualify, respond with [].';
}

/**
 * Ranking prompt: graded-fit ordering over every listed candidate. The
 * wording matters for small readers: an earlier "satisfy ALL explicit
 * requirements" framing made a 12B return ONLY the perfect-match subset
 * (an implicit filter) instead of a full ordering. Graded fit ("matches
 * MORE of the stated requirements") plus an exact-count output contract
 * elicits the complete ranking.
 */
export function buildRankPrompt(jdText, candidates) {
  const n = candidates.length;
  return PROMPT_HEADER(jdText, candidates)
    + `\nTask: order ALL ${n} candidates above from best fit to worst fit for `
    + 'the job description. A better fit matches MORE of the stated '
    + 'requirements: the same role/domain, more of the required skills or '
    + 'technologies, and any minimum years of experience. Resumes may be '
    + 'written in any language and all languages count equally; judge only '
    + 'what each resume states.\n\n'
    + `Respond with ONLY a JSON array containing ALL ${n} candidate IDs `
    + 'exactly once, best first, e.g. ["res-3","res-17","res-9"].';
}

/**
 * Extraction prompt: per-candidate structured facts instead of an N-way
 * ranking. A small reader is far more reliable extracting three fields
 * from one resume at a time than holding a 25-way total order; the final
 * ordering is then a DETERMINISTIC sort over the extracted fields (see
 * sortByExtraction). Fully generic: "skills specifically named in the job
 * description", "stated minimums", "role/domain" — no corpus tokens.
 */
export function buildExtractPrompt(jdText, candidates) {
  return PROMPT_HEADER(jdText, candidates)
    + '\nTask: for EACH candidate above, read the resume and report:\n'
    + '- named_skills_matched: how many of the skills/technologies '
    + 'SPECIFICALLY NAMED in the job description appear in the resume '
    + '(count each named skill at most once; unrelated skills do not count)\n'
    + '- meets_minimums: yes/no — does the resume meet every stated minimum '
    + '(such as minimum years of experience)?\n'
    + '- domain_match: yes/no — is the resume the same role/domain as the job?\n'
    + 'Resumes may be written in any language; all languages count equally.\n\n'
    + 'Respond with ONLY one line per candidate, no other text, exactly:\n'
    + 'ID | named_skills_matched=N | meets_minimums=yes/no | domain_match=yes/no';
}

/**
 * Parse extraction lines into a Map(id -> {skills, minimums, domain}).
 * Tolerant of spacing/case; lines for unknown ids are dropped; repeated
 * ids keep the first line.
 */
export function parseExtraction(text, validIds) {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const out = new Map();
  const re = /([A-Za-z][\w-]*-\d+)\s*\|\s*named_skills_matched\s*=\s*(\d+)\s*\|\s*meets_minimums\s*=\s*(yes|no)\s*\|\s*domain_match\s*=\s*(yes|no)/gi;
  for (const m of text.matchAll(re)) {
    const id = m[1];
    if (valid.has(id) && !out.has(id)) {
      out.set(id, {
        skills: Number(m[2]),
        minimums: m[3].toLowerCase() === 'yes',
        domain: m[4].toLowerCase() === 'yes',
      });
    }
  }
  return out;
}

/**
 * Deterministic ordering over extracted facts: domain match, then meeting
 * stated minimums, then named-skill count (desc). Ties — and ids with no
 * parsed extraction — keep `fallbackOrder` (the tournament ranking), so a
 * partially-parsed reply can demote nothing below where the tournament
 * already placed it.
 */
export function sortByExtraction(ids, extraction, fallbackOrder) {
  const fallbackRank = new Map(fallbackOrder.map((id, i) => [id, i]));
  const key = id => {
    const e = extraction.get(id);
    if (!e) return [0, 0, -1];
    return [e.domain ? 1 : 0, e.minimums ? 1 : 0, e.skills];
  };
  return [...ids].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < 3; i += 1) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return (fallbackRank.get(a) ?? 1e9) - (fallbackRank.get(b) ?? 1e9);
  });
}

/**
 * Parse a ranked ID list out of an LLM reply, robustly:
 * 1. Prefer the first JSON array found anywhere in the text.
 * 2. Fall back to scanning ID-shaped tokens in order of appearance.
 * Only IDs present in `validIds` survive; duplicates keep first position.
 */
export function parseRankedIds(text, validIds) {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const out = [];
  const seen = new Set();
  const push = id => {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  const arrayMatch = text.match(/\[[^\][]*\]/s);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') push(item.trim());
        }
      }
    } catch {
      // fall through to token scan
    }
  }
  if (out.length === 0) {
    for (const token of text.matchAll(/[A-Za-z][\w-]*-\d+/g)) {
      push(token[0]);
    }
  }
  return out;
}

/**
 * Reciprocal Rank Fusion over several ranked id lists (ensemble combiner
 * for multi-pass reader runs). Standard 1/(k+rank) with k=60; ties break
 * by `tieOrder` position (typically retrieval order) for determinism.
 */
export function rrfFuseRankings(lists, tieOrder, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  const tieRank = new Map(tieOrder.map((id, i) => [id, i]));
  return [...scores.keys()].sort((a, b) => {
    const d = scores.get(b) - scores.get(a);
    if (d !== 0) return d;
    return (tieRank.get(a) ?? 1e9) - (tieRank.get(b) ?? 1e9);
  });
}

/**
 * Merge the map-phase qualified lists + reduce-phase ranking into the final
 * ranked list for scoring:
 * - `reduceRanked` (the reduce call's output over the qualified union) leads;
 * - qualified IDs the reduce call dropped follow, in map order;
 * - the rest of the retrieval order pads the tail so metrics at depth K
 *   always have K entries (the reader can demote but never lose recall the
 *   retrieval stage already paid for).
 */
export function mergeRanked({ reduceRanked = [], qualified = [], retrievalOrder = [] }) {
  const out = [];
  const seen = new Set();
  const push = id => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of reduceRanked) push(id);
  for (const id of qualified) push(id);
  for (const id of retrievalOrder) push(id);
  return out;
}

export default {
  candidateBlock,
  estimateTokens,
  chunkByTokenBudget,
  buildQualifyPrompt,
  buildRankPrompt,
  buildExtractPrompt,
  parseExtraction,
  sortByExtraction,
  parseRankedIds,
  mergeRanked,
  rrfFuseRankings,
};
