/** Device-resolution white coverage; colours belong to instances, never to cached sprites. */
import type { Symbol as LabelSymbol } from '../labelStyles';

export const GLYPH_ATLAS_SIZE = 2048;

export interface ShelfRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Append-only shelves leave a transparent gutter on all four sides, including page edges. */
export class ShelfPacker {
  private page = 0;
  private x = 0;
  private y = 0;
  private rowHeight = 0;
  private count = 0;

  constructor(
    readonly size = GLYPH_ATLAS_SIZE,
    readonly padding = 1,
  ) {
    if (!Number.isInteger(size) || size < 1 || !Number.isInteger(padding) || padding < 0 || 2 * padding >= size) {
      throw new RangeError('Invalid glyph atlas dimensions');
    }
  }

  get pages(): number {
    return this.count;
  }

  allocate(w: number, h: number): ShelfRect {
    const width = w + 2 * this.padding,
      height = h + 2 * this.padding;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || width > this.size || height > this.size) {
      throw new RangeError('Glyph sprite exceeds an atlas page');
    }
    if (this.x + width > this.size) {
      this.x = 0;
      this.y += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.y + height > this.size) {
      this.page++;
      this.x = 0;
      this.y = 0;
      this.rowHeight = 0;
    }
    const rect = { page: this.page, x: this.x + this.padding, y: this.y + this.padding, w, h };
    this.x += width;
    this.rowHeight = Math.max(this.rowHeight, height);
    this.count = this.page + 1;
    return rect;
  }
}

export interface AtlasSprite extends ShelfRect {
  /** Raster bounds relative to the Canvas text/symbol origin, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}
export type TextColour = readonly [number, number, number, number];
type RasterCanvas = OffscreenCanvas | HTMLCanvasElement;
type RasterContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export class GlyphAtlas {
  private packer = new ShelfPacker();
  private textures: WebGLTexture[] = [];
  private sprites = new Map<string, readonly AtlasSprite[]>();
  private colours = new Map<string, TextColour>();
  private scratch: { canvas: RasterCanvas; ctx: RasterContext } | undefined;
  uploads = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get pages(): number {
    return this.textures.length;
  }
  get size(): number {
    return this.uploads;
  }
  texture(page: number): WebGLTexture {
    return this.textures[page];
  }

  private surface(): { canvas: RasterCanvas; ctx: RasterContext } {
    if (!this.scratch) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as RasterContext | null;
      if (!ctx) throw new Error('Live text requires a Canvas 2D raster context');
      this.scratch = { canvas, ctx };
    }
    return this.scratch;
  }

  /** Canvas parses every CSS colour the exact renderer accepts, including alpha and named colours. Work only. */
  colour(css: string, opacity = 1): TextColour {
    let c = this.colours.get(css);
    if (!c) {
      const { canvas, ctx } = this.surface();
      canvas.width = 1;
      canvas.height = 1;
      ctx.fillStyle = '#000000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const rgba = ctx.getImageData(0, 0, 1, 1).data,
        a = rgba[3] / 255;
      c = [(rgba[0] / 255) * a, (rgba[1] / 255) * a, (rgba[2] / 255) * a, a];
      this.colours.set(css, c);
    }
    const a = Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : 1;
    return a === 1 ? c : [c[0] * a, c[1] * a, c[2] * a, c[3] * a];
  }

  glyph(font: string, ch: string, halo: number, dpr: number): readonly AtlasSprite[] {
    const direction = /[\u0590-\u08ff]/u.test(ch) ? 'rtl' : 'ltr';
    const key = JSON.stringify(['glyph', font, ch, halo, dpr, direction]),
      hit = this.sprites.get(key);
    if (hit) return hit;
    const { ctx } = this.surface();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = direction;
    const m = ctx.measureText(ch),
      pad = halo / 2 + 2 / dpr;
    const left = Math.floor((-m.actualBoundingBoxLeft - pad) * dpr),
      top = Math.floor((-m.actualBoundingBoxAscent - pad) * dpr);
    const right = Math.ceil((m.actualBoundingBoxRight + pad) * dpr),
      bottom = Math.ceil((m.actualBoundingBoxDescent + pad) * dpr);
    return this.raster(key, left, top, Math.max(1, right - left), Math.max(1, bottom - top), dpr, c => {
      c.font = font;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.direction = direction;
      c.lineJoin = 'round';
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#ffffff';
      if (halo > 0) {
        c.lineWidth = halo;
        c.strokeText(ch, 0, 0);
      } else c.fillText(ch, 0, 0);
    });
  }

