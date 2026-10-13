import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderTerrainPixels } from '../src/render/raster';
import { DEFAULT_TERRAIN_LIGHTING } from '../src/render/terrainLighting';
import { hexToRgb, PALETTES } from '../src/render/styles';
import { coastDistances } from '../src/render/terrainSea';
import { renderRustTerrain } from '../../rust/bridge/terrainRender';
import type { TerrainData } from '../../rust/bridge/terrain';
import type { World } from '../src/gen/types';

const n = 8;
const height = Float32Array.from({ length: n * n }, (_, i) => [0, -0.1, -5, -15, -35, -70, -100, 20][i % n]);
const distance = Float32Array.from({ length: n * n }, (_, i) => [0, 0.01, 1, 4, 8, 70, 100, -8][i % n]);
const normals = { x: new Float32Array(n * n), y: new Float32Array(n * n), z: new Float32Array(n * n).fill(1) };
const world = { mapSize: 80, terrain: { height: { w: n, h: n, cell: 10, data: height }, water: new Uint8Array(n * n) } } as unknown as World;
const lighting = { ...DEFAULT_TERRAIN_LIGHTING, enabled: false };
const render = (style: 'parchment' | 'atlas', overrides = {}) => renderTerrainPixels(world, { ...PALETTES[style], grain: 0 }, {
  pixels: n, surface: height, normals, sea: { distance, bandWidth: 8 }, heightRange: { min: 0, max: 20 }, lighting, ...overrides,
}).rgb;
const pixel = (rgb: Uint8Array, x: number) => Array.from(rgb.slice(x * 3, x * 3 + 3));

describe.each(['parchment', 'atlas'] as const)('%s coastal sea', style => {
  it('joins the river ink at the shore and smoothly reaches the offshore colour', () => {
    const rgb = render(style), shore = hexToRgb(PALETTES[style].waterEdge), sea = hexToRgb(PALETTES[style].seaFill);
    expect(pixel(rgb, 0)).toEqual(shore);
    expect(pixel(rgb, 1)).toEqual(shore);
    expect(pixel(rgb, 4)).toEqual(sea);
    expect(pixel(rgb, 6)).toEqual(sea);
    for (let channel = 0; channel < 3; channel++) {
      expect(rgb[2 * 3 + channel]).toBeGreaterThan(shore[channel]);
      expect(rgb[3 * 3 + channel]).toBeGreaterThan(rgb[2 * 3 + channel]);
      expect(rgb[3 * 3 + channel]).toBeLessThan(sea[channel]);
    }
  });

  it('uses the seabed normals for faint lighting while preserving shore ink and heights', () => {
    const tilted = { x: new Float32Array(n * n).fill(0.6), y: normals.y, z: new Float32Array(n * n).fill(0.8) };
    const before = height.slice();
    const west = render(style, { normals: tilted, lighting: DEFAULT_TERRAIN_LIGHTING });
    const east = render(style, { normals: tilted, lighting: { ...DEFAULT_TERRAIN_LIGHTING, azimuth: 135 } });
    expect(pixel(west, 4)).not.toEqual(pixel(east, 4));
    const sea = hexToRgb(PALETTES[style].seaFill);
    for (let channel = 0; channel < 3; channel++) expect(Math.abs(west[4 * 3 + channel] - sea[channel])).toBeLessThanOrEqual(9);
    expect(pixel(west, 0)).toEqual(hexToRgb(PALETTES[style].waterEdge));
    expect(height).toEqual(before);
    expect(render(style, { normals: tilted })).toEqual(render(style));
  });

  it('retains the same sea in SVG export with land contour lines enabled', () => {
    const terrain = { x: 0, y: 0, width: 80, resolution: n, height, normalX: normals.x, normalY: normals.y, normalZ: normals.z,
      caveMask: new Uint8Array(), globalMinHeight: -100, globalMaxHeight: 20, motifSize: 80 } as TerrainData;
    const scene = renderRustTerrain(terrain, style, false, { relief: 'hills', width: 80 }, true, 'test', lighting);
    const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">${scene.svg}</svg>`).render();
    const p = (40 * 80 + 55) * 4;
    expect(Array.from(rendered.pixels.slice(p, p + 3))).toEqual(hexToRgb(PALETTES[style].seaFill));
    expect(scene.svg.match(/<image /g)).toHaveLength(2);
  });
});

it('keeps the coastal rendering opt-in and leaves the other styles unchanged', () => {
  for (const pal of [PALETTES.parchment, PALETTES.atlas, PALETTES.engraving]) {
    const options = { pixels: n, surface: height, normals, lighting };
    const rgb = renderTerrainPixels(world, pal, pal.name === 'engraving' ? { ...options, sea: { distance, bandWidth: 8 } } : options).rgb;
    expect(pixel(rgb, 4)).toEqual(hexToRgb(pal.paper));
  }
});

it('keeps the coastal band uniform despite different seabed slopes and grid resolutions', () => {
  for (const size of [16, 32]) {
    const cell = 16 / size;
    const surface = Float32Array.from({ length: size * size }, (_, i) => ((i % size + 0.5) * cell - 8) * (1 + Math.floor(i / size) * 3));
    const distances = coastDistances(surface, size, cell, 4);
    for (let y = 1; y < size - 1; y++) for (let x = 0; x < size; x++) {
      const expected = Math.max(-4, Math.min(4, 8 - (x + 0.5) * cell));
      expect(distances[y * size + x]).toBeCloseTo(expected, 5);
    }
  }
});
