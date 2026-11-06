/** Shared screen-space typography and the single source-to-group table. */
import type { NameKind } from '../gen/names/types';
import type { MapLabel, PlacedMapLabel } from './mapLabels';
import { fontString, kindStyles, type KindStyle } from './labelStyles';
import type { Palette } from './styles';
import type { CityScene } from './cityCanvas';
import { roleLabel } from './cityRoles';

export const TEXT_GROUPS = ['places', 'water', 'nature', 'countryside', 'city', 'landmarks', 'pins'] as const;
export type TextGroup = typeof TEXT_GROUPS[number];
export interface TextSettings { visible: boolean; groups: Record<TextGroup, boolean>; look: 'inherit' | 'serif' | 'sans'; size: number; density: 'low' | 'normal' | 'high'; halo: 'inherit' | 'strong' }
export const TEXT_SOURCE_GROUP: Record<NameKind | 'district' | 'landmark' | 'rpg' | 'site', TextGroup> = {
  town: 'places', village: 'places', sea: 'water', lake: 'water', river: 'water', hill: 'nature', forest: 'nature', farm: 'countryside', road: 'countryside', bridge: 'countryside', quarter: 'city', street: 'city', square: 'city', district: 'city', castle: 'landmarks', church: 'landmarks', gate: 'landmarks', landmark: 'landmarks', rpg: 'pins', site: 'pins',
};
export function defaultText(overrides: Partial<TextSettings> = {}): TextSettings {
  return { visible: true, groups: { places: true, water: true, nature: true, countryside: true, city: true, landmarks: true, pins: true }, look: 'inherit', size: 1, density: 'normal', halo: 'inherit', ...overrides };
}
export const DEFAULT_TEXT = defaultText();
export function textGroup(kind: string): TextGroup { return TEXT_SOURCE_GROUP[kind.startsWith('rpg:') ? 'rpg' : kind as keyof typeof TEXT_SOURCE_GROUP] ?? 'landmarks'; }
export function textFamily(text: Readonly<TextSettings>, pal: Palette): string { return text.look === 'serif' ? "Georgia, 'Times New Roman', serif" : text.look === 'sans' ? 'Verdana, Arial, sans-serif' : pal.fontFamily; }
export function textStyle(st: KindStyle, text: Readonly<TextSettings>, pal: Palette): KindStyle {
  const night = pal.name === 'night', strong = text.halo === 'strong', density = text.density === 'low' ? 1.5 : text.density === 'high' ? .65 : 1;
  return { ...st, family: textFamily(text, pal), color: night ? '#f2e9cc' : strong ? '#26342f' : st.color,
    halo: night ? '#111d2b' : strong ? '#fff9e9' : pal.lab.halo, haloOpacity: strong || night ? .96 : pal.lab.haloOp, haloWidth: strong ? .36 : .26,
    sizeM: st.sizeM * text.size, minPx: st.minPx * text.size, maxPx: st.maxPx * text.size, minScale: st.minScale * density, maxScale: st.maxScale / density };
}
export function styleTextLabels(labels: MapLabel[], text: Readonly<TextSettings>, pal: Palette): MapLabel[] {
  if (!text.visible) return [];
  return labels.filter(l => text.groups[textGroup(l.kind)]).map(l => ({ ...l, st: textStyle(l.st, text, pal) }));
}
export function textPlacement(text: Readonly<TextSettings>): { maxLabels: number; pad: number } { return { maxLabels: text.density === 'low' ? 100 : text.density === 'high' ? 480 : 320, pad: text.density === 'low' ? 6 : text.density === 'high' ? 1.5 : 2.5 }; }
const cityCache = new WeakMap<CityScene, { key: string; labels: MapLabel[] }>();
export function cityTextLabels(scene: CityScene, text: Readonly<TextSettings>, pal: Palette): MapLabel[] {
  const key = JSON.stringify([text, pal.name, pal.ink, pal.lab]);
  const old = cityCache.get(scene); if (old?.key === key) return old.labels;
  const styles = kindStyles(pal.name, pal), labels: MapLabel[] = [];
  for (const d of scene.districts) if (d.anchor && (d.role || d.label)) labels.push({ id: `district:${d.layout}:${d.id}`, kind: 'district', text: d.label || roleLabel(d.role!), ...d.anchor, st: { ...styles.quarter, shape: 'point', minScale: .09, maxScale: Infinity, stretch: 0 } });
  for (const l of scene.landmarks) labels.push({ id: `landmark:${labels.length}`, kind: 'landmark', text: l.label, ...l.point, st: { ...styles.church, symbol: undefined, minScale: .3, maxScale: Infinity } });
  const result = styleTextLabels(labels, text, pal); cityCache.set(scene, { key, labels: result }); return result;
}

