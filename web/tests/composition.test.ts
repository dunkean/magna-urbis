import { mountTextOverlay3d } from '../src/ui/textOverlay3d';
import { Terrain3d } from '../src/ui/terrain3d';
import { TEXT_GROUPS } from '../src/render/textLayer';
import { buildMapLabels, placeMapLabels, estimateWidth, type MapLabelWorld } from '../src/render/mapLabels';
import { placedMapLabelsSvg } from '../src/render/svgLabels';
import { PALETTES } from '../src/render/styles';
import { tileRoadVisible, drawTileRoads } from '../src/render/tileNetworks';
import { describe, expect, it, vi } from 'vitest';
import { resolveAppearance } from '../src/render/appearanceRecipe';
import { GROUND_VARIANTS, PRESET_IDS, presetComposition, validateComposition, withGroundVariant, type CompositionRecipe } from '../src/render/composition';

const resolve = (composition: CompositionRecipe, target: 'view2d' | 'view3d' = 'view2d') => resolveAppearance({ style: 'parchment', composition }, { mapStyle: 'parchment' }, { nativeCities: true }, target);
const edit = (id: Parameters<typeof presetComposition>[0], change: (c: CompositionRecipe) => void) => { const c = presetComposition(id); change(c); return c; };
const moved = (a: CompositionRecipe, b: CompositionRecipe) => { const x = resolve(a).keys, y = resolve(b).keys; return (Object.keys(x) as (keyof typeof x)[]).filter(key => x[key] !== y[key]); };

describe('render composition', () => {
  it('fills a valid recipe from every preset', () => {
    for (const id of PRESET_IDS) { const c = presetComposition(id); expect(() => validateComposition(c), id).not.toThrow(); expect(GROUND_VARIANTS[c.ground.look]).toContain(c.ground.variant); }
  });
  it('draws the mixed recipe without changing the ground', () => {
    const r = resolve(edit('parchment', c => { c.vegetation.look = 'procedural-canopy'; c.landuse.rural = 'categorical'; c.networks.roads.look = 'ink'; c.buildings.look = 'footprints'; }));
    expect(r.ground.style).toBe('parchment');
    expect(r.composition.vegetation).toMatchObject({ procedural: true, cartographic: false });
    expect(r.composition.landuse.rural).toBe('categorical');
    expect(r.city.buildingStyle).toBe('silhouette');
  });
  it('keeps semantic data on a material ground', () => {
    const r = resolve(presetComposition('natural'));
    expect(r.composition.landuse.rural).toBe('subtle'); expect(r.composition.vegetation.procedural).toBe(true);
  });
  it('moves only the semantic key for opacity and looks', () => {
    const base = presetComposition('natural');
    expect(moved(base, edit('natural', c => { c.landuse.opacity = .9; }))).toEqual(['semantic']);
    expect(moved(base, edit('natural', c => { c.landuse.rural = 'off'; c.landuse.urban = 'off'; }))).toEqual(['semantic']);
  });
  it('leaves the other passes alone when one is hidden or changed', () => {
    const base = presetComposition('parchment');
    expect(moved(base, edit('parchment', c => { c.buildings.look = 'footprints'; }))).toEqual(['city']);
    expect(moved(base, edit('parchment', c => { c.networks.roads.visible = false; }))).not.toContain('forest');
    expect(moved(base, edit('parchment', c => { c.networks.roads.visible = false; }))).not.toContain('semantic');
  });
  it('keeps the night ambience on a natural ground without a limitation', () => {
    expect(resolve(presetComposition('atlas-night')).ground.style).toBe('night');
    const c = edit('natural', x => { x.ambience = 'night'; });
    expect(resolve(c).composition.limitations.map(l => l.pass)).not.toContain('ambience');
    expect(resolve(c).composition.recipe.ambience).toBe('night');
  });
  it('changes the ground variant without touching the other passes', () => {
    const next = withGroundVariant(presetComposition('plan'), 'render-v2');
    expect(next).toMatchObject({ preset: 'custom', ground: { look: 'natural', variant: 'render-v2' }, landuse: { rural: 'categorical' }, buildings: { look: 'footprints' } });
  });
});


