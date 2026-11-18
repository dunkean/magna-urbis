/**
 * Near-tree streaming, water exclusion and drawing, called by terrain frame/input hooks.
 * Reads/writes: Reads ground/forest inputs, camera and water masks; writes stream keys/jobs, instance counts/buffers and water revisions on the supplied context.
 */
import { renderV2ZoneUniform } from '../../../../rust/bridge/terrainRenderV2Zones';
import { DEFAULT_TERRAIN_LIGHTING, terrainLights } from '../../render/terrainLighting';
import { buildNearTrees, buildNearTreesSteps, clampTreeDistance, TREE_3D_GLSL, TREE_STRIDE, TREE_VERTICES, treeLimits, type TreeInputs } from '../terrain3dTrees';
import { Terrain3dTileContent, FrameGeometry } from './terrainTypes';
import { program } from './webglProgram';
import type { Terrain3dContext } from './terrainContext';

/** Inputs of the satellite near trees, or undefined when the view paints its forest only. */
export function treeInputs(context: Terrain3dContext): TreeInputs | undefined {
  const g = context.groundSettings,
    field = context.forestField;
  if (!g || !field || context.useMapShader || !((g.renderV2 ?? 0) > 0) || g.forestBrushes) return undefined; // satellite-2 (paperMap) shares the satellite near trees
  return {
    field,
    occupation: context.occupation?.data,
    seed: g.seed >>> 0,
    climate: g.climate,
    renderV2: g.renderV2 ?? 0,
    zone: renderV2ZoneUniform(g.climateZone),
    season: g.v2Season ?? 0.5,
    crownSnow: g.v2Calendar?.crownSnow,
    climateZone: g.climateZone,
    calendar: g.v2Calendar,
    height: (x, y) => context.heightAt(x, y),
    water: (x, y) => context.waterAt(x, y),
  };
}

/** Displayed water cover at a point from the finest tile water mask holding it (nearest texel). */
export function waterAt(context: Terrain3dContext, x: number, y: number): number {
  let best: NonNullable<Terrain3dTileContent['water']> | undefined;
  for (const mask of context.waterMasks.values()) {
    const w = mask.water;
    if (w && x >= w.x && y >= w.y && x < w.x + w.width && y < w.y + w.width && (!best || w.width < best.width)) best = w;
  }
  if (!best) return 0;
  const i = Math.min(best.n - 1, Math.floor(((x - best.x) / best.width) * best.n)),
    j = Math.min(best.n - 1, Math.floor(((y - best.y) / best.width) * best.n));
  return best.alpha[j * best.n + i] / 255;
}

/** A tile water mask came or went: the trees are rebuilt only when it overlaps their area (waterAt reads it there). */
export function waterMaskChanged(context: Terrain3dContext, x: number, y: number, width: number): void {
  const a = context.treeArea;
  if (!a) return;
  const dx = Math.max(x - a.x, 0, a.x - x - width),
    dy = Math.max(y - a.y, 0, a.y - y - width);
  if (dx * dx + dy * dy <= a.r * a.r) ++context.treeWaterRevision;
}

/** Rebuilds the near-tree instances once the eye has moved about 40 m or turned, or the inputs changed. The ground
 * LOD is not an input: tree heights read the canonical surface (heightAt), whose changes clear the patches and key. */
export function prepareTrees(context: Terrain3dContext, frame: FrameGeometry): void {
  context.updateTrees(frame);
  // Test probe (forest flicker): drawn tree count and stream starts per frame, when a page installs the array.
  const trace = (globalThis as { magnaTreeTrace?: number[][] }).magnaTreeTrace;
  trace?.push([performance.now(), context.treesShown() ? context.treeCount : 0, context.treeStreams]);
}

