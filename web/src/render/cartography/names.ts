/**
 * The names of the map (place, water and region names, the names of the towns given by the host): placed for a view
 * with the label layout of mapLabels.ts, memoised for an unchanged view, moved with the map during a gesture, drawn
 * with the furniture or by the host (`drawText`), or only placed for the live text layer (`placeText`, `liveText`).
 * Reads: world, palette, overlays, the host's text sources. Writes: nothing outside its own state.
 */
import type { CityScene } from '../cityCanvas';
import { DEFAULT_TEXT, textPlacement, drawMapLabels, cityTextLabels, type TextSettings } from '../textLayer';
import type { World } from '../../gen/types';
import { View } from '../view';
import { buildMapLabels, placeMapLabels, MapLabel, PlacedMapLabel } from '../mapLabels';
import { fontString, KindStyle } from '../labelStyles';
import { compactMapPanels } from '../legend';
import type { CartographyContext } from './context';
import type { LiveTextPlacement } from '../live/contract';

export function createNames(c: CartographyContext) {
  const { deps, makeCanvas, overlays } = c;
  let text = DEFAULT_TEXT;
  let mapLabels: MapLabel[] = buildMapLabels(c.world, c.pal.name, c.pal, text);
  const widthCache = new Map<string, number>();
  let placedLast: PlacedMapLabel[] = [];
  // One measure function for the renderer's life (its identity keys the layout memo); it measures on the context of the current draw.
  let measureCtx: CanvasRenderingContext2D | undefined;
  const measureLabel = (text: string, size: number, st: KindStyle): number => {
    const family = c.family;
    const key = `${st.family ?? family}|${st.italic ? 'i' : ''}${st.bold ? 'b' : ''}|${Math.round(size * 10)}|${text}`;
    let w = widthCache.get(key);
    if (w === undefined) {
      measureCtx!.font = fontString(st, Math.round(size * 10) / 10, st.family ?? family);
      w = measureCtx!.measureText(text).width;
      if (widthCache.size > 20000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  };
  let placementLast: { labels: MapLabel[]; cx: number; cy: number; scale: number; w: number; h: number; maxLabels: number; pad: number; reserved: boolean; placed: PlacedMapLabel[] } | undefined;
  let textSourcesOf: readonly CityScene[] | undefined,
    textLabelsOf: MapLabel[] | undefined,
    combinedLabels: MapLabel[] = mapLabels;
  /** The last exact placement, for the live text layer (render/live/contract.ts); a new object per placement. */
  let liveTextLast: LiveTextPlacement | undefined,
    liveTextRevision = 0;
  /** The last placement moved with the map to `view`: point and area labels by their anchor (a name stays by its
   * symbol), path labels glyph by glyph along their line. Nothing is placed again, so nothing jumps during a gesture. */
  function movedPlacement(last: NonNullable<typeof placementLast>, view: View, cssW: number, cssH: number): PlacedMapLabel[] {
    const k = view.scale / last.scale,
      ox = (last.cx - view.cx) * view.scale + cssW / 2,
      oy = (last.cy - view.cy) * view.scale + cssH / 2;
    const mx = (x: number): number => (x - cssW / 2) * k + ox,
      my = (y: number): number => (y - cssH / 2) * k + oy;
    return last.placed.map(pl => {
      const symbol = pl.symbol && { ...pl.symbol, x: mx(pl.symbol.x), y: my(pl.symbol.y) };
      if (pl.path || pl.glyphs.some(g => g.a !== 0)) {
        return { ...pl, cx: mx(pl.cx), cy: my(pl.cy), symbol, path: pl.path?.map(([x, y]) => [mx(x), my(y)] as [number, number]), glyphs: pl.glyphs.map(g => ({ ...g, x: mx(g.x), y: my(g.y) })) };
      }
      const ax = pl.symbol ? pl.symbol.x : (pl.label.x - last.cx) * last.scale + cssW / 2,
        ay = pl.symbol ? pl.symbol.y : (pl.label.y - last.cy) * last.scale + cssH / 2;
      const dx = mx(ax) - ax,
        dy = my(ay) - ay;
      return { ...pl, cx: pl.cx + dx, cy: pl.cy + dy, symbol, glyphs: pl.glyphs.map(g => ({ ...g, x: g.x + dx, y: g.y + dy })) };
    });
  }
  /** A context to measure names on when no target is given (placeText); made once. */
  let ownMeasureCtx: CanvasRenderingContext2D | null | undefined;
  /** Places the names for the view into `placedLast` (and `liveTextLast` when placed anew); false when names are off. */
  function placeNames(measure: CanvasRenderingContext2D | null | undefined, view: View, cssW: number, cssH: number, moving: boolean): boolean {
    const { pal, family } = c;
    const sources = deps.textSources?.();
    if (sources !== textSourcesOf || textLabelsOf !== mapLabels) {
      textSourcesOf = sources;
      textLabelsOf = mapLabels;
      const replaced = (c.world.names?.entries ?? []).flatMap(e => (e.replacedAnchor ? [e.replacedAnchor] : []));
      combinedLabels = sources?.length ? [...mapLabels, ...sources.flatMap(source => cityTextLabels(source, text, pal, c.world)).filter(label => !replaced.some(p => Math.abs(p.x - label.x) < 0.01 && Math.abs(p.y - label.y) < 0.01))] : mapLabels;
    }
    placedLast = [];
    if (!overlays.labels || !combinedLabels.length || !measure) return false;
    measureCtx = measure;
    const reserved = compactMapPanels(cssW, cssH) && overlays.cartouche ? [{ x0: 12, y0: cssH - 40, x1: 132, y1: cssH - 12 }] : undefined;
    // Same labels, view and options as the last frame (tile arrivals, style repaints): the placement is the same.
    const placement = textPlacement(text),
      last = placementLast;
    if (last && last.labels === combinedLabels && last.cx === view.cx && last.cy === view.cy && last.scale === view.scale && last.w === cssW && last.h === cssH && last.maxLabels === placement.maxLabels && last.pad === placement.pad && !last.reserved === !reserved)
      placedLast = last.placed;
    else if (moving && last && last.labels === combinedLabels && last.w === cssW && last.h === cssH) placedLast = movedPlacement(last, view, cssW, cssH);
    else {
      // Layouts are memoised per (measure, label style, text, size): a pan at a constant zoom lays nothing out again.
      const previous = last?.labels === combinedLabels ? new Set(last.placed.map(pl => pl.label)) : undefined;
      placedLast = placeMapLabels(combinedLabels, view, cssW, cssH, measureLabel, { ...placement, reserved, previous });
      placementLast = { labels: combinedLabels, cx: view.cx, cy: view.cy, scale: view.scale, w: cssW, h: cssH, maxLabels: placement.maxLabels, pad: placement.pad, reserved: !!reserved, placed: placedLast };
      liveTextLast = { placed: placedLast, view: { cx: view.cx, cy: view.cy, scale: view.scale }, w: cssW, h: cssH, palette: pal, family, revision: ++liveTextRevision };
    }
    return true;
  }
  function drawText(ctx: CanvasRenderingContext2D, view: View, cssW: number, cssH: number, moving = false): void {
    if (placeNames(ctx, view, cssW, cssH, moving)) drawMapLabels(ctx, placedLast, c.pal, c.family);
  }
  function placeText(view: View, cssW: number, cssH: number): void {
    if (ownMeasureCtx === undefined) ownMeasureCtx = makeCanvas(1, 1)?.getContext('2d') ?? null;
    placeNames(ownMeasureCtx, view, cssW, cssH, false);
  }
  /** New text settings: the names are built again. */
  const setText = (next: Readonly<TextSettings>): void => {
    text = next;
    mapLabels = buildMapLabels(c.world, c.pal.name, c.pal, text);
    widthCache.clear();
  };
  /** A new world: its names (built before the update commits, so a failure leaves the renderer as it was). */
  const namesOf = (next: World): MapLabel[] => buildMapLabels(next, c.pal.name, c.pal, text);
  const setNames = (next: MapLabel[]): void => {
    mapLabels = next;
  };
  return { drawText, placeText, setText, namesOf, setNames, text: () => text, lastPlaced: () => placedLast, liveText: () => (overlays.labels && combinedLabels.length ? liveTextLast : undefined) };
}
