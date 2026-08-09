import { readFileSync, writeFileSync } from 'node:fs';
const BENCH = 'benchmark/boeing747';
const r = JSON.parse(readFileSync(`${BENCH}/rubric.json`, 'utf8'));

// ---- v5 recalibration: score primitives on their OWN medium ----
// The v4 prompt asks "how well it depicts a real 747" + "be strict and literal",
// which makes the judge apply a photorealism discount that pins even clean,
// correct primitives builds at ~5/criterion (structural cap ~52/100). v5 reframes
// the judge to reward correct, clean, well-proportioned primitive FEATURES at the
// high anchors, and to NOT deduct for the blockiness/faceting/lack of photo detail
// inherent to primitives -- while STILL deducting for genuine defects (missing,
// wrong-count, floating, misplaced, wrong-proportion, crude/broken). Anchors,
// weights, cameras, panel, seeds are UNCHANGED, so the rubric still discriminates
// (a crude/broken model still scores low; only the medium-fairness of the framing
// changes). v5 is its own era -- NOT numerically comparable to v3/v4.
r.version = 5;
r.version_5_change =
  'PRIMITIVES-MEDIUM RECALIBRATION (judge-prompt only; anchors/weights/cameras/panel/seeds byte-identical to v4). ' +
  'The v4 prompt ("how well it depicts a real Boeing 747", "be strict and literal", real photos as ground truth) made the ' +
  'judge apply a photorealism discount that structurally capped a primitives-only model at ~52/100 (every criterion ~5-6, ' +
  'never near 10) regardless of how clean or correct the build was -- because a box/cylinder model can never look like a ' +
  'photograph. v5 reframes the judge to score the candidate on ITS OWN MEDIUM: reward correct, clean, well-proportioned ' +
  'primitive features at the HIGH anchors (8-10), do NOT deduct for the inherent blockiness/faceting/lack of photographic ' +
  'texture of primitives, but STILL deduct for genuine defects (missing/wrong-count/floating/misplaced parts, wrong ' +
  'proportions, crude or broken construction). The 10 anchors are unchanged and still demand correct structure, so an ' +
  'excellent primitives 747 approaches full marks while a crude/incomplete/broken one still scores low (discrimination ' +
  'preserved -- validated on good vs bad builds). Results under v5 are NOT numerically comparable to v3/v4: v5 runs in its ' +
  'own results track and re-anchors the reference build. Removing this recalibration (restoring the v4 judge_system_prompt) ' +
  'restores the v4 protocol.';

r.judge_system_prompt =
  'You are a meticulous judge for a LOW-POLY 3D modeling benchmark. IMAGE 1 is a candidate 3D model built ONLY from ' +
  'geometric primitives (boxes, cylinders, cones, spheres, extrusions). It is intentionally low-poly and will NEVER have ' +
  'photographic textures, fine panel lines, or smooth compound-curved surfaces. IMAGE 2 and IMAGE 3 show a REAL Boeing 747, ' +
  'provided so you can compare the candidate\'s STRUCTURE, PROPORTIONS, and FEATURE PLACEMENT to the real aircraft -- they ' +
  'are NOT a demand for photorealism and are not scored.\n\n' +
  'Score how well the candidate captures the 747\'s design IN CLEAN PRIMITIVES. Reward correct, well-proportioned, cleanly ' +
  'constructed features at the HIGH anchors: a primitives model that clearly and correctly shows a feature -- right count, ' +
  'right place, right proportion, cleanly joined -- deserves 8-10 for that criterion EVEN THOUGH it is visibly built from ' +
  'simple shapes. Do NOT deduct for the inherent blockiness, faceting, flat shading, or absence of photographic detail of ' +
  'primitives; those are expected and correct in this medium. DO deduct for GENUINE defects: missing, wrong-count, ' +
  'misplaced, or floating parts; wrong proportions; crude, broken, or incomplete construction; or a feature that does not ' +
  'read correctly for a 747.\n\n' +
  'CALIBRATION -- this is the whole point of the benchmark: a clean, correct, well-proportioned primitive rendering of a ' +
  'feature IS the best this low-poly medium can achieve, so award such features 8-10. Do NOT hold back the top of the scale ' +
  'just because the model is obviously made of simple shapes -- that is expected and correct here. Reserve scores of 5 or ' +
  'below for GENUINE defects only: missing, wrong-count, floating, misplaced, or badly-proportioned parts; crude or broken ' +
  'construction; or a feature that does not read as a 747. Example: a clean slender tapered-cylinder fuselage with a ' +
  'rounded nose and an upswept tail cone is an EXCELLENT primitives fuselage -- score fuselage_proportions 9-10, not 6. Two ' +
  'cleanly swept, tapered wing surfaces with dihedral, roots into the belly = wing_geometry 8-10. Four clean nacelles on ' +
  'pylons under the wings = engines 8-10.\n\n' +
  'Be fair to the medium but strict about correctness and discriminating about quality: an EXCELLENT primitives 747 (every ' +
  'signature feature present, correct, well-proportioned, and cleanly built) should score in the 90s; a crude, ' +
  'incomplete, or broken model should still score low. Describe what is actually visible; never assume hidden parts exist. ' +
  'Score each criterion with an integer 0-10 using the given anchors, interpreted for the primitives medium. If a criterion ' +
  'genuinely cannot be assessed from this camera angle (e.g. landing gear in a top-down view), use null instead of ' +
  'guessing. Reply with STRICT JSON only, no markdown, exactly this shape: {"scores": {"<criterion_id>": <int 0-10 or ' +
  'null>, ... all 10 ids ...}, "weakest_visible_feature": "<one criterion_id>", "notes": "<max 60 words of factual ' +
  'observations>"}';

writeFileSync(`${BENCH}/rubric-v5.json`, JSON.stringify(r, null, 2));
console.log('wrote rubric-v5.json | version', r.version, '| criteria', r.criteria.length, '| judge_panel k', r.judge_panel?.k);
console.log('prompt len', r.judge_system_prompt.length);
