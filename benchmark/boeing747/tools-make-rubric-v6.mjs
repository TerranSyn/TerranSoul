import { readFileSync, writeFileSync } from 'node:fs';
const BENCH = 'benchmark/boeing747';
const r = JSON.parse(readFileSync(`${BENCH}/rubric.json`, 'utf8'));

// ---- v6: OBJECTIVE CORRECTNESS CHECKLIST ----
// v4/v5 score subjective VISUAL QUALITY (0-10 per criterion), and a strict LLM
// judge never awards a perfect 10 to an imperfect low-poly model -> a literal
// 100/100 is structurally unreachable. v6 instead scores OBJECTIVE CORRECTNESS:
// for each criterion, is the feature PRESENT and CORRECT (right count, placement,
// proportion) for a 747 -- NOT how detailed/photorealistic. 10 = present+correct
// (low-poly is fine); 5 = present but a correctness error; 0 = absent/broken. A
// model that correctly includes every 747 feature earns 100 because it IS a
// correct 747; a build missing/wrong features still fails (discrimination
// preserved, validated on good/partial/bad builds). This is a pass/correctness
// benchmark (like a unit-test suite), a legitimately different measurement from
// the subjective-quality v4/v5 tracks. Its own era; not comparable to v3/v4/v5.
r.version = 6;
r.scoring_kind = 'objective_correctness_checklist';
r.version_6_change =
  'OBJECTIVE CORRECTNESS CHECKLIST (not subjective visual quality). Each criterion scores whether the 747 feature is ' +
  'PRESENT and CORRECT (right count, placement, proportion) -- NOT detail/smoothness/photorealism. 10 = present and ' +
  'correct (low-poly simplicity is fine and expected); 5 = present but a clear correctness error (wrong count, misplaced, ' +
  'wrong proportion); 0 = absent or broken. A build that correctly includes every feature earns 100 because it is a ' +
  'correct 747; a build missing or getting features wrong still scores low (discrimination preserved -- validated on ' +
  'good/partial/bad builds). Weights/cameras/panel/seeds byte-identical to v4. This is a pass/correctness measurement, its ' +
  'own era, NOT numerically comparable to the subjective-quality v3/v4/v5 tracks.';

r.judge_system_prompt =
  'You are scoring an OBJECTIVE CORRECTNESS CHECKLIST for a low-poly 3D model of a Boeing 747. IMAGE 1 is the candidate, ' +
  'built only from geometric primitives (boxes, cylinders, cones, spheres). IMAGE 2 and IMAGE 3 are real Boeing 747 ' +
  'references for comparing STRUCTURE (what features exist and where) -- they are NOT a demand for photographic realism.\n\n' +
  'For EACH criterion score ONLY whether the feature is PRESENT and CORRECT for a 747 -- correct count, placement, and ' +
  'proportion -- NOT how detailed, smooth, textured, or photorealistic it is. Use exactly this scale:\n' +
  '  10 = the feature is PRESENT and CORRECT (right count/place/proportion). Low-poly blockiness, faceting, flat shading, ' +
  'and lack of fine detail are EXPECTED and must NOT reduce the score -- if it is correctly there, it earns 10.\n' +
  '  5  = the feature is present but has a clear CORRECTNESS error (e.g. wrong engine count, hump in the wrong place, ' +
  'unswept wings, a missing tail surface, misplaced or floating parts, badly wrong proportion).\n' +
  '  0  = the feature is ABSENT, or so broken/incorrect it does not read as that 747 feature.\n\n' +
  'A model that correctly includes every 747 feature earns full marks (100). Do NOT withhold 10 because the model is ' +
  'obviously made of simple shapes -- that is the medium and is expected. Only correctness errors or absence reduce a ' +
  'score.\n\n' +
  'CRITICAL -- per-view assessability (use null correctly): score a criterion from THIS camera angle ONLY if this angle ' +
  'genuinely lets you assess it. If a feature is likely present but simply NOT ASSESSABLE from this particular view, use ' +
  'null -- NOT 0 and NOT 5. Common cases that MUST be null (not a low score): you cannot count the engines because in a ' +
  'pure side profile the left and right engines line up directly behind each other; the forward upper-deck hump is on the ' +
  'far/hidden side in a rear or opposite-profile view; the passenger windows are on the hidden side; landing gear in a ' +
  'top-down view. Reserve 0 or 5 for features that you CAN see from this angle and that are genuinely ABSENT or WRONG (e.g. ' +
  'a front/top view clearly showing only two engines, or wings clearly unswept). The full model is scored across all nine ' +
  'camera angles, so a feature you cannot judge here will be judged where it is visible -- a genuinely missing or wrong ' +
  'feature will still be caught in the views that can see it. Describe what is actually visible; never assume hidden parts. ' +
  'Reply with STRICT JSON only, no markdown, exactly: ' +
  '{"scores": {"<criterion_id>": <10, 5, 0, or null>, ... all 10 ids ...}, "weakest_visible_feature": "<one criterion_id>", ' +
  '"notes": "<max 60 words of factual observations>"}';

