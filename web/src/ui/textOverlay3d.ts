import type { Terrain3d } from './terrain3d';
import type { MapLabel } from '../render/mapLabels';
import { placeMapLabels } from '../render/mapLabels';
import { drawMapLabels, textFamily, textPlacement, measureTextCached, type TextSettings } from '../render/textLayer';
import type { Palette } from '../render/styles';
import { drawSemanticLimits3d, type SemanticLimits3dInput } from './semanticLimits3d';

export interface TextOverlay3dInput { labels: readonly MapLabel[]; text: Readonly<TextSettings>; palette: Palette }
/** No animation loop: a bounded placement runs at most every 80ms, then the bitmap stays untouched. */
export function mountTextOverlay3d(host: HTMLElement, getTerrain: () => Terrain3d | undefined) {
  const canvas = document.createElement('canvas'); canvas.className = 'text-overlay-3d'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2'; host.append(canvas);
  const ctx = canvas.getContext('2d')!;
  let input: TextOverlay3dInput | undefined, timer: ReturnType<typeof setTimeout> | undefined, dirty = false, last = -Infinity;
  let limits: SemanticLimits3dInput | undefined, limitsKey='';
  function draw(): void {
    clearTimeout(timer); timer = undefined;
    if (!dirty) return;
    dirty = false; last = performance.now();
    const w = host.clientWidth, h = host.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!w || !h) return;
    const terrain=getTerrain(), projection = terrain?.labelProjector(); if (!projection || !terrain) return;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if(limits)drawSemanticLimits3d(ctx,terrain,projection,limits);
    if (!input || !input.text.visible) return;
    const { text, palette } = input, candidates: MapLabel[] = [];
    // Input lists are cached and priority sorted; work is bounded even on a continental map.
    for (let i = 0; i < Math.min(1024, input.labels.length); i++) {
      const label = input.labels[i], st = label.st;
      if (projection.scale < st.minScale || projection.scale > st.maxScale) continue;
      const point = projection.project(label.x, label.y); if (!point) continue;
      const size = Math.max(st.minPx, Math.min(st.maxPx, st.sizeM * projection.scale));
      candidates.push({ ...label, x: point[0] - w / 2, y: point[1] - h / 2, path: undefined, span: undefined, st: { ...st, shape: 'point', minScale: 0, maxScale: Infinity, minPx: size, maxPx: size } });
      if (candidates.length >= 400) break;
    }
    const family = textFamily(text, palette), options = textPlacement(text);
    const placed = placeMapLabels(candidates, { cx: 0, cy: 0, scale: 1 }, w, h, (t, size, st) => measureTextCached(ctx, t, size, st, family), { ...options, maxLabels: text.density === 'low' ? 90 : text.density === 'high' ? 240 : 180 });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawMapLabels(ctx, placed, palette, family);
  }
  function invalidate(): void { dirty = true; if (timer === undefined) timer = setTimeout(draw, Math.max(0, 80 - (performance.now() - last))); }
  const resize = new ResizeObserver(invalidate); resize.observe(host);
  return { canvas, invalidate, set(next: TextOverlay3dInput): void { if (input?.labels === next.labels && input.text === next.text && input.palette === next.palette) return; input = next; invalidate(); },
    setLimits(next: SemanticLimits3dInput): void {
      const key=JSON.stringify([next.rural,next.urban,next.depth,next.opacity,next.classes]);
      if(limits && limitsKey===key && limits.landuse===next.landuse && limits.scenes.length===next.scenes.length && limits.scenes.every((s,i)=>s===next.scenes[i]))return;
      limits=next;limitsKey=key;invalidate();
    },
    flush(): void { dirty = true; draw(); },
    async composite(blob: Blob): Promise<Blob> {
      dirty = true; draw();
      const bitmap = await createImageBitmap(blob), result = document.createElement('canvas'); result.width = bitmap.width; result.height = bitmap.height;
      const target = result.getContext('2d')!; target.drawImage(bitmap, 0, 0); bitmap.close(); target.drawImage(canvas, 0, 0, result.width, result.height);
      return new Promise((resolve, reject) => result.toBlob(value => value ? resolve(value) : reject(new Error('Text overlay capture failed.')), 'image/png'));
    },
    dispose(): void { clearTimeout(timer); resize.disconnect(); canvas.remove(); },
  };
}
