/* TerranSoul — SouthWest 2026 deck controller.
 *
 * Plain, dependency-free slide engine. Exposes window.TSDeck so the /pitch
 * presenter (scripts/pitch/present.mjs, over CDP) can advance slides in sync
 * with TerranSoul's narration, and a `ts-pitch-reveal` event when the slide-4
 * button is pressed (the cue for the hidden pet to appear).
 */
(function () {
  'use strict';

  const slides = Array.from(document.querySelectorAll('.slide'));
  const total = slides.length;
  const dotsWrap = document.getElementById('deck-dots');
  const curEl = document.getElementById('deck-cur');
  const totalEl = document.getElementById('deck-total');

  let current = 1; // 1-indexed

  // ── Navigation dots ─────────────────────────────────────────────────
  slides.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
    b.addEventListener('click', () => goTo(i + 1));
    dotsWrap.appendChild(b);
  });
  if (totalEl) totalEl.textContent = String(total);

  function render() {
    slides.forEach((s, i) => s.classList.toggle('is-active', i + 1 === current));
    Array.from(dotsWrap.children).forEach((d, i) =>
      d.classList.toggle('is-active', i + 1 === current),
    );
    if (curEl) curEl.textContent = String(current);
    window.dispatchEvent(new CustomEvent('ts-deck-slide', { detail: { slide: current } }));
  }

  function goTo(n) {
    const next = Math.max(1, Math.min(total, n | 0));
    if (next === current) return current;
    current = next;
    render();
    return current;
  }
  function next() { return goTo(current + 1); }
  function prev() { return goTo(current - 1); }

  // ── Keyboard (so the presenter can drive slides 1–4 by hand) ────────
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Home') goTo(1);
    else if (e.key === 'End') goTo(total);
  });

  // ── Reveal button (slide 4) ─────────────────────────────────────────
  const revealBtn = document.getElementById('reveal-btn');
  const revealHint = document.getElementById('reveal-hint');
  let revealRequested = false;
  if (revealBtn) {
    revealBtn.addEventListener('click', () => {
      if (revealRequested) return;
      revealRequested = true;
      revealBtn.classList.add('is-spent');
      if (revealHint) revealHint.hidden = false;
      window.dispatchEvent(new CustomEvent('ts-pitch-reveal'));
    });
  }

  // ── Brain-architecture highlight passthrough (slide 7) ──────────────
  // The driver calls TSDeck.highlightBrain('prefrontal') to focus a region.
  // Drives the live diagram when present; always mirrors onto the offline
  // fallback cards (visible only when the live diagram couldn't load), so the
  // pet's "highlight each part" works whether or not the venue has internet.
  setupBrainFallback();
  function highlightBrain(regionId) {
    let live = false;
    const frame = document.getElementById('brain-frame');
    try {
      const win = frame && frame.contentWindow;
      const doc = frame && frame.contentDocument;
      const el = doc && doc.querySelector('[data-id="' + regionId + '"]');
      if (el && win) {
        // Clear any prior hover, then fire the full pointer→mouse→click sequence
        // on the matching node so the interactive diagram SELECTS it (pins its
        // detail panel) — robust whether the runtime listens for pointer, mouse,
        // click, or React-synthesized enter events. currentTarget stays the node,
        // so its data-id handler (onEnter) reads the right region.
        doc.querySelectorAll('[data-id]').forEach((n) => {
          n.dispatchEvent(new win.MouseEvent('mouseout', { bubbles: true }));
          n.dispatchEvent(new win.MouseEvent('mouseleave', { bubbles: true }));
        });
        const r = el.getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, view: win, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        try { if (win.PointerEvent) { el.dispatchEvent(new win.PointerEvent('pointerover', at)); el.dispatchEvent(new win.PointerEvent('pointerenter', at)); } } catch { /* no PointerEvent */ }
        el.dispatchEvent(new win.MouseEvent('mouseover', at));
        el.dispatchEvent(new win.MouseEvent('mouseenter', at));
        el.dispatchEvent(new win.MouseEvent('mousedown', at));
        el.dispatchEvent(new win.MouseEvent('mouseup', at));
        el.dispatchEvent(new win.MouseEvent('click', at));
        if (typeof el.click === 'function') { try { el.click(); } catch { /* svg nodes lack .click */ } }
        el.scrollIntoView({ block: 'center', inline: 'center' });
        live = true;
      }
    } catch { /* iframe not ready / cross-origin */ }

    const fb = document.getElementById('brain-fallback');
    let card = null;
    if (fb) {
      fb.querySelectorAll('.brain-region-card').forEach((c) => c.classList.remove('is-lit'));
      card = fb.querySelector('[data-fallback-id="' + regionId + '"]');
      if (card) card.classList.add('is-lit');
    }
    return live || !!card;
  }

  // Reveal the static fallback if the live brain diagram (CDN runtime) hasn't
  // rendered within a few seconds — keeps slide 7 from ever being blank.
  function setupBrainFallback() {
    const frame = document.getElementById('brain-frame');
    const fb = document.getElementById('brain-fallback');
    if (!frame || !fb) return;
    const rendered = () => {
      try {
        // The live diagram renders interpolated lobe ids (e.g. "prefrontal").
        // The raw <x-dc> template only carries placeholder/static data-ids, so
        // check for a real rendered region — not just any [data-id].
        return !!(frame.contentDocument && frame.contentDocument.querySelector('[data-id="prefrontal"]'));
      } catch { return false; }
    };
    let waited = 0;
    const iv = setInterval(() => {
      if (rendered()) { fb.hidden = true; frame.style.display = 'block'; clearInterval(iv); return; }
      waited += 500;
      if (waited >= 6000) { fb.hidden = false; frame.style.display = 'none'; clearInterval(iv); }
    }, 500);
  }

  // ── Slide 8 charts ───────────────────────────────────────────────────
  buildCompareSlide();

  // ── Public API ───────────────────────────────────────────────────────
  window.TSDeck = {
    goTo, next, prev,
    current: () => current,
    total,
    get revealRequested() { return revealRequested; },
    onReveal(cb) { window.addEventListener('ts-pitch-reveal', cb, { once: true }); },
    highlightBrain,
  };

  render();

  // ── Helpers ────────────────────────────────────────────────────────
  function buildCompareSlide() {
    const grid = document.getElementById('compare-grid');
    if (!grid) return;

    // 1. Self-improvement — SIA's own headline LawBench (Top-1 %).
    grid.appendChild(barChart({
      span: 6,
      title: 'Self-improvement on SIA’s own LawBench',
      sub: 'Top-1 accuracy, 191 charge classes (n = 913) · higher is better',
      unit: '%', max: 100,
      bars: [
        { label: 'TerranSoul · frozen 12B + memory', value: 76.3, kind: 'ts' },
        { label: 'SIA · weight-trained 120B', value: 70.1, kind: 'other' },
        { label: 'prior SOTA', value: 45.0, kind: 'other' },
        { label: 'SIA initial baseline', value: 13.5, kind: 'other' },
      ],
    }));

    // 2. Memory systems — all four metrics, TerranSoul vs the top two. Rendered
    //    as a table (wide slot) because the competitors publish Recall@5 only on
    //    LongMemEval-S — honest "—" rather than invented NDCG/MRR/R@10.
    grid.appendChild(memoryGroupChart());

    // 3a. TerranSoul playing Zork 1 autonomously — local-12B self-play, alone
    //     and with the brain. Both bars are autonomous decision-making, but
    //     the brain bar is a PERSISTENT-CAMPAIGN PEAK (across-run
    //     accumulation) while the no-brain bar is the unaided per-run mean —
    //     the caveat below states this on the slide (same disclosure
    //     treatment as the memory chart), per the repo's own de-confounding
    //     analysis (fresh per-run ≈15, peak 20).
    grid.appendChild(barChart({
      span: 4,
      title: 'TerranSoul on Zork 1 — self-play',
      sub: 'Zork score (max 350) · local 12B, autonomous decision-making',
      unit: '', max: 350,
      bars: [
        { label: '12B + brain (self-play peak)', value: 50, kind: 'ts', display: '50' },
        { label: '12B, no brain', value: 11.7, kind: 'other', display: '11.7' },
      ],
      note: 'Peak 50 is a persistent-brain campaign peak — memory accumulated ACROSS runs. '
        + 'De-confounded fresh-brain per-run: mean ~15, peak 20, vs the unaided per-run mean 11.7 shown. '
        + 'Full protocol: benchmark/terransoul/zorkgpt/README.md.',
    }));

    // 3b. A separate reliability demo — NOT autonomous self-play, so it is
    //     never drawn as a bar on the self-play axis above: a smaller 4B
    //     model taught a fixed walkthrough distilled from a stronger model
    //     (Opus 4.8), then served that taught move every turn. Rendered as a
    //     distinct stat tile (dashed border + badge) so it can't be read as
    //     "winning" the self-play comparison it isn't part of.
    grid.appendChild(statTile({
      span: 4,
      title: 'Delivery-reliability demo',
      value: '350/350',
      caption: '4B, taught replay of an Opus 4.8-distilled walkthrough — scripted replay, not self-play or autonomous learning.',
    }));

    // 4. Self-improving agents — personal-AI head-to-head (answer quality 0–10).
    //    (The RAG/retrieval comparison lives in the LongMemEval-S memory chart
    //    above — a recognized 500-question benchmark with published baselines.
    //    The former agentmemory-corpus framework chart was removed: a niche
    //    self-run corpus is not pitch-grade evidence; see benchmark/COMPARISON.md
    //    for those measurements in their proper research context.)
    grid.appendChild(barChart({
      span: 4,
      title: 'Self-improving agents — head-to-head',
      sub: 'Answer quality 0–10 · same harness, corpus & judge',
      unit: '/10', max: 10,
      bars: [
        { label: 'TerranSoul · 1.1 s', value: 9.8, kind: 'ts' },
        { label: 'OpenJarvis · 3.5 s', value: 9.6, kind: 'other' },
        { label: 'OpenClaw · 38.1 s', value: 8.4, kind: 'other' },
        { label: 'Claude Code+GENesis · 17.5 s', value: 8.2, kind: 'other' },
        { label: 'Hermes · 10.9 s', value: 6.9, kind: 'other' },
      ],
    }));

    // 5. Boeing-747 self-improve loop — two actors TerranSoul has driven
    //    through the SAME frozen primitives-only rubric (rig, cameras, scoring,
    //    stop-conditions all sha256-stamped and byte-identical across both
    //    runs), each scored by two DIFFERENT judge instruments. Grouped by
    //    judge track (not actor) so the chart's own structure carries the
    //    "only compare within a column" rule: the frozen gemma4 column is the
    //    single neutral track every actor is scored on the same way, while the
    //    vision-judge column is each actor's OWN model family grading its own
    //    build — a self-family-bias caveat carried on the panel itself, same
    //    disclosure discipline as the Zork persistent-peak caveat above.
    grid.appendChild(boeingChart());

    const foot = document.getElementById('compare-foot');
    if (foot) {
      const paperUrl = 'https://terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/';
      foot.innerHTML =
        '<span class="cmp-note">Benchmarked head-to-head against the field — the panels show only the <b>top of each category’s leaderboard</b>. '
        + 'Full field compared — <b>memory:</b> agentmemory · MemPalace · Mem0 · Letta · Zep · Cognee · Khoj · HippoRAG · Memary; '
        + '<b>RAG &amp; retrieval:</b> LangChain · LlamaIndex · RAGFlow · Haystack · GraphRAG · Obsidian; '
        + '<b>self-improving agents:</b> OpenJarvis · OpenClaw · Claude Code+GENesis · Hermes · SIA.</span>'
        + '<a class="cmp-paper" href="' + paperUrl + '" target="_blank" rel="noopener">'
        + '<img class="cmp-qr" src="assets/paper-qr.svg" alt="QR code linking to the TerranSoul research paper" width="104" height="104" />'
        + '<span class="cmp-paper-txt"><b>Full research paper — scan to read</b>'
        + '<span class="cmp-url">terransyn.github.io/TerranSoul/LLM-Brain-Design-Research-Paper/</span></span>'
        + '</a>';
    }
  }

  // Memory comparison as a GROUPED bar chart: four metrics × TerranSoul + the
  // top two memory systems, all on LongMemEval-S. Real published numbers only —
  // MemPalace reports R@5 / R@10 only, shown as an honest "—" (never fabricated).
  function memoryGroupChart() {
    const wrap = document.createElement('div');
    wrap.className = 'chart chart--span-6 mem-chart';
    const metrics = ['R@5', 'R@10', 'NDCG@10', 'MRR'];
    const systems = [
      { name: 'TerranSoul', ts: true, fill: 'url(#gradTSg)', v: [99.4, 100, 94.4, 95.2] },
      { name: 'agentmemory', fill: '#9b8fc4', v: [95.2, 98.6, 87.9, 88.2] },
      { name: 'MemPalace', fill: '#6d6486', v: [96.6, 97.6, null, null] },
    ];
    const W = 680, H = 322, base = 80, topV = 100;
    const padL = 12, padR = 16, padTop = 42, padBot = 34;
    const plotW = W - padL - padR, plotH = H - padTop - padBot;
    const yFor = (v) => padTop + plotH * (1 - (v - base) / (topV - base));
    const groupW = plotW / metrics.length, innerPad = 18, barGap = 6, nb = systems.length;
    const barW = (groupW - innerPad * 2 - barGap * (nb - 1)) / nb;
    let s = '';
    for (let g = base; g <= topV; g += 5) {
      const gy = yFor(g).toFixed(1);
      s += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" class="mg-grid"/>';
      s += '<text x="' + (W - padR + 2) + '" y="' + (yFor(g) + 3).toFixed(1) + '" class="mg-axis">' + g + '</text>';
    }
    metrics.forEach((m, gi) => {
      const gx = padL + gi * groupW + innerPad;
      systems.forEach((sys, si) => {
        const val = sys.v[gi];
        const bx = gx + si * (barW + barGap);
        const cx = (bx + barW / 2).toFixed(1);
        if (val == null) {
          s += '<text x="' + cx + '" y="' + (padTop + plotH - 4).toFixed(1) + '" class="mg-dash" text-anchor="middle">—</text>';
          return;
        }
        const by = yFor(val), bh = (padTop + plotH - by).toFixed(1);
        s += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh + '" rx="3" fill="' + sys.fill + '"/>';
        s += '<text x="' + cx + '" y="' + (by - 4).toFixed(1) + '" class="mg-val ' + (sys.ts ? 'mg-valts' : '') + '" text-anchor="middle">' + val + '</text>';
      });
      s += '<text x="' + (padL + gi * groupW + groupW / 2).toFixed(1) + '" y="' + (H - 12) + '" class="mg-metric" text-anchor="middle">' + m + '</text>';
    });
    const legend = systems.map((sys, i) =>
      '<rect x="' + (padL + i * 152) + '" y="8" width="13" height="13" rx="3" fill="' + sys.fill + '"/>'
      + '<text x="' + (padL + i * 152 + 19) + '" y="19" class="mg-leg ' + (sys.ts ? 'mg-valts' : '') + '">' + esc(sys.name) + '</text>').join('');
    wrap.innerHTML =
      '<h3>Memory systems — LongMemEval-S</h3>'
      + '<div class="chart-sub">TerranSoul vs the top two · % (axis 80–100) · higher is better</div>'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Memory systems LongMemEval-S comparison">'
      + '<defs><linearGradient id="gradTSg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFC000"/><stop offset="100%" stop-color="#F4C77E"/></linearGradient></defs>'
      + legend + s + '</svg>'
      + '<div class="mem-note">MemPalace publishes R@5 / R@10 only on this benchmark.</div>'
      + '<div class="mem-note mem-caveat">TerranSoul bars are the committed BENCH-AM-6.3 baseline, independently '
      + 'reproduced in full on 2026-07-03 (rrf_emb R@5 99.4% / NDCG@10 94.5% / MRR 95.3% with the documented '
      + 'EmbeddingGemma embedder). The briefly-tracked "RRF regression" was an embedder-config mismatch between '
      + 'runs, not a code change — resolution recorded in benchmark/results/longmemeval_s_terransoul.md.</div>';
    return wrap;
  }

  // Boeing-747 primitives-only self-improve loop. TWO judge-protocol eras live
  // on this panel and are never mixed on one axis (raw totals are never
  // compared across judge protocols):
  //  - v2 era (bars): grouped chart, 2 judge tracks x 2 actors, frozen /100
  //    rubric (benchmark/boeing747/, sha256-stamped rig/cameras/scoring/
  //    stop-conditions — identical measurement for both actors). Mirrors
  //    memoryGroupChart()'s group-by-metric / bar-by-entity shape, reusing its
  //    .mg-* CSS (see deck.css). Real committed numbers only
  //    (results/terransoul-opus48*/, results/terransoul-fable5*/) — see
  //    benchmark/BOEING-COMPARISON.md.
  //  - v4 era (the .bv4 strip below the bars): 2026-07 finals under the frozen
  //    gemma4:12b-it-qat vision judge, K=5 fixed-seed panel, reported on the
  //    reference-parity index (reference-geometry build = 63.92/100 = parity
  //    100). Each number carries its provenance in the same sentence — the
  //    knowledge-transfer 108.9 is seeded from a stronger actor's build and is
  //    NOT pure self-improvement. Sources:
  //    benchmark/boeing747/results/PARITY-INDEX-20260717.md, results/PROGRESS.md.
  function boeingChart() {
    const wrap = document.createElement('div');
    wrap.className = 'chart chart--span-12 boeing-chart';
    const groups = ['gemma4 — frozen, neutral judge', "vision judge — actor's own model family"];
    const actors = [
      { name: 'Opus 4.8 + TerranSoul', fill: 'url(#gradTSgBoeing)', v: [73.68, 68.26] },
      { name: 'Fable 5 + TerranSoul', fill: '#5B9BD5', valCls: 'mg-val mg-val--fable', v: [71.66, 63.7] },
    ];
    const W = 1120, H = 135, base = 0, topV = 100;
    const padL = 12, padR = 16, padTop = 28, padBot = 22;
    const plotW = W - padL - padR, plotH = H - padTop - padBot;
    const yFor = (v) => padTop + plotH * (1 - (v - base) / (topV - base));
    const groupW = plotW / groups.length, innerPad = 46, barGap = 22, nb = actors.length;
    const barW = (groupW - innerPad * 2 - barGap * (nb - 1)) / nb;
    let s = '';
    for (let g = base; g <= topV; g += 25) {
      const gy = yFor(g).toFixed(1);
      s += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" class="mg-grid"/>';
      s += '<text x="' + (W - padR + 2) + '" y="' + (yFor(g) + 3).toFixed(1) + '" class="mg-axis">' + g + '</text>';
    }
    groups.forEach((grp, gi) => {
      const gx = padL + gi * groupW + innerPad;
      actors.forEach((act, ai) => {
        const val = act.v[gi];
        const bx = gx + ai * (barW + barGap);
        const cx = (bx + barW / 2).toFixed(1);
        const by = yFor(val), bh = (padTop + plotH - by).toFixed(1);
        s += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh + '" rx="3" fill="' + act.fill + '"/>';
        s += '<text x="' + cx + '" y="' + (by - 4).toFixed(1) + '" class="' + (act.valCls || 'mg-val mg-valts') + '" text-anchor="middle">' + act.v[gi] + '</text>';
      });
      s += '<text x="' + (padL + gi * groupW + groupW / 2).toFixed(1) + '" y="' + (H - 12) + '" class="mg-metric" text-anchor="middle">' + esc(grp) + '</text>';
    });
    const legend = actors.map((act, i) =>
      '<rect x="' + (padL + i * 260) + '" y="8" width="13" height="13" rx="3" fill="' + act.fill + '"/>'
      + '<text x="' + (padL + i * 260 + 19) + '" y="19" class="' + (act.valCls ? 'mg-leg' : 'mg-leg mg-valts') + '">' + esc(act.name) + '</text>').join('');
    wrap.innerHTML =
      '<h3>Boeing-747 self-improve loop — primitives-only build, /100</h3>'
      + '<div class="chart-sub">Three.js primitives only, frozen 9-view rubric (rig/cameras/scoring sha256-stamped) · higher is better · '
      + 'v2-era judge protocol (2026-06/07) — raw totals are never compared across judge protocols</div>'
      + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Boeing-747 self-improve loop comparison">'
      + '<defs><linearGradient id="gradTSgBoeing" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFC000"/><stop offset="100%" stop-color="#F4C77E"/></linearGradient></defs>'
      + legend + s + '</svg>'
      + '<div class="mem-note mem-caveat">Same actor, two judges (v2-era instruments): the frozen gemma4 track is the single neutral '
      + 'instrument; the vision judge is each actor’s OWN model family grading its own build (self-family-bias caveat) — not a ranking. '
      + 'Protocol: benchmark/BOEING-COMPARISON.md; v4 finals: benchmark/boeing747/results/PARITY-INDEX-20260717.md.</div>'
      + '<div class="bv4">'
      + '<div class="bv4-head">2026-07 finals · v4 judge protocol (a different era — never compared with the /100 totals above): frozen '
      + 'gemma4:12b-it-qat vision judge, K=5 fixed-seed panel · reference-parity index (real-aircraft reference build = 63.92/100 ⇒ parity 100)</div>'
      + '<div class="bv4-row">'
      + '<div class="bv4-cell"><b class="bv4-num">86.8</b><span>pure self-improvement (raw 55.49, from 36.1 same-day) — gemma 12B actor '
      + 'only, every edit its own</span></div>'
      + '<div class="bv4-cell"><b class="bv4-num bv4-num--gold">99.7</b><span>learn-then-ace (raw 63.71) — same gemma actor after knowledge '
      + 'taught into its own memory (docs, distilled solutions, owner teaching); +12.9 index points from taught knowledge</span></div>'
      + '<div class="bv4-cell"><b class="bv4-num">108.9</b><span>knowledge-transfer (raw 69.63) — seeded from a stronger actor’s build '
      + '(owner-authorized), then improved by the gemma actor; above the reference build under the identical judge — NOT pure '
      + 'self-improvement</span></div>'
      + '</div>'
      + '<div class="bv4-thesis">Human-owned data taught into TerranSoul’s own memory raised its actor from 86.8 to 99.7 on the '
      + 'reference-parity index — with no model change.</div>'
      + '</div>';
    return wrap;
  }

  // Render a labelled bar chart as inline SVG. The label + value sit on one row
  // and the full-width bar sits below it — so even long labels (e.g.
  // "Claude Code + GENesis · 17.5 s") never collide with the bar or the value.
  // Layout is in user units; the SVG scales to its flex cell (meet).
  function barChart(opts) {
    const { title, sub, unit = '', max = 100, bars = [], span = 6, note = '' } = opts;
    const W = 340;
    const block = 42;       // per-bar block (label row + bar)
    const padTop = 4;
    const H = padTop + bars.length * block;
    const mx = 6;           // side margin
    const trackW = W - mx * 2;

    const wrap = document.createElement('div');
    wrap.className = 'chart chart--span-' + span;
    wrap.innerHTML = '<h3>' + esc(title) + '</h3><div class="chart-sub">' + esc(sub) + '</div>';

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);

    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<linearGradient id="gradTS" x1="0%" y1="0%" x2="100%" y2="0%">'
      + '<stop offset="0%" stop-color="#FFC000"/><stop offset="55%" stop-color="#5B9BD5"/>'
      + '<stop offset="100%" stop-color="#4472C4"/></linearGradient>';
    svg.appendChild(defs);

    bars.forEach((b, i) => {
      const labelY = padTop + i * block + 13;
      const barTop = padTop + i * block + 20;
      const frac = Math.max(0, Math.min(1, b.value / max));
      const w = Math.max(3, trackW * frac);
      const valCls = b.kind === 'ts' ? 'bar-val bar-val--ts' : (i === 0 ? 'bar-val bar-val--hi' : 'bar-val');

      add(svg, 'text', { x: mx, y: labelY, class: 'bar-label' }, b.label);
      add(svg, 'text', { x: W - mx, y: labelY, class: valCls, 'text-anchor': 'end' },
        (b.display != null ? b.display : fmt(b.value)) + unit);
      add(svg, 'rect', { x: mx, y: barTop, width: trackW, height: 14, rx: 6, class: 'bar-track' });
      add(svg, 'rect', { x: mx, y: barTop, width: w, height: 14, rx: 6, class: b.kind === 'ts' ? 'bar-ts' : 'bar-other' });
    });

    wrap.appendChild(svg);
    if (note) {
      const n = document.createElement('div');
      n.className = 'mem-note mem-caveat';
      n.textContent = note;
      wrap.appendChild(n);
    }
    return wrap;
  }

  // Render a "stat tile" — a single big number + caption, for figures that
  // must NOT be visually compared against the bar charts sitting next to
  // them (e.g. a scripted/taught demo shown beside autonomous self-play
  // results). It shares the .chart card shell for grid alignment but adds a
  // distinct badge + dashed border and has no axis/bars of its own, so it
  // can never read as "winning" a comparison it isn't part of.
  function statTile(opts) {
    const { title, value, caption, span = 4 } = opts;
    const wrap = document.createElement('div');
    wrap.className = 'chart chart--span-' + span + ' stat-tile';
    wrap.innerHTML =
      '<h3>' + esc(title) + '</h3>'
      + '<span class="stat-tile-badge">scripted replay demo — not self-play</span>'
      + '<div class="stat-tile-value">' + esc(value) + '</div>'
      + '<div class="stat-tile-caption">' + esc(caption) + '</div>';
    return wrap;
  }

  function add(parent, tag, attrs, text) {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  }
  function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
