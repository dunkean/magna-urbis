/**
 * The map drape (contract.ts): what lies flat on the ground above it, baked into world tiles that the terrain of a
 * tilted frame shows over the ground tiles (terrainShader.ts). Owned by the live compositor (render/live/compositor.ts),
 * which gives it the `DrapeSource` of each flat layer in their order (the vector water, the cartography overlay, the
 * town plan), runs `work` in its slices and hands `tiles` to the frame (`LiveFrame.drape`).
 *
 * One tile per key holds every source, rather than one pyramid per layer: the terrain then reads one more texture
 * whatever the number of layers, the order and the blending of the layers are settled once at the bake (each isolated
 * source is drawn in its own group and laid over with its opacity, as the compositor does in the top view), and the
 * memory is that of one pyramid. The price: a change of one source bakes the tiles again with all of them.
 *
 * The tiling is the ground's (512 pixel tiles, tier k = 2^k x 2^k tiles), so the terrain picks one tier per square for
 * both. All the tiles live in one texture array: the terrain keeps drawing once per page of ground tiles. It is
 * allocated when a frame first tilts and freed after RELEASE_MS back in the top view.
 *
 * Baking: `work` bakes what the squares of the last tilted frame asked for (tilePyramid.ts: tier 0 first, then the
 * nearest square first), at most a few tiles per slice and one while the view moves; a tile is baked by each source
 * drawing its picture of the tile's square with its own GPU renderer in this context. Tiles are stale when a source's
 * revision changes, and keep showing until baked again. Least recently shown tiles are evicted; tiers 0 and 1 never.
 *
 * Line widths: tier k has 512 * 2^k / mapSize pixels per metre, and the terrain picks for a square the coarsest tier
 * at least as dense as the screen at the square's nearest corner (footprint.ts): across the view axis a tile texel is
 * between a half and one screen pixel there (down to about a third at the far corner of the square). A source draws a
 * tile as the top view of 1 / DRAPE_LINE_SCALE of the tile's density, stretched: what the map sizes in screen pixels
 * (road casings, hairlines, symbols) is DRAPE_LINE_SCALE wider in texels, so on screen between 0.67 and 1.33 of its
 * width in the top view instead of 0.5 to 1. Each tier is drawn anew for its own scale: a road keeps its width in
 * pixels from the foreground to the horizon, as it does across the zooms of the top view, and the generalisation of
 * the cartography (which roads, which fields) follows the distance.
 */
import { resetLiveState, type LiveFrame } from '../live/contract';
import { createIsolatedGroup } from '../live/isolatedGroup';
import { MAX_SCALE } from '../view';
import type { DrapeCanvas, DrapeSource, DrapeTile, DrapeTiles } from './contract';
import { TilePyramid } from './tilePyramid';

/** Device pixels of a tile: the ground's (groundLayer.ts), so both pyramids share their tiers. */
const TILE = 512;
/** How much wider than in a top view of the tile's own density the sources draw what is sized in screen pixels. */
const DRAPE_LINE_SCALE = 4 / 3;
/** Tiles the drape holds (1 MiB each): the squares of a tilted frame ask for 20 to 160. */
const LAYERS_FULL = 128,
  LAYERS_LIGHT = 48;
const TILE_BYTES = TILE * TILE * 4;
/** Tiers 0 and 1 (5 tiles) are baked whatever the view and never evicted. */
const COARSE_TIERS = 2;
const MAX_TIER = 20;
/** A source that is not ready is asked again after this delay. */
const RETRY_MS = 100;
/** The tiles are freed once the view has been the top view this long. */
const RELEASE_MS = 30000;