describe('independent text composition', () => {
  it('moves only the overlays key for every text setting', () => {
    const base = presetComposition('parchment');
    const changes: ((c: CompositionRecipe) => void)[] = [c => { c.text.visible = false; }, c => { c.text.look = 'sans'; }, c => { c.text.size = 1.8; }, c => { c.text.density = 'high'; }, c => { c.text.halo = 'strong'; }, ...TEXT_GROUPS.map(group => (c: CompositionRecipe) => { c.text.groups[group] = false; })];
    for (const change of changes) expect(moved(base, edit('parchment', change))).toEqual(['overlays']);
    expect(base.annotations).not.toHaveProperty('labels');
  });
  it('validates the complete group table and finite size bounds', () => {
    for (const size of [.6, 1.8]) expect(() => validateComposition(edit('plan', c => { c.text.size = size; }))).not.toThrow();
    for (const size of [.59, 1.81, NaN, Infinity]) expect(() => validateComposition(edit('plan', c => { c.text.size = size; }))).toThrow('text.size');
    const c = presetComposition('plan'); delete (c.text.groups as Partial<typeof c.text.groups>).pins;
    expect(() => validateComposition(c)).toThrow('text.groups.pins');
  });
  it('filters name sources, site markers and RPG pins independently and caches equivalent palettes', () => {
    const world: MapLabelWorld = { names: { family: 'french', town: 'Test', entries: [
      { id: 'river', kind: 'river', text: 'River', rank: 0, anchor: { x: 100, y: 100 } },
      { id: 'street', kind: 'street', text: 'Street', rank: 0, anchor: { x: 120, y: 100 } },
      { id: 'castle', kind: 'castle', text: 'Castle', rank: 0, anchor: { x: 140, y: 100 } },
    ] }, site: { center: { x: 200, y: 200 } }, mapAnnotations: { enabled: true, pins: [{ id: 'quest', kind: 'quest', text: 'Quest', x: 160, y: 100 }] } };
    const text = presetComposition('parchment').text, pal = PALETTES.parchment;
    text.groups.water = false; text.groups.pins = false;
    const labels = buildMapLabels(world, pal.name, pal, text);
    expect(labels.map(l => l.kind)).toEqual(['street', 'castle']);
    expect(buildMapLabels(world, pal.name, { ...pal }, { ...text, groups: { ...text.groups } })).toBe(labels);
    text.groups.pins = true;
    expect(buildMapLabels(world, pal.name, pal, text).map(l => l.kind)).toEqual(['street', 'castle', 'rpg:quest', 'site']);
  });
  it('shares explicit fonts, size and night contrast with SVG', () => {
    const text = presetComposition('atlas-night').text; text.look = 'sans'; text.size = 1.5;
    const world: MapLabelWorld = { mapAnnotations: { enabled: true, pins: [{ id: 'pin', kind: 'label', text: 'Readable', x: 200, y: 200 }] } };
    const labels = buildMapLabels(world, 'night', PALETTES.night, text), st = labels[0].st;
    expect(st.family).toContain('sans-serif'); expect(st.color).toBe('#f2e9cc'); expect(st.halo).toBe('#111d2b');
    const normal = buildMapLabels(world, 'night', PALETTES.night, { ...text, size: 1 });
    expect(st.minPx).toBe(normal[0].st.minPx * 1.5);
    const placed = placeMapLabels(labels, { cx: 200, cy: 200, scale: 1 }, 800, 600, estimateWidth);
    const svg = placedMapLabelsSvg(placed, PALETTES.night);
    expect(svg).toContain('sans-serif'); expect(svg).toContain('stroke="#111d2b"'); expect(svg).toContain('fill="#f2e9cc"');
  });
  it('retains roads that cross a tile without any vertex inside, and skips empty tiles', () => {
    const road = { path: [{ x: -100, y: 50 }, { x: 200, y: 50 }], widths: [3, 3], rank: 1, role: 'regional' }, box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(tileRoadVisible(road, box, 1)).toBe(true);
    expect(tileRoadVisible({ ...road, path: road.path.map(p => ({ ...p, y: 500 })) }, box, 1)).toBe(false);
    const ctx = { strokes: 0, setLineDash() {}, stroke() { this.strokes++; }, beginPath() {}, moveTo() {}, lineTo() {} };
    drawTileRoads(ctx as unknown as CanvasRenderingContext2D, [], box, 1); expect(ctx.strokes).toBe(0);
    drawTileRoads(ctx as unknown as CanvasRenderingContext2D, [road], box, 1); expect(ctx.strokes).toBe(2);
  });
});


