/**
 * The plants of the water's edge (bankPlants.ts) in a tilted frame: a volume layer (volumes.ts) after the trees, with their
 * inputs, switch and look. A block of the map is one instance buffer, built in work slices around the target and the eye
 * and kept; both silhouettes (a clump of blades, three crossed blades) draw prefixes of it, fewer plants as they get
 * smaller on screen, each sinking into the ground before it goes. A frame sets uniforms and issues draws only.
 */
import type { LiveFrame, LiveLayerStats } from '../live/contract';
import { treeLimits, type TreeInputs } from '../../ui/terrain3dTrees';
import type { Building3dScene } from '../urbanBuildingGeometry';
import { BANK_BLOCK, BANK_SIZE_M, BANK_STRIDE, bankBlockSteps, bankDrawShare, bankFullShare, type BankBlock } from './bankPlants';
import type { GroundShape } from './groundShape';
import type { TerrainHeights } from './heights';
import { treeBuildings } from './treesBuildings';
import type { WorldTreesOptions } from './treesLayer';
import { SATELLITE_TREES } from './treesShader';
import { ViewVolume, hazeDistance, startVolumeProgram, uniformsOf, volumeDepth, volumeDepthEnd, volumeProgramLinked, volumesDrawn, type VolumeLayer } from './volumes';

/** What the trees read of the map and its look: the plants follow the same. */
export type WorldBankPlantsOptions = Pick<WorldTreesOptions, 'inputs' | 'terrain' | 'buildings' | 'distance' | 'shown' | 'night' | 'palette' | 'invalidate'>;

/** Farthest plant (m), under the tree distance. */
const RANGE = 420;
const MAX_BLOCKS = 1024;
/** Blocks kept (empty ones included); past it those drawn least recently go. */
const KEPT_BLOCKS = 4096;
const TRIANGLE_BUDGET = 160000;

