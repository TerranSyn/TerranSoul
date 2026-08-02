/*!
 * site-nav.js — THE single source of truth for the docs-site dropdown.
 *
 * WHY THIS EXISTS. The dropdown used to be an inline <details class="ts-site-nav">
 * block copy-pasted into every page, with a comment claiming "the SAME block lives
 * on every page". It did not: audited 2026-08-02, the pages carried between 1 and
 * 26 nav links, three pages (pitch/jd-demo, pitch/southwest2026,
 * why-terransoul-brain) had no dropdown at all, and entries like the
 * "Memory-evolution companion" link existed on some pages and not others. A
 * copy-pasted block cannot stay in sync by discipline alone, so it is now
 * generated from the LINKS array below and there is exactly one copy.
 *
 * NO BUILD STEP. The published artifacts are hand-authored with no bundler (a
 * recorded project decision), and GitHub Pages serves them statically, so this is
 * plain runtime JS with no dependencies rather than an include/partial.
 *
 * PATH RESOLUTION. Pages live at different depths (docs/, docs/channels/telegram/,
 * docs/zorkgpt/claude-opus-4.8/), so relative hrefs cannot be hard-coded. The site
 * root is derived from THIS SCRIPT'S OWN URL — the script is always at
 * <root>/assets/site-nav.js, so stripping that suffix yields the root at any depth.
 * That works identically on the Pages URL, on a local file:// open, and under the
 * /TerranSoul/ project-pages prefix, none of which a hand-counted "../.." survives.
 *
 * TO ADD A PAGE: add one entry to LINKS. Every page picks it up on next load.
 * `npm run docs:check-nav` fails if any shipped page re-inlines a nav block or
 * forgets to include this script.
 */
(function () {
  'use strict';

  // Ordered exactly as the dropdown renders. `sub: true` indents the entry.
  var LINKS = [
    { href: '', label: 'Docs home' },
    { href: 'getting-started/', label: 'Getting started' },
    { href: 'install/', label: 'Installing TerranSoul', sub: true },
    { href: 'brain-architecture/', label: 'Brain architecture' },
    { href: 'brain-advanced-design/', label: 'Brain advanced design' },
    { href: 'goals-automation/', label: 'Goals &amp; automation', sub: true },
    { href: 'LLM-Brain-Design-Research-Paper/', label: 'Research paper' },
    {
      href: 'LLM-Brain-Design-Research-Paper/memory-evolution.html',
      label: '&mdash; Memory-evolution companion',
      sub: true,
    },
    { href: 'channels/', label: 'Channels' },
    { href: 'channels/telegram/', label: '&mdash; Telegram', sub: true },
    { href: 'channels/discord/', label: '&mdash; Discord', sub: true },
    { href: 'channels/slack/', label: '&mdash; Slack', sub: true },
    { href: 'channels/whatsapp/', label: '&mdash; WhatsApp', sub: true },
    { href: 'marketplace/', label: 'Marketplace' },
    { href: 'mcp-integration/', label: 'MCP integration' },
    { href: 'agentic-coding/', label: 'Agentic coding', sub: true },
    { href: 'zorkgpt/', label: 'ZorkGPT bench' },
    { href: 'zorkgpt/claude-opus-4.8/', label: '&mdash; Opus 4.8 run', sub: true },
    { href: 'zorkgpt/taughtLocalLLM/', label: '&mdash; TaughtLocalLLM run', sub: true },
    { href: 'why-terransoul-brain/', label: 'Why TerranSoul brain' },
    { href: 'help/faq.html', label: 'FAQ &amp; troubleshooting' },
    { href: 'releases/', label: "What's shipped" },
    { href: 'https://github.com/Terranimus/TerranSoul', label: 'GitHub &#8599;', external: true },
  ];

  var CSS =
    '.ts-site-nav{position:fixed;top:10px;right:12px;z-index:2147483000;font:13px/1.45 system-ui,"Segoe UI",sans-serif}' +
    '.ts-site-nav summary{list-style:none;cursor:pointer;user-select:none;background:rgba(17,19,28,.92);color:#e7e9f0;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:10px 16px;min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;backdrop-filter:blur(6px)}' +
    '.ts-site-nav summary::-webkit-details-marker{display:none}' +
    '.ts-site-nav[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0}' +
    '.ts-site-nav nav{position:absolute;right:0;min-width:230px;max-height:80vh;overflow-y:auto;display:flex;flex-direction:column;background:rgba(17,19,28,.96);border:1px solid rgba(255,255,255,.18);border-radius:10px 0 10px 10px;overflow-x:hidden;box-shadow:0 8px 28px rgba(0,0,0,.45)}' +
    '.ts-site-nav nav a{color:#e7e9f0;text-decoration:none;padding:11px 14px;min-height:44px;box-sizing:border-box;display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,.07)}' +
    '.ts-site-nav nav a:last-child{border-bottom:0}' +
    '.ts-site-nav nav a:hover{background:rgba(124,58,237,.35)}' +
    '.ts-site-nav nav a.sub{padding-left:26px;font-size:12px;opacity:.85}' +
    '.ts-site-nav nav a[aria-current="page"]{background:rgba(124,58,237,.22);font-weight:600}' +
    '@media print{.ts-site-nav{display:none}}';

  // Derive the site root from this script's own URL: <root>/assets/site-nav.js.
  // document.currentScript is unavailable in a deferred script's callbacks, so
  // capture it now, at parse time.
  var self =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (/assets\/site-nav\.js/.test(all[i].src || '')) return all[i];
      }
      return null;
    })();
  var root = self && self.src ? self.src.replace(/assets\/site-nav\.js(?:\?.*)?$/, '') : '';

  function render() {
    if (document.querySelector('.ts-site-nav')) return; // never double-inject

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var here = location.pathname.replace(/index\.html$/, '');

    var details = document.createElement('details');
    details.className = 'ts-site-nav';
    var html = '<summary>Site &#9662;</summary><nav>';
    for (var i = 0; i < LINKS.length; i++) {
      var l = LINKS[i];
      var url = l.external ? l.href : root + l.href;
      var cls = l.sub ? ' class="sub"' : '';
      // Mark the current page so a reader can see where they are.
      var current = '';
      if (!l.external) {
        try {
          var p = new URL(url, location.href).pathname.replace(/index\.html$/, '');
          if (p === here) current = ' aria-current="page"';
        } catch (e) {
          /* malformed URL — just skip the highlight */
        }
      }
      html += '<a href="' + url + '"' + cls + current + '>' + l.label + '</a>';
    }
    html += '</nav>';
    details.innerHTML = html;
    document.body.appendChild(details);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
