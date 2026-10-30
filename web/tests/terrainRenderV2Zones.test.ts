import { describe, expect, it } from 'vitest';
import { CLIMATE_ZONES } from '../../rust/bridge/terrainClimate';
import { RENDER_V2_ZONE_GLSL, renderV2ZoneUniform } from '../../rust/bridge/terrainRenderV2Zones';
import { FOREST_PRELUDE_GLSL, FOREST_GLSL } from '../../rust/bridge/terrainForest';

describe('Render v2 climate zone table', () => {
  it('maps an absent zone to 0 and each zone to its index + 1', () => {
    expect(renderV2ZoneUniform(undefined)).toBe(0);
    CLIMATE_ZONES.forEach((zone, i) => expect(renderV2ZoneUniform(zone)).toBe(i + 1));
  });
  it('declares one row per climate zone in every table', () => {
    const tables = [...RENDER_V2_ZONE_GLSL.matchAll(/const vec[34] (V2_ZONE_\w+)\[(\d+)\]=vec[34]\[\d+\]\(([^;]*)\);/g)];
    expect(tables.length).toBeGreaterThanOrEqual(6);
    for (const [, name, size, body] of tables) {
      expect(Number(size), name).toBe(CLIMATE_ZONES.length);
      expect(body.match(/vec[34]\(/g)?.length, name).toBe(CLIMATE_ZONES.length);
    }
  });
  it('is wired once through the forest prelude and its single field read', () => {
    expect(FOREST_PRELUDE_GLSL).toContain('uniform int uMaterialZone;');
    expect(FOREST_GLSL).toContain('return v2ZoneForest(textureLod(uForestField');
  });
});
