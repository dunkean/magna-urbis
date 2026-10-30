import { describe, expect, it } from 'vitest';
import { applySettlementStyle } from '../src/ui/urbanSettlementStyles';
import { normalizeLayoutConfig } from '../../rust/bridge/urbanConfig';

describe('coherent settlement defaults and independent overrides', () => {
  it('clears stale overrides on a Chinese cultural reset while keeping the site programme', () => {
    const previous = normalizeLayoutConfig({ culture: 'european-organic', preset: 'morph/grid', params: { gridSpacing: [80, 90] }, programme: { intent: 'settlement', functions: { capital: 1 }, resources: [], period: '', mode: 'inspired', navigableAccess: false, lore: [] } });
    const next = applySettlementStyle('culture', previous, 'chinese');
    expect(next.layout).toMatchObject({ culture: 'chinese', preset: 'culture', recipe: 'auto', params: {}, programme: previous.programme });
    expect(next.parcels).toMatchObject({ culture: 'site', preset: 'culture', recipe: 'auto', params: {} });
    expect(previous.params).toEqual({ gridSpacing: [80, 90] });
  });
  it('provides a single dense walled core and allows a tentacular shape without changing parcel density', () => {
    const next = applySettlementStyle('walled-core', normalizeLayoutConfig(), 'chinese');
    expect(next.layout).toMatchObject({ fortification: 'wall', zone: 'core', suburbs: 'none', footprint: { nuclei: 1, epochs: 1, satellites: 0 } });
    next.layout.footprint.family = 'fingers';
    expect(next.parcels.density).toBe(2);
    expect(next.parcels.operator).toBe('strips');
    expect(next.layout.params.blockSize).toEqual({ core: [2400, 3600] });
    expect(next.layout.culture).toBe('chinese');
  });
});