const curvedHalos = new Map<string, { canvas: OffscreenCanvas | HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
/** Rasterize before rotation: Chrome's deferred strokeText tessellation can leave long stray edges on a composited map. */
function curvedHalo(ctx: CanvasRenderingContext2D, ch: string): void {
  const t = ctx.getTransform(), density = Math.max(2, Math.round(Math.hypot(t.a, t.b) * 100) / 100), key = JSON.stringify([ch, ctx.font, ctx.lineWidth, ctx.strokeStyle, density]);
  let glyph = curvedHalos.get(key);
  if (!glyph) {
    const m = ctx.measureText(ch), pad = ctx.lineWidth / 2 + 2 / density;
    const x = Math.floor((-m.actualBoundingBoxLeft - pad) * density) / density, y = Math.floor((-m.actualBoundingBoxAscent - pad) * density) / density;
    const width = Math.max(1, Math.ceil((m.actualBoundingBoxRight + pad - x) * density)), height = Math.max(1, Math.ceil((m.actualBoundingBoxDescent + pad - y) * density));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    const c = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    c.setTransform(density, 0, 0, density, -x * density, -y * density);
    c.font = ctx.font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = ctx.lineWidth; c.strokeStyle = ctx.strokeStyle;
    c.strokeText(ch, 0, 0);
    glyph = { canvas, x, y, w: width / density, h: height / density };
    if (curvedHalos.size >= 512) curvedHalos.delete(curvedHalos.keys().next().value!);
    curvedHalos.set(key, glyph);
  }
  ctx.drawImage(glyph.canvas, glyph.x, glyph.y, glyph.w, glyph.h);
}

export function drawMapLabels(ctx: CanvasRenderingContext2D, placed: PlacedMapLabel[], pal: Palette, family: string): void {
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const pl of placed) {
    const st = pl.label.st;
    const halo = Math.max(2.4, pl.size * (st.haloWidth ?? .26));
    const curved = pl.glyphs.some((g) => g.a !== 0);
    for (const pass of [0, 1] as const) {
      ctx.globalAlpha = pass === 0 ? (st.haloOpacity ?? pal.lab.haloOp) : 1;
      ctx.strokeStyle = st.halo ?? pal.lab.halo; ctx.fillStyle = st.color; ctx.lineWidth = halo;
      let lastSize = -1;
      for (const g of pl.glyphs) {
        if (g.ch === ' ') continue;
        if (g.size !== lastSize) { ctx.font = fontString(st, Math.round(g.size * 10) / 10, st.family ?? family); lastSize = g.size; }
        if (curved) {
          ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
          if (pass === 0) curvedHalo(ctx, g.ch); else ctx.fillText(g.ch, 0, 0);
          ctx.restore();
        } else if (pass === 0) ctx.strokeText(g.ch, g.x, g.y); else ctx.fillText(g.ch, g.x, g.y);
      }
    }
    ctx.globalAlpha = 1;
    if (pl.symbol) {
      const { x, y, r } = pl.symbol;
      ctx.lineWidth = 1.1; ctx.strokeStyle = st.color; ctx.fillStyle = st.color;
      ctx.beginPath();
      switch (st.symbol) {
        case 'cross': ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x, y + r * 1.25); ctx.moveTo(x - r * 0.85, y - r * 0.3); ctx.lineTo(x + r * 0.85, y - r * 0.3); ctx.lineWidth = 1.6; ctx.stroke(); break;
        case 'tri': ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.lineTo(x - r * 1.1, y + r * 0.8); ctx.closePath(); ctx.fill(); break;
        case 'square': ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8); ctx.fill(); break;
        case 'ring': ctx.arc(x, y, r * 0.7, 0, (Math.PI * 2)); ctx.stroke(); break;
        default: ctx.arc(x, y, r * 0.75, 0, (Math.PI * 2)); ctx.fill();
      }
    }
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

const widths = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();
export function measureTextCached(ctx: CanvasRenderingContext2D, text: string, size: number, st: KindStyle, family: string): number {
  let cache = widths.get(ctx); if (!cache) widths.set(ctx, cache = new Map());
  const font = fontString(st, Math.round(size * 10) / 10, st.family ?? family), key = `${font}|${text}`;
  let width = cache.get(key);
  if (width === undefined) { ctx.font = font; width = ctx.measureText(text).width; if (cache.size > 20000) cache.clear(); cache.set(key, width); }
  return width;
}
