import { describe, expect, it, vi } from 'vitest';
import {
  askDesignReference,
  buildDesignReferenceQuery,
  formatDesignReferenceSection,
  resolveTerranSoulCliBinary,
} from './design-reference.mjs';

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

describe('buildDesignReferenceQuery (per-iteration retrieval query)', () => {
  it('derives the query FROM the criterion label + description when supplied (not the fixed geometry template)', () => {
    const q = buildDesignReferenceQuery({
      weakestId: 'wing_geometry',
      subject: 'Boeing 747',
      criterionLabel: 'Wing sweep (~37.5 deg), dihedral, taper',
      criterionText: 'clearly swept-back tapering wings with visible upward dihedral',
    });
    expect(q).toContain('Boeing 747');
    expect(q).toContain('Wing sweep (~37.5 deg), dihedral, taper');
    expect(q).toContain('clearly swept-back tapering wings with visible upward dihedral');
    // The old geometry-biased fixed template must NOT be used when a label/text is present.
    expect(q).not.toContain('What are the specific geometry, dimensions, proportions, or design facts about');
  });

  it('retrieves for a TECHNIQUE-shaped (craftsmanship-class) criterion: query carries its own words + techniques', () => {
    const q = buildDesignReferenceQuery({
      weakestId: 'craftsmanship',
      subject: 'Boeing 747',
      criterionLabel: 'Craftsmanship (no floating parts, z-fighting, holes)',
      criterionText: 'parts join cleanly, no holes, no z-fighting',
    });
    // The label's own technique words flow into the query so the semantic search
    // matches craftsmanship reference material rather than dimension tables.
    expect(q).toContain('Craftsmanship (no floating parts, z-fighting, holes)');
    expect(q).toContain('z-fighting');
    expect(q).toContain('construction techniques');
  });

  it('stays a DIRECT concrete question, never a meta-question ABOUT the reference material', () => {
    const q = buildDesignReferenceQuery({ subject: 'Boeing 747', criterionLabel: 'Fuselage proportions' });
    expect(q.toLowerCase()).not.toContain('what does the reference say');
    expect(q.toLowerCase()).not.toContain('reference material');
  });

  it('falls back to the legacy id-derived template when neither label nor text is supplied (byte-identical legacy query)', () => {
    const q = buildDesignReferenceQuery({ weakestId: 'upper_deck_hump', subject: 'Boeing 747' });
    expect(q).toBe(
      "What are the specific geometry, dimensions, proportions, or design facts about Boeing 747's upper deck hump? " +
        'Give concrete numbers and details, not generalities.',
    );
  });

  it('is generic: no criterion name is hardcoded — output is a pure function of the caller-supplied strings', () => {
    const src = buildDesignReferenceQuery.toString().toLowerCase();
    expect(src).not.toContain('boeing');
    expect(src).not.toContain('747');
    expect(src).not.toContain('craftsmanship');
    // A totally different domain flows through unchanged.
    const q = buildDesignReferenceQuery({ subject: 'medieval castle', criterionLabel: 'gatehouse portcullis' });
    expect(q).toContain('medieval castle gatehouse portcullis');
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
