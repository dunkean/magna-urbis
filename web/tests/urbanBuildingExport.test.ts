import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import type { HouseMaterial, Surface } from '../../rust/bridge/housesContract';
import type { PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { drawUrbanBuildings, urbanBuildingsBounds, urbanBuildingsSvg } from '../src/render/urbanBuildings';

const appearance = {style: 'cartographic', diagnostic: 'none'} as const;
const viewport = {minX: 0, minY: 0, maxX: 12, maxY: 12};
const ring = (x: number, y: number, w: number) => [{x, y}, {x: x + w, y}, {x: x + w, y: y + w}, {x, y: y + w}];
const unit = reference.units[0], materials = unit.bodies[0].levels[0].materials;
function house(id = 'court', compact = true, x = 0): PlacedBuilding {
  const shape: Surface = [{outer: ring(x, 0, 12), holes: [ring(x + 4, 4, 4)]}];
  return {
    id, parcel_id: `parcel-${id}`, recipe_id: unit.recipe_id, variant_id: unit.variant_id, function: 'domestic',
    culture: {culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null},
    transform: {origin: {x, y: 0}, orientation_deg: 0}, ground_z_m: 0,
    footprint: shape, roof_footprint: shape, courtyards: [], circulation: [], entrance: {x, y: 0}, structural_features: [],
    volumes: [{...unit.bodies[0], z_m: 0, wall_height_m: 2.8, roof_height_m: 3.5, materials,
      roof_mesh: compact ? {vertices: [], faces: [], edges: [], groups: []} : unit.roofs}],
    simplification: compact ? 'architectural_plan' : 'recipe_volumes',
    ...(compact ? {cartographic: {height_m: 6.3, validation: 'plan_only', ridges: [[{x, y: 6}, {x: x + 12, y: 6}]]}} : {}),
  } as unknown as PlacedBuilding;
}
function scene(buildings: PlacedBuilding[]): PlacementBatch {
  return {schema_version: '1', generator_version: 'export-test', buildings, refusals: [], open_spaces: [],
    materials: [{id: materials.cladding, pattern: 'thatch'} as HouseMaterial]};
}
function canvasProbe(): {context: CanvasRenderingContext2D; fills: () => number} {
  let fills = 0;
  const context = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, rect() {}, arc() {}, clip() {},
    fill() { fills++; }, stroke() {}, drawImage() { throw new Error('Export must complete through direct vector Canvas, never an unfinished tile or temporary Image.'); },
  } as unknown as CanvasRenderingContext2D;
  return {context, fills: () => fills};
}

describe('native and compact building exports', () => {
  it('exports compact materials and clipped ridges with a transparent courtyard; silhouettes retain overlapping roofs', () => {
    const source = scene([house()]);
    const svg = urbanBuildingsSvg(source, appearance);
    expect(svg).toContain('data-building-lod="cartographic"');
    expect(svg).toContain('fill="#c9b47b"');
    expect(svg).toContain('d="M0,6L4,6"');
    expect(svg).toContain('d="M8,6L12,6"');
    expect(svg).not.toContain('d="M0,6L12,6"');
    const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 12 12">${svg}</svg>`, {font: {loadSystemFonts: false}}).render();
    const pixel = (x: number, y: number) => [...image.pixels.slice((y * 120 + x) * 4, (y * 120 + x) * 4 + 4)];
    expect(pixel(60, 60)[3]).toBe(0);
    expect(pixel(20, 20)).toEqual([201, 180, 123, 255]);
    const overlapping = house('overlap');
    overlapping.footprint = overlapping.roof_footprint = [{outer: ring(10, 1, 4), holes: []}];
    const silhouette = urbanBuildingsSvg(scene([house(), overlapping]), {style: 'silhouette', diagnostic: 'none'});
    const filled = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="120" viewBox="0 0 14 12">${silhouette}</svg>`, {font: {loadSystemFonts: false}}).render();
    expect(filled.pixels[(20 * 140 + 110) * 4 + 3]).toBe(255);
    expect(filled.pixels[(60 * 140 + 60) * 4 + 3]).toBe(0);
  });

  it('culls offscreen buildings and suppresses subpixel native detail before reading any roof mesh', () => {
    const near = house('visible', false), far = house('offscreen', false, 1000);
    for (const b of [near, far]) Object.defineProperty(b.volumes[0], 'roof_mesh', {get() { throw new Error('Far/offscreen roof was read'); }});
    const source = scene([near, far]);
    const svg = urbanBuildingsSvg(source, appearance, undefined, {viewport, metresPerPixel: 4});
    expect(svg).toContain('data-urban-building="visible"');
    expect(svg).not.toContain('offscreen');
    expect(svg).toContain('data-building-lod="silhouette"');
    expect(svg).not.toContain('data-roof-line');
    expect(svg).not.toContain('stroke-width="1.05"');
    expect(svg).not.toContain('vector-effect="non-scaling-stroke"');
    expect(svg).toContain('urban-houses-export-viewport');
    expect(urbanBuildingsBounds(source)).toEqual({minX: 0, minY: 0, maxX: 1012, maxY: 12});
  });

  it('completes native/compact Canvas exports including silhouettes using footprint bounds and no Image allocation', async () => {
    for (const compact of [false, true]) for (const style of ['cartographic', 'silhouette'] as const) {
      const source = scene([house('source', compact)]), probe = canvasProbe();
      Object.defineProperty(source.buildings[0].volumes[0], 'roof_mesh', {get() { throw new Error('Small export read a roof mesh'); }});
      await drawUrbanBuildings(probe.context, source, {style, diagnostic: 'none'}, 2);
      expect(probe.fills()).toBeGreaterThan(0);
    }
    const empty = canvasProbe();
    await drawUrbanBuildings(empty.context, scene([house()]), appearance, 1, {viewport: {minX: 200, minY: 200, maxX: 220, maxY: 220}});
    expect(empty.fills()).toBe(0);
  });

  it('refuses oversized exports explicitly and permits a bounded viewport at the requested resolution', async () => {
    const source = scene([house(), house('far', true, 1e9)]), probe = canvasProbe();
    await expect(drawUrbanBuildings(probe.context, source, appearance, .1)).rejects.toThrow('Building export requires');
    expect(probe.fills()).toBe(0);
    await drawUrbanBuildings(probe.context, source, appearance, .1, {viewport});
    expect(probe.fills()).toBeGreaterThan(0);
    await expect(drawUrbanBuildings(probe.context, source, appearance, .1, {viewport, maxPixels: 100})).rejects.toThrow('limits');
    await expect(drawUrbanBuildings(probe.context, source, appearance, 0, {viewport})).rejects.toThrow('metresPerPixel');
  });
});
