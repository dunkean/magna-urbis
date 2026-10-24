import { expect, it } from 'vitest';
// @ts-expect-error Pure JavaScript bench tooling; independently executable without browser.
import { cityVisualCoverage } from '../scripts/city_visual_coverage.mjs';
it('derives current coverage without treating close views or stale declarations as new culture evidence', () => {
  const cases = [{ id: 'a', culture: 'first', tags: { size: 'town', biome: 'temperate', relief: 'flat' } },
    { id: 'a-close', pairedWith: 'a', culture: 'first', tags: { size: 'town', biome: 'temperate', relief: 'flat' } }];
  const report = cityVisualCoverage({ cases, coverage: { catalogueCultureCount: 1, coveredCultures: ['first'], notCoveredCultures: [] } }, { first: {}, added: {} }, [cases[1]]);
  expect(report.catalogueCultureCount).toBe(2); expect(report.plannedDistinctScenes).toBe(1); expect(report.plannedPrimaryViews).toBe(2);
  expect(report.notCoveredCultures).toEqual(['added']); expect(report.selectedViews).toBe(1); expect(report.selectedCultures).toEqual(['first']);
  expect(report.warnings).toHaveLength(2); expect(report.crossProductCoverage).toBe('not certified'); expect(report.scope).toContain('no captures');
});
it('keeps unknown case cultures explicit and does not mutate the frozen manifest', () => {
  const manifest = Object.freeze({ cases: Object.freeze([{ id: 'a', culture: 'missing' }]),
    coverage: Object.freeze({ catalogueCultureCount: 1, coveredCultures: ['missing'], notCoveredCultures: ['known'] }) });
  const report = cityVisualCoverage(manifest, { known: {} });
  expect(report.sampledCultures).toEqual(['missing']); expect(report.coveredCultures).toEqual([]);
  expect(report.coveredCultures.length + report.notCoveredCultures.length).toBe(report.catalogueCultureCount);
  expect(report.unknownCultures).toEqual(['missing']); expect(report.notCoveredCultures).toEqual(['known']);
  expect(report.warnings).toEqual(expect.arrayContaining([expect.stringContaining('intersected'), expect.stringContaining('absent from current catalogue: missing')]));
  expect(report.biomeTags).toEqual({}); expect(manifest.coverage.catalogueCultureCount).toBe(1);
});
