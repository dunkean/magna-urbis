/**
 * The Underdark's roof and mushrooms in a tilted frame (cave.ts): a volume layer (volumes.ts) drawn after the terrain,
 * the town and before the names, with depth against what was drawn before it.
 *
 * The roof is the lid of the cave's section model (render/underdarkCavern.ts cavernRoofMesh): one mesh per map, cut
 * away around the target of the orbit camera so the chambers show, whole overhead for a walking or flying eye. The
 * mushrooms are the instance stream of ui/terrain3dFungi.ts (shared with City Bench's separate 3D view), built around
 * the target in work slices and built again when the target has moved a third of the near radius.
 *
 * Both draw with the programs of those modules, whose space is east, up, south: the frame's projection is given to them
 * with its up and south columns exchanged, and positions relative to the target as they expect.
 *
 * Cost: a frame issues one draw for the roof and at most three for the mushrooms, from buffers filled in work slices.
 * Outside the Underdark the layer holds nothing and draws nothing.
 */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { CAVERN_ROOF_GLSL, cavernRoofMesh, type CavernField } from '../underdarkCavern';
import { FUNGUS_3D_GLSL, FUNGUS_FAR, FUNGUS_LOD_VERTICES, FUNGUS_NEAR, FUNGUS_STRIDE, buildFungiSteps, type FungusStream } from '../../ui/terrain3dFungi';
import { caveFogRange, caveLamps, caveReveal, type WorldCave } from './cave';
import type { TerrainHeights } from './heights';
import { startVolumeProgram, uniformsOf, volumeProgramLinked, volumesDrawn, type VolumeLayer } from './volumes';

export interface WorldCaveOptions {
  /** The Underdark of the map on display; undefined: the layer draws nothing. Compared by identity. */
  cave(): WorldCave | undefined;
  /** The relief of the map, the draped ground's (the cave's section model). */
  terrain(): TerrainHeights | undefined;
  /** Asks for a frame (the roof or a mushroom stream arrived). */
  invalidate(): void;
}

const ROOF_UNIFORMS = ['matrix', 'cameraOrigin', 'exaggeration', 'eye', 'uCavern', 'uReveal', 'uTownGlow[0]', 'uTownGlowCount'] as const;
const FUNGUS_UNIFORMS = [...ROOF_UNIFORMS, 'fungusFade', 'fungusLod'] as const;
type Program<N extends string> = { program: WebGLProgram; u: Record<N, WebGLUniformLocation | null> };
/** Floats of a roof vertex: x, height, y, rock, openness. */
const ROOF_STRIDE = 20;