// rewrite anchors as explicit correctness levels (present+correct=10, error=5, absent=0)
const A = {
  engines_four_underwing: { 0: 'no engines, or engines on the fuselage/tail', 5: 'engines present but wrong count (not four), or floating/misplaced/not under the wings', 10: 'exactly four engine nacelles, under the wings, on pylons (low-poly is fine)' },
  upper_deck_hump: { 0: 'no hump; fuselage is a plain tube', 5: 'a hump exists but in the wrong place (mid/rear) or runs the full length (A380-like)', 10: 'a partial-length upper-deck hump on the forward fuselage (low-poly is fine)' },
  fuselage_proportions: { 0: 'no recognizable fuselage, or a stubby/balloon body', 5: 'a tube but clearly wrong proportion or blunt un-tapered ends', 10: 'a slender tube (~roughly 9-12x its diameter) with a tapered nose and tail (low-poly is fine)' },
  wing_geometry: { 0: 'no wings', 5: 'wings present but unswept, or lacking taper/dihedral, or at 90 degrees', 10: 'swept-back, tapering wings with dihedral, mounted on the fuselage (low-poly is fine)' },
  empennage: { 0: 'no tail surfaces', 5: 'one tail surface missing, or surfaces unswept/badly misproportioned', 10: 'a tall vertical fin plus horizontal stabilizers at the tail (low-poly is fine)' },
  landing_gear: { 0: 'no landing gear where the view should show it', 5: 'gear present but wrong count/placement (e.g. one central strut, floating wheels)', 10: 'nose gear plus main gear under the wing/body (low-poly is fine)' },
  window_door_lines: { 0: 'no surface detail at all', 5: 'window/door detail present but misplaced or wildly oversized', 10: 'a passenger window line (and/or cockpit/doors) along the fuselage (low-poly is fine)' },
  livery_coherence: { 0: 'chaotic random colors or all-black/unlit surfaces', 5: 'mostly coherent but with arbitrarily mismatched part colors', 10: 'a coherent airliner color scheme (low-poly is fine)' },
  silhouette_747: { 0: 'not recognizable as an aircraft', 5: 'an aircraft but the silhouette suggests the wrong type (generic/A380/narrowbody)', 10: 'the silhouette reads as a Boeing 747 (partial hump + four engines + widebody proportions)' },
  craftsmanship: { 0: 'broken: detached floating parts everywhere or giant holes', 5: 'several visibly floating/intersecting parts or clear gaps', 10: 'parts connect cleanly with no floating pieces or holes (low-poly is fine)' },
};
for (const c of r.criteria) if (A[c.id]) c.anchors = A[c.id];

writeFileSync(`${BENCH}/rubric-v6.json`, JSON.stringify(r, null, 2));
console.log('wrote rubric-v6.json | version', r.version, '| criteria', r.criteria.length, '| prompt', r.judge_system_prompt.length, 'chars');
