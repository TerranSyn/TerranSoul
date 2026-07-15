import { describe, expect, it, vi } from 'vitest';
import { askDesignReference, formatDesignReferenceSection, resolveTerranSoulCliBinary } from './design-reference.mjs';

// These tests inject a fake `execImpl` (mirrors lib/self-learning.test.mjs's
// injected `callTool` pattern) so the OWN logic of askDesignReference —
// argv/env assembly, exit/timeout handling, fail-open behavior — is directly
// covered without spawning a real `terransoul-cli` subprocess.

describe('askDesignReference', () => {
  it('returns a usage error without spawning when query is empty', async () => {
    const execImpl = vi.fn();
    const out = await askDesignReference({ query: '', execImpl });
    expect(out).toEqual({ ok: false, error: 'askDesignReference requires a query' });
    expect(execImpl).not.toHaveBeenCalled();
  });

  it('spawns --ask --mode chat with the caller-supplied query and returns the trimmed stdout', async () => {
    const execImpl = vi.fn().mockResolvedValue({ stdout: '  The wing sweep is 37.5 degrees.  \n', stderr: '' });
    const out = await askDesignReference({ query: 'what is the wing sweep?', execImpl });
    expect(out).toEqual({ ok: true, text: 'The wing sweep is 37.5 degrees.' });
    expect(execImpl).toHaveBeenCalledWith(
      expect.any(String),
      ['--ask', 'what is the wing sweep?', '--mode', 'chat'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('forwards cliDataDir as TERRANSOUL_HEADLESS_DATA_DIR on the child env', async () => {
    const execImpl = vi.fn().mockResolvedValue({ stdout: 'answer', stderr: '' });
    await askDesignReference({ query: 'q', cliDataDir: '/some/isolated/dir', execImpl });
    const [, , opts] = execImpl.mock.calls[0];
    expect(opts.env.TERRANSOUL_HEADLESS_DATA_DIR).toBe('/some/isolated/dir');
  });

  it('uses the caller-supplied cliBinary over the default resolver', async () => {
    const execImpl = vi.fn().mockResolvedValue({ stdout: 'answer', stderr: '' });
    await askDesignReference({ query: 'q', cliBinary: '/custom/terransoul-cli', execImpl });
    const [binary] = execImpl.mock.calls[0];
    expect(binary).toBe('/custom/terransoul-cli');
  });

  it('fails open when the child returns empty stdout', async () => {
    const execImpl = vi.fn().mockResolvedValue({ stdout: '   ', stderr: '' });
    expect(await askDesignReference({ query: 'q', execImpl })).toEqual({ ok: false, error: 'empty reply' });
  });

  it('fails open (never throws) when execImpl itself rejects — spawn error, timeout, non-zero exit', async () => {
    const execImpl = vi.fn().mockRejectedValue(new Error('spawn ENOENT'));
    const out = await askDesignReference({ query: 'q', execImpl });
    expect(out.ok).toBe(false);
    expect(out.error).toContain('spawn ENOENT');
  });
});

describe('resolveTerranSoulCliBinary', () => {
  it('resolves to a path ending in the platform-appropriate binary name', () => {
    const bin = resolveTerranSoulCliBinary();
    expect(bin).toContain('terransoul-cli');
    if (process.platform === 'win32') expect(bin.endsWith('.exe')).toBe(true);
  });
});

describe('formatDesignReferenceSection', () => {
  it('returns null when the answer failed', () => {
    expect(formatDesignReferenceSection({ ok: false, error: 'tray unreachable' })).toBeNull();
  });

  it('returns null when the answer is empty/whitespace-only', () => {
    expect(formatDesignReferenceSection({ ok: true, text: '   ' })).toBeNull();
  });

  it('returns null when given null/undefined', () => {
    expect(formatDesignReferenceSection(null)).toBeNull();
    expect(formatDesignReferenceSection(undefined)).toBeNull();
  });

  it('renders a header + the answer text when ok', () => {
    const out = formatDesignReferenceSection({ ok: true, text: 'The upper-deck hump spans ~23% of total length.' });
    expect(out).toContain('DESIGN REFERENCE');
    expect(out).toContain('not a rubric answer key');
    expect(out).toContain('The upper-deck hump spans ~23% of total length.');
  });

  it('truncates long answers to maxChars with an ellipsis', () => {
    const longText = 'x'.repeat(2000);
    const out = formatDesignReferenceSection({ ok: true, text: longText }, { maxChars: 50 });
    expect(out).toContain('x'.repeat(50));
    expect(out).toContain('...');
    expect(out).not.toContain('x'.repeat(51));
  });

  it('honors a caller-supplied header', () => {
    const out = formatDesignReferenceSection({ ok: true, text: 'fact' }, { header: 'CUSTOM HEADER' });
    expect(out.split('\n')[0]).toBe('CUSTOM HEADER');
  });
});
