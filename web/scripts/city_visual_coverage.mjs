/** Pure provenance accounting. Sampling forty scenes never proves every culture
 * or any culture x biome x relief x size combination has been reviewed. */
export function cityVisualCoverage(manifest, cultures, selected = manifest.cases) {
  const catalogue = Object.keys(cultures).sort(), cases = manifest.cases;
  const unique = values => [...new Set(values)].sort();
  const sampled = unique(cases.map(item => item.culture)), covered = sampled.filter(id => Object.hasOwn(cultures, id));
  const missing = catalogue.filter(id => !covered.includes(id)), unknown = sampled.filter(id => !Object.hasOwn(cultures, id));
  const equal = (a, b) => Array.isArray(a) && JSON.stringify(unique(a)) === JSON.stringify(b);
  const groups = key => Object.fromEntries(unique(cases.map(item => item.tags?.[key]).filter(value => typeof value === 'string'))
    .map(value => [value, cases.filter(item => item.tags?.[key] === value).length]));
  const declared = manifest.coverage ?? {}, warnings = [];
  if (declared.catalogueCultureCount !== catalogue.length) warnings.push(`Manifest catalogueCultureCount=${declared.catalogueCultureCount ?? 'absent'}; current catalogue=${catalogue.length}.`);
  if (!equal(declared.coveredCultures, covered)) warnings.push('Manifest coveredCultures differs from sampled IDs intersected with the current catalogue.');
  if (!equal(declared.notCoveredCultures, missing)) warnings.push('Manifest notCoveredCultures differs from current catalogue minus sampled cultures.');
  if (unknown.length) warnings.push(`Sampled culture IDs absent from current catalogue: ${unknown.join(', ')}.`);
  return { scope: 'planned sample; no captures or visual verdict inferred', catalogueCultureCount: catalogue.length,
    plannedPrimaryViews: cases.length, plannedDistinctScenes: unique(cases.map(item => item.pairedWith ?? item.id)).length,
    selectedViews: selected.length, selectedCultures: unique(selected.map(item => item.culture)),
    sampledCultures: sampled, coveredCultures: covered, notCoveredCultures: missing, unknownCultures: unknown, warnings,
    biomeTags: groups('biome'), reliefTags: groups('relief'), sizeTags: groups('size'),
    crossProductCoverage: 'not certified', biomeMeaning: 'decor climate labels, not verified per-pixel ecology' };
}
