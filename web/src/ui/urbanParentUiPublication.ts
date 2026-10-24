/** One pending visual update per run, independent of durable/native ACK.
 * Hidden tabs may drop intermediate PREVIEWS, never source/index batches. */
export interface ParentUiPublicationOptions<T> {
  current(): boolean;
  publish(value: T): void | Promise<void>;
  error?(error: unknown): void;
  /** Return cancellation of this single frame (injectable in protocol tests). */
  requestFrame?(callback: () => void): () => void;
}
function frame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(callback); return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16); return () => clearTimeout(id);
}
export function createParentUiPublication<T>(options: ParentUiPublicationOptions<T>) {
  let pending: { value: T } | undefined, cancelFrame: (() => void) | undefined, busy = false, closed = false;
  const current = () => !closed && options.current();
  function schedule(): void {
    if (cancelFrame || busy || !pending || !current()) return;
    cancelFrame = (options.requestFrame ?? frame)(() => {
      cancelFrame = undefined;
      const next = pending; pending = undefined;
      if (!next || !current()) return;
      busy = true;
      const settled = () => { busy = false; if (!current()) pending = undefined; else schedule(); };
      try {
        const result = options.publish(next.value);
        void Promise.resolve(result).then(settled, error => { if (current()) options.error?.(error); settled(); });
      } catch (error) { if (current()) options.error?.(error); settled(); }
    });
  }
  return {
    offer(value: T): void { if (!current()) return; pending = { value }; schedule(); },
    /** No final flush: commit owns final publication, not an old queued frame. */
    cancel(): void { closed = true; pending = undefined; cancelFrame?.(); cancelFrame = undefined; },
    get pending() { return pending ? 1 : 0; },
    get publishing() { return busy ? 1 : 0; },
  };
}
