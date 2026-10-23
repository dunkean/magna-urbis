/** Check the applied settlement, not merely the requested population/culture.
 * A pinned location is part of the scenario identity, independent of camera.
 * Unpinned scenarios deliberately allow the generator to choose their centre.
 */
export function settlementIdentity(expected, entries) {
  const actual = entries?.find(entry => entry.key === expected.key);
  const position = expected.position;
  const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const issues = [];
  if (!actual) issues.push('Requested settlement key is absent from the applied response.');
  if (actual && actual.population !== expected.population) issues.push('Applied population differs from the scenario.');
  if (actual && actual.culture !== expected.culture) issues.push('Applied culture differs from the scenario.');
  if (actual && !finitePoint(actual.center)) issues.push('Applied settlement centre is missing or invalid.');
  if (position != null && !finitePoint(position)) issues.push('Pinned scenario position is invalid.');
  const displacementM = finitePoint(position) && finitePoint(actual?.center)
    ? Math.hypot(actual.center.x - position.x, actual.center.y - position.y) : null;
  // Permit only floating-point round trips, not a silent relocation or rounding
  // to a different fixture. The input and output both use metric world space.
  if (displacementM !== null && displacementM > 1e-6) issues.push('Applied centre differs from the pinned scenario position.');
  return {
    matches: issues.length === 0,
    expected: { key: expected.key, population: expected.population, culture: expected.culture, position: position ?? null },
    actual: actual ? { key: actual.key, population: actual.population, culture: actual.culture, center: actual.center } : null,
    displacementM, issues,
  };
}
