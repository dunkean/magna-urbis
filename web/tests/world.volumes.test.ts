import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Building3dScene, BuildingTriangle } from '../src/render/urbanBuildingGeometry';
import { roofEdgeMasks } from '../src/render/roofEdges';
import type { RoofMode } from '../src/render/roofMode';
import { city3dBuildings, city3dBuildingsSteps } from '../src/render/city3d/display';
import { city3dLotEnclosures } from '../src/render/city3d/yards';
import type { LiveFrame } from '../src/render/live/contract';
import { BUILDING_BLOCK, BlockGrouping, TownAltitudes, blockLevel, blockPart, worldPaint, worldSeat, yardBlockLevel } from '../src/render/world/buildingsBlocks';
import { createWorldBuildingsLayer } from '../src/render/world/buildingsLayer';
import { BuildingBlockCache } from '../src/render/world/buildingsCache';
import { expandBuildingPart, indexBuildingPart } from '../src/render/world/buildingsIndex';
import { GroundDiagnostics, layerDiagnosticsEnabled } from '../src/render/live/layerDiagnostics';
import type { LiveLayerStats } from '../src/render/live/contract';
import { BUILDING_STRIDE, buildingBatches } from '../src/render/world/buildingsMesh';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import { TREES_BLOCK, treeBlockSteps, treeCloseShare, treeDrawCount, treeSolidShare } from '../src/render/world/treesBlocks';
import { createWorldTreesLayer } from '../src/render/world/treesLayer';
import { TREE_MESHES } from '../src/render/world/treesShader';
import { buildingTriangleBudget, clampViewDepth, setViewDepth, VIEW_DEPTH_DEFAULT, VIEW_DEPTH_MAX } from '../src/render/world/viewDepth';
import { hazeDistance } from '../src/render/world/volumes';
import type { View } from '../src/render/view';
import { buildNearTrees, TREE_STRIDE, type TreeInputs } from '../src/ui/terrain3dTrees';

beforeEach(() => vi.stubGlobal('__muLayerDiagnostics', true));
afterEach(() => {
  setViewDepth(VIEW_DEPTH_DEFAULT);
  vi.unstubAllGlobals();
});

const W = 1600,
  H = 900;
/** A relief of n x n control heights over `width` metres: a slope up to the east plus a hill. */
function relief(width: number, n = 64, exaggeration = 1.5): TerrainHeights {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 40 + (i / n) * 120 + 30 * Math.sin((j / n) * 6);
  return new TerrainHeights(data, n, width, 0, exaggeration);
}
/** The ground of the display scene: the relief in real metres (v2/display/worldVolumes.ts). */
const rawOf =
  (heights: TerrainHeights) =>
  (x: number, y: number): number =>
    heights.heightAt(x, y) / heights.exaggeration;
/** Silhouette records of `count` houses on a grid (pyramid roofs on two-storey bodies), placed as the city sends them
 * (ui/urbanSilhouettes.ts): footprints in map metres, the placement origin at the map's corner. */
function sources(count: number, spacing = 25, origin = 300): PlacedBuilding[] {
  const side = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, k) => {
    const x = origin + (k % side) * spacing,
      y = origin + Math.floor(k / side) * spacing,
      footprint = [
        {
          outer: [
            { x: x - 5, y: y - 4 },
            { x: x + 5, y: y - 4 },
            { x: x + 5, y: y + 4 },
            { x: x - 5, y: y + 4 },
          ],
          holes: [],
        },
      ];
    const source = {
      id: `house-${k}`,
      parcel_id: `p${k}`,
      recipe_id: 'silhouette',
      ground_z_m: 0,
      footprint,
      roof_footprint: footprint,
      transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 },
      culture: { culture: 'european-organic' },
      function: 'domestic',
      volumes: [],
      structural_features: [],
      programme: { role: 'house', massing: [{ floors: 2, eave_m: 6, rise_m: 4, roof: 'pyramid', ridges: [], cover: 'tile', wall: 'plaster', openings: 'none' }] },
    } as unknown as PlacedBuilding;
    return source;
  });
}
const batch = (buildings: PlacedBuilding[]): PlacementBatch => ({ schema_version: '1', generator_version: 'silhouette', buildings, refusals: [], open_spaces: [] });
/** The display scene of those houses, seated on the relief as the page makes it. */
const town = (count: number, heights: TerrainHeights, spacing?: number) => city3dBuildings(batch(sources(count, spacing)), { heightAt: rawOf(heights) })!;
/** Every block of a scene, grouped at once. */
function grouped(scene: Building3dScene, heights: TerrainHeights) {
  const grouping = new BlockGrouping(scene, heights, heights.exaggeration);
  expect(grouping.step(Infinity)).toBe(true);
  return grouping.blocks;
}
/** A WebGL2 context that records nothing and answers every query. */
function mockGl(): WebGL2RenderingContext {
  return new Proxy({} as WebGL2RenderingContext, {
    get: (target, name) => {
      const t = target as unknown as Record<string | symbol, unknown>;
      if (!(name in t)) t[name] = name === 'getProgramParameter' || name === 'getShaderParameter' ? vi.fn(() => true) : String(name).startsWith('create') || name === 'getUniformLocation' ? vi.fn(() => ({})) : vi.fn();
      return t[name];
    },
  });
}
/** The frame the compositor would hand the layers for a view. */
function frame(gl: WebGL2RenderingContext, view: View, heights: TerrainHeights): LiveFrame {
  const camera = createFrameCamera();
  frameCamera(camera, view, W, H, W, H, 1, heights);
  return { gl, view, cssW: W, cssH: H, dpr: 1, width: W, height: H, camera, target: null, now: 0, moving: false, quality: 'full' } as unknown as LiveFrame;
}

