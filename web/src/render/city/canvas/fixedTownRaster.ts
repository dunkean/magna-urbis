/** A town sheet baked at fixed physical resolutions: a draft, shown as soon as it is complete, then the fine sheet, which
 * replaces it town by town. Zooming only samples retained tiles. The map drape waits for the draft alone: while a source
 * of it is not ready, no tile of any layer is shown on a tilted map. */
import type { Rect4, View } from '../../view';
import type { LiveFrame, LiveLayer } from '../../live/contract';
import { finishProgram, programLinked, startProgram, type Program, type PendingProgram } from '../gl/programs';

type Surface = HTMLCanvasElement | OffscreenCanvas;
export interface TownRasterTile {
  rect: Rect4;
  scale: number;
  canvas: Surface;
  ready: boolean;
  town: number;
  fine: boolean;
}
/** Definition of the fine sheets: pixels per metre a small town gets, and the pixels of one town and of all the towns
 * together (each pixel costs four bytes of canvas and as much of texture). */
const SHEET_SCALE = 8;
export const TOWN_SHEET_PIXELS = 24e6,
  ALL_SHEET_PIXELS = 36e6;
/** Draft of a town: pixels per metre, side and pixels. A fine sheet that is hardly finer than its draft is not made. */
const DRAFT_SCALE = 4,
  DRAFT_SIDE = 4096,
  DRAFT_PIXELS = 4e6,
  FINE_GAIN = 1.25;
