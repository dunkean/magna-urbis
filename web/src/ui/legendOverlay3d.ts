import type { World } from '../gen/types';
import type { Palette } from '../render/styles';
import { cartoucheModel, legendModel, plainCartouchePanel, plainLegendPanel, drawPanelCanvas, compactMapPanels, type SemanticLegendEntry } from '../render/legend';
import { FONT_STACKS } from '../render/labelStyles';

/** What the 3D view shows as map furniture: the same models as the 2D map (legend, cartouche without scale bar).
 * V2 holds a World; the benches hold none and give their title block instead (the same plain panels as their 2D map). */
export type Furniture3d = { palette: Palette; legend: boolean; cartouche: boolean; semantic: readonly SemanticLegendEntry[] }
  & ({ world: World; bench?: undefined } | { world?: undefined; bench: { title: string; subtitle: string } });
const sources = new WeakMap<HTMLElement, () => Furniture3d | undefined>();
/** The owner of a 3D host says what its furniture is (read on a slow tick, never per frame). */
export function provideFurniture3d(host: HTMLElement, source: () => Furniture3d | undefined): void { sources.set(host, source); }
const redraws = new WeakMap<HTMLElement, () => void>();
/** Redraws the furniture of a 3D host now (keyed: a no-op when nothing changed). The owner calls it when its settings, data or visibility change. */
export function refreshFurniture3d(host: HTMLElement): void { redraws.get(host)?.(); }

/** Screen-space legend + cartouche canvas above the 3D view; its bitmap is added to every capture by wrapping the text overlay's composite. */
export function mountLegendOverlay3d(host: HTMLElement, owner: { host: HTMLElement }, text?: { composite(blob: Blob): Promise<Blob>; dispose(): void }) {
  const canvas = document.createElement('canvas'); canvas.className = 'legend-overlay-3d'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3'; host.append(canvas);
  const ctx = canvas.getContext('2d')!;
  let lastKey = '';
  function draw(force = false): void {
    const f = sources.get(owner.host)?.(), w = host.clientWidth, h = host.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    const key = JSON.stringify([w, h, dpr, f && [f.world?.seed, f.bench, f.palette.name, f.legend, f.cartouche, f.semantic.map(e => [e.label, e.color, e.pattern, e.look])]]);
    if (!force && key === lastKey) return;
    lastKey = key;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!f || !w || !h || compactMapPanels(w, h) || !(f.legend || f.cartouche)) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const family = FONT_STACKS[f.palette.name] ?? f.palette.fontFamily, m = 12;
    if (f.cartouche) drawPanelCanvas(ctx, f.world ? cartoucheModel(f.world, f.palette, 1, false) : plainCartouchePanel(f.palette, f.bench.title, f.bench.subtitle), m, m, family);
    if (f.legend && (f.world || f.semantic.length)) { const lg = f.world ? legendModel(f.world, f.palette, f.semantic) : plainLegendPanel(f.palette, f.semantic); drawPanelCanvas(ctx, lg, m, h - m - lg.h, family); }
  }
  const resize = new ResizeObserver(() => draw()); resize.observe(host);
  // No polling: the owner calls `refreshFurniture3d` on change; the view's dispose (through the text overlay) ends this overlay.
  redraws.set(owner.host, () => draw());
  function dispose(): void { redraws.delete(owner.host); resize.disconnect(); canvas.remove(); }
  draw();
  if (text) {
    const composite = text.composite.bind(text), disposeText = text.dispose.bind(text);
    text.composite = async blob => {
      draw(true);
      const base = await composite(blob), bitmap = await createImageBitmap(base), result = document.createElement('canvas'); result.width = bitmap.width; result.height = bitmap.height;
      const target = result.getContext('2d')!; target.drawImage(bitmap, 0, 0); bitmap.close(); target.drawImage(canvas, 0, 0, result.width, result.height);
      return new Promise<Blob>((resolve, reject) => result.toBlob(value => value ? resolve(value) : reject(new Error('Legend overlay capture failed.')), 'image/png'));
    };
    text.dispose = () => { dispose(); disposeText(); };
  }
  return { canvas, dispose };
}
