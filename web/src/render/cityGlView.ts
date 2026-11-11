/** WebGL2 city view shared by City Bench (cityGlHost) and the V2 2D map (nativeCityMap).
 * One place builds the cityGl frame options and decides what the Canvas 2D overlay still paints
 * over a GL frame, so both pages draw the same pixels. The V2 has no DOM GL layer of its own: it
 * draws cityGl on an offscreen canvas and composites it into its Canvas 2D frame (CityGlComposite),
 * with every city of the map merged into one GL scene (one context, one upload). */
import { SpatialBins, type Box, type CityBuildings, type CityLayers, type CityLod, type CityPalette, type CityRoofs, type CityScene, type CityView } from './cityCanvas';
import { cityGlOverlayLayers, createCityGlRenderer, type CityGlDrawOptions, type CityGlFrame, type CityGlRenderer } from './cityGl';
import type { RenderColors } from './customColors';
/** `?cityGl=software`: accept a software WebGL2 (headless SwiftShader checks of the GPU look), in both pages. */
export const CITY_GL_SOFTWARE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('cityGl') === 'software';

/** One city frame as both pages describe it; mapped once to the cityGl options. */
export interface CityGlViewFrame {
  viewport: Box; mpp: number; lod: CityLod; view: CityView; palette: CityPalette; layers: CityLayers;
  buildingStyle: CityGlDrawOptions['buildingStyle']; painted: boolean; buildingsVisible: boolean;
  diagnostic: string; refusedParcels?: ReadonlySet<string>; textured?: boolean; colors?: RenderColors;
  selectedId?: string; selectedParcel?: number;
}
export const cityGlDrawOptions = (f: CityGlViewFrame): CityGlDrawOptions => ({
  viewport: f.viewport, metresPerPixel: f.mpp, lod: f.lod, view: f.view, palette: f.palette, layers: f.layers,
  selectedId: f.selectedId, selectedParcel: f.selectedParcel, buildingStyle: f.buildingStyle, paintedBuildings: f.painted,
  buildingsVisible: f.buildingsVisible, diagnostic: f.diagnostic, refusedParcels: f.refusedParcels, textured: f.textured, colors: f.colors,
});
/** Layers drawCity paints in a frame: the overlay left over a GL frame, or every layer on the Canvas 2D path. */
export const cityCanvasLayers = (layers: CityLayers, glFrame: CityGlFrame | undefined): CityLayers =>
  glFrame ? cityGlOverlayLayers(layers) : layers;

// ---------------------------------------------------------------- merged scene (V2: several cities, one GL scene)
const boxes = (scenes: readonly SpatialBins[]): Box[] => scenes.flatMap(bins => [...bins.boxes]);
const union = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
/** Concatenated per-face values, `shift[i]` added to part i (missing parts give zeros). */
function concat(parts: readonly (ArrayLike<number> | undefined)[], lengths: readonly number[], shift: readonly number[] = []): number[] {
  const out: number[] = [];
  parts.forEach((part, i) => { for (let k = 0; k < lengths[i]; k++) out.push((part?.[k] ?? 0) + (shift[i] ?? 0)); });
  return out;
}
/** Several retained city plans (and their buildings) as one GL scene. Each plan keeps its own
 * building→parcel links (ids may repeat across cities); indices are only shifted. Plans and
 * buildings are read, never mutated. */
