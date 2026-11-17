/**
 * Counter of the view jobs still owed to the displayed map (appearance refresh, shader compile, texture and tile
 * loading, 3D opening). The view spinner is shown while it is non-zero.
 *
 * It can never stay stuck: every job ends once (end() is idempotent), a keyed job is superseded by the next job of
 * the same key, and a safety timeout clears everything when nothing completes for `timeoutMs`.
 */
export interface ViewJob {
  /** Ends the job; later calls, and calls after a supersede or a timeout, do nothing. */
  end(): void;
  /** False once ended, superseded or cleared by the timeout. */
  readonly active: boolean;
}

export interface ViewLoadingOptions {
  /** Called when the view switches between loading and complete. */
  onChange(busy: boolean): void;
  /** Without any job completing for this long, every job is dropped and a warning is logged. */
  timeoutMs?: number;
  warn?(message: string): void;
}

export const VIEW_LOADING_TIMEOUT_MS = 60_000;

interface JobRecord { key?: string; label: string; active: boolean }

export class ViewLoadingTracker {
  private readonly jobs = new Set<JobRecord>();
  private readonly keyed = new Map<string, JobRecord>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busyState = false;
  private readonly timeoutMs: number;

  constructor(private readonly options: ViewLoadingOptions) {
    this.timeoutMs = options.timeoutMs ?? VIEW_LOADING_TIMEOUT_MS;
  }

  /** Number of jobs in flight. */
  get pending(): number { return this.jobs.size; }
  get busy(): boolean { return this.busyState; }

  /** Starts a job. A key supersedes (ends) the previous job of that key, so a stale request cannot keep the spinner. */
  begin(key?: string): ViewJob {
    if (key !== undefined) this.finish(this.keyed.get(key));
    const record: JobRecord = { key, label: key ?? 'view job', active: true };
    this.jobs.add(record);
    if (key !== undefined) this.keyed.set(key, record);
    this.arm();
    this.update();
    return { end: () => this.complete(record), get active() { return record.active; } };
  }

  /** Ends the current job of `key`, if any (a cancelled 3D opening, for example). */
  end(key: string): void { this.complete(this.keyed.get(key)); }

  /** Drops every job (the view is shown complete). */
  clear(): void {
    for (const record of this.jobs) record.active = false;
    this.jobs.clear(); this.keyed.clear();
    this.disarm(); this.update();
  }

  dispose(): void { this.disarm(); for (const record of this.jobs) record.active = false; this.jobs.clear(); this.keyed.clear(); }

  private complete(record: JobRecord | undefined): void {
    if (!this.finish(record)) return;
    // A completion is progress: the safety timeout restarts while other jobs remain.
    if (this.jobs.size) this.arm(); else this.disarm();
    this.update();
  }

  private finish(record: JobRecord | undefined): boolean {
    if (!record?.active) return false;
    record.active = false;
    this.jobs.delete(record);
    if (record.key !== undefined && this.keyed.get(record.key) === record) this.keyed.delete(record.key);
    return true;
  }

  private arm(): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.jobs.size) return;
      const labels = [...this.jobs].map(job => job.label).join(', ');
      (this.options.warn ?? console.warn)(`View loading indicator: no view job completed within ${Math.round(this.timeoutMs / 1000)} s; hiding it (pending: ${labels}).`);
      this.clear();
    }, this.timeoutMs);
  }

  private disarm(): void { if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; } }

  private update(): void {
    const busy = this.jobs.size > 0;
    if (busy === this.busyState) return;
    this.busyState = busy;
    this.options.onChange(busy);
  }
}
