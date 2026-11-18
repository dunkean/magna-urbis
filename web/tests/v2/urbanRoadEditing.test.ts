import { describe, it, expect, vi } from 'vitest';
import type { World } from '../../src/gen/types';
import type { Layout, Partition, Street } from '../../../rust/bridge/urban';
import type { RustTownSnapshot } from '../../src/v2/rustUrban';
import { editableUrbanRoads, syncUrbanRoadEdits, replayUrbanRoadEdits, withRoadEditChanges, roadEditChanges } from '../../src/v2/urbanRoadEditing';
import { roadAt, deleteRoad, setRoadPath } from '../../src/v2/networkEdits';
import { roadAffectedTowns } from '../../src/v2/roadTownAccess';
import { rebuildRoadBlocks } from '../../src/v2/urbanRoadRebuild';
import { roadBlockScope } from '../../src/v2/urbanRoadBlocks';
import { projectRustTown } from '../../src/v2/rustTownProjection';
import { siteVisualScene } from '../../src/ui/urbanSilhouettes';
import { defaultSettings } from '../../src/v2/settings';
import { parseProject, serializeProject } from '../../src/v2/project';

const p = (x: number, y: number) => ({ x, y });
const square = (x: number, y: number, size = 50) => ({ outer: [p(x, y), p(x + size, y), p(x + size, y + size), p(x, y + size)], holes: [] });
const city = (w: World) => (w.debug!.v2RustCities as Record<string, RustTownSnapshot>).main;
function fixture(overlap = false): World {
  const grid = { w: 100, h: 100, cell: 10, data: new Float32Array(10000).fill(10) };
  const street: Street = { path: [p(100, 200), p(180, 200), p(260, 200)], widths: [4, 4, 4], role: 'lane', rank: 3 };
  const layout: Layout = {
    key: 'main',
    center: p(180, 200),
    culture: 'european-organic',
    quarters: [{ shape: square(50, 100, 400), phase: 0 }],
    streets: [street, { path: [p(180, 200), p(180, 100)], widths: [3, 3], rank: 3, role: 'lane' }],
    blocks: [
      { shape: square(100, 204), quarter: 0, kind: 'block', axis: p(1, 0) },
      { shape: square(350, 350), quarter: 0, kind: 'block', axis: p(1, 0) },
    ],
    warnings: [],
  };
  const parcels: Partition[] = [{ key: 'main', warnings: [], parcels: layout.blocks.map((b, block) => ({ id: `plot-${block}`, shape: b.shape, block, use: 'plot', front: null, axis: p(1, 0), rank: 1 })) }];
  const sites = parcels[0].parcels.map((plot, offset) => ({
    id: `${plot.id}/building`,
    parcel_id: plot.id!,
    offset,
    function: 'domestic' as const,
    culture: { culture: 'european-organic', pack: 'european', mode: 'historical_strict' as const, borrowing: null },
    surface: [plot.shape],
    preview: true,
    ground_z_m: 10,
    entrance: plot.shape.outer[0],
    access_id: '',
  }));
  const snapshot: RustTownSnapshot = { backend: 'rust-wasm-cpu', stage: 'buildings', layoutKey: 'retained', layouts: [layout], partitions: parcels, programmePartitions: parcels, sites, scene: siteVisualScene(sites), buildingIds: [], warnings: [] };
  const urban = projectRustTown(snapshot, 100, 'european-organic');
  return {
    seed: 'urban-road-test',
    mapSize: 1000,
    options: defaultSettings().options,
    stats: {},
    urban,
    settlements: [{ key: 'main', main: true, population: 100, culture: 'european-organic', center: p(180, 200), radius: 100, extent: layout.quarters[0].shape.outer, urban }],
    roads: overlap ? [{ path: street.path, width: 4, kind: 'minor' }] : [],
    bridges: [],
    terrain: { height: grid, slope: { ...grid, data: new Float32Array(10000) }, flow: grid, filled: grid.data, receiver: new Int32Array(10000).fill(-1), water: new Uint8Array(10000), rivers: [], lakes: [], coastline: [], seaLevel: 0 },
    debug: { v2RustCities: { main: snapshot } },
  } as unknown as World;
}

