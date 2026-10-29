import { expect, it } from 'vitest';
import guest from './fixtures/native-parent-assembly-guest-plan.json';
import type { NativeParentBatch } from '../../rust/bridge/nativeParentContract';
import { projectParentRecords, translateParentVisualRecords } from '../src/ui/urbanParentVisual';
import { parent3dWindow } from '../src/ui/urbanParent3d';
import type { ParentWindowSnapshot } from '../src/ui/urbanParentColdWindow';
import { city3dProjectionScene } from '../src/render/city3dMeshes';
import { eachBuildingTriangle, buildingRayDistance, type BuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { exportMagnaBuildings } from '../src/surface/adapters/magna';
import { encodeParentVisual, decodeParentVisual } from '../src/ui/urbanParentVisualCache';

const batch: NativeParentBatch = JSON.parse(guest.data.batch_json);
function snapshot(): ParentWindowSnapshot {
  return { ...translateParentVisualRecords(projectParentRecords(batch.parents, batch.materials), 1000, -1000),
    sourceFingerprint: 'source', manifestFingerprint: 'manifest', viewport: [1000, -1000, 1300, -700],
    complete: true, reason: '', encodedBytes: 0, vertices: 0, candidates: 1, chunks: 1, maxDecodedChunkVertices: 0 };
}
it('draws and picks both real member contours with their own ground and parent identity, without a fake Single', () => {
  const source = snapshot(), before = JSON.stringify(source), window = parent3dWindow(source), scene = city3dProjectionScene(window);
  expect(scene.kinds).toEqual({ silhouette: 0, compact: 2, detailed: 0 });
  expect(scene.buildings).toHaveLength(2); expect(window.parents).toBe(1); expect(window.complete).toBe(true);
  for (const [i, b] of scene.buildings.entries()) {
    expect(b.footprint).toBe(source.members[i].footprint); expect(b.roof_footprint).toBe(source.members[i].roof_footprint);
    expect(b.ground_z_m).toBe(source.members[i].ground_z_m);
    expect(b).toMatchObject({ parent_id: source.parents[0].id, member_id: source.members[i].id, nativeRealization: false });
    for (const key of ['resolved', 'programme', 'programme_outcome', 'useful_area_m2', 'domestic_units', 'volumes']) expect(b).not.toHaveProperty(key);
    const triangles: BuildingTriangle[] = []; eachBuildingTriangle(b, t => triangles.push(t)); expect(triangles.length).toBeGreaterThan(0);
    const roof = triangles.find(t => t.surface === 'roof')!, p = roof.points.reduce((a, p) => [a[0] + p[0] / 3, a[1] + p[1] / 3, a[2] + p[2] / 3], [0, 0, 0]);
    expect(buildingRayDistance([p[0], p[1], p[2] + 10], [0, 0, -1], roof.points)).toBeCloseTo(10);
  }
  const exported = exportMagnaBuildings(scene);
  expect(exported.buildings).toHaveLength(2); expect(exported.buildings.every(b => b.representation === 'cartographic-proxy' && !b.nativeRealization)).toBe(true);
  expect(JSON.stringify(source)).toBe(before);
});
it('retains all native context occupation and reports pending/partial windows without legacy fallback', () => {
  const pending = parent3dWindow(); expect(pending.buildings).toEqual([]); expect(pending.complete).toBe(false);
  const source = snapshot(); source.complete = false; source.reason = 'member-budget';
  const projected = parent3dWindow(source); expect(projected.complete).toBe(false); expect(projected.reason).toBe('member-budget');
  for (const c of source.contexts) expect(projected.buildings.some(b => b.parent_id === c.parent_id && b.occupation_surfaces.includes(c.surface))).toBe(true);
  const broken = snapshot(); broken.members[1].ground_z_m = NaN;
  expect(() => parent3dWindow(broken)).toThrow('height');
});
it('keeps a provided member courtyard in cached context/occupation and refuses the older incomplete visual cache version', async () => {
  // Synthetic courtyard field tests only the projection/cache contract. This
  // altered decimal view is never archived, admitted, or sent to native code.
  const records = structuredClone(batch.parents), p = records[0].plan;
  if (p.kind !== 'assembly') throw new Error('native group fixture required');
  const court = [{ outer: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }], holes: [] }];
  p.assembly.members[0].plan.courtyards = court;
  const visual = projectParentRecords(records), cached = await encodeParentVisual(0, 'source', visual);
  const restored = await decodeParentVisual(cached, 'source');
  expect(restored.contexts.find(c => c.kind === 'member_courtyard')?.surface).toEqual(court);
  const view = parent3dWindow({ ...snapshot(), ...restored });
  expect(view.buildings[0].occupation_surfaces).toContain(restored.contexts.find(c => c.kind === 'member_courtyard')!.surface);
  await expect(decodeParentVisual({ ...cached, version: 'native-parent-visual-1' as typeof cached.version }, 'source')).rejects.toThrow('rebuild');
});
