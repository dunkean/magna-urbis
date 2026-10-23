/** City Bench per-item edits: one quarter, one lot or one house.
 *
 * Edits are kept apart from the applied configs (whose normalisers keep the
 * strict Rust contract) and injected into each request, only when non-empty, so
 * an engine without override support still accepts unedited plans:
 * - quarters → `layoutConfig.overrides.quarters["<index in layout.quarters>"]` (Rust plan, stream C2/B2);
 * - lots → `parcelConfig.overrides.parcels["<parcel id>"]` (Rust programme, stream B2);
 * - houses → `config.recipe` / `config.overrides.variant` of that building's own
 *   placement request, applied before every native plan, so a regeneration
 *   reproduces the edit without a repair pass.
 * They persist in the share query (`urban.edits`), hence in links, decors and MU1 codes. */
import type { LayoutConfig, ParcelConfig } from '../../../rust/bridge/urban';
import type { PlacementRequest } from '../../../rust/bridge/urbanArchitecture';
import type { EditShape, ParcelOverride, QuarterOverride } from '../../../rust/bridge/urbanConfig';

/** Contract types (`rust/bridge/urbanConfig.ts`), aliased for callers. */
export type QuarterEdit = QuarterOverride;
export type LotEdit = ParcelOverride;
export type { EditShape };
/** `floors`: the request's floor wish clamped into the chosen style's range when
 * the edit was made (`null` = native choice), so the edit replays identically. */
export interface HouseEdit { recipe: string; variant: string; floors?: number | null }
export interface CityEdits { quarters: Record<string, QuarterEdit>; parcels: Record<string, LotEdit>; buildings: Record<string, HouseEdit> }
export type EditScope = keyof CityEdits;

export const emptyEdits = (): CityEdits => ({ quarters: {}, parcels: {}, buildings: {} });
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
const num = (v: unknown, min: number, max: number): number | undefined => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
/** Drops undefined fields; an item without any field is no edit at all. */
function compact<T extends object>(item: T): T | undefined {
  const out = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}
const SALT_MAX = 2 ** 31 - 1, COORD_MAX = 1e6;
/** Integer 1..2^31−1; 0 or anything else is no salt. */
const salt = (v: unknown): number | undefined => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= SALT_MAX ? v : undefined;
/** A ring of finite points in [-1e6, 1e6], rounded to 0.1 m, consecutive duplicates (and the closing copy) dropped. */
function cleanRing(v: unknown, min: number): { x: number; y: number }[] | undefined {
  if (!Array.isArray(v) || v.length > 4 * 512) return undefined;
  const out: { x: number; y: number }[] = [];
  for (const p of v) {
    const r = record(p), x = r.x, y = r.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > COORD_MAX || Math.abs(y) > COORD_MAX) return undefined;
    const q = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, last = out[out.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) out.push(q);
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return out.length >= min && out.length <= 512 ? out : undefined;
}
/** Compact, URL-safe share form of an outline (links stay under the dev server's
 * 16 KB header limit): `~` + rings joined by `_`; a ring is decimetre integers in
 * base 36 joined by `.`, the first vertex absolute and the others as deltas. */
export function packShape(s: EditShape): string {
  const ring = (r: readonly { x: number; y: number }[]): string => {
    let px = 0, py = 0; const out: string[] = [];
    for (const p of r) { const x = Math.round(p.x * 10), y = Math.round(p.y * 10); out.push((x - px).toString(36), (y - py).toString(36)); px = x; py = y; }
    return out.join('.');
  };
  return `~${[s.outer, ...s.holes ?? []].map(ring).join('_')}`;
}
/** Inverse of `packShape`; undefined for anything malformed. */
export function unpackShape(text: string): EditShape | undefined {
  if (!/^~[0-9a-z.\-_]*$/.test(text)) return undefined;
  const rings = text.slice(1).split('_').map(r => {
    const n = r.split('.').map(t => parseInt(t, 36)); if (n.length % 2 || n.some(v => !Number.isFinite(v))) return undefined;
    const out: { x: number; y: number }[] = []; let x = 0, y = 0;
    for (let i = 0; i < n.length; i += 2) { x += n[i]; y += n[i + 1]; out.push({ x: x / 10, y: y / 10 }); }
    return out;
  });
  if (!rings.length || rings.some(r => !r)) return undefined;
  return { outer: rings[0]!, holes: rings.slice(1) as { x: number; y: number }[][] };
}
/** Share form of the edits: every outline packed (`normalizeEdits` reads both forms). */
export function packEdits(edits: CityEdits): unknown {
  const pack = <T extends { shape?: EditShape }>(items: Record<string, T>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.shape ? { ...v, shape: packShape(v.shape) } : v]));
  return { quarters: pack(edits.quarters), parcels: pack(edits.parcels), buildings: edits.buildings };
}
/** Outer ring of 3..512 vertices, at most 16 holes; anything else drops the field. */
function shape(v: unknown): EditShape | undefined {
  if (typeof v === 'string') v = unpackShape(v);
  const r = record(v), outer = cleanRing(r.outer, 3);
  if (!outer) return undefined;
  if (r.holes === undefined) return { outer, holes: [] };
  if (!Array.isArray(r.holes) || r.holes.length > 16) return undefined;
  const holes: { x: number; y: number }[][] = [];
  for (const h of r.holes) { const ring = cleanRing(h, 3); if (!ring) return undefined; holes.push(ring); }
  return { outer, holes };
}
const cleanQuarter = (v: unknown): QuarterEdit | undefined => { const r = record(v); return compact({ culture: text(r.culture), tissue: text(r.tissue), density: num(r.density, 0.1, 10), role: text(r.role), wealth: num(r.wealth, 0, 1),
  shape: shape(r.shape), deleted: r.deleted === true ? true : undefined, salt: salt(r.salt) }); };