describe('editable urban streets', () => {
  it('picks narrow streets and their T junctions, without recording untouched streets as edits', () => {
    const source = fixture(),
      w = editableUrbanRoads(source),
      hit = roadAt(w, p(140, 200), 1)!;
    expect(w.roads![hit.index].urban?.key).toBe('main');
    const junction = (w.debug!.v2RustRegion as any).roads.junctions.find((j: any) => j.point.x === 180 && j.point.y === 200);
    expect(junction.degree).toBe(3);
    expect(source.roads).toEqual([]);
    expect(city(syncUrbanRoadEdits(w, w)).streetEdits).toBeUndefined();
    expect(editableUrbanRoads(w)).toBe(w);
  });
  it('moves the actual rendered street, persists it in a save, and replays it after regeneration', () => {
    const w = editableUrbanRoads(fixture()),
      hit = roadAt(w, p(140, 200), 1)!,
      road = w.roads![hit.index];
    const path = [road.path[0], p(140, 220), road.path.at(-1)!];
    const next = syncUrbanRoadEdits(setRoadPath(w, hit.index, path, { snap: 0.01 }).world, w);
    expect(city(next).layouts[0].streets.some(s => s.path.some(q => q.x === 140 && q.y === 220))).toBe(true);
    expect(roadAffectedTowns(w, next)).toEqual(['main']);
    expect(city(next).scene).toBe(city(w).scene);
    const loaded = parseProject(serializeProject(defaultSettings(), next)).world!;
    const replay = replayUrbanRoadEdits(city(w).layouts, city(loaded).streetEdits!);
    expect(replay[0].streets).toEqual(city(next).layouts[0].streets);
  });
  it('deletes the hidden overlapping regional copy as well as the selected city street', () => {
    const w = editableUrbanRoads(fixture(true)),
      hit = roadAt(w, p(140, 200), 1)!;
    expect(w.roads![hit.index].urban).toBeTruthy();
    const next = syncUrbanRoadEdits(deleteRoad(w, hit.index).world, w);
    expect(roadAt(next, p(140, 200), 1)).toBeUndefined();
    expect(city(next).streetEdits?.some(e => e.parts.length === 1)).toBe(true);
  });
  it('limits the final difference to the changed stretch instead of the whole connected road', () => {
    const w = fixture(),
      old = { path: [p(0, 10), p(500, 10), p(900, 10)], width: 4, kind: 'minor' as const };
    w.roads = [old];
    const next = { ...w, roads: [{ ...old, path: [p(0, 10), p(500, 10), p(900, 200)] }] };
    expect(roadEditChanges(w, next).old.every(path => path.every(q => q.x >= 500))).toBe(true);
  });
});

describe('local city reconstruction after street edits', () => {
  it('cuts only touched blocks and leaves the other block object intact', () => {
    const l = city(fixture()).layouts[0],
      changes = { old: [], next: [[p(100, 220), p(150, 220)]] };
    const scoped = roadBlockScope({ ...l, streets: [...l.streets, { path: changes.next[0], widths: [4, 4], role: 'street', rank: 2 }] }, changes);
    expect(scoped.affected.has(0)).toBe(true);
    expect(scoped.affected.has(1)).toBe(false);
    expect(scoped.layout.blocks[1]).toBe(l.blocks[1]);
    expect(scoped.layout.blocks.length).toBe(3);
  });
  it('sends only affected blocks to the engine and retains the untouched parcel and building', async () => {
    const before = editableUrbanRoads(fixture()),
      hit = roadAt(before, p(140, 200), 1)!,
      road = before.roads![hit.index];
    const next = withRoadEditChanges(before, syncUrbanRoadEdits(setRoadPath(before, hit.index, [road.path[0], p(140, 220), road.path.at(-1)!], { snap: 0.01 }).world, before), ['main']);
    const previous = city(next),
      kept = previous.partitions![0].parcels[1],
      house = previous.scene!.buildings[1];
    const run = vi.fn(async (_world, _settings, _key, _progress, _through, _lane, _claims, layouts: Layout[]) => {
      expect(layouts[0].blocks.some(b => b.shape.outer.some(q => q.x >= 350))).toBe(false);
      expect(layouts[0].streets).toBe(previous.layouts[0].streets);
      return { snapshot: { ...previous, layouts, partitions: [{ key: 'main', parcels: [], warnings: [] }], programmePartitions: [], sites: [], scene: siteVisualScene([]) }, urban: next.urban!, stats: {} };
    });
    const rebuilt = await rebuildRoadBlocks(next, defaultSettings(), ['main'], undefined, run as any),
      snapshot = city(rebuilt);
    expect(run).toHaveBeenCalledOnce();
    expect(snapshot.partitions![0].parcels).toContain(kept);
    expect(snapshot.scene!.buildings).toContain(house);
    expect(snapshot.layouts[0].blocks[1]).toBe(previous.layouts[0].blocks[1]);
    expect(snapshot.layouts[0].streets).toBe(previous.layouts[0].streets);
    expect(snapshot.streetEdits).toBe(previous.streetEdits);
    expect(snapshot.layoutKey).toBe('retained');
    expect(snapshot.pendingRoadChanges).toBeUndefined();
  });
});
