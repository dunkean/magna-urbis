import { expect, it } from 'vitest';
import { buildingDraftHarness } from './helpers/urbanBuildingDraftHarness';
import type { UrbanBuildingDraft, UrbanBuildingState } from '../src/ui/urbanBuildingsPanel';

const future = { culture: 'future-culture/<&>', typology: 'future-typology/compound-v2' };
const draft = (): UrbanBuildingDraft => ({ seed: 'B-exact', floors: '2', model: '', fit: false, ...future });
const known = (): UrbanBuildingState => ({ seed: 'known', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' },
  settings: { culture: 'roman-core', typology: 'row', floors: 1, parcel_fit: true } });
const unknownOptions = (values: { options: { dataset: Record<string, string>; title: string }[] }) => values.options.filter(o => o.dataset.retainedUnknown === 'true');

it('unknown draft survives known restore then return and reaches the actual production generation body unchanged', async () => {
  const h = buildingDraftHarness();
  const imported: UrbanBuildingState = JSON.parse(JSON.stringify({ ...known(), settings: { ...known().settings, ...future, floors: 2, parcel_fit: false } }));
  const original = JSON.stringify(imported);
  h.api.setBuildingDraft(imported); h.node('[data-building-seed]').value = 'B-exact';
  const captured = h.api.captureDraft(); expect(captured?.culture).toBe(future.culture); expect(captured?.typology).toBe(future.typology);
  h.api.restore(known());
  expect(h.architectureCulture.value).toBe('roman-core'); expect(h.typology.value).toBe('row');
  expect(unknownOptions(h.architectureCulture)).toHaveLength(0); expect(unknownOptions(h.typology)).toHaveLength(0);
  h.api.restoreDraft(captured); await h.api.generate();
  expect(h.generated).toHaveLength(1);
  expect(h.generated[0]).toEqual({ seed: 'B-exact', settings: { culture: future.culture, typology: future.typology, floors: 2, parcel_fit: false } });
  expect(h.architectureCulture.value).toBe(future.culture); expect(h.typology.value).toBe(future.typology);
  expect(JSON.stringify(imported)).toBe(original);
});
it('serialized/reloaded draft restores both missing options in a fresh UI without changing the imported record', async () => {
  const before = draft(), record = JSON.stringify(before), reloaded: UrbanBuildingDraft = JSON.parse(record), h = buildingDraftHarness();
  expect(h.architectureCulture.options.some(o => o.value === future.culture)).toBe(false); expect(h.typology.options.some(o => o.value === future.typology)).toBe(false);
  h.api.restoreDraft(reloaded); expect(h.api.captureDraft()).toEqual(reloaded); await h.api.generate();
  expect(h.generated[0].settings.culture).toBe(future.culture); expect(h.generated[0].settings.typology).toBe(future.typology);
  expect(unknownOptions(h.architectureCulture)[0].title).toContain('validité native à vérifier');
  expect(unknownOptions(h.typology)[0].title).toContain('validité native à vérifier');
  expect(JSON.stringify(before)).toBe(record); expect(JSON.stringify(reloaded)).toBe(record);
});
it('clear, known states and repeated different drafts keep at most one transient option per selector', () => {
  const h = buildingDraftHarness(), a = draft(), b = { ...draft(), culture: 'future-B', typology: 'future-form-B' };
  h.api.restoreDraft(a); h.api.restoreDraft(b);
  expect(h.architectureCulture.value).toBe(b.culture); expect(h.typology.value).toBe(b.typology);
  expect(unknownOptions(h.architectureCulture)).toHaveLength(1); expect(unknownOptions(h.typology)).toHaveLength(1);
  h.api.restore(known()); expect(unknownOptions(h.architectureCulture)).toHaveLength(0); expect(unknownOptions(h.typology)).toHaveLength(0);
  h.api.restoreDraft(a); h.api.restore();
  expect(h.architectureCulture.value).toBe(''); expect(h.typology.value).toBe(''); expect(h.api.captureDraft()).toBeUndefined();
  h.api.restoreDraft(b); expect(h.api.captureDraft()).toEqual(b);
});
it('null and absent draft choices keep existing empty inheritance, omitted settings and immutable import; no string null/undefined is created', async () => {
  const cases: object[] = [{ culture: null, typology: null }, { culture: undefined, typology: undefined }, { culture: '', typology: '' }];
  for (const fields of cases) {
    const imported: UrbanBuildingDraft = JSON.parse(JSON.stringify({ seed: 'optional', floors: '', model: '', ...fields }));
    const saved = JSON.stringify(imported), h = buildingDraftHarness(); h.api.restoreDraft(draft()); h.api.restoreDraft(imported); await h.api.generate();
    expect(h.architectureCulture.value).toBe(''); expect(h.typology.value).toBe('');
    expect(h.generated[0].settings).toEqual({ parcel_fit: true }); expect(JSON.stringify(imported)).toBe(saved);
    expect(unknownOptions(h.architectureCulture)).toHaveLength(0); expect(unknownOptions(h.typology)).toHaveLength(0);
  }
  const h = buildingDraftHarness(); h.api.restoreDraft(draft()); const saved = h.api.captureDraft(); h.api.restoreDraft(undefined); expect(h.api.captureDraft()).toEqual(saved);
});
it('controlled downstream refusal gets the original tokens once and does not fall back, certify support or erase the draft', async () => {
  const h = buildingDraftHarness('CONTROLLED-consumer-refusal (not a native test)'), saved = draft();
  h.api.restoreDraft(saved); await h.api.generate();
  expect(h.generated).toHaveLength(1); expect(h.generated[0].settings).toMatchObject(future); expect(h.applied).toHaveLength(0);
  expect(h.node('[data-buildings-status]').textContent).toContain('CONTROLLED-consumer-refusal');
  expect(h.api.captureDraft()).toEqual(saved); expect(h.node('[data-buildings-generate]').attributes.has('aria-busy')).toBe(false);
});
it('explicit applied replay still uses its retained settings independently of newer unknown draft selections', async () => {
  const h = buildingDraftHarness(), applied = { seed: 'applied-exact', settings: { culture: 'roman-core', typology: 'row' as const, parcel_fit: true } };
  h.api.restoreDraft(draft()); await h.api.generate(applied);
  expect(h.generated).toEqual([applied]); expect(h.architectureCulture.value).toBe(future.culture); expect(h.typology.value).toBe(future.typology);
});