describe('world buildings', () => {
  it('marks V1 eaves and changes of roof plane without marking coplanar triangle seams', () => {
    const materials = { cladding: 'city3d:cover:tile' } as BuildingTriangle['materials'];
    const roof = (points: BuildingTriangle['points'], normal: BuildingTriangle['normal']): BuildingTriangle => ({ points, normal, materials, surface: 'roof' });
    const a = [0, 0, 4] as const,
      b = [4, 0, 4] as const,
      c = [4, 2, 6] as const,
      d = [0, 2, 6] as const,
      e = [4, 4, 4] as const;
    const point = (p: readonly [number, number, number]): BuildingTriangle['points'][number] => [...p];
    const pan = [0, -1, 1] as const;
    expect([...roofEdgeMasks([roof([point(a), point(b), point(c)], [...pan]), roof([point(a), point(c), point(d)], [...pan]), roof([point(d), point(c), point(e)], [0, 1, 1])])]).toEqual([0b101, 0b011, 0b111]);
  });

  it('writes four distinct roof treatments in the same vertex format', () => {
    const heights = relief(4000),
      scene = town(1, heights),
      block = grouped(scene, heights)[0],
      seat = worldSeat(heights, heights.exaggeration),
      appearance = { style: 'cartographic', diagnostic: 'none', colors: { building: '#002040' } } as const;
    const data = (roof: RoofMode) => blockPart(block, blockLevel(block, 30, roof === 'minimal'), worldPaint(scene, { ...appearance, roof }, new TownAltitudes()), seat, 0, 1);
    const v1 = data('v1'),
      v2 = data('v2'),
      flat = data('flat'),
      minimal = data('minimal');
    const color = (i: number) => i % BUILDING_STRIDE >= 6 && i % BUILDING_STRIDE <= 8;
    expect(v1.map((v, i) => (color(i) ? Math.abs(v) : v))).toEqual(v2);
    expect(v1.some((v, i) => color(i) && Object.is(v, -0))).toBe(true);
    expect(v2.some((v, i) => color(i) && (v < 0 || Object.is(v, -0)))).toBe(false);
    const indexed = indexBuildingPart(v1.slice(), 0);
    expect(new Uint32Array(expandBuildingPart(indexed).buffer)).toEqual(new Uint32Array(v1.buffer));
    const sloped = (mesh: Float32Array) => {
      const out: number[] = [];
      for (let i = 0; i < mesh.length; i += BUILDING_STRIDE) {
        const length = Math.hypot(mesh[i + 3], mesh[i + 4], mesh[i + 5]),
          up = mesh[i + 4] / length;
        if (up > 0.1 && up < 0.99) out.push(i);
      }
      return out;
    };
    const slopes = sloped(v2);
    expect(slopes.length).toBeGreaterThan(0);
    expect(sloped(flat)).toEqual(slopes);
    for (const i of slopes) {
      expect(flat.slice(i, i + 3)).toEqual(v2.slice(i, i + 3));
      expect(flat.slice(i + 6, i + 9)).toEqual(v2.slice(i + 6, i + 9));
      expect(Math.hypot(flat[i + 3], flat[i + 4], flat[i + 5])).toBeCloseTo(1, 6);
    }
    expect(sloped(minimal)).toEqual([]);
    expect(minimal.length).toBeLessThan(v2.length);
    expect(blockLevel(block, 30, 'overview')).toBe(1);
    const textured = (roof: RoofMode) => buildingBatches(scene.buildings, block.origin, { appearance: { ...appearance, roof, textured: true }, roofInk: roof === 'v1', materials: [], snowAltitudes: new TownAltitudes() }, false);
    const pbr = textured('v1'),
      plain = textured('v2');
    expect(pbr.some(batch => batch.data.some((v, i) => i % BUILDING_STRIDE === 8 && !Number.isInteger(v)))).toBe(true);
    expect(pbr.map(batch => batch.data.map((v, i) => (i % BUILDING_STRIDE === 8 ? Math.floor(v) : v)))).toEqual(plain.map(batch => batch.data));
  });

  it('reuses the original GPU blocks when switching back from a minimal roof', () => {
    const heights = relief(4000),
      scene = town(4, heights),
      gl = mockGl();
    let roof: RoofMode = 'v2';
    const layer = createWorldBuildingsLayer(gl, { scene: () => scene, terrain: () => heights, appearance: () => ({ style: 'cartographic', diagnostic: 'none', roof }), topView: () => true, invalidate: () => {} });
    const view = frame(gl, { cx: 325, cy: 325, scale: 4 }, heights);
    const draw = () => {
      while (layer.work!(Infinity, view));
      layer.draw(view);
      while (layer.work!(Infinity, view));
      layer.draw(view);
      expect(layer.presented()).toBe(true);
      return layer.stats!().triangles;
    };
    const detailed = draw();
    roof = 'minimal';
    expect(draw()).toBeLessThan(detailed);
    const uploads = vi.mocked(gl.bufferData).mock.calls.length;
    roof = 'v2';
    expect(draw()).toBe(detailed);
    expect(vi.mocked(gl.bufferData).mock.calls).toHaveLength(uploads);
    layer.dispose();
  });

  it('uses the same resident roof triangles overhead and at the start of a tilt, even below the plan scale', () => {
    const heights = relief(4000),
      scene = town(16, heights),
      gl = mockGl();
    const layer = createWorldBuildingsLayer(gl, { scene: () => scene, terrain: () => heights, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), topView: () => true, invalidate: () => {} });
    const view = { cx: 350, cy: 350, scale: 0.08 };
    const flat = frame(gl, view, heights);
    layer.draw(flat);
    expect(layer.presented()).toBe(false);
    while (layer.work!(Infinity, flat));
    layer.draw(flat);
    expect(layer.presented()).toBe(true);
    const drawn = layer.stats!().triangles;
    expect(drawn).toBeGreaterThan(0);
    const uploaded = vi.mocked(gl.bufferData).mock.calls.length;
    layer.draw(frame(gl, { ...view, pitch: 0.0001 }, heights));
    expect(layer.stats!().triangles).toBe(drawn);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploaded);
    layer.dispose();
  });

  it('leaves overhead fences to the plan and keeps a ribbon at the start of a tilt', () => {
    const heights = relief(4000),
      gl = mockGl(),
      buildings = city3dLotEnclosures(
        [
          {
            path: [
              { x: 330, y: 350 },
              { x: 370, y: 350 },
            ],
            material: 'fence',
            side: 'front',
          },
        ],
        rawOf(heights),
      ),
      scene = { buildings },
      layer = createWorldBuildingsLayer(gl, { scene: () => scene, terrain: () => heights, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), topView: () => true, invalidate: () => {} }),
      view = { cx: 350, cy: 350, scale: 6 };
    const draw = (pitch: number) => {
      const shown = frame(gl, { ...view, pitch }, heights);
      while (layer.work!(Infinity, shown));
      layer.draw(shown);
      while (layer.work!(Infinity, shown));
      layer.draw(shown);
      return layer.stats!().triangles;
    };
    expect(draw(0)).toBe(0);
    const ribbon = draw(0.0001);
    expect(ribbon).toBeGreaterThan(0);
    expect(draw(0.5)).toBeGreaterThan(ribbon);
    expect(draw(0.0001)).toBe(ribbon);
    const [yard] = grouped(scene, heights);
    expect(yardBlockLevel(yard, 3.4, 1)).toBe(1);
    expect(yardBlockLevel(yard, 3.4, 0)).toBe(0);
    expect(yardBlockLevel(yard, 6, 1, 0.9)).toBe(1);
    expect(yardBlockLevel(yard, 6, 0, 0.9)).toBe(0);
    layer.dispose();
  });

  it('stands silhouette houses on the drawn terrain under them, with their real height, in the blocks they cover', () => {
    const heights = relief(4000),
      scene = town(40, heights),
      blocks = grouped(scene, heights);
    expect(scene.kinds.silhouette).toBe(40);
    expect(blocks.reduce((n, b) => n + b.buildings.length, 0)).toBe(40);
    // Placed at the map's corner, the houses still go to the blocks of their footprints.
    expect(blocks.every(block => block.origin[0] >= BUILDING_BLOCK && block.origin[1] >= BUILDING_BLOCK)).toBe(true);
    for (const block of blocks) expect(block.origin[0] % BUILDING_BLOCK).toBe(0);
    const seat = worldSeat(heights, heights.exaggeration),
      paint = worldPaint(scene, { style: 'cartographic', diagnostic: 'none' }, new TownAltitudes()),
      block = blocks[0],
      house = block.buildings[0],
      data = blockPart(block, 0, paint, seat, 0, 1);
    expect(data.length).toBeGreaterThan(0);
    // The centre of the footprint: the drawn terrain there, within the slope across a 10 m house.
    const xs = house.footprint[0].outer.map(p => p.x),
      ys = house.footprint[0].outer.map(p => p.y),
      drawn = heights.heightAt((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    let top = -Infinity;
    for (let i = 0; i < data.length; i += BUILDING_STRIDE) {
      expect(Math.abs(data[i + 9] - drawn)).toBeLessThan(3 * heights.exaggeration);
      top = Math.max(top, data[i + 1]);
    }
    // Two storeys of 3 m and a 4 m roof above the ground: real metres, not exaggerated.
    expect(top).toBeCloseTo(10, 1);
  });

  it('composes the town in steps as at once', () => {
    const heights = relief(4000),
      source = batch(sources(100)),
      whole = city3dBuildings(source, { heightAt: rawOf(heights) })!,
      work = city3dBuildingsSteps(source, { heightAt: rawOf(heights) });
    let step = work.next(),
      steps = 0;
    while (!step.done) {
      step = work.next();
      steps++;
    }
    expect(steps).toBeGreaterThan(2);
    expect(step.value!.kinds).toEqual(whole.kinds);
    expect(step.value!.buildings).toEqual(whole.buildings);
  });

  it('draws a building detailed from 10 px, as an overview from 6, as a box from 3, not under', () => {
    const block = grouped(town(4, relief(4000)), relief(4000))[0];
    expect([40, 10, 8, 6, 5, 3, 2].map(px => blockLevel(block, px))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(blockLevel(block, 40, true)).toBe(2);
    // Grouped cell by cell: the cells cover the buildings in order.
    expect(block.cells[block.cells.length - 1]).toBe(block.buildings.length);
  });

  it('draws a tilted frame from blocks built in slices, nothing in the top view', () => {
    const heights = relief(4000),
      scene = town(9000, heights, 22),
      gl = mockGl(),
      layer = createWorldBuildingsLayer(gl, { scene: () => scene, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), terrain: () => heights, invalidate: () => {} });
    const flat = frame(gl, { cx: 1300, cy: 1300, scale: 0.6 }, heights);
    layer.draw(flat);
    expect(layer.stats!().drawCalls).toBe(0);
    const tilted = frame(gl, { cx: 1300, cy: 1300, scale: 0.6, pitch: 1, yaw: 0.4 }, heights);
    const started = performance.now();
    let slices = 0;
    // Overviews of every block first, then what the frame wants.
    while (layer.work!(8, undefined)) slices++;
    for (let pass = 0; pass < 4; pass++) {
      layer.draw(tilted);
      while (layer.work!(8, tilted)) slices++;
    }
    const buildMs = performance.now() - started;
    const draws = () => vi.mocked(gl.drawArrays).mock.calls.length + vi.mocked(gl.drawElements).mock.calls.length;
    const drawCalls = draws();
    layer.draw(tilted);
    const stats = layer.stats!();
    expect(draws() - drawCalls).toBe(stats.drawCalls);
    expect(gl.drawElements).toHaveBeenCalled();
    expect(stats.drawCalls).toBeGreaterThan(0);
    // A frame uploads nothing.
    const uploads = vi.mocked(gl.bufferData).mock.calls.length;
    layer.draw(tilted);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploads);
    console.info(
      `world buildings: 9000 houses, ${stats.blocks} blocks drawn, ${stats.drawCalls} draws, ${Math.round(stats.triangles)} triangles, ${(stats.bytes / 1048576).toFixed(1)} MiB, built in ${Math.round(buildMs)} ms over ${slices} slices (longest ${stats.sliceMs.toFixed(1)} ms), draw ${stats.ms.toFixed(2)} ms`,
    );
  });
});

