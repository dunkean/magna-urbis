/** One current live view, filled cooperatively. Replacing/suspending it also discards unfinished work.
 * A yield marks whether a tile became drawable; intermediate stamp batches need no repaint. */
export class LiveTileFill {
  private static scope?: object;
  private static owners = new WeakMap<object, Set<LiveTileFill>>();
  private owner?: object;
  /** Includes every progressive layer started by a draw, including stamp fills. */
  static track<T>(owner: object, draw: () => T): T {
    const previous = this.scope; this.scope = owner;
    try { return draw(); } finally { this.scope = previous; }
  }
  static pending(owner: object): number { return this.owners.get(owner)?.size ?? 0; }
  private job?: { key: string; frame: number; work: Generator<boolean, void> };

  constructor(private now = (): number => performance.now()) {}

  start(key: string, work: () => Generator<boolean, void>, invalidate: () => void, failed: () => void): void {
    if (this.job?.key === key) return;
    this.suspend();
    this.owner = LiveTileFill.scope;
    if (this.owner) {
      let jobs = LiveTileFill.owners.get(this.owner);
      if (!jobs) LiveTileFill.owners.set(this.owner, jobs = new Set());
      jobs.add(this);
    }
    const job = this.job = { key, frame: 0, work: work() };
    const slice = (): void => {
      if (this.job !== job) return;
      const deadline = this.now() + 8;
      let changed = false, done = false;
      try {
        do {
          const step = job.work.next();
          done = !!step.done; changed ||= step.value === true;
        } while (!done && this.now() < deadline);
      } catch {
        this.suspend(); failed(); invalidate(); return;
      }
      if (done) { this.job = undefined; this.untrack(); }
      else job.frame = requestAnimationFrame(slice);
      if (changed || done) invalidate();
    };
    job.frame = requestAnimationFrame(slice);
  }

  suspend(): void {
    const job = this.job; this.job = undefined;
    this.untrack();
    if (job) { cancelAnimationFrame(job.frame); job.work.return(); }
  }
  private untrack(): void {
    if (this.owner) LiveTileFill.owners.get(this.owner)?.delete(this);
    this.owner = undefined;
  }
}
