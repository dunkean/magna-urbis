import { describe, expect, it, vi } from 'vitest';
import type { PlacementBatch, PlacedBuilding } from '../../rust/bridge/urbanArchitecture';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import { city3dBuildings, city3dBuildingsSteps } from '../src/render/city3d/display';
import type { LiveFrame } from '../src/render/live/contract';
import { BUILDING_BLOCK, BlockGrouping, blockLevel, blockPart, worldPaint, worldSeat } from '../src/render/world/buildingsBlocks';
import { createWorldBuildingsLayer } from '../src/render/world/buildingsLayer';
import { BUILDING_STRIDE } from '../src/render/world/buildingsMesh';
import { createFrameCamera, frameCamera } from '../src/render/world/camera';
import { TerrainHeights } from '../src/render/world/heights';
import { TREES_BLOCK, treeBlockSteps, treeDrawCount, treeLathe } from '../src/render/world/treesBlocks';
import { createWorldTreesLayer } from '../src/render/world/treesLayer';
import { TREE_LATHES, latheVertices } from '../src/render/world/treesShader';
import type { View } from '../src/render/view';
import { buildNearTrees, TREE_STRIDE, TREE_VERTICES, treeLimits, type TreeInputs } from '../src/ui/terrain3dTrees';

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
      paint = worldPaint(scene, { style: 'cartographic', diagnostic: 'none' }),
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

  it('switches to the overview below 7 px and back above 10, as the 3D view', () => {
    const block = grouped(town(4, relief(4000)), relief(4000))[0];
    expect(blockLevel(block, 20, 0)).toBe(0);
    expect(blockLevel(block, 6, 0)).toBe(1);
    expect(blockLevel(block, 8, 1)).toBe(1);
    expect(blockLevel(block, 11, 1)).toBe(0);
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
    const drawCalls = vi.mocked(gl.drawArrays).mock.calls.length;
    layer.draw(tilted);
    const stats = layer.stats!();
    expect(vi.mocked(gl.drawArrays).mock.calls.length - drawCalls).toBe(stats.drawCalls);
    expect(stats.drawCalls).toBeGreaterThan(0);
    expect(layer.restExact!(tilted)).toBe(true);
    // Every work call stays a slice (the budget was 8 ms; the first ones pay the compiler's warm-up).
    expect(stats.sliceMs).toBeLessThan(40);
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
        const block = step.value;
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

  it('draws coarser lathes and fewer trees with the distance', () => {
    expect(latheVertices(TREE_LATHES[0])).toBe(TREE_VERTICES);
    expect(TREE_LATHES.map(latheVertices)).toEqual([480, 180, 96]);
    const limits = treeLimits(600);
    expect([0, 150, 250, 500, 600, 601].map(d => treeLathe(d, limits))).toEqual([0, 0, 1, 2, 2, -1]);
    const wide = treeLimits(1500);
    expect(treeDrawCount(500, wide.full / 2, wide)).toBe(500);
    expect(treeDrawCount(500, wide.full * 2, wide)).toBe(125);
  });

  it('draws a tilted frame from the blocks around the eye, built once', () => {
    const heights = relief(2400),
      inputs = stand(220, 100, 120),
      gl = mockGl(),
      layer = createWorldTreesLayer(gl, { inputs: () => inputs, terrain: () => heights, distance: () => 600, invalidate: () => {} });
    const view = { cx: 1200, cy: 1400, scale: 2, pitch: 1.1, yaw: 0.3 },
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
    expect(layer.restExact!(tilted)).toBe(true);
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