export function createWorldCaveLayer(gl: WebGL2RenderingContext, options: WorldCaveOptions): VolumeLayer {
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, mushrooms: 0 };
  let roofLinking: WebGLProgram | undefined, fungusLinking: WebGLProgram | undefined;
  let roof: Program<(typeof ROOF_UNIFORMS)[number]> | undefined, fungus: Program<(typeof FUNGUS_UNIFORMS)[number]> | undefined;
  /** The roof mesh on the GPU and the field it is the lid of. */
  let roofVao: WebGLVertexArrayObject | undefined, roofVertices: WebGLBuffer | undefined, roofIndices: WebGLBuffer | undefined;
  let roofField: CavernField | undefined,
    roofCount = 0;
  /** The mushrooms on the GPU: their count per level of detail, and what they were built for. */
  let fungusVao: WebGLVertexArrayObject | undefined, fungusBuffer: WebGLBuffer | undefined;
  let fungusCount = 0,
    tiers: [number, number, number] = [0, 0, 0],
    streamKey = '',
    streamCave: WorldCave | undefined,
    streamHeights: TerrainHeights | undefined;
  /** The stream being built. */
  let job: { steps: Generator<void, FungusStream>; key: string; cave: WorldCave; heights: TerrainHeights } | undefined;
  const matrix = new Float32Array(16),
    lamps = new Float32Array(64),
    fog: [number, number] = [0, 1],
    reveal: [number, number, number, number] = [0, 0, 0, 1];

  const link = (): boolean => {
    roofLinking ??= startVolumeProgram(gl, CAVERN_ROOF_GLSL.vertex, CAVERN_ROOF_GLSL.fragment);
    fungusLinking ??= startVolumeProgram(gl, FUNGUS_3D_GLSL.vertex, FUNGUS_3D_GLSL.fragment);
    if (!roof && volumeProgramLinked(gl, roofLinking, 'cave roof')) roof = { program: roofLinking, u: uniformsOf(gl, roofLinking, ROOF_UNIFORMS) };
    if (!fungus && volumeProgramLinked(gl, fungusLinking, 'cave mushrooms')) fungus = { program: fungusLinking, u: uniformsOf(gl, fungusLinking, FUNGUS_UNIFORMS) };
    return !!roof && !!fungus;
  };

  const uploadRoof = (field: CavernField): void => {
    const mesh = cavernRoofMesh(field);
    roofVao ??= gl.createVertexArray()!;
    roofVertices ??= gl.createBuffer()!;
    roofIndices ??= gl.createBuffer()!;
    gl.bindVertexArray(roofVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, roofVertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, ROOF_STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ROOF_STRIDE, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, roofIndices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    roofField = field;
    roofCount = mesh.indices.length;
  };

  const installFungi = (stream: FungusStream): void => {
    fungusCount = stream.values.length / FUNGUS_STRIDE;
    tiers = stream.counts;
    stats.mushrooms = fungusCount;
    if (!fungusCount) return;
    fungusVao ??= gl.createVertexArray()!;
    fungusBuffer ??= gl.createBuffer()!;
    gl.bindVertexArray(fungusVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fungusBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, stream.values, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, i * 16);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  /** The mushroom stream of the frame's target: started when the target, the cave or the relief changed, advanced
   * within the budget, installed when done. True while one is being built. */
  const growFungi = (cave: WorldCave, heights: TerrainHeights, frame: LiveFrame, started: number, budgetMs: number): boolean => {
    if (job && (job.cave !== cave || job.heights !== heights)) job = undefined;
    const x = frame.camera.target[0],
      y = frame.camera.target[1],
      step = FUNGUS_NEAR / 3,
      key = `${Math.round(x / step)}|${Math.round(y / step)}|${cave.settings.fungi}`;
    if (!job) {
      if (key === streamKey && streamCave === cave && streamHeights === heights) return false;
      // Heights of the stream are metres of the map: the shader applies the exaggeration and the rise.
      const unit = heights.exaggeration > 0 ? 1 / heights.exaggeration : 1;
      job = {
        key,
        cave,
        heights,
        steps: buildFungiSteps(
          {
            seed: cave.seed,
            cavern: cave.field,
            abundance: cave.settings.fungi,
            towns: cave.lamps.length ? cave.lamps : undefined,
            farms: cave.farms,
            craftedBeds: cave.craftedBeds,
            occupation: cave.occupation,
            raw: cave.raw,
            height: (px, py) => heights.heightAt(px, py) * unit,
            water: cave.water,
          },
          { x, y },
        ),
      };
    }
    do {
      const step = job.steps.next();
      if (step.done) {
        installFungi(step.value);
        streamKey = job.key;
        streamCave = cave;
        streamHeights = heights;
        job = undefined;
        options.invalidate();
        return false;
      }
    } while (performance.now() - started < budgetMs);
    return true;
  };

  const forget = (): void => {
    roofLinking = fungusLinking = undefined;
    roof = fungus = undefined;
    roofVao = roofVertices = roofIndices = undefined;
    fungusVao = fungusBuffer = undefined;
    roofField = streamCave = undefined;
    streamHeights = undefined;
    roofCount = fungusCount = 0;
    streamKey = '';
    job = undefined;
  };

  return {
    name: 'cave',
    tilts: true,
    tiltOnly: true,
    ready: () => true,
    work(budgetMs, frame) {
      const started = performance.now(),
        cave = options.cave(),
        heights = options.terrain();
      if (!cave || !heights) {
        job = undefined;
        return false;
      }
      const linked = link();
      if (roofField !== cave.field) {
        uploadRoof(cave.field);
        options.invalidate();
      }
      // Mushrooms grow around the target of a tilted view; the top view shows the painted ones.
      if (!frame || !volumesDrawn(frame.camera) || !(cave.settings.fungi > 0)) return !linked;
      return growFungi(cave, heights, frame, started, budgetMs) || !linked;
    },
    draw(frame) {
      const started = performance.now(),
        camera = frame.camera,
        cave = options.cave(),
        heights = options.terrain();
      stats.drawCalls = stats.triangles = 0;
      if (!volumesDrawn(camera) || !cave || !heights) return;
      const drawRoof = !!roof && roofCount > 0 && roofField === cave.field,
        drawFungi = !!fungus && fungusCount > 0 && streamCave === cave && streamHeights === heights && cave.settings.fungi > 0;
      if (!drawRoof && !drawFungi) return;
      const tx = camera.target[0],
        ty = camera.target[1],
        tz = camera.target[2],
        m = camera.targetViewProjection;
      // The programs' space is (east, up, south) relative to the target: the up and south columns change places.
      for (let i = 0; i < 4; i++) {
        matrix[i] = m[i];
        matrix[4 + i] = m[8 + i];
        matrix[8 + i] = m[4 + i];
        matrix[12 + i] = m[12 + i];
      }
      caveFogRange(cave, camera, heights.exaggeration, fog);
      caveReveal(cave, camera, heights.exaggeration, reveal);
      const lit = caveLamps(cave, 0, 0, lamps),
        drawn = heights.exaggeration * camera.rise;
      const common = (u: Record<(typeof ROOF_UNIFORMS)[number], WebGLUniformLocation | null>): void => {
        gl.uniformMatrix4fv(u.matrix, false, matrix);
        gl.uniform3f(u.cameraOrigin, tx, tz, ty);
        gl.uniform1f(u.exaggeration, drawn);
        gl.uniform3f(u.eye, camera.eye[0] - tx, camera.eye[2] - tz, camera.eye[1] - ty);
        gl.uniform4f(u.uCavern, cave.field.base, cave.settings.darkness, fog[0], fog[1]);
        gl.uniform4fv(u['uTownGlow[0]'], lamps);
        gl.uniform1i(u.uTownGlowCount, lit);
      };
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      if (drawRoof) {
        gl.useProgram(roof!.program);
        gl.bindVertexArray(roofVao!);
        common(roof!.u);
        gl.uniform4f(roof!.u.uReveal, reveal[0], reveal[1], reveal[2], reveal[3]);
        gl.drawElements(gl.TRIANGLES, roofCount, gl.UNSIGNED_INT, 0);
        stats.drawCalls++;
        stats.triangles += roofCount / 3;
      }
      if (drawFungi) {
        const u = fungus!.u;
        gl.useProgram(fungus!.program);
        gl.bindVertexArray(fungusVao!);
        common(u);
        gl.uniform4f(u.fungusFade, tx, ty, FUNGUS_FAR * 0.8, FUNGUS_FAR);
        // Stalactites go with the roof where it is cut away.
        if (drawRoof) gl.uniform4f(u.uReveal, reveal[0], reveal[1], reveal[2], reveal[3]);
        else gl.uniform4f(u.uReveal, 0, 0, 0, 1);
        // One draw per level of detail: the attributes start at the level's first instance (no base instance in WebGL2).
        gl.bindBuffer(gl.ARRAY_BUFFER, fungusBuffer!);
        let first = 0;
        for (let lod = 0; lod < 3; lod++) {
          const count = tiers[lod];
          if (!count) continue;
          for (let i = 0; i < 3; i++) gl.vertexAttribPointer(i, 4, gl.FLOAT, false, FUNGUS_STRIDE * 4, first * FUNGUS_STRIDE * 4 + i * 16);
          gl.uniform1i(u.fungusLod, lod);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, FUNGUS_LOD_VERTICES[lod], count);
          stats.drawCalls++;
          stats.triangles += (FUNGUS_LOD_VERTICES[lod] / 3) * count;
          first += count;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
      gl.bindVertexArray(null);
      gl.useProgram(null);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      stats.ms = performance.now() - started;
    },
    contextLost: forget,
    stats: () => stats,
    dispose() {
      if (roof) gl.deleteProgram(roof.program);
      else if (roofLinking) gl.deleteProgram(roofLinking);
      if (fungus) gl.deleteProgram(fungus.program);
      else if (fungusLinking) gl.deleteProgram(fungusLinking);
      if (roofVao) gl.deleteVertexArray(roofVao);
      if (roofVertices) gl.deleteBuffer(roofVertices);
      if (roofIndices) gl.deleteBuffer(roofIndices);
      if (fungusVao) gl.deleteVertexArray(fungusVao);
      if (fungusBuffer) gl.deleteBuffer(fungusBuffer);
      forget();
    },
  };
}
