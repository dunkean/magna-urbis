/**
 * Live ground (contract.ts): the terrain material baked into world-space tiles and drawn as textured quads,
 * instead of the procedural material re-evaluated per pixel on every redraw.
 *
 * Pyramid in map metres: square tiles of TILE device pixels; tier k has 2^k x 2^k tiles over the map, density
 * TILE * 2^k / mapSize device pixels per metre (tier 0 covers the map with one tile). A frame wants the coarsest tier
 * whose density is at least `view.scale * dpr` (tiles minified by less than 2, never magnified), clamped to the tier of
 * the 2D zoom limit (MAX_SCALE). A tile not baked yet is replaced by the matching sub-rectangle of its nearest baked
 * ancestor; tiers 0..COARSE_TIERS-1 are baked first and never evicted, so once tier 0 exists there is no hole.
 *
 * Baking: the renderer (TerrainGl/TerrainGpu.renderWorldTile, another context) draws the tile with a GUTTER of extra
 * pixels on every side (the painted water, the bank widths and the crown-foot test read neighbours in screen space:
 * without the gutter they would clamp at every tile edge); its canvas is uploaded in the same task into a staging
 * texture (texSubImage2D: Chrome's GPU-to-GPU path for canvas sources exists for 2D targets only, a 3D upload reads
 * the canvas back on the CPU) and the inner TILE x TILE square is copied into a layer of a TEXTURE_2D_ARRAY page
 * (copyTexSubImage3D, GPU only). One instanced draw per page and pass (opaque, fading) draws the frame.
 *
 * Filtering: LINEAR without mipmaps. A tile shown at its own tier is minified by less than 2, where bilinear taps
 * still cover the footprint (at 2:1 they average the 2x2 texels under the pixel) and the material itself fades its
 * detail below 2 to 4 pixels; mipmaps would have to be regenerated for the whole array page at each bake. Only a view
 * zoomed out until the map is smaller than TILE device pixels minifies tier 0 further.
 *
 * Seams: tile quads share their edges exactly (both computed from the same world coordinate); each tile is its own
 * array layer, sampled with CLAMP_TO_EDGE, so no texel of a neighbour bleeds in; the material is a function of world
 * position, so both sides of an edge agree.
 *
 * A tilted camera (frame.camera.tilted) sees the same tiles draped on the relief: the layer hands that frame to its
 * draped ground (render/world/drapedGround.ts), which reads the tiles through `DrapeTiles` and names the ones its
 * squares want; those are then what the layer bakes first. The same terrain shows the map drape of the frame over
 * them (`LiveFrame.drape`: water, cartography, town plan), whose tiles the compositor bakes.
 *
 * Light quality requests half the linear pixel density (one tier coarser), warms only tiers 0..1 and never
 * prefetches a finer tier: roughly a quarter of visible tile bakes/instances, five warm tiles instead of 21.
 * One unit although long: the pyramid, its baking order, its eviction and both ways of showing it share the one
 * table of tiles.
 */
import type { GroundTileRenderer, LiveFrame, LiveGroundOptions, LiveLayer, LiveLayerStats } from './contract';
import { MAX_SCALE, type Rect4 } from '../view';
import { GROUND_PAGE_LAYERS as LAYERS, type DrapeTile, type DrapeTiles } from '../world/contract';
import { DrapedGround } from '../world/drapedGround';
import { findTile, tileKey } from '../world/tilePyramid';
import { GroundDiagnostics, layerDiagnosticsEnabled } from './layerDiagnostics';

/** Device pixels of a baked tile. */
const TILE = 512;
/** Extra device pixels rendered around a tile and dropped at the copy. */
const GUTTER = 32;
const RENDER = TILE + 2 * GUTTER;
/** Tiles per TEXTURE_2D_ARRAY page (16 MiB). */
const TILE_BYTES = TILE * TILE * 4;
const PAGE_BYTES = TILE_BYTES * LAYERS;
/** At most 512 MiB whatever the budget: bounds the draws of a frame (one per page and pass). */
const MAX_PAGES = 32;
/** Tiers 0..2 (the map at 512, 1024 and 2048 pixels, 21 tiles): baked first, never evicted. */
const COARSE_TIERS = 3;
const MAX_TIER = 20;
const FADE_MS = 120;
/** Items of one kind (opaque, fading) per frame; a 8K view at the worst minification needs about 650. */
const MAX_ITEMS = 2048;
/** Floats per item and per instance: destination rectangle (device pixels), source rectangle (uv), layer, alpha. */
const FLOATS = 10;
/** A renderer that cannot draw (programs linking) is asked again after this delay. */
const RETRY_MS = 100;
/** Tiles a tilted frame may ask for: one per square it draws at most. */
const MAX_WANTED = 1024;
/** After a look switch the layer is not ready (the page keeps its last picture) until tier 0 of the new look is baked,
 * at most this long: a renderer that cannot draw the new look yet then lets the old tiles show. */
