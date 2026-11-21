/**
 * Neighbouring towns of the V2 (native urban engine).
 *
 * Towns are generated in a canonical order: population descending, then key. A town receives the claims
 * (`layout.claim`: held land and edge streets) of the towns before it whose land comes close to its centre, and the
 * urban engine keeps off that land and joins those streets. A town never reads the claim of a town after it.
 *
 * Before a run, an earlier town whose plan is not known yet (generated in the same run, or never built) may still
 * become a neighbour: a conservative bound of the land it can hold decides whether the later town must wait for it.
 * Towns that cannot reach each other keep running in parallel lanes.
 */
import type { Settlement, Vec2, World } from '../gen/types';
import type { Claim } from '../../../rust/bridge/urban';
import type { V2Settings } from './contracts';
import type { RustTownSnapshot } from './rustUrban';
import { extentRadius } from '../gen/settlements/planner';

export interface TownSeat {
  key: string;
  population: number;
  center: Vec2;
  /** Site radius sent to the urban engine (m). */
  radius: number;
  /** Radius the footprint grows to: the layout radius, else the site radius times the radius scale (m). */
  footprint: number;
  /** Claim of the town's current plan, when it has one. */
  claim?: Claim;
  /** The town has a plan on the map (with or without a claim). */
  built: boolean;
}
export interface TownRun {
  /** Keys to generate, every town after the earlier towns it waits for (the selection order otherwise). */
  order: string[];
  /** Per town of the run: the earlier towns of the run it must wait for (canonical order). */
  waits: Map<string, string[]>;
  /** Built towns added because they may border a town of the run: regenerated through the stage they were built to. */
  cascaded: Set<string>;
}
type Box = { x0: number; y0: number; x1: number; y1: number };

/** Canonical order: population descending, then key. */
export function compareTowns(a: { key: string; population: number }, b: { key: string; population: number }): number {
  return b.population - a.population || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
/** Distance from a town's centre within which an earlier town's land makes it a neighbour (m). */
export function neighbourReach(population: number): number {
  return 3 * extentRadius(population) + 100;
}
/** Bounding box of a claim's land; undefined for a claim that holds no land. */
export function claimBounds(claim: Claim): Box | undefined {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const shape of claim.land)
    for (const p of shape.outer) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  return x0 <= x1 && y0 <= y1 ? { x0, y0, x1, y1 } : undefined;
}
/** The claim's land comes within the neighbour reach of a town of this population at `center`. */
export function claimReaches(claim: Claim, center: Vec2, population: number): boolean {
  const box = claimBounds(claim);
  if (!box) return false;
  const dx = Math.max(box.x0 - center.x, 0, center.x - box.x1),
    dy = Math.max(box.y0 - center.y, 0, center.y - box.y1);
  return Math.hypot(dx, dy) <= neighbourReach(population);
}
/** Upper bound of the distance from a town's centre to the land it can hold before it is generated (m):
 * the growth window of its footprint, plus the engine's search for a free centre when it has neighbours
 * (up to three site radii, 3 km at most: `urban/neighbours.rs`, `relocate`). */
export function landBound(seat: Pick<TownSeat, 'radius' | 'footprint'>, relocates: boolean): number {
  return (relocates ? Math.min(3000, Math.max(60, 3 * seat.radius)) : 0) + 2.65 * Math.max(seat.footprint, seat.radius) + 100;
}

/**
 * The towns to generate for `selected` and their dependencies. A town of the run waits for every earlier town whose
 * plan is still open (in the run, or never built) and whose land bound comes within its reach; a never-built town it
 * waits for joins the run. Every built town after a town of the run that may border it (directly or through a chain)
 * is regenerated in the same run (`cascaded`, canonical order, after the selection); a never-built town is never
 * added that way. A built town outside the run keeps its plan: its claim is read as it is.
 */
export function planTownRun(seats: readonly TownSeat[], selected: readonly string[]): TownRun {
  const ordered = [...seats].sort(compareTowns),
    keys = new Set(ordered.map(seat => seat.key));
  const needed = new Set(selected.filter(key => keys.has(key))),
    cascaded = new Set<string>();
  let waits = new Map<string, string[]>();
  // Opening a town (adding it to the run) widens the bounds after it: repeat until the run no longer grows.
  for (let size = -1; size !== needed.size;) {
    size = needed.size;
    const open = (seat: TownSeat): boolean => needed.has(seat.key) || !seat.built;
    const bound = new Map<string, number>();
    waits = new Map();
    for (const [i, seat] of ordered.entries()) {
      const reach = neighbourReach(seat.population),
        deps: string[] = [];
      let relocates = false;
      for (const other of ordered.slice(0, i)) {
        if (open(other)) {
          if (Math.hypot(other.center.x - seat.center.x, other.center.y - seat.center.y) <= bound.get(other.key)! + reach) {
            deps.push(other.key);
            relocates = true;
          }
        } else if (other.claim && claimReaches(other.claim, seat.center, seat.population)) relocates = true;
      }
      bound.set(seat.key, landBound(seat, relocates));
      waits.set(seat.key, deps);
    }
    // Never-built towns a selected town (or one of its dependencies) may border are built first.
    for (let i = ordered.length - 1; i >= 0; i--) {
      const key = ordered[i].key;
      if (needed.has(key) && !cascaded.has(key)) for (const dep of waits.get(key)!) needed.add(dep);
    }
    // Built towns that may border a town of the run follow it.
    for (const seat of ordered)
      if (seat.built && !needed.has(seat.key) && waits.get(seat.key)!.some(dep => needed.has(dep))) {
        needed.add(seat.key);
        cascaded.add(seat.key);
      }
  }
  const runWaits = (key: string): string[] => waits.get(key)!.filter(dep => needed.has(dep));
  const order: string[] = [],
    seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dep of runWaits(key)) visit(dep);
    order.push(key);
  };
  for (const key of selected) if (needed.has(key)) visit(key);
  for (const seat of ordered) if (cascaded.has(seat.key)) visit(seat.key);
  return { order, waits: new Map(order.map(key => [key, runWaits(key)])), cascaded };
}

