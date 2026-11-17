/**
 * Pan/zoom viewer.
 * Drag + touch pan, wheel zoom toward cursor, pinch, double-click zoom, keyboard (+ - 0 arrows),
 * fit-to-map, devicePixelRatio aware, work only when dirty (requestAnimationFrame).
 * Wheel notches, double-clicks and the zoom keys set a target view that the camera eases to over a few frames
 * (the end view is the one a direct jump gives); touchpad and pinch deltas are followed directly.
 *
 * Two drawing modes:
 *  - sync (fallback): a CanvasRenderer on this thread draws every dirty frame (`setRenderer`).
 *  - async (default when OffscreenCanvas works): a render worker draws frames (`setSource`). The page shows the
 *    last delivered bitmap and moves/scales it with a CSS transform to follow the current view at once (compositor
 *    only, so panning and zooming stay at the display rate however long a real frame takes); at most one frame
 *    request is in flight and the newest view always wins. When a fresh bitmap arrives it replaces the old one and
 *    the transform is recomputed in the same task, so the swap is seamless.
 * Optional minimap canvas (drawn by the renderer, or from a base bitmap + the view rectangle).
 */
import type { CanvasRenderer } from '../render/canvas';
import { View, fitView, clampView, zoomAt, panBy, viewRect } from '../render/view';

export interface ViewerOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  minimap?: HTMLCanvasElement;
  onFrame?: (ms: number, band: number, scale: number) => void;
  onError?: (error: Error) => void;
  /** The (clamped) view of the frame about to be shown, with the container size: overlays (pins) follow it. */
  onView?: (v: View, w: number, h: number) => void;
}

export interface FrameRequest { seq: number; view: View; w: number; h: number; dpr: number; /** minimap size in device px */ mini: number }
export interface FrameSource { request(r: FrameRequest): void }
/** A renderer on this thread can present its own layers without creating a bitmap. */
export interface DirectFrameSource {
  element: HTMLElement;
  draw(r: FrameRequest): { mini?: HTMLCanvasElement; ms: number; band: number; scale: number };
}
export interface PresentedFrame {
  seq: number; ver?: number; view: View; w: number; h: number; dpr: number;
  bitmap?: ImageBitmap; mini?: ImageBitmap; ms: number; band: number; scale: number;
}

export interface Viewer {
  setRenderer(r: CanvasRenderer, mapSize: number, keepView?: boolean): void;
  /** Async mode: frames come from `src` (a worker); call `present` for every answer. */
  setSource(src: FrameSource): void;
  setDirectSource(src: DirectFrameSource): void;
  /** Rejecting an obsolete answer still releases the in-flight request and closes its bitmaps. */
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
  /** Wait until the displayed pixels represent the current camera, including worker replies. */
  waitForFrame(): Promise<void>;
  clear(): void;
  destroy(): void;
}

const sameView = (a: View, b: View): boolean => a.cx === b.cx && a.cy === b.cy && a.scale === b.scale;
/** Time constant of the eased zoom (the camera covers 63 % of what is left in this time), and the wheel delta, in
 * pixels, from which a wheel event is a notch to ease rather than a touchpad or pinch step to follow. */
const ZOOM_EASE_MS = 45, WHEEL_NOTCH_PX = 40;

