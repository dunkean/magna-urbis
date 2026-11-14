import { describe, expect, it } from 'vitest';
import type { World } from '../../src/gen/types';
import type { Claim } from '../../../rust/bridge/urban';
import type { V2Settings } from '../../src/v2/contracts';
import { claimReaches, compareTowns, nameNeighbourWarning, neighbourClaimsOf, neighbourFingerprint, neighbourReach, planTownRun, type TownSeat } from '../../src/v2/townNeighbours';
import { extentRadius } from '../../src/gen/settlements/planner';
import { translateLand } from '../../src/ui/urbanSnapshot';

const square = (x: number, y: number, half: number) => ({ outer: [{ x: x - half, y: y - half }, { x: x + half, y: y - half }, { x: x + half, y: y + half }, { x: x - half, y: y + half }], holes: [] });
const claim = (key: string, x: number, y: number, half = 100): Claim => ({ key, land: [square(x, y, half)], streets: [{ path: [{ x: x + half, y }, { x: x + half + 60, y }], widths: [6, 6], rank: 2, role: 'street' }] });
const seat = (key: string, population: number, x: number, y: number, extra: Partial<TownSeat> = {}): TownSeat =>
  ({ key, population, center: { x, y }, radius: extentRadius(population), footprint: extentRadius(population), built: false, ...extra });

describe('neighbouring towns', () => {
  it('orders towns by population descending, then key', () => {
    const towns = [{ key: 'b', population: 300 }, { key: 'c', population: 5000 }, { key: 'a', population: 300 }];
    expect([...towns].sort(compareTowns).map(t => t.key)).toEqual(['c', 'a', 'b']);
  });
  it('takes an earlier claim as a neighbour only when its land comes within reach', () => {
    const reach = neighbourReach(300), land = claim('a', 0, 0, 100);
    expect(claimReaches(land, { x: 100 + reach - 1, y: 0 }, 300)).toBe(true);
    expect(claimReaches(land, { x: 100 + reach + 1, y: 0 }, 300)).toBe(false);
    expect(claimReaches({ key: 'empty', land: [], streets: [] }, { x: 0, y: 0 }, 300)).toBe(false);
  });
  it('keeps far towns independent and in the selection order', () => {
    const run = planTownRun([seat('a', 5000, 0, 0), seat('b', 300, 20000, 0), seat('c', 800, 0, 20000)], ['b', 'a', 'c']);
    expect(run.order).toEqual(['b', 'a', 'c']);
    expect([...run.waits.values()].every(deps => !deps.length)).toBe(true);
  });
  it('generates a town after the earlier towns that can reach it, and pulls in a never-built one', () => {
    const seats = [seat('small', 300, 900, 0), seat('big', 5000, 0, 0), seat('far', 300, 30000, 0)];
    expect(planTownRun(seats, ['small', 'big', 'far'])).toEqual({ order: ['big', 'small', 'far'], waits: new Map([['big', []], ['small', ['big']], ['far', []]]), cascaded: new Set() });
    // The big town is not built yet: building the small one builds it first.
    expect(planTownRun(seats, ['small']).order).toEqual(['big', 'small']);
  });
  it('reads a built town outside the run as it is and never waits for it', () => {
    const built = seat('big', 5000, 0, 0, { built: true, claim: claim('big', 0, 0, 400) });
    expect(planTownRun([built, seat('small', 300, 900, 0)], ['small'])).toEqual({ order: ['small'], waits: new Map([['small', []]]), cascaded: new Set() });
    // A built plan without a claim (older engine) is not rebuilt for its neighbours.
    expect(planTownRun([{ ...built, claim: undefined }, seat('small', 300, 900, 0)], ['small']).order).toEqual(['small']);
  });
  it('regenerates the built towns after a regenerated one that may border it, directly or through a chain', () => {
    const built = (key: string, population: number, x: number) => seat(key, population, x, 0, { built: true, claim: claim(key, x, 0, 50) });
    // Direct dependent.
    expect(planTownRun([built('big', 5000, 0), built('small', 300, 900)], ['big'])).toEqual({ order: ['big', 'small'], waits: new Map([['big', []], ['small', ['big']]]), cascaded: new Set(['small']) });
    // Chain a -> b -> c (c is out of reach of a), a far town and a never-built neighbour stay out; the selection comes first.
    const seats = [built('c', 300, 2400), built('a', 5000, 0), built('far', 300, 20000), seat('lazy', 200, 700, 0), built('b', 800, 1500)];
    const run = planTownRun(seats, ['far', 'a']);
    expect(run.order).toEqual(['far', 'a', 'b', 'c']);
    expect(run.cascaded).toEqual(new Set(['b', 'c']));
    expect(run.waits.get('c')).toEqual(['b']);
    // Regenerating the last town of the chain touches nothing else.
    expect(planTownRun(seats, ['c']).order).toEqual(['c']);
  });
  it('fingerprints the claims: empty without neighbours, changed by a move, stable otherwise', () => {
    const a = claim('a', 0, 0), moved = translateLand(a, 10, 0);
    expect(neighbourFingerprint([])).toBe('');
    expect(neighbourFingerprint([a])).toBe(neighbourFingerprint([structuredClone(a)]));
    expect(moved.land[0].outer[0]).toEqual({ x: -90, y: -100 });
    expect(moved.streets[0].path[0]).toEqual({ x: 110, y: 0 });
    expect(neighbourFingerprint([moved])).not.toBe(neighbourFingerprint([a]));
  });
  it('gives a town the reaching claims of earlier towns only, fresh run results first', () => {
    const place = (key: string, population: number, x: number) => ({ key, population, center: { x, y: 0 }, radius: extentRadius(population), urban: {} });
    const layouts = (c: Claim) => ({ layouts: [{ claim: c }] });
    const world = { settlements: [place('big', 5000, 0), place('mid', 800, 700), place('small', 300, 900)], stats: {},
      debug: { v2RustCities: { big: layouts(claim('big', 0, 0, 400)), mid: layouts(claim('mid', 700, 0, 150)), small: layouts(claim('small', 900, 0, 80)) } } } as unknown as World;
    const settings = { local: {}, options: {} } as unknown as V2Settings;
    expect(neighbourClaimsOf(world, settings, 'big')).toEqual([]);
    expect(neighbourClaimsOf(world, settings, 'mid').map(c => c.key)).toEqual(['big']);
    expect(neighbourClaimsOf(world, settings, 'small').map(c => c.key)).toEqual(['big', 'mid']);
    const fresh = claim('mid', 700, 0, 60);
    expect(neighbourClaimsOf(world, settings, 'small', new Map([['mid', fresh]]))[1]).toBe(fresh);
    // A local population override reorders the towns.
    const bigger = { ...settings, local: { small: { population: 9000 } } } as unknown as V2Settings;
    expect(neighbourClaimsOf(world, bigger, 'small')).toEqual([]);
  });
});