/** A uniform stand over a 2400 m map from (0, 0): field bytes cover, height (x 50 m), needle share. */
function stand(cover: number, height: number, needle: number): TreeInputs {
  const n = 32,
    rgba = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) rgba.set([cover, height, needle, 255], i * 4);
  return { field: { x: 0, y: 0, width: 2400, n, rgba, key: `${cover}-${height}-${needle}` }, seed: 5, climate: { temperature: 10, precipitation: 900 }, renderV2: 1, zone: 0, season: 0.5, water: () => 0, height: () => 20 };
}

describe('world trees', () => {
  it('builds per block exactly the trees the 3D view builds around an eye', () => {
    const inputs = stand(200, 90, 120),
      eye = { x: 1200, y: 1200, forwardX: 0, forwardY: 1, distance: 250 };
    const stream = buildNearTrees(inputs, eye),
      blocks = new Map<string, Float32Array>();
    const started = performance.now();
    let trees = 0,
      count = 0;
    for (let by = Math.floor((1200 - 260) / TREES_BLOCK); by <= Math.floor((1200 + 260) / TREES_BLOCK); by++)
      for (let bx = Math.floor((1200 - 260) / TREES_BLOCK); bx <= Math.floor((1200 + 260) / TREES_BLOCK); bx++) {
        const work = treeBlockSteps(inputs, bx, by);
        let step = work.next();
        while (!step.done) step = work.next();
        const block = step.value.data.subarray(0, step.value.count * TREE_STRIDE);
        trees += block.length / TREE_STRIDE;
        count++;
        for (let i = 0; i < block.length; i += TREE_STRIDE) blocks.set(`${(block[i] + bx * TREES_BLOCK).toFixed(2)},${(block[i + 1] + by * TREES_BLOCK).toFixed(2)}`, block.subarray(i, i + TREE_STRIDE));
      }
    const ms = (performance.now() - started) / count;
    expect(stream.length).toBeGreaterThan(1000 * TREE_STRIDE);
    for (let i = 0; i < stream.length; i += TREE_STRIDE) {
      const found = blocks.get(`${stream[i].toFixed(2)},${stream[i + 1].toFixed(2)}`);
      expect(found).toBeDefined();
      for (let k = 2; k < TREE_STRIDE; k++) expect(found![k]).toBe(stream[i + k]);
    }
    console.info(`world trees: ${count} blocks of ${TREES_BLOCK} m, ${Math.round(trees / count)} trees per block, ${ms.toFixed(1)} ms per block`);
  });

  it('draws coarser lathes and fewer trees as they get smaller on screen', () => {
    expect(TREE_MESHES.map(mesh => mesh.indices.length / 3)).toEqual([78, 28, 6]);
    // A small zoom change swaps a few individuals between levels, using the same prefix of the block.
    expect([18, 28, 38].map(treeSolidShare)).toEqual([0, 0.5, 1]);
    expect([64, 88, 112].map(treeCloseShare)).toEqual([0, 0.5, 1]);
    expect(treeDrawCount(500, 8)).toBe(500);
    expect(treeDrawCount(500, 2.5)).toBe(125);
  });

  it('keeps the trees around the target whatever the pitch', () => {
    // A distance whose triangle budget the dense stand stays under: the budget thins the smallest trees otherwise.
    const heights = relief(2400),
      inputs = stand(220, 100, 120),
      gl = mockGl(),
      layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 1500, shown: () => true, invalidate: () => {} });
    const inner: number[] = [],
      front: number[] = [];
    for (let pitch = 0.3; pitch <= 1.2001; pitch += 0.15) {
      const view = frame(gl, { cx: 1200, cy: 1200, scale: 1, pitch, yaw: 0.2 }, heights);
      for (let pass = 0; pass < 4; pass++) {
        layer.draw(view);
        while (layer.work!(8, view));
      }
      layer.draw(view);
      inner.push(layer.stats!().inner);
      front.push(layer.stats!().front);
    }
    expect(inner[0]).toBeGreaterThan(0);
    for (const count of inner) expect(count).toBe(inner[0]);
    // As the orbit goes down, the trees in front of the eye stay: a low camera stands among them.
    for (const count of front) expect(count).toBeGreaterThan(0);
    console.info(`world trees, pitch 0.3 to 1.2: around the target ${inner.join(' ')}; in front of the eye ${front.join(' ')}`);
  });

  it('draws a tilted frame from the blocks around the target, built once', () => {
    const heights = relief(2400),
      inputs = stand(220, 100, 120),
      gl = mockGl(),
      layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 600, shown: () => true, invalidate: () => {} });
    const view = { cx: 1200, cy: 1400, scale: 8, pitch: 1.1, yaw: 0.3 },
      tilted = frame(gl, view, heights);
    const started = performance.now();
    for (let pass = 0; pass < 8; pass++) {
      layer.draw(tilted);
      while (layer.work!(8, tilted));
    }
    const buildMs = performance.now() - started;
    layer.draw(tilted);
    const stats = layer.stats!();
    expect(stats.drawCalls).toBeGreaterThan(0);
    // Moving and turning within the built blocks builds nothing.
    const uploads = vi.mocked(gl.bufferData).mock.calls.length;
    layer.draw(frame(gl, { ...view, cx: 1230, yaw: 0.9 }, heights));
    layer.draw(tilted);
    expect(vi.mocked(gl.bufferData).mock.calls.length).toBe(uploads);
    console.info(
      `world trees: ${stats.blocks} blocks drawn, ${stats.drawCalls} draws, ${stats.instances} trees, ${Math.round(stats.triangles)} triangles (${Math.round(stats.triangles * 3)} vertices), ${(stats.bytes / 1048576).toFixed(1)} MiB, built in ${Math.round(buildMs)} ms (block ${stats.blockMs.toFixed(1)} ms, longest slice ${stats.sliceMs.toFixed(1)} ms), draw ${stats.ms.toFixed(2)} ms`,
    );
  });
});

