/** Standalone Rust geometry kernels for existing regression fixtures and workshop diagnostics. */
import type { Rng } from '../../web/src/gen/core/rng';
import type { Noise2D } from '../../web/src/gen/core/noise';
import type { FarmBuilding, FarmPlot, FarmSize, Polygon, Polyline, Vec2 } from '../../web/src/gen/types';
import { synchronousCoreWasm } from './wasmRuntime';
export type FarmType = 'vierkanthof' | 'u-yard' | 'l-yard' | 'haufenhof' | 'longere' | 'einhaus' | 'masseria' | 'dvor'
  | 'norse-longhouse' | 'roundhouse' | 'minka' | 'hanok' | 'chinese-court' | 'indian-court' | 'ksar' | 'sahel-compound'
  | 'kraal' | 'ail' | 'native-longhouse' | 'pueblo-ranch' | 'solar' | 'kancha' | 'stilt' | 'fungal-farm' | 'spore-farm'
  // Types laid out from their catalogue record (house size, core and ancillary buildings, layout).
  | 'cascina' | 'villa-rustica' | 'cortijo' | 'bustan' | 'izbah' | 'tower-farm' | 'dhani' | 'thinnai' | 'newar-farm'
  | 'smial-garden' | 'gnome-croft' | 'mage-steading' | 'elven-glade' | 'orc-steading' | 'goblin-burrow' | 'giant-steading'
  | 'lizard-mound' | 'tipi-camp' | 'winter-house' | 'chum-camp' | 'agbo-ile' | 'tukul' | 'dhaka-homestead' | 'stone-huts'
  | 'shamba' | 'calli-court' | 'wattle-homestead' | 'kainga' | 'maloca-clearing' | 'plank-house' | 'joglo' | 'nha-ba-gian';
export const FARM_SIZES: FarmSize[] = ['cottage', 'family', 'large', 'manor'];
export interface FarmContext { streetAlignedHomes?: boolean; culture: string; biome?: string; soil: number; slope: number;
  downhill: Vec2 | null; wet: number; exposed: number; market: number; west: number; pop?: number }
type V2 = [number, number];
interface Frame { south: V2; west: V2; down: V2 | null }
export interface LocalFarm { type: FarmType; size: FarmSize; W: number; D: number;
  parts: { use: string; poly: V2[]; passage?: boolean; round?: boolean }[]; yard: V2[]; walls: V2[][];
  plots: { kind: FarmPlot['kind']; poly: V2[] }[]; trees: V2[]; gateU: number; entry: V2; tags: string[] }
type Wasm = { landuse_farm_tool(r: string): string; landuse_field_tool(r: string, dir: (x: number, y: number) => number,
  slope: (x: number, y: number) => number, strips: (x: number, y: number) => number,
  clear: (ax: number, ay: number, bx: number, by: number) => boolean, noise: (x: number, y: number) => number, random: () => number): string;
  landuse_growth_reserve(base: Uint8Array, n: number, cell: number, footprints: string): Uint8Array };
const wasm = (): Wasm => synchronousCoreWasm() as unknown as Wasm;
const farm = <T>(r: object): T => JSON.parse(wasm().landuse_farm_tool(JSON.stringify(r))) as T;
export const farmRegime = (culture: string): [FarmType, number][] => farm({ operation: 'regime', culture });
export const farmType = (context: FarmContext, size: FarmSize, rng: Rng): FarmType => farm({ operation: 'type', context, size, seed: rng.seedKey });
export const frameOf = (inward: Vec2, downhill: Vec2 | null): Frame => farm({ operation: 'frame', inward, downhill });
export const layoutFarm = (type: FarmType, size: FarmSize, context: FarmContext, frame: Frame, rng: Rng): LocalFarm => farm({ operation: 'layout', type, size, context, frame, seed: rng.seedKey });
export const placeFarm = (local: LocalFarm, type: FarmType, origin: Vec2, inward: Vec2): {
  lot: Polygon; parts: FarmBuilding[]; yard: Polygon; walls: Polyline[]; plots: FarmPlot[]; trees: Vec2[]; gate: Vec2; entry: Vec2; angle: number;
} => farm({ operation: 'place', local, type, origin, inward });
export interface Furlong { outer: Polygon; holes: Polygon[]; angle: number; enclosed: boolean; strips?: Polygon[]; stripW: number; layout?: 'parcel' }
export interface FieldNet { furlongs: Furlong[]; ways: Polyline[]; headlands: Polyline[]; margins?: { outer: Polygon; holes: Polygon[] }[] }
export interface FieldCtx { dirAt(x: number, y: number): number; slopeAt(x: number, y: number): number; closeAt(x: number, y: number): boolean;
  noise: Noise2D; rng: Rng; stripsAt?(p: Vec2): boolean; minArea?: number; accessWays?: boolean; regular?: boolean }
export type Ring = [number, number][];
export function toRing(poly: Polygon): Ring { return [...poly, poly[0]].map(p => [p.x, p.y]); }
const region = (rings: Ring[]) => ({ outer: rings[0].slice(0, -1).map(([x, y]) => ({ x, y })),
  holes: rings.slice(1).map(r => r.slice(0, -1).map(([x, y]) => ({ x, y }))) });
const zero = () => 0, blocked = () => false;
function field<T>(r: object, net?: FieldNet, ctx?: FieldCtx, clear?: (a: Vec2, b: Vec2) => boolean): T {
  const result = JSON.parse(wasm().landuse_field_tool(JSON.stringify(r), ctx?.dirAt ?? zero, ctx?.slopeAt ?? zero,
    ctx?.stripsAt ? (x, y) => ctx.stripsAt!({ x, y }) ? 1 : 0 : () => 1,
    clear ? (ax, ay, bx, by) => clear({ x: ax, y: ay }, { x: bx, y: by }) : blocked, ctx ? (x, y) => ctx.noise.noise(x, y) : zero, ctx ? () => ctx.rng.float() : zero)) as { net: FieldNet; result: T };
  if (net) Object.assign(net, result.net);
  return result.result;
}
export function partitionRegion(outer: Polygon, holes: Polygon[], ctx: FieldCtx, net: FieldNet): void {
  field({ operation: 'partition', outer, holes, net,
    closed: ctx.closeAt(0, 0), regular: ctx.regular, accessWays: ctx.accessWays, minArea: ctx.minArea, hasStripsAt: !!ctx.stripsAt }, net, ctx);
}
export const clipToRings = (path: Polyline, rings: Ring[]): Polyline[] => field({ operation: 'clip', path, ...region(rings) });
export const pruneWays = (net: FieldNet, connectors: { path: Polyline; width: number }[], tol = 12): { dropped: number; demoted: number } =>
  field({ operation: 'prune', net, connectors, tol }, net);
export const connectFieldWays = (net: FieldNet, connectors: { path: Polyline; width: number }[], reach: number, clear: (a: Vec2, b: Vec2) => boolean): number =>
  field({ operation: 'connect', net, connectors, reach }, net, undefined, clear);
export function farmGrowthReserve(base: Uint8Array, n: number, cell: number, footprints: { outer: Polygon; holes: Polygon[] }[][]): Uint8Array {
  return footprints.length ? wasm().landuse_growth_reserve(base, n, cell, JSON.stringify(footprints)) : base;
}
