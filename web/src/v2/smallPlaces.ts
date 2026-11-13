import type { Settlement, World } from '../gen/types';

/**
 * Background build of the small places of a region (farmsteads, hamlets, villages under a population limit).
 *
 * Each place goes through the same engine request as "Build targeted cities" with that one place selected
 * (`generateTowns(world, settings, progress, [key])`), so a place built here is in the same state as one built
 * on demand. One place at a time, nearest to the view (or the main town) first; a place the user targets jumps
 * the queue. Any user run, recipe change, edit or project load cancels the pass; a late result is dropped when the
 * pass was cancelled or the map it was computed from is no longer the current one.
 *
 * Cost per place (native engine, release build, 6 km region, perf-2026-11-07 captures): urban request
 * ~0.2 s for a hamlet (45 inh.), 0.2–0.75 s for villages of 150–460 inh., extrapolated ~1.3 s at 1,000 inh.
 * (2,500 inh. = 2.6 s), plus the shared land-use and naming update (~1 s) and the redraw. WASM (web profile):
 * roughly 1.5–2x the urban part. Default limit 500: an ordinary region's 2–3 small places finish in a few seconds.
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
  skip: ReadonlySet<string> = new Set(), priority: readonly string[] = []): string | undefined {
  const candidates = smallPlaceCandidates(world, limit, backend).filter(place => !skip.has(place.key));
  for (const key of priority) if (candidates.some(place => place.key === key)) return key;
  const origin = focus ?? world.settlements?.find(place => place.main)?.center ?? { x: world.mapSize / 2, y: world.mapSize / 2 };
  const distance = (place: Settlement) => Math.hypot(place.center.x - origin.x, place.center.y - origin.y);
  return candidates.sort((a, b) => distance(a) - distance(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))[0]?.key;
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
  /** The current state to build from, or undefined when the pass must not run (nothing displayed, stale recipe, preview…). */
  base(): SmallPlaceBase | undefined;
  /** Where the user looks (world metres), if known. */
  focus(): { x: number; y: number } | undefined;
  /** One place through the targeted-build path; resolves with the whole new world. */
  build(world: World, key: string): Promise<World>;
  /** Shows the new world exactly as after a targeted build. */
  apply(result: World, key: string): Promise<void> | void;
  /** Resolves when the page is idle (no user run, no gesture in progress). */
  idle(): Promise<void>;
  onError?(key: string, error: unknown): void;
}

export class SmallPlaceQueue {
  private epoch = 0;
  private loopEpoch = -1;
  private inflight?: Promise<unknown>;
  private attempted = new Set<string>();
  private recipe?: string;
  private priority: string[] = [];
  constructor(private readonly host: SmallPlaceHost) {}

  /** Starts the pass on the host's current state (no-op while a pass of the same epoch runs). */
  start(): void {
    if (this.loopEpoch === this.epoch) return;
    const epoch = this.loopEpoch = this.epoch;
    const run: Promise<void> = this.loop(epoch).finally(() => {
      if (this.loopEpoch === epoch) this.loopEpoch = -1;
      if (this.running === run) this.running = undefined;
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
    this.cancel();
    while (this.inflight) await this.inflight.catch(() => undefined);
  }
  /** A place the user targets: built next if it is a candidate. */
  prioritize(key: string): void {
    this.priority = [key, ...this.priority.filter(item => item !== key)];
    this.start();
  }
  get busy(): boolean { return !!this.inflight; }

  private async loop(epoch: number): Promise<void> {
    for (;;) {
      await this.host.idle();
      if (epoch !== this.epoch) return;
      while (this.inflight) { await this.inflight.catch(() => undefined); if (epoch !== this.epoch) return; }
      const base = this.host.base();
      if (!base) return;
      if (base.recipe !== this.recipe) { this.recipe = base.recipe; this.attempted.clear(); }
      const key = nextSmallPlace(base.world, base.limit, base.backend, this.host.focus(), this.attempted, this.priority);
      if (!key) return;
      this.attempted.add(key);
      this.priority = this.priority.filter(item => item !== key);
      const job = this.host.build(base.world, key);
      this.inflight = job;
      let result: World;
      try { result = await job; }
      catch (error) {
        if (epoch !== this.epoch) { this.attempted.delete(key); return; }
        this.host.onError?.(key, error); continue;
      }
      finally { if (this.inflight === job) this.inflight = undefined; }
      await this.host.idle();
      // Dropped, not failed: the next pass tries this place again.
      if (epoch !== this.epoch) { this.attempted.delete(key); return; }
      // The map changed under the build (rename, edit…): try this place again on the new map.
      if (this.host.base()?.world !== base.world) { this.attempted.delete(key); continue; }
      await this.host.apply(result, key);
    }
  }
}