describe('world buildings by distance', () => {
  /** Builds what a view wants, as the compositor's slices would, then draws it once more for the stats. */
  function settle(layer: ReturnType<typeof createWorldBuildingsLayer>, view: LiveFrame) {
    for (let pass = 0; pass < 6; pass++) {
      layer.draw(view);
      while (layer.work!(8, view));
    }
    layer.draw(view);
    return { ...layer.stats!() };
  }

  it('keeps the default thresholds and haze, extends them together, and retains every far house at maximum depth', () => {
    const heights = relief(40000, 128),
      scene = city3dBuildings(batch(sources(10000, 22, 18900)), { heightAt: rawOf(heights) })!,
      gl = mockGl(),
      layer = createWorldBuildingsLayer(gl, { scene: () => scene, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), terrain: () => heights, invalidate: () => {} }),
      view = frame(gl, { cx: 20000, cy: 20000, scale: 0.04, pitch: (55 * Math.PI) / 180 }, heights),
      block = grouped(scene, heights)[0];
    expect(buildingTriangleBudget(VIEW_DEPTH_DEFAULT)).toBe(300000);
    expect(buildingTriangleBudget(VIEW_DEPTH_MAX)).toBe(3000000);
    expect(clampViewDepth(NaN)).toBe(VIEW_DEPTH_DEFAULT);
    expect(clampViewDepth(100)).toBe(VIEW_DEPTH_MAX);
    expect(blockLevel(block, 2)).toBe(block.levels);
    expect(blockLevel(block, 2, false, 2)).toBe(2);
    expect(blockLevel(block, 0.001, false, VIEW_DEPTH_MAX)).toBe(2);
    const haze = Math.max(2 * view.camera.distance, 100);
    expect(hazeDistance(view.camera)).toBe(haze);
    const original = settle(layer, view);
    expect(original.triangles).toBe(0);
    setViewDepth(VIEW_DEPTH_MAX);
    expect(hazeDistance(view.camera)).toBe(haze * VIEW_DEPTH_MAX);
    const extended = settle(layer, view);
    // All 10k houses fit the frustum, below the default size cutoff. Each box has at least ten triangles.
    expect(extended.triangles).toBeGreaterThanOrEqual(10000 * 10);
    expect(extended.triangles).toBeLessThanOrEqual(buildingTriangleBudget(VIEW_DEPTH_MAX));
    setViewDepth(VIEW_DEPTH_DEFAULT);
    expect(settle(layer, view).triangles).toBe(original.triangles);
  });

  it('draws a large town as boxes far away, nothing under a pixel, roofs in a turned top view', () => {
    const heights = relief(40000, 128),
      scene = city3dBuildings(batch(sources(10000, 22, 18900)), { heightAt: rawOf(heights) })!,
      gl = mockGl(),
      layer = createWorldBuildingsLayer(gl, { scene: () => scene, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), terrain: () => heights, invalidate: () => {} });
    const slices: number[] = [];
    let more = true;
    while (more) {
      const started = performance.now();
      more = layer.work!(8, undefined);
      slices.push(performance.now() - started);
    }
    const views = {
      whole: frame(gl, { cx: 20000, cy: 20000, scale: 0.04, pitch: Math.PI / 4 }, heights),
      town: frame(gl, { cx: 20000, cy: 20000, scale: 0.6, pitch: (55 * Math.PI) / 180 }, heights),
      close: frame(gl, { cx: 20000, cy: 20000, scale: 4, pitch: (70 * Math.PI) / 180 }, heights),
      turned: frame(gl, { cx: 20000, cy: 20000, scale: 2, pitch: 0, yaw: 0.5 }, heights),
    };
    const out: Record<string, { drawCalls: number; triangles: number }> = {};
    for (const [name, view] of Object.entries(views)) out[name] = settle(layer, view);
    // The first slices pay the compiler's warm-up; then a slice overruns its budget by one unit of work at most.
    const longest = Math.max(...slices.slice(3));
    expect(longest).toBeLessThan(16);
    console.info(
      `world buildings, 10000 houses on a 40 km map: ${Object.entries(out)
        .map(([name, s]) => `${name} ${s.drawCalls} draws ${Math.round(s.triangles)} triangles`)
        .join(', ')}; longest work slice ${longest.toFixed(1)} ms`,
    );
    expect(out.whole.triangles).toBeLessThan(100000);
    expect(out.whole.drawCalls).toBeLessThan(40);
    expect(out.town.triangles).toBeLessThan(out.close.triangles + 400000);
    // A turned top view is a tilted frame at rise 0: the houses lie as roofs on the flat terrain, never missing.
    expect(views.turned.camera.tilted).toBe(true);
    expect(views.turned.camera.rise).toBe(0);
    expect(out.turned.drawCalls).toBeGreaterThan(0);
  });
});

