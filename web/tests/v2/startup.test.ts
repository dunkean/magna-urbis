import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/v2/settings';
import { effectiveTerrainSettings } from '../../src/v2/terrainSettings';
import { validateSettings } from '../../src/v2/project';
import type { SavedRecipe } from '../../src/v2/autosave';
import { randomInitialSettings, reloadPreviousMapAtStartup, RESUME_WINDOW_MS, setReloadPreviousMapAtStartup, STARTUP_RESTORE_KEY, startupPlan } from '../../src/v2/startup';

afterEach(() => vi.unstubAllGlobals());
const draws = (...values: number[]) => {
  let next = 0;
  return () => values[next++] ?? 0.25;
};

describe('initial landscape', () => {
  it('removes fixed geography so the initial draw takes effect, while retaining other preferences', () => {
    const before = defaultSettings();
    before.options.culture = 'roman-core';
    before.options.population = 5000;
    before.options.importedHeight = { w: 2, h: 2, rgba: new Uint8ClampedArray(16) };
    before.options.center = { x: 200, y: 300 };
    before.decor = { id: 'retained', bytes: new Uint8Array([1, 2]) };
    before.terrain = {
      ...before.terrain,
      relief: 'high-mountains',
      reliefClimate: 'alpine',
      climateValues: { precipitation: 5 },
      sketch: { version: 1, resolution: 8, heights: Array(64).fill(300), processing: 'surface' },
      heightmap: { name: 'old' },
      neuralTuning: { reliefMode: 'fixed', reliefFixed: 400, steps: 8 },
    };
    before.appearance!.city = { trees3d: false, exaggeration: 1.2 };
    before.runtime!.source = 'neural-wasm';
    before.generation = 'neural';
    const original = structuredClone(before);
    const next = randomInitialSettings(before, draws(0.99, 0.99, 0));
    expect(next.options.biome).toBe('temperate');
    expect(next.terrain).toMatchObject({ climate: 'wetland', relief: 'valley', coastMask: 0, neuralTuning: { steps: 8 } });
    expect(next.options.seed).not.toBe(before.options.seed);
    expect(next.options.center).toBeUndefined();
    expect(next.options.importedHeight).toBeUndefined();
    expect(next.decor).toBeUndefined();
    expect(next.terrain!.sketch).toBeUndefined();
    expect(next.terrain!.heightmap).toBeUndefined();
    expect(next.terrain!.reliefClimate).toBeUndefined();
    expect(next.terrain!.climateValues).toBeUndefined();
    expect(next.terrain!.neuralTuning!.reliefMode).toBeUndefined();
    expect(next.runtime).toEqual(before.runtime);
    expect(next.appearance).toEqual(before.appearance);
    expect(next.options.culture).toBe('roman-core');
    expect(next.options.population).toBe(5000);
    expect(before).toEqual(original);
    expect(() => validateSettings(next)).not.toThrow();
    expect(effectiveTerrainSettings(next, 6000).climateZone).toBe('wetland');
  });

  it.each([
    [0, 255, 'island'],
    [1, 255, 'peninsula'],
    [2, 255, 'archipelago'],
    [3, 4, 'island'],
    [4, 28, 'island'],
    [5, 124, 'island'],
  ] as const)('selects coherent coastal family %i with a rotated sea mask', (family, mask, mode) => {
    const settings = randomInitialSettings(defaultSettings(), draws(0.4, 0.3, 0.8, (family + 0.1) / 6, 0.25));
    expect(settings.terrain).toMatchObject({ coastMask: mask, islandMode: mode });
    expect(settings.options.coast).toBe('random');
    expect(() => validateSettings(settings)).not.toThrow();
  });

  it('keeps classic terrain within its supported relief families', () => {
    const previous = defaultSettings();
    previous.runtime!.backend = 'typescript';
    const next = randomInitialSettings(previous, draws(0.85, 0.99));
    expect(['flat', 'hills', 'valley', 'mountains']).toContain(next.terrain!.relief);
    expect(next.options.relief).toBe(next.terrain!.relief);
  });

  it('keeps the fresh landscape selectable when a saved recipe uses neural terrain', () => {
    const previous = defaultSettings();
    previous.generation = 'neural';
    previous.runtime!.source = 'neural-wasm';
    const next = randomInitialSettings(previous, draws(0.85, 0.99));
    expect(next.runtime!.source).toBe('neural-wasm');
    expect(next.terrain).toMatchObject({ climate: 'tropical', relief: 'mountains' });
  });

  it('keeps the fresh landscape selectable when a saved recipe uses compact Phasor', () => {
    const previous = defaultSettings();
    previous.terrain!.procedural = { preset: 'compact' };
    const next = randomInitialSettings(previous, draws(0.1, 0.7));
    expect(next.terrain).toMatchObject({ procedural: { preset: 'compact' }, climate: 'mediterranean', relief: 'mixed' });
  });

  it('restores opted-in unfinished/imported recipes exactly, and leaves explicit projects and test pages alone', () => {
    const current = defaultSettings(),
      saved = { settings: defaultSettings(), mods: [{ action: 'kept' }], view: { cx: 1, cy: 2, scale: 3 }, ui: { tab: 'terrain' } };
    const random = vi.fn(() => 0.9);
    expect(startupPlan(current, saved, { explicit: false, restore: true, random })).toEqual({ mode: 'restore', saved });
    expect(startupPlan(current, saved, { explicit: true, restore: false, random })).toEqual({ mode: 'explicit', settings: current });
    expect(random).not.toHaveBeenCalled();
    expect(startupPlan(current, saved, { explicit: false, restore: false, random }).mode).toBe('fresh');
    expect(random).toHaveBeenCalled();
  });

  it('resumes a recently generated map on handheld devices only while no preference is stored', () => {
    const current = defaultSettings(),
      now = 1_000_000_000,
      map = { settings: defaultSettings(), mods: [], view: { cx: 1, cy: 2, scale: 3 }, savedAt: now - 60_000 };
    const old = { ...map, savedAt: now - RESUME_WINDOW_MS - 1 },
      noMap = { ...map, view: undefined },
      undated = { ...map, savedAt: undefined };
    const plan = (saved: SavedRecipe, restore: boolean | undefined, handheld: boolean) => startupPlan(current, saved, { explicit: false, restore, handheld, now, random: () => 0.5 }).mode;
    expect(plan(map, undefined, true)).toBe('restore');
    expect(plan(old, undefined, true)).toBe('fresh');
    expect(plan(noMap, undefined, true)).toBe('fresh');
    expect(plan(undated, undefined, true)).toBe('fresh');
    expect(plan(map, false, true)).toBe('fresh');
    expect(plan(old, true, true)).toBe('restore');
    expect(plan(noMap, true, false)).toBe('restore');
    expect(plan(map, undefined, false)).toBe('fresh');
    expect(startupPlan(current, map, { explicit: true, restore: undefined, handheld: true, now })).toEqual({ mode: 'explicit', settings: current });
  });
});

it('defaults previous-map restoration to unset and persists only the explicit local preference', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  expect(reloadPreviousMapAtStartup()).toBeUndefined();
  setReloadPreviousMapAtStartup(true);
  expect(values.get(STARTUP_RESTORE_KEY)).toBe('true');
  expect(reloadPreviousMapAtStartup()).toBe(true);
  setReloadPreviousMapAtStartup(false);
  expect(reloadPreviousMapAtStartup()).toBe(false);
});
