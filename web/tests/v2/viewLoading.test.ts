import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewLoadingTracker } from '../../src/v2/viewLoading';

function tracker(timeoutMs = 60_000) {
  const changes: boolean[] = [],
    warnings: string[] = [];
  const t = new ViewLoadingTracker({ onChange: busy => changes.push(busy), warn: message => warnings.push(message), timeoutMs });
  return { t, changes, warnings };
}

describe('view loading tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays busy until every nested job ends, and end() is idempotent', () => {
    const { t, changes } = tracker();
    const outer = t.begin('appearance'),
      inner = t.begin();
    expect(t.pending).toBe(2);
    inner.end();
    inner.end();
    expect(t.busy).toBe(true);
    outer.end();
    expect(t.busy).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('ends a job on an error path through finally', async () => {
    const { t } = tracker();
    const failing = async () => {
      const job = t.begin('appearance');
      try {
        throw new Error('shader compile');
      } finally {
        job.end();
      }
    };
    await expect(failing()).rejects.toThrow('shader compile');
    expect(t.busy).toBe(false);
  });

  it('a keyed job supersedes the previous one; the stale end() does not hide the newer job', () => {
    const { t } = tracker();
    const stale = t.begin('appearance'),
      fresh = t.begin('appearance');
    expect(stale.active).toBe(false);
    expect(t.pending).toBe(1);
    stale.end();
    expect(t.busy).toBe(true);
    fresh.end();
    expect(t.busy).toBe(false);
  });

  it('ends a keyed job by key (cancelled 3D opening)', () => {
    const { t } = tracker();
    const job = t.begin('3d-open');
    t.end('3d-open');
    expect(job.active).toBe(false);
    expect(t.busy).toBe(false);
  });

  it('hides and warns when nothing completes within the timeout; a completion restarts it', () => {
    const { t, changes, warnings } = tracker(60_000);
    const a = t.begin('tiles');
    t.begin('appearance');
    vi.advanceTimersByTime(50_000);
    a.end(); // progress: the timeout restarts
    vi.advanceTimersByTime(50_000);
    expect(t.busy).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(t.busy).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('appearance');
    const next = t.begin('appearance');
    expect(t.busy).toBe(true);
    next.end();
    expect(t.busy).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(warnings).toHaveLength(1);
  });
});
