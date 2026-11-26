/**
 * The map drape (contract.ts): what lies flat on the ground above it, baked into world tiles that the terrain of a
 * tilted frame shows over the ground tiles (terrainShader.ts). Owned by the live compositor (render/live/compositor.ts),
 * which gives it the `DrapeSource` of each flat layer in their order (the vector water, the cartography overlay, the
 * town plan), runs `work` in its slices and hands `tiles` to the frame (`LiveFrame.drape`).
 * Sources contain no names: overlay recordings discard Canvas text before making their lists, the GPU town plan
 * and water draw geometry only. Names, including flat river and street names, belong to the live text layer alone.
 *
 * One tile per key holds every source, rather than one pyramid per layer: the terrain then reads one more texture
 * whatever the number of layers, the order and the blending of the layers are settled once at the bake (each isolated
 * source is drawn in its own group and laid over with its opacity, as the compositor does in the top view), and the
 * memory is that of one pyramid. The price: a change of one source bakes the tiles again with all of them.
 *
 * The tiling is the ground's (512 pixel tiles, tier k = 2^k x 2^k tiles), so the terrain picks one tier per square for
 * both. All the tiles live in one texture array, allocated whole when a frame first tilts and freed after RELEASE_MS
 * back in the top view: the terrain keeps drawing once per page of ground tiles. Its size is the budget
 * (`drapeLayers`): a square of the terrain asks for a tile of its own, and a tilted view of 1600 x 1000 CSS pixels
 * over a 40 km map draws up to 59 distinct tiles at one device pixel per CSS pixel and 102 at two (41 and 75 at 55 degrees;
 * tests/world.drapeBudget.test.ts), in either quality, plus the 5 coarse tiles and the layer a bake goes into. A
 * view of 2560 x 1440 at 55 or 70 degrees asks for up to 95 at one device pixel and 177 at two. If the budget fills,
 * the nearest tiles take priority and far squares use their ancestors (`stats.full`).
 *
 * Baking: `work` bakes what the squares of the last tilted frame asked for (tilePyramid.ts: tier 0 first, then the
 * square nearest the centre of the view first), and only while the view rests: a tile costs a recording of the cartography and a draw of
 * the town, which no frame of a moving view can afford. A tile is baked by each source in turn painting its picture
 * of the tile's square with its own GPU renderer in this context, into a layer no tile is shown from; a source whose
 * picture is long to make paints it in steps, and the bake then spans several slices (`baking`). Tiles are stale when
 * a source's revision (its content) changes, and keep showing until baked again; a tile a source painted without a
 * product still being made for its scale (contour paths) is stale, alone, when that source's `arrivals` changes. Least recently shown tiles are evicted; tiers 0
 * and 1 never, nor a tile the last frame shows.
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
import { MAX_SCALE, type Rect4 } from '../view';
import type { DrapeCanvas, DrapeSource, DrapeTile, DrapeTiles } from './contract';
import { TilePyramid } from './tilePyramid';

/** Device pixels of a tile: the ground's (groundLayer.ts), so both pyramids share their tiers. */
const TILE = 512;
/** How much wider than in a top view of the tile's own density the sources draw what is sized in screen pixels. */
const DRAPE_LINE_SCALE = 4 / 3;
const TILE_BYTES = TILE * TILE * 4;
/** Tiers 0 and 1 (5 tiles) are baked whatever the view and never evicted. */
export const DRAPE_COARSE_TIERS = 2;
const MAX_TIER = 20;
/** A source that is not ready is asked again after this delay. */
const RETRY_MS = 50;
/** The tiles are freed once the view has been the top view this long. */
const RELEASE_MS = 30000;
/** Tiles baked to their end in one slice, when the slice has the time. */
const TILES_PER_SLICE = 4;

/** Layers of the drape's texture array (1 MiB each): one is kept for the bake under way, the others hold tiles. The
 * light quality draws as many squares at these sizes; it holds the 1600 x 1000 view and no more. WebGL2 guarantees
 * arrays of 256 layers. */
export const drapeLayers = (quality: 'full' | 'light'): number => (quality === 'light' ? 144 : 192);

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
  /** Tiles baked (stale ones included) and tiles the drape can hold. */
  tiles: number;
  capacity: number;
  /** GPU bytes of the texture array: allocated whole, whatever the number of tiles baked. */
  bytes: number;
  /** Tiles the last tilted frame wanted (and coarse tiles) still to bake. */
  pending: number;
  /** 1 when the last slice found no layer for a tile: the frame shows more tiles than the drape holds. */
  full: number;
  /** Tiles baked since the context was created, the main-thread time of the last one, and the longest step. */
  baked: number;
  bakeMs: number;
  stepMs: number;
}