describe('world trees and water', () => {
  it('keeps trees off the drawn channel only, not off its banks', async () => {
    const { riverCover } = await import('../src/render/world/treesWater');
    // A 6 m river along y = 100, from x = 0 to 400.
    const cover = riverCover(new Float32Array([0, 100, 400, 100, 6, 6, 0, 0, 1]));
    expect(cover(200, 100)).toBe(true);
    expect(cover(200, 102.9)).toBe(true);
    expect(cover(200, 103.5)).toBe(false);
    expect(cover(200, 112)).toBe(false);
    expect(cover(450, 100)).toBe(false);
  });
});

describe('world trees cost', () => {
  it('stays bounded by the tree distance, not by the view', () => {
    const heights = relief(2400),
      inputs = stand(235, 110, 120),
      rows: string[] = [],
      out: Record<string, number> = {};
    for (const distance of [600, 1000, 1500]) {
      const gl = mockGl(),
        layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => distance, shown: () => true, invalidate: () => {} });
      const views = {
        close: { cx: 1200, cy: 1200, scale: 12, pitch: (70 * Math.PI) / 180, yaw: 0.3 },
        mid: { cx: 1200, cy: 1200, scale: 1, pitch: (55 * Math.PI) / 180, yaw: 0.3 },
        town: { cx: 1200, cy: 1200, scale: 0.3, pitch: Math.PI / 4, yaw: 0.3 },
        low: { cx: 1200, cy: 1200, scale: 2, pitch: 1.2, yaw: 0.3 },
      };
      for (const [name, v] of Object.entries(views)) {
        const view = frame(gl, v, heights);
        for (let pass = 0; pass < 6; pass++) {
          layer.draw(view);
          while (layer.work!(8, view));
        }
        layer.draw(view);
        const s = layer.stats!();
        out[`${name}@${distance}`] = s.triangles;
        rows.push(`${name}@${distance}: ${s.drawCalls} draws, ${s.instances} trees, ${Math.round(s.triangles / 1000)}k triangles (coarser ${s.coarser.toFixed(1)}, thinner ${s.thinner.toFixed(1)})`);
      }
    }
    console.info(`world trees cost: ${rows.join('; ')}`);
    for (const view of ['close', 'mid', 'town', 'low']) expect(out[`${view}@600`]).toBeLessThan(300000);
  });
});

