import { expect, it, vi } from 'vitest';
import { createParentUiPublication } from '../src/ui/urbanParentUiPublication';
import { publishParentUiTask } from '../src/ui/urbanParentUiTasks';
import { currentParentDetailEvidence } from '../src/ui/urbanParentDrawEvidence';
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
// This is the production guarded publication called by terrainUrban read/pick/
// open tasks. Native IO and DOM painting are deliberately not exercised here.
it.each(['source', 'view', 'cursor'] as const)('a rejected old selection cannot overwrite a newer inspector after %s changes', async changed => {
  const oldView = {}, oldSource = {}, point = { x: 150, y: 150 };
  let view = oldView, source = oldSource, cursor = { ...point }, inspector = 'old inspector';
  const task = deferred<string>();
  const work = publishParentUiTask(task.promise, () => view === oldView && source === oldSource && cursor.x === point.x && cursor.y === point.y,
    value => { inspector = value; }, error => { inspector = String(error); });
  if (changed === 'source') source = {}; else if (changed === 'view') view = {}; else cursor = { x: 160, y: 150 };
  inspector = 'new inspector'; task.reject(new Error('old read/pick rejected')); await work;
  expect(inspector).toBe('new inspector');
});
it('a rejected old source opener preserves new counts and diagnostic; current failures still publish', async () => {
  const oldSource = {}; let source = oldSource, counts = 'old counts', diagnostic = 'old diagnostic';
  const old = deferred<void>(), work = publishParentUiTask(old.promise, () => source === oldSource,
    () => { counts = 'old opened'; }, error => { diagnostic = counts = String(error); });
  source = {}; counts = 'new committed counts'; diagnostic = 'new diagnostic'; old.reject(new Error('old open failed')); await work;
  expect(counts).toBe('new committed counts'); expect(diagnostic).toBe('new diagnostic');
  const current = deferred<void>(), expected = source, next = publishParentUiTask(current.promise, () => source === expected,
    () => { counts = 'current opened'; }, error => { diagnostic = String(error); });
  current.reject(new Error('current open failed')); await next; expect(diagnostic).toContain('current open failed');
});
it('a successful stale task also leaves the newer inspector untouched', async () => {
  let current = true, inspector = 'old'; const task = deferred<string>(), work = publishParentUiTask(task.promise, () => current,
    value => { inspector = value; }, error => { inspector = String(error); });
  current = false; inspector = 'new'; task.resolve('old success'); await work; expect(inspector).toBe('new');
});
it('current-view detail counts do not borrow cached parents outside the scheduler set', () => {
  const statuses: Record<string, string> = { drawn: 'ready', queued: 'pending', failed: 'Native failure', idle: 'idle', offscreen: 'ready' };
  const evidence = currentParentDetailEvidence({ enabled: true, eligibleIds: ['drawn', 'queued', 'failed', 'idle'], visibleIds: new Set(['drawn', 'queued', 'failed']),
    status: id => statuses[id], sourceFingerprint: 'source', manifestFingerprint: 'manifest', viewport: [120, 120, 180, 180], coverage: 'exact' });
  expect(evidence).toMatchObject({ scope: 'current-draw', enabled: true, eligible: 4, visibleEligible: 3, ready: 1, pending: 1, failed: 1, idle: 1 });
  expect(evidence.viewport).toEqual([120, 120, 180, 180]);
});

function frames() {
  let serial = 0; const jobs = new Map<number, () => void>();
  return { jobs, request(callback: () => void) { const id = ++serial; jobs.set(id, callback); return () => { jobs.delete(id); }; },
    flush() { const next = [...jobs.values()]; jobs.clear(); for (const job of next) job(); } };
}
it('visual queue retains only latest preview while frames are paused, then publishes once', async () => {
  const raf = frames(), publish = vi.fn();
  const ui = createParentUiPublication({ current: () => true, publish, requestFrame: raf.request });
  for (let i = 0; i < 1000; i++) ui.offer({ source: 'same', revision: 'r1', epoch: 1, completed: i });
  expect(ui.pending).toBe(1); expect(ui.publishing).toBe(0); expect(raf.jobs.size).toBe(1); expect(publish).not.toHaveBeenCalled();
  raf.flush(); await Promise.resolve(); expect(publish).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledWith({ source: 'same', revision: 'r1', epoch: 1, completed: 999 });
  expect(ui.pending).toBe(0); expect(ui.publishing).toBe(0); ui.cancel();
});
it.each(['source', 'revision', 'epoch', 'cancelled'] as const)('a scheduled old visual update does not publish after %s changes', async field => {
  const raf = frames(), publish = vi.fn(), current = { source: 's1', revision: 'r1', epoch: 1, cancelled: false }, original = { ...current };
  const ui = createParentUiPublication({ current: () => JSON.stringify(current) === JSON.stringify(original), publish, requestFrame: raf.request });
  ui.offer('old durable preview');
  if (field === 'source') current.source = 's2'; else if (field === 'revision') current.revision = 'r2'; else if (field === 'epoch') current.epoch++; else current.cancelled = true;
  raf.flush(); await Promise.resolve(); expect(publish).not.toHaveBeenCalled(); expect(ui.pending).toBe(0); ui.cancel();
});
it('at most one async publication and one pending preview survive slow render; newest frame resumes once', async () => {
  const raf = frames(), gate = deferred<void>(), published: number[] = [];
  const ui = createParentUiPublication({ current: () => true, requestFrame: raf.request,
    publish(value: number) { published.push(value); return value === 1 ? gate.promise : undefined; } });
  ui.offer(1); raf.flush(); expect(ui.publishing).toBe(1);
  for (let i = 2; i <= 100; i++) ui.offer(i);
  expect(ui.pending).toBe(1); expect(raf.jobs.size).toBe(0); expect(published).toEqual([1]);
  gate.resolve(); await Promise.resolve(); expect(raf.jobs.size).toBe(1); raf.flush(); await Promise.resolve();
  expect(published).toEqual([1, 100]); expect(ui.pending).toBe(0); expect(ui.publishing).toBe(0); ui.cancel();
});
it('completion/cancel discards pending frame and in-flight late errors cannot overwrite new UI', async () => {
  const raf = frames(), gate = deferred<void>(), error = vi.fn(), publish = vi.fn(() => gate.promise);
  const ui = createParentUiPublication({ current: () => true, requestFrame: raf.request, publish, error });
  ui.offer('old'); raf.flush(); ui.offer('pending'); ui.cancel();
  expect(ui.pending).toBe(0); expect(raf.jobs.size).toBe(0); gate.reject(new Error('late renderer rejection')); await Promise.resolve();
  expect(error).not.toHaveBeenCalled(); ui.offer('after complete'); raf.flush(); expect(publish).toHaveBeenCalledOnce();
});