export function createViewer(o: ViewerOptions): Viewer {
  const { container, canvas, minimap } = o;
  let renderer: CanvasRenderer | null = null;
  let source: FrameSource | null = null;
  let direct: DirectFrameSource | null = null;
  const originalOpacity = canvas.style.opacity;
  let mapSize = 1000;
  let view: View = { cx: 500, cy: 500, scale: 0.5 };
  let w = 1, h = 1, dpr = 1;
  let dirty = false, raf = 0, destroyed = false, paused = false;
  /** Eased zoom: the view the camera is moving to, and the time of its last step. */
  let zoomTarget: View | null = null, zoomStamp = 0;
  // async mode state
  let bmCtx: ImageBitmapRenderingContext | null = null;
  let shown: { view: View; w: number; h: number } | null = null;
  let req: { view: View; w: number; h: number; dpr: number } | null = null;
  let seq = 0, inflight = 0, requestSeq = 0, force = false;
  let miniBase: ImageBitmap | HTMLCanvasElement | null = null, marker = '#a33';
  const closeMini = (): void => { if (miniBase && 'close' in miniBase) miniBase.close(); miniBase = null; };
  const detachDirect = (): void => {
    if (!direct) return;
    direct?.element.remove(); direct = null; canvas.style.opacity = originalOpacity;
    delete canvas.dataset.presentation;
  };
  const resetRequests = (): void => { inflight = 0; requestSeq = 0; req = null; shown = null; canvas.style.transform = ''; force = true; };

  const size = (): void => {
    const r = container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    if (!source && !direct) {
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    if (minimap) {
      const mw = Math.round(minimap.clientWidth || 140);
      const px = Math.round(mw * dpr);
      if (minimap.width !== px) { minimap.width = px; minimap.height = px; closeMini(); force = true; } // the renderer redraws it at the new size
    }
  };
  const invalidate = (): void => {
    dirty = true;
    if (!raf && !destroyed && !paused) raf = requestAnimationFrame(frame);
  };

  /** Pan/zoom the displayed bitmap to the current view (CSS transform: compositor only). */
  function applyTransform(): void {
    if (!shown) return;
    if (sameView(shown.view, view) && shown.w === w && shown.h === h) { canvas.style.transform = ''; return; }
    const k = view.scale / shown.view.scale;
    const tx = (shown.view.cx - view.cx) * view.scale + (w - shown.w) / 2;
    const ty = (shown.view.cy - view.cy) * view.scale + (h - shown.h) / 2;
    canvas.style.transform = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${k})`;
  }
  function drawMiniOverlay(): void {
    if (!minimap || !miniBase) return;
    const ctx = minimap.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    ctx.drawImage(miniBase, 0, 0, minimap.width, minimap.height);
    const k = minimap.width / mapSize, r = viewRect(view, w, h, 0);
    ctx.strokeStyle = marker; ctx.lineWidth = 1.5;
    ctx.strokeRect(r.minX * k, r.minY * k, (r.maxX - r.minX) * k, (r.maxY - r.minY) * k);
  }
  function sendRequest(): void {
    if (!source) return;
    const changed = !req || req.w !== w || req.h !== h || req.dpr !== dpr || !sameView(req.view, view);
    if (inflight || !(force || changed)) return;
    force = false;
    req = { view: { ...view }, w, h, dpr };
    inflight = ++seq;
    requestSeq = inflight;
    source.request({ seq: inflight, view: req.view, w, h, dpr, mini: minimap ? minimap.width : 0 });
  }

  /** One step of the eased zoom: the scale covers a share of what is left (geometric), around the screen point that the
   * current view and the target have in common (the cursor of a wheel zoom), which therefore stays put. */
  function stepZoom(now: number): void {
    const target = zoomTarget!, dt = Math.max(0, Math.min(64, now - zoomStamp)); zoomStamp = now;
    const ratio = target.scale / view.scale;
    // Within 0.4 % of the scale and a pixel of the place: the camera takes the target itself.
    if (Math.abs(Math.log(ratio)) < 0.004 && Math.abs(target.cx - view.cx) * target.scale < 1 && Math.abs(target.cy - view.cy) * target.scale < 1) {
      view = target; zoomTarget = null; return;
    }
    const share = 1 - Math.exp(-dt / ZOOM_EASE_MS), scale = view.scale * Math.pow(ratio, share), spread = 1 / view.scale - 1 / target.scale;
    if (Math.abs(ratio - 1) > 1e-6) {
      const qx = (target.cx - view.cx) / spread, qy = (target.cy - view.cy) / spread;
      view = { cx: view.cx + qx / view.scale - qx / scale, cy: view.cy + qy / view.scale - qy / scale, scale };
    } else view = { cx: view.cx + (target.cx - view.cx) * share, cy: view.cy + (target.cy - view.cy) * share, scale: target.scale };
    invalidate();
  }
  function frame(stamp?: number): void {
    raf = 0;
    if (paused) return;
    if (!dirty) return;
    dirty = false;
    if (zoomTarget) stepZoom(typeof stamp === 'number' ? Math.max(stamp, zoomStamp) : performance.now());
    view = clampView(view, mapSize, w, h);
    o.onView?.(view, w, h);
    if (direct) {
      try {
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        const st = direct.draw({ seq: ++seq, view: { ...view }, w, h, dpr, mini: minimap ? minimap.width : 0 });
        if (st.mini && miniBase !== st.mini) { closeMini(); miniBase = st.mini; }
        drawMiniOverlay();
        o.onFrame?.(st.ms, st.band, st.scale);
      } catch (error) { o.onError?.(error instanceof Error ? error : new Error(String(error))); }
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
      const st = renderer.draw(view);
      if (minimap) renderer.drawMinimap(minimap, view, w, h);
      o.onFrame?.(st.ms, st.band, view.scale);
    } catch (error) { o.onError?.(error instanceof Error ? error : new Error(String(error))); }
  }
  const set = (v: View): void => { zoomTarget = null; view = clampView(v, mapSize, w, h); invalidate(); };
  const fit = (): void => set(fitView(mapSize, w, h));
  const zoomBy = (f: number, sx = w / 2, sy = h / 2): void => set(zoomAt(view, f, sx, sy, w, h));
  /** Zoom by `f` around a screen point, eased: successive calls move the target, as direct jumps would move the view. */
  const easeZoomBy = (f: number, sx = w / 2, sy = h / 2): void => {
    if (!zoomTarget) zoomStamp = performance.now();
    zoomTarget = clampView(zoomAt(zoomTarget ?? view, f, sx, sy, w, h), mapSize, w, h);
    invalidate();
  };

  size();
  const ro = new ResizeObserver(() => { size(); invalidate(); });
  ro.observe(container);

  // --- pointers (drag = pan, two pointers = pinch) ---
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number } | null = null;
  const local = (e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const dist = (): number => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = (): { x: number; y: number } => {
    const [a, b] = [...pts.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, local(e));
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
    if (pts.size === 2) pinch = { d: dist() };
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pts.size === 2 && pinch) {
      const m0 = mid();
      pts.set(e.pointerId, cur);
      const m1 = mid(), d = dist();
      let v = panBy(view, m1.x - m0.x, m1.y - m0.y);
      if (pinch.d > 0 && d > 0) v = zoomAt(v, d / pinch.d, m1.x, m1.y, w, h);
      pinch.d = d;
      set(v);
    } else {
      pts.set(e.pointerId, cur);
      // A drag during an eased zoom moves its target too: the zoom ends where the drag left the map.
      const target = zoomTarget && clampView(panBy(zoomTarget, cur.x - prev.x, cur.y - prev.y), mapSize, w, h);
      set(panBy(view, cur.x - prev.x, cur.y - prev.y));
      zoomTarget = target;
    }
  });
  const up = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // A wheel notch is a large step (16 % and more): eased. Touchpads and pinch gestures (ctrl+wheel) send many small
    // steps that are already continuous: followed directly, unless a notch is still being eased.
    if (zoomTarget || Math.abs(dy) >= WHEEL_NOTCH_PX && !e.ctrlKey) easeZoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
    else zoomBy(Math.exp(-dy * 0.0015), p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    easeZoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y);
  });
  const key = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    switch (e.key) {
      case '+': case '=': easeZoomBy(1.4); break;
      case '-': case '_': easeZoomBy(1 / 1.4); break;
      case '0': fit(); break;
      case 'ArrowLeft': set(panBy(view, 80, 0)); break;
      case 'ArrowRight': set(panBy(view, -80, 0)); break;
      case 'ArrowUp': set(panBy(view, 0, 80)); break;
      case 'ArrowDown': set(panBy(view, 0, -80)); break;
      default: return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', key);

  // minimap click = recenter
  const mini = (e: PointerEvent): void => {
    if (!minimap || !(e.buttons & 1)) return;
    const r = minimap.getBoundingClientRect();
    set({ ...view, cx: ((e.clientX - r.left) / r.width) * mapSize, cy: ((e.clientY - r.top) / r.height) * mapSize });
  };
  minimap?.addEventListener('pointerdown', (e) => { minimap.setPointerCapture(e.pointerId); mini(e); });
  minimap?.addEventListener('pointermove', mini);

  return {
    setRenderer(r, size2, keepView = false) {
      detachDirect(); source = null; resetRequests(); size();
      renderer?.dispose();
      const sizeChanged = size2 !== mapSize;
      renderer = r; mapSize = size2;
      if (!keepView || sizeChanged) { zoomTarget = null; view = fitView(mapSize, w, h); }
      invalidate();
    },
    setSource(src) { detachDirect(); source = src; resetRequests(); invalidate(); },
    setDirectSource(src) {
      if (direct?.element !== src.element) { detachDirect(); container.insertBefore(src.element, canvas); }
      direct = src; source = null; resetRequests();
      canvas.style.opacity = '0'; canvas.dataset.presentation = 'direct';
      invalidate();
    },
    present(f, accept = true) {
      // An answer from a previous source must never replace the current view or release its request.
      if (!source || f.seq !== requestSeq) { f.bitmap?.close(); f.mini?.close(); return false; }
      inflight = 0;
      if (!accept) { f.bitmap?.close(); f.mini?.close(); force = true; invalidate(); return false; }
      let presented = false;
      if (f.mini) { closeMini(); miniBase = f.mini; }
      if (f.bitmap) {
        bmCtx ??= canvas.getContext('bitmaprenderer');
        if (bmCtx) {
          bmCtx.transferFromImageBitmap(f.bitmap); // sets the canvas size to the bitmap's (w*dpr x h*dpr)
          presented = true;
        } else {
          const c = canvas.getContext('2d');
          if (c) {
            canvas.width = Math.max(1, Math.round(f.w * f.dpr)); canvas.height = Math.max(1, Math.round(f.h * f.dpr));
            c.drawImage(f.bitmap, 0, 0); presented = true;
          }
          f.bitmap.close();
        }
        if (presented) {
          canvas.style.width = f.w + 'px'; canvas.style.height = f.h + 'px';
          shown = { view: f.view, w: f.w, h: f.h };
          applyTransform();
          o.onFrame?.(f.ms, f.band, f.scale);
        }
      }
      drawMiniOverlay();
      invalidate(); // sends the next request if the view moved meanwhile
      return presented;
    },
    contentChanged(size2, keepView, markerColor) {
      const sizeChanged = size2 !== mapSize;
      mapSize = size2;
      if (markerColor) marker = markerColor;
      if (!keepView || sizeChanged) { zoomTarget = null; view = fitView(mapSize, w, h); }
      force = true;
      invalidate();
    },
    fit, setView: set, zoomBy: (f) => zoomBy(f), invalidate,
    setPaused(value: boolean) { paused = value; if (!paused) invalidate(); },
    getView: () => view,
    async waitForFrame() {
      const started = performance.now();
      for (;;) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (!dirty && !raf && (!source || (!inflight && shown && sameView(shown.view, view)))) return;
        if (performance.now() - started > 15000) throw new Error('La vue voisine n’a pas terminé son rendu. Réessayez après le chargement de la carte.');
      }
    },
    clear() {
      detachDirect(); source = null; renderer = null; resetRequests(); closeMini();
      dirty = false; if (raf) cancelAnimationFrame(raf); raf = 0;
      canvas.width = canvas.width;
    },
    destroy() {
      destroyed = true; ro.disconnect(); window.removeEventListener('keydown', key);
      closeMini(); detachDirect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
