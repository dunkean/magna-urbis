import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, translate } from '../../src/v2/i18n';
import { urbanHelpMessages } from '../../src/v2/localeUrbanHelp';
import { urbanContextHelp, urbanParameterHelp } from '../../src/v2/urbanParameterHelp';
import { localFields } from '../../src/v2/urbanControls';
import { urbanControlFields } from '../../src/v2/urbanControlSchema';
import { translateRuntimeMessage } from '../../src/v2/runtimeMessages';

describe('city help localization', () => {
  it('translates all city descriptions and preserves unit placeholders in every language', () => {
    const sources = new Set(urbanHelpMessages.map(([en]) => en));
    for (const en of Object.values({ ...urbanParameterHelp, ...urbanContextHelp })) expect(sources.has(en), en).toBe(true);
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? []).sort();
    for (const row of urbanHelpMessages) {
      for (const [index, { code }] of LANGUAGES.entries()) {
        expect(row[index], `${code}: ${row[0]}`).toBeTruthy();
        expect(translate(row[0], code), `${code}: ${row[0]}`).toBe(row[index]);
        expect(placeholders(row[index]), `${code}: ${row[0]}`).toEqual(placeholders(row[0]));
        if (code !== 'en') expect(row[index], `${code}: ${row[0]}`).not.toBe(row[0]);
      }
    }
  });

  it('also translates the existing contextual help used by local inspector scopes', () => {
    const fields = urbanControlFields();
    for (const kind of ['quarter', 'block', 'parcel', 'building'] as const) fields.push(...localFields({ kind, key: 'town', id: '0' }));
    for (const { code } of LANGUAGES.filter(({ code }) => code !== 'en')) {
      for (const field of fields) expect(translate(field.help!, code), `${code}: ${field.path}`).not.toBe(field.help);
    }
  });

  it('localizes urban composition progress from both source languages', () => {
    const row = urbanHelpMessages.find(([en]) => en === 'Rust · urban composition…')!;
    for (const [index, { code }] of LANGUAGES.entries()) {
      expect(translateRuntimeMessage(row[0], code)).toBe(row[index]);
      expect(translateRuntimeMessage(row[1], code)).toBe(row[index]);
    }
    const bridge = readFileSync(new URL('../../src/v2/rustUrban.ts', import.meta.url), 'utf8');
    expect(bridge).toContain("report('urban-layout', 'Rust · urban composition…', 0)");
    expect(bridge).not.toContain("report('urban-layout', 'Rust · composition urbaine…'");
  });
});
