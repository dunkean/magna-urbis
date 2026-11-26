/** Display quality under the page's performance policy, without a browser. */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
async function quality() {
  vi.resetModules();
  return import('../src/render/displayQuality');
}

describe('display quality policy', () => {
  it('resolves Auto to the policy, below an explicit preference, and keeps captures full', async () => {
    const q = await quality();
    expect(q.getDisplayQuality()).toBe('full');
    q.setDisplayQualityPolicy('light');
    expect(q.getDisplayQuality()).toBe('light');
    expect(q.displayQualityFor(false)).toBe('full');
    q.setDisplayQualityPreference('full');
    expect(q.getDisplayQuality()).toBe('full');
    q.setDisplayQualityPreference('auto');
    expect(q.getDisplayQuality()).toBe('light');
    q.setDisplayQualityPolicy(undefined);
    expect(q.getDisplayQuality()).toBe('full');
  });

  it('ignores GPU names and slow frames under a policy', async () => {
    vi.stubGlobal('document', { hidden: false });
    const q = await quality();
    q.setDisplayQualityPolicy('full');
    q.initializeDisplayQuality();
    q.reportDisplayRenderer('Mali-G78');
    expect(q.getDisplayQuality()).toBe('full');
    for (let i = 0, t = 1000; i <= 20; i++, t += 50) {
      q.noteDisplayNavigation(t);
      q.noteDisplayFrame(t);
    }
    expect(q.getDisplayQuality()).toBe('full');
  });

  it('caps the live pixel ratio', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const q = await quality();
    expect(q.liveDevicePixelRatio()).toBe(3);
    expect(q.setDisplayPixelRatioCap(1.5)).toBe(true);
    expect(q.setDisplayPixelRatioCap(1.5)).toBe(false);
    expect(q.liveDevicePixelRatio()).toBe(1.5);
  });
});
