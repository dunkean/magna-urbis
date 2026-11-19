import { describe, expect, it, vi } from 'vitest';
import { AUTUMN_CROWN_MEAN, autumnCrownTint } from '../../rust/bridge/terrainForestSeason';
import { TerrainGl } from '../src/ui/terrainGl';
import { TerrainGpu } from '../src/ui/terrainGpu';
import { ContentRevision } from '../src/ui/terrain/revision';
import { applySeason, type SeasonPaint } from '../src/render/seasonPalette';
import { PALETTES } from '../src/render/styles';

describe('unresolved seasonal crowns', () => {
  it.each([0, 0.4, 1])('uses the same autumn population for vector crowns and forest washes with evergreen share %s', evergreen => {
    const season: SeasonPaint = { herb: [1, 1, 1], leaf: 1, evergreen, snow: 0, spring: 0, autumn: 1, seaIce: 0, winter: 0 };
    const pal = PALETTES.parchment,
      painted = applySeason(pal, season);
    const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    for (const [before, after] of [
      [pal.land.forest, painted.land.forest],
      [pal.treeFill, painted.treeFill],
      [pal.treeInk, painted.treeInk],
    ]) {
      const color = rgb(before),
        lum = color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
      expect(rgb(after)).toEqual(color.map((c, i) => Math.round(Math.min(255, c * (1 - (1 - evergreen) * AUTUMN_CROWN_MEAN.weight) + lum * AUTUMN_CROWN_MEAN.hue[i] * (1 - evergreen)))));
    }
  });
  it.each([0, 0.25, 0.6, 1])('integrates the orange, rust, gold and still-green crowns at fall weight %s', fall => {
    // Different exposures and starting hues must retain the same local mean as their resolved population.
    for (const crown of [
      [0.12, 0.26, 0.07],
      [0.3, 0.34, 0.17],
      [0.05, 0.09, 0.04],
    ]) {
      const lum = crown[0] * 0.2126 + crown[1] * 0.7152 + crown[2] * 0.0722;
      const population = [0, 0, 0];
      const categories = new Set<number>();
      for (let i = 0; i < 256; i++) {
        const tint = autumnCrownTint((i + 0.5) / 256);
        categories.add(Math.round(tint.hue[0] * 100));
        for (let c = 0; c < 3; c++) population[c] += (crown[c] * (1 - fall * tint.weight) + lum * tint.hue[c] * fall * tint.weight) / 256;
      }
      expect(categories.size).toBe(4);
      for (let c = 0; c < 3; c++) expect(crown[c] * (1 - fall * AUTUMN_CROWN_MEAN.weight) + lum * AUTUMN_CROWN_MEAN.hue[c] * fall).toBeCloseTo(population[c], 12);
      if (fall === 1) expect(population[0]).toBeGreaterThan(population[1]);
    }
  });

  it.each([
    ['WebGL2', TerrainGl],
    ['WebGPU', TerrainGpu],
  ] as const)('%s invalidates ground content on a season change, without uploading forest or terrain', (_, Renderer) => {
    const revision = new ContentRevision();
    const renderer = Object.create(Renderer.prototype);
    renderer.look = { v2Season: 0.5 };
    renderer.recovery = {};
    renderer.changed = vi.fn((change: string) => {
      if (change === 'content') revision.bump();
    });
    const before = revision.value();
    renderer.setRenderV2Season(0.75);
    expect(renderer.look.v2Season).toBe(0.75);
    expect(renderer.changed).toHaveBeenCalledTimes(1);
    expect(renderer.changed).toHaveBeenCalledWith('content');
    expect(revision.value()).toBe(before + 1);
  });
});