it('caps and throttles 3D placement, then does no work for a still camera', () => {
  vi.useFakeTimers();
  try {
    const ctx = { font: '', setTransform: vi.fn(), clearRect: vi.fn(), measureText: vi.fn(() => ({ width: 7 })), strokeText: vi.fn(), fillText: vi.fn() };
    const canvas = { width: 0, height: 0, style: {}, setAttribute() {}, getContext: () => ctx, remove() {} };
    vi.stubGlobal('document', { createElement: () => canvas }); vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = { clientWidth: 1024, clientHeight: 800, append() {} } as unknown as HTMLElement;
    const projector = vi.fn(() => ({ scale: 1, project: (x: number, y: number) => [x, y] as [number, number] }));
    const overlay = mountTextOverlay3d(host, () => ({ labelProjector: projector }) as unknown as Terrain3d);
    const text = presetComposition('parchment').text; text.density = 'low';
    const world: MapLabelWorld = { names: { family: 'french', town: '', entries: Array.from({ length: 1000 }, (_, i) => ({ id: String(i), kind: 'farm', text: 'a', rank: 0, anchor: { x: i % 30 * 32 + 20, y: Math.floor(i / 30) * 22 + 20 } })) } };
    const labels = buildMapLabels(world, 'parchment', PALETTES.parchment, text);
    overlay.set({ labels, text, palette: PALETTES.parchment }); vi.runOnlyPendingTimers();
    expect(ctx.fillText).toHaveBeenCalledTimes(90); expect(projector).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const measured = ctx.measureText.mock.calls.length; vi.advanceTimersByTime(1000);
    expect(projector).toHaveBeenCalledTimes(1); expect(ctx.measureText).toHaveBeenCalledTimes(measured);
    overlay.invalidate(); overlay.invalidate(); overlay.invalidate(); expect(vi.getTimerCount()).toBe(1); vi.runOnlyPendingTimers();
    expect(projector).toHaveBeenCalledTimes(2); expect(ctx.measureText).toHaveBeenCalledTimes(measured);
    overlay.dispose(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});


it('projects 3D anchors using terrain heights and rejects the frustum and terrain horizon', () => {
  const view = { layer: { x: 0, y: 0, width: 1000 }, active: true, width: 800, height: 600, heightRange: 100,
    camera: { x: 0, y: 0, exaggeration: 1, distance: 1000 }, heightAt: () => 0, surface: (_x: number, _y: number) => 0,
    frameGeometry: () => ({ eye: [0, 10, 0], targetHeight: 0, forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], focal: 300 }) };
  const projection = Terrain3d.prototype.labelProjector.call(view as unknown as Terrain3d)!;
  expect(projection.project(0, 100)?.[0]).toBe(400);
  expect(projection.project(0, -100)).toBeNull(); expect(projection.project(1000, 100)).toBeNull();
  view.surface = (_x, y) => y > 40 && y < 60 ? 20 : 0;
  expect(Terrain3d.prototype.labelProjector.call(view as unknown as Terrain3d)!.project(0, 100)).toBeNull();
});