/** Blades as (seed, side, height share, direction): `count` blades of two segments, widened by the shader. */
function clump(count: number, segments: 1 | 2): { vertices: number[]; indices: number[] } {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let k = 0; k < count; k++) {
    const first = vertices.length / 4,
      seed = (k + 0.5) / count,
      angle = k * 2.399963;
    for (let t = 0; t < segments; t++) for (const side of [-1, 1]) vertices.push(seed, side, t / segments, angle);
    vertices.push(seed, 0, 1, angle);
    if (segments === 2) indices.push(first, first + 1, first + 3, first, first + 3, first + 2);
    const last = first + (segments - 1) * 2;
    indices.push(last, last + 1, first + segments * 2);
  }
  return { vertices, indices };
}
const MESHES = [clump(9, 2), clump(3, 1)];
const VERTICES = Float32Array.from(MESHES.flatMap(mesh => mesh.vertices));
const INDICES = Uint16Array.from([...MESHES[0].indices, ...MESHES[1].indices.map(index => index + MESHES[0].vertices.length / 4)]);
const INDEX_OFFSETS = [0, MESHES[0].indices.length * Uint16Array.BYTES_PER_ELEMENT];
const TRIANGLES = MESHES.map(mesh => mesh.indices.length / 3);

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 plant;  // block-local x, y, ground, height
layout(location=1) in vec4 shape;  // radius, 0 blades 1 tuft, phase, lean
layout(location=2) in vec4 tint;   // colour, snow
layout(location=3) in vec4 blade;  // seed, side, height share, direction
uniform mat4 uProjection;
uniform vec3 uBlock;    // origin relative to the target, terrain height offset
uniform vec2 uRelief;   // metres drawn per metre of ground, share of the relief shown
uniform vec4 uFade;     // eye on the ground (relative to the target), start and end of the range
uniform vec3 uPixel;    // CSS pixels per metre at a depth of one metre, pixels of height between which a plant stands
uniform vec3 uEye;
uniform float uFog;
uniform int uNight;
uniform int uRepaint;
uniform vec4 uRepaintLow;
uniform vec4 uRepaintHigh;
out vec3 colour;
void main(){
  vec2 place=uBlock.xy+plant.xy;
  float ground=plant.z*uRelief.x+uBlock.z;
  float metre=uPixel.x/max((uProjection*vec4(place,ground,1.)).w,.5);
  float stand=smoothstep(uPixel.y,uPixel.z,plant.w*metre)*(1.-smoothstep(uFade.z,uFade.w,min(distance(place,uFade.xy),length(place))));
  float t=blade.z,angle=blade.w+shape.z,u=fract(blade.x*7.31+shape.z),v=fract(blade.x*3.17+shape.w*5.3);
  vec2 dir=vec2(cos(angle),sin(angle)),across=vec2(-dir.y,dir.x);
  bool tuft=shape.y>.5;
  float h=plant.w*mix(.6,1.,u);
  // Blades rise from the foot of the clump and bow outwards; the twigs of a tuft spread at once.
  vec2 local=dir*shape.x*(mix(.12,.6,v)+(tuft?.75*t:.65*t*t))+vec2(cos(shape.z),sin(shape.z))*(.12*shape.w*h*t*t);
  // Never thinner than most of a pixel: a distant clump keeps its mass.
  float width=max(tuft?.09:.035,.4/metre)*(1.-.8*t*(tuft?.4:1.));
  local+=across*(blade.y*width);
  float y=h*(t-.1*t*t);
  vec3 pos=vec3(place+local*stand,ground+(y-.08)*stand*uRelief.y);
  gl_Position=stand<=0.?vec4(2.,2.,2.,1.):uProjection*vec4(pos,1.);
  vec3 base=tint.rgb;
  if(uRepaint==1)base=mix(uRepaintLow.rgb,uRepaintHigh.rgb,smoothstep(uRepaintLow.w,uRepaintHigh.w,dot(base,vec3(.30,.59,.11))));
  colour=mix(base*mix(.55,1.12,t)*mix(.88,1.1,v),vec3(.84,.88,.90),tint.a*t);
  if(uNight==1)colour*=vec3(.149,.196,.31);
  vec3 d=(pos-uEye)/uFog;
  colour=mix(colour,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),min(.62,1.-exp(-dot(d,d)*.11)));
}`;
const FS = `#version 300 es
precision mediump float;
in vec3 colour;
out vec4 color;
void main(){color=vec4(colour,1.);}`;
const UNIFORMS = ['uProjection', 'uBlock', 'uRelief', 'uFade', 'uPixel', 'uEye', 'uFog', 'uNight', 'uRepaint', 'uRepaintLow', 'uRepaintHigh'] as const;
type Program = { program: WebGLProgram; u: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>; vertices: WebGLBuffer; indices: WebGLBuffer };
interface Slot {
  revision: number;
  vao?: WebGLVertexArrayObject;
  buffer?: WebGLBuffer;
  count: number;
  bytes: number;
  used: number;
  /** Ground heights of its plants (m, before exaggeration). */
  low: number;
  high: number;
  /** First instance bound in the VAO. */
  first: number;
}

export function createWorldBankPlantsLayer(gl: WebGL2RenderingContext, options: WorldBankPlantsOptions): VolumeLayer {
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, bytes: 0 };
  const volume = new ViewVolume(),
    slots = new Map<number, Slot>();
  const wantKey = new Float64Array(MAX_BLOCKS),
    wantDepth = new Float64Array(MAX_BLOCKS),
    visible: Slot[] = [],
    visibleKey = new Float64Array(MAX_BLOCKS),
    visibleAll = new Float64Array(MAX_BLOCKS),
    visibleFull = new Float64Array(MAX_BLOCKS);
  let wanted = 0,
    tick = 0,
    bytes = 0,
    revision = 0;
  let program: Program | undefined, linking: WebGLProgram | undefined;
  let source: Omit<TreeInputs, 'height'> | undefined, heights: TerrainHeights | undefined, shape: GroundShape | undefined, scene: Building3dScene | undefined, inputs: TreeInputs | undefined;
  let building: { key: number; steps: Generator<void, BankBlock> } | undefined;

  const drop = (slot: Slot): void => {
    if (slot.buffer) gl.deleteBuffer(slot.buffer);
    if (slot.vao) gl.deleteVertexArray(slot.vao);
    bytes -= slot.bytes;
  };
  /** Another map, look, town or ground: the blocks are made again, the old ones showing until then. */
  const sync = (): void => {
    const nextSource = options.inputs(),
      nextHeights = options.terrain(),
      nextScene = options.buildings?.();
    if (nextSource === source && nextHeights === heights && nextHeights?.shape === shape && nextScene === scene) return;
    const otherMap = nextHeights !== heights;
    source = nextSource;
    heights = nextHeights;
    shape = nextHeights?.shape;
    scene = nextScene;
    revision++;
    building = undefined;
    if (otherMap) {
      for (const slot of slots.values()) drop(slot);
      slots.clear();
    }
    if (!nextSource || !nextHeights) {
      inputs = undefined;
      return;
    }
    const unit = nextHeights.exaggeration > 0 ? 1 / nextHeights.exaggeration : 1;
    inputs = { ...nextSource, height: (x, y) => nextHeights.heightAt(x, y) * unit };
  };
  const link = (): boolean => {
    if (program) return true;
    linking ??= startVolumeProgram(gl, VS, FS);
    if (!volumeProgramLinked(gl, linking, 'World bank plants')) return false;
    const vertices = gl.createBuffer()!,
      indices = gl.createBuffer()!;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, INDICES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    program = { program: linking, u: uniformsOf(gl, linking, UNIFORMS), vertices, indices };
    linking = undefined;
    options.invalidate();
    return true;
  };
  const upload = (key: number, block: BankBlock): void => {
    const previous = slots.get(key),
      slot: Slot = { revision, count: block.count, bytes: 0, used: tick, low: Infinity, high: -Infinity, first: 0 };
    for (let i = 0; i < block.data.length; i += BANK_STRIDE) {
      slot.low = Math.min(slot.low, block.data[i + 2]);
      slot.high = Math.max(slot.high, block.data[i + 2]);
    }
    if (block.count) {
      slot.vao = gl.createVertexArray()!;
      slot.buffer = gl.createBuffer()!;
      slot.bytes = block.data.byteLength;
      gl.bindVertexArray(slot.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, program!.indices);
      gl.bindBuffer(gl.ARRAY_BUFFER, program!.vertices);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, block.data, gl.STATIC_DRAW);
      for (let a = 0; a < 3; a++) {
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 4, gl.FLOAT, false, BANK_STRIDE * 4, a * 16);
        gl.vertexAttribDivisor(a, 1);
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bytes += slot.bytes;
    }
    if (previous) drop(previous);
    slots.set(key, slot);
  };
  const evict = (): void => {
    if (slots.size <= KEPT_BLOCKS) return;
    const stale = [...slots].filter(([, slot]) => slot.used < tick).sort((a, b) => a[1].used - b[1].used);
    for (const [key, slot] of stale.slice(0, slots.size - KEPT_BLOCKS)) {
      drop(slot);
      slots.delete(key);
    }
  };
  const standing = (frame: LiveFrame): boolean => volumesDrawn(frame.camera) && options.shown();
  /** Uniforms of a frame. */
  const bindFrame = (frame: LiveFrame, p: Program, relief: TerrainHeights, range: number): void => {
    const camera = frame.camera,
      u = p.u,
      tx = camera.target[0],
      ty = camera.target[1],
      palette = options.palette?.() ?? SATELLITE_TREES,
      repaint = palette.repaint;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(u.uProjection, false, camera.targetViewProjection);
    gl.uniform2f(u.uRelief, relief.exaggeration * camera.rise, camera.rise);
    gl.uniform4f(u.uFade, camera.eye[0] - tx, camera.eye[1] - ty, range * 0.7, range);
    gl.uniform3f(u.uPixel, camera.focal / frame.dpr, 1, 2.6);
    gl.uniform3f(u.uEye, camera.eye[0] - tx, camera.eye[1] - ty, camera.eye[2] - camera.target[2]);
    gl.uniform1f(u.uFog, hazeDistance(camera));
    gl.uniform1i(u.uNight, options.night?.() ? 1 : 0);
    gl.uniform1i(u.uRepaint, repaint ? 1 : 0);
    if (repaint) {
      gl.uniform4f(u.uRepaintLow, repaint.low[0], repaint.low[1], repaint.low[2], repaint.from);
      gl.uniform4f(u.uRepaintHigh, repaint.high[0], repaint.high[1], repaint.high[2], repaint.to);
    }
  };

  return {
    name: 'banks',
    tilts: true,
    tiltOnly: true,
    ready: () => true,
    work(budgetMs, frame) {
      if (!frame || !standing(frame)) return false;
      const started = performance.now();
      sync();
      const linked = link();
      if (!inputs) return !linked;
      if (!linked) return true;
      for (;;) {
        if (performance.now() - started > budgetMs) return true;
        if (!building) {
          let best = -1;
          for (let i = 0; i < wanted; i++) if (slots.get(wantKey[i])?.revision !== revision && (best < 0 || wantDepth[i] < wantDepth[best])) best = i;
          if (best < 0) {
            wanted = 0;
            evict();
            return false;
          }
          const key = wantKey[best];
          building = { key, steps: bankBlockSteps(inputs, key % 65536, Math.floor(key / 65536), treeBuildings(scene)) };
        }
        const step = building.steps.next();
        if (!step.done) continue;
        upload(building.key, step.value);
        building = undefined;
        if (step.value.count) options.invalidate();
      }
    },
    draw(frame) {
      const started = performance.now(),
        camera = frame.camera;
      tick++;
      stats.drawCalls = stats.triangles = stats.instances = 0;
      wanted = 0;
      if (standing(frame)) {
        sync();
        const relief = heights,
          range = Math.min(RANGE, treeLimits(options.distance()).far);
        if (inputs && relief) {
          const tx = camera.target[0],
            ty = camera.target[1],
            tz = camera.target[2],
            ex = camera.eye[0],
            ey = camera.eye[1],
            drawn = relief.exaggeration * camera.rise,
            focal = camera.focal / frame.dpr,
            closest = Math.max(camera.near, 0.5),
            last = Math.ceil(relief.width / BANK_BLOCK) - 1,
            first = (v: number): number => Math.max(0, Math.floor((v - range) / BANK_BLOCK)),
            end = (v: number): number => Math.min(last, Math.floor((v + range) / BANK_BLOCK)),
            gap = (minX: number, minY: number, x: number, y: number): number => Math.hypot(Math.max(minX - x, 0, x - minX - BANK_BLOCK), Math.max(minY - y, 0, y - minY - BANK_BLOCK));
          volume.set(camera);
          let count = 0,
            triangles = 0;
          // Two discs, around the target and around the eye's ground point: a block in both is met once.
          for (let disc = 0; disc < 2; disc++) {
            const cx = disc ? ex : tx,
              cy = disc ? ey : ty;
            for (let by = first(cy); by <= end(cy); by++)
              for (let bx = first(cx); bx <= end(cx); bx++) {
                const minX = bx * BANK_BLOCK,
                  minY = by * BANK_BLOCK;
                if (gap(minX, minY, cx, cy) > range || (disc && gap(minX, minY, tx, ty) <= range)) continue;
                const key = by * 65536 + bx,
                  slot = slots.get(key),
                  x = minX + BANK_BLOCK / 2 - tx,
                  y = minY + BANK_BLOCK / 2 - ty,
                  z = (slot?.count ? ((slot.low + slot.high) / 2) * drawn : relief.heightAt(minX + BANK_BLOCK / 2, minY + BANK_BLOCK / 2) * camera.rise) - tz,
                  radius = BANK_BLOCK * 0.75 + (slot?.count ? ((slot.high - slot.low) / 2) * drawn : 20 * camera.rise);
                if (!volume.sees(x, y, z, radius)) continue;
                const depth = Math.max(closest, volume.depth(x, y, z) - BANK_BLOCK * 0.35),
                  pixels = (BANK_SIZE_M * focal) / depth,
                  share = bankDrawShare(pixels);
                if (!share) continue;
                if (slot?.revision !== revision && wanted < MAX_BLOCKS) {
                  wantKey[wanted] = key;
                  wantDepth[wanted++] = depth;
                }
                if (!slot) continue;
                slot.used = tick;
                const all = Math.round(slot.count * share),
                  full = Math.round(all * bankFullShare(pixels));
                if (!all || count >= MAX_BLOCKS) continue;
                visible[count] = slot;
                visibleKey[count] = key;
                visibleAll[count] = all;
                visibleFull[count++] = full;
                triangles += full * TRIANGLES[0] + (all - full) * TRIANGLES[1];
              }
          }
          visible.length = count;
          if (count && program) {
            const kept = Math.min(1, TRIANGLE_BUDGET / triangles);
            bindFrame(frame, program, relief, range);
            volumeDepth(gl);
            for (let i = 0; i < count; i++) {
              const slot = visible[i],
                key = visibleKey[i],
                all = Math.floor(visibleAll[i] * kept),
                full = Math.floor(visibleFull[i] * kept);
              gl.uniform3f(program.u.uBlock, (key % 65536) * BANK_BLOCK - tx, Math.floor(key / 65536) * BANK_BLOCK - ty, -tz);
              gl.bindVertexArray(slot.vao!);
              for (let mesh = 0; mesh < 2; mesh++) {
                const from = mesh ? full : 0,
                  instances = (mesh ? all : full) - from;
                if (instances <= 0) continue;
                if (slot.first !== from) {
                  gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer!);
                  for (let a = 0; a < 3; a++) gl.vertexAttribPointer(a, 4, gl.FLOAT, false, BANK_STRIDE * 4, from * BANK_STRIDE * 4 + a * 16);
                  slot.first = from;
                }
                gl.drawElementsInstanced(gl.TRIANGLES, MESHES[mesh].indices.length, gl.UNSIGNED_SHORT, INDEX_OFFSETS[mesh], instances);
                stats.drawCalls++;
                stats.instances += instances;
                stats.triangles += instances * TRIANGLES[mesh];
              }
            }
            gl.bindVertexArray(null);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            volumeDepthEnd(gl);
          }
        }
      }
      stats.bytes = bytes;
      stats.ms = performance.now() - started;
    },
    invalidate() {
      source = undefined;
    },
    contextLost() {
      // Every handle is dead: forget them without deleting.
      slots.clear();
      bytes = 0;
      program = linking = undefined;
      visible.length = 0;
    },
    stats: () => stats,
    dispose() {
      for (const slot of slots.values()) drop(slot);
      slots.clear();
      if (program) {
        gl.deleteBuffer(program.vertices);
        gl.deleteBuffer(program.indices);
        gl.deleteProgram(program.program);
      }
      if (linking) gl.deleteProgram(linking);
      program = linking = undefined;
      source = heights = inputs = scene = undefined;
    },
  };
}
