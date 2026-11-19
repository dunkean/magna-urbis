/** Page lock and view defaults without a browser: exercise capability changes against retained user choices. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '../src/ui/viewer';

vi.mock('../src/v2/i18n', async importOriginal => ({ ...(await importOriginal<typeof import('../src/v2/i18n')>()), insertHTML: vi.fn() }));

class Control {
  disabled = false;
  onclick?: () => void;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  querySelector() {
    return new Control();
  }
}

async function setup(tier: string, stored: string | null = null) {
  vi.resetModules();
  const lock = new Control(),
    button = new Control();
  const storage = { getItem: vi.fn(() => stored), setItem: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', { search: `?test=1&machine=${tier}`, hash: '', hostname: 'localhost' });
  vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 8 });
  vi.stubGlobal('window', { setTimeout, clearTimeout, location });
  vi.stubGlobal('document', { querySelector: (selector: string) => (selector === '#view3d' ? button : lock), createElement: () => ({ getContext: () => ({ getExtension: () => null, getParameter: () => 'Hardware GPU' }) }) });
  const policy = await import('../src/v2/machineTier');
  await policy.inspectMachine();
  const { mountViewLock } = await import('../src/v2/page/viewLock');
  const setTiltLocked = vi.fn();
  mountViewLock({ setTiltLocked } as unknown as Viewer);
  return { policy, lock, button, storage, setTiltLocked };
}

afterEach(() => vi.unstubAllGlobals());

describe('3D machine capability in the page', () => {
  it.each([null, '0', '1'])('preserves the saved padlock preference (%s) through capability changes', async stored => {
    const { policy, lock, button, storage, setTiltLocked } = await setup('veryslow', stored);
    expect(setTiltLocked).toHaveBeenLastCalledWith(true);
    expect(lock.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    expect(lock.attributes.get('title')).toBe(button.attributes.get('title'));
    expect(button.attributes.get('title')).toContain('graphics card');
    const { translate } = await import('../src/v2/i18n');
    expect(translate(button.attributes.get('data-i18n-title')!, 'fr')).toContain('carte graphique');
    lock.onclick!(); // A scripted call must not write a disabled preference either.
    expect(storage.setItem).not.toHaveBeenCalled();
    location.search = '?machine=capable';
    await policy.inspectMachine();
    expect(lock.disabled).toBe(false);
    expect(button.disabled).toBe(stored === '1');
    expect(setTiltLocked).toHaveBeenLastCalledWith(stored === '1');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps the padlock usable on slow machines and saves only explicit changes', async () => {
    const { lock, button, storage, setTiltLocked } = await setup('slow');
    expect(lock.disabled).toBe(false);
    expect(button.disabled).toBe(false);
    lock.onclick!();
    expect(setTiltLocked).toHaveBeenLastCalledWith(true);
    expect(storage.setItem).toHaveBeenLastCalledWith('magna-urbis-v2-lock-2d', '1');
    lock.onclick!();
    expect(setTiltLocked).toHaveBeenLastCalledWith(false);
    expect(storage.setItem).toHaveBeenLastCalledWith('magna-urbis-v2-lock-2d', '0');
  });

  it('uses light defaults for the displayed view, preserves saved tree settings, and leaves exports unchanged', async () => {
    await setup('slow');
    const { defaultSettings } = await import('../src/v2/settings');
    const { resolveSettingsAppearance } = await import('../src/v2/appearance');
    const settings = defaultSettings(),
      before = structuredClone(settings);
    for (const target of ['view2d', 'view3d'] as const) expect(resolveSettingsAppearance(settings, undefined, target).city).toMatchObject({ trees3d: false, treeDistance: 200 });
    expect(resolveSettingsAppearance(settings, undefined, 'export').city.treeDistance).toBe(600);
    expect(settings).toEqual(before);
    settings.appearance!.city = { trees3d: true, treeDistance: 1400 };
    expect(resolveSettingsAppearance(settings, undefined, 'view3d').city).toMatchObject({ trees3d: true, treeDistance: 1400 });
  });

  it('keeps the saved view depth ahead of machine defaults without writing storage', async () => {
    const { storage } = await setup('slow', '4');
    const slider = { value: '' };
    vi.stubGlobal('document', { querySelector: () => ({ querySelector: () => slider }) });
    const { mountWorldDepthControl } = await import('../src/v2/page/worldDepth');
    const { getViewDepth } = await import('../src/render/world/viewDepth');
    mountWorldDepthControl({} as never);
    expect(getViewDepth()).toBe(4);
    expect(slider.value).toBe('4');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('exposes 3D availability with the resolved tier in the existing script hook', async () => {
    await setup('veryslow');
    const { mountV2TestHook } = await import('../src/v2/testHook');
    mountV2TestHook({} as never);
    expect((window as unknown as { __v2Test: { machine(): unknown } }).__v2Test.machine()).toEqual({ tier: 'veryslow', reason: 'forced', available3d: false });
  });
});
