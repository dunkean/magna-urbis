import { describe, it, expect } from 'vitest';
import type { World } from '../../src/gen/types';
import { identifyRoads, insertRoadControlGeometry, roadControlSegment, translatedRoadSegment, deleteRoadControlSegment } from '../../src/v2/roadGestures';
import { addRoadEntries, commitRoutedRoads, connectedRoadControls, cutRoadControl, roadOutput, roadExitReports } from '../../src/v2/roadEditing';
import { editableRoadGeometry, roadGeometry } from '../../src/v2/roadControlModel';
import { editableUrbanRoads, syncUrbanRoadEdits } from '../../src/v2/urbanRoadEditing';
import { addRoad, deleteRoad } from '../../src/v2/networkEdits';
import { recordRoadOverrides, replayRegionalRoads, withRoadSources } from '../../src/v2/roadOverrides';
import { parseProject, serializeProject } from '../../src/v2/project';
import { defaultSettings } from '../../src/v2/settings';

const p = (x: number, y: number) => ({ x, y });
function fixture(): World {
  const grid = { w: 100, h: 100, cell: 10, data: new Float32Array(10000).fill(10) };
  const controls = [p(100, 200), p(200, 200), p(300, 200), p(400, 200)];
  return identifyRoads({
    seed: 'gestures',
    mapSize: 1000,
    options: {},
    stats: {},
    settlements: [],
    roads: [
      { kind: 'minor', width: 4, ...roadGeometry(controls, controls) },
      { kind: 'track', width: 2, ...roadGeometry([p(400, 200), p(600, 400)], [p(400, 200), p(600, 400)]) },
    ],
    bridges: [],
    terrain: { height: grid, slope: grid, flow: grid, filled: grid.data, water: new Uint8Array(10000), rivers: [], lakes: [], coastline: [], seaLevel: 0 },
    debug: {},
  } as unknown as World);
}
describe('road point, segment and line gestures', () => {
  it('adds a constraint without changing the routed shape or losing the selected line identity', () => {
    const w = fixture(),
      added = insertRoadControlGeometry(w, 0, p(250, 200)),
      next = commitRoutedRoads(w, [{ index: 0, geometry: added.geometry }]);
    expect(added.index).toBe(2);
    expect(next.roads![0].controls).toContainEqual(p(250, 200));
    expect(next.roads![0].editorId).toBe(w.roads![0].editorId);
    expect(next.roads![0].path).toEqual([p(100, 200), p(200, 200), p(250, 200), p(300, 200), p(400, 200)]);
  });
  it('moves both controls of a selected segment and propagates the moved junction to its incident road', () => {
    const w = fixture(),
      controls = translatedRoadSegment(w, 0, 2, w.roads![0].controls!, 20, 30),
      changes = connectedRoadControls(w, 0, controls);
    expect(controls).toEqual([p(100, 200), p(200, 200), p(320, 230), p(420, 230)]);
    expect(changes.find(e => e.index === 1)!.controls[0]).toEqual(p(420, 230));
    expect(roadControlSegment(w, 0, p(350, 200))).toBe(2);
  });
  it('deletes the chosen segment and preserves the two outer connections as separate lines', () => {
    const w = fixture(),
      next = deleteRoadControlSegment(w, 0, 1);
    expect(next.roads).toHaveLength(3);
    expect(next.roads![0].path).toEqual([p(100, 200), p(200, 200)]);
    expect(next.roads![2].path).toEqual([p(300, 200), p(400, 200)]);
    expect(w.roads).toHaveLength(2);
    expect(new Set(next.roads!.map(r => r.editorId)).size).toBe(3);
  });
  it('trims an end segment and removes a two-point line when its only segment is deleted', () => {
    const w = fixture();
    expect(deleteRoadControlSegment(w, 0, 0).roads![0].path[0]).toEqual(p(200, 200));
    const removed = deleteRoadControlSegment(w, 1, 0);
    expect(removed.roads).toHaveLength(1);
    expect(removed.roads![0]).toBe(w.roads![0]);
  });
  it('cuts at a point with a physical gap while preserving every unaffected bend', () => {
    const w = fixture(),
      next = cutRoadControl(w, 0, 1, 2);
    expect(next.roads![0].path.at(-1)).toEqual(p(199, 200));
    expect(next.roads!.at(-1)!.path[0]).toEqual(p(201, 200));
    expect(next.roads!.at(-1)!.path.at(-1)).toEqual(p(400, 200));
  });
  it('reapplies a cut, deletion and drawn entry from settings alone to a fresh regional graph', () => {
    const raw = fixture(),
      generated = raw.roads!;
    const fresh = (order: number[]) => {
      const roads = order.map(i => ({ ...generated[i], editorId: undefined }));
      const junctions = [p(100, 200), p(400, 200), p(600, 400)].map((point, i) => ({ point, site: null, degree: i === 1 ? 2 : 1 }));
      const segments = order.map((index, i) => ({ a: index, b: index + 1, path: roads[i].path, width: roads[i].width, class: index ? 'track' : 'local', surface: 'dirt', profile: 'medieval', length: 300, crossings: [], grade: 0, importance: 0 }));
      return { ...raw, roads, debug: { v2RustRegion: { roads: { segments, junctions, exits: [], lengthByClass: {}, lengthBySurface: {}, warnings: [], unreachable: [], routes: 2, ms: 0 } } } };
    };
    const before = withRoadSources(fresh([0, 1]));
    let next = cutRoadControl(before, 0, 1, 2);
    next = deleteRoad(next, 1).world;
    const drawn = addRoad(next, [p(400, 200), p(1000, 200)], { editorSource: 'draw:test', cls: 'main', snap: 1, width: 9 });
    next = addRoadEntries(drawn.world, drawn.road!, [1]);
    const settings = defaultSettings();
    settings.roadOverrides = recordRoadOverrides(undefined, before, next);
    expect(
      Object.values(settings.roadOverrides!.routes!)
        .map(parts => parts.length)
        .sort(),
    ).toEqual([0, 1, 2]);
    const saved = parseProject(serializeProject(settings)).settings;
    const regenerated = fresh([1, 0]);
    // The generated road between the original junctions can have a different sampled centreline.
    const sampled = [p(100, 200), p(250, 210), p(400, 200)];
    regenerated.roads[1].path = regenerated.debug.v2RustRegion.roads.segments[1].path = sampled;
    const replayed = replayRegionalRoads(regenerated, saved.roadOverrides);
    expect(replayed.roads!.map(r => r.path)).toEqual(next.roads!.map(r => r.path));
    expect(replayed.roads!.map(r => r.controls)).toEqual(next.roads!.map(r => r.controls));
    expect(roadOutput(replayed)?.segments.map(s => [s.class, s.width])).toEqual(roadOutput(next)?.segments.map(s => [s.class, s.width]));
    expect(roadOutput(replayed)?.junctions.find(j => j.point.x === 400)?.degree).toBe(2);
    expect(roadExitReports(replayed)).toEqual(roadExitReports(next));
  });
  it('keeps a bent urban road as one editable line when its hidden regional source has the same samples', () => {
    const w = fixture(),
      path = [p(100, 200), p(150, 220), p(200, 200), p(250, 210), p(300, 200), p(350, 220), p(400, 200)];
    w.roads = [{ ...w.roads![0], path, controls: undefined, controlIndices: undefined }];
    w.settlements = [{ key: 'town', population: 100, culture: 'european-organic', center: p(200, 300), extent: [], radius: 100 } as any];
    w.debug = {
      v2RustCities: {
        town: { stage: 'layout', layouts: [{ key: 'town', culture: 'european-organic', center: p(200, 300), quarters: [], blocks: [], warnings: [], streets: [{ path, widths: path.map(() => 4), rank: 2, role: 'approach' }] }], layoutKey: 'test', buildingIds: [], warnings: [] },
      },
    };
    const before = identifyRoads(editableUrbanRoads(w)),
      index = before.roads!.findIndex(r => r.urban),
      g = insertRoadControlGeometry(before, index, p(250, 210));
    const next = identifyRoads(syncUrbanRoadEdits(commitRoutedRoads(before, [{ index, geometry: g.geometry }]), before));
    const owned = next.roads!.filter(r => r.urban);
    expect(owned).toHaveLength(1);
    expect(owned[0].editorId).toBe(before.roads![index].editorId);
    expect(editableRoadGeometry(owned[0], w.mapSize).controls).toContainEqual(p(250, 210));
    const deleted = syncUrbanRoadEdits(
      deleteRoad(
        next,
        next.roads!.findIndex(r => r.urban),
      ).world,
      next,
    );
    expect(deleted.roads).toHaveLength(0);
  });
});
