/**
 * The host of the live overlay layer (render/live/overlayLayer.ts): the region a view needs (a margin, edges on a
 * lattice, the half-octave scale, horizontal bands), its key, and the recording of one band with the crisp mark that
 * splits the baked area prefix from the replayed layers. The layer itself owns its regions, their uploads and bakes.
 * Reads: everything drawVector reads, the host's semantic and road keys. Writes: stepwise, activeLight, activeDpr,
 * recordingClip, markCrisp and recordingNow for the duration of a recording step (restored after it).
 */
import { roadCanopyRevision } from '../roadStyle';
import { whiteWaterRevision } from '../whiteWater';
import { View, Rect4 } from '../view';
import type { LiveLayer } from '../live/contract';
import { createOverlayLayer, type OverlayBand, type OverlayPlan } from '../live/overlayLayer';
import { liveVectorEngine, noteGpuFallback } from '../vectorEngine';
import { noteLiveUnit } from '../live/liveStats';
import { CanvasLike } from './contract';
import type { CartographyContext } from './context';
import { LandRecording } from './landRecording';
import { drawVectorSteps } from './vector';
import { growRect } from './geometry';
import { releaseDrapeTemps, warmTreeMarks } from './woods';
import { createMapRecording } from './mapRecording';
import { roadCanopyRegions } from './roads';
import { RegionalRevision } from '../../ui/terrain/revision';

