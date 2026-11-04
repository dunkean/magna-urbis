import { describe, expect, it } from 'vitest';
import { biomePalette } from '../src/render/biomes';
import { colourDistance } from '../src/render/roofContrast';
import { forestLandPaint, markedForest, setLanduseForestTone, getLanduseForestTone, DEFAULT_LANDUSE_FOREST_TONE } from '../src/render/landuseForestTone';

const rgb = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h: string): number => { const [r, g, b] = rgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

describe('forest land-use tone', () => {
  it('defaults to the marked green', () => { expect(DEFAULT_LANDUSE_FOREST_TONE).toBe('marked'); expect(getLanduseForestTone()).toBe('marked'); });
  for (const [style, biome] of [['parchment', 'temperate'], ['topographic', 'forest'], ['illuminated', 'tropical']] as const) {
    it(`marked is darker and greener than the palette forest (${style}/${biome})`, () => {
      const pal = biomePalette(style as never, biome as never);
      const paint = forestLandPaint(pal, 'marked');
      expect(lum(paint.color)).toBeLessThan(lum(pal.land.forest));
      const [r, g, b] = rgb(paint.color); expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b);
      expect(paint.alpha).toBeGreaterThan(0.7);
    });
    it(`ground takes the open-ground tone, close to the meadow wash (${style}/${biome})`, () => {
      const pal = biomePalette(style as never, biome as never);
      const paint = forestLandPaint(pal, 'ground');
      expect(colourDistance(rgb(paint.color), rgb(pal.land.meadow))).toBeLessThan(colourDistance(rgb(markedForest(pal.land.forest)), rgb(pal.land.meadow)));
      expect(paint.alpha).toBeLessThanOrEqual(0.8);
    });
  }
  it('follows the shared setting when no tone is passed', () => {
    const pal = biomePalette('parchment' as never, 'temperate' as never);
    setLanduseForestTone('ground'); const ground = forestLandPaint(pal);
    setLanduseForestTone('marked'); const marked = forestLandPaint(pal);
    expect(ground.color).not.toBe(marked.color);
  });
});
