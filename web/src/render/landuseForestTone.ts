/** "Forest land use: ground / marked" — one shared display setting, like groundBlend.ts.
 *
 * The 2D land-use plan used to paint woods in the pale palette green (alpha .7) while the render view shows dark forest, so the two views
 * disagreed. `marked` (default) paints the forest class in a darker, more saturated green close to the render's canopy; `ground` lets
 * the forest take the ground tone (the same wash as the open ground of the other ground-matched layers), keeping only the outline and
 * the canopy texture so woods still read. Held in the render recipe (`vegetation.forestTone`). */
import { fromOklab, toOklab } from './roofContrast';
/** Inward woodland ecotone in metres. Geometry and satellite cover stay unchanged. */
export const FOREST_EDGE_WIDTH = 64;
export const FOREST_EDGE_BLUR = 7;
export type LanduseForestTone = 'ground' | 'marked';
export const LANDUSE_FOREST_TONES: readonly LanduseForestTone[] = ['marked', 'ground'];
export const DEFAULT_LANDUSE_FOREST_TONE: LanduseForestTone = 'marked';
export const isLanduseForestTone = (v: unknown): v is LanduseForestTone => v === 'ground' || v === 'marked';
/** The current value the painters read; set from the resolved recipe (`vegetation.forestTone`). */
let mode: LanduseForestTone = DEFAULT_LANDUSE_FOREST_TONE;
const listeners = new Set<() => void>();
export const getLanduseForestTone = (): LanduseForestTone => mode;
export function setLanduseForestTone(next: LanduseForestTone): void {
  if (next === mode || !isLanduseForestTone(next)) return;
  mode = next;
  for (const f of [...listeners]) f();
}
export function onLanduseForestTone(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
/** Labels (fr, en, zh, es, pt: the urbanText order). */
export const LANDUSE_FOREST_TONE_TITLE: readonly [string, string, string, string, string] = ['Occupation du sol · forêt', 'Land use · forest', '土地利用 · 森林', 'Uso del suelo · bosque', 'Uso do solo · floresta'];
export const LANDUSE_FOREST_TONE_LABEL: Record<LanduseForestTone, readonly [string, string, string, string, string]> = {
  marked: ['Vert foncé marqué', 'Dark marked green', '深绿醒目', 'Verde oscuro marcado', 'Verde escuro marcado'],
  ground: ['Couleur du fond', 'Ground colour', '地面色', 'Color del fondo', 'Cor do fundo'],
};

const hex = (h: string): [number, number, number] | undefined => { const m = /^#([0-9a-f]{6})$/i.exec(h); if (!m) return undefined; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toHex = (c: readonly number[]): string => '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number): string => { const A = hex(a), B = hex(b); return A && B ? toHex(A.map((x, i) => x + (B[i] - x) * t)) : a; };
/** Target lightness / chroma gain of the marked forest, in OKLab: the render canopy sits near L .42. */
const MARKED_L = 0.43, MARKED_CHROMA = 1.35;
export function markedForest(base: string): string {
  const c = hex(base); if (!c) return base;
  const [L, a, b] = toOklab(c.map(v => v / 255));
  const dark = Math.min(L, MARKED_L + (L - 0.69) * 0.35);   // keeps palettes that are already dark (night, blueprint) ordered
  return toHex(fromOklab(Math.max(0.2, dark), a * MARKED_CHROMA, b * MARKED_CHROMA).map(v => v * 255));
}
export interface ForestPaint { color: string; alpha: number; /** Opacity of the wood outline. */ edge: number }
/** Fill of the forest land-use class for a palette-like `{ land, paper, landOpacity }`. */
export function forestLandPaint(pal: { land: { forest: string; meadow: string }; paper: string; landOpacity: number }, tone: LanduseForestTone = mode): ForestPaint {
  if (tone === 'ground') return { color: mix(pal.paper, pal.land.meadow, 0.35), alpha: Math.min(0.8, pal.landOpacity * 0.8), edge: 0.7 };
  return { color: markedForest(pal.land.forest), alpha: 0.85, edge: 0.55 };
}
