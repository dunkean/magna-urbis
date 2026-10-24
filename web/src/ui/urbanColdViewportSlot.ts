/** One actual UI viewport owner. Pending opens have their own AbortController;
 * completed/reused views are disposed only on replacement, never by that abort. */
export function createColdViewportSlot<S, V extends { dispose(): void }>(keyOf: (state: S) => string,
  open: (state: S, signal: AbortSignal) => Promise<V>) {
  let epoch = 0, active: { key: string; view: V } | undefined;
  let barrier: Promise<unknown> = Promise.resolve();
  let pending: { key: string; epoch: number; abort: AbortController; work: Promise<V> } | undefined;
  const stale = () => new DOMException('Ouverture froide remplacée', 'AbortError');
  function cancelOpen() { epoch++; pending?.abort.abort(stale()); pending = undefined; }
  return {
    ensure(state: S): Promise<V> {
      const key = keyOf(state);
      if (active?.key === key) { if (pending && pending.key !== key) cancelOpen(); return Promise.resolve(active.view); }
      if (pending?.key === key) return pending.work;
      cancelOpen(); const token = epoch, abort = new AbortController();
      const work = barrier.then(() => { abort.signal.throwIfAborted(); return open(state, abort.signal); }).then(view => {
        if (token !== epoch || abort.signal.aborted) { view.dispose(); throw stale(); }
        active?.view.dispose(); active = { key, view }; return view;
      }).finally(() => { if (pending?.epoch === token) pending = undefined; });
      // A physical metadata read may not support cancellation. Drain it before
      // opening the next source; superseded queued opens only observe abort.
      barrier = work.then(() => undefined, () => undefined);
      pending = { key, epoch: token, abort, work }; return work;
    },
    clear() { cancelOpen(); active?.view.dispose(); active = undefined; },
    get current() { return active?.view; },
    get opening() { return !!pending; },
  };
}
