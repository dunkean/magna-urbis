import { expect, it } from 'vitest';
// @ts-expect-error Pure JavaScript validation tooling.
import { programmeUiEvidence } from '../scripts/city_programme_ui_evidence.mjs';
const weights = () => ['agricultural', 'commerce', 'artisan', 'riverine', 'port', 'capital'].map(key => ({ key, value: key === 'commerce' ? '.6' : '0', disabled: false }));
it('keeps the requested draft separate from an older retained applied summary without crediting native resolution', () => {
  const report = programmeUiEvidence({ controlsPresent: true, intent: 'settlement', custom: true, weights: weights(), draftVisible: true,
    applied: ['Agglomération ; fonctions selon le lieu et le profil culturel.'], effects: ['Habitat avec boutique : 18,2 %'], note: 'Les effets communs ne s’additionnent pas.' });
  expect(report.draft.weights.commerce.value).toBe('.6'); expect(report.draft.modifiedMarkerVisible).toBe(true);
  expect(report.retainedAppliedSummaries).toHaveLength(1); expect(report.requestedEqualsApplied).toBeNull(); expect(report.resolvedContext).toBeNull();
  expect(report.controlIssues.missingWeightKeys).toEqual([]);
});
it('retains explicit old-engine errors and isolation disabled-state without treating an automatic-looking summary as support', () => {
  const report = programmeUiEvidence({ controlsPresent: true, intent: 'isolated-mill', custom: true, weights: weights().map(row => ({ ...row, disabled: true })),
    fieldsetDisabled: true, fieldsetHidden: true, draftMessage: 'Ce moteur urbain ne prend pas en charge les fonctions combinées.',
    applied: ['Ancien programme conservé'] });
  expect(report.draft.fieldsetDisabled).toBe(true); expect(report.draft.message).toContain('ne prend pas en charge');
  expect(report.runtimeCapabilityVerified).toBeNull(); expect(report.requestedEqualsApplied).toBeNull();
});
it('shows unavailable/malformed controls explicitly rather than inventing zero weights or a successful reset', () => {
  expect(programmeUiEvidence(undefined).controlsPresent).toBe(false);
  const report = programmeUiEvidence({ weights: [{ key: 'commerce', value: 'bad' }, { key: 'commerce', value: '.5' }, { key: 'made-up', value: '1' }] });
  expect(report.draft.weights.commerce.value).toBe('bad'); expect(report.draft.custom).toBeNull();
  expect(report.controlIssues).toMatchObject({ duplicateWeightKeys: ['commerce'], unknownWeightKeys: ['made-up'] });
  expect(report.controlIssues.missingWeightKeys).toHaveLength(5);
});
it('copies only bounded observed values and never traverses unrelated native graphs or invokes a browser', () => {
  const raw = { weights: weights(), note: 'x'.repeat(5000), applied: Array(40).fill('old summary') };
  Object.defineProperty(raw, 'parentPlacementBatch', { enumerable: true, get() { throw new Error('Do not inspect a native graph.'); } });
  const report = programmeUiEvidence(raw); expect(report.explanation.note).toHaveLength(2000); expect(report.retainedAppliedSummaries).toHaveLength(24);
  expect(Object.hasOwn(report, 'parentPlacementBatch')).toBe(false); expect(report.scope).toContain('not a native resolution');
});
