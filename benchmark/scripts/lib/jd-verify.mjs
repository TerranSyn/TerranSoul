// SPDX-License-Identifier: MIT
//
// MILLION-RESUME MAX-level verify helpers (2026-07-05). Pure, no I/O — the
// MAX bench (jd-max-bench.mjs) re-derives the gold predicate FROM EACH
// CANDIDATE'S OWN STORED TEXT and applies it in JS, so precision is earned
// by reading resumes, never by consulting meta.jsonl / gold.json.
//
// AGI-PURITY (rules/bench-agi-purity.md): every function here is generic
// product logic. It carries NO per-language skill lists, NO area names, NO
// role->area map, NO gold tokens. The only JD-derived inputs are the JD's
// OWN requiredSkills surface forms (which also appear verbatim in the JD
// query text a recruiter writes) and its stated minimum years — i.e. the
// query, never the answer key.
//
// Everything is pure so vitest can lock the mechanics (jd-verify.test.mjs).

/**
 * Strip the bench IPC store envelope the shim prepends to each memory
 * (`Session: <id>` / `Date: <YYYY-MM-DD>` / `Turns: <n>` header lines) so
 * verification reads the résumé text a human would see. This matters for
 * parseYears: an un-stripped `Date: 2024-05-13` injects spurious year
 * candidates (05 -> 5, 13 -> 13) and `Turns: 1` injects 1. Generic — removes
 * the store's own metadata envelope, names no domain concept.
 */
export function stripStoreEnvelope(content) {
  if (typeof content !== 'string') return '';
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && /^(Session|Date|Turns):\s/.test(lines[i])) i += 1;
  return lines.slice(i).join('\n');
}

/**
 * Parse the candidate's years-of-experience from its resume text.
 *
 * The corpus renders `{years}` as an ASCII integer (1..15). In CJK
 * languages it sits between ideographs/kana ("経験5年"), so an ASCII
 * `\b` word boundary would miss it — CJK chars are word chars. We instead
 * accept a 1-2 digit run whose immediate neighbours are NOT Latin
 * letters/digits (CJK / punctuation / whitespace neighbours are fine).
 * That rejects digits fused into Latin tokens ("OAuth2" -> ignored) while
 * accepting the standalone year value in every language.
 *
 * Returns the most frequent in-range value (ties -> larger), or null when
 * the text has no plausible standalone year integer.
 */
export function parseYears(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const re = /\d{1,2}/g;
  // A standalone year value is flanked by whitespace/CJK/punctuation-that-is-
  // not-a-number-separator. Reject digits fused into a Latin token (OAuth2)
  // AND digits joined by date/version/decimal separators (2024-05-13, 3.5,
  // 12:30) so a leftover envelope date can't masquerade as years.
  const isLatinAlnum = c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  const isNumSep = c => c === '-' || c === '/' || c === '.' || c === ':' || c === ',';
  const disqualifies = c => isLatinAlnum(c) || isNumSep(c);
  const counts = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const i = m.index;
    const s = m[0];
    const before = i > 0 ? text[i - 1] : ' ';
    const after = i + s.length < text.length ? text[i + s.length] : ' ';
    if (disqualifies(before) || disqualifies(after)) continue;
    const v = Number(s);
    if (v >= 1 && v <= 15) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v > best)) {
      bestCount = c;
      best = v;
    }
  }
  return best;
}

/**
 * True iff `surface` (a skill's Latin surface form, e.g. "SQL", "React
 * Native", "gRPC") appears in `text` as a delimited token — i.e. the
 * characters flanking the match are not Latin alphanumerics. This rejects
 * substring false hits like "SQL" inside "MySQL"/"PostgreSQL" and "Swift"
 * inside "SwiftUI", while matching the clean comma-separated skills line
 * every resume carries in every language. Case-insensitive.
 */
export function surfacePresent(text, surface) {
  if (typeof text !== 'string' || !surface) return false;
  const lower = text.toLowerCase();
  const s = surface.toLowerCase();
  const isAlnum = c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  let i = lower.indexOf(s);
  while (i >= 0) {
    const before = i > 0 ? lower[i - 1] : ' ';
    const after = i + s.length < lower.length ? lower[i + s.length] : ' ';
    if (!isAlnum(before) && !isAlnum(after)) return true;
    i = lower.indexOf(s, i + 1);
  }
  return false;
}

