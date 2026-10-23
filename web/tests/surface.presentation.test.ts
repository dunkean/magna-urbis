import { describe, expect, it } from 'vitest';
import { magnaSurfacePresentation } from '../src/surface/presentation';
import { PALETTES, STYLE_LIST } from '../src/render/styles';
describe('renderer-neutral mapper presentation', () => {
  it('retains every existing map palette without translating it into a physical material', () => {
    for (const { id } of STYLE_LIST) {
      const p = magnaSurfacePresentation(`style=${id}`, 'cartographic');
      expect(p.palette).toEqual(PALETTES[id]); expect(p.palette).not.toBe(PALETTES[id]);
      expect(p.mapStyle).toBe(id); expect(p.sourceStyleExplicit).toBe(true);
      expect(p.policy.materialAssignments).toBe('preserved');
    }
  });
  it('records an explicit fallback and keeps source query intact', () => {
    const p = magnaSurfacePresentation('style=unknown&seed=42');
    expect(p.mapStyle).toBe('parchment'); expect(p.sourceStyleExplicit).toBe(false);
    expect(p.sourceQuery).toBe('style=unknown&seed=42');
  });
});
