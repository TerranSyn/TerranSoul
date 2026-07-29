// DETERMINISTIC Boeing-747 correctness test. Loads a candidate buildPlane(THREE)
// in Node, inspects the ACTUAL geometry (no LLM, no rendering, no variance), and
// scores objective 747 correctness 0-100 against the same 10 weighted criteria as
// the vision rubric. A build that objectively includes every feature, correctly
// placed/proportioned, scores 100 -- reproducibly. A build missing/wrong features
// scores low (discrimination is structural: the checks inspect real geometry).
// Usage: node geometry-check.mjs <path-to-plane.js> [--json]
import * as THREE from 'three';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const planeArg = process.argv[2];
const asJson = process.argv.includes('--json');
console.error = console.warn = () => {}; // silence MeshStandardMaterial shorthand warnings (keep --json stdout clean)

const mod = await import(pathToFileURL(path.resolve(planeArg)).href);
const g = mod.buildPlane(THREE);
g.updateMatrixWorld(true);

const parts = [];
g.traverse((o) => {
  if (!o.isMesh) return;
  const bb = new THREE.Box3().setFromObject(o);
  if (!isFinite(bb.min.x)) return;
  const c = new THREE.Vector3(), s = new THREE.Vector3();
  bb.getCenter(c); bb.getSize(s);
  parts.push({
    cx: c.x, cy: c.y, cz: c.z, sx: s.x, sy: s.y, sz: s.z, bb,
    type: o.geometry?.type || '?',
    color: o.material?.color?.getHex?.() ?? null,
    inst: o.isInstancedMesh ? o.count : 1,
    isCyl: /Cylinder/.test(o.geometry?.type || ''),
  });
});

const all = new THREE.Box3().setFromObject(g);
const L = all.max.x - all.min.x, W = all.max.z - all.min.z;
const halfL = L / 2, midX = (all.max.x + all.min.x) / 2;

// main fuselage = longest-X cylinder near the centreline
const body = parts.filter((p) => p.isCyl && Math.abs(p.cz) < 3 && Math.abs(p.cy) < 3)
  .sort((a, b) => b.sx - a.sx)[0] || parts.sort((a, b) => b.sx - a.sx)[0];
const bodyR = Math.min(body.sy, body.sz) / 2;
const bodyTop = body.cy + body.sy / 2, bodyBot = body.cy - body.sy / 2, bodyLen = body.sx;

// simple positional clustering of a subset by (cx,cz)
function cluster(subset, tol = 4) {
  const cl = [];
  for (const p of subset) {
    let hit = cl.find((k) => Math.abs(k.cx - p.cx) < tol && Math.abs(k.cz - p.cz) < tol);
    if (!hit) { hit = { cx: p.cx, cz: p.cz, items: [] }; cl.push(hit); }
    hit.items.push(p);
  }
  return cl;
}

// ---- classify ----
// engines: clusters below the body & outboard that contain a long nacelle cylinder
const underOut = parts.filter((p) => p.cy < bodyBot - 0.3 && Math.abs(p.cz) > 7);
const engineClusters = cluster(underOut).filter((k) => k.items.some((p) => p.isCyl && p.sx > 4));
const nEngines = engineClusters.length;
const engSymmetric = Math.abs(engineClusters.filter((k) => k.cz > 0).length - engineClusters.filter((k) => k.cz < 0).length) <= 1;

// hump: a part rising above the crown, forward of centre, not full-length
const hump = parts.find((p) => (p.cy + p.sy / 2) > bodyTop + 0.4 && p.cx > midX + 0.06 * L && p.sx < 0.6 * bodyLen && p.type === 'SphereGeometry');

// wings: flat parts (thin Y), outboard, at body level (not engines, not fin)
const wingParts = parts.filter((p) => p.sy < 3 && Math.abs(p.cz) > 4 && p.cy > bodyBot - 1.5 && (p.cy + p.sy / 2) < bodyTop + 2 && p.type === 'BoxGeometry' && p.cx > midX - 0.3 * halfL /* exclude the tail (stabilizers) */);
const wingPos = wingParts.filter((p) => p.cz > 0), wingNeg = wingParts.filter((p) => p.cz < 0);
const wingSpan = wingParts.length ? Math.max(...wingParts.map((p) => Math.abs(p.cz) + p.sz / 2)) : 0;
const wingsSym = wingPos.length >= 1 && wingNeg.length >= 1;
// sweep: outboard (larger |cz|) parts sit further aft (smaller cx); dihedral: outboard higher cy
const sortedByZ = [...wingPos].sort((a, b) => a.cz - b.cz);
const sweep = sortedByZ.length >= 2 && sortedByZ[sortedByZ.length - 1].cx < sortedByZ[0].cx - 0.5;
const dihedral = sortedByZ.length >= 2 && sortedByZ[sortedByZ.length - 1].cy > sortedByZ[0].cy + 0.3;

