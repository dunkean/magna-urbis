import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetainedBudget } from '../src/render/retainedBudget';
import { LiveTileFill } from '../src/render/liveTileFill';
import { RenderReadiness } from '../src/render/renderReadiness';
import { projectedTexturePixels } from '../src/ui/terrain3dTextureSize';

afterEach(() => { vi.unstubAllGlobals(); performance.clearMarks(); performance.clearMeasures(); });

describe('retained display ownership', () => {
  it('evicts across styles and frames with a separate 32 MiB frame ceiling', () => {
    const releaseA = vi.fn(), releaseB = vi.fn(), releaseFrame = vi.fn();
    const cache = new RetainedBudget(100, 32);
    cache.put('parchment', 'a', 50, releaseA);
    cache.put('atlas', 'b', 30, releaseB);
    expect(cache.get('parchment')).toBe('a');
    cache.put('frame', 'f', 24, releaseFrame, true);
    expect(releaseB).toHaveBeenCalledOnce();
    expect(cache.bytes).toBe(74); expect(cache.frameBytes).toBe(24);
    cache.put('frame2', 'g', 24, vi.fn(), true);
    expect(releaseFrame).toHaveBeenCalledOnce(); expect(cache.frameBytes).toBe(24);
    expect(cache.take('parchment')).toBe('a'); expect(releaseA).not.toHaveBeenCalled();
    cache.clear(); expect(cache.bytes).toBe(0); expect(cache.frameBytes).toBe(0);
  });
  it('releases oversized entries and replacements exactly once', () => {
    const release = vi.fn(), tooLarge = vi.fn(), last = vi.fn();
    const cache = new RetainedBudget(100, 32);
    cache.put('f', {}, 20, release, true); cache.put('f', {}, 16, last, true);
    cache.put('oversized', {}, 33, tooLarge, true);
    expect(release).toHaveBeenCalledOnce(); expect(tooLarge).toHaveBeenCalledOnce();
    expect(cache.frameBytes).toBe(16); cache.clear(); expect(last).toHaveBeenCalledOnce();
  });
});

describe('progressive completion', () => {
  it('tracks nested layers by the drawing owner, including a final no-change slice', () => {
    const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { frames.set(++serial, run); return serial; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    let now = 0;
    const owner = {}, other = {}, fill = new LiveTileFill(() => now += 10), stamp = new LiveTileFill(() => now += 10), changed = vi.fn();
    const tick = () => { const jobs = [...frames]; frames.clear(); for (const [, run] of jobs) run(now); };
    LiveTileFill.track(owner, () => {
      fill.start('tile', function* () { yield false; }, changed, vi.fn());
      LiveTileFill.track(other, () => stamp.start('stamp', function* () { yield false; }, changed, vi.fn()));
    });
    expect(LiveTileFill.pending(owner)).toBe(1); expect(LiveTileFill.pending(other)).toBe(1);
    tick(); expect(LiveTileFill.pending(owner)).toBe(1);
    tick(); expect(LiveTileFill.pending(owner)).toBe(0); expect(changed).toHaveBeenCalledTimes(2);
    LiveTileFill.track(owner, () => fill.start('new', function* () { yield false; }, changed, vi.fn()));
    fill.suspend(); expect(LiveTileFill.pending(owner)).toBe(0); expect(frames.size).toBe(0);
  });
  it('keeps first useful, programs, visible completion and capture separate and request-scoped', () => {
    const preview = new RenderReadiness('2d'), capture = new RenderReadiness('capture');
    preview.mark('first-useful-frame'); preview.mark('first-useful-frame');
    expect(preview.has('visible-complete')).toBe(false);
    preview.mark('programs-ready'); preview.mark('visible-complete'); capture.mark('capture-complete');
    expect(performance.getEntriesByName('v2:render:first-useful-frame', 'mark')).toHaveLength(1);
    const measures = performance.getEntriesByName('v2:appearance:complete') as PerformanceMeasure[];
    expect(measures).toHaveLength(1); expect(measures[0].detail).toEqual({ request: preview.id, target: '2d' });
    expect(capture.id).not.toBe(preview.id); expect(capture.has('visible-complete')).toBe(false);
  });
});

describe('projected material density', () => {
  it('sizes resting textures to the footprint, keeps stable density buckets and respects DPR', () => {
    expect(projectedTexturePixels(1024, 40, 1)).toBe(128);
    expect(projectedTexturePixels(1024, 100, 1)).toBe(256);
    expect(projectedTexturePixels(1024, 150, 1)).toBe(256);
    expect(projectedTexturePixels(1024, 150, 2)).toBe(512);
    expect(projectedTexturePixels(1024, 2000, 2)).toBe(1024);
    expect(projectedTexturePixels(1024, 40, 1, true)).toBe(1024);
  });
});
