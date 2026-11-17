import { describe, expect, it } from 'vitest';
import { CROWN_WATER_GLSL, crownRooted, waterUnderCrown } from '../../rust/bridge/terrainCrownWater';
import { UNDERDARK_GLSL } from '../../rust/bridge/terrainRenderUnderdark';
import { TERRAIN_FS } from '../src/ui/terrainGl';

// One rule for trees and Underdark mushroom caps over rivers, lakes and the sea shore (terrainCrownWater.ts).
describe('crowns over water', () => {
  it('keeps a land-rooted crown whole over a lake shore and drops one rooted in water', () => {
    // Foot on the bank (dry), crown reaching over open lake water: it stands and hides the water it covers.
    expect(crownRooted(0)).toBe(true);
    expect(waterUnderCrown(1, 1)).toBe(0);
    expect(waterUnderCrown(1, .4)).toBeCloseTo(.6);
    // Open water beside the crown stays water.
    expect(waterUnderCrown(1, 0)).toBe(1);
    // Foot in the lake or the sea: no crown at all.
    expect(crownRooted(1)).toBe(false);
    expect(crownRooted(.6)).toBe(false);
  });

  it('is the rule the 2D ground applies to mushroom caps and tree crowns alike', () => {
    expect(CROWN_WATER_GLSL).toContain('bool crownRooted(float waterAtFoot){return waterAtFoot<0.50;}');
    // A cap is rooted at its centre (its stem), not sliced per fragment by the damp shore.
    expect(UNDERDARK_GLSL).toContain('crownRooted(crownFootWater((i+c-seed)*CELL))');
    expect(UNDERDARK_GLSL).not.toContain('(1.-smoothstep(.15,.45,wet))');
    // Rivers and lakes of the water layer, lakes without it and the antialiased sea shore all keep the crowns.
    expect(TERRAIN_FS).toContain('float crownCover=underdark?udCapCover:forestResolvedCover;');
    expect(TERRAIN_FS.match(/waterUnderCrown\([^;]*crownCover\)/g)?.length).toBe(3);
  });
});