describe('neighbouring-town warnings', () => {
  it('translates the three engine warnings into French and keeps the town keys and counts', async () => {
    const { translateRuntimeMessage } = await import('../../src/v2/runtimeMessages');
    expect(translateRuntimeMessage('Neighbouring towns: the enclosure is not raised, its circuit would cross the land of village-2.', 'fr'))
      .toBe('Villes voisines : l’enceinte n’est pas élevée, son tracé traverserait les terres de village-2.');
    expect(translateRuntimeMessage('Neighbouring towns: no free land is left beside main, village-1; the town is announced empty.', 'fr'))
      .toBe('Villes voisines : il ne reste aucune terre libre à côté de main, village-1 ; la ville est annoncée vide.');
    expect(translateRuntimeMessage('Neighbouring towns: the land of main limits this town; 120 of 300 households housed.', 'fr'))
      .toBe('Villes voisines : les terres de main limitent cette ville ; 120 ménages logés sur 300.');
    expect(translateRuntimeMessage('Neighbouring towns: the enclosure is not raised, its circuit would cross the land of a neighbouring town.', 'fr'))
      .toBe('Villes voisines : l’enceinte n’est pas élevée, son tracé traverserait les terres d’une ville voisine.');
  });
  it('elides « de » before a name that starts with a vowel or an h', async () => {
    const { translateRuntimeMessage } = await import('../../src/v2/runtimeMessages');
    const fr = (name: string) => translateRuntimeMessage(`Neighbouring towns: the land of ${name} limits this town; 120 of 300 households housed.`, 'fr');
    expect(fr('Aubeville')).toBe('Villes voisines : les terres d’Aubeville limitent cette ville ; 120 ménages logés sur 300.');
    expect(fr('Hautbourg')).toBe('Villes voisines : les terres d’Hautbourg limitent cette ville ; 120 ménages logés sur 300.');
    expect(fr('Éclose')).toBe('Villes voisines : les terres d’Éclose limitent cette ville ; 120 ménages logés sur 300.');
    expect(fr('Bourg-Neuf')).toBe('Villes voisines : les terres de Bourg-Neuf limitent cette ville ; 120 ménages logés sur 300.');
    expect(translateRuntimeMessage('Neighbouring towns: no free land is left beside Aubeville; the town is announced empty.', 'fr'))
      .toBe('Villes voisines : il ne reste aucune terre libre à côté d’Aubeville ; la ville est annoncée vide.');
  });
  it('names the neighbours by their display name, the key when the town has none', () => {
    const names: Record<string, string> = { main: 'Aubeville', 'village-1': 'Bourg-Neuf' };
    const nameOf = (key: string) => names[key];
    expect(nameNeighbourWarning('Neighbouring towns: the enclosure is not raised, its circuit would cross the land of main.', nameOf))
      .toBe('Neighbouring towns: the enclosure is not raised, its circuit would cross the land of Aubeville.');
    expect(nameNeighbourWarning('Neighbouring towns: no free land is left beside main, village-1, far; the town is announced empty.', nameOf))
      .toBe('Neighbouring towns: no free land is left beside Aubeville, Bourg-Neuf, far; the town is announced empty.');
    expect(nameNeighbourWarning('Neighbouring towns: the land of main limits this town; 120 of 300 households housed.', nameOf))
      .toBe('Neighbouring towns: the land of Aubeville limits this town; 120 of 300 households housed.');
    expect(nameNeighbourWarning('Emprise main.', nameOf)).toBe('Emprise main.');
  });
});