describe('optional layer diagnostics', () => {
  it('keeps coarse-tile ages across consecutive top frames and tilted frames', () => {
    const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0 },
      diagnostics = new GroundDiagnostics(stats);
    diagnostics.ancestor(1, 10);
    diagnostics.topFrame(10);
    expect([stats.otherTier, stats.coarseAgeMs]).toEqual([1, 0]);
    diagnostics.ancestor(1, 50);
    diagnostics.ancestor(2, 50);
    diagnostics.topFrame(50);
    expect([stats.otherTier, stats.coarseAgeMs]).toEqual([2, 40]);
    diagnostics.tiltedFrame(3, 4);
    expect([stats.otherTier, stats.drapeOtherTier, stats.coarseAgeMs]).toEqual([3, 4, 40]);
    diagnostics.ancestor(1, 100);
    diagnostics.topFrame(100);
    expect([stats.otherTier, stats.coarseAgeMs]).toEqual([1, 90]);
    diagnostics.topFrame(120);
    expect([stats.otherTier, stats.coarseAgeMs]).toEqual([0, 0]);
  });

  it('enables all fields for committed test-mode probes and allows an explicit override', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('location', { search: '?test=1' });
    expect(layerDiagnosticsEnabled()).toBe(true);
    vi.stubGlobal('__muLayerDiagnostics', false);
    expect(layerDiagnosticsEnabled()).toBe(false);
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('__muLayerDiagnostics', true);
    expect(layerDiagnosticsEnabled()).toBe(true);
  });

  it('draws identical buildings and trees with detailed probes enabled or disabled', () => {
    const heights = relief(2400),
      scene = town(64, heights),
      inputs = stand(100, 90, 120);
    const samples = [false, true].map(enabled => {
      vi.stubGlobal('__muLayerDiagnostics', enabled);
      const gl = mockGl(),
        view = frame(gl, { cx: 700, cy: 700, scale: 8, pitch: 1, yaw: 0.2 }, heights);
      const buildings = createWorldBuildingsLayer(gl, { scene: () => scene, appearance: () => ({ style: 'cartographic', diagnostic: 'none' }), terrain: () => heights, invalidate: () => {} });
      const trees = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 600, shown: () => true, invalidate: () => {} });
      for (const layer of [buildings, trees]) {
        for (let pass = 0; pass < 3; pass++) {
          layer.draw(view);
          while (layer.work!(Infinity, view));
        }
        layer.draw(view);
        expect('sliceMs' in layer.stats!()).toBe(enabled);
      }
      const count = (s: LiveLayerStats) => [s.drawCalls, s.triangles, s.bytes, s.instances];
      return {
        buildings: count(buildings.stats!()),
        trees: count(trees.stats!()),
        draws: vi.mocked(gl.drawArrays).mock.calls.map(call => call.slice(1)),
        indexed: vi.mocked(gl.drawElements).mock.calls.map(([, n, type, offset]) => [n, type === gl.UNSIGNED_SHORT, offset]),
        instances: vi.mocked(gl.drawElementsInstanced).mock.calls.map(([, n, , offset, instances]) => [n, offset, instances]),
      };
    });
    expect(samples[0]).toEqual(samples[1]);
    expect(samples[0].buildings[0]).toBeGreaterThan(0);
    expect(samples[0].trees[0]).toBeGreaterThan(0);
  });
});