/** A local population edit resizes the urban site while reusing its regional placement. */
export function townPopulationAndRadius(world: World, settings: V2Settings, place: Settlement): { population: number; radius: number } {
  const placedPopulation = Number(world.stats[`v2.population:${place.key}`] ?? place.population);
  const population = settings.local[place.key]?.population ?? placedPopulation;
  return { population, radius: population === placedPopulation ? place.radius : extentRadius(population) };
}

/** The seats of the V2 towns: effective population (local override first), site and footprint radii, current claim. */
export function townSeats(world: World, settings: V2Settings): TownSeat[] {
  const cities = world.debug?.v2RustCities as Record<string, RustTownSnapshot> | undefined;
  return (world.settlements ?? []).map(place => {
    const local = settings.local[place.key];
    const layout = { ...settings.urban?.layout, ...settings.urban?.local?.[place.key]?.layout };
    const scale = layout.radiusScale ?? Math.sqrt(local?.sprawl ?? settings.options.sprawl ?? 1);
    const claim = cities?.[place.key]?.layouts?.[0]?.claim;
    const { population, radius } = townPopulationAndRadius(world, settings, place);
    return { key: place.key, population, center: place.center, radius, footprint: layout.radius && layout.radius > 0 ? layout.radius : radius * scale, ...(claim ? { claim } : {}), built: !!(place.main ? (world.urban ?? place.urban) : place.urban) };
  });
}

/** Claims a town is generated against: the earlier towns (canonical order) whose land reaches it. `fresh` holds the
 * claims of towns generated in the current run and not yet applied to `world`. */
export function neighbourClaimsOf(world: World, settings: V2Settings, key: string, fresh?: ReadonlyMap<string, Claim>): Claim[] {
  const seats = townSeats(world, settings).sort(compareTowns),
    index = seats.findIndex(seat => seat.key === key);
  if (index < 0) return [];
  const seat = seats[index];
  const earlier = seats.slice(0, index).flatMap(other => {
    const claim = fresh?.get(other.key) ?? other.claim;
    return claim && claimReaches(claim, seat.center, seat.population) ? [claim] : [];
  });
  return [...earlier, ...reservedNeighbours(world, settings, seats, index)];
}
/** The places after a town (canonical order) within the land it can grow to: claims without land whose `reserve`
 * asks the engine to keep a core sized to their own population free (`urban/neighbours.rs`, `reserve_cores`). */
function reservedNeighbours(world: World, settings: V2Settings, seats: readonly TownSeat[], index: number): Claim[] {
  const seat = seats[index],
    bound = landBound(seat, false);
  return seats.slice(index + 1).flatMap(other => {
    if (Math.hypot(other.center.x - seat.center.x, other.center.y - seat.center.y) > bound + other.radius) return [];
    const place = world.settlements?.find(s => s.key === other.key);
    const culture = settings.local[other.key]?.culture ?? String(world.stats['v2.culture:' + other.key] ?? place?.culture ?? '');
    return [{ key: other.key, land: [], streets: [], reserve: { population: other.population, culture, center: other.center, radius: other.radius } }];
  });
}

const emptyTownWarning = 'Town empty — land claimed by ';
const neighbourWarning = /^(No wall — neighbour too close: |Town empty — land claimed by |Households \d+\/\d+ — land claimed by )(.+)$/u;

export function isNeighbourWarning(warning: string): boolean {
  return warning === 'No wall — neighbour too close' || neighbourWarning.test(warning);
}

export function emptyTownWarningKeys(warning: string): string[] | undefined {
  return warning.startsWith(emptyTownWarning) ? warning.slice(emptyTownWarning.length).split(', ') : undefined;
}

/** Replace site keys with the names shown on the map. */
export function nameNeighbourWarning(warning: string, nameOf: (key: string) => string | undefined): string {
  const match = neighbourWarning.exec(warning);
  return match
    ? match[1] +
        match[2]
          .split(', ')
          .map(key => nameOf(key) || key)
          .join(', ')
    : warning;
}

/** Stable short fingerprint of the claims a town is generated against; empty without neighbours. */
export function neighbourFingerprint(claims: readonly Claim[]): string {
  if (!claims.length) return '';
  const text = JSON.stringify(claims);
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return `${claims.map(claim => claim.key).join(',')}#${text.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}
