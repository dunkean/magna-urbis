/**
 * One stepwise paint: a generator of work run in slices of at most 8 ms per animation frame, so an exact paint never
 * holds the main thread long. Each yield says whether something became drawable (the owner is asked for a repaint);
 * starting another job or suspending discards the unfinished one.
 * Users: the exact tiles of the cartography (cartography/exactTiles.ts), the illustrated ground's stamp tiles
 * (ui/fantasyRaster.ts). `track` and `pending` let a view count the stepwise paints its draw started.
 */
export class StepwisePaint {
  private static scope?: object;
  private static owners = new WeakMap<object, Set<StepwisePaint>>();
  private owner?: object;
  /** Every stepwise paint started inside `draw` (stamp fills included) counts for `owner`. */
  static track<T>(owner: object, draw: () => T): T {
    const previous = this.scope;
    this.scope = owner;
    try {
      return draw();
    } finally {
      this.scope = previous;
    }
  }
  static pending(owner: object): number {
    return this.owners.get(owner)?.size ?? 0;
  }
  private job?: { key: string; frame: number; work: Generator<boolean, void> };

  constructor(private now = (): number => performance.now()) {}

  start(key: string, work: () => Generator<boolean, void>, invalidate: () => void, failed: () => void): void {
    if (this.job?.key === key) return;
    this.suspend();
    this.owner = StepwisePaint.scope;
    if (this.owner) {
      let jobs = StepwisePaint.owners.get(this.owner);
      if (!jobs) StepwisePaint.owners.set(this.owner, (jobs = new Set()));
      jobs.add(this);
    }
    const job = (this.job = { key, frame: 0, work: work() });
    const slice = (): void => {
      if (this.job !== job) return;
      const deadline = this.now() + 8;
      let changed = false,
        done = false;
      try {
        do {
          const step = job.work.next();
          done = !!step.done;
          changed ||= step.value === true;
        } while (!done && this.now() < deadline);
      } catch {
        this.suspend();
        failed();
        invalidate();
        return;
      }
      if (done) {
        this.job = undefined;
        this.untrack();
      } else job.frame = requestAnimationFrame(slice);
      if (changed || done) invalidate();
    };
    job.frame = requestAnimationFrame(slice);
  }

  suspend(): void {
    const job = this.job;
    this.job = undefined;
    this.untrack();
    if (job) {
      cancelAnimationFrame(job.frame);
      job.work.return();
    }
  }
  private untrack(): void {
    if (this.owner) StepwisePaint.owners.get(this.owner)?.delete(this);
    this.owner = undefined;
  }
}
