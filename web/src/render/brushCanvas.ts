import type { World } from '../gen/types';
import type { Palette } from './styles';
import type { CanvasLike } from './canvas';
import { RecordingContext } from './gpu/recorder';
import { BRUSH_ATLAS, BRUSH_CELL, brushCell, brushColorMatrix, brushMotif, type BrushImages, type BrushKind, type BrushMotif } from './brushes';

const PATTERN_BYTES = 16 * 1024 * 1024;
interface MotifTile {
  image: CanvasImageSource;
  bytes: number;
  native?: CanvasPattern;
  recorded?: CanvasPattern;
}
interface RecordedMotif {
  kind: BrushKind;
  width: number;
  motif: BrushMotif;
  seed: string;
  biome: World['options']['biome'];
  source: WeakRef<BrushImages>;
}
/** One active renderer owns bounded motifs; decoded atlas images are shared by the UI/worker. */
export class CanvasBrushes {
  private motifs = new Map<string, MotifTile>();
  private readonly layouts = new Map<BrushKind, BrushMotif>();
  readonly recordedMotifs = new WeakMap<CanvasImageSource, RecordedMotif>();
  /** Finished pixels can retain this identity without keeping the tinted atlases alive. */
  readonly pigments = {};
  private readonly source: WeakRef<BrushImages>;
  private bytes = 0;
  private tintBytes = 0;
  private atlases: Pick<BrushImages, 'vegetation' | 'terrain'>;
  constructor(
    private world: World,
    private pal: Palette,
    images: BrushImages,
    private makeCanvas: (w: number, h: number) => CanvasLike | null,
  ) {
    const matrix = brushColorMatrix(pal);
    this.source = new WeakRef(images);
    this.atlases = { vegetation: images.vegetation, terrain: images.terrain };
    if (!matrix) return;
    // Once per appearance, never during a frame. Alpha and each atlas cell remain unchanged.
    for (const key of ['vegetation', 'terrain'] as const) {
      const c = makeCanvas(BRUSH_ATLAS, BRUSH_ATLAS),
        ctx = c?.getContext('2d');
      if (!c || !ctx) throw new Error('Brush tint canvas unavailable');
      ctx.drawImage(images[key], 0, 0);
      const data = ctx.getImageData(0, 0, BRUSH_ATLAS, BRUSH_ATLAS);
      for (let i = 0; i < data.data.length; i += 4) {
        const r = data.data[i] / 255,
          g = data.data[i + 1] / 255,
          b = data.data[i + 2] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const j = channel * 5;
          data.data[i + channel] = Math.round(255 * Math.max(0, Math.min(1, matrix[j] * r + matrix[j + 1] * g + matrix[j + 2] * b + matrix[j + 4])));
        }
      }
      this.tintBytes += BRUSH_ATLAS * BRUSH_ATLAS * 4;
      ctx.putImageData(data, 0, 0);
      this.atlases[key] = c as unknown as CanvasImageSource;
    }
  }

  private stamp(ctx: CanvasRenderingContext2D, atlas: 'vegetation' | 'terrain', cell: number, x: number, y: number, size: number): void {
    ctx.drawImage(this.atlases[atlas], (cell % 6) * BRUSH_CELL, Math.floor(cell / 6) * BRUSH_CELL, BRUSH_CELL, BRUSH_CELL, x - size / 2, y - size / 2, size, size);
  }

  tree(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, orchard = false): void {
    this.stamp(ctx, 'vegetation', brushCell(this.world, x, y, orchard), x, y, 2 * radius);
  }

  pattern(ctx: CanvasRenderingContext2D, kind: BrushKind, scale: number, dpr: number): CanvasPattern | null {
    let motif = this.layouts.get(kind);
    if (!motif) this.layouts.set(kind, (motif = brushMotif(this.world, kind)));
    // Exact world origin and width; only sampling resolution changes with zoom/DPR. No viewport seam.
    const width = Math.min(1024, Math.max(1, Math.ceil(motif.width * Math.max(1, Math.min(8, scale * dpr)))));
    const tile = this.tile(kind, width, motif);
    if (!tile) return null;
    const engine = ctx instanceof RecordingContext ? 'recorded' : 'native';
    if (tile[engine]) return tile[engine];
    try {
      const pattern = ctx.createPattern(tile.image, 'repeat');
      if (!pattern) return null;
      pattern.setTransform(new DOMMatrix().scale(motif.width / width));
      if (engine === 'recorded' && kind !== 'forest' && kind !== 'orchard') this.recordedMotifs.set(tile.image, { kind, width, motif, seed: this.world.seed, biome: this.world.options.biome, source: this.source });
      return (tile[engine] = pattern);
    } catch {
      return null;
    }
  }

  /** Stamp the same motif with this owner's atlas. Its crop, repeat and transform stay in the recorded op. */
  rebind(recorded: RecordedMotif): CanvasImageSource | undefined {
    const source = this.source.deref();
    if (!source || source !== recorded.source.deref() || this.world.seed !== recorded.seed || this.world.options.biome !== recorded.biome) return;
    return this.tile(recorded.kind, recorded.width, recorded.motif)?.image;
  }

  private tile(kind: BrushKind, width: number, motif: BrushMotif): MotifTile | undefined {
    const key = `${kind}:${width}`;
    const old = this.motifs.get(key);
    if (old) {
      this.motifs.delete(key);
      this.motifs.set(key, old);
      return old;
    }
    try {
      const c = this.makeCanvas(width, width),
        cx = c?.getContext('2d');
      if (!c || !cx || typeof DOMMatrix === 'undefined') return;
      const k = width / motif.width;
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      for (const stamp of motif.stamps) {
        cx.globalAlpha = stamp.alpha;
        // Periodic copies keep glyphs crossing a motif boundary whole.
        for (const dx of [-motif.width, 0, motif.width])
          for (const dy of [-motif.width, 0, motif.width]) {
            const x = stamp.x + dx,
              y = stamp.y + dy;
            if (x + stamp.size / 2 <= 0 || x - stamp.size / 2 >= motif.width || y + stamp.size / 2 <= 0 || y - stamp.size / 2 >= motif.width) continue;
            this.stamp(cx, stamp.atlas, stamp.cell, x * k, y * k, stamp.size * k);
          }
      }
      const bytes = width * width * 4;
      while (this.bytes + bytes > PATTERN_BYTES && this.motifs.size) {
        const first = this.motifs.keys().next().value!;
        this.bytes -= this.motifs.get(first)!.bytes;
        this.motifs.delete(first);
      }
      const tile = { image: c as unknown as CanvasImageSource, bytes };
      this.motifs.set(key, tile);
      this.bytes += bytes;
      return tile;
    } catch {
      return;
    }
  }

  dispose(): void {
    this.motifs.clear();
    this.bytes = 0;
  }
  get cachedBytes(): number {
    return this.bytes + this.tintBytes;
  }
}