/**
 * Count how many of `requiredSurfaces` (the JD's required-skill surface
 * forms) appear as delimited tokens in `text`. Each surface counted at
 * most once.
 */
export function countRequiredSurfaces(text, requiredSurfaces) {
  let n = 0;
  for (const surface of requiredSurfaces) {
    if (surfacePresent(text, surface)) n += 1;
  }
  return n;
}

/**
 * Deterministic, language-agnostic slice of the gold predicate that is
 * mechanically extractable from a resume's own text: at least two of the
 * JD's required skills are named, AND the parsed years meet the JD
 * minimum. Returns { pass, skillsPresent, years }. The remaining predicate
 * dimension — same role/DOMAIN — is NOT decidable from surface tokens
 * (distractor skills cross areas), so it is handled separately by a
 * generic LLM domain judge (buildDomainJudgePrompt).
 */
export function deterministicVerify(text, requiredSurfaces, minYears) {
  const skillsPresent = countRequiredSurfaces(text, requiredSurfaces);
  const years = parseYears(text);
  const pass = skillsPresent >= 2 && years != null && years >= minYears;
  return { pass, skillsPresent, years };
}

/**
 * Generic domain-judge prompt: does each candidate PRIMARILY work in the
 * same professional role/function as the JD? Judged by the overall profile
 * and stated role/title, explicitly NOT by shared individual tools. No area
 * names, no skill lists, no gold tokens — works verbatim for any JD over any
 * resume store. Batched: one line per candidate in the reply.
 */
export function buildDomainJudgePrompt(jdText, candidates) {
  return 'You are screening candidates for the specific role in the JOB DESCRIPTION below.\n\n'
    + `JOB DESCRIPTION:\n${jdText.trim()}\n\n`
    + 'For EACH candidate resume, answer yes ONLY if their PRIMARY profession / '
    + 'specialization is the SAME as the job\'s — judged by their stated job title and the '
    + 'main focus of their experience. Many technical roles share the same programming '
    + 'languages and tools, so shared tools are NOT enough. If the candidate\'s primary role '
    + 'or specialization differs from the job\'s — even if it is an adjacent field using '
    + 'similar technologies — answer no. Resumes may be written in any language; all '
    + 'languages count equally.\n\n'
    + 'CANDIDATES (each starts with its ID in square brackets):\n'
    + candidates.map(c => `[${c.id}] ${c.text.trim()}\n`).join('')
    + '\nRespond with ONLY one line per candidate, no other text, exactly:\n'
    + 'ID | yes\n'
    + 'or\n'
    + 'ID | no';
}

/**
 * Parse the domain-judge reply into a Map(id -> boolean). Tolerant of the
 * bracketed-id form the model tends to echo (`[res-3] | yes`), stray
 * markdown, and case. Ids not in `validIds` are dropped; first line wins.
 */
export function parseDomainVerdicts(text, validIds) {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const out = new Map();
  const re = /\[?\s*([A-Za-z][\w-]*-\d+)\s*\]?\s*[|:]\s*(yes|no)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    if (valid.has(id) && !out.has(id)) out.set(id, m[2].toLowerCase() === 'yes');
  }
  return out;
}

/**
 * Final MAX ranking key for a verified candidate: more named required
 * skills first, then higher years, then better retrieval rank. Passed to a
 * stable sort. Pure and deterministic.
 */
export function rankVerified(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.skillsPresent !== a.skillsPresent) return b.skillsPresent - a.skillsPresent;
    const ay = a.years ?? -1;
    const by = b.years ?? -1;
    if (by !== ay) return by - ay;
    return (a.retrievalRank ?? 1e9) - (b.retrievalRank ?? 1e9);
  });
}

export default {
  stripStoreEnvelope,
  parseYears,
  surfacePresent,
  countRequiredSurfaces,
  deterministicVerify,
  buildDomainJudgePrompt,
  parseDomainVerdicts,
  rankVerified,
};
