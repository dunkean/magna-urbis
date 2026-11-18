import { describe, expect, it } from 'vitest';
import { createTownRunQueue } from '../../src/v2/townRunQueue';

describe('ready urban dependency queue', () => {
  it('starts independent towns while an earlier chain is blocked, without violating predecessor order', async () => {
    const work = createTownRunQueue([[], [0], [1], [], []]),
      started: number[] = [],
      finished: number[] = [];
    let release!: () => void;
    const first = new Promise<void>(resolve => {
      release = resolve;
    });
    const lane = async () => {
      for (;;) {
        const index = await work.next();
        if (index === undefined) return;
        started.push(index);
        if (index === 0) await first;
        finished.push(index);
        work.complete(index);
      }
    };
    const lanes = [lane(), lane()];
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toEqual([0, 3, 4]);
    expect(finished).toEqual([3, 4]);
    release();
    await Promise.all(lanes);
    expect(started).toEqual([0, 3, 4, 1, 2]);
    expect(finished).toEqual([3, 4, 0, 1, 2]);
  });
  it('wakes every waiting lane when a failed run stops', async () => {
    const work = createTownRunQueue([[], [0], [1]]);
    expect(await work.next()).toBe(0);
    const pending = [work.next(), work.next(), work.next()];
    work.stop();
    expect(await Promise.all(pending)).toEqual([undefined, undefined, undefined]);
    work.complete(0);
    expect(await work.next()).toBeUndefined();
  });
});
