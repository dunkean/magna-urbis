/** Detail is optional work. Leave a message round trip after occupation for its dependent merge. */
export class OccupationQueue {
  private urgent: (() => Promise<void>)[] = [];
  private detail: (() => Promise<void>)[] = [];
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  enqueue(kind: string, run: () => Promise<void>): void {
    (kind === 'detail' || kind === 'release' ? this.detail : this.urgent).push(run);
    if (!this.active) {
      if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
      this.pump();
    }
  }
  private start(run: () => Promise<void>): void {
    this.active = true;
    void Promise.resolve().then(run).finally(() => { this.active = false; this.pump(); });
  }
  private pump(): void {
    const urgent = this.urgent.shift();
    if (urgent) { this.start(urgent); return; }
    if (this.detail.length) this.timer = setTimeout(() => {
      this.timer = undefined;
      const next = this.urgent.shift() ?? this.detail.shift();
      if (next) this.start(next);
    }, 16);
  }
}
