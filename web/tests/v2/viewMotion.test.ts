import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS, ViewMotion, sameFrame } from '../../src/v2/display/viewMotion';

const view = (cx: number, scale = 1) => ({ cx, cy: 0, scale });

describe('view motion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts a view as moving for the settle delay after its last change, a resize included', () => {
    const motion = new ViewMotion();
    expect(motion.note(view(0), 800, 600, 1, 0)).toBe(false);
    expect(motion.phase(0)).toBe('resting');
    expect(motion.note(view(10), 800, 600, 1, 100)).toBe(true);
    expect(motion.phase(100 + SETTLE_MS - 1)).toBe('moving');
    expect(motion.phase(100 + SETTLE_MS)).toBe('resting');
    // The same view again (a tile arrived) is not a move and does not extend the gesture.
    expect(motion.note(view(10), 800, 600, 1, 150)).toBe(false);
    expect(motion.phase(100 + SETTLE_MS)).toBe('resting');
    expect(motion.note(view(10), 900, 600, 1, 400)).toBe(true);
    expect(motion.phase(401)).toBe('moving');
    expect(sameFrame(motion.frame, view(10), 900, 600, 1)).toBe(true);
  });

  it('owes the picture at rest from the first moving frame until the view says it is made', () => {
    const motion = new ViewMotion(),
      rest = vi.fn();
    motion.note(view(0), 800, 600, 1, 0);
    motion.note(view(10), 800, 600, 1, 0);
    motion.awaitRest(0, true, rest);
    expect(motion.restOwed).toBe(true);
    // A frame of the gesture that did not move the view leaves the armed callback alone.
    vi.advanceTimersByTime(100);
    motion.awaitRest(100, false, rest);
    vi.advanceTimersByTime(SETTLE_MS - 100 + 1);
    expect(rest).toHaveBeenCalledOnce();
    // The callback only asks for the frame: the picture stays owed until that frame has made it.
    expect(motion.restOwed).toBe(true);
    motion.restDone();
    expect(motion.restOwed).toBe(false);
  });

  it('arms the rest again when the view moves again, and never fires once the rest is done', () => {
    const motion = new ViewMotion(),
      rest = vi.fn();
    motion.note(view(0), 800, 600, 1, 0);
    motion.note(view(10), 800, 600, 1, 0);
    motion.awaitRest(0, true, rest);
    vi.advanceTimersByTime(100);
    motion.note(view(20), 800, 600, 1, 100);
    motion.awaitRest(100, true, rest);
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(rest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3);
    expect(rest).toHaveBeenCalledOnce();
    motion.note(view(30), 800, 600, 1, 500);
    motion.awaitRest(500, true, rest);
    motion.restDone();
    vi.advanceTimersByTime(1000);
    expect(rest).toHaveBeenCalledOnce();
  });
});
