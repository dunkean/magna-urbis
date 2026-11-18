/** Viewer entry point used by map pages: coordinates camera input and three canvas presentation modes on a dirty-frame animation loop. */
import type { CanvasRenderer } from '../render/canvas';
import type { View } from '../render/view';
import type { ScreenProjection } from '../render/world/camera';
import type { WorldRelief } from '../render/world/contract';
import type { Navigation } from '../render/world/navigation';
import { createViewerNavigation } from './viewerNavigation';
import { createViewerPresentation } from './viewerPresentation';
import { installViewerInput } from './viewerInput';
export interface ViewerOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  minimap?: HTMLCanvasElement;
  onFrame?: (ms: number, band: number, scale: number) => void;
  onError?: (error: Error) => void;
  /** The (clamped) view of the frame about to be shown, with the container size: overlays (pins) follow it. */
  onView?: (v: View, w: number, h: number) => void;
}

export interface FrameRequest {
  seq: number;
  view: View;
  w: number;
  h: number;
  dpr: number;
  /** minimap size in device px */ mini: number;
}
export interface FrameSource {
  request(r: FrameRequest): void;
}
/** A renderer on this thread can present its own layers without creating a bitmap. */
export interface DirectFrameSource {
  element: HTMLElement;
  draw(r: FrameRequest): { mini?: HTMLCanvasElement; ms: number; band: number; scale: number };
}
export interface PresentedFrame {
  seq: number;
  ver?: number;
  view: View;
  w: number;
  h: number;
  dpr: number;
  bitmap?: ImageBitmap;
  mini?: ImageBitmap;
  ms: number;
  band: number;
  scale: number;
}

export interface Viewer {
  setRenderer(r: CanvasRenderer, mapSize: number, keepView?: boolean): void;
  /** Async mode: frames come from `src` (a worker); call `present` for every answer. */
  setSource(src: FrameSource): void;
  setDirectSource(src: DirectFrameSource): void;
  /** Rejecting a current request releases it and closes its bitmaps; replies from detached sources only close their bitmaps. */
  present(f: PresentedFrame, accept?: boolean): boolean;
  /** The drawn content changed (new world snapshot, style...): request a new frame; refit if the map size changed (or `keepView` is false). */
  contentChanged(mapSize: number, keepView: boolean, markerColor?: string): void;
  fit(): void;
  /** Set the view directly (clamped). Debug / scripted screenshots. */
  setView(v: View): void;
  zoomBy(factor: number): void;
  invalidate(): void;
  /** Keep shared products/camera while another view covers this viewer. */
  setPaused(paused: boolean): void;
  getView(): View;
  /** Eases the camera to a pitch (radians, 0 looks straight down) and a yaw (radians clockwise from north; the
   * current one when absent). Without effect while the map on screen does not tilt. */
  tiltTo(pitch: number, yaw?: number): void;
  /** Holds the map in the top view (the page's 2D lock): a tilted camera returns to it at once, and no gesture, key or
   * call tilts it until unlocked. */
  setTiltLocked(locked: boolean): void;
  /** Calls `listener` with the view whenever its pitch, its yaw or the navigation mode changed; returns the function
   * that stops it. */
  onCamera(listener: (view: View) => void): () => void;
  /** Orbit (the default), walk or fly. Walking and flying need a map that tilts; back to the orbit at the pitch the
   * camera had before. */
  setNavigation(mode: Navigation): void;
  navigation(): Navigation;
  /** Where the ground points of the map are on screen for the view on screen (render/world/camera.ts), made again only
   * when the view, the size or the relief changed: the page's overlays follow a tilted camera with it. */
  projection(): ScreenProjection;
  /** The relief of the map on screen: a zoom of a tilted view then aims at the terrain under the cursor rather than
   * at the plane through the centre of the view. */
  setRelief(relief: (() => WorldRelief | undefined) | undefined): void;
  /** Wait until the displayed pixels represent the current camera, including worker replies. */
  waitForFrame(): Promise<void>;
  clear(): void;
  destroy(): void;
}

export function createViewer(o: ViewerOptions): Viewer {
  let dirty = false,
    raf = 0,
    destroyed = false,
    paused = false;
  const invalidate = (): void => {
    dirty = true;
    if (!raf && !destroyed && !paused) raf = requestAnimationFrame(frame);
  };
  const nav = createViewerNavigation(() => presentation.canTilt(), invalidate);
  const presentation = createViewerPresentation(o, nav, invalidate);
  function frame(stamp?: number): void {
    raf = 0;
    if (paused || !dirty) return;
    dirty = false;
    nav.step(stamp);
    presentation.draw();
  }
  presentation.size();
  const ro = new ResizeObserver(() => {
    presentation.size();
    invalidate();
  });
  ro.observe(o.container);
  const removeInput = installViewerInput(o.container, o.canvas, o.minimap, nav);
  return {
    setRenderer: presentation.setRenderer,
    setSource: presentation.setSource,
    setDirectSource: presentation.setDirectSource,
    present: presentation.present,
    contentChanged: presentation.contentChanged,
    fit: nav.fit,
    setView: nav.setView,
    setNavigation: nav.setNavigation,
    navigation: nav.navigation,
    projection: nav.projection,
    tiltTo: nav.tiltTo,
    setTiltLocked: nav.setTiltLocked,
    onCamera: nav.onCamera,
    setRelief: nav.setRelief,
    zoomBy: f => nav.zoomBy(f),
    invalidate,
    setPaused(value: boolean) {
      paused = value;
      if (!paused) invalidate();
    },
    getView: () => nav.camera,
    async waitForFrame() {
      const started = performance.now();
      for (;;) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!dirty && !raf && presentation.hasFrame()) return;
        if (performance.now() - started > 15000) throw new Error('La vue voisine n’a pas terminé son rendu. Réessayez après le chargement de la carte.');
      }
    },
    clear() {
      presentation.clear();
      dirty = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      presentation.clearCanvas();
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      removeInput();
      presentation.destroy();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
