// SPDX-License-Identifier: MIT
// Unit coverage for the MILLION-RESUME MAX verify helpers (jd-verify.mjs).
import { describe, it, expect } from 'vitest';
import {
  parseYears,
  surfacePresent,
  countRequiredSurfaces,
  deterministicVerify,
  buildDomainJudgePrompt,
  parseDomainVerdicts,
  rankVerified,
} from './jd-verify.mjs';

describe('parseYears', () => {
  it('reads a standalone Latin year value', () => {
    expect(parseYears('Senior Backend Engineer with 7 years of experience.')).toBe(7);
  });
  it('reads a year fused between CJK characters (経験5年)', () => {
    expect(parseYears('Swiftを用いた開発経験5年のエンジニアです。')).toBe(5);
  });
  it('reads a Vietnamese year value', () => {
    expect(parseYears('Kỹ sư Dữ liệu với 12 năm kinh nghiệm.')).toBe(12);
  });
  it('ignores digits fused into a Latin token (OAuth2)', () => {
    expect(parseYears('Skills: OAuth2, Splunk')).toBeNull();
  });
  it('picks the most frequent in-range value on repeats', () => {
    expect(parseYears('3 years. Later, 3 years again, plus a 9.')).toBe(3);
  });
  it('returns null when no plausible year token exists', () => {
    expect(parseYears('No numbers here at all.')).toBeNull();
  });
});

describe('surfacePresent / countRequiredSurfaces', () => {
  it('matches a delimited skills-line token', () => {
    expect(surfacePresent('Skills: Python, SQL, Airflow', 'SQL')).toBe(true);
  });
  it('rejects SQL as a substring of PostgreSQL / MySQL', () => {
    expect(surfacePresent('Skills: PostgreSQL, MySQL', 'SQL')).toBe(false);
  });
  it('rejects Swift as a substring of SwiftUI', () => {
    expect(surfacePresent('Skills: SwiftUI, Realm', 'Swift')).toBe(false);
  });
  it('matches multi-word and punctuated surfaces', () => {
    expect(surfacePresent('スキル: React Native, Kotlin', 'React Native')).toBe(true);
    expect(surfacePresent('Skills: Node.js, gRPC', 'gRPC')).toBe(true);
  });
  it('counts distinct required surfaces once each', () => {
    const text = 'Skills: Rust, PostgreSQL, Kubernetes, gRPC, Rust';
    expect(countRequiredSurfaces(text, ['Rust', 'PostgreSQL', 'Kubernetes', 'gRPC'])).toBe(4);
  });
});

describe('deterministicVerify', () => {
  const req = ['Python', 'Spark', 'Airflow', 'SQL'];
  it('passes when >=2 skills named and years meet the minimum', () => {
    const v = deterministicVerify('Data Engineer, 6 years. Skills: Python, Spark, ETL', req, 3);
    expect(v).toEqual({ pass: true, skillsPresent: 2, years: 6 });
  });
  it('fails on too few named skills', () => {
    const v = deterministicVerify('Data Engineer, 6 years. Skills: Python, ETL', req, 3);
    expect(v.pass).toBe(false);
    expect(v.skillsPresent).toBe(1);
  });
  it('fails when years below the minimum', () => {
    const v = deterministicVerify('Data Engineer, 2 years. Skills: Python, Spark', req, 3);
    expect(v.pass).toBe(false);
  });
});

describe('domain judge prompt + parse', () => {
  it('prompt is generic — no area names or skill lists leak in', () => {
    const p = buildDomainJudgePrompt('Hiring a data engineer.', [{ id: 'res-1', text: 'x' }]);
    expect(p).toContain('[res-1]');
    expect(p).toContain('same');
    expect(p).not.toMatch(/data-engineering|backend|mobile/);
  });
  it('parses bracketed and bare id verdicts, case-insensitively', () => {
    const reply = '[res-1] | yes\nres-2 | NO\n[res-9] : yes';
    const v = parseDomainVerdicts(reply, new Set(['res-1', 'res-2', 'res-9']));
    expect(v.get('res-1')).toBe(true);
    expect(v.get('res-2')).toBe(false);
    expect(v.get('res-9')).toBe(true);
  });
  it('drops ids not in the valid set and keeps the first verdict', () => {
    const v = parseDomainVerdicts('[res-1] | yes\n[res-1] | no\n[res-99] | yes', new Set(['res-1']));
    expect(v.get('res-1')).toBe(true);
    expect(v.has('res-99')).toBe(false);
  });
});

describe('rankVerified', () => {
  it('orders by skill count, then years, then retrieval rank', () => {
    const ranked = rankVerified([
      { id: 'a', skillsPresent: 2, years: 9, retrievalRank: 5 },
      { id: 'b', skillsPresent: 3, years: 4, retrievalRank: 9 },
      { id: 'c', skillsPresent: 2, years: 9, retrievalRank: 1 },
      { id: 'd', skillsPresent: 2, years: 5, retrievalRank: 0 },
    ]).map(x => x.id);
    expect(ranked).toEqual(['b', 'c', 'a', 'd']);
  });
});
