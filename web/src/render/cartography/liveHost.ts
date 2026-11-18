/**
 * The host of the live overlay layer (render/live/overlayLayer.ts): the region a view needs (a margin, edges on a
 * lattice, the half-octave scale, horizontal bands), its key, and the recording of one band with the crisp mark that
 * splits the baked area prefix from the replayed layers. The layer itself owns its regions, their uploads and bakes.
 * Reads: everything drawVector reads, the host's semantic and road keys. Writes: stepwise, activeLight, activeDpr
 * and markCrisp for the duration of a recording.
 */
import { roadCanopyRevision } from '../roadStyle';
import { whiteWaterRevision } from '../whiteWater';
import { View, Rect4 } from '../view';
import { RecordingCanvas } from '../gpu/recorder';
import type { DisplayList } from '../gpu/contract';
import type { LiveLayer } from '../live/contract';
import { createOverlayLayer, type OverlayBand, type OverlayPlan } from '../live/overlayLayer';
import { liveVectorEngine, noteGpuFallback } from '../vectorEngine';
import { noteLiveUnit } from '../live/liveStats';
import { CanvasLike } from './contract';
import type { CartographyContext } from './context';
import { drawVector } from './vector';
import { releaseDrapeTemps } from './woods';

export function createLiveHost(c: CartographyContext) {
  const { deps, now } = c;
  /** Live overlay layer: a recorded region extends this share of the view beyond each side. */
  const REGION_MARGIN = 0.35;
  /** Live overlay layer: a new detail level or region is recorded this long after the view rests, or once the need is this old. */
  const REGION_SETTLE_MS = 150,
    REGION_MAX_WAIT_MS = 1500;
  /** Live overlay layer: a region is recorded in this many horizontal bands, one per idle step. */
  const REGION_BANDS = 4;
  /** A recording of the map for the live overlay layer has failed under this key: not tried again until it changes. */
  let regionFailed = '';
  /** Layers made by createLiveLayer and not yet disposed: a scene update makes their regions stale too. */
  const liveLayers = new Set<LiveLayer>();
  /** Everything a recorded region depends on besides its rectangle and the products made per view (`arrivals`). */
  const regionKey = (scale: number, dpr: number, light: boolean): string => `${scale}|${dpr}|${light}|${deps.semantic?.look() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${roadCanopyRevision()}|${whiteWaterRevision()}`;
  /** The region recorded for a view: a margin around it, edges on a lattice, the half-octave scale, horizontal bands. */
  function regionPlan(view: View, cssW: number, cssH: number, dpr: number, key: string): OverlayPlan {
    const scale = 2 ** (Math.round(2 * Math.log2(view.scale)) / 2),
      hw = (cssW / view.scale) * (0.5 + REGION_MARGIN),
      hh = (cssH / view.scale) * (0.5 + REGION_MARGIN);
    // Region edges on a lattice (a power of two near half the view): panning back and forth meets the same regions,
    // whose region-keyed products (forest clearings union) stay cached.
    const step = 2 ** Math.round(Math.log2(Math.max(hw, hh) / 2));
    const rect: Rect4 = { minX: Math.floor((view.cx - hw) / step) * step, minY: Math.floor((view.cy - hh) / step) * step, maxX: Math.ceil((view.cx + hw) / step) * step, maxY: Math.ceil((view.cy + hh) / step) * step };
    const bands: Rect4[] = [];
    for (let i = 0; i < REGION_BANDS; i++) bands.push({ minX: rect.minX, maxX: rect.maxX, minY: rect.minY + ((rect.maxY - rect.minY) * i) / REGION_BANDS, maxY: rect.minY + ((rect.maxY - rect.minY) * (i + 1)) / REGION_BANDS });
    return { key, rect, scale, dpr, bands };
  }
  /** Records one band with the crisp mark; undefined (and the key marked failed) when the recorder cannot represent it. */
  function recordBand(plan: OverlayPlan, band: Rect4): OverlayBand | undefined {
    const cx = (band.minX + band.maxX) / 2,
      cy = (band.minY + band.maxY) / 2;
    const w = Math.max(1, Math.ceil((band.maxX - band.minX) * plan.scale * plan.dpr)),
      h = Math.max(1, Math.ceil((band.maxY - band.minY) * plan.scale * plan.dpr));
    const rec = new RecordingCanvas(w, h);
    const provisional = deps.semantic?.provisional() ?? 0;
    let list: DisplayList | undefined;
    c.markCrisp = true;
    try {
      drawVector(c, { cx, cy, scale: plan.scale }, rec as unknown as CanvasLike, 'map', band);
      list = rec.finish();
    } catch (error) {
      noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      c.markCrisp = false;
      releaseDrapeTemps(c);
    }
    if (!list || list.unsupported) {
      if (list?.unsupported) noteGpuFallback(list.unsupported);
      regionFailed = plan.key;
      return undefined;
    }
    return { list, rect: band, cx, cy, w, h, provisional: (deps.semantic?.provisional() ?? 0) !== provisional };
  }
  /** The overlay layer of the live compositor: regions of the map recorded here (regionPlan, recordBand) and replayed
   * in the compositor's context. */
  function createLiveLayer(gl: WebGL2RenderingContext): LiveLayer | undefined {
    if (deps.raster === false || !deps.invalidate) return undefined;
    const layer = createOverlayLayer(gl, {
      active: () => !c.disposed && !c.rasterFailed && liveVectorEngine() === 'gpu',
      key: (scale, dpr, light) => {
        const key = regionKey(scale, dpr, light);
        return key === regionFailed ? undefined : key;
      },
      plan: regionPlan,
      arrivals: () => deps.semantic?.arrivals() ?? 0,
      record(plan, band, light) {
        // One band is one step: recorded at the region's quality and at the compositor's pixel ratio.
        const stepwise = c.stepwise,
          wasLight = c.activeLight,
          dprBefore = c.activeDpr,
          t = now();
        c.stepwise = true;
        c.activeLight = light;
        c.activeDpr = plan.dpr;
        try {
          return recordBand(plan, band);
        } finally {
          c.stepwise = stepwise;
          c.activeLight = wasLight;
          c.activeDpr = dprBefore;
          noteLiveUnit('record:band', t);
        }
      },
      invalidate: () => {
        if (!c.disposed) deps.invalidate?.();
      },
      now,
      settleMs: REGION_SETTLE_MS,
      maxWaitMs: REGION_MAX_WAIT_MS,
    });
    if (!layer) return undefined;
    liveLayers.add(layer);
    const end = layer.dispose;
    layer.dispose = (): void => {
      liveLayers.delete(layer);
      end();
    };
    return layer;
  }
  /** A scene update: the regions of every live layer become stale (they keep showing until replaced). */
  const invalidateLayers = (): void => {
    for (const layer of liveLayers) layer.invalidate?.();
  };
  return { createLiveLayer, invalidateLayers };
}
