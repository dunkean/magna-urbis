/** Retained text in the compositor context. Work owns rasterization/uploads; draw only submits atlas batches. */
import { fontString } from '../labelStyles';
import type { GlyphPos, PlacedMapLabel } from '../mapLabels';
import type { LiveLayer, LiveLayerStats, LiveTextOptions, LiveTextPlacement } from './contract';
import { GLYPH_ATLAS_SIZE, GlyphAtlas, type AtlasSprite, type TextColour } from './glyphAtlas';

type PlacementView = Pick<LiveTextPlacement, 'view' | 'w' | 'h'>;
export interface LiveGlyphAnchor { worldX: number; worldY: number; offsetX: number; offsetY: number; angle: number }

/** Mirrors CanvasRenderer.movedPlacement, including a symbol whose screen position differs from label.x/y. */
export function liveGlyphAnchor(source: PlacementView, placed: PlacedMapLabel, glyph: GlyphPos,
  followWorld = !!placed.path || placed.glyphs.some(g => g.a !== 0)): LiveGlyphAnchor {
  const { view, w, h } = source;
  if (followWorld) return {
    worldX: (glyph.x - w / 2) / view.scale + view.cx, worldY: (glyph.y - h / 2) / view.scale + view.cy,
    offsetX: 0, offsetY: 0, angle: glyph.a,
  };
  const ax = placed.symbol?.x ?? (placed.label.x - view.cx) * view.scale + w / 2;
  const ay = placed.symbol?.y ?? (placed.label.y - view.cy) * view.scale + h / 2;
  return {
    worldX: placed.symbol ? (ax - w / 2) / view.scale + view.cx : placed.label.x,
    worldY: placed.symbol ? (ay - h / 2) / view.scale + view.cy : placed.label.y,
    offsetX: glyph.x - ax, offsetY: glyph.y - ay, angle: glyph.a,
  };
}

export function liveSymbolAnchor(source: PlacementView, symbol: NonNullable<PlacedMapLabel['symbol']>): LiveGlyphAnchor {
  return {
    worldX: (symbol.x - source.w / 2) / source.view.scale + source.view.cx,
    worldY: (symbol.y - source.h / 2) / source.view.scale + source.view.cy,
    offsetX: 0, offsetY: 0, angle: 0,
  };
}

const INSTANCE_FLOATS = 17;
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aWorld;
layout(location=1) in vec2 aOffset;
layout(location=2) in float aAngle;
layout(location=3) in vec4 aBounds;
layout(location=4) in vec4 aUV;
layout(location=5) in vec4 aColour;
uniform vec4 uWorldToPixel;
uniform vec2 uViewport;
uniform float uDpr;
out vec2 vUV;
out vec4 vColour;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 local = aBounds.xy + corner * aBounds.zw;
  float c = cos(aAngle), s = sin(aAngle);
  vec2 rotated = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 px = aWorld * uWorldToPixel.xy + uWorldToPixel.zw + (aOffset + rotated) * uDpr;
  gl_Position = vec4(px.x * 2.0 / uViewport.x - 1.0, 1.0 - px.y * 2.0 / uViewport.y, 0.0, 1.0);
  vUV = aUV.xy + corner * aUV.zw;
  vColour = aColour;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUV;
