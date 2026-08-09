// Deterministic synthetic / scale-corpus builder for locomo-ivfpq.mjs.
//
// Extracted verbatim from locomo-ivfpq.mjs (no behavior change) to keep that
// driver under the ESLint `max-lines` budget. The PRNG seed, swap lists and
// templates are unchanged so corpora remain byte-for-byte identical
// (mulberry32 seed 0x5ca1e1 → identical 1M / 10M corpora).

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWAP_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie',
  'Avery', 'Quinn', 'Blake', 'Reese', 'Skyler', 'Cameron', 'Hayden', 'Drew',
  'Logan', 'Parker', 'Rowan', 'Sage', 'Phoenix', 'River', 'Emerson', 'Finley',
  'Harper', 'Kendall', 'Marlow', 'Sutton', 'Wynn', 'Zion', 'Indigo', 'Lennox',
];
const SWAP_PLACES = [
  'Boston', 'Lisbon', 'Kyoto', 'Toronto', 'Berlin', 'Sydney', 'Cairo', 'Lima',
  'Dublin', 'Helsinki', 'Reykjavik', 'Auckland', 'Buenos Aires', 'Cape Town',
  'Mumbai', 'Vancouver', 'Singapore', 'Stockholm', 'Tel Aviv', 'Vienna',
];
const SWAP_HOBBIES = [
  'pottery', 'astronomy', 'birdwatching', 'fencing', 'origami', 'kite flying',
  'sourdough baking', 'rock climbing', 'gardening', 'beekeeping', 'archery',
  'sailing', 'sketching', 'magic tricks', 'puppetry', 'falconry',
];

function entitySwapParaphrase(text, rand) {
  const nameMatches = [...text.matchAll(/\b([A-Z][a-z]{2,})\b/g)].map(m => m[1]);
  const uniqueNames = [...new Set(nameMatches)];
  let result = text;
  for (const original of uniqueNames) {
    const replacement = SWAP_NAMES[Math.floor(rand() * SWAP_NAMES.length)];
    if (replacement !== original) {
      result = result.replace(new RegExp(`\\b${original}\\b`, 'g'), replacement);
    }
  }
  const place = SWAP_PLACES[Math.floor(rand() * SWAP_PLACES.length)];
  const hobby = SWAP_HOBBIES[Math.floor(rand() * SWAP_HOBBIES.length)];
  return `${result}\n(They were last in ${place} discussing ${hobby}.)`;
}

const SYNTHETIC_TEMPLATES = [
  'On a quiet evening in {place}, {name} took up {hobby} after a long week of routine errands and unrelated household projects that filled the morning.',
  'Last weekend, {name} mentioned that {hobby} had become their main escape, especially during the slower months in {place} when most of their friends were traveling.',
  'A casual conversation in {place} drifted toward {hobby}, and {name} shared a surprisingly detailed history of how the practice spread through the neighborhood over the past few seasons.',
  '{name} once spent an entire summer in {place} learning {hobby} from a quiet retiree who insisted on teaching the older method before any modern shortcuts.',
  'Although {name} initially dismissed {hobby} as too slow, a chance meeting in {place} changed their mind and led to a small collection of supplies stored in the back of a closet.',
  'Friends say {name} never took notes during their {hobby} lessons in {place}, preferring to learn by repetition over many short, unhurried sessions.',
  'There is a small workshop in {place} where {name} drops by every few months to swap stories about {hobby}, the kind of place where time loses its usual grip.',
  'No one in the family quite understands why {name} got so deeply into {hobby} after that one trip to {place}, but the routine has become a steady source of calm.',
];

function syntheticChunk(rand, idx) {
  const template = SYNTHETIC_TEMPLATES[idx % SYNTHETIC_TEMPLATES.length];
  const name = SWAP_NAMES[Math.floor(rand() * SWAP_NAMES.length)];
  const place = SWAP_PLACES[Math.floor(rand() * SWAP_PLACES.length)];
  const hobby = SWAP_HOBBIES[Math.floor(rand() * SWAP_HOBBIES.length)];
  return template.replace('{place}', place).replace('{name}', name).replace('{hobby}', hobby);
}

export function buildScaleCorpus({ targetCorpus, otherCorpora, qrels, scale, seed, synthOnly = false }) {
  const rand = mulberry32(seed);
  // an internal work item (2026-05-18): --synth-only mode pushes the bench through
  // the `add_synth_distractors` IPC fast path for every record. Gold rows
  // (and natural/swap distractors) traverse the per-row `add_sessions` path
  // which is ~74 docs/s even with synthetic embeddings due to SQLite + KG
  // insert overhead. Skipping them entirely lets the headline ingest_done
  // metric reflect pure throughput (≥1 M docs/s). qrel validation is
  // skipped because retrieval recall is undefined when gold is absent —
  // this mode is for ingest-throughput gating only.
  const corpus = synthOnly
    ? []
    : targetCorpus.map(row => ({
        id: row.id,
        text: row.text,
        title: row.title,
        tag: 'gold',
      }));
  const goldIds = new Set(synthOnly ? [] : corpus.map(r => r.id));
  let nextDistractorIdx = 0;
  if (!synthOnly) {
    for (const otherCorpus of otherCorpora) {
      for (const row of otherCorpus) {
        if (goldIds.has(row.id)) continue;
        corpus.push({
          id: `nat-${nextDistractorIdx++}-${row.id}`,
          text: row.text,
          title: row.title,
          tag: 'natural',
        });
        if (corpus.length >= scale) break;
      }
      if (corpus.length >= scale) break;
    }
    if (corpus.length < scale) {
      for (let k = 0; k < 4 && corpus.length < scale; k++) {
        for (const goldRow of targetCorpus) {
          if (corpus.length >= scale) break;
          corpus.push({
            id: `swap-${k}-${goldRow.id}`,
            text: entitySwapParaphrase(goldRow.text, rand),
            title: goldRow.title,
            tag: 'paraphrase',
          });
        }
      }
    }
  }
  let synthIdx = 0;
  while (corpus.length < scale) {
    corpus.push({
      id: `syn-${synthIdx}`,
      text: syntheticChunk(rand, synthIdx),
      title: '',
      tag: 'synthetic',
    });
    synthIdx++;
  }
  // an internal work item (2026-05-15): at 10M+ scale, building a Set over every
  // corpus id exceeds V8 Set's internal max table size. Invert the check:
  // collect the (small) set of qrel target ids first, then scan corpus once.
  // an internal work item: synth-only mode skips qrel validation (no gold in corpus,
  // recall is undefined; mode is for ingest-throughput gating only).
  if (synthOnly) {
    return { corpus, missingQrels: 0 };
  }
  const qrelTargets = new Set();
  for (const targets of qrels.values()) {
    for (const id of targets.keys()) qrelTargets.add(id);
  }
  let found = 0;
  for (const row of corpus) {
    if (qrelTargets.has(row.id)) found++;
  }
  const missing = qrelTargets.size - found;
  return { corpus, missingQrels: missing };
}