export function updateTrees(context: Terrain3dContext, frame: FrameGeometry): void {
  // Hidden trees keep their stream and key: switching them back on reuses it until the eye moves.
  if (!context.nearTrees) return;
  const inputs = context.treeInputs(),
    c = context.camera;
  if (!inputs) {
    context.treeCount = 0;
    context.treeKey = '';
    context.treeComplete = false;
    return;
  }
  const x = c.x + frame.eye[0],
    y = c.y + frame.eye[2],
    fl = Math.hypot(frame.forward[0], frame.forward[2]) || 1;
  const lift = (frame.targetHeight + frame.eye[1]) / c.exaggeration - (context.heightAt(x, y) ?? 0);
  const key =
    lift > treeLimits(context.treeDistance).far
      ? 'high'
      : [
          context.treeDistance,
          Math.round(x / 40),
          Math.round(y / 40),
          Math.round(c.yaw / 0.25),
          inputs.field.key,
          inputs.occupation?.key,
          inputs.occupation?.detail?.key,
          context.treeWaterRevision,
          inputs.season,
          inputs.crownSnow,
          inputs.seed,
          inputs.climateZone,
          JSON.stringify(inputs.calendar ?? {}),
        ].join('|');
  if (key === context.treeKey && (!context.fullQualityCapture || context.treeReadyKey === key)) return;
  // One live stream at a time: a stream in flight finishes and is shown, then the latest key starts (restarting on
  // every 40 m or tile change never finished a stream while the camera moved).
  if (key !== 'high' && !context.fullQualityCapture && context.treeJobs > 0) return;
  context.treeKey = key;
  if (key === 'high') {
    context.treeCount = 0;
    context.treeReadyKey = key;
    context.treeComplete = false;
    return;
  }
  const view = { x, y, forwardX: frame.forward[0] / fl, forwardY: frame.forward[2] / fl, distance: context.treeDistance };
  // Key cells are 40 m: masks within this radius of the stream's eye can reach a tree of this stream or the next.
  context.treeArea = { x, y, r: treeLimits(context.treeDistance).far + 60 };
  const install = (values: Float32Array): void => {
    context.treeCount = values.length / TREE_STRIDE;
    context.treeReadyKey = key;
    context.treeComplete = true;
    (globalThis as { magnaNearTrees?: number }).magnaNearTrees = context.treeCount;
    if (context.treeCount) context.uploadTrees(values);
  };
  // Capture uses the exact stream immediately, independent of a live queue's progress.
  if (context.fullQualityCapture) {
    install(buildNearTrees(inputs, view));
    return;
  }
  const epoch = context.epoch,
    current = (): boolean => !context.captureMode && !context.disposed && epoch === context.epoch && context.treeKey !== 'high' && context.treeKey !== '';
  // Nearest blocks first: while no finished stream is shown, a partial stream replaces a smaller one, so trees grow
  // outward from the eye. A finished stream stays drawn whole until its replacement is finished (no blocks dropped).
  const partial = (values: Float32Array): void => {
    if (!current() || context.treeComplete || values.length / TREE_STRIDE <= context.treeCount) return;
    context.treeCount = values.length / TREE_STRIDE;
    if (context.treeCount) {
      context.uploadTrees(values);
      context.request();
    }
  };
  context.treeJobs++;
  context.treeStreams++;
  void context.preparation
    .run(buildNearTreesSteps(inputs, view, partial), current, 1e15)
    .then(values => {
      install(values);
      context.request();
    })
    .catch(error => {
      if (error?.name !== 'AbortError') console.warn('Terrain tree preparation:', error);
    })
    .finally(() => {
      context.treeJobs--;
    });
}

export function uploadTrees(context: Terrain3dContext, values: Float32Array): void {
  const gl = context.gl;
  context.treeProgram ??= program(gl, TREE_3D_GLSL.vertex, TREE_3D_GLSL.fragment);
  context.treeVao ??= gl.createVertexArray()!;
  context.treeBuffer ??= gl.createBuffer()!;
  gl.bindVertexArray(context.treeVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, context.treeBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, TREE_STRIDE * 4, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.bindVertexArray(null);
}

/** uForestTrees of the ground shader: eye xy and the fade radii, w = 0 without trees. */
export function forestTreesUniform(context: Terrain3dContext, frame: FrameGeometry): [number, number, number, number] {
  const limits = treeLimits(context.treeDistance);
  return [context.camera.x + frame.eye[0], context.camera.y + frame.eye[2], limits.near, context.treesShown() ? limits.far : 0];
}

/** Whether near trees are drawn this frame. */
export function treesShown(context: Terrain3dContext): boolean {
  return context.nearTrees && context.treeCount > 0;
}

/** The 3D view's "3D trees" switch: built lazily on first use, then only hidden or shown. */
export function setNearTrees(context: Terrain3dContext, enabled: boolean): void {
  if (context.nearTrees === enabled) return;
  context.nearTrees = enabled;
  context.request();
}

/** The 3D view's "tree distance" slider (m): only the tree layer is rebuilt, around the eye, nearest trees first. */
export function setTreeDistance(context: Terrain3dContext, metres: number): void {
  const distance = clampTreeDistance(metres);
  if (context.treeDistance === distance) return;
  context.treeDistance = distance;
  context.request();
}

export function treeLight(context: Terrain3dContext): [number, number, number] {
  const lights = terrainLights((context.groundSettings ?? context.forestSettings)?.lighting ?? DEFAULT_TERRAIN_LIGHTING);
  return [lights.primary[0], lights.primary[2], lights.primary[1]];
}

export function drawTrees(context: Terrain3dContext, frame: FrameGeometry): void {
  const gl = context.gl,
    p = context.treeProgram,
    c = context.camera;
  if (!p || !context.treesShown() || context.groundSettings?.underdark) return;
  gl.useProgram(p);
  gl.bindVertexArray(context.treeVao!);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.uniformMatrix4fv(context.uniform('matrix', p), false, frame.matrix);
  gl.uniform3f(context.uniform('cameraOrigin', p), c.x, frame.targetHeight, c.y);
  gl.uniform1f(context.uniform('exaggeration', p), c.exaggeration);
  gl.uniform4fv(context.uniform('treeFade', p), context.forestTreesUniform(frame));
  gl.uniform3fv(context.uniform('eye', p), frame.eye);
  gl.uniform3fv(context.uniform('treeLight', p), context.treeLight());
  gl.uniform1f(context.uniform('fogDistance', p), context.fogDistance());
  gl.uniform1i(context.uniform('uNight', p), +(context.lookSettings.ambience === 'night'));
  gl.drawArraysInstanced(gl.TRIANGLES, 0, TREE_VERTICES, context.treeCount);
  gl.bindVertexArray(null);
}