// empennage: tall fin at the tail + horizontal stabs at the tail
const tail = parts.filter((p) => p.cx < midX - 0.28 * halfL);
const fin = tail.find((p) => (p.cy + p.sy / 2) > bodyTop + 4 && p.sy > 5);
const stabs = tail.filter((p) => Math.abs(p.cz) > 3 && (p.cy) < bodyTop + 4 && p.sy < 3);
const stabSym = stabs.some((p) => p.cz > 0) && stabs.some((p) => p.cz < 0);

// landing gear: small parts below the body at >=2 x-locations
const gear = parts.filter((p) => p.cy < bodyBot - 0.5 && Math.abs(p.cz) < 7 && p.sx < 4 && p.sz < 4);
const gearXs = [...new Set(gear.map((p) => Math.round(p.cx / 6)))];
const gearOk = gear.length >= 4 && gearXs.length >= 2;

// windows: an instanced row (or many small parts) along the flank
const winRow = parts.find((p) => p.inst > 10) || (parts.filter((p) => p.sx < 1 && p.sy < 1).length > 15 ? { inst: 99 } : null);

// livery: distinct material colours (coherent = small palette)
const colors = [...new Set(parts.map((p) => p.color).filter((c) => c != null))];

// proportions
const ratio = bodyLen / (2 * bodyR);
const spanRatio = W / L;

// craftsmanship: no floating parts (each bbox intersects a neighbour within epsilon)
const eps = 0.6;
let floating = 0;
for (const p of parts) {
  const grown = p.bb.clone().expandByScalar(eps);
  const touches = parts.some((q) => q !== p && grown.intersectsBox(q.bb));
  if (!touches) floating++;
}

// ---- score each criterion 0/5/10 ----
const three = (cond10, cond5) => (cond10 ? 10 : cond5 ? 5 : 0);
const checks = {
  fuselage_proportions: { w: 1.2, s: three(ratio >= 8 && ratio <= 13, ratio >= 5 && ratio <= 16), why: `L/D=${ratio.toFixed(1)}` },
  engines_four_underwing: { w: 1.5, s: three(nEngines === 4 && engSymmetric, nEngines >= 2 && nEngines <= 6), why: `${nEngines} under-wing nacelle clusters, sym=${engSymmetric}` },
  upper_deck_hump: { w: 1.5, s: three(!!hump, parts.some((p) => (p.cy + p.sy / 2) > bodyTop + 0.4)), why: hump ? 'forward partial hump' : 'none' },
  wing_geometry: { w: 1.3, s: three(wingsSym && wingSpan >= 0.35 * W && (sweep || dihedral), wingsSym), why: `sym=${wingsSym} span=${(wingSpan / (W / 2)).toFixed(2)} sweep=${sweep} dih=${dihedral}` },
  empennage: { w: 1.0, s: three(!!fin && stabSym, !!fin || stabs.length > 0), why: `fin=${!!fin} stabs=${stabs.length} stabSym=${stabSym}` },
  landing_gear: { w: 0.8, s: three(gearOk, gear.length > 0), why: `${gear.length} gear parts @ ${gearXs.length} x-locations` },
  window_door_lines: { w: 0.7, s: three(!!winRow, parts.some((p) => p.sx < 1 && p.sy < 1)), why: winRow ? 'window row present' : 'none' },
  livery_coherence: { w: 0.6, s: three(colors.length >= 2 && colors.length <= 7, colors.length === 1 || colors.length <= 12), why: `${colors.length} colours` },
  silhouette_747: { w: 1.4, s: 0, why: '' },
  craftsmanship: { w: 1.0, s: three(floating === 0, floating <= 1), why: `${floating} floating parts` },
};
// silhouette = composite of the three defining cues
const cues = [nEngines === 4, !!hump, ratio >= 8 && ratio <= 13 && spanRatio >= 0.7 && spanRatio <= 1.15];
const nCues = cues.filter(Boolean).length;
checks.silhouette_747.s = nCues === 3 ? 10 : nCues === 2 ? 5 : 0;
checks.silhouette_747.why = `${nCues}/3 cues (4eng=${cues[0]} hump=${cues[1]} propo=${cues[2]})`;

let num = 0, den = 0;
for (const c of Object.values(checks)) { num += c.s * c.w; den += 10 * c.w; }
const total = (num / den) * 100;

if (asJson) {
  console.log(JSON.stringify({ total_0_100: total, checks, plane: planeArg }, null, 2));
} else {
  console.log(`DETERMINISTIC 747 CORRECTNESS: ${total.toFixed(2)}/100   (${planeArg.split(/[\\/]/).pop()})`);
  for (const [k, c] of Object.entries(checks)) console.log(`  ${k.padEnd(22)} ${String(c.s).padStart(2)}/10  (w${c.w})  ${c.why}`);
}
