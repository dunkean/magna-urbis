import { describe, expect, it } from 'vitest';
import { presentName } from '../src/gen/names/displayNames';
import { presentMapNames } from '../src/v2/mapNaming';
import type { NameParts } from '../src/gen/names/types';
import type { World } from '../src/gen/types';

const parts: NameParts = { kind: 'river', proper: 'Ruisseau de Graham', cultural: 'Ruisseau de Graham', opaque: true, sourceMode: 'country', profile: 'french', role: 'water.brook' };
describe('geographic water labels in the display language', () => {
  it('localizes the French generic and keeps the proper name and source spelling', () => {
    expect(presentName(parts, { mode: 'localized', language: 'en' })).toBe('Graham Brook');
    expect(presentName(parts, { mode: 'localized', language: 'fr' })).toBe('Ruisseau de Graham');
    expect(presentName(parts, { mode: 'cultural', language: 'en' })).toBe('Ruisseau de Graham');
    expect(parts.proper).toBe('Ruisseau de Graham');
  });
  it('handles French elision and leaves unreviewed opaque names intact', () => {
    expect(presentName({ ...parts, cultural: 'Ruisseau d’Argent' }, { mode: 'localized', language: 'en' })).toBe('Argent Brook');
    expect(presentName({ ...parts, cultural: 'Sumiyō Gawa' }, { mode: 'localized', language: 'en' })).toBe('Sumiyō Gawa');
  });
  it('updates retained map labels while respecting manually authored labels', () => {
    const source = {
      names: {
        entries: [
          { id: 'r1', kind: 'river', text: parts.cultural, parts },
          { id: 'r2', kind: 'river', text: 'Ruisseau de Graham', parts, manual: true, generated: false },
        ],
      },
    } as unknown as World;
    const shown = presentMapNames(source, 'en');
    expect(shown.names!.entries.map(entry => entry.text)).toEqual(['Graham Brook', 'Ruisseau de Graham']);
    expect(source.names!.entries[0].text).toBe('Ruisseau de Graham');
    expect(presentMapNames(shown, 'fr').names!.entries[0].text).toBe('Ruisseau de Graham');
  });
});
