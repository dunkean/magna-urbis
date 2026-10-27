/** "Roads & ground: Classic / Blended" — one shared display setting.
 *
 * Classic keeps today's drawing. Blended replaces the opaque ground fills, white road bands and
 * dark casings with translucent earth / sepia washes, so roads, city ground and river sources sit
 * on the map (parchment or painted render) instead of on top of it. The mode is global: regional
 * roads (terrainRoads.ts), the city canvas (cityCanvas.ts), its GL twin (cityGlStyle.ts) and the
 * river headwaters (vectorWaterRender.ts) read it here. Persisted in localStorage, overridable by `?blend=1`. */
export type GroundBlend = 'classic' | 'blended';
const KEY = 'magna.groundBlend';
function initial(): GroundBlend {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('blend');
    if (q) return q === '1' || q === 'blended' ? 'blended' : 'classic';
    return globalThis.localStorage?.getItem(KEY) === 'blended' ? 'blended' : 'classic';
  } catch { return 'classic'; }
}
let mode: GroundBlend = initial();
const listeners = new Set<() => void>();
export const getGroundBlend = (): GroundBlend => mode;
export const isBlended = (): boolean => mode === 'blended';
export function setGroundBlend(next: GroundBlend): void {
  if (next === mode) return;
  mode = next;
  try { globalThis.localStorage?.setItem(KEY, next); } catch { /* private mode */ }
  for (const f of [...listeners]) f();
}
export function onGroundBlend(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
/** Labels of the two modes and of the setting (fr, en, zh, es, pt: the urbanText order). */
export const GROUND_BLEND_LABEL: Record<GroundBlend, readonly [string, string, string, string, string]> = {
  classic: ['Classique', 'Classic', '经典', 'Clásico', 'Clássico'],
  blended: ['Intégré', 'Blended', '融合', 'Integrado', 'Integrado'],
};
export const GROUND_BLEND_TITLE: readonly [string, string, string, string, string] = ['Voies et sols', 'Roads & ground', '道路与地面', 'Vías y suelos', 'Vias e solos'];

/** Parchment-like maps (parchment and ink palettes) get a sepia ink wash; the others a trampled earth. */
export type BlendTone = 'sepia' | 'earth';
export const blendTone = (palette: string): BlendTone => palette === 'parchment' || palette === 'ink' ? 'sepia' : 'earth';

export type WashKind = 'block' | 'parcel' | 'garden' | 'place' | 'market' | 'common' | 'reserve' | 'footprint';
export interface Wash { color: string; alpha: number }
const WASH: Record<BlendTone, Record<WashKind, Wash>> = {
  sepia: {
    block: { color: '#a98657', alpha: 0.3 }, parcel: { color: '#b8935f', alpha: 0.27 }, garden: { color: '#a9a468', alpha: 0.28 }, place: { color: '#b99a62', alpha: 0.42 },
    market: { color: '#bf9a58', alpha: 0.42 }, common: { color: '#a3a870', alpha: 0.27 }, reserve: { color: '#b39a6c', alpha: 0.26 }, footprint: { color: '#a98657', alpha: 0.34 },
  },
  earth: {
    block: { color: '#9a8560', alpha: 0.32 }, parcel: { color: '#a08a64', alpha: 0.3 }, garden: { color: '#8f9a62', alpha: 0.26 }, place: { color: '#a8946a', alpha: 0.42 },
    market: { color: '#b09660', alpha: 0.42 }, common: { color: '#8c9a70', alpha: 0.26 }, reserve: { color: '#9a8d6e', alpha: 0.26 }, footprint: { color: '#97805a', alpha: 0.36 },
  },
};
export const groundWash = (kind: WashKind, tone: BlendTone): Wash => WASH[tone][kind];
/** Faint lot / block lines of the blended plan (close views only). */
export const blendLine = (tone: BlendTone): Wash => tone === 'sepia' ? { color: '#5a4530', alpha: 0.2 } : { color: '#5f5036', alpha: 0.2 };
/** Plan views that take the wash: the ground under buildings, and the sepia plans. Diagnostic views keep their colours. */
export const blendsGround = (view: string, palette: string): boolean => palette !== 'terrain' && view !== 'uses' && view !== 'roles' && (view === 'buildings' || palette === 'parchment' || palette === 'ink');

/** Urban street class → continuous visual rank (0 = main street … 4 = lane). */
export interface SoftStreet { fill: string; alpha: number; edge: string; edgeAlpha: number }
const STREET_ALPHA = [0.5, 0.45, 0.4, 0.34, 0.28];
/** Streets and tracks drawn as one family: earth tone, opacity decaying with rank. Structures (bridges, quays, fords, boardwalks, stairs) keep their classic paint. */
export function softStreet(role: string, rank: number, tone: BlendTone): SoftStreet {
  const r = Math.min(4, Math.max(0, rank)), a = role === 'track' ? Math.min(STREET_ALPHA[r], 0.3) : STREET_ALPHA[r];
  return tone === 'sepia' ? { fill: '#a07a4c', alpha: a, edge: '#6b4e2e', edgeAlpha: 0.1 } : { fill: '#a08a62', alpha: a, edge: '#5e4a30', edgeAlpha: 0.12 };
}
/** Roles drawn as structures, never washed. */
export const STRUCTURE_ROLES = new Set(['bridge', 'causeway', 'ford', 'quay', 'stairs', 'pier', 'boardwalk', 'walkway']);

/** Regional roads, blended: width floors (px) fall smoothly highway → trail, with the same opacity decay. */
export const BLEND_ROAD_PX = { highway: 2.6, main: 2.1, local: 1.6, track: 1.2, trail: 0.9 } as const;
export const BLEND_ROAD_ALPHA = { highway: 0.78, main: 0.68, local: 0.58, track: 0.44, trail: 0.34 } as const;
export const BLEND_ROAD_COLOR: Record<BlendTone, string> = { sepia: '#6e4c2c', earth: '#7a5f3e' };
/** Opacity factor of a road of steepest grade `g` (fraction, 0.12 = 12 %): none below 4 %, 65 % left from 20 %: roads read less up the slope. */
export const gradeFade = (g: number): number => 1 - 0.35 * Math.min(1, Math.max(0, (g - 0.05) / 0.15));