  symbol(shape: LabelSymbol | undefined, r: number, dpr: number): readonly AtlasSprite[] {
    const key = JSON.stringify(['symbol', shape ?? 'dot', r, dpr]),
      hit = this.sprites.get(key);
    if (hit) return hit;
    const extent = Math.ceil((r * 1.25 + 0.8) * dpr + 2);
    return this.raster(key, -extent, -extent, 2 * extent, 2 * extent, dpr, c => {
      c.lineWidth = 1.1;
      c.lineJoin = 'round';
      c.lineCap = 'butt';
      c.strokeStyle = '#ffffff';
      c.fillStyle = '#ffffff';
      c.beginPath();
      switch (shape) {
        case 'cross':
          c.moveTo(0, -r * 1.25);
          c.lineTo(0, r * 1.25);
          c.moveTo(-r * 0.85, -r * 0.3);
          c.lineTo(r * 0.85, -r * 0.3);
          c.lineWidth = 1.6;
          c.stroke();
          break;
        case 'tri':
          c.moveTo(0, -r * 1.1);
          c.lineTo(r * 1.1, r * 0.8);
          c.lineTo(-r * 1.1, r * 0.8);
          c.closePath();
          c.fill();
          break;
        case 'square':
          c.rect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
          c.fill();
          break;
        case 'ring':
          c.arc(0, 0, r * 0.7, 0, Math.PI * 2);
          c.stroke();
          break;
        default:
          c.arc(0, 0, r * 0.75, 0, Math.PI * 2);
          c.fill();
      }
    });
  }

  private raster(key: string, left: number, top: number, w: number, h: number, dpr: number, draw: (ctx: RasterContext) => void): readonly AtlasSprite[] {
    const result: AtlasSprite[] = [],
      { canvas, ctx } = this.surface();
    // Joining scripts are single shaped runs, potentially wider than a page. Neighbour coverage in a one-texel
    // overlap keeps bilinear sampling continuous at tile seams; the shelf still reserves its transparent gutter.
    const tileSize = GLYPH_ATLAS_SIZE - 4;
    for (let y = 0; y < h; y += tileSize)
      for (let x = 0; x < w; x += tileSize) {
        const width = Math.min(tileSize, w - x),
          height = Math.min(tileSize, h - y);
        const rect = this.packer.allocate(width + 2, height + 2);
        canvas.width = width + 2;
        canvas.height = height + 2;
        ctx.setTransform(dpr, 0, 0, dpr, -(left + x - 1), -(top + y - 1));
        draw(ctx);
        this.upload(rect, canvas);
        result.push({ page: rect.page, x: rect.x + 1, y: rect.y + 1, w: width, h: height, left: (left + x) / dpr, top: (top + y) / dpr, width: width / dpr, height: height / dpr });
      }
    this.sprites.set(key, result);
    return result;
  }

  private upload(rect: ShelfRect, canvas: RasterCanvas): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    if (!this.textures[rect.page]) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Cannot allocate a live glyph atlas page');
      this.textures[rect.page] = texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, GLYPH_ATLAS_SIZE, GLYPH_ATLAS_SIZE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else gl.bindTexture(gl.TEXTURE_2D, this.textures[rect.page]);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.uploads++;
  }

  /** Lost contexts cannot delete old handles. All metadata is discarded so a restored context uploads every sprite. */
  reset(deleteHandles = true): void {
    if (deleteHandles) for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures = [];
    this.sprites.clear();
    this.colours.clear();
    this.packer = new ShelfPacker();
    this.uploads = 0;
  }

  dispose(): void {
    this.reset();
    this.scratch = undefined;
  }
}
