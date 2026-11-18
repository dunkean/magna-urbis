/** Canvas presentation for createViewer: synchronous renderer, worker bitmaps or direct layers, plus the minimap. Owns source requests and canvas resources. */
import type { CanvasRenderer } from '../render/canvas';
import { type View, viewRect } from '../render/view';
import { viewFootprint } from '../render/world/camera';
import type { ViewerOptions, FrameSource, DirectFrameSource, PresentedFrame } from './viewer';
import type { ViewerNavigation } from './viewerNavigation';
const sameView = (a: View, b: View): boolean => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;
export function createViewerPresentation(o: ViewerOptions, nav: ViewerNavigation, invalidate: () => void) {
  const { container, canvas, minimap } = o;
  let renderer: CanvasRenderer | null = null,
    source: FrameSource | null = null,
    direct: DirectFrameSource | null = null;
  const originalOpacity = canvas.style.opacity;
  let w = 1,
    h = 1,
    dpr = 1;
  let bmCtx: ImageBitmapRenderingContext | null = null;
  let shown: { view: View; w: number; h: number } | null = null;
  let req: { view: View; w: number; h: number; dpr: number } | null = null;
  let seq = 0,
    inflight = 0,
    requestSeq = 0,
    force = false;
  let miniBase: ImageBitmap | HTMLCanvasElement | null = null,
    marker = '#a33';
  const closeMini = (): void => {
    if (miniBase && 'close' in miniBase) miniBase.close();
    miniBase = null;
    miniShown = undefined;
  };
  /** Size last written to the canvas style by the direct mode. */
  let directW = 0,
    directH = 0;
  const detachDirect = (): void => {
    if (!direct) return;
    direct?.element.remove();
    direct = null;
    canvas.style.opacity = originalOpacity;
    directW = directH = 0;
    delete canvas.dataset.presentation;
  };
  const resetRequests = (): void => {
    inflight = 0;
    requestSeq = 0;
    req = null;
    shown = null;
    canvas.style.transform = '';
    force = true;
  };

  const size = (): void => {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    nav.resize(w, h);
    if (!source && !direct) {
      const pw = Math.round(w * dpr),
        ph = Math.round(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    if (minimap) {
      const mw = Math.round(minimap.clientWidth || 140);
      const px = Math.round(mw * dpr);
      if (minimap.width !== px) {
        minimap.width = px;
        minimap.height = px;
        closeMini();
        force = true;
      } // the renderer redraws it at the new size
    }
  };
  /** Pan/zoom the displayed bitmap to the current view (CSS transform: compositor only). */
  function applyTransform(): void {
    const view = nav.view;
    if (!shown) return;
    if (sameView(shown.view, view) && shown.w === w && shown.h === h) {
      canvas.style.transform = '';
      return;
    }
    const k = view.scale / shown.view.scale;
    const tx = (shown.view.cx - view.cx) * view.scale + (w - shown.w) / 2;
    const ty = (shown.view.cy - view.cy) * view.scale + (h - shown.h) / 2;
    canvas.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k})`;
  }
  /** What the miniature last showed: its base, its size, the marker colour and the corners of the view's outline in
   * quarter pixels. */
  let miniShown: { base: ImageBitmap | HTMLCanvasElement | null; size: number; marker: string; corners: Int32Array } | undefined;
  const footprint = new Float64Array(8),
    corners = new Int32Array(8);
  /** The ground the view shows, on the miniature: its rectangle in the top view, the footprint of a tilted camera (the
   * ground under the corners of the screen, cut towards the horizon). */
  function drawMiniOverlay(): void {
    const view = nav.view,
      mapSize = nav.mapSize;
    if (!minimap || !miniBase) return;
    const k = minimap.width / mapSize,
      camera = nav.withTilt(view);
    if (camera === view) {
      const r = viewRect(view, w, h, 0);
      footprint.set([r.minX, r.minY, r.maxX, r.minY, r.maxX, r.maxY, r.minX, r.maxY]);
    } else viewFootprint(camera, w, h, nav.relief, footprint);
    // A frame of a gesture usually moves the outline by a fraction of a miniature pixel: a redraw would change nothing
    // on screen, yet every changed canvas costs the page a raster and a compositor update.
    for (let i = 0; i < 8; i++) corners[i] = Math.round(footprint[i] * k * 4);
    const shown = miniShown;
    if (shown && shown.base === miniBase && shown.size === minimap.width && shown.marker === marker && shown.corners.every((value, i) => value === corners[i])) return;
    const ctx = minimap.getContext('2d');
    if (!ctx) return;
    miniShown = { base: miniBase, size: minimap.width, marker, corners: corners.slice() };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    ctx.drawImage(miniBase, 0, 0, minimap.width, minimap.height);
    ctx.strokeStyle = marker;
    ctx.lineWidth = 1.5;
    if (camera === view) {
      ctx.strokeRect(footprint[0] * k, footprint[1] * k, (footprint[2] - footprint[0]) * k, (footprint[5] - footprint[1]) * k);
      return;
    }
    ctx.beginPath();
    for (let i = 0; i < 4; i++) ctx.lineTo(footprint[i * 2] * k, footprint[i * 2 + 1] * k);
    ctx.closePath();
    ctx.stroke();
  }
  function sendRequest(): void {
    const view = nav.view;
    if (!source) return;
    const changed = !req || req.w !== w || req.h !== h || req.dpr !== dpr || !sameView(req.view, view);
    if (inflight || !(force || changed)) return;
    force = false;
    req = { view: { ...view }, w, h, dpr };
    inflight = ++seq;
    requestSeq = inflight;
    source.request({ seq: inflight, view: req.view, w, h, dpr, mini: minimap ? minimap.width : 0 });
  }

  function draw(): void {
    const view = nav.view;
    const camera = nav.withTilt(view),
      tilting = nav.tilts();
    o.onView?.(camera, w, h);
    if (direct) {
      try {
        // Only when the size changed: a style write per frame makes the page recompute styles per frame.
        if (directW !== w || directH !== h) {
          directW = w;
          directH = h;
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
        }
        const st = direct.draw({ seq: ++seq, view: { ...camera }, w, h, dpr, mini: minimap ? minimap.width : 0 });
        nav.sourceChanged(tilting);
        nav.tellCamera();
        // A miniature returned by the draw is new content, even in the same canvas object.
        if (st.mini) {
          if (miniBase !== st.mini) {
            closeMini();
            miniBase = st.mini;
          }
          miniShown = undefined;
        }
        drawMiniOverlay();
        o.onFrame?.(st.ms, st.band, st.scale);
      } catch (error) {
        o.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (source) {
      applyTransform();
      drawMiniOverlay();
      sendRequest();
      return;
    }
    if (!renderer) return;
    try {
      const st = renderer.draw(nav.view);
      if (minimap) renderer.drawMinimap(minimap, nav.view, w, h);
      o.onFrame?.(st.ms, st.band, nav.view.scale);
    } catch (error) {
      o.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return {
    size,
    draw,
    canTilt: () => direct?.element.dataset.camera === 'tilt',
    hasFrame: () => !source || (!inflight && !!shown && sameView(shown.view, nav.view)),
    setRenderer(r: CanvasRenderer, size2: number, keepView = false) {
      detachDirect();
      source = null;
      resetRequests();
      size();
      renderer?.dispose();
      renderer = r;
      nav.contentChanged(size2, keepView);
      invalidate();
    },
    setSource(src: FrameSource) {
      detachDirect();
      source = src;
      resetRequests();
      invalidate();
    },
    setDirectSource(src: DirectFrameSource) {
      if (direct?.element !== src.element) {
        detachDirect();
        container.insertBefore(src.element, canvas);
      }
      direct = src;
      source = null;
      resetRequests();
      canvas.style.opacity = '0';
      canvas.dataset.presentation = 'direct';
      invalidate();
    },
    present(f: PresentedFrame, accept = true) {
      // An answer from a previous source must never replace the current view or release its request.
      if (!source || f.seq !== requestSeq) {
        f.bitmap?.close();
        f.mini?.close();
        return false;
      }
      inflight = 0;
      if (!accept) {
        f.bitmap?.close();
        f.mini?.close();
        force = true;
        invalidate();
        return false;
      }
      let presented = false;
      if (f.mini) {
        closeMini();
        miniBase = f.mini;
      }
      if (f.bitmap) {
        bmCtx ??= canvas.getContext('bitmaprenderer');
        if (bmCtx) {
          bmCtx.transferFromImageBitmap(f.bitmap); // sets the canvas size to the bitmap's (w*dpr x h*dpr)
          presented = true;
        } else {
          const c = canvas.getContext('2d');
          if (c) {
            canvas.width = Math.max(1, Math.round(f.w * f.dpr));
            canvas.height = Math.max(1, Math.round(f.h * f.dpr));
            c.drawImage(f.bitmap, 0, 0);
            presented = true;
          }
          f.bitmap.close();
        }
        if (presented) {
          canvas.style.width = f.w + 'px';
          canvas.style.height = f.h + 'px';
          shown = { view: f.view, w: f.w, h: f.h };
          applyTransform();
          o.onFrame?.(f.ms, f.band, f.scale);
        }
      }
      drawMiniOverlay();
      invalidate(); // sends the next request if the view moved meanwhile
      return presented;
    },
    contentChanged(size2: number, keepView: boolean, markerColor?: string) {
      if (markerColor) marker = markerColor;
      nav.contentChanged(size2, keepView);
      force = true;
      invalidate();
    },
    clear() {
      detachDirect();
      source = null;
      renderer = null;
      resetRequests();
      closeMini();
    },
    clearCanvas() {
      canvas.width = canvas.width;
    },
    destroy() {
      closeMini();
      detachDirect();
    },
  };
}
