import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translate } from '../../src/v2/i18n';
import { localeMessages } from '../../src/v2/localeMessages';
import { activityKindNames, activityResourceLabel, activityResourceNames, urbanActivityNames } from '../../src/v2/urbanLabelNames';

const core = (path: string): string => readFileSync(new URL(`../../../rust/crates/core/src/${path}`, import.meta.url), 'utf8');

describe('activity site labels', () => {
  it('names every template and kind an activity site can carry, so the Places panel never shows a raw id', () => {
    const templates = (JSON.parse(core('urban/activities.json')) as { sites: { id: string }[] }).sites.map(site => site.id);
    // Kinds: the anchor kinds (resources/anchors.rs `k("quarry", …)`) and the literal `kind:` of the countryside, road-node and remote sites.
    const kinds = new Set([...core('resources/anchors.rs').matchAll(/\bk\("([a-z_]+)"/g)].map(match => match[1]));
    for (const file of ['resources/anchors.rs', 'settlements/countryside.rs', 'settlements/nodes.rs', 'settlements/remote.rs']) for (const line of core(file).split('\n')) if (/^\s*kind: /.test(line)) for (const match of line.matchAll(/"([a-z_]+)"/g)) kinds.add(match[1]);
    expect(templates.length).toBeGreaterThan(50);
    expect(kinds.size).toBeGreaterThan(10);
    expect(templates.filter(id => !urbanActivityNames[id])).toEqual([]);
    expect([...kinds].filter(id => !activityKindNames[id])).toEqual([]);
  });

  it('names and localizes every resource the engine can put on an activity site', () => {
    // Activity sites copy resources from anchors and deposits, road classes, or a countryside constructor.
    const anchors = [...core('resources/anchors.rs').matchAll(/\bk\(\s*"[^"]+",\s*"([^"]+)"/g)].map(match => match[1]);
    const families = core('resources/deposits.rs').match(/\bFAMILIES:[^\n]+ = \[([\s\S]+?)\];/)?.[1] ?? '';
    const deposits = [...families.matchAll(/\(\s*"([^"]+)"/g)].map(match => match[1]);
    const classes = core('settlements/roads/profile.rs').match(/\bCLASSES:[^\n]+ = \[([\s\S]+?)\];/)?.[1] ?? '';
    const roads = [...classes.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    const countryside = [...core('settlements/countryside.rs').matchAll(/^\s*resource: ([^\n]+)/gm)].flatMap(line => [...line[1].matchAll(/"([^"]+)"/g)].map(match => match[1]));
    const groups = [anchors, deposits, roads, countryside];
    for (const group of groups) expect(group.length).toBeGreaterThan(0);

    const ids = new Set(groups.flat());
    expect([...ids].filter(id => !Object.hasOwn(activityResourceNames, id))).toEqual([]);
    for (const id of ids) {
      const [english, french] = activityResourceNames[id];
      expect(activityResourceLabel(id), id).toBe(english);
      expect(english, id).not.toBe(id);
      expect(translate(english, 'fr'), id).toBe(french);
      for (const language of ['es', 'pt', 'zh', 'ar', 'ru', 'ja'] as const) {
        expect(localeMessages[language][english], `${id} (${language})`).toBeTruthy();
        expect(translate(english, language), `${id} (${language})`).toBe(localeMessages[language][english]);
      }
    }
    expect(activityResourceLabel('')).toBe('');
  });
});