in vec4 vColour;
out vec4 outColour;
void main() { outColour = vColour * texture(uAtlas, vUV).a; }
`;

interface TextProgram {
  handle: WebGLProgram;
  world: WebGLUniformLocation | null; viewport: WebGLUniformLocation | null;
  dpr: WebGLUniformLocation | null; atlas: WebGLUniformLocation | null;
}
interface CpuBatch { page: number; values: number[] }
interface GpuBatch { page: number; count: number; vao: WebGLVertexArrayObject; buffer: WebGLBuffer }
interface LabelWork {
  placed: PlacedMapLabel; followWorld: boolean; halo: number; fill: TextColour; stroke: TextColour;
  glyph: number; pass: 0 | 1; symbolDone: boolean;
}
interface TextWork {
  source: LiveTextPlacement; dpr: number; label: number; current?: LabelWork;
  passes: Map<number, number[]>[];
  queue?: CpuBatch[]; upload: number; batches: GpuBatch[];
  glyphs: number; symbols: number;
}

function createProgram(gl: WebGL2RenderingContext): TextProgram {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw new Error('Cannot allocate a live text shader');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Live text shader: ${gl.getShaderInfoLog(shader)}`);
    }
    program = gl.createProgram();
    if (!program) throw new Error('Cannot allocate a live text program');
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Live text link: ${gl.getProgramInfoLog(program)}`);
    return {
      handle: program, world: gl.getUniformLocation(program, 'uWorldToPixel'), viewport: gl.getUniformLocation(program, 'uViewport'),
      dpr: gl.getUniformLocation(program, 'uDpr'), atlas: gl.getUniformLocation(program, 'uAtlas'),
    };
  } catch (error) { if (program) gl.deleteProgram(program); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

function uploadBatch(gl: WebGL2RenderingContext, cpu: CpuBatch): GpuBatch {
  const vao = gl.createVertexArray(), buffer = gl.createBuffer();
  if (!vao || !buffer) {
    if (vao) gl.deleteVertexArray(vao);
    if (buffer) gl.deleteBuffer(buffer);
    throw new Error('Cannot allocate live text instances');
  }
  try {
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cpu.values), gl.STATIC_DRAW);
    const sizes = [2, 2, 1, 4, 4, 4];
    let offset = 0;
    for (let attribute = 0; attribute < sizes.length; attribute++) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, sizes[attribute], gl.FLOAT, false, INSTANCE_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(attribute, 1); offset += sizes[attribute];
    }
    gl.bindVertexArray(null);
    return { vao, buffer, page: cpu.page, count: cpu.values.length / INSTANCE_FLOATS };
  } catch (error) { gl.deleteVertexArray(vao); gl.deleteBuffer(buffer); throw error; }
}

function appendInstance(pass: Map<number, number[]>, sprite: AtlasSprite, anchor: LiveGlyphAnchor, colour: TextColour, origin: PlacementView['view']): void {
  let values = pass.get(sprite.page);
  if (!values) pass.set(sprite.page, values = []);
  // Retain metre anchors about one fixed placement origin, avoiding large float32 products at street zoom.
  values.push(anchor.worldX - origin.cx, anchor.worldY - origin.cy, anchor.offsetX, anchor.offsetY, anchor.angle,
    sprite.left, sprite.top, sprite.width, sprite.height,
    sprite.x / GLYPH_ATLAS_SIZE, sprite.y / GLYPH_ATLAS_SIZE, sprite.w / GLYPH_ATLAS_SIZE, sprite.h / GLYPH_ATLAS_SIZE,
    colour[0], colour[1], colour[2], colour[3]);
}

export function createLiveTextLayer(gl: WebGL2RenderingContext, options: LiveTextOptions): LiveLayer {
  const atlas = new GlyphAtlas(gl);
  const counters: LiveLayerStats = {
    drawCalls: 0, triangles: 0, ms: 0, glyphs: 0, symbols: 0, instances: 0,
    atlasPages: 0, atlasSprites: 0, atlasBytes: 0, atlasUploads: 0, instanceUploads: 0, pendingLabels: 0, workMs: 0, errors: 0,
  };
  let program: TextProgram | undefined, batches: GpuBatch[] = [], pending: TextWork | undefined;
  let complete = false, revision = -1, density = -1, paletteKey: string | undefined, family: string | undefined;
  let originX = 0, originY = 0;
  let failedRevision: number | undefined, failedDpr: number | undefined, disposed = false;

  function dropBatches(list: GpuBatch[], deleteHandles: boolean): void {
    if (deleteHandles) for (const batch of list) { gl.deleteVertexArray(batch.vao); gl.deleteBuffer(batch.buffer); }
    list.length = 0;
  }

  function dropInstances(deleteHandles = true): void {
    dropBatches(batches, deleteHandles);
    if (pending) dropBatches(pending.batches, deleteHandles);
    pending = undefined; complete = false;
    counters.glyphs = 0; counters.symbols = 0; counters.instances = 0; counters.pendingLabels = 0;
    counters.drawCalls = 0; counters.triangles = 0; counters.ms = 0;
  }

  /** A single glyph/pass or symbol is the smallest work unit, so long names yield between sprites. */
  function prepareOne(state: TextWork): void {
    const source = state.source;
    if (!state.current) {
      const placed = source.placed[state.label], st = placed.label.st;
      state.current = {
        placed, followWorld: !!placed.path || placed.glyphs.some(g => g.a !== 0), halo: Math.max(2.4, placed.size * (st.haloWidth ?? .26)),
        fill: atlas.colour(st.color), stroke: atlas.colour(st.halo ?? source.palette.lab.halo, st.haloOpacity ?? source.palette.lab.haloOp),
        glyph: 0, pass: 0, symbolDone: false,
      };
      return;
    }
    const item = state.current, placed = item.placed, st = placed.label.st;
    if (item.glyph < placed.glyphs.length) {
      const glyph = placed.glyphs[item.glyph];
      if (glyph.ch === ' ') { item.glyph++; return; }
      const font = fontString(st, Math.round(glyph.size * 10) / 10, st.family ?? source.family);
      const sprites = atlas.glyph(font, glyph.ch, item.pass === 0 ? item.halo : 0, state.dpr);
      const anchor = liveGlyphAnchor(source, placed, glyph, item.followWorld);
      for (const sprite of sprites) appendInstance(state.passes[item.pass], sprite, anchor, item.pass === 0 ? item.stroke : item.fill, source.view);
      if (item.pass === 0) item.pass = 1;
      else { item.pass = 0; item.glyph++; state.glyphs++; }
      return;
    }
    if (placed.symbol && !item.symbolDone) {
      const sprites = atlas.symbol(st.symbol, placed.symbol.r, state.dpr), anchor = liveSymbolAnchor(source, placed.symbol);
      for (const sprite of sprites) appendInstance(state.passes[2], sprite, anchor, item.fill, source.view);
      item.symbolDone = true; state.symbols++;
      return;
    }
    state.label++; state.current = undefined;
  }

  function refreshAtlasStats(): void {
    counters.atlasPages = atlas.pages; counters.atlasSprites = atlas.size; counters.atlasUploads = atlas.uploads;
    counters.atlasBytes = atlas.pages * GLYPH_ATLAS_SIZE * GLYPH_ATLAS_SIZE * 4;
    counters.pendingLabels = pending ? pending.source.placed.length - pending.label : 0;
  }

  return {
    name: 'text', isolated: false,
    ready(frame): boolean {
      const source = options.placement();
      return !source || (!disposed && complete && source.revision === revision && frame.dpr === density);
    },
    work(budgetMs, frame): boolean {
      if (disposed) return false;
      const source = options.placement();
      if (!source) { dropInstances(); failedRevision = undefined; failedDpr = undefined; return false; }
      if (!frame) return true;
      if (complete && source.revision === revision && frame.dpr === density) return false;
      if (failedRevision === source.revision && failedDpr === frame.dpr) return false;
      if (!(budgetMs > 0)) return true;
      const started = performance.now(), deadline = started + budgetMs;
      try {
        if (!pending || pending.source.revision !== source.revision || pending.dpr !== frame.dpr) {
          dropInstances();
          const nextPaletteKey = JSON.stringify(source.palette);
          if (nextPaletteKey !== paletteKey || source.family !== family || frame.dpr !== density) atlas.reset();
          paletteKey = nextPaletteKey; family = source.family; density = frame.dpr;
          pending = { source, dpr: frame.dpr, label: 0, passes: [new Map(), new Map(), new Map()], upload: 0, batches: [], glyphs: 0, symbols: 0 };
        }
        while (pending && performance.now() < deadline) {
          if (!program) { program = createProgram(gl); continue; }
          const state = pending;
          if (!state.queue) {
            if (state.label < state.source.placed.length) { prepareOne(state); continue; }
            state.queue = [];
            // Pass-major order is fixed before upload: every halo, then every fill, then every symbol.
            for (const pass of state.passes) for (const [page, values] of pass) state.queue.push({ page, values });
            state.passes.length = 0;
          } else if (state.upload < state.queue.length) {
            state.batches.push(uploadBatch(gl, state.queue[state.upload++])); counters.instanceUploads++;
          } else {
            batches = state.batches; revision = state.source.revision; density = state.dpr; complete = true;
            originX = state.source.view.cx; originY = state.source.view.cy;
            counters.glyphs = state.glyphs; counters.symbols = state.symbols; counters.instances = 0;
            for (const batch of batches) counters.instances += batch.count;
            pending = undefined; failedRevision = undefined; failedDpr = undefined;
            options.invalidate();
          }
        }
      } catch {
        // Keep the compositor's exact stand-in if rasterization or resource allocation fails for this revision.
        dropInstances(); failedRevision = source.revision; failedDpr = frame.dpr; counters.errors++;
      }
      counters.workMs = performance.now() - started; refreshAtlasStats();
      return !!pending;
    },
    draw(frame): void {
      const started = performance.now();
      counters.drawCalls = 0; counters.triangles = 0;
      if (disposed || !options.placement() || !complete || !program || batches.length === 0) { counters.ms = performance.now() - started; return; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.target); gl.viewport(0, 0, frame.width, frame.height);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true); gl.depthMask(false);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program.handle); gl.activeTexture(gl.TEXTURE0); gl.bindSampler(0, null);
      const m = frame.worldToPixel;
      gl.uniform4f(program.world, m[0], m[1], m[2] + originX * m[0], m[3] + originY * m[1]);
      gl.uniform2f(program.viewport, frame.width, frame.height); gl.uniform1f(program.dpr, frame.dpr); gl.uniform1i(program.atlas, 0);
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        gl.bindTexture(gl.TEXTURE_2D, atlas.texture(batch.page)); gl.bindVertexArray(batch.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
        counters.drawCalls++; counters.triangles += batch.count * 2;
      }
      gl.bindVertexArray(null);
      counters.ms = performance.now() - started;
    },
    invalidate(): void { dropInstances(); failedRevision = undefined; failedDpr = undefined; },
    contextLost(): void {
      dropInstances(false); program = undefined; atlas.reset(false); refreshAtlasStats();
      failedRevision = undefined; failedDpr = undefined;
    },
    stats(): LiveLayerStats { return counters; },
    dispose(): void {
      if (disposed) return;
      disposed = true; dropInstances(); atlas.dispose(); refreshAtlasStats();
      if (program) gl.deleteProgram(program.handle);
      program = undefined;
    },
  };
}