describe('building level cache', () => {
  it('uploads the same cell draws and vertex attributes across multiple mesh parts', () => {
    const heights = relief(2400),
      scene = town(80, heights, 12);
    const block = grouped(scene, heights)[0],
      gl = mockGl();
    const cache = new BuildingBlockCache(gl, () => undefined);
    const paint = worldPaint(scene, { style: 'cartographic', diagnostic: 'none' }, new TownAltitudes());
    const seat = worldSeat(heights, heights.exaggeration);
    cache.setBlocks([block]);
    cache.work(Infinity, 0, paint, seat, () => {});
    const levelIndex = block.levels - 1;
    const level = cache.slots[0].levels[levelIndex]!;
    expect(level.indexBytes).toBe(2);
    const attributes = new Float32Array(level.vertices * BUILDING_STRIDE),
      indices = new Uint16Array(level.vertices);
    const uploads = vi.mocked(gl.bufferSubData).mock.calls as unknown as [number, number, Float32Array | Uint16Array, number?, number?][];
    for (const [target, offset, source, start = 0, length = source.length] of uploads) {
      if (target === gl.ARRAY_BUFFER) attributes.set(source.subarray(start, start + length), offset / 4);
      else if (target === gl.ELEMENT_ARRAY_BUFFER) indices.set(source.subarray(start, start + length), offset / 2);
    }
    const reconstructed = new Float32Array(attributes.length);
    for (let i = 0; i < level.vertices; i++) {
      const at = indices[i] * BUILDING_STRIDE;
      reconstructed.set(attributes.subarray(at, at + BUILDING_STRIDE), i * BUILDING_STRIDE);
    }
    const original = new Float32Array(attributes.length);
    let written = 0;
    for (let cell = 0; cell < block.cells.length - 1; cell++) {
      expect(level.cellFirst[cell]).toBe(written / BUILDING_STRIDE);
      for (let from = block.cells[cell]; from < block.cells[cell + 1]; from += 8) {
        const data = blockPart(block, levelIndex, paint, seat, from, Math.min(from + 8, block.cells[cell + 1]));
        original.set(data, written);
        written += data.length;
      }
    }
    expect(written).toBe(original.length);
    expect(level.bytes).toBeLessThan(original.byteLength);
    expect(new Uint32Array(reconstructed.buffer)).toEqual(new Uint32Array(original.buffer));
  });

  it('preserves every vertex bit and triangle in meshes with signed zeros, different face paints and multiple slices', () => {
    const a = [1, 2, 3, 1, 0, 0, 0.25, 0.5, 0.75, 20];
    const b = [...a],
      c = [...a],
      hard = [...a],
      seam = [...a],
      raised = [...a];
    b[0] = 2;
    c[2] = 0;
    hard[4] = -0;
    seam[6] = 0.5;
    raised[9] = 21;
    const source = new Float32Array([...a, ...b, ...c, ...c, ...b, ...a, ...hard, ...seam, ...raised]);
    const words = new Uint32Array(source.buffer);
    for (const base of [0, 65534, 70000]) {
      const part = indexBuildingPart(source.slice(), base);
      const compact = new Uint32Array(part.data.buffer);
      expect(part.unique).toBeLessThan(part.indices.length);
      for (let i = 0; i < part.indices.length; i++) {
        const from = (part.indices[i] - base) * BUILDING_STRIDE;
        expect(compact.slice(from, from + BUILDING_STRIDE)).toEqual(words.slice(i * BUILDING_STRIDE, (i + 1) * BUILDING_STRIDE));
      }
      expect(new Uint32Array(expandBuildingPart(part).buffer)).toEqual(words);
    }
  });

  it('protects the current draw tick and stops background rebuilding after an eviction', () => {
    const heights = relief(2400),
      scene = town(4, heights),
      gl = mockGl(),
      cache = new BuildingBlockCache(gl, () => 1);
    const blocks = grouped(scene, heights),
      paint = worldPaint(scene, { style: 'cartographic', diagnostic: 'none' }, new TownAltitudes()),
      seat = worldSeat(heights, heights.exaggeration);
    cache.setBlocks(blocks);
    expect(cache.work(Infinity, 0, paint, seat, () => {})).toBe(false);
    expect(cache.bytes).toBeGreaterThan(1);
    const uploads = vi.mocked(gl.bufferSubData).mock.calls.length;
    expect(cache.work(Infinity, 1, paint, seat, () => {})).toBe(false);
    expect(cache.bytes).toBe(0);
    expect(cache.work(Infinity, 2, paint, seat, () => {})).toBe(false);
    expect(vi.mocked(gl.bufferSubData).mock.calls.length).toBe(uploads);
    // A visible request still builds after spilling; its draw tick protects the resulting level.
    const slot = cache.slots[0];
    slot.need = 1;
    slot.seen = 2;
    const built = vi.fn();
    expect(cache.work(Infinity, 2, paint, seat, built)).toBe(false);
    expect(built).toHaveBeenCalledOnce();
    expect(slot.levels[0]).toBeDefined();
    const deletes = vi.mocked(gl.deleteBuffer).mock.calls.length;
    cache.contextLost();
    expect(cache.bytes).toBe(0);
    expect(slot.levels.every(level => !level)).toBe(true);
    expect(vi.mocked(gl.deleteBuffer).mock.calls.length).toBe(deletes);
  });
});