const PUT_VS = `#version 300 es
uniform vec4 uRect;
uniform vec4 uUv;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vUv = mix(uUv.xy, uUv.zw, c);
  gl_Position = vec4(mix(uRect.xy, uRect.zw, c), 0.0, 1.0);
}`;
const PUT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv) * uOpacity; }`;

interface GlState {
  layers: number;
  array: WebGLTexture;
  /** Framebuffer of the layer being baked. */
  layer: WebGLFramebuffer;
  program: WebGLProgram;
  uRect: WebGLUniformLocation | null;
  uUv: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  vao: WebGLVertexArrayObject;
}

export interface MapDrapeStats {
  /** Tiles baked, and the GPU bytes of the drape. */
  tiles: number;
  bytes: number;
  /** Tiles the last tilted frame wanted (and coarse tiles) still to bake. */
  pending: number;
  /** Bakes since the context was created, and the main-thread time of the last one. */
  baked: number;
  bakeMs: number;
}

interface MapDrapeOptions {
  /** Side of the map in metres (0: no map). */
  mapSize(): number;
  /** Asks for a new frame (a tile arrived). */
  invalidate(): void;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, PUT_VS],
    [gl.FRAGMENT_SHADER, PUT_FS],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Map drape program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export class MapDrape {
  readonly stats: MapDrapeStats = { tiles: 0, bytes: 0, pending: 0, baked: 0, bakeMs: 0 };
  /** The tiles as the terrain of a tilted frame reads them. */
  readonly tiles: DrapeTiles;
  private state?: GlState;
  private readonly pyramid = new TilePyramid(COARSE_TIERS);
  private readonly group: ReturnType<typeof createIsolatedGroup>;
  /** Map side the tiles were baked for; they are dropped when it changes. */
  private gridSize = 0;
  /** The sources of the last slice and their revisions: another list or revision makes every tile stale. */
  private readonly seen: DrapeSource[] = [];
  private readonly seenRevision: number[] = [];
  private blockedUntil = 0;
  private tiltedAt = 0;
  /** A source whose `paint` threw is reported once. */
  private warned = false;
  /** The tile being baked, as the sources see it. */
  private readonly rect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  private readonly canvas: DrapeCanvas & { scale: number; dpr: number; light: boolean };

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly options: MapDrapeOptions,
  ) {
    this.group = createIsolatedGroup(gl);
    const pyramid = this.pyramid;
    this.tiles = {
      tilePixels: TILE,
      mapSize: () => this.gridSize,
      finestTier: dpr => this.finestTier(dpr),
      revision: () => pyramid.revision,
      begin: () => pyramid.begin(),
      resolve: (tier: number, ix: number, iy: number, priority: number, out: DrapeTile) => pyramid.resolve(tier, ix, iy, priority, out),
      pageCount: () => (this.state ? 1 : 0),
      page: () => this.state!.array,
    };
    this.canvas = { rect: this.rect, pixels: TILE, scale: 1, dpr: 1, light: false, put: (texture, uWest, vNorth, uEast, vSouth, opacity) => this.put(texture, uWest, vNorth, uEast, vSouth, opacity), group: () => this.openGroup(), putGroup: opacity => this.putGroup(opacity) };
  }

  /** Finest tier baked at this pixel ratio: the ground's (the zoom limit of the 2D map). */
  private finestTier(dpr: number): number {
    return this.gridSize > 0 ? Math.max(0, Math.min(MAX_TIER, Math.ceil(Math.log2((MAX_SCALE * dpr) / (TILE / this.gridSize)) - 1e-9))) : 0;
  }

  /** The texture array of `layers` tiles and what a bake needs; made again when the number of tiles changes. */
  private ensure(layers: number): GlState | undefined {
    const gl = this.gl;
    if (this.state?.layers === layers) return this.state;
    if (gl.isContextLost()) return undefined;
    this.release();
    const array = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE, TILE, layers);
    // As the ground tiles: a tile shown at its own tier is minified by less than 2 across the view, where bilinear
    // taps cover the footprint; the terrain adds its own taps along the squeezed axis.
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    const program = link(gl);
    this.state = { layers, array, layer: gl.createFramebuffer()!, program, uRect: gl.getUniformLocation(program, 'uRect'), uUv: gl.getUniformLocation(program, 'uUv'), uOpacity: gl.getUniformLocation(program, 'uOpacity'), vao: gl.createVertexArray()! };
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
    gl.useProgram(null);
    this.pyramid.reset(layers);
    return this.state;
  }

  /** Frees the tiles and what bakes them; the next tilted frame starts again from tier 0. */
  private release(): void {
    const gl = this.gl,
      s = this.state;
    if (s && !gl.isContextLost()) {
      gl.deleteTexture(s.array);
      gl.deleteFramebuffer(s.layer);
      gl.deleteProgram(s.program);
      gl.deleteVertexArray(s.vao);
      this.group.drop();
    }
    this.state = undefined;
    this.pyramid.reset(0);
    this.stats.tiles = this.stats.bytes = this.stats.pending = 0;
  }

  // --- the tile being baked, as the sources paint it (DrapeCanvas) ---------------------------------------------------

  private put(texture: WebGLTexture, uWest: number, vNorth: number, uEast: number, vSouth: number, opacity: number): void {
    const gl = this.gl,
      s = this.state;
    if (!s || uEast === uWest || vSouth === vNorth) return;
    // The part of the tile the texture covers: its coordinates clipped to 0..1 along each axis.
    const a = Math.max(0, Math.min(1, Math.min((0 - uWest) / (uEast - uWest), (1 - uWest) / (uEast - uWest)))),
      b = Math.max(0, Math.min(1, Math.max((0 - uWest) / (uEast - uWest), (1 - uWest) / (uEast - uWest)))),
      c = Math.max(0, Math.min(1, Math.min((0 - vNorth) / (vSouth - vNorth), (1 - vNorth) / (vSouth - vNorth)))),
      d = Math.max(0, Math.min(1, Math.max((0 - vNorth) / (vSouth - vNorth), (1 - vNorth) / (vSouth - vNorth))));
    if (!(b > a && d > c)) return;
    resetLiveState(gl, s.layer, TILE, TILE);
    gl.useProgram(s.program);
    gl.bindVertexArray(s.vao);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Row 0 of a tile is its north edge, as in the ground tiles: the north of the picture goes to the bottom of the
    // framebuffer.
    gl.uniform4f(s.uRect, a * 2 - 1, c * 2 - 1, b * 2 - 1, d * 2 - 1);
    gl.uniform4f(s.uUv, uWest + (uEast - uWest) * a, vNorth + (vSouth - vNorth) * c, uWest + (uEast - uWest) * b, vNorth + (vSouth - vNorth) * d);
    gl.uniform1f(s.uOpacity, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }
  private openGroup(): WebGLFramebuffer | undefined {
    const gl = this.gl;
    if (!this.group.ensure(TILE, TILE, Math.min(4, Number(gl.getParameter(gl.MAX_SAMPLES)) || 0))) return undefined;
    const fbo = this.group.target!.fbo;
    resetLiveState(gl, fbo, TILE, TILE);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    return fbo;
  }
  private putGroup(opacity: number): void {
    const gl = this.gl,
      target = this.group.target;
    if (!target || !(opacity > 0)) return;
    // The blit obeys the scissor and the colour mask the source may have left.
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolve);
    gl.blitFramebuffer(0, 0, TILE, TILE, 0, 0, TILE, TILE, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // Drawn with y up: its north is at v = 1.
    this.put(target.texture, 0, 1, 1, 0, Math.min(1, opacity));
  }

  // --- baking ----------------------------------------------------------------------------------------------------------

  /** Bakes the tile `next` of the pyramid found. 'wait': a source is not ready; 'full': no layer is free. */
  private bake(s: GlState, frame: LiveFrame, sources: readonly DrapeSource[]): 'ok' | 'wait' | 'full' {
    const gl = this.gl,
      pyramid = this.pyramid,
      canvas = this.canvas,
      rect = this.rect,
      { tier, ix, iy } = pyramid,
      side = this.gridSize / 2 ** tier;
    rect.minX = ix * side;
    rect.minY = iy * side;
    rect.maxX = rect.minX + side;
    rect.maxY = rect.minY + side;
    canvas.scale = TILE / DRAPE_LINE_SCALE / side / frame.dpr;
    canvas.dpr = frame.dpr;
    canvas.light = frame.quality === 'light';
    // Asked first: a tile is baked with all its sources or not at all, and a refusal must not cost an eviction.
    for (let i = 0; i < sources.length; i++) if (!sources[i].ready(canvas)) return 'wait';
    const slot = pyramid.slotFor(tier, ix, iy);
    if (slot < 0) return 'full';
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.layer);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, s.array, 0, slot);
    resetLiveState(gl, s.layer, TILE, TILE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < sources.length; i++) {
      resetLiveState(gl, s.layer, TILE, TILE);
      try {
        sources[i].paint(canvas);
      } catch (error) {
        // The tile is kept without that source rather than baked again at every slice.
        if (!this.warned) console.warn('Map drape: a layer could not be painted into a tile.', error);
        this.warned = true;
      }
    }
    pyramid.baked(tier, ix, iy, slot);
    return 'ok';
  }

  /** One slice of baking for the last frame, with the sources of the flat layers in their order, bottom first. True
   * while tiles are pending. Only a tilted frame has tiles baked. */
  work(budgetMs: number, frame: LiveFrame | undefined, sources: readonly DrapeSource[]): boolean {
    const gl = this.gl,
      started = performance.now(),
      pyramid = this.pyramid,
      stats = this.stats;
    if (gl.isContextLost()) return false;
    if (!frame?.camera.tilted) {
      if (this.state && started - this.tiltedAt > RELEASE_MS) this.release();
      return false;
    }
    this.tiltedAt = started;
    const size = this.options.mapSize();
    if (!(size > 0)) return false;
    const s = this.ensure(frame.quality === 'light' ? LAYERS_LIGHT : LAYERS_FULL);
    if (!s) return false;
    if (size !== this.gridSize) {
      this.gridSize = size;
      pyramid.reset(s.layers);
    }
    const seen = this.seen,
      seenRevision = this.seenRevision;
    let same = seen.length === sources.length;
    for (let i = 0; i < sources.length; i++) {
      const revision = sources[i].revision();
      if (seen[i] !== sources[i] || seenRevision[i] !== revision) same = false;
      seen[i] = sources[i];
      seenRevision[i] = revision;
    }
    seen.length = seenRevision.length = sources.length;
    if (!same) pyramid.stale();
    if (started < this.blockedUntil) return true;
    const finest = this.finestTier(frame.dpr),
      limit = frame.moving ? 1 : 4;
    let baked = 0,
      pending = false;
    try {
      while (pyramid.next(finest)) {
        if (baked >= limit || performance.now() - started >= budgetMs) {
          pending = true;
          break;
        }
        const t = performance.now(),
          result = this.bake(s, frame, sources);
        if (result === 'wait') {
          this.blockedUntil = performance.now() + RETRY_MS;
          pending = true;
          break;
        }
        // No layer can be freed before the next frame marks what it still shows.
        if (result === 'full') break;
        baked++;
        stats.baked++;
        stats.bakeMs = performance.now() - t;
      }
    } finally {
      resetLiveState(gl, null, frame.width, frame.height);
    }
    stats.tiles = pyramid.size;
    stats.bytes = s.layers * TILE_BYTES;
    stats.pending = pyramid.pending(finest);
    if (baked) this.options.invalidate();
    return pending;
  }

  /** Every GL handle is dead; the next tilted frame builds them again. */
  contextLost(): void {
    this.state = undefined;
    this.group.contextLost();
    this.pyramid.reset(0);
    this.gridSize = 0;
    this.seen.length = this.seenRevision.length = 0;
    this.blockedUntil = 0;
  }

  dispose(): void {
    this.release();
    this.gridSize = 0;
  }
}
