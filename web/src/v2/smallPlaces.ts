import type { Settlement, World } from '../gen/types';
import type { V2Settings } from './contracts';
import { compareTowns, planTownRun, townSeats } from './townNeighbours';

export const SMALL_PLACE_BATCH_SIZE = 32;
export const SMALL_PLACE_BATCH_POPULATION = 8000;

/** Automatic work never expands into an unselected city or reopens a built neighbour.
 * The user can explicitly build such a dependency from Cities instead. */
export function boundedSmallPlaceRun(world: World, settings: V2Settings, keys: readonly string[], limit: number): boolean {
  if (!keys.length || keys.length > SMALL_PLACE_BATCH_SIZE) return false;
  const selected = new Set(keys), seats = townSeats(world, settings), chosen = seats.filter(seat => selected.has(seat.key));
  if (chosen.length !== selected.size || chosen.some(seat => seat.built || seat.population > limit)
    || chosen.reduce((sum, seat) => sum + seat.population, 0) > SMALL_PLACE_BATCH_POPULATION) return false;
  if ((settings.urban?.backend ?? settings.runtime?.backend) === 'typescript') return true;
  const run = planTownRun(seats, keys);
  return !run.cascaded.size && run.order.length === selected.size && run.order.every(key => selected.has(key));
}

/**
 * Background build of the small places of a region (farmsteads, hamlets, villages under a population limit).
 *
 * Each bounded batch goes through "Build targeted cities" (`generateTowns`): four engine lanes,
 * one world clone, one regional land-use/naming update and one redraw for up to 32 selected places / 8,000 inhabitants.
 * Automatic batches defer places whose bordering-town dependencies would exceed those bounds.
 * The four engine sessions keep their terrain across batches and are released when the pass ends.
 * The studio chooses larger potential neighbours before their smaller dependants; other hosts can prefer
 * distance to the view. A place the user targets jumps the queue. Any user run, recipe change, edit or project load
 * cancels the pass; a late result is dropped when the
 * pass was cancelled or the map it was computed from is no longer the current one.
 *
 * Cost per place (native engine, release build, 6 km region, perf-2026-11-07 captures): urban request
 * ~0.2 s for a hamlet (45 inh.), 0.2–0.75 s for villages of 150–460 inh., extrapolated ~1.3 s at 1,000 inh.
 * (2,500 inh. = 2.6 s), plus the shared land-use and naming update (~1 s) and the redraw per batch.
 */

/** A secondary place the background pass may build: not built yet and at most `limit` inhabitants. */
export function smallPlaceCandidates(world: World, limit: number, backend: string): Settlement[] {
  if (!(limit > 0)) return [];
  return (world.settlements ?? []).filter(place => !place.main && !place.urban && place.population <= limit
    // The classic TypeScript backend draws farmsteads with the land use (generateTowns skips them too).
    && (place.detail === 'lazy' || place.detail === 'farmstead' && backend !== 'typescript'));
}