export function townRasterLayout(bounds: readonly Rect4[]): { rect: Rect4; scale: number; width: number; height: number; town: number; fine: boolean }[] {
  // A placed town without an urban plan has the empty extent (+Infinity, -Infinity).
  // It has no pixels to bake; passing that rectangle to the spatial bins cannot terminate.
  const sheets = bounds.flatMap((b, town) => {
    if (![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) || b.maxX < b.minX || b.maxY < b.minY) return [];
    const width = Math.max(1, b.maxX - b.minX + 16),
      height = Math.max(1, b.maxY - b.minY + 16);
    return [{ b, town, width, height, pixels: Math.min(TOWN_SHEET_PIXELS, SHEET_SCALE ** 2 * width * height) }];
  });
  // Many towns share the total in proportion to what each asks for.
  const share = Math.min(1, ALL_SHEET_PIXELS / sheets.reduce((sum, s) => sum + s.pixels, 1));
  const draftScale = ({ width, height }: (typeof sheets)[number]): number => Math.min(DRAFT_SCALE, DRAFT_SIDE / width, DRAFT_SIDE / height, Math.sqrt(DRAFT_PIXELS / (width * height))),
    fineScale = ({ width, height, pixels }: (typeof sheets)[number]): number => Math.sqrt((pixels * share) / (width * height));
  const tiles = ({ b, town, width, height }: (typeof sheets)[number], scale: number, fine: boolean) => {
    const out = [];
    for (let y = 0; y < Math.ceil(height * scale); y += 1024)
      for (let x = 0; x < Math.ceil(width * scale); x += 1024) {
        const w = Math.min(1024, Math.ceil(width * scale) - x),
          h = Math.min(1024, Math.ceil(height * scale) - y);
        const minX = b.minX - 8 + x / scale,
          minY = b.minY - 8 + y / scale;
        out.push({ rect: { minX, minY, maxX: minX + w / scale, maxY: minY + h / scale }, scale, width: w, height: h, town, fine });
      }
    return out;
  };
  // Every draft first: it is the picture until the fine sheet of its town is complete.
  return [...sheets.flatMap(s => tiles(s, draftScale(s), false)), ...sheets.filter(s => fineScale(s) > FINE_GAIN * draftScale(s)).flatMap(s => tiles(s, fineScale(s), true))];
}
export class FixedTownRaster {
  key = '';
  tiles: TownRasterTile[] = [];
  private job?: { tile: TownRasterTile; steps: Generator<void, void> };
  constructor(private canvas: (w: number, h: number) => Surface | undefined) {}
  ensure(key: string, bounds: readonly Rect4[]): void {
    if (this.key === key) return;
    this.clear();
    this.key = key;
    this.tiles = townRasterLayout(bounds).flatMap(t => {
      const canvas = this.canvas(t.width, t.height);
      return canvas ? [{ rect: t.rect, scale: t.scale, canvas, town: t.town, fine: t.fine, ready: false }] : [];
    });
  }
  /** The drafts are painted: every town can be shown. */
  get ready(): boolean {
    return this.tiles.every(t => t.fine || t.ready);
  }
  /** The tiles that make the picture: of a town, its fine sheet once every tile of it is `there`, else its draft. */
  shown(there: (tile: TownRasterTile) => boolean): TownRasterTile[] {
    const fine = new Set(this.tiles.filter(t => t.fine).map(t => t.town));
    for (const t of this.tiles) if (t.fine && !there(t)) fine.delete(t.town);
    return this.tiles.filter(t => t.fine === fine.has(t.town) && there(t));
  }
  work(paint: (ctx: CanvasRenderingContext2D, tile: TownRasterTile) => Generator<void, void>, budget = Infinity): boolean {
    const start = performance.now();
    do {
      if (!this.job) {
        const tile = this.tiles.find(t => !t.ready);
        if (!tile) return false;
        const ctx = tile.canvas.getContext('2d') as CanvasRenderingContext2D | null;
        if (!ctx) {
          tile.ready = true;
          continue;
        }
        this.job = { tile, steps: paint(ctx, tile) };
      }
      if (this.job.steps.next().done) {
        this.job.tile.ready = true;
        this.job = undefined;
      }
    } while (performance.now() - start < budget);
    return this.tiles.some(t => !t.ready);
  }
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dpr: number, alpha: number): void {
    ctx.save();
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, (w / 2 - view.cx * view.scale) * dpr, (h / 2 - view.cy * view.scale) * dpr);
    ctx.globalAlpha *= alpha;
    ctx.imageSmoothingQuality = 'high';
    for (const t of this.shown(tile => tile.ready)) ctx.drawImage(t.canvas, t.rect.minX, t.rect.minY, t.rect.maxX - t.rect.minX, t.rect.maxY - t.rect.minY);
    ctx.restore();
  }
  clear(): void {
    this.job?.steps.return(undefined);
    this.job = undefined;
    for (const t of this.tiles) t.canvas.width = t.canvas.height = 1;
    this.tiles = [];
    this.key = '';
  }
}
const VS = `#version 300 es
uniform mat3 uM; uniform vec4 uRect; out vec2 vUv;
void main(){vec2 c=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));vUv=c;vec3 p=uM*vec3(mix(uRect.xy,uRect.zw,c),1.);gl_Position=vec4(p.xy,0.,1.);}`;
const FS = `#version 300 es
precision mediump float; uniform sampler2D uTex; in vec2 vUv; out vec4 color;
void main(){color=texture(uTex,vUv);}`;
/** GPU presentation of the same sheet used by exports and Canvas fallback. No geometry replay. */
export function fixedTownRasterLayer(gl: WebGL2RenderingContext, raster: FixedTownRaster, prepare: (budget: number) => boolean, opacity: () => number): LiveLayer {
  // Without the extension its status reads null for ever: the program is then linked on the spot.
  const parallelLink = !!gl.getExtension('KHR_parallel_shader_compile');
  let program: Program | undefined,
    pending: PendingProgram | undefined,
    vao: WebGLVertexArrayObject | null = null,
    key = '',
    revision = 0;
  const textures = new Map<TownRasterTile, WebGLTexture>();
  /** The tiles drawn (FixedTownRaster.shown of the uploaded ones). */
  let shown: TownRasterTile[] = [];
  const drop = (handles = true): void => {
    if (handles) {
      for (const t of textures.values()) gl.deleteTexture(t);
      if (program) gl.deleteProgram(program.program);
      if (pending) gl.deleteProgram(pending.program);
      if (vao) gl.deleteVertexArray(vao);
    }
    textures.clear();
    shown = [];
    program = pending = undefined;
    vao = null;
    key = '';
  };
  const ready = (): boolean => key === raster.key && !!program && raster.tiles.every(t => t.fine || textures.has(t));
  const stats = { drawCalls: 0, triangles: 0, ms: 0 };
  return {
    name: 'city',
    isolated: true,
    opacity,
    ready,
    restExact: ready,
    work(budget) {
      const more = prepare(budget);
      if (key !== raster.key) {
        for (const t of textures.values()) gl.deleteTexture(t);
        textures.clear();
        shown = [];
        key = raster.key;
        revision++;
      }
      pending ??= program ? undefined : startProgram(gl, VS, FS);
      if (!program && pending && programLinked(gl, pending, parallelLink)) {
        program = finishProgram(gl, pending);
        pending = undefined;
        vao = gl.createVertexArray();
      }
      for (const tile of raster.tiles)
        if (tile.ready && !textures.has(tile)) {
          const texture = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, tile.canvas);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
          // The sheet is much finer than a view of the whole town: its mipmaps keep the outlines from aliasing there.
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          textures.set(tile, texture);
          const next = raster.shown(t => textures.has(t));
          // The drape bakes its tiles again only when the picture changes: a draft tile more, a town turned fine.
          if (next.length !== shown.length || next.some((t, i) => t !== shown[i])) {
            shown = next;
            revision++;
          }
          return true;
        }
      return more || !ready();
    },
    draw(frame: LiveFrame) {
      if (!program) return;
      stats.drawCalls = stats.triangles = 0;
      gl.useProgram(program.program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix3fv(program.u.uM, false, frame.worldToClip);
      gl.uniform1i(program.u.uTex, 0);
      for (const t of shown) {
        const r = t.rect;
        if (r.minX > frame.rect.maxX || r.maxX < frame.rect.minX || r.minY > frame.rect.maxY || r.maxY < frame.rect.minY) continue;
        gl.bindTexture(gl.TEXTURE_2D, textures.get(t)!);
        gl.uniform4f(program.u.uRect, r.minX, r.minY, r.maxX, r.maxY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        stats.drawCalls++;
        stats.triangles += 2;
      }
    },
    drape: {
      revision: () => revision,
      ready,
      paint(c) {
        for (const t of shown) {
          const r = t.rect,
            w = r.maxX - r.minX,
            h = r.maxY - r.minY;
          c.put(textures.get(t)!, (c.rect.minX - r.minX) / w, (c.rect.minY - r.minY) / h, (c.rect.maxX - r.minX) / w, (c.rect.maxY - r.minY) / h, opacity());
        }
      },
    },
    contextLost: () => drop(false),
    stats: () => stats,
    dispose: () => drop(),
  };
}
