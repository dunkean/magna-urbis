import { describe, expect, it } from 'vitest';
import { buildCityBuildings } from '../src/render/cityCanvas';
import { cityBuildingsShare, mergeCityBuildingChunks } from '../src/render/cityBuildingsParallel';
import type { PlacementBatch } from '../../rust/bridge/urbanArchitecture';

const box = (x: number, y: number, w: number, d: number) => ({ outer: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }], holes: [] });
/** Gabled, hipped and flat lots, one without massing and one without footprint (skipped): every item kind of the build. */
function batch(): PlacementBatch {
  const roofs = ['gable', 'hip', 'flat', 'pyramid'] as const, buildings = [];
  for (let i = 0; i < 23; i++) {
    const shape = box((i % 6) * 20, Math.floor(i / 6) * 20, 12 + (i % 3), 9), roof = roofs[i % 4];
    buildings.push({ id: `b${i}`, parcel_id: `p${i}`, function: i % 5 ? 'domestic' : 'collective', culture: { culture: i % 2 ? 'medina' : 'european-organic' }, ground_z_m: i,
      footprint: i === 7 ? [] : [shape], roof_footprint: [],
      ...(i === 11 ? {} : { programme: { role: i === 3 ? 'worship.parish' : undefined, massing: [{ floors: 1 + (i % 3), eave_m: 3 + i % 4, rise_m: roof === 'flat' ? 0 : 3, roof,
        ridges: roof === 'gable' ? [[shape.outer[0].x, shape.outer[0].y + 4.5, shape.outer[1].x + (i % 3), shape.outer[0].y + 4.5]] : [], wall: 'plaster', cover: roof === 'flat' ? 'earth' : 'tile', tone: (i % 7) / 7 }] } }) });
  }
  return { buildings } as unknown as PlacementBatch;
}

describe('parallel city buildings', () => {
  it('merges the worker shares into exactly the one-thread build', () => {
    const scene = batch(), one = buildCityBuildings(scene), workers = 3;
    const cultures = Array.from({ length: workers }, () => [] as string[]);
    scene.buildings.forEach((b, g) => cultures[g % workers].push(b.culture?.culture ?? ''));
    // Each share crosses a structured clone, as between a worker and the page.
    const chunks = cultures.map((list, worker) => structuredClone(cityBuildingsShare(structuredClone(scene.buildings), { worker, workers, cultures: list, roofs: true })));
    const merged = mergeCityBuildingChunks(scene, undefined, chunks);
    expect(one.roofs?.shapes.length).toBeGreaterThan(20);
    expect(merged.items.map(i => i.building)).toEqual(one.items.map(i => i.building));
    expect(merged.items.every((item, i) => item.building === one.items[i].building)).toBe(true);
    expect(merged.items).toEqual(one.items);
    expect(merged.roofs).toEqual(one.roofs);
    expect([...merged.byId]).toEqual([...one.byId]);
  });
});