const LOOK_HOLD_MS = 1500;
/** A moving view bakes first the stretch it will uncover in this time: at a brisk drag (800 CSS px/s) about one tile
 * (256 to 512 device pixels) ahead of its leading edge. */
const LEAD_S = 0.4;
/** Two frames further apart than this are not one motion: no velocity is read from them. */
const MOTION_GAP_S = 0.12;
/** Tiles baked after a moving frame (each costs about 0.4 ms of CPU and a 576 px square of the ground shader on the
 * GPU, a fraction of the whole view the display without tiles drew every frame); the work budget stops it sooner. */
const MOVING_BAKES = 3;

const VS = `#version 300 es
layout(location=0) in vec4 aDst;
layout(location=1) in vec4 aSrc;
layout(location=2) in vec2 aLayerAlpha;
uniform vec2 uSize;
out vec3 vUv; out float vAlpha;
void main() {
  vec2 c = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = mix(aDst.xy, aDst.zw, c);
  vUv = vec3(mix(aSrc.xy, aSrc.zw, c), aLayerAlpha.x); vAlpha = aLayerAlpha.y;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uTiles;
in vec3 vUv; in float vAlpha;
out vec4 outColor;
void main() { outColor = vec4(texture(uTiles, vUv).rgb * vAlpha, vAlpha); }`;

interface Tile {
  tier: number;
  ix: number;
  iy: number;
  slot: number;
  generation: number;
  crowns: boolean;
  shownAt: number;
  used: number;
}
interface GlState {
  program: WebGLProgram;
  uSize: WebGLUniformLocation | null;
  uTiles: WebGLUniformLocation | null;
  vao: WebGLVertexArrayObject;
  instances: WebGLBuffer;
  staging: WebGLTexture;
  stagingFbo: WebGLFramebuffer;
  pages: WebGLTexture[];
  crownPages: Map<number, WebGLTexture>;
  free: number[];
}

/** CSS colour -> 0..1 RGB components as written (no colour-space conversion, as the 2D canvas paints them). Hex and rgb() directly; anything else is normalized by
 * the browser once per distinct string. */
