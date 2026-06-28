#!/usr/bin/env node
// Bench chat-call latency. Simulates a long back-and-forth conversation
// against Ollama with the SAME options our streaming.rs uses, so we
// measure exactly the latency the user sees.
//
// Usage: node scripts/bench-chat-latency.mjs [--turns=20] [--model=gemma4:e4b]

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.+)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
  }),
);

const MODEL = args.model || 'gemma4:e4b';
const TURNS = Number.parseInt(args.turns || '20', 10);
const BASE_URL = args.url || 'http://localhost:11434';

const SHORT_SYS =
  'You are TerranSoul, a friendly AI companion. Reply in 1-3 short sentences. Always reply in the same language the user writes in. Do not use tools, animation tags, or any <think> reasoning blocks — answer directly.';

function buildBody(messages, { think = false, numPredict = 80 } = {}) {
  return {
    model: MODEL,
    messages,
    stream: true,
    think,
    keep_alive: '30m',
    options: {
      temperature: 0.7,
      num_ctx: 2048,
      num_predict: numPredict,
      num_batch: 512,
    },
  };
}

async function streamOnce(messages, opts = {}) {
  const t0 = performance.now();
  const resp = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildBody(messages, opts)),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const tHeaders = performance.now();
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let firstTokenAt = null;
  let totalChars = 0;
  let tokens = 0;
  let assistant = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const content = j?.message?.content ?? '';
        if (content) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          totalChars += content.length;
          tokens += 1;
          assistant += content;
        }
        if (j?.done) {
          /* finished */
        }
      } catch {
        // tolerate partial chunks
      }
    }
  }
  const tEnd = performance.now();
  return {
    headersMs: tHeaders - t0,
    ttftMs: (firstTokenAt ?? tEnd) - t0,
    totalMs: tEnd - t0,
    tokens,
    chars: totalChars,
    text: assistant.trim(),
  };
}

const USER_TURNS = [
  'Hi',
  'how are you?',
  'tell me a joke',
  'what is 2+2?',
  'cool',
  'nice',
  'sing a song',
  'thanks',
  'good morning',
  'good night',
  'are you a robot?',
  'what is your name?',
  'tell me about yourself',
  'I like rainy days',
  'do you sleep?',
  'what is your favorite color?',
  'haha',
  '👍',
  'ok',
  'bye',
];

function pickUser(i) {
  return USER_TURNS[i % USER_TURNS.length];
}

async function main() {
  console.log(`# bench-chat-latency  model=${MODEL}  turns=${TURNS}`);
  console.log(`# url=${BASE_URL}`);
  console.log('');

  // Warm-up: load weights into VRAM with the SAME options used by the
  // app's warm-up function (terransoul lib.rs:spawn_local_ollama_warmup).
  console.log('## Warm-up');
  const warm = await streamOnce(
    [{ role: 'user', content: 'Hi' }],
    { think: false, numPredict: 1 },
  );
  console.log(
    `warmup: headers=${warm.headersMs.toFixed(0)}ms  ttft=${warm.ttftMs.toFixed(0)}ms  total=${warm.totalMs.toFixed(0)}ms  tokens=${warm.tokens}`,
  );
  console.log('');

  // Back-and-forth loop, growing history each turn.
  const history = [{ role: 'system', content: SHORT_SYS }];
  console.log('## Conversation');
  const results = [];
  for (let i = 0; i < TURNS; i += 1) {
    const user = pickUser(i);
    history.push({ role: 'user', content: user });
    const r = await streamOnce(history, { think: false, numPredict: 80 });
    history.push({ role: 'assistant', content: r.text });
    // Cap history at last 10 turns (= 10 user + 10 assistant + 1 system)
    // to mirror our chat path's hist_window of last 4 for skip_rag.
    if (history.length > 1 + 8) {
      const sys = history[0];
      const tail = history.slice(history.length - 8);
      history.length = 0;
      history.push(sys, ...tail);
    }
    results.push(r);
    const status = r.ttftMs <= 1000 ? '✓' : '✗';
    console.log(
      `${status} turn ${String(i + 1).padStart(2)}: ttft=${r.ttftMs.toFixed(0).padStart(5)}ms  total=${r.totalMs.toFixed(0).padStart(5)}ms  tokens=${String(r.tokens).padStart(3)}  user=${JSON.stringify(user)}`,
    );
  }

  // Summary
  const ttfts = results.map((r) => r.ttftMs).sort((a, b) => a - b);
  const totals = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  console.log('');
  console.log('## Summary');
  console.log(`TTFT:  min=${ttfts[0].toFixed(0)}ms  avg=${avg(ttfts).toFixed(0)}ms  p50=${pct(ttfts, 0.5).toFixed(0)}ms  p95=${pct(ttfts, 0.95).toFixed(0)}ms  max=${ttfts[ttfts.length - 1].toFixed(0)}ms`);
  console.log(`Total: min=${totals[0].toFixed(0)}ms  avg=${avg(totals).toFixed(0)}ms  p50=${pct(totals, 0.5).toFixed(0)}ms  p95=${pct(totals, 0.95).toFixed(0)}ms  max=${totals[totals.length - 1].toFixed(0)}ms`);
  const overBudget = results.filter((r) => r.ttftMs > 1000).length;
  console.log(`Over 1s TTFT: ${overBudget}/${results.length}`);
  process.exit(overBudget > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('bench failed:', e);
  process.exit(2);
});