/** Next place to build: a targeted candidate first, then the nearest to `focus` (the view, else the main town). */
export function nextSmallPlace(world: World, limit: number, backend: string, focus: { x: number; y: number } | undefined,
  skip: ReadonlySet<string> = new Set(), priority: readonly string[] = [], canonical = false): string | undefined {
  const candidates = smallPlaceCandidates(world, limit, backend).filter(place => !skip.has(place.key));
  for (const key of priority) if (candidates.some(place => place.key === key)) return key;
  const origin = focus ?? world.settlements?.find(place => place.main)?.center ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
  const distance = (place: Settlement) => Math.hypot(place.center.x - origin.x, place.center.y - origin.y);
  return candidates.sort(canonical ? compareTowns : (a, b) => distance(a) - distance(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0]?.key;
}

export interface SmallPlaceBase {
  /** The world a background build starts from; a result is applied only while it is still the current one. */
  world: World;
  limit: number;
  backend: string;
  /** Generation recipe key: places attempted under another recipe are tried again. */
  recipe: string;
}

export interface SmallPlaceHost {
  /** Bounded work between cancellation/priority checks; defaults to 32 places. */
  batchSize?: number;
  /** Bound heavier villages independently of the number of tiny farms (default 8,000 inhabitants). */
  batchPopulation?: number;
  /** Build potential larger neighbours before their smaller dependants. Explicit priority still wins. */
  canonicalOrder?: boolean;
  /** Reject/defer a batch that would implicitly expand beyond its selected places and work budget. */
  canBuild?(world: World, keys: readonly string[]): boolean;
  /** The current state to build from, or undefined when the pass must not run (nothing displayed, stale recipe, preview…). */
  base(): SmallPlaceBase | undefined;
  /** Where the user looks (world metres), if known. */
  focus(): { x: number; y: number } | undefined;
  /** A batch through the targeted-build path; resolves with the whole new world. */
  build(world: World, keys: readonly string[]): Promise<World>;
  /** Shows the new world exactly as after a targeted build. */
  apply(result: World, keys: readonly string[]): Promise<void> | void;
  /** Releases this pass's bounded engine sessions after finish, cancellation, failure or a world replacement. */
  release?(): Promise<void> | void;
  /** Resolves when the page is idle (no user run, no gesture in progress). */
  idle(): Promise<void>;
  onError?(keys: readonly string[], error: unknown): void;
}

export class SmallPlaceQueue {
  private epoch = 0;
  private loopEpoch = -1;
  private inflight?: Promise<unknown>;
  private attempted = new Set<string>();
  private retrySingles = new Set<string>();
  private deferred = new Set<string>();
  private recipe?: string;
  private priority: string[] = [];
  private releaseEpoch?: number;
  constructor(private readonly host: SmallPlaceHost) {}

  /** Starts the pass on the host's current state (no-op while a pass of the same epoch runs). */
  start(): void {
    if (this.loopEpoch === this.epoch) return;
    // A manual build can resolve a dependency without changing the recipe. Recheck deferred
    // places on a new pass, while keeping them skipped within an unchanged blocked pass.
    this.deferred.clear();
    const epoch = this.loopEpoch = this.epoch;
    const run: Promise<void> = this.loop(epoch).finally(async () => {
      try { await this.release(epoch); }
      finally {
        if (this.loopEpoch === epoch) this.loopEpoch = -1;
        if (this.running === run) this.running = undefined;
      }
    });
    this.running = run;
  }
  private running?: Promise<void>;
  /** Resolves once the pass has nothing left to build (or was cancelled) and the engine is free. */
  async settled(): Promise<void> {
    for (;;) {
      const pending = this.running ?? this.inflight;
      if (!pending) return;
      await pending.catch(() => undefined);
    }
  }
  /** Drops the pass: no new place starts and a result still on its way is discarded. */
  cancel(): void { this.epoch++; }
  /** Cancels, then waits until the engine is free (the place being computed, if any, completes and is dropped). */
  async stop(): Promise<void> {
    const epoch = this.epoch;
    this.cancel();
    while (this.inflight) await this.inflight.catch(() => undefined);
    await this.release(epoch);
  }
  /** A place the user targets: built next if it is a candidate. */
  prioritize(key: string): void {
    this.priority = [key, ...this.priority.filter(item => item !== key)];
    this.start();
  }
  get busy(): boolean { return !!this.inflight; }

  private async release(epoch: number): Promise<void> {
    if (this.releaseEpoch !== epoch) return;
    this.releaseEpoch = undefined;
    await this.host.release?.();
  }

  private async loop(epoch: number): Promise<void> {
    for (;;) {
      await this.host.idle();
      if (epoch !== this.epoch) return;
      while (this.inflight) { await this.inflight.catch(() => undefined); if (epoch !== this.epoch) return; }
      const base = this.host.base();
      if (!base) return;
      if (base.recipe !== this.recipe) { await this.release(epoch); this.recipe = base.recipe; this.attempted.clear(); this.retrySingles.clear(); this.deferred.clear(); }
      const keys: string[] = [];
      const batchSize = Math.max(1, Math.min(SMALL_PLACE_BATCH_SIZE, Math.floor(this.host.batchSize ?? SMALL_PLACE_BATCH_SIZE)));
      const populationLimit = Math.max(1, this.host.batchPopulation ?? SMALL_PLACE_BATCH_POPULATION);
      let population = 0;
      const focus = this.host.focus();
      while (keys.length < batchSize) {
        const skip = new Set([...this.attempted, ...this.deferred]);
        const key = nextSmallPlace(base.world, base.limit, base.backend, focus, skip, this.priority, this.host.canonicalOrder);
        if (!key) break;
        if (this.retrySingles.has(key) && keys.length) break;
        const residents = base.world.settlements!.find(place => place.key === key)!.population;
        if (keys.length && population + residents > populationLimit) break;
        if (this.host.canBuild && !this.host.canBuild(base.world, [...keys, key])) { this.deferred.add(key); continue; }
        population += residents;
        keys.push(key); this.attempted.add(key);
        if (this.retrySingles.delete(key)) break;
      }
      if (!keys.length) return;
      this.priority = this.priority.filter(item => !keys.includes(item));
      this.releaseEpoch = epoch;
      const job = this.host.build(base.world, keys);
      this.inflight = job;
      let result: World;
      try { result = await job; }
      catch (error) {
        await this.release(epoch);
        if (epoch !== this.epoch) { keys.forEach(key => this.attempted.delete(key)); return; }
        // An atomic batch failed: isolate its bad place without losing the other results forever.
        if (keys.length > 1) for (const key of keys) { this.attempted.delete(key); this.retrySingles.add(key); }
        this.host.onError?.(keys, error); continue;
      }
      finally { if (this.inflight === job) this.inflight = undefined; }
      await this.host.idle();
      // Dropped, not failed: the next pass tries this place again.
      if (epoch !== this.epoch) { keys.forEach(key => this.attempted.delete(key)); return; }
      // The map changed under the build (rename, edit…): try this place again on the new map.
      if (this.host.base()?.world !== base.world) { await this.release(epoch); this.deferred.clear(); keys.forEach(key => this.attempted.delete(key)); continue; }
      await this.host.apply(result, keys);
      this.deferred.clear();
    }
  }
}
