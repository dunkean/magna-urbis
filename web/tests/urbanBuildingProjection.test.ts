import { expect, it } from 'vitest';
import fixture from './fixtures/urban-building-chunks-c.json';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { UrbanBuildingLodRenderer } from '../src/render/urbanBuildingLod';
import { projectNativeBuilding, projectNativeBuildingChunk, projectNativeBuildingRecords, type NativeBuildingProjection } from '../src/ui/urbanBuildingProjection';

const chunks = fixture.chunks.map(chunk => chunk.delta as unknown as PlacementBatch), originals = chunks.flatMap(chunk => chunk.buildings);
const materials = chunks.flatMap(chunk => chunk.materials ?? []);
function noNativeGraph(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(['resolved', 'plan_archives', 'roof_mesh', 'volumes', 'levels', 'structural_features', 'structural_foundations', 'parent'].includes(key)).toBe(false);
    noNativeGraph(child);
  }
}
class CanvasSink {
  fillStyle = ''; strokeStyle = ''; lineJoin = ''; lineCap = ''; lineWidth = 0;
  path: number[][] = []; fills: { color: string; path: number[][]; rule: string }[] = []; strokes: { color: string; path: number[][] }[] = [];
  save() {} restore() {} clip() {} closePath() {}
  beginPath() { this.path = []; } moveTo(x: number, y: number) { this.path.push([x, y]); } lineTo(x: number, y: number) { this.path.push([x, y]); }
  rect(x: number, y: number, width: number, height: number) { this.path.push([x, y, width, height]); }
  arc(x: number, y: number, radius: number) { this.path.push([x, y, radius]); }
  fill(rule = 'nonzero') { this.fills.push({ color: this.fillStyle, path: this.path, rule }); }
  stroke() { this.strokes.push({ color: this.strokeStyle, path: this.path }); }
  asContext() { return this as unknown as CanvasRenderingContext2D; }
}
const points = originals.flatMap(b => [...b.footprint, ...b.roof_footprint].flatMap(shape => [...shape.outer, ...shape.holes.flat()]));
const viewport = { minX: Math.min(...points.map(p => p.x)) - 1, minY: Math.min(...points.map(p => p.y)) - 1,
  maxX: Math.max(...points.map(p => p.x)) + 1, maxY: Math.max(...points.map(p => p.y)) + 1 };

it('projects all six real C plans with exact native contours, identities, height, material slots and metrics', () => {
  const before = JSON.stringify(chunks);
  for (const chunk of chunks) {
    const scene = projectNativeBuildingChunk(chunk); noNativeGraph(scene);
    expect(scene.refusals).toEqual(chunk.refusals.map(({ id, parcel_id, code, message }) => ({ id, parcel_id, code, message })));
    expect(scene.refusals).not.toBe(chunk.refusals);
    expect(Object.isFrozen(scene.refusals)).toBe(true);
    for (let i = 0; i < chunk.refusals.length; i++) {
      expect(scene.refusals![i]).not.toBe(chunk.refusals[i]); expect(Object.isFrozen(scene.refusals![i])).toBe(true);
      expect(Object.keys(scene.refusals![i]).sort()).toEqual(['code', 'id', 'message', 'parcel_id']);
    }
    expect(scene.metrics).toEqual({ scope: 'provided-records', buildings: 2, refusals: 1, openSpaces: 0, errors: 0,
      usefulAreaM2: chunk.buildings.reduce((n, b) => n + b.useful_area_m2, 0), domesticUnits: chunk.buildings.reduce((n, b) => n + b.domestic_units, 0) });
    for (let i = 0; i < scene.buildings.length; i++) {
      const source = chunk.buildings[i], dto = scene.buildings[i];
      expect(dto).toMatchObject({ id: source.id, parcel_id: source.parcel_id, recipe_id: source.recipe_id, variant_id: source.variant_id,
        culture: source.culture, ground_z_m: source.ground_z_m, nativeRealization: false, useful_area_m2: source.useful_area_m2, domestic_units: source.domestic_units });
      expect(dto.footprint).toBe(source.footprint); expect(dto.roof_footprint).toBe(source.roof_footprint);
      expect(dto.cartographic?.ridges).toBe(source.cartographic?.ridges); expect(dto.materials).toEqual(source.volumes[0].materials);
      expect(dto.height_m).toBe(source.cartographic?.height_m);
      expect(dto.occupation_surfaces).toEqual([source.footprint, source.circulation, ...(source.structural_features ?? []).map(f => f.surface)]);
      expect(dto.ground_constraints).toEqual([{ footprint: source.footprint, height_m: source.ground_z_m },
        ...(source.structural_foundations ?? []).map(f => ({ footprint: f.footprint, height_m: f.z_max_m }))]);
      // @ts-expect-error Cartographic DTO has no native plan, volumes or realization contract.
      const cannotRealize: PlacedBuilding = dto; void cannotRealize;
    }
  }
  expect(JSON.stringify(chunks)).toBe(before);
});

it('reads only lightweight occupation/ground children, never plans, archives, meshes, levels or feature graphs', () => {
  const source = structuredClone(chunks[0]), first = source.buildings[0];
  const fail = () => { throw new Error('A heavy native field was read.'); };
  Object.defineProperty(first, 'resolved', { get: fail });
  for (const feature of first.structural_features ?? []) for (const name of ['vertices3d', 'roof']) Object.defineProperty(feature, name, { get: fail });
  for (const volume of first.volumes) for (const name of ['roof_mesh', 'levels', 'foundation']) Object.defineProperty(volume, name, { get: fail });
  Object.defineProperty(source, 'plan_archives', { get: fail });
  for (const refusal of source.refusals) for (const name of ['parent', 'attempts', 'native', 'resolved']) Object.defineProperty(refusal, name, { get: fail, enumerable: true });
  expect(() => projectNativeBuildingChunk(source)).not.toThrow();
  const dto = projectNativeBuilding(first); noNativeGraph(dto);
  expect(() => projectNativeBuilding({ ...originals[0], simplification: 'recipe_volumes' })).toThrow('architectural plan');
});

it('uses the existing generic LOD renderer with the same native contours and colors at every tested scale', () => {
  const scene = projectNativeBuildingRecords(originals, materials);
  expect(scene.refusals).toEqual([]);
  const source = new UrbanBuildingLodRenderer({ buildings: originals, materials }, { raster: false });
  const projected = new UrbanBuildingLodRenderer<NativeBuildingProjection>(scene, { raster: false });
  for (const diagnostic of ['none', 'uses', 'height', 'access'] as const) for (const metresPerPixel of [.1, 1, 8]) {
    const first = new CanvasSink(), second = new CanvasSink(), appearance = { style: 'cartographic' as const, diagnostic };
    const originalMetrics = source.draw(first.asContext(), { viewport, metresPerPixel, appearance });
    const projectedMetrics = projected.draw(second.asContext(), { viewport, metresPerPixel, appearance });
    expect(projectedMetrics.visibleBuildings).toBe(6); expect(projectedMetrics.lod).toEqual(originalMetrics.lod);
    expect(second.fills).toEqual(first.fills); expect(second.strokes).toEqual(first.strokes);
    expect(projectedMetrics.roofMeshesRead).toBe(0);
  }
  const appended = new UrbanBuildingLodRenderer<NativeBuildingProjection>(projectNativeBuildingChunk(chunks[0]), { raster: false });
  appended.appendScene(projectNativeBuildingChunk(chunks[1])); appended.appendScene(projectNativeBuildingChunk(chunks[2]));
  expect(appended.query(viewport, 1).visible.map(entry => entry.building.id)).toEqual(originals.map(b => b.id));
});