const cleanLot = (v: unknown): LotEdit | undefined => { const r = record(v); return compact({ role: text(r.role), function: text(r.function), households: num(r.households, 0, 500),
  shape: shape(r.shape), deleted: r.deleted === 'merge' || r.deleted === 'garden' ? r.deleted as 'merge' | 'garden' : undefined, salt: salt(r.salt) }); };
const cleanHouse = (v: unknown): HouseEdit | undefined => { const r = record(v); const recipe = text(r.recipe); return recipe ? compact({ recipe, variant: text(r.variant) ?? 'default', floors: r.floors === null ? null : num(r.floors, 1, 30) }) : undefined; };
const cleaners: { [K in EditScope]: (v: unknown) => CityEdits[K][string] | undefined } = { quarters: cleanQuarter, parcels: cleanLot, buildings: cleanHouse };

/** Accepts anything (old links, hand-edited JSON); keeps only valid edits. */
export function normalizeEdits(raw: unknown): CityEdits {
  const source = record(raw), out = emptyEdits();
  for (const scope of Object.keys(cleaners) as EditScope[]) for (const [key, value] of Object.entries(record(source[scope]))) {
    const item = cleaners[scope](value);
    if (item) (out[scope] as Record<string, unknown>)[key] = item;
  }
  return out;
}
export const editCount = (edits: CityEdits): number => Object.keys(edits.quarters).length + Object.keys(edits.parcels).length + Object.keys(edits.buildings).length;
export const hasEdits = (edits: CityEdits): boolean => editCount(edits) > 0;

/** New edits with one item replaced (merged) or removed (`undefined`). */
export function setEdit<K extends EditScope>(edits: CityEdits, scope: K, key: string, value: Partial<CityEdits[K][string]> | undefined): CityEdits {
  const next: CityEdits = { quarters: { ...edits.quarters }, parcels: { ...edits.parcels }, buildings: { ...edits.buildings } };
  const items = next[scope] as Record<string, unknown>;
  const item = value === undefined ? undefined : cleaners[scope](scope === 'buildings' ? value : { ...items[key] as object, ...value });
  if (item) items[key] = item; else delete items[key];
  return next;
}

/** Plan request config: `overrides` only when a quarter is edited. */
export function layoutWithEdits(config: LayoutConfig, edits: CityEdits): LayoutConfig {
  return Object.keys(edits.quarters).length ? { ...config, overrides: { quarters: edits.quarters } } as LayoutConfig : config;
}
/** Parcel request config: `overrides` only when a lot is edited. */
export function parcelWithEdits(config: ParcelConfig, edits: CityEdits): ParcelConfig {
  return Object.keys(edits.parcels).length ? { ...config, overrides: { parcels: edits.parcels } } as ParcelConfig : config;
}

/** The request with an explicit recipe and variant; the input is not mutated. */
export function styledRequest<T extends PlacementRequest>(request: T, edit: HouseEdit | undefined): T {
  if (!edit || !request.config) return request;
  const overrides = { ...request.config.overrides, variant: edit.variant, ...(edit.floors !== undefined ? { floors: edit.floors } : {}) };
  return { ...request, config: { ...request.config, recipe: edit.recipe, overrides } };
}
/** The floor wish of `request` brought into a style's floor range (undefined: keep it). */
export function floorsFor(request: PlacementRequest, range: [number, number] | undefined): number | null | undefined {
  const wish = request.config?.overrides?.floors;
  if (typeof wish !== 'number' || !range) return undefined;
  return wish >= range[0] && wish <= range[1] ? undefined : Math.min(range[1], Math.max(range[0], Math.round(wish)));
}
/** Every house edit applied to its own request; unedited requests keep their identity. */
export function applyHouseEdits<T extends PlacementRequest>(requests: T[], edits: Record<string, HouseEdit> | undefined): T[] {
  if (!edits || !Object.keys(edits).length) return requests;
  return requests.map(request => styledRequest(request, edits[request.id]));
}
