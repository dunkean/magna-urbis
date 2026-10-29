import { describe, expect, it } from 'vitest';
import reference from '../../rust/fixtures/houses/batch-reference.json';
import type { Point, Surface } from '../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacedBuilding, PlacementBatch } from '../../rust/bridge/urbanArchitecture';
import { UrbanBuildingLodRenderer, buildingSurfaceContains, selectBuildingLod, type CompactBuildingVisual } from '../src/render/urbanBuildingLod';

const appearance = {style: 'cartographic', diagnostic: 'none'} as const;
const viewport = {minX: -1, minY: -1, maxX: 100, maxY: 100};
const unit = reference.units[0];
const materials = unit.bodies[0].levels[0].materials;
const rectangle = (x: number, y: number, width: number, height = width): Point[] => [
  {x, y}, {x: x + width, y}, {x: x + width, y: y + height}, {x, y: y + height},
];
function offset(surface: Surface, x: number, y: number): Surface {
  const ring = (ring: Point[]): Point[] => ring.map(p => ({x: p.x + x, y: p.y + y}));
  return surface.map(p => ({outer: ring(p.outer), holes: p.holes.map(ring)}));
}
function nativeHouse(index = 0, x = 0, y = 0): PlacedBuilding {
  // Native reference cottage, translated in world metres. No box substitutes for
  // the fixture footprint or roof: the same source is used at every LOD.
  const footprint = offset(unit.partition.occupied, x, y);
  const roof = unit.roofs as unknown as ArchitectureVolume['roof_mesh'];
  const mesh = {...roof, vertices: roof.vertices.map(p => ({...p, x: p.x + x, y: p.y + y}))};
  return {
    id: `native-${index}`, parcel_id: `parcel-${index}`, function: 'domestic',
    culture: {culture: 'european-organic', pack: 'EUR-MED', mode: 'historical_inspired', borrowing: null},
    recipe_id: unit.recipe_id, variant_id: unit.variant_id, transform: {origin: {x, y}, orientation_deg: 0}, ground_z_m: 0,
    footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: {x: x + 3, y}, access_id: '',
    volumes: [{...unit.bodies[0], z_m: 0, wall_height_m: 2.8, roof_height_m: 3.5, footprint, materials, roof_mesh: mesh}] as unknown as ArchitectureVolume[],
    useful_area_m2: 66.5, domestic_units: 1, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: {},
  };
}
function batch(buildings: PlacedBuilding[]): PlacementBatch {
  return {schema_version: '1', generator_version: 'test-native-fixture', buildings, refusals: [], open_spaces: []};
}
/** Geometry sink for Node: validates fill winding and submitted lines without a
 * DOM or asserting private implementation details. Browser Path2D is optional. */
class RecordingCanvas {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1; lineJoin = 'round'; lineCap = 'round';
  rings: Point[][] = [];
  fills: {rings: Point[][]; rule: string; color: string}[] = [];
  strokes: Point[][][] = [];
  images: unknown[][] = [];
  save(): void {}
  restore(): void {}
  beginPath(): void { this.rings = []; }
  moveTo(x: number, y: number): void { this.rings.push([{x, y}]); }
  lineTo(x: number, y: number): void { this.rings.at(-1)!.push({x, y}); }
  closePath(): void {}
  setTransform(): void {}
  drawImage(...args: unknown[]): void { this.images.push(args); }
  rect(x: number, y: number, width: number, height: number): void { this.rings.push(rectangle(x, y, width, height)); }
  arc(x: number, y: number, radius: number): void { this.rings.push(rectangle(x - radius, y - radius, radius * 2)); }
  clip(): void {}
  fill(rule = 'nonzero'): void { this.fills.push({rings: this.rings, rule, color: String(this.fillStyle)}); }
  stroke(): void { this.strokes.push(this.rings); }
  asContext(): CanvasRenderingContext2D { return this as unknown as CanvasRenderingContext2D; }
  filled(point: Point): boolean {
    return this.fills.some(fill => {
      let winding = 0;
      for (const ring of fill.rings) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
        if (a.y <= point.y && b.y > point.y && cross > 0) winding++;
        if (a.y > point.y && b.y <= point.y && cross < 0) winding--;
      }
      return fill.rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
    });
  }
}

