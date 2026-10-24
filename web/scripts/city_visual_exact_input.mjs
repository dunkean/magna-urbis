/** A frozen user URL supplies all saved options. Runtime is rebound separately;
 * a nearby centre, a 5k substitute or a renderer-mode change is another case. */
export function exactVisualInput(item, text) {
  const query = new URL(text.trim()).searchParams, parse = key => JSON.parse(query.get(key) ?? 'null');
  const settlements = parse('settlements'), urban = parse('urban'), spec = settlements?.config?.list?.[0];
  const expected = item.settlement?.position;
  if (query.get('artifact') !== item.artifact || settlements?.config?.list?.length !== 1 || spec?.key !== 'city'
    || spec?.population !== item.population || spec?.culture !== item.culture || !expected
    || spec?.position?.x !== expected.x || spec?.position?.y !== expected.y || urban?.architecture !== item.architecture
    || urban?.buildingState?.settings?.parcel_fit !== item.exactInput.parcelFit
    || query.get('fond') !== item.exactInput.background || urban?.render?.palette !== item.exactInput.palette)
    throw new Error(`${item.id}: frozen user URL identity differs from the declared exact case`);
  return { query, identity: { artifact: item.artifact, key: spec.key, culture: spec.culture, population: spec.population,
    position: { x: spec.position.x, y: spec.position.y }, architecture: urban.architecture,
    parcelFit: urban.buildingState.settings.parcel_fit, background: query.get('fond'), palette: urban.render.palette,
    quarterSeed: urban.quarterSeed, parcelSeed: urban.parcelSeed, buildingSeed: urban.buildingState.seed,
    camera: { ...item.camera }, runtimeBinarySha256: null,
    verification: 'requested frozen identity only; observed camera/settings and coordinated runtime binary proof still required' } };
}

const RUNTIME_KEYS = ['profile', 'localServer', 'compute', 'generation', 'neural', 'situation'];
const JSON_KEYS = new Set(['urban', 'settlements', 'roads']);
const STAGING_PATHS = ['/urban/architecture', '/urban/render/view', '/urban/buildingState/generated'];
const pointerKey = value => value.replace(/~/g, '~0').replace(/\//g, '~1');
function differences(a, b, path, result) {
  if (Object.is(a, b)) return;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) { result.push(path); return; }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const child = `${path}/${pointerKey(key)}`;
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) result.push(child);
    else differences(a[key], b[key], child, result);
  }
}
function queryDifferences(a, b) {
  const result = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (RUNTIME_KEYS.includes(key)) continue;
    const before = a.getAll(key), after = b.getAll(key), path = `/${pointerKey(key)}`;
    if (JSON_KEYS.has(key) && before.length === 1 && after.length === 1) differences(JSON.parse(before[0]), JSON.parse(after[0]), path, result);
    else differences(before, after, path, result);
  }
  return result;
}

/** Actual pure preparation used by the runner. The final intended query keeps
 * every original non-runtime parameter, including raw JSON values and unknown
 * options. Only the initial page gets the three explicit transient changes. */
export function prepareExactVisualInput(item, text) {
  const source = exactVisualInput(item, text), original = source.query;
  if (original.getAll('urban').length !== 1) throw new Error(`${item.id}: ambiguous frozen urban query`);
  const intended = new URLSearchParams(original), removedRuntimeKeys = RUNTIME_KEYS.filter(key => intended.has(key));
  for (const key of RUNTIME_KEYS) intended.delete(key);
  const query = new URLSearchParams(intended), urban = JSON.parse(query.get('urban'));
  // Silently dropping saved geometry or edits would falsify the source case.
  if (urban.buildingState?.scene || urban.buildingState?.cold || urban.edits)
    throw new Error(`${item.id}: frozen exact URL contains retained geometry or edits; cannot silently strip it`);
  urban.architecture = item.architecture === 'silhouette' ? 'silhouette' : 'compact';
  urban.render.view = 'parcels'; urban.buildingState.generated = false;
  query.set('urban', JSON.stringify(urban));
  const initialDifferences = queryDifferences(original, query), intendedDifferences = queryDifferences(original, intended);
  if (initialDifferences.some(path => !STAGING_PATHS.includes(path)) || intendedDifferences.length)
    throw new Error(`${item.id}: exact preparation changed a non-staging option`);
  return { query, intendedQuery: intended.toString(), identity: source.identity,
    settings: { settlements: JSON.parse(query.get('settlements')), urban },
    proof: { scope: 'pure source preparation, no observed UI/runtime/capture assertion', removedRuntimeKeys,
      allowedInitialDifferences: [...STAGING_PATHS], initialDifferences, intendedDifferences,
      intendedNonRuntimeEntriesPreserved: JSON.stringify([...intended]) === JSON.stringify([...original].filter(([key]) => !RUNTIME_KEYS.includes(key))),
      runtimeBinarySha256: null } };
}
