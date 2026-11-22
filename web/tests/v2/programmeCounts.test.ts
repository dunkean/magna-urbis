import { describe, expect, it } from 'vitest';
import { countMode, countableRoles, programmeCountRows, requestedCounts, writeRequestedCounts } from '../../src/v2/programmeCounts';
import type { V2Settings } from '../../src/v2/contracts';
import type { UrbanProgramme } from '../../../rust/bridge/urban';

const settings = (): V2Settings => ({ options: { seed: 'counts' }, local: {}, urban: { backend: 'rust' } }) as unknown as V2Settings;

describe('special-building counts of a settlement', () => {
  it('writes the whole counts object with its mode and removes it when back to automatic', () => {
    const s = settings();
    writeRequestedCounts(s, 'a', { 'worship.parish': 4, 'defence.keep': 0 }, 'force');
    expect(s.urban!.local!.a.layout!.programme).toEqual({ counts: { 'defence.keep': 0, 'worship.parish': 4 }, countMode: 'force' });
    expect(requestedCounts(s, 'a')).toEqual({ 'defence.keep': 0, 'worship.parish': 4 });
    expect(countMode(s, 'a')).toBe('force');
    writeRequestedCounts(s, 'a', {}, 'force');
    expect(s.urban!.local!.a.layout!.programme).toBeUndefined();
    expect(countMode(s, 'a')).toBe('suggest');
  });
  it('sums the engine rows by role and lists the culture’s own types first', () => {
    const rows = programmeCountRows([{ counts: [{ role: 'worship.parish', auto: 2, placed: 2 }] } as UrbanProgramme, { counts: [{ role: 'worship.parish', auto: 1, requested: 4, placed: 1 }] } as UrbanProgramme, undefined]);
    expect(rows).toEqual([{ role: 'worship.parish', auto: 3, placed: 3 }]);
    const { own, other } = countableRoles('european-organic');
    expect(own).toContain('worship.parish');
    expect(other.some(role => own.includes(role))).toBe(false);
    expect(other.length).toBeGreaterThan(0);
  });
});
