import { expect, it, vi } from 'vitest';
import type { Layout, Point } from '../../rust/bridge/urban';
import type { PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import { city3dCanopy, cityCanopy, type CanopyTree, type CityCanopy } from '../src/render/cityGrove';
import { GROVE_STRIDE, groveTemplate } from '../src/render/city3d/groveInstances';
import { GroveBuffers } from '../src/render/world/groveBuffers';

it('draws the grove from shared meshes and keeps its buffers when the view changes', () => {
  const first: CanopyTree = {
    x: 110,
    y: 100,
    r: 5,
    h: 7,
    trunk: 0.6,
    seed: 4,
    lobes: [
      { x: 110, y: 100, z: 8, r: 3, tone: 0.25 },
      { x: 111, y: 99, z: 9, r: 4, tone: 0.8 },
    ],
  };
  const second = { ...first, x: 115, y: 105, lobes: first.lobes.map(lobe => ({ ...lobe, x: lobe.x + 5, y: lobe.y + 5 })) };
  const canopy: CityCanopy = { trees: [first, second], dwellings: [], walkways: [], stairs: [], altitude: 0 };
  const { buildings, instances } = city3dCanopy(canopy, x => x / 10);
  expect(instances.blocks).toHaveLength(1);
  const { trunks, lobes } = instances.blocks[0];
  expect(trunks.length).toBe(2 * GROVE_STRIDE);
  expect(lobes.length).toBe(4 * GROVE_STRIDE);
  expect([...trunks.slice(0, 6)]).toEqual([110, 100, 11, 11, Math.fround(0.6), 7]);
  expect(trunks[GROVE_STRIDE + 2]).toBe(11.5);
  expect(trunks[GROVE_STRIDE + 3]).toBe(11); // both roots use the same seat on the slope
  expect(lobes[10]).toBe(0x5d7f44);
  expect(buildings.flatMap(b => b.volumes.flatMap(v => v.roof_mesh.faces)).length).toBe(4); // the unique limbs

  const upload = vi.fn(),
    draw = vi.fn();
  const gl = new Proxy({ bufferData: upload, drawElementsInstanced: draw }, { get: (target, key) => Reflect.get(target, key) ?? (() => ({})) }) as unknown as WebGL2RenderingContext;
  const buffers = new GroveBuffers(gl);
  buffers.set(instances);
  buffers.step(Infinity);
  const held = buffers.blocks[0];
  const trunkMesh = groveTemplate(true, false),
    lobeMesh = groveTemplate(false, false);
  expect(upload.mock.calls.map(call => call[1])).toEqual([trunkMesh.vertices, trunkMesh.indices, lobeMesh.vertices, lobeMesh.indices, trunks, lobes]);
  buffers.draw(held);
  buffers.set(instances);
  buffers.step(Infinity);
  buffers.draw(buffers.blocks[0]);
  expect(buffers.blocks[0]).toBe(held);
  expect(upload).toHaveBeenCalledTimes(6);
  expect(draw.mock.calls.map(call => [call[1], call[4]])).toEqual([
    [trunkMesh.indices.length, 2],
    [lobeMesh.indices.length, 4],
    [trunkMesh.indices.length, 2],
    [lobeMesh.indices.length, 4],
  ]);
});

it('links platforms across grid boundaries without crossing an accepted walkway', () => {
  const outer = [
    { x: 10, y: 10 },
    { x: 220, y: 10 },
    { x: 220, y: 220 },
    { x: 10, y: 220 },
  ];
  const layouts = [{ key: 'grove', culture: 'elven', blocks: [{ shape: { outer, holes: [] } }] }] as unknown as Layout[];
  const buildings = [{ id: 'building', footprint: [], ground_z_m: 0 }] as unknown as PlacedBuilding[];
  const { walkways } = cityCanopy(layouts, buildings);
  const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  expect(walkways.length).toBeGreaterThan(30);
  expect(walkways.some(({ a, b }) => Math.floor(a.x / 32) !== Math.floor(b.x / 32))).toBe(true);
  for (const [i, { a, b }] of walkways.entries())
    for (let j = 0; j < i; j++) {
      const { a: c, b: d } = walkways[j];
      expect(side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0).toBe(false);
    }
});