function cssRgb(css: string): [number, number, number] {
  const value = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  if (typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      context.fillStyle = value;
      const normalized = String(context.fillStyle);
      if (normalized !== value && (normalized.startsWith('#') || normalized.startsWith('rgb'))) return cssRgb(normalized);
    }
  }
  return [1, 1, 1];
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`Live ground program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

export function createLiveGroundLayer(gl: WebGL2RenderingContext, options: LiveGroundOptions): LiveLayer {
  let state: GlState | undefined;
  /** Baked tiles only (slot >= 0), by tileKey. */
  const tiles = new Map<number, Tile>();
  /** Map side the pyramid was built for; tiles are dropped when it changes. */
  let gridSize = 0;
  /** Content generation: a tile whose generation differs is stale (shown until re-baked). */
  let generation = 0;
  /** First generation of the current look (`lookChanged`), and when it began. Once tier 0 holds the current look, no
   * tile of an older look is drawn: a missing or older tile shows its nearest ancestor of this look instead. */
  let lookGeneration = 0,
    lookAt = -Infinity;
  /** Tiles below this generation are not drawn (set per frame: the current look's once its tier 0 is baked). */
  let shownFrom = 0;
  let seenRenderer: GroundTileRenderer | undefined,
    seenRevision = NaN;
  let blockedUntil = 0;
  let treeMaterials = false;
  const pagesFor = (quality: 'full' | 'light'): number => {
    const planes = treeMaterials ? 3 : 1;
    // Retain enough draped patches at low pitch; the full forest cache stays under 512 MiB.
    const bytes = options.budgetBytes ?? Math.min(512, (quality === 'light' ? 96 : 192) * planes) * 1048576;
    const limit = options.treeMaterials ? Math.floor((512 * 1048576) / (3 * PAGE_BYTES)) : MAX_PAGES;
    return Math.max(2, Math.min(limit, Math.floor(bytes / (planes * PAGE_BYTES))));
  };
  let maxPages = pagesFor('full');
  let light = false;
  /** Draw counter: tiles drawn by the last frame (`used === stamp`) are never evicted. */
  let stamp = 0;
  let paperCss = '',
    paper: [number, number, number] = [1, 1, 1];
  const opaqueItems = new Float32Array(MAX_ITEMS * FLOATS),
    fadeItems = new Float32Array(MAX_ITEMS * FLOATS);
  let opaqueCount = 0,
    fadeCount = 0;
  const instanceData = new Float32Array(MAX_ITEMS * 2 * FLOATS);
  /** Per draw: page, first instance, count. */
  const ranges = new Int32Array(2 * MAX_PAGES * 3);
  /** `patches`: squares of the terrain mesh in the last tilted frame; `patchUploads`: lists of squares sent to the GPU;
   * optional coarse-tile probes are owned by layerDiagnostics.ts. */
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, tiles: 0, bytes: 0, pending: 0, bakeMs: 0, baked: 0, tier: 0, patches: 0, patchUploads: 0 };
  const diagnostics = layerDiagnosticsEnabled() ? new GroundDiagnostics(stats) : undefined;
  /** The tiles the last tilted frame wanted and did not find fresh, with the depth of the square that wants each. */
  const wantedTier = new Uint8Array(MAX_WANTED),
    wantedX = new Int32Array(MAX_WANTED),
    wantedY = new Int32Array(MAX_WANTED),
    wantedDepth = new Float32Array(MAX_WANTED);
  let wantedCount = 0;
  /** Bumped whenever a tile is baked, dropped or made stale (DrapeTiles.revision). */
  let tileRevision = 0;
  // Scan result of nextBake.
  let foundTier = 0,
    foundX = 0,
    foundY = 0;

  const density0 = (): number => TILE / gridSize;
  const finestTier = (dpr: number): number => Math.max(0, Math.min(MAX_TIER, Math.ceil(Math.log2((MAX_SCALE * dpr) / density0()) - 1e-9)));
  /** Coarsest tier whose density is at least the frame's (device pixels per metre). */
  const viewTier = (frame: LiveFrame): number => Math.max(0, Math.min(finestTier(frame.dpr), Math.ceil(Math.log2((frame.view.scale * frame.dpr * (frame.quality === 'light' ? 0.5 : 1)) / density0()) - 1e-9)));

  function ensure(): GlState | undefined {
    if (state) return state;
    if (gl.isContextLost()) return undefined;
    const program = compile(gl, VS, FS);
    const vao = gl.createVertexArray()!,
      instances = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    for (const [location, size, offset] of [
      [0, 4, 0],
      [1, 4, 16],
      [2, 2, 32],
    ] as const) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, FLOATS * 4, offset);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const staging = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, staging);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, RENDER, RENDER);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const stagingFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, stagingFbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state = { program, uSize: gl.getUniformLocation(program, 'uSize'), uTiles: gl.getUniformLocation(program, 'uTiles'), vao, instances, staging, stagingFbo, pages: [], crownPages: new Map(), free: [] };
    return state;
  }

  function release(): void {
    if (state && !gl.isContextLost()) {
      gl.deleteProgram(state.program);
      gl.deleteVertexArray(state.vao);
      gl.deleteBuffer(state.instances);
      gl.deleteTexture(state.staging);
      gl.deleteFramebuffer(state.stagingFbo);
      for (const page of state.crownPages.values()) gl.deleteTexture(page);
      for (const page of state.pages) gl.deleteTexture(page);
    }
    state = undefined;
    tiles.clear();
  }

  /** Forgets every tile (new map size); pages stay allocated. */
  function resetTiles(size: number): void {
    gridSize = size;
    tiles.clear();
    tileRevision++;
    if (state) {
      state.free.length = 0;
      for (let slot = state.pages.length * LAYERS - 1; slot >= 0; slot--) state.free.push(slot);
    }
  }

  /** A free layer: a free slot, a new page within the budget, or the least recently drawn evictable tile; -1 if none. */
  function allocate(s: GlState): number {
    const free = s.free.pop();
    if (free !== undefined) return free;
    if (s.pages.length < maxPages) {
      const page = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, page);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE, TILE, LAYERS);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      const first = s.pages.length * LAYERS;
      s.pages.push(page);
      for (let slot = first + LAYERS - 1; slot > first; slot--) s.free.push(slot);
      return first;
    }
    let victim: Tile | undefined,
      victimKey = 0;
    for (const [key, tile] of tiles) {
      if (tile.tier < COARSE_TIERS || tile.used >= stamp) continue;
      if (!victim || tile.used < victim.used) {
        victim = tile;
        victimKey = key;
      }
    }
    if (!victim) return -1;
    tiles.delete(victimKey);
    return victim.slot;
  }

  function hasBakedAncestor(tier: number, ix: number, iy: number): boolean {
    for (let a = tier - 1; a >= 0; a--) if (tiles.has(tileKey(a, ix >> (tier - a), iy >> (tier - a)))) return true;
    return false;
  }
  const needs = (tier: number, ix: number, iy: number): boolean => {
    const tile = tiles.get(tileKey(tier, ix, iy));
    return !tile || tile.generation !== generation;
  };
  /** Tier 0 holds the current look: the whole map can be shown in it. */
  const lookBaked = (): boolean => (tiles.get(0)?.generation ?? -1) >= lookGeneration;
  /** The generation from which tiles may be drawn by this frame. */
  const drawFloor = (): number => (shownFrom = lookBaked() ? lookGeneration : -1);
  const drawable = (tile: Tile): boolean => tile.generation >= shownFrom && (!treeMaterials || tile.crowns || gridSize / (2 ** tile.tier * TILE) >= 32);

  /** The tile needing a bake nearest to (cx, cy) (distance from its centre: the picture refines from the centre of the
   * view outwards, in rings, never in rows or columns), within the world rectangle grown by `pad` tiles. */
  function scan(tier: number, minX: number, minY: number, maxX: number, maxY: number, cx: number, cy: number, pad: number): boolean {
    const n = 2 ** tier,
      ts = gridSize / n;
    if (maxX <= 0 || maxY <= 0 || minX >= gridSize || minY >= gridSize) return false;
    const x0 = Math.max(0, Math.floor(minX / ts) - pad),
      x1 = Math.min(n - 1, Math.ceil(maxX / ts) - 1 + pad);
    const y0 = Math.max(0, Math.floor(minY / ts) - pad),
      y1 = Math.min(n - 1, Math.ceil(maxY / ts) - 1 + pad);
    // In tile units from the point to each tile's centre.
    const px = cx / ts - 0.5,
      py = cy / ts - 0.5;
    let best = Infinity;
    for (let iy = y0; iy <= y1; iy++)
      for (let ix = x0; ix <= x1; ix++) {
        const d = (ix - px) ** 2 + (iy - py) ** 2;
        if (d < best && needs(tier, ix, iy)) {
          best = d;
          foundX = ix;
          foundY = iy;
        }
      }
    // Fresh tiles nearer than the next one to bake belong to the current plan: touched, they cannot be evicted for a
    // tile of lower priority (else a plan larger than the budget would bake and evict in a loop at rest).
    for (let iy = y0; iy <= y1; iy++)
      for (let ix = x0; ix <= x1; ix++) {
        const tile = tiles.get(tileKey(tier, ix, iy));
        if (tile && tile.generation === generation && (ix - px) ** 2 + (iy - py) ** 2 < best) tile.used = stamp;
      }
    if (best === Infinity) return false;
    foundTier = tier;
    return true;
  }

  /** The view's centre in the last top-view frame, its time, and the velocity of a moving view (metres per second). */
  let lastCx = NaN,
    lastCy = NaN,
    lastAt = 0,
    velX = 0,
    velY = 0;
  function track(frame: LiveFrame): void {
    const dt = (frame.now - lastAt) / 1000;
    if (!frame.moving) velX = velY = 0;
    else if (dt > 0 && dt < MOTION_GAP_S && Number.isFinite(lastCx)) {
      velX = velX * 0.5 + ((frame.view.cx - lastCx) / dt) * 0.5;
      velY = velY * 0.5 + ((frame.view.cy - lastCy) / dt) * 0.5;
    }
    lastCx = frame.view.cx;
    lastCy = frame.view.cy;
    lastAt = frame.now;
  }

  /** The next tile to bake, in priority order: tier 0 (one tile: no hole after it), the view at the wanted tier centre
   * outwards (what the user looks at; thin rivers and paths are under a pixel in the coarse tiers; a moving view from
   * where it is going), the other coarse
   * tiers, a ring of one tile around the view, the view one tier finer, then one tier coarser. */
  function nextBake(frame: LiveFrame | undefined): boolean {
    if (needs(0, 0, 0)) {
      foundTier = 0;
      foundX = 0;
      foundY = 0;
      return true;
    }
    let minX = 0,
      minY = 0,
      maxX = 0,
      maxY = 0,
      cx = 0,
      cy = 0,
      k = 0;
    const tilted = !!frame?.camera.tilted;
    if (tilted) {
      // What the squares of the tilted frame asked for, from the centre of the view outwards (PatchList.centreOffset).
      let nearest = -1;
      for (let i = 0; i < wantedCount; i++) if ((nearest < 0 || wantedDepth[i] < wantedDepth[nearest]) && needs(wantedTier[i], wantedX[i], wantedY[i])) nearest = i;
      if (nearest >= 0) {
        foundTier = wantedTier[nearest];
        foundX = wantedX[nearest];
        foundY = wantedY[nearest];
        return true;
      }
    } else if (frame) {
      const [sx, sy, tx, ty] = frame.worldToPixel;
      minX = -tx / sx;
      minY = -ty / sy;
      maxX = (frame.width - tx) / sx;
      maxY = (frame.height - ty) / sy;
      cx = frame.view.cx;
      cy = frame.view.cy;
      k = viewTier(frame);
      // A moving view first bakes where it is going: the view and the stretch it will uncover in the next LEAD_S,
      // nearest first to where it will then be centred (the leading edge before the trailing one).
      const ax = frame.moving ? velX * LEAD_S : 0,
        ay = frame.moving ? velY * LEAD_S : 0;
      if (scan(k, Math.min(minX, minX + ax), Math.min(minY, minY + ay), Math.max(maxX, maxX + ax), Math.max(maxY, maxY + ay), cx + ax, cy + ay, 0)) return true;
    }
    const coarse = Math.min(frame?.quality === 'light' ? 1 : COARSE_TIERS - 1, frame ? finestTier(frame.dpr) : COARSE_TIERS - 1);
    for (let tier = 1; tier <= coarse; tier++) {
      const n = 2 ** tier;
      for (let iy = 0; iy < n; iy++)
        for (let ix = 0; ix < n; ix++)
          if (needs(tier, ix, iy)) {
            foundTier = tier;
            foundX = ix;
            foundY = iy;
            return true;
          }
    }
    if (!frame || tilted) return false;
    return scan(k, minX, minY, maxX, maxY, cx, cy, 1) || (frame.quality !== 'light' && k + 1 <= finestTier(frame.dpr) && scan(k + 1, minX, minY, maxX, maxY, cx, cy, 0)) || (k > 0 && scan(k - 1, minX, minY, maxX, maxY, cx, cy, 0));
  }

  /** Visible tiles of the wanted tier and coarse tiles still to bake (stats only). */
  function countPending(frame: LiveFrame | undefined): number {
    let count = 0;
    for (let tier = 0; tier < (frame?.quality === 'light' ? 2 : COARSE_TIERS); tier++) {
      const n = 2 ** tier;
      for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) if (needs(tier, ix, iy)) count++;
    }
    if (!frame) return count;
    if (frame.camera.tilted) {
      for (let i = 0; i < wantedCount; i++) if (wantedTier[i] >= COARSE_TIERS && needs(wantedTier[i], wantedX[i], wantedY[i])) count++;
      return count;
    }
    const [sx, sy, tx, ty] = frame.worldToPixel,
      k = viewTier(frame),
      n = 2 ** k,
      ts = gridSize / n;
    const x0 = Math.max(0, Math.floor(-tx / sx / ts)),
      x1 = Math.min(n - 1, Math.ceil((frame.width - tx) / sx / ts) - 1);
    const y0 = Math.max(0, Math.floor(-ty / sy / ts)),
      y1 = Math.min(n - 1, Math.ceil((frame.height - ty) / sy / ts) - 1);
    if (k >= COARSE_TIERS) for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) if (needs(k, ix, iy)) count++;
    return count;
  }

  /** Renders, uploads and copies one tile. 'blocked': the renderer cannot draw now; 'full': no layer is free. */
  function bake(s: GlState, renderer: GroundTileRenderer, tier: number, ix: number, iy: number): 'ok' | 'blocked' | 'full' {
    const key = tileKey(tier, ix, iy),
      existing = tiles.get(key);
    const ts = gridSize / 2 ** tier,
      g = (GUTTER * ts) / TILE,
      x = ix * ts,
      y = iy * ts;
    const box: Rect4 = { minX: x - g, minY: y - g, maxX: x + ts + g, maxY: y + ts + g };
    // Render first: a refused render must not cost an eviction.
    const crowns = treeMaterials && ts / TILE < 32;
    const source = renderer.renderWorldTile(box, RENDER);
    if (!source || (source as HTMLCanvasElement).width !== RENDER || (source as HTMLCanvasElement).height !== RENDER) return 'blocked';
    const slot = existing ? existing.slot : allocate(s);
    if (slot < 0) return 'full';
    const copy = (pixels: TexImageSource, plane: number): void => {
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.staging);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.stagingFbo);
      const page = Math.floor(slot / LAYERS);
      let texture = s.pages[page];
      if (plane > 0) {
        const held = s.crownPages.get(page);
        if (held) texture = held;
        else {
          texture = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE, TILE, 2 * LAYERS);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          s.crownPages.set(page, texture);
        }
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
      gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, (slot % LAYERS) + (plane === 2 ? LAYERS : 0), GUTTER, GUTTER, TILE, TILE);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    };
    copy(source, 0);
    if (crowns) {
      for (const mode of ['floor', 'keys'] as const) {
        const extra = renderer.renderWorldTile(box, RENDER, mode);
        if (!extra) {
          tiles.delete(key);
          s.free.push(slot);
          return 'blocked';
        }
        copy(extra, mode === 'floor' ? 1 : 2);
      }
    }
    if (existing) {
      // Replaced in place: no fade over its stale self; a tile of another look was not drawn, it fades in over its ancestor.
      if (existing.generation < lookGeneration) existing.shownAt = tier > 0 ? performance.now() : -Infinity;
      existing.generation = generation;
      existing.crowns = crowns;
    } else tiles.set(key, { tier, ix, iy, slot, generation, crowns, used: stamp, shownAt: hasBakedAncestor(tier, ix, iy) ? performance.now() : -Infinity });
    tileRevision++;
    return 'ok';
  }

  /** The tile is shown by the frame (directly or as an ancestor of a shown tile). */
  function shown(frame: LiveFrame, tier: number, ix: number, iy: number): boolean {
    // A tilted frame is selected again for any new tile (DrapeTiles.revision).
    if (frame.camera.tilted) return true;
    if (tier > viewTier(frame)) return false;
    const [sx, sy, tx, ty] = frame.worldToPixel,
      ts = gridSize / 2 ** tier;
    return ix * ts * sx + tx < frame.width && (ix + 1) * ts * sx + tx > 0 && iy * ts * sy + ty < frame.height && (iy + 1) * ts * sy + ty > 0;
  }

  function pushItem(items: Float32Array, index: number, x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, slot: number, alpha: number): void {
    const o = index * FLOATS;
    items[o] = x0;
    items[o + 1] = y0;
    items[o + 2] = x1;
    items[o + 3] = y1;
    items[o + 4] = u0;
    items[o + 5] = v0;
    items[o + 6] = u1;
    items[o + 7] = v1;
    items[o + 8] = slot;
    items[o + 9] = alpha;
  }

  /** The nearest baked ancestor's sub-rectangle for tile (tier, ix, iy) as an opaque item; false if none. */
  function pushAncestor(tier: number, ix: number, iy: number, x0: number, y0: number, x1: number, y1: number): boolean {
    for (let a = tier - 1; a >= 0; a--) {
      const shift = tier - a,
        ax = ix >> shift,
        ay = iy >> shift,
        tile = tiles.get(tileKey(a, ax, ay));
      if (!tile || !drawable(tile)) continue;
      tile.used = stamp;
      const span = 1 / 2 ** shift,
        u0 = (ix - (ax << shift)) * span,
        v0 = (iy - (ay << shift)) * span;
      if (opaqueCount < MAX_ITEMS) pushItem(opaqueItems, opaqueCount++, x0, y0, x1, y1, u0, v0, u0 + span, v0 + span, tile.slot, 1);
      return true;
    }
    return false;
  }

  /** The tiles as the draped ground of a tilted frame reads them. */
  const drapeTiles: DrapeTiles = {
    tilePixels: TILE,
    mapSize: () => gridSize,
    finestTier,
    revision: () => tileRevision,
    begin(): void {
      stamp++;
      wantedCount = 0;
      drawFloor();
    },
    resolve(squareTier: number, sx: number, sy: number, tier: number, priority: number, out: DrapeTile): boolean {
      if (light) tier = Math.max(0, tier - 1);
      const shift = squareTier - tier,
        ix = sx >> shift,
        iy = sy >> shift;
      if (wantedCount < MAX_WANTED && needs(tier, ix, iy)) {
        wantedTier[wantedCount] = tier;
        wantedX[wantedCount] = ix;
        wantedY[wantedCount] = iy;
        wantedDepth[wantedCount++] = priority;
      }
      const tile = findTile(tiles, squareTier, sx, sy, tier, out, drawable);
      if (!tile) return false;
      tile.used = stamp;
      out.page = Math.floor(tile.slot / LAYERS);
      out.layer = tile.slot % LAYERS;
      out.crowns = tile.crowns;
      return true;
    },
    pageCount: () => state?.pages.length ?? 0,
    page: index => state!.pages[index],
    crownPage: index => state!.crownPages.get(index),
  };
  /** The ground of the tilted frames; made with the first relief or the first tilted frame. */
  let draped: DrapedGround | undefined;
  const paperRgb = (): [number, number, number] => {
    const css = options.paper();
    if (css !== paperCss) {
      paperCss = css;
      paper = cssRgb(css);
    }
    return paper;
  };

  return {
    name: 'ground',
    tilts: true,

    ready(frame: LiveFrame): boolean {
      // Tier 0 covers the whole map (any generation: stale tiles stay on screen); the paper covers the rest.
      // After a look switch, tier 0 of the new look first: until then the page keeps its last picture whole rather than
      // show the old look's tiles under the new look's other layers.
      return !!state && gridSize > 0 && options.mapSize() === gridSize && tiles.has(0) && frame.width > 0 && (lookBaked() || performance.now() - lookAt > LOOK_HOLD_MS);
    },

    /** The tiles are the ground: a finer tile that arrives refines this picture, no other renderer replaces it. */
    restExact: () => true,

    draw(frame: LiveFrame): void {
      const s = state;
      if (!s) return;
      const started = performance.now();
      light = frame.quality === 'light';
      if (frame.camera.tilted) {
        draped ??= new DrapedGround(gl, drapeTiles);
        draped.draw(frame, options.terrain(), paperRgb(), options.cave?.(), options.night?.(), options.treeSelection?.(frame)?.image());
        stats.drawCalls = draped.stats.drawCalls;
        stats.triangles = draped.stats.triangles;
        stats.patches = draped.stats.patches;
        stats.patchUploads = draped.stats.uploads;
        diagnostics?.tiltedFrame(draped.stats.otherTier, draped.stats.drapeOtherTier);
        stats.ms = performance.now() - started;
        return;
      }
      stamp++;
      drawFloor();
      track(frame);
      paperRgb();
      gl.clearColor(paper[0], paper[1], paper[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const sx = frame.worldToPixel[0],
        sy = frame.worldToPixel[1],
        tx = frame.worldToPixel[2],
        ty = frame.worldToPixel[3];
      const k = viewTier(frame),
        n = 2 ** k,
        ts = gridSize / n;
      const minX = -tx / sx,
        minY = -ty / sy,
        maxX = (frame.width - tx) / sx,
        maxY = (frame.height - ty) / sy;
      opaqueCount = 0;
      fadeCount = 0;
      let fading = false;
      if (maxX > 0 && maxY > 0 && minX < gridSize && minY < gridSize) {
        const x0 = Math.max(0, Math.floor(minX / ts)),
          x1 = Math.min(n - 1, Math.ceil(maxX / ts) - 1);
        const y0 = Math.max(0, Math.floor(minY / ts)),
          y1 = Math.min(n - 1, Math.ceil(maxY / ts) - 1);
        for (let iy = y0; iy <= y1; iy++) {
          // Edges from the same expression for both neighbours: no gap, no overlap.
          const py0 = iy * ts * sy + ty,
            py1 = (iy + 1) * ts * sy + ty;
          for (let ix = x0; ix <= x1; ix++) {
            const px0 = ix * ts * sx + tx,
              px1 = (ix + 1) * ts * sx + tx;
            const key = tileKey(k, ix, iy),
              tile = tiles.get(key);
            if (!tile || !drawable(tile)) {
              diagnostics?.ancestor(key, frame.now);
              pushAncestor(k, ix, iy, px0, py0, px1, py1);
              continue;
            }
            tile.used = stamp;
            const alpha = Math.min(1, (frame.now - tile.shownAt) / FADE_MS);
            if (alpha < 1 && pushAncestor(k, ix, iy, px0, py0, px1, py1)) {
              fading = true;
              if (fadeCount < MAX_ITEMS) pushItem(fadeItems, fadeCount++, px0, py0, px1, py1, 0, 0, 1, 1, tile.slot, alpha);
            } else if (opaqueCount < MAX_ITEMS) pushItem(opaqueItems, opaqueCount++, px0, py0, px1, py1, 0, 0, 1, 1, tile.slot, 1);
          }
        }
      }
      // Instances grouped by page: opaque items first, fading ones over them.
      let used = 0,
        draws = 0;
      for (let pass = 0; pass < 2; pass++) {
        const items = pass ? fadeItems : opaqueItems,
          count = pass ? fadeCount : opaqueCount;
        for (let page = 0; page < s.pages.length; page++) {
          const first = used;
          for (let i = 0; i < count; i++) {
            const o = i * FLOATS,
              slot = items[o + 8];
            if (Math.floor(slot / LAYERS) !== page) continue;
            const d = used * FLOATS;
            for (let c = 0; c < 8; c++) instanceData[d + c] = items[o + c];
            instanceData[d + 8] = slot - page * LAYERS;
            instanceData[d + 9] = items[o + 9];
            used++;
          }
          if (used > first) {
            ranges[draws * 3] = page;
            ranges[draws * 3 + 1] = first;
            ranges[draws * 3 + 2] = used - first;
            draws++;
          }
        }
      }
      if (draws) {
        gl.useProgram(s.program);
        gl.uniform2f(s.uSize, frame.width, frame.height);
        gl.uniform1i(s.uTiles, 0);
        gl.bindVertexArray(s.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.instances);
        gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW, 0, used * FLOATS);
        gl.activeTexture(gl.TEXTURE0);
        // Premultiplied source-over (resetLiveState): opaque tiles replace, fading ones blend over their ancestor.
        for (let d = 0; d < draws; d++) {
          const first = ranges[d * 3 + 1];
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.pages[ranges[d * 3]]);
          gl.vertexAttribPointer(0, 4, gl.FLOAT, false, FLOATS * 4, first * FLOATS * 4);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, first * FLOATS * 4 + 16);
          gl.vertexAttribPointer(2, 2, gl.FLOAT, false, FLOATS * 4, first * FLOATS * 4 + 32);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ranges[d * 3 + 2]);
        }
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
      diagnostics?.topFrame(frame.now);
      stats.drawCalls = draws;
      stats.triangles = used * 2;
      stats.tier = k;
      stats.ms = performance.now() - started;
      if (fading) options.invalidate();
    },

    work(budgetMs: number, frame: LiveFrame | undefined): boolean {
      if (gl.isContextLost()) return false;
      const size = options.mapSize();
      if (!(size > 0)) return false;
      const s = ensure();
      if (!s) return false;
      if (size !== gridSize) resetTiles(size);
      // A tilted frame shows up to 134 tiles of several tiers (tests/world.drapeBudget.test.ts) whatever the quality:
      // the light budget (96 tiles) would evict, as the camera moves, tiles a few frames from being shown again.
      if (frame) maxPages = pagesFor(frame.camera.tilted ? 'full' : frame.quality);
      // The relief goes up once per terrain, before the camera first tilts.
      const heights = options.terrain();
      if (heights) (draped ??= new DrapedGround(gl, drapeTiles)).prepare(heights);
      const renderer = options.renderer();
      if (!renderer) return false;
      const revision = renderer.contentRevision();
      light = frame?.quality === 'light';
      const crowns = options.treeMaterials?.() ?? false;
      if (renderer !== seenRenderer || revision !== seenRevision || crowns !== treeMaterials) {
        treeMaterials = crowns;
        seenRenderer = renderer;
        seenRevision = revision;
        generation++;
        tileRevision++;
      }
      const started = performance.now();
      if (started < blockedUntil) return true;
      const limit = frame?.moving ? MOVING_BAKES : 4;
      let baked = 0,
        arrived = false,
        pending = false;
      try {
        while (nextBake(frame)) {
          if (baked >= limit || performance.now() - started >= budgetMs) {
            pending = true;
            break;
          }
          const t = performance.now(),
            result = bake(s, renderer, foundTier, foundX, foundY);
          if (result === 'blocked') {
            blockedUntil = performance.now() + RETRY_MS;
            pending = true;
            break;
          }
          // No layer can be freed before the next frame marks what it still shows.
          if (result === 'full') break;
          baked++;
          stats.baked++;
          stats.bakeMs = performance.now() - t;
          if (foundTier === 0 || (frame && shown(frame, foundTier, foundX, foundY))) arrived = true;
        }
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, frame?.target ?? null);
      }
      stats.tiles = tiles.size;
      stats.bytes = (s.pages.length + s.crownPages.size * 2) * PAGE_BYTES;
      stats.pending = countPending(frame);
      if (arrived) options.invalidate();
      return pending;
    },

    invalidate(): void {
      generation++;
      tileRevision++;
    },

    lookChanged(): void {
      generation++;
      tileRevision++;
      lookGeneration = generation;
      lookAt = performance.now();
      // The frame that lets the old tiles show if tier 0 of the new look cannot be baked in time (`ready`).
      setTimeout(options.invalidate, LOOK_HOLD_MS + 1);
    },

    contextLost(): void {
      state = undefined;
      draped?.contextLost();
      wantedCount = 0;
      tileRevision++;
      tiles.clear();
      gridSize = 0;
      seenRenderer = undefined;
      seenRevision = NaN;
      blockedUntil = 0;
    },

    stats(): LiveLayerStats {
      return stats;
    },

    dispose(): void {
      if (!gl.isContextLost()) draped?.dispose();
      draped = undefined;
      release();
      gridSize = 0;
    },
  };
}
