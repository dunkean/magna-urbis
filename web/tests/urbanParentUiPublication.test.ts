import { expect, it } from 'vitest';
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
