import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/v2/settings';
import { parseProject, serializeProject } from '../src/v2/project';
import { encodeCityCode, decodeCityCode } from '../src/v2/cityCode';
import { applyLabelEdits } from '../src/v2/mapLabels';
import { hasToponymOverride, renameToponym, resetToponymName, setToponymHidden, toponymHidden, toponymOverride } from '../src/v2/toponymOverrides';
import { renameMap } from '../src/v2/mapNaming';
import { DEFAULTS } from '../src/gen/options';
import type { World } from '../src/gen/types';

const base = () => { const s = defaultSettings(); s.options.seed = '42'; return s; };
const town = { id: 'settlement:east', town: 'east' }, river = { id: 'river:abc', kind: 'river' };

describe('V2 toponym overrides', () => {
  it('renames, refuses empty text, resets to the generated name and toggles visibility', () => {
    const settings = base();
    expect(renameToponym(settings, town, '  Le   Gué ')).toBe(true);
    expect(settings.naming?.places).toEqual({ east: 'Le Gué' });
    expect(renameToponym(settings, river, 'Blackwater')).toBe(true);
    expect(toponymOverride(settings, river)).toBe('Blackwater');
    expect(renameToponym(settings, river, '   ')).toBe(false);
    expect(toponymOverride(settings, river)).toBe('Blackwater');
    setToponymHidden(settings, river, true);
    expect(toponymHidden(settings, river.id)).toBe(true);
    resetToponymName(settings, river);
    // Reset touches only the name: the eye keeps its state.
    expect(settings.naming?.labels?.[river.id]).toEqual({ hidden: true });
    expect(hasToponymOverride(settings, river)).toBe(false);
    setToponymHidden(settings, river, false);
    expect(settings.naming?.labels?.[river.id]).toBeUndefined();
    // Typing back the generated name clears the override instead of storing a copy.
    renameToponym(settings, town, 'Eastford', 'Eastford');
    expect(settings.naming?.places?.east).toBeUndefined();
  });

  it('is kept by the project file and left out of the MU3 code', () => {
    const settings = base();
    renameToponym(settings, town, 'Le Gué'); renameToponym(settings, river, 'Blackwater'); setToponymHidden(settings, { id: 'hill:x' }, true);
    settings.naming!.labels!['free:note'] = { kind: 'free', text: 'Camp', anchor: { x: 1, y: 2 } };
    const restored = parseProject(serializeProject(settings)).settings;
    expect(restored.naming?.places).toEqual({ east: 'Le Gué' });
    expect(restored.naming?.labels?.[river.id]).toMatchObject({ text: 'Blackwater' });
    expect(restored.naming?.labels?.['hill:x']).toEqual({ hidden: true });
    const code = encodeCityCode(settings), shared = decodeCityCode(code).settings;
    expect(code).not.toContain('Blackwater');
    expect(shared.naming?.places).toBeUndefined();
    expect(Object.keys(shared.naming?.labels ?? {})).toEqual(['free:note']);
    expect(settings.naming?.places).toEqual({ east: 'Le Gué' });
  });

  it('survives a change of toponym culture; reset gives the name of the current culture', () => {
    const grid = { w: 24, h: 24, cell: 50, data: new Float32Array(576) };
    const source = {
      seed: 'overrides', mapSize: 1200, stats: {}, options: { ...DEFAULTS, culture: 'bastide', language: 'auto' },
      terrain: { height: grid, slope: grid, water: new Uint8Array(576).fill(1), seaFraction: .5, lakes: [],
        rivers: [1, 2].map(id => ({ id, main: id === 1, path: [{ x: 0, y: id * 100 }, { x: 1200, y: id * 100 }], width: [8, 8] })) },
      site: { center: { x: 500, y: 500 }, reserveRadius: 100 }, roads: [],
      settlements: [{ key: 'main', main: true, population: 3000, culture: 'bastide', center: { x: 500, y: 500 }, detail: 'main' }, { key: 'east', population: 500, culture: 'bastide', center: { x: 900, y: 500 } }],
    } as unknown as World;
    const settings = base(); settings.options.culture = 'bastide';
    const entry = (world: World, id: string) => world.names!.entries.find(e => e.id === id)!;
    renameToponym(settings, town, 'Le Gué'); renameToponym(settings, { id: 'river:2', kind: 'river' }, 'My River');
    const original = renameMap(source, settings);
    settings.naming!.toponymCulture = 'japanese-jokamachi';
    const japanese = renameMap(original, settings);
    expect(japanese.settlements!.find(s => s.key === 'east')!.name).toBe('Le Gué');
    expect(entry(japanese, 'river:2').text).toBe('My River');
    expect(entry(japanese, 'river:1').parts?.profile).toBe('japanese');
    resetToponymName(settings, { id: 'river:2', kind: 'river' });
    const reset = renameMap(japanese, settings);
    expect(entry(reset, 'river:2').text).not.toBe('My River');
    expect(entry(reset, 'river:2').parts?.profile).toBe('japanese');
  });

  it('renames a generated label without pinning it', () => {
    const world = { names: { family: 'english', town: 'Town', entries: [{ id: river.id, kind: 'river', text: 'Elm River', rank: 2, anchor: { x: 0, y: 0 }, path: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }] } } as unknown as World;
    applyLabelEdits(world, { [river.id]: { text: 'Blackwater', mode: 'label' } });
    expect(world.names!.entries[0]).toMatchObject({ text: 'Blackwater', path: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
    expect(world.names!.entries[0].forceVisible).toBeUndefined();
  });
});
