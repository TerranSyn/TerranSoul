import { describe, it, expect } from 'vitest';
import { normalizeOpenAiReply, buildActorRequest, openaiActorChat } from './openai-actor.mjs';

describe('normalizeOpenAiReply', () => {
  it('maps choices[0].message.content + finish_reason into the Ollama body shape', () => {
    const b = normalizeOpenAiReply({
      choices: [{ finish_reason: 'stop', message: { content: 'export function buildPlane(){}' } }],
    });
    expect(b.message.content).toContain('buildPlane');
    expect(b.message.thinking).toBe('');
    expect(b.done_reason).toBe('stop');
  });

  it('maps reasoning_content into message.thinking (thinking-swallow shape)', () => {
    const b = normalizeOpenAiReply({
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'why...' } }],
    });
    expect(b.message.content).toBe('');
    expect(b.message.thinking).toBe('why...');
    expect(b.done_reason).toBe('length');
  });

  it('is defensive on empty/garbage inputs', () => {
    expect(normalizeOpenAiReply({}).message.content).toBe('');
    expect(normalizeOpenAiReply({ choices: [] }).done_reason).toBe(null);
    expect(normalizeOpenAiReply(null).message.thinking).toBe('');
    expect(normalizeOpenAiReply({ choices: [{ message: null }] }).message.content).toBe('');
  });
});

describe('buildActorRequest (Bonsai / Qwen3.6 coding preset)', () => {
  it('NEVER runs greedy: coerces a leaked temperature:0 to the safe preset 0.6', () => {
    const req = buildActorRequest({ model: 'bonsai-27b', messages: [], options: { temperature: 0, seed: 7 } });
    expect(req.temperature).toBe(0.6);
    expect(req.seed).toBe(7);
    expect(req.model).toBe('bonsai-27b');
    expect(req.stream).toBe(false);
  });

  it('applies the Qwen3.6-27B thinking-coding sampling preset by default', () => {
    const req = buildActorRequest({ model: 'm', messages: [], options: {} });
    expect(req.temperature).toBe(0.6);
    expect(req.top_p).toBe(0.95);
    expect(req.top_k).toBe(20);
    expect(req.min_p).toBe(0.0);
    expect(req.presence_penalty).toBe(0.0);
    expect(req.repeat_penalty).toBe(1.0); // Qwen: keep at 1.0, do NOT crank
    expect(req.max_tokens).toBeUndefined(); // no default cap — run to EOS (effort-driven)
  });

  it('enables thinking by default (hard task) and lets the caller force it off', () => {
    expect(buildActorRequest({ model: 'm', messages: [], options: {} }).chat_template_kwargs.enable_thinking).toBe(true);
    expect(
      buildActorRequest({ model: 'm', messages: [], options: { enable_thinking: false } }).chat_template_kwargs.enable_thinking,
    ).toBe(false);
  });

  it('honors an explicit positive temperature and sampling / budget overrides', () => {
    const req = buildActorRequest({
      model: 'm',
      messages: [],
      options: { temperature: 0.7, top_p: 0.8, presence_penalty: 1.5, max_tokens: 32768 },
    });
    expect(req.temperature).toBe(0.7);
    expect(req.top_p).toBe(0.8);
    expect(req.presence_penalty).toBe(1.5);
    expect(req.max_tokens).toBe(32768);
  });
});

describe('openaiActorChat', () => {
  it('normalizes the reply, returns ms, and posts the enable_thinking body via injected fetch', async () => {
    let sentBody = null;
    const fakeFetch = async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'PLANE' } }] }) };
    };
    const r = await openaiActorChat({
      baseUrl: 'http://127.0.0.1:8092',
      model: 'bonsai-27b',
      messages: [{ role: 'user', content: 'build' }],
      options: { temperature: 0, seed: 7, num_predict: 4096 },
      timeoutMs: 1000,
      fetchImpl: fakeFetch,
    });
    expect(r.body.message.content).toBe('PLANE');
    expect(r.content).toBe('PLANE');
    expect(typeof r.ms).toBe('number');
    expect(sentBody.chat_template_kwargs.enable_thinking).toBe(true); // default ON for hard tasks
    expect(sentBody.temperature).toBe(0.6); // leaked temp:0 coerced away from greedy
  });

  it('throws with the status + body slice on a non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    await expect(
      openaiActorChat({ baseUrl: 'http://x', model: 'm', messages: [], options: {}, timeoutMs: 1000, fetchImpl: fakeFetch }),
    ).rejects.toThrow(/openai-actor 500/);
  });
});
