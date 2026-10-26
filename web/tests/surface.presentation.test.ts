import { describe, expect, it } from 'vitest';
import { magnaSurfacePresentation } from '../src/surface/presentation';
import { PALETTES, STYLE_LIST } from '../src/render/styles';
import catalogue from '../../surface/presentation/palettes.json';
import { TERRAIN_STYLE_LIST, terrainStyle } from '../src/render/terrainStyle';
describe('renderer-neutral mapper presentation', () => {
  it('ships the exact shared style catalogue used by the optional native adapter', () => {
    expect(catalogue.format).toBe('magna-surface-palette-catalogue'); expect(catalogue.version).toBe(1);
    expect(catalogue.palettes).toStrictEqual(PALETTES);
    for (const { id } of TERRAIN_STYLE_LIST) expect(catalogue.terrainStyles[id]).toEqual(terrainStyle(id));
  });
  it('preserves Render, Render3D and brush-style identities and their actual water tokens', () => {
    for (const { id } of TERRAIN_STYLE_LIST) {
      const p = magnaSurfacePresentation(`style=${id}`), source = terrainStyle(id);
      expect(p.terrainStyleId).toBe(id); expect(p.terrainStyleKind).toBe(source.kind);
      expect(p.palette).toEqual(source.palette); expect(p.water).toEqual(source.water); expect(p.sourceStyleExplicit).toBe(true);
    }
  });
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