describe('scalable native building projection', () => {
  it('recolours native roofs at close and overview scales without changing meshes or reusing stale tiles', () => {
    const house = nativeHouse(), original = JSON.stringify(house), contexts: RecordingCanvas[] = [];
    const renderer = new UrbanBuildingLodRenderer(batch([house]), { maxRasterBuildMs: 1000, rasterCanvasFactory: size => {
      const context = new RecordingCanvas(); contexts.push(context);
      return { width: size, height: size, getContext: () => context.asContext() } as unknown as HTMLCanvasElement;
    } });
    const camera = { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    const draw = (colors?: { building: string }) => renderer.draw(new RecordingCanvas().asContext(), { viewport: camera, metresPerPixel: 2, appearance: { ...appearance, colors } });
    expect(draw().rasterTilesBuilt).toBe(1); expect(draw().rasterTilesBuilt).toBe(0);
    expect(draw({ building: '#d02080' }).rasterTilesBuilt).toBe(1);
    expect(contexts.at(-1)?.fills.some(fill => fill.color === '#d02080')).toBe(true);
    expect(draw({ building: '#d02080' }).rasterTilesBuilt).toBe(0);
    const close = new RecordingCanvas();
    const metrics = renderer.draw(close.asContext(), { viewport: camera, metresPerPixel: .05, appearance: { ...appearance, colors: { building: '#d02080' } } });
    expect(metrics.roofMeshesRead).toBeGreaterThan(0);
    expect(close.fills.some(fill => fill.color.startsWith('rgb('))).toBe(true);
    expect(JSON.stringify(house)).toBe(original);
  });
  it('appends progressive chunks without reindexing old geometry or rebuilding unrelated overview tiles', () => {
    const source = batch([nativeHouse(0, 10, 10), nativeHouse(1, 700, 10)]);
    const renderer = new UrbanBuildingLodRenderer(source, {maxRasterBuildMs: 1000, rasterCanvasFactory: size => {
      const context = new RecordingCanvas();
      return {width: size, height: size, getContext: () => context.asContext()} as unknown as HTMLCanvasElement;
    }});
    const camera = {minX: 1, minY: 1, maxX: 1023, maxY: 500};
    const draw = () => renderer.draw(new RecordingCanvas().asContext(), {viewport: camera, metresPerPixel: 2, appearance});
    expect(draw().rasterTilesBuilt).toBe(2);
    expect(draw().rasterTilesBuilt).toBe(0);
    const before = renderer.cacheStats;
    // Cached/indexed houses need no geometry traversal during the append itself.
    const oldFootprint = source.buildings[0].footprint;
    Object.defineProperty(source.buildings[0], 'roof_footprint', {get() { throw new Error('Progressive append re-read an old roof'); }, configurable: true});
    const added = nativeHouse(2, 200, 10);
    renderer.appendScene(batch([added]));
    expect(source.buildings).toHaveLength(2);
    expect(renderer.cacheStats).toEqual(before);
    Object.defineProperty(source.buildings[0], 'roof_footprint', {value: oldFootprint, configurable: true});
    const appended = draw();
    expect(appended.totalBuildings).toBe(3);
    expect(appended.rasterTilesBuilt).toBe(1);
    expect(renderer.getBuilding(added.id)).toBe(added);
    expect(renderer.pick({x: 202, y: 12})?.id).toBe(added.id);
    expect(() => renderer.appendScene(batch([nativeHouse(3, 400, 10), added]))).toThrow(/Duplicate/);
    expect(renderer.getBuilding('native-3')).toBeUndefined();
    expect(draw().rasterTilesBuilt).toBe(0);
    renderer.replaceScene(source);
    expect(renderer.getBuilding(added.id)).toBeUndefined();
  });

  it('bounds viewport work independently of 1k, 10k and 100k city sizes, without reading any roof mesh', () => {
    const observations: {count: number; tested: number; visible: number; vertices: number}[] = [];
    const source = nativeHouse();
    Object.defineProperty(source.volumes[0], 'roof_mesh', {get() { throw new Error('Far rendering read a roof mesh'); }});
    for (const count of [1_000, 10_000, 100_000]) {
      const buildings = Array.from({length: count}, (_, i): PlacedBuilding => {
        const footprint = offset(source.footprint, (i % 100) * 20, Math.floor(i / 100) * 20);
        return {...source, id: `native-${i}`, footprint, roof_footprint: footprint};
      });
      const renderer = new UrbanBuildingLodRenderer(batch(buildings), {sectorSizeM: 32});
      const camera = {minX: 1, minY: 1, maxX: 95, maxY: 95};
      const metrics = renderer.draw(new RecordingCanvas().asContext(), {viewport: camera, metresPerPixel: 4, appearance});
      observations.push({count, tested: metrics.testedBuildings, visible: metrics.visibleBuildings, vertices: metrics.submittedVertices});
      expect(metrics.visibleBuildings).toBe(25);
      expect(metrics.testedBuildings).toBeLessThanOrEqual(36);
      expect(metrics.visitedSectors).toBe(9);
      expect(metrics.roofMeshesRead).toBe(0);
      expect(metrics.drawCalls).toBe(1);
      expect(metrics.lod).toEqual({silhouette: 25, ridges: 0, facets: 0});
      expect(renderer.pick({x: 2, y: 2})?.id).toBe('native-0');
    }
    expect(new Set(observations.map(o => `${o.tested}:${o.visible}:${o.vertices}`)).size).toBe(1);
  });

  it('keeps holes open in batched fills and picking with either input winding; overlapping roofs remain filled', () => {
    for (const reverse of [false, true]) {
      const outer = rectangle(0, 0, 12), hole = rectangle(4, 4, 4);
      const shape: Surface = [{outer: reverse ? outer.reverse() : outer, holes: [reverse ? hole.reverse() : hole]}];
      const house = {...nativeHouse(), footprint: shape, roof_footprint: shape};
      const overlap = {...nativeHouse(1), footprint: [{outer: rectangle(10, 1, 4), holes: []}], roof_footprint: [{outer: rectangle(10, 1, 4), holes: []}]};
      const renderer = new UrbanBuildingLodRenderer(batch([house, overlap]));
      const ctx = new RecordingCanvas();
      const metrics = renderer.draw(ctx.asContext(), {viewport, metresPerPixel: 2, appearance});
      expect(metrics.drawCalls).toBe(1);
      expect(ctx.filled({x: 6, y: 6})).toBe(false);
      expect(ctx.filled({x: 2, y: 6})).toBe(true);
      expect(ctx.filled({x: 11, y: 2})).toBe(true);
      expect(renderer.pick({x: 6, y: 6})).toBeUndefined();
      expect(renderer.pick({x: 2, y: 6})?.id).toBe(house.id);
      expect(renderer.pick({x: 11, y: 2})?.id).toBe(overlap.id);
    }
  });

  it('renders supplied compact roof lines without meshes and clips them around a semantic courtyard', () => {
    const shape: Surface = [{outer: rectangle(0, 0, 12), holes: [rectangle(4, 4, 4)]}];
    const house: CompactBuildingVisual = {
      id: 'compact-court', function: 'domestic', footprint: shape, roof_footprint: shape, materials,
      cartographic: {height_m: 5, roof_system: 'RF-GABLE', ridges: [[{x: 0, y: 6}, {x: 12, y: 6}]]},
    };
    const renderer = new UrbanBuildingLodRenderer({buildings: [house]});
    const ctx = new RecordingCanvas(), metrics = renderer.draw(ctx.asContext(), {viewport, metresPerPixel: .3, appearance});
    expect(metrics.roofMeshesRead).toBe(0);
    expect(metrics.ridgeSegments).toBe(2);
    expect(ctx.strokes.flat()).toEqual([[{x: 0, y: 6}, {x: 4, y: 6}], [{x: 8, y: 6}, {x: 12, y: 6}]]);
    expect(ctx.filled({x: 6, y: 6})).toBe(false);
    expect(renderer.pick({x: 6, y: 6})).toBeUndefined();
  });

  it('shows native roof facets only nearby; a flat or unsupported roof never receives an invented ridge', () => {
    const house = nativeHouse(), before = JSON.stringify(house);
    const renderer = new UrbanBuildingLodRenderer(batch([house]));
    const near = renderer.draw(new RecordingCanvas().asContext(), {viewport, metresPerPixel: .05, appearance});
    expect(near.lod.facets).toBe(1);
    expect(near.roofMeshesRead).toBeGreaterThan(0);
    expect(near.drawCalls).toBeGreaterThan(1);
    expect(near.ridgeSegments).toBeGreaterThan(0);
    const warm = renderer.draw(new RecordingCanvas().asContext(), {viewport, metresPerPixel: .05, appearance});
    expect(warm.roofMeshesRead).toBe(0);
    expect(warm.cacheHits).toBe(1);
    expect(warm.preparedVertices).toBe(0);
    expect(JSON.stringify(house)).toBe(before);
    const unsupported: CompactBuildingVisual = {id: 'unknown', footprint: house.footprint, roof_footprint: house.roof_footprint, function: 'domestic', cartographic: {ridges: [], roof_system: 'UNRECOGNIZED'}};
    const unknown = new UrbanBuildingLodRenderer({buildings: [unsupported]}).draw(new RecordingCanvas().asContext(), {viewport, metresPerPixel: .05, appearance});
    expect(unknown.ridgeSegments).toBe(0);
    expect(unknown.drawCalls).toBe(1);
  });

  it('draws retained plans without accessing or removing cached native detail when useDetails is false', () => {
    const detail = nativeHouse(), base: CompactBuildingVisual = {
      id: detail.id, function: detail.function, footprint: detail.footprint, roof_footprint: detail.roof_footprint,
      materials, cartographic: { height_m: 6, ridges: [] },
    };
    const mesh = detail.volumes[0].roof_mesh;
    let meshReads = 0;
    Object.defineProperty(detail.volumes[0], 'roof_mesh', { get() { meshReads++; return mesh; } });
    const renderer = new UrbanBuildingLodRenderer<CompactBuildingVisual>({ buildings: [base] }, { raster: false });
    renderer.setDetail(base.id, detail);
    const draw = (useDetails?: boolean) => renderer.draw(new RecordingCanvas().asContext(), { viewport, metresPerPixel: .05, appearance, useDetails });
    const compact = draw(false);
    expect(compact.lod.facets).toBe(1); expect(compact.roofMeshesRead).toBe(0); expect(meshReads).toBe(0);
    expect(compact.drawCalls).toBe(1); expect(renderer.getBuilding(base.id)).toBe(base);
    const native = draw();
    expect(native.roofMeshesRead).toBeGreaterThan(0); expect(meshReads).toBeGreaterThan(0);
    const nativeReads = meshReads;
    expect(draw(false).drawCalls).toBe(1); expect(meshReads).toBe(nativeReads);
    const resumed = draw();
    expect(resumed.roofMeshesRead).toBe(0); expect(resumed.preparedVertices).toBe(0);
    expect(resumed.drawCalls).toBeGreaterThan(1); expect(meshReads).toBe(nativeReads);
  });

  it('retains stable identities across zoom and handles screen-space hysteresis', () => {
    expect(selectBuildingLod(18)).toBe('ridges');
    expect(selectBuildingLod(17, 'ridges')).toBe('ridges');
    expect(selectBuildingLod(14, 'ridges')).toBe('silhouette');
    expect(selectBuildingLod(19, 'silhouette')).toBe('silhouette');
    expect(selectBuildingLod(22, 'silhouette')).toBe('ridges');
    expect(selectBuildingLod(70, 'facets')).toBe('facets');
    expect(selectBuildingLod(60, 'facets')).toBe('ridges');
    const house = nativeHouse(), renderer = new UrbanBuildingLodRenderer(batch([house]));
    for (const metresPerPixel of [8, .3, .05, 8]) {
      expect(renderer.query(viewport, metresPerPixel).visible[0].building).toBe(house);
      expect(renderer.pick({x: 1, y: 1})).toBe(house);
    }
  });

  it('suppresses tessellation spokes on curved roofs while retaining a real seam', () => {
    const house = nativeHouse();
    const footprint: Surface = [{outer: rectangle(0, 0, 10), holes: []}];
    house.footprint = house.roof_footprint = footprint;
    house.volumes[0].roof_system = 'RF-DOME';
    house.volumes[0].roof_mesh = {
      vertices: [{x: 0, y: 5, z: 3}, {x: 5, y: 5, z: 6}, {x: 10, y: 5, z: 3}, {x: 5, y: 0, z: 3}],
      faces: [
        {vertices: [0, 1, 3], normal: [0, 0, 1], material: 'tile', kind: 'pan', roof_group: 'dome'},
        {vertices: [3, 1, 2], normal: [0, .05, .99875], material: 'tile', kind: 'pan', roof_group: 'dome'},
      ],
      edges: [{kind: 'hip', vertices: [1, 3], faces: [0, 1]}, {kind: 'ridge', vertices: [0, 2], faces: [0, 1]}],
    };
    const renderer = new UrbanBuildingLodRenderer(batch([house]));
    const ctx = new RecordingCanvas(), rendered = renderer.draw(ctx.asContext(), {viewport, metresPerPixel: .3, appearance});
    expect(rendered.lod.ridges).toBe(1);
    expect(rendered.ridgeSegments).toBe(1);
    expect(ctx.strokes.flat()).toEqual([[{x: 0, y: 5}, {x: 10, y: 5}]]);
  });

  it('bounds geometry and camera-history caches; replacing same-ID geometry invalidates picking, colors and cached mesh', () => {
    const buildings = Array.from({length: 20}, (_, i) => nativeHouse(i, i * 20));
    const renderer = new UrbanBuildingLodRenderer(batch(buildings), {maxCachedBuildings: 2, maxCachedVertices: 50, maxLodHistory: 3});
    renderer.draw(new RecordingCanvas().asContext(), {viewport: {...viewport, maxX: 500}, metresPerPixel: .05, appearance});
    expect(renderer.cacheStats.buildings).toBeLessThanOrEqual(2);
    expect(renderer.cacheStats.vertices).toBeLessThanOrEqual(50);
    expect(renderer.cacheStats.lodHistory).toBe(3);
    const replacement = nativeHouse(0, 1000, 1000);
    renderer.replaceScene(batch([replacement]));
    expect(renderer.cacheStats).toEqual({buildings: 0, vertices: 0, lodHistory: 0});
    expect(renderer.pick({x: 2, y: 2})).toBeUndefined();
    expect(renderer.pick({x: 1002, y: 1002})).toBe(replacement);
    const fresh = renderer.draw(new RecordingCanvas().asContext(), {viewport: {minX: 990, minY: 990, maxX: 1020, maxY: 1020}, metresPerPixel: .05, appearance});
    expect(fresh.cacheMisses).toBe(1);
    expect(fresh.roofMeshesRead).toBeGreaterThan(0);
  });

  it('draws selection even in silhouette mode and bounds close-roof work independently of visibility', () => {
    const houses = Array.from({length: 10}, (_, i) => nativeHouse(i, i * 8));
    const renderer = new UrbanBuildingLodRenderer(batch(houses), {maxFacetBuildings: 2});
    const close = renderer.draw(new RecordingCanvas().asContext(), {viewport, metresPerPixel: .05, appearance});
    expect(close.lod.facets).toBe(2);
    expect(close.lod.ridges).toBe(8);
    const ctx = new RecordingCanvas();
    const selected = renderer.draw(ctx.asContext(), {viewport, metresPerPixel: .05, appearance: {style: 'silhouette', diagnostic: 'none'}, selectedId: houses[5].id});
    expect(selected.roofMeshesRead).toBe(0);
    expect(selected.drawCalls).toBe(2);
    expect(ctx.strokes).toHaveLength(1);
    expect(ctx.strokeStyle).toBe('#197ea4');
  });

  it('handles oversized buildings, huge empty viewports and invalid camera arguments without unbounded grid traversal', () => {
    const large = nativeHouse();
    large.footprint = large.roof_footprint = [{outer: rectangle(-1_000_000, -1_000_000, 2_000_000), holes: []}];
    const renderer = new UrbanBuildingLodRenderer(batch([large]), {sectorSizeM: 16, maxSectorsPerBuilding: 4});
    const query = renderer.query({minX: -1e15, minY: -1e15, maxX: 1e15, maxY: 1e15}, 1e10);
    expect(query.metrics.testedBuildings).toBe(1);
    expect(query.metrics.visitedSectors).toBe(0);
    expect(renderer.pick({x: 0, y: 0})).toBe(large);
    expect(() => renderer.query(viewport, 0)).toThrow('metresPerPixel');
    expect(() => renderer.query({...viewport, minX: NaN}, 1)).toThrow('viewport');
    expect(() => new UrbanBuildingLodRenderer(batch([large, large]))).toThrow('Duplicate building');
    expect(buildingSurfaceContains([], {x: 1, y: 1})).toBe(false);
  });

  it('reuses bounded overview tiles at 100k: warm frames do no building query, mesh access or path preparation', () => {
    const source = nativeHouse(), columns = 317;
    Object.defineProperty(source.volumes[0], 'roof_mesh', {get() { throw new Error('Overview tile read a roof mesh'); }});
    const buildings = Array.from({length: 100_000}, (_, i) => {
      const footprint = offset(source.footprint, (i % columns) * 20, Math.floor(i / columns) * 20);
      return {...source, id: `native-${i}`, footprint, roof_footprint: footprint};
    });
    const canvases: {width: number; height: number; context: RecordingCanvas; getContext: () => CanvasRenderingContext2D}[] = [];
    const maxRasterBytes = 4 * 258 * 258 * 4;
    const renderer = new UrbanBuildingLodRenderer(batch(buildings), {
      maxRasterBytes, maxRasterBuildsPerFrame: 1, maxRasterBuildMs: 1000,
      rasterCanvasFactory: size => {
        const context = new RecordingCanvas(), canvas = {width: size, height: size, context, getContext: () => context.asContext()};
        canvases.push(canvas); return canvas as unknown as HTMLCanvasElement;
      },
    });
    const view = {minX: 0, minY: 0, maxX: columns * 20, maxY: columns * 20};
    let metrics = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 8, appearance});
    expect(metrics.renderMode).toBe('raster');
    expect(metrics.rasterTilesBuilt).toBe(1);
    expect(metrics.rasterTilesPending).toBeGreaterThan(0);
    for (let frame = 0; frame < 4 && metrics.rasterTilesPending > 0; frame++) metrics = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 8, appearance});
    expect(metrics.rasterTilesPending).toBe(0);
    const warmed = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 8, appearance});
    expect(warmed.rasterDrawCalls).toBeLessThanOrEqual(4);
    expect(warmed.drawCalls).toBe(warmed.rasterDrawCalls);
    expect(warmed.testedBuildings).toBe(0);
    expect(warmed.visitedSectors).toBe(0);
    expect(warmed.preparedVertices).toBe(0);
    expect(warmed.roofMeshesRead).toBe(0);
    expect(warmed.rasterTilesBuilt).toBe(0);
    expect(warmed.rasterCacheBytes).toBeLessThanOrEqual(maxRasterBytes);
    expect(warmed.visibleBuildingsExact).toBe(false);
    const recolored = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 8, appearance: {...appearance, diagnostic: 'uses'}});
    expect(recolored.rasterTilesBuilt).toBe(1);
    expect(recolored.rasterCacheBytes).toBeLessThanOrEqual(maxRasterBytes);
    expect(canvases.some(canvas => canvas.width === 1)).toBe(true); // Eviction releases backing memory.
    renderer.replaceScene(batch([nativeHouse()]));
    expect(canvases.every(canvas => canvas.width === 1)).toBe(true);
    const replaced = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 8, appearance});
    expect(replaced.rasterTilesBuilt).toBe(1);
  });

  it('retains courtyard transparency in cached tiles and overlays selected outlines without regenerating tiles', () => {
    const shape: Surface = [{outer: rectangle(10, 10, 32), holes: [rectangle(18, 18, 16)]}];
    const house = {...nativeHouse(), footprint: shape, roof_footprint: shape, volumes: []};
    const contexts: RecordingCanvas[] = [];
    const renderer = new UrbanBuildingLodRenderer(batch([house]), {rasterCanvasFactory: size => {
      const context = new RecordingCanvas(); contexts.push(context);
      return {width: size, height: size, getContext: () => context.asContext()} as unknown as HTMLCanvasElement;
    }});
    const view = {minX: 1, minY: 1, maxX: 200, maxY: 200};
    const first = renderer.draw(new RecordingCanvas().asContext(), {viewport: view, metresPerPixel: 2, appearance});
    expect(first.rasterTilesPending).toBe(0);
    expect(contexts[0].filled({x: 26, y: 26})).toBe(false);
    expect(contexts[0].filled({x: 12, y: 12})).toBe(true);
    expect(renderer.pick({x: 26, y: 26})).toBeUndefined();
    const selected = new RecordingCanvas();
    const second = renderer.draw(selected.asContext(), {viewport: view, metresPerPixel: 2, appearance, selectedId: house.id});
    expect(second.rasterTilesBuilt).toBe(0);
    expect(second.rasterDrawCalls).toBe(1);
    expect(selected.strokes).toHaveLength(1);
  });
});