interface MapDrapeOptions {
  /** Side of the map in metres (0: no map). */
  mapSize(): number;
  /** Asks for a new frame (a tile arrived). */
  invalidate(): void;
}

/** The tile being baked, across slices: its key, the layer it goes into, the source it has reached and how many times
 * that source has painted, the main-thread time spent so far. */
interface Baking {
  tier: number;
  ix: number;
  iy: number;
  slot: number;
  source: number;
  step: number;
  ms: number;
  /** A source painted it without a product still being made (DrapeCanvas.provisional). */
  provisional: boolean;
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
  readonly stats: MapDrapeStats = { tiles: 0, capacity: 0, bytes: 0, pending: 0, full: 0, baked: 0, bakeMs: 0, stepMs: 0 };
  /** The tiles as the terrain of a tilted frame reads them. */
  readonly tiles: DrapeTiles;
  private state?: GlState;
  private readonly pyramid = new TilePyramid(DRAPE_COARSE_TIERS);
  private readonly group: ReturnType<typeof createIsolatedGroup>;
  /** Map side the tiles were baked for; they are dropped when it changes. */
  private gridSize = 0;
  /** The sources of the last slice and their revisions. */
  private readonly seen: DrapeSource[] = [];
  private readonly seenRevision: number[] = [];
  /** Their `arrivals` in the last slice: another count makes the tiles painted provisionally stale, and only those. */
  private readonly seenArrivals: number[] = [];
  private blockedUntil = 0;
  private tiltedAt = 0;
  /** A source whose `paint` threw is reported once. */
  private warned = false;
  private baking?: Baking;
  /** The tile being baked, as the sources see it. */
  private readonly rect = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  private readonly canvas: DrapeCanvas & { scale: number; dpr: number; light: boolean; step: number };

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
      resolve: (squareTier: number, sx: number, sy: number, tier: number, priority: number, out: DrapeTile) => pyramid.resolve(squareTier, sx, sy, tier, priority, out),
      pageCount: () => (this.state ? 1 : 0),
      page: () => this.state!.array,
    };
    this.canvas = {
      rect: this.rect,
      pixels: TILE,
      scale: 1,
      dpr: 1,
      light: false,
      step: 0,
      put: (texture, uWest, vNorth, uEast, vSouth, opacity, uMin, vMin, uMax, vMax) => this.put(texture, uWest, vNorth, uEast, vSouth, opacity, uMin, vMin, uMax, vMax),
      group: () => this.openGroup(),
      putGroup: opacity => this.putGroup(opacity),
      provisional: () => {
        if (this.baking) this.baking.provisional = true;
      },
    };
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
    this.baking = undefined;
    this.pyramid.reset(0);
    this.stats.tiles = this.stats.capacity = this.stats.bytes = this.stats.pending = this.stats.full = 0;
  }

  // --- the tile being baked, as the sources paint it (DrapeCanvas) ---------------------------------------------------

  private put(texture: WebGLTexture, uWest: number, vNorth: number, uEast: number, vSouth: number, opacity: number, uMin = 0, vMin = 0, uMax = 1, vMax = 1): void {
    const gl = this.gl,
      s = this.state;
    if (!s || uEast === uWest || vSouth === vNorth) return;
    // The part of the tile the texture covers: where its coordinates are inside the window, along each axis.
    const du = uEast - uWest,
      dv = vSouth - vNorth,
      a = Math.max(0, Math.min(1, Math.min((uMin - uWest) / du, (uMax - uWest) / du))),
      b = Math.max(0, Math.min(1, Math.max((uMin - uWest) / du, (uMax - uWest) / du))),
      c = Math.max(0, Math.min(1, Math.min((vMin - vNorth) / dv, (vMax - vNorth) / dv))),
      d = Math.max(0, Math.min(1, Math.max((vMin - vNorth) / dv, (vMax - vNorth) / dv)));
    if (!(b > a && d > c)) return;
    resetLiveState(gl, s.layer, TILE, TILE);
    gl.useProgram(s.program);
    gl.bindVertexArray(s.vao);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Row 0 of a tile is its north edge, as in the ground tiles: the north of the picture goes to the bottom of the
    // framebuffer.
    gl.uniform4f(s.uRect, a * 2 - 1, c * 2 - 1, b * 2 - 1, d * 2 - 1);
    gl.uniform4f(s.uUv, uWest + du * a, vNorth + dv * c, uWest + du * b, vNorth + dv * d);
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

  /** Gives up the bake under way: its layer is free again. */
  private abandon(): void {
    if (this.baking) this.pyramid.discard(this.baking.slot);
    this.baking = undefined;
  }

  /** One step of baking: starts the tile `next` of the pyramid names when none is under way, then lets the source it
   * has reached paint once. 'baked': the tile is complete; 'more': it goes on; 'none': nothing to bake; 'wait': a
   * source is not ready; 'full': no layer can be freed for the tile. */
  private step(s: GlState, frame: LiveFrame, sources: readonly DrapeSource[], finest: number): 'baked' | 'more' | 'none' | 'wait' | 'full' {
    const gl = this.gl,
      pyramid = this.pyramid,
      canvas = this.canvas;
    let baking = this.baking;
    if (!baking) {
      if (!pyramid.next(finest)) return 'none';
      const { tier, ix, iy } = pyramid,
        rect = this.rect,
        side = this.gridSize / 2 ** tier;
      rect.minX = ix * side;
      rect.minY = iy * side;
      rect.maxX = rect.minX + side;
      rect.maxY = rect.minY + side;
      canvas.scale = TILE / DRAPE_LINE_SCALE / side / frame.dpr;
      canvas.dpr = frame.dpr;
      canvas.light = frame.quality === 'light';
      canvas.step = 0;
      // Asked first: a tile is baked with all its sources or not at all, and a refusal must not cost an eviction.
      for (let i = 0; i < sources.length; i++) if (!sources[i].ready(canvas)) return 'wait';
      const slot = pyramid.spare(tier, ix, iy);
      if (slot < 0) return 'full';
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.layer);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, s.array, 0, slot);
      resetLiveState(gl, s.layer, TILE, TILE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      baking = this.baking = { tier, ix, iy, slot, source: 0, step: 0, ms: 0, provisional: false };
    }
    if (baking.source < sources.length) {
      // A source that starts after another is asked again: the bake spans slices, and the source's own work between
      // them may have changed what it was ready with (the town's tables), which `paint` would then make in one go.
      canvas.step = baking.step;
      if (baking.source > 0 && baking.step === 0 && !sources[baking.source].ready(canvas)) return 'wait';
      resetLiveState(gl, s.layer, TILE, TILE);
      let more = false;
      try {
        more = sources[baking.source].paint(canvas) === true;
      } catch (error) {
        // The tile is kept without (the rest of) that source rather than baked again at every slice.
        if (!this.warned) console.warn('Map drape: a layer could not be painted into a tile.', error);
        this.warned = true;
      }
      if (more) baking.step++;
      else {
        baking.source++;
        baking.step = 0;
      }
      if (baking.source < sources.length) return 'more';
    }
    pyramid.baked(baking.tier, baking.ix, baking.iy, baking.slot, baking.provisional);
    this.baking = undefined;
    return 'baked';
  }

  /** One slice of baking for the last frame, with the sources of the flat layers in their order, bottom first. True
   * while tiles are pending. Only a tilted frame at rest has tiles baked. A slice always makes one step, whatever
   * time it is given: its units are indivisible, and a caller that has little time left must not starve the drape. */
  work(budgetMs: number, frame: LiveFrame | undefined, sources: readonly DrapeSource[]): boolean {
    const gl = this.gl,
      now = performance.now(),
      pyramid = this.pyramid,
      stats = this.stats;
    if (gl.isContextLost()) return false;
    if (!frame?.camera.tilted) {
      if (this.state && now - this.tiltedAt > RELEASE_MS) this.release();
      return false;
    }
    this.tiltedAt = now;
    const size = this.options.mapSize();
    if (!(size > 0)) return false;
    // Never smaller than the array in use: a switch to the light quality (the automatic demotion) would otherwise
    // reallocate it and blank every tile of the drape until baked again. The light size applies from the next tilt
    // after the array is released.
    const s = this.ensure(Math.max(this.state?.layers ?? 0, drapeLayers(frame.quality)));
    if (!s) return false;
    if (size !== this.gridSize) {
      this.gridSize = size;
      this.baking = undefined;
      pyramid.reset(s.layers);
    }
    const seen = this.seen,
      seenRevision = this.seenRevision,
      seenArrivals = this.seenArrivals;
    let whole = seen.length !== sources.length,
      arrived = false,
      changes: Rect4[] | undefined;
    for (let i = 0; i < sources.length; i++) {
      const revision = sources[i].revision(),
        arrivals = sources[i].arrivals?.() ?? 0;
      if (seen[i] !== sources[i]) whole = true;
      else {
        if (!whole && seenRevision[i] !== revision) {
          const boxes = sources[i].contentChanges?.(seenRevision[i]);
          if (!boxes) whole = true;
          else if (boxes.length) (changes ??= []).push(...boxes);
        }
        if (seenArrivals[i] !== arrivals) arrived = true;
      }
      seen[i] = sources[i];
      seenRevision[i] = revision;
      seenArrivals[i] = arrivals;
    }
    seen.length = seenRevision.length = seenArrivals.length = sources.length;
    let bakingChanged = whole;
    if (whole) pyramid.stale();
    else {
      if (changes) {
        const boxes = changes;
        const affected = (tier: number, x: number, y: number): boolean => {
          const side = size / 2 ** tier,
            pad = (32 * DRAPE_LINE_SCALE * frame.dpr * side) / TILE;
          return boxes.some(box => x * side - pad <= box.maxX && box.minX <= (x + 1) * side + pad && y * side - pad <= box.maxY && box.minY <= (y + 1) * side + pad);
        };
        pyramid.staleWhere(affected);
        const baking = this.baking;
        bakingChanged = !!baking && affected(baking.tier, baking.ix, baking.iy);
      }
      if (arrived) pyramid.staleProvisional();
    }
    // A bake under way was started for other sources, or for another pixel ratio or quality, or painted without a
    // product that has just arrived: it starts again.
    if (this.baking && (bakingChanged || (arrived && this.baking.provisional) || this.canvas.dpr !== frame.dpr || this.canvas.light !== (frame.quality === 'light'))) this.abandon();
    const finest = this.finestTier(frame.dpr);
    stats.capacity = s.layers - 1;
    stats.bytes = s.layers * TILE_BYTES;
    let pending = false,
      baked = 0;
    if (frame.moving || now < this.blockedUntil) pending = !!this.baking || pyramid.pending(finest) > 0;
    else {
      const started = performance.now();
      stats.full = 0;
      try {
        for (let steps = 0; ; steps++) {
          const t = performance.now();
          if (steps > 0 && (baked >= TILES_PER_SLICE || t - started >= budgetMs)) {
            pending = !!this.baking || pyramid.next(finest);
            break;
          }
          const before = this.baking?.ms ?? 0,
            result = this.step(s, frame, sources, finest);
          if (result === 'none') break;
          if (result === 'wait') {
            this.blockedUntil = performance.now() + RETRY_MS;
            pending = true;
            break;
          }
          // No layer can be freed before the next frame marks what it still shows.
          if (result === 'full') {
            stats.full = 1;
            break;
          }
          const ms = performance.now() - t;
          if (ms > stats.stepMs) stats.stepMs = ms;
          if (result === 'more') this.baking!.ms = before + ms;
          else {
            stats.bakeMs = before + ms;
            stats.baked++;
            baked++;
          }
        }
      } finally {
        resetLiveState(gl, null, frame.width, frame.height);
      }
    }
    stats.tiles = pyramid.size;
    stats.pending = pyramid.pending(finest);
    if (baked) this.options.invalidate();
    return pending;
  }

  /** The ground is another terrain: no tile baked over the previous one may show on it, not even while its own are
   * baked (a stale tile is a fair stand-in for another look of the same terrain only). The texture array stays. */
  forget(): void {
    this.baking = undefined;
    this.pyramid.reset(this.state?.layers ?? 0);
    this.stats.tiles = this.stats.pending = 0;
  }

  /** Every GL handle is dead; the next tilted frame builds them again. */
  contextLost(): void {
    this.state = undefined;
    this.baking = undefined;
    this.group.contextLost();
    this.pyramid.reset(0);
    this.gridSize = 0;
    this.seen.length = this.seenRevision.length = this.seenArrivals.length = 0;
    this.blockedUntil = 0;
  }

  dispose(): void {
    this.release();
    this.gridSize = 0;
  }
}