export function createLiveHost(c: CartographyContext) {
  const { deps, now } = c;
  /** Live overlay layer: a recorded region extends this share of the view beyond each side. */
  const REGION_MARGIN = 0.35;
  /** Live overlay layer: a new detail level or region is recorded this long after the view rests, or once the need is this old. */
  const REGION_SETTLE_MS = 150,
    REGION_MAX_WAIT_MS = 1500;
  /** Live overlay layer: a region is recorded in this many horizontal bands, each over idle work slices. */
  const REGION_BANDS = 4;
  // One set of land ops per visible band. Captures, drapes and fixed sheets never populate this cache.
  const landBands: LandRecording[] = [];
  const fixedRaster = (): boolean => c.pal.name === 'cadastre';
  /** A recording of the map for the live overlay layer has failed under this key: not tried again until it changes. */
  let regionFailed = '';
  /** Layers made by createLiveLayer and not yet disposed: a scene update makes their regions stale too. */
  const liveLayers = new Set<LiveLayer>();
  const content = new RegionalRevision();
  let seenCanopy = roadCanopyRevision();
  const contentRevision = (): number => {
    const revision = roadCanopyRevision();
    if (seenCanopy !== revision) {
      const boxes = roadCanopyRegions(c, seenCanopy);
      seenCanopy = revision;
      if (!boxes || boxes.length) content.bump(boxes);
    }
    return content.value();
  };
  /** Everything a recorded region depends on besides its rectangle and the products made per view (`arrivals`). */
  const regionKey = (scale: number, dpr: number, light: boolean): string =>
    `${c.syncPalette()}|${fixedRaster() ? 'fixed-cadastre' : `${scale}|${dpr}|${light}`}|${deps.semantic?.look() ?? ''}|${deps.roadStyle?.().emphasis ?? 1}|${deps.urbanPlan?.() !== false}|${whiteWaterRevision()}`;
  /** The region recorded for a view: a margin around it, edges on a lattice, the half-octave scale, horizontal bands. */
  function regionPlan(view: View, cssW: number, cssH: number, dpr: number, key: string): OverlayPlan {
    if (fixedRaster()) {
      // One 8192px sheet, split into 2048px squares so no giant render target is allocated.
      const rect = { minX: 0, minY: 0, maxX: c.S, maxY: c.S },
        bands: Rect4[] = [];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) bands.push({ minX: (x * c.S) / 4, minY: (y * c.S) / 4, maxX: ((x + 1) * c.S) / 4, maxY: ((y + 1) * c.S) / 4 });
      return { key, rect, scale: 8192 / c.S, dpr: 1, bands };
    }
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
  /** Records one band with the crisp mark, one drawVector step (a layer family) per resumption: the recorder stays
   * private across yields and the renderer flags are borrowed only during a step, so the exact tiles and the furniture
   * can draw between two steps, and `return()` cancels the job. A drape tile (`drape`) clips its paths to the band
   * before construction; an overlay band keeps them whole for the GPU clip. `ink`: the layer retains the world ink.
   * Undefined (and the key marked failed) when the recorder cannot represent the band. */
  function* recordSteps(plan: OverlayPlan, band: Rect4, light: boolean, ink: boolean, drape: boolean): Generator<void, OverlayBand | undefined> {
    const cx = (band.minX + band.maxX) / 2,
      cy = (band.minY + band.maxY) / 2;
    const w = Math.max(1, Math.ceil((band.maxX - band.minX) * plan.scale * plan.dpr)),
      h = Math.max(1, Math.ceil((band.maxY - band.minY) * plan.scale * plan.dpr));
    const rec = createMapRecording(w, h, ink),
      provisional = deps.semantic?.provisional() ?? 0,
      unit = drape ? 'record:drape' : 'record:band';
    // Nearby tiles share their clipped paths across bands. Coarse map-wide tiles must cut to the band itself.
    const clip = drape ? growRect(plan.rect.maxX - plan.rect.minX <= 4 * c.scene.tileSize ? plan.rect : band, Math.max(16, 4 / (plan.scale * plan.dpr))) : undefined;
    const index = !drape && deps.palette && !fixedRaster() ? plan.bands.indexOf(band) : -1;
    const land = index >= 0 ? (landBands[index] ??= new LandRecording()) : undefined;
    const steps = drawVectorSteps(c, { cx, cy, scale: plan.scale }, rec as unknown as CanvasLike, 'map', band, land);
    try {
      for (;;) {
        const before = { stepwise: c.stepwise, light: c.activeLight, dpr: c.activeDpr, clip: c.recordingClip, crisp: c.markCrisp, recording: c.recordingNow },
          t = now();
        let done: boolean | undefined;
        c.stepwise = true;
        c.activeLight = light;
        c.activeDpr = plan.dpr;
        c.recordingClip = clip;
        c.markCrisp = true;
        c.recordingNow = true;
        try {
          done = steps.next().done;
        } finally {
          c.stepwise = before.stepwise;
          c.activeLight = before.light;
          c.activeDpr = before.dpr;
          c.recordingClip = before.clip;
          c.markCrisp = before.crisp;
          c.recordingNow = before.recording;
          noteLiveUnit(unit, t);
        }
        if (done) break;
        yield;
      }
      const list = rec.finish();
      if (list.unsupported) throw new Error(list.unsupported);
      return { list, rect: band, cx, cy, w, h, provisional: (deps.semantic?.provisional() ?? 0) !== provisional };
    } catch (error) {
      noteGpuFallback(`record: ${error instanceof Error ? error.message : String(error)}`);
      regionFailed = plan.key;
      return undefined;
    } finally {
      steps.return(c.stats);
      releaseDrapeTemps(c);
    }
  }
  /** The overlay layer of the live compositor: regions of the map recorded here (regionPlan, recordSteps) and replayed
   * in the compositor's context. */
  function createLiveLayer(gl: WebGL2RenderingContext): LiveLayer | undefined {
    if (deps.raster === false || !deps.invalidate) return undefined;
    const ink = deps.semantic?.createInk?.(gl);
    const layer = createOverlayLayer(gl, {
      ink,
      fixedRaster,
      active: () => !c.disposed && !c.rasterFailed && liveVectorEngine() === 'gpu',
      key: (scale, dpr, light) => {
        const key = regionKey(scale, dpr, light);
        return key === regionFailed ? undefined : key;
      },
      plan: regionPlan,
      contentRevision,
      contentChanges: since => content.changesSince(since),
      arrivals: () => deps.semantic?.arrivals() ?? 0,
      warm: deadline => c.disposed || warmTreeMarks(c, deadline),
      // Recorded at the region's quality and at the compositor's pixel ratio; `record` runs every step in one call.
      record(plan, band, light) {
        const steps = recordSteps(plan, band, light, !!ink, false);
        let step = steps.next();
        while (!step.done) step = steps.next();
        return step.value;
      },
      recordSteps: (plan, band, light, drape) => recordSteps(plan, band, light, !drape && !!ink, drape),
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
      landBands.length = 0;
      liveLayers.delete(layer);
      end();
    };
    return layer;
  }
  /** A scene update: the regions of every live layer become stale (they keep showing until replaced). */
  const invalidateLayers = (boxes?: readonly Rect4[]): void => {
    landBands.length = 0;
    if (boxes) {
      if (boxes.length) content.bump(boxes);
      return;
    }
    for (const layer of liveLayers) layer.invalidate?.();
  };
  return { createLiveLayer, invalidateLayers };
}
