import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityKindNames, urbanActivityNames } from '../../src/v2/urbanLabelNames';

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
});
