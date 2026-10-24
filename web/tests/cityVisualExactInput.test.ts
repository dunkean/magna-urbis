import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Pure JavaScript bench tooling, no browser dependency.
import { exactVisualInput, prepareExactVisualInput } from '../scripts/city_visual_exact_input.mjs';
import proposed from '../../_agents_blackboard/CITY_VISUAL_BENCH_52_PROPOSED.json';
type ExactCase = { id: string; population: number; architecture: string; camera: { kind: string; cx: number; cy: number; mpp: number };
  settlement: { position: { x: number; y: number } }; exactInput: { path: string } };
const exactCase = (id: string) => proposed.cases.find(row => row.id === id) as unknown as ExactCase;

it('keeps both exact frozen user identities including fractional centre, architecture, fit and presentation', () => {
  for (const id of ['51-roman-user-exact-5k', '52-javanese-user-exact-100k']) {
    const item = exactCase(id);
    const raw = readFileSync(new URL(`./fixtures/${item.exactInput!.path.split('/').at(-1)}`, import.meta.url), 'utf8');
    const result = exactVisualInput(item, raw), original = new URL(raw.trim()).searchParams;
    expect(result.identity.position).toEqual(item.settlement.position); expect(result.identity.population).toBe(item.population);
    expect(result.identity.architecture).toBe(item.architecture); expect(result.identity.parcelFit).toBe(true);
    expect(result.identity.camera).toEqual(item.camera); expect(result.identity.runtimeBinarySha256).toBeNull();
    for (const key of ['settlements', 'roads', 'urban']) expect(result.query.get(key)).toBe(original.get(key));
    expect(result.identity.quarterSeed).toBe(''); expect(result.identity.parcelSeed).toBe(''); expect(result.identity.buildingSeed).toBe('');
    expect(() => exactVisualInput({ ...item, population: item.population + 1 }, raw)).toThrow('identity differs');
    expect(() => exactVisualInput({ ...item, architecture: item.architecture === 'silhouette' ? 'compact' : 'silhouette' }, raw)).toThrow('identity differs');
  }
});
it('rejects rounding the Roman centre or replacing Java100k with the older5k scenario', () => {
  const roman = exactCase('51-roman-user-exact-5k'), java = exactCase('52-javanese-user-exact-100k');
  const raw = (item: typeof roman) => readFileSync(new URL(`./fixtures/${item.exactInput!.path.split('/').at(-1)}`, import.meta.url), 'utf8');
  expect(() => exactVisualInput({ ...roman, settlement: { ...roman.settlement, position: { x: 2640, y: 2669 } } }, raw(roman))).toThrow('identity differs');
  expect(() => exactVisualInput({ ...java, population: 5000 }, raw(java))).toThrow('identity differs');
});

it('prepares the actual final intended queries with every original non-runtime entry preserved, not only a few identity scalars', () => {
  for (const id of ['51-roman-user-exact-5k', '52-javanese-user-exact-100k']) {
    const item = exactCase(id), raw = readFileSync(new URL(`./fixtures/${item.exactInput.path.split('/').at(-1)}`, import.meta.url), 'utf8');
    const original = new URL(raw.trim()).searchParams, result = prepareExactVisualInput(item, raw), intended = new URLSearchParams(result.intendedQuery);
    const runtime = ['profile', 'localServer', 'compute', 'generation', 'neural', 'situation'];
    expect([...intended]).toEqual([...original].filter(([key]) => !runtime.includes(key)));
    for (const key of ['urban', 'settlements', 'roads', 'fond', 'artifact', 'standalone']) expect(intended.getAll(key)).toEqual(original.getAll(key));
    expect(result.proof.intendedNonRuntimeEntriesPreserved).toBe(true); expect(result.proof.intendedDifferences).toEqual([]);
    const changes = ['/urban/render/view', '/urban/buildingState/generated'];
    if (item.architecture === 'detailed') changes.push('/urban/architecture');
    expect([...result.proof.initialDifferences].sort()).toEqual(changes.sort());
    expect(result.proof.removedRuntimeKeys.sort()).toEqual(['localServer', 'profile']);
    const originalUrban = JSON.parse(original.get('urban')!), initialUrban = JSON.parse(result.query.get('urban'));
    expect(initialUrban.buildingState.appearance).toEqual(originalUrban.buildingState.appearance);
    expect(initialUrban.layoutConfig).toEqual(originalUrban.layoutConfig); expect(initialUrban.parcelConfig).toEqual(originalUrban.parcelConfig);
    expect(initialUrban.buildingState.settings).toEqual(originalUrban.buildingState.settings); expect(result.proof.runtimeBinarySha256).toBeNull();
  }
});

it('preserves unrelated options and query entries, and refuses to silently erase retained geometry or edits', () => {
  const item = exactCase('51-roman-user-exact-5k'), text = readFileSync(new URL('./fixtures/visual-roman-user-exact-url.txt', import.meta.url), 'utf8');
  const url = new URL(text.trim()), urban = JSON.parse(url.searchParams.get('urban')!);
  urban.layoutConfig.params['unrelated-sentinel'] = { weight: .37, label: 'preserve', enabled: false };
  url.searchParams.set('urban', JSON.stringify(urban)); url.searchParams.append('unrelated', 'first'); url.searchParams.append('unrelated', 'second');
  const prepared = prepareExactVisualInput(item, url.href);
  expect(new URLSearchParams(prepared.intendedQuery).get('urban')).toBe(url.searchParams.get('urban'));
  expect(prepared.query.getAll('unrelated')).toEqual(['first', 'second']); expect(prepared.proof.intendedDifferences).toEqual([]);
  urban.edits = { buildings: { native: 'must not silently disappear' } }; url.searchParams.set('urban', JSON.stringify(urban));
  expect(() => prepareExactVisualInput(item, url.href)).toThrow('cannot silently strip');
});