export function mergeCityPlans(parts: readonly { plan: CityScene; buildings?: CityBuildings }[]): { plan: CityScene; buildings: CityBuildings } {
  const layouts: CityScene['layouts'][number][] = [];
  const plan: CityScene = { layouts, blocks: [], parcels: [], streets: [], walls: [], districts: [], landmarks: [], footprint: [], quays: [],
    lotEnclosures: [], enclosureProfiles: [], lotYards: [], extent: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    ground: parts.find(p => p.plan.ground)?.plan.ground, parcelById: new Map(),
    bins: { blocks: new SpatialBins([]), parcels: new SpatialBins([]), streets: new SpatialBins([]), landmarks: new SpatialBins([]) } };
  const items: CityBuildings['items'] = [], byId = new Map<string, number>(), itemShift: number[] = [];
  for (const { plan: p, buildings } of parts) {
    const L = plan.layouts.length, P = plan.parcels.length, I = items.length;
    itemShift.push(I);
    layouts.push(...p.layouts);
    plan.blocks.push(...p.blocks.map(b => ({ ...b, layout: b.layout + L })));
    plan.parcels.push(...p.parcels.map(x => ({ ...x, layout: x.layout + L })));
    plan.streets.push(...p.streets.map(s => ({ ...s, layout: s.layout + L })));
    plan.districts.push(...p.districts.map(d => ({ ...d, layout: d.layout + L })));
    plan.walls.push(...p.walls);
    plan.landmarks.push(...p.landmarks.map(l => ({ ...l, parcel: l.parcel === undefined ? undefined : l.parcel + P })));
    plan.footprint.push(...p.footprint); plan.quays!.push(...p.quays ?? []);
    plan.lotEnclosures!.push(...p.lotEnclosures ?? []);
    plan.enclosureProfiles!.push(...p.layouts.map((_, i) => p.enclosureProfiles?.[i]));
    plan.lotYards!.push(...(p.lotYards ?? []).map(y => ({ ...y, parcel: y.parcel + P })));
    if (p.layouts.length || p.footprint.length) plan.extent = union(plan.extent, p.extent);
    for (const [id, i] of p.parcelById) if (!plan.parcelById.has(id)) plan.parcelById.set(id, i + P);
    for (const b of buildings?.items ?? []) {
      if (!byId.has(b.id)) byId.set(b.id, items.length);
      items.push({ ...b, parcel: b.parcel === undefined ? undefined : b.parcel + P });
    }
  }
  plan.bins = { blocks: new SpatialBins(boxes(parts.map(p => p.plan.bins.blocks)), 128), parcels: new SpatialBins(boxes(parts.map(p => p.plan.bins.parcels)), 64),
    streets: new SpatialBins(boxes(parts.map(p => p.plan.bins.streets)), 128), landmarks: new SpatialBins(boxes(parts.map(p => p.plan.bins.landmarks)), 128) };
  const built = parts.map(p => p.buildings), counts = built.map(b => b?.items.length ?? 0);
  let roofs: CityRoofs | undefined;
  if (built.some(b => b?.roofs)) {
    const faces = built.map(b => b?.roofs?.shapes.length ?? 0), of = (key: 'owner' | 'light' | 'tone' | 'dir' | 'flat' | 'snow') => built.map(b => b?.roofs?.[key]);
    roofs = { shapes: built.flatMap(b => b?.roofs?.shapes ?? []),
      owner: Uint32Array.from(concat(of('owner'), faces, itemShift)), light: Float32Array.from(concat(of('light'), faces)),
      tone: Float32Array.from(concat(of('tone'), faces)), dir: Float32Array.from(concat(of('dir'), faces)),
      flat: Uint8Array.from(concat(of('flat'), faces)), snow: Float32Array.from(concat(of('snow'), faces)),
      cover: built.flatMap((b, i) => b?.roofs?.cover ?? Array<string>(faces[i]).fill('')),
      wall: built.flatMap((b, i) => b?.roofs?.wall ?? Array<string>(faces[i]).fill('')),
      shadows: built.flatMap((b, i) => b?.roofs?.shadows ?? Array.from({ length: counts[i] }, (): CityRoofs['shadows'][number] => [])) };
  }
  return { plan, buildings: { items, byId, bins: new SpatialBins(boxes(built.flatMap(b => b ? [b.bins] : [])), 64), ...(roofs ? { roofs } : {}) } };
}

// ---------------------------------------------------------------- offscreen GL composited into Canvas 2D (V2, exports)
/** A cityGl renderer on its own canvas, drawn then copied into a Canvas 2D frame in the same task
 * (the GL buffer is not preserved). Created on first use; `failed` once WebGL2 is unavailable. */
export class CityGlComposite {
  private renderer?: CityGlRenderer;
  private failed = false;
  private requested?: CityScene;
  private uploaded?: CityScene;
  private upload?: Promise<void>;
  constructor(private readonly onInvalidate: () => void) {}
  get unavailable(): boolean { return this.failed; }
  /** Uploads `plan` once (async). True when it is on the GPU and the next draw can use it. */
  prepare(plan: CityScene, buildings: CityBuildings | undefined): boolean {
    if (this.failed) return false;
    if (!this.renderer) {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
      if (!canvas) { this.failed = true; return false; }
      try { this.renderer = createCityGlRenderer(canvas, { allowSoftware: CITY_GL_SOFTWARE, onInvalidate: this.onInvalidate }); }
      catch (error) { this.failed = true; console.warn('Rendu WebGL2 de la ville indisponible, Canvas 2D utilisé', error); return false; }
    }
    if (this.requested !== plan) {
      this.requested = plan; this.uploaded = undefined;
      // Repaint once `uploaded` is set: the renderer's own invalidation fires before this continuation.
      this.upload = this.renderer.setScene(plan, buildings).then(() => { if (this.requested === plan) { this.uploaded = plan; this.onInvalidate(); } },
        error => { console.warn('Plan WebGL indisponible', error); });
    }
    return this.uploaded === plan && this.renderer.ready;
  }
  /** Resolves once the last requested plan is uploaded (exports wait for it before their synchronous draw). */
  ready(): Promise<void> { return this.upload ?? Promise.resolve(); }
  /** Draws the frame and copies it over `ctx` in device pixels; undefined when GL could not present it. */
  draw(ctx: CanvasRenderingContext2D, pixelWidth: number, pixelHeight: number, options: CityGlDrawOptions): CityGlFrame | undefined {
    const r = this.renderer;
    if (!r?.ready || this.uploaded !== this.requested) return undefined;
    r.resize(pixelWidth, pixelHeight);
    const frame = r.draw(options);
    if (!r.ready) return undefined;
    ctx.save();
    try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(r.canvas, 0, 0, pixelWidth, pixelHeight); }
    finally { ctx.restore(); }
    return frame;
  }
  dispose(): void {
    const r = this.renderer; this.renderer = undefined; this.requested = this.uploaded = undefined; this.upload = undefined;
    if (!r) return;
    r.dispose(); r.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
