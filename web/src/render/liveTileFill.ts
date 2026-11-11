/** One current live view, filled cooperatively. Replacing/suspending it also discards unfinished work.
 * A yield marks whether a tile became drawable; intermediate stamp batches need no repaint. */
export class LiveTileFill {
  private job?: { key: string; frame: number; work: Generator<boolean, void> };

  constructor(private now = (): number => performance.now()) {}

  start(key: string, work: () => Generator<boolean, void>, invalidate: () => void, failed: () => void): void {
    if (this.job?.key === key) return;
    this.suspend();
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
      if (done) this.job = undefined;
      else job.frame = requestAnimationFrame(slice);
      if (changed) invalidate();
    };
    job.frame = requestAnimationFrame(slice);
  }

  suspend(): void {
    const job = this.job; this.job = undefined;
    if (job) { cancelAnimationFrame(job.frame); job.work.return(); }
  }
}
