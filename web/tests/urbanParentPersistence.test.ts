import { expect, it } from 'vitest';
import { buildingSettings, appliedWorkshopSnapshot, translateWorkshopState, mergeCityWorkshop } from '../src/ui/urbanSnapshot';
import { parentGenerationIdentity } from '../src/ui/urbanParentIdentity';
import type { UrbanParentBuildingState } from '../src/ui/urbanParentState';
import type { WorkshopState } from '../src/ui/testbenchUrban';
import { defaultLayoutConfig, defaultParcelConfig } from '../../rust/bridge/urban';
const parent: UrbanParentBuildingState = { store: { format: 'urban-native-parent-chunks-1', sceneId: 'immutable-archives', fingerprint: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64) },
  counts: { schema_version: 'native-parent-batch-1', generator_version: 'native-exact-test', requests: 1, admitted_parents: 1, single_parents: 0, assembly_parents: 1, physical_members: 2, refusals: 0, open_spaces: 0 }, cityKey: 'city', binding: 'imported' };
function workshop(): WorkshopState { return { layoutConfig: defaultLayoutConfig(), parcelConfig: defaultParcelConfig(), quarterSeed: '', parcelSeed: '',
  buildingState: { seed: 'retained', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' }, architectureContract: 'parent-session-1', parent } }; }
it('URL/MU recipe removes parent geometry references while retaining required generation contract', () => {
  const settings = buildingSettings(workshop().buildingState); expect(settings).not.toHaveProperty('parent'); expect(settings?.architectureContract).toBe('parent-session-1'); expect(settings?.generated).toBe(true);
});
it('applied snapshot keeps archive reference and translate only offsets its display frame', () => {
  const exact = appliedWorkshopSnapshot(workshop()); expect(exact.buildingState?.parent).toBe(parent);
  const moved = translateWorkshopState(exact, 500, -20); expect(moved.buildingState?.parent?.store).toBe(parent.store); expect(moved.buildingState?.parent?.offset).toEqual({ x: 500, y: -20 });
  expect(parent.offset).toBeUndefined(); expect(moved.buildingState?.scene).toBeUndefined();
});
it('legacy settings do not gain a parent or change their architecture contract', () => {
  const settings = buildingSettings({ seed: 'old', visible: true, appearance: { style: 'cartographic', diagnostic: 'none' } }); expect(settings).not.toHaveProperty('parent'); expect(settings).not.toHaveProperty('architectureContract');
});
it('exact three native revisions become bounded ASCII digests; settings change fingerprint but no model is invented', async () => {
  const input = { source: { version: 1 as const, session: 'actual-handle', terrainRevision: 'terrain', layoutsRevision: 'layouts', partitionsRevision: 'parcels' },
    keys: ['city'], seed: 'same', settings: {}, runtime: { profile: 'local', server: 'http://exact-engine.test' } };
  const a = await parentGenerationIdentity(input), b = await parentGenerationIdentity({ ...input, source: { ...input.source, partitionsRevision: 'changed' } });
  expect(a.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(a.revision).toMatch(/^[a-f0-9]{64}$/); expect(a.revision).not.toBe(b.revision);
  const c = await parentGenerationIdentity({ ...input, settings: { floors: 2 } }); expect(c.revision).toBe(a.revision); expect(c.fingerprint).not.toBe(a.fingerprint);
});
