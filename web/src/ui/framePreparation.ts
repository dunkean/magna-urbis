// A backend warming behind the displayed view shares its preparation budget.
let frameStamp = -1, frameSpent = 0;
/** Per-frame CPU budget: small while the user navigates, larger once input has rested (the view is loading, nobody drags). */
export const PREPARATION_BUDGET_MS = { active: 8, idle: 24 } as const;
const INPUT_REST_MS = 400;
let lastInput = -Infinity;
if (typeof addEventListener === 'function') {
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(type, () => { lastInput = performance.now(); }, { passive: true, capture: true });
}
const frameBudget = (now: number): number => now - lastInput > INPUT_REST_MS ? PREPARATION_BUDGET_MS.idle : PREPARATION_BUDGET_MS.active;
type Priority = number | (() => number);
const rank = (priority: Priority): number => typeof priority === 'number' ? priority : priority();

/** Cooperative tile CPU queue. Generators yield after a row/block, including surface sampling. */
export class FramePreparation {
  private frame = 0;
  private tasks: { step(): boolean; cancel(): void; priority: Priority }[] = [];
  get pending(): number { return this.tasks.length; }

  run<T>(work: Generator<void, T>, valid: () => boolean, priority: Priority = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = (): void => { work.return(undefined as T); reject(new DOMException('Tile preparation cancelled', 'AbortError')); };
      this.tasks.push({ priority, cancel, step: () => {
        if (!valid()) { cancel(); return true; }
        try {
          const result = work.next();
          if (result.done) { resolve(result.value); return true; }
        } catch (error) { reject(error); return true; }
        return false;
      } });
      this.request();
    });
  }

  private request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(stamp => {
      this.frame = 0;
      if (stamp !== frameStamp) { frameStamp = stamp; frameSpent = 0; }
      const began = performance.now(), deadline = began + Math.max(0, frameBudget(began) - frameSpent);
      this.tasks.sort((a, b) => rank(a.priority) - rank(b.priority));
      while (this.tasks.length && performance.now() < deadline) {
        if (this.tasks[0].step()) this.tasks.shift();
      }
      frameSpent += performance.now() - began;
      if (this.tasks.length) this.request();
    });
  }

  clear(): void {
    cancelAnimationFrame(this.frame); this.frame = 0;
    for (const task of this.tasks) task.cancel();
    this.tasks = [];
  }
}
