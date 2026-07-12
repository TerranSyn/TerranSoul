/* TerranSoul — "TechTalk / jd-demo" deck controller.
 *
 * Same plain, dependency-free slide engine as southwest2026's deck.js.
 * Difference: this deck has no manual "Click to reveal!" button — the
 * presenter drives slides 1-14 by hand (arrow keys / click) for as long as
 * they like, and TerranSoul reveals itself automatically the moment the
 * deck reaches AUTO_REVEAL_SLIDE (slide 15, the brain-architecture slide),
 * by setting the same `revealRequested` flag + `ts-pitch-reveal` event the
 * /pitch presenter (scripts/pitch/present.mjs, over CDP) already polls for —
 * so present.mjs needs no changes to wait for the reveal itself.
 */
(function () {
  'use strict';

  const AUTO_REVEAL_SLIDE = 15;

  const slides = Array.from(document.querySelectorAll('.slide'));
  const total = slides.length;
  const dotsWrap = document.getElementById('deck-dots');
  const curEl = document.getElementById('deck-cur');
  const totalEl = document.getElementById('deck-total');

  let current = 1; // 1-indexed
  let revealRequested = false;

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

    if (current === AUTO_REVEAL_SLIDE && !revealRequested) {
      revealRequested = true;
      window.dispatchEvent(new CustomEvent('ts-pitch-reveal'));
    }
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

  // ── Keyboard (so the presenter can drive slides 1–14 by hand) ───────
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Home') goTo(1);
    else if (e.key === 'End') goTo(total);
  });

  // ── Brain-architecture highlight passthrough (slide 15) ─────────────
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
  // rendered within a few seconds — keeps slide 15 from ever being blank.
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

  // ── Slide 16 charts ──────────────────────────────────────────────────
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
        { label: 'zero-shot LLM', value: 7.0, kind: 'other' },
      ],
    }));

    // 2. Memory systems — all four metrics, TerranSoul vs the top two. Rendered
    //    as a table (wide slot) because the competitors publish Recall@5 only on
    //    LongMemEval-S — honest "—" rather than invented NDCG/MRR/R@10.
    grid.appendChild(memoryGroupChart());

    // 3. TerranSoul playing Zork 1 on the local 12B — alone, self-play, and after
    //    watching a stronger model (Opus 4.8) then replaying from memory (max 350).
    grid.appendChild(barChart({
      span: 4,
      title: 'TerranSoul on Zork 1 · local 12B',
      sub: 'Zork score (max 350) · memory learns from self-play and by watching a stronger model',
      unit: '', max: 350,
      bars: [
        { label: 'Watch Opus 4.8, then replay from memory', value: 350, kind: 'ts', display: '350/350' },
        { label: '12B + brain (self-play peak)', value: 45, kind: 'ts', display: '45' },
        { label: '12B, no brain', value: 0.001, kind: 'other', display: '0' },
      ],
    }));

    // 4. RAG frameworks — same corpus + shared embedder (agentmemory, R@10).
    grid.appendChild(barChart({
      span: 4,
      title: 'Retrieval — same corpus & embedder',
      sub: 'Recall@10 · agentmemory corpus · higher is better',
      unit: '%', max: 100,
      bars: [
        { label: 'TerranSoul (hybrid)', value: 66.8, kind: 'ts' },
        { label: 'RAGFlow', value: 61.0, kind: 'other' },
        { label: 'LangChain', value: 61.0, kind: 'other' },
        { label: 'LlamaIndex', value: 58.0, kind: 'other' },
        { label: 'Obsidian', value: 53.8, kind: 'other' },
        { label: 'Hermes-Agent', value: 15.8, kind: 'other' },
      ],
    }));

    // 5. Self-improving agents — personal-AI head-to-head (answer quality 0–10).
    grid.appendChild(barChart({
      span: 4,
      title: 'Self-improving agents — head-to-head',
      sub: 'Answer quality 0–10 · same harness, corpus & judge',
      unit: '/10', max: 10,
      bars: [
        { label: 'TerranSoul · 1.0 s', value: 9.8, kind: 'ts' },
        { label: 'OpenJarvis · 3.2 s', value: 9.6, kind: 'other' },
        { label: 'OpenClaw · 38.1 s', value: 8.4, kind: 'other' },
        { label: 'Claude Code+GENesis · 17.5 s', value: 8.2, kind: 'other' },
        { label: 'Hermes · 10.9 s', value: 6.9, kind: 'other' },
      ],
    }));

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
      + '<div class="mem-note">MemPalace publishes R@5 / R@10 only on this benchmark.</div>';
    return wrap;
  }

  // Render a labelled bar chart as inline SVG. The label + value sit on one row
  // and the full-width bar sits below it — so even long labels (e.g.
  // "Claude Code + GENesis · 17.5 s") never collide with the bar or the value.
  // Layout is in user units; the SVG scales to its flex cell (meet).
  function barChart(opts) {
    const { title, sub, unit = '', max = 100, bars = [], span = 6 } = opts;
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
