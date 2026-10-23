/** Streaming benchmark evidence. Self-contained so the same factory can run in
 * a page init script and in offline tests. Retains scalars/counts, never scenes,
 * plans, request geometry, archives or native source handles. */
export function createArchitectureBenchEvidence({ witnessLimit = 3 } = {}) {
  if (!Number.isSafeInteger(witnessLimit) || witnessLimit < 0 || witnessLimit > 20) throw new Error('Invalid witness limit');
  const dict = () => Object.create(null);
  const add = (map, key) => { key = typeof key === 'string' && key ? key : 'unknown'; map[key] = (map[key] ?? 0) + 1; };
  const histogram = () => ({ count: 0, byCode: dict(), byRecipe: dict(), byFunction: dict(), byReason: dict() });
  const refusals = histogram(), details = histogram();
  const accepted = { count: 0, bodies: 0, levels: 0, byRecipe: dict(), byFunction: dict(), byRecipeFunction: dict() };
  const areaNames = ['buildingFootprintM2', 'bodyFootprintM2', 'levelFootprintM2', 'buildingFloorFootprintsM2',
    'nativeUsefulAreaM2', 'requestCadastralM2', 'acceptedCadastralM2', 'refusedCadastralM2'];
  const areas = Object.fromEntries(areaNames.map(name => [name, { values: [], missing: 0, sum: 0 }]));
  // A second, explicitly scoped metric. These are level footprints, never
  // inhabited area or people. Programme emprise × preferred floors is only a
  // derived reference interval, not a native demand for floor area.
  const structuralFloorProgramme = { version: 1, scope: ['domestic', 'mixed'], sites: 0,
    accepted: 0, refused: 0, open: 0, unresolved: 0, outcomesWithoutFunction: 0,
    admittedFloorM2: { sum: 0, knownPlans: 0, unknownPlans: 0 },
    reference: { knownSites: 0, unknownSites: 0, footprintTargetM2: 0, floorM2: [0, 0] },
    comparable: { sites: 0, admittedFloorM2: 0, referenceFloorM2: [0, 0],
      accepted: 0, refused: 0, open: 0, unresolved: 0, unknownAcceptedGeometry: 0 } };
  const residential = fn => fn === 'domestic' || fn === 'mixed';
  function programmeReference(site) {
    const target = site?.programme?.built_area_m2, floors = site?.programme?.floors;
    if (!Number.isFinite(target) || target <= 0 || !Array.isArray(floors) || floors.length !== 2
      || floors.some(n => !Number.isSafeInteger(n) || n < 1) || floors[0] > floors[1]) return null;
    const range = floors.map(n => n * target);
    return range.every(Number.isFinite) ? { target, range } : null;
  }
  const seen = new Set();
  let batches = 0, openSpaces = 0, ignoredDuplicateBatches = 0, ignoredPreviewBatches = 0, missingBodyLists = 0, missingLevelLists = 0;
  let cache;
  const measure = (name, value) => {
    const stats = areas[name];
    if (!Number.isFinite(value) || value < 0) stats.missing++;
    else { stats.values.push(value); stats.sum += value; }
  };
  function ringArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
    const origin = ring[0]; let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      twice += (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y);
    }
    return Math.abs(twice) / 2;
  }
  function surfaceArea(surface) {
    if (!Array.isArray(surface)) return null;
    let total = 0;
    for (const polygon of surface) {
      let area = ringArea(polygon?.outer);
      if (area === null || (polygon.holes !== undefined && !Array.isArray(polygon.holes))) return null;
      for (const hole of polygon.holes ?? []) { const value = ringArea(hole); if (value === null) return null; area -= value; }
      if (area < -1e-7) return null;
      total += Math.max(0, area);
    }
    return Number.isFinite(total) ? total : null;
  }
  function refusal(target, item, context = {}) {
    const code = String(item.code ?? 'unknown'), message = String(item.message ?? 'unknown');
    const recipe = item.recipe_id ?? context.recipe_id ?? context.config?.recipe ?? 'unknown';
    const fn = item.function ?? context.function ?? 'unknown';
    target.count++; add(target.byCode, code); add(target.byRecipe, recipe); add(target.byFunction, fn);
    // Exact messages are kept for EVERY reason; only witness IDs are bounded.
    const key = JSON.stringify([code, message]);
    const reason = target.byReason[key] ??= { code, message, count: 0, byRecipe: dict(), byFunction: dict(), witnesses: [] };
    reason.count++; add(reason.byRecipe, recipe); add(reason.byFunction, fn);
    const id = item.id ?? context.id, parcelId = item.parcel_id ?? context.parcel_id;
    if (id && reason.witnesses.length < witnessLimit && !reason.witnesses.some(w => w.id === id)) {
      reason.witnesses.push({ id, ...(parcelId ? { parcelId } : {}), recipe, function: fn });
    }
    cache = undefined;
  }
  function consumeMessage(data) {
    const scene = data?.batch?.delta ?? data?.scene;
    if (!scene) return false;
    if (scene.generator_version === 'silhouette') { ignoredPreviewBatches++; cache = undefined; return false; }
    const progress = data.batch?.progress;
    const key = JSON.stringify([data.id ?? null, progress?.start ?? 'scene', progress?.completed ?? 'scene']);
    if (seen.has(key) || (!data.batch && seen.has(JSON.stringify([data.id ?? null, 'stream'])))) {
      ignoredDuplicateBatches++; cache = undefined; return false;
    }
    seen.add(key); if (data.batch) seen.add(JSON.stringify([data.id ?? null, 'stream']));
    // New servers send lightweight sites instead of full requests. Their preview
    // surface is NEVER treated as cadastral land, and auto recipes stay unknown.
    const sites = new Map([...(data.batch?.sites ?? []), ...(data.batch?.requests ?? [])].map(site => [site.id, site]));
    for (const site of sites.values()) measure('requestCadastralM2', surfaceArea(site.cadastral));
    const outcomes = new Map(), floorAreas = new Map();
    for (const building of scene.buildings ?? []) outcomes.set(building.id, 'accepted');
    for (const item of scene.refusals ?? []) outcomes.set(item.id, 'refused');
    for (const item of scene.open_spaces ?? []) outcomes.set(item.id, 'open');
    batches++; openSpaces += scene.open_spaces?.length ?? 0;
    for (const building of scene.buildings ?? []) {
      accepted.count++; add(accepted.byRecipe, building.recipe_id); add(accepted.byFunction, building.function);
      add(accepted.byRecipeFunction, JSON.stringify([building.recipe_id ?? 'unknown', building.function ?? 'unknown']));
      measure('buildingFootprintM2', surfaceArea(building.footprint));
      measure('nativeUsefulAreaM2', building.useful_area_m2);
      measure('acceptedCadastralM2', surfaceArea(sites.get(building.id)?.cadastral));
      let floorTotal = 0, floorsKnown = Array.isArray(building.volumes) && building.volumes.length > 0;
      if (!floorsKnown) missingBodyLists++;
      for (const body of building.volumes ?? []) {
        accepted.bodies++; measure('bodyFootprintM2', surfaceArea(body.footprint));
        if (!Array.isArray(body.levels) || !body.levels.length) { floorsKnown = false; missingLevelLists++; }
        for (const level of body.levels ?? []) {
          accepted.levels++; const area = surfaceArea(level.footprint); measure('levelFootprintM2', area);
          if (area === null) floorsKnown = false; else floorTotal += area;
        }
      }
      measure('buildingFloorFootprintsM2', floorsKnown ? floorTotal : null);
      floorsKnown &&= Number.isFinite(floorTotal);
      floorAreas.set(building.id, floorsKnown ? floorTotal : null);
      const fn = building.function ?? sites.get(building.id)?.function;
      if (residential(fn)) {
        structuralFloorProgramme.accepted++;
        if (floorsKnown) { structuralFloorProgramme.admittedFloorM2.knownPlans++; structuralFloorProgramme.admittedFloorM2.sum += floorTotal; }
        else structuralFloorProgramme.admittedFloorM2.unknownPlans++;
      } else if (!fn) structuralFloorProgramme.outcomesWithoutFunction++;
    }
    for (const item of scene.refusals ?? []) {
      const site = sites.get(item.id); refusal(refusals, item, site);
      measure('refusedCadastralM2', surfaceArea(site?.cadastral));
      const fn = item.function ?? site?.function;
      if (residential(fn)) structuralFloorProgramme.refused++; // Known zero admitted area, not missing geometry.
      else if (!fn) structuralFloorProgramme.outcomesWithoutFunction++;
    }
    for (const item of scene.open_spaces ?? []) {
      const fn = item.function ?? sites.get(item.id)?.function;
      if (residential(fn)) structuralFloorProgramme.open++;
      else if (!fn) structuralFloorProgramme.outcomesWithoutFunction++;
    }
    for (const site of sites.values()) {
      if (!residential(site.function)) continue;
      structuralFloorProgramme.sites++;
      const outcome = outcomes.get(site.id) ?? 'unresolved', reference = programmeReference(site);
      if (outcome === 'unresolved') structuralFloorProgramme.unresolved++;
      if (!reference) { structuralFloorProgramme.reference.unknownSites++; continue; }
      const r = structuralFloorProgramme.reference, c = structuralFloorProgramme.comparable;
      r.knownSites++; r.footprintTargetM2 += reference.target;
      c.sites++; c[outcome]++;
      for (let i = 0; i < 2; i++) { r.floorM2[i] += reference.range[i]; c.referenceFloorM2[i] += reference.range[i]; }
      if (outcome === 'accepted') {
        const area = floorAreas.get(site.id);
        if (area == null) c.unknownAcceptedGeometry++;
        else c.admittedFloorM2 += area;
      }
      // Refused/open outcomes contribute exactly zero. Unresolved outcomes and
      // accepted plans without levels remain counted as unknown, not zeroed.
    }
    cache = undefined; return true;
  }
  function snapshot() {
    if (cache) return cache;
    const summaries = Object.fromEntries(Object.entries(areas).map(([name, stats]) => {
      const values = [...stats.values].sort((a, b) => a - b), n = values.length;
      const quantile = p => { if (!n) return null; const at = (n - 1) * p, low = Math.floor(at); return values[low] + (values[Math.ceil(at)] - values[low]) * (at - low); };
      return [name, { count: n, missing: stats.missing, sum: n ? stats.sum : null, min: n ? values[0] : null,
        p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), max: n ? values[n - 1] : null }];
    }));
    cache = { version: 1, batches, accepted, planRefusals: refusals, detailRefusals: details, openSpaces,
      ignoredDuplicateBatches, ignoredPreviewBatches, missingBodyLists, missingLevelLists, areas: summaries,
      witnessLimitPerReason: witnessLimit, capacityPersons: null,
      structuralFloorProgramme,
      semantics: {
        source: 'Existing native batch deltas only; scalar samples and histograms retained, no second scene or native request.',
        refusals: 'All exact code/message groups; recipe from refusal or explicitly requested recipe, unknown when auto-selected; functions from original requests or site projections.',
        areas: 'Square metres, outer rings minus holes. Building footprint excludes roof overhangs; body and level sums do not union overlaps. Level footprints are geometric floor areas, not net habitable area.',
        lots: 'Cadastral areas only when full native requests were present; projected/preview site surfaces and programme target areas never substitute.',
        nativeUsefulAreaM2: 'Native reported useful_area_m2, kept separate from measured level footprints; does not certify residential use or occupancy.',
        structuralFloorProgramme: 'Domestic and mixed requests only; mixed buildings include all uses. Sum of actual body-level footprints, outer minus holes, without union of overlapping bodies and without net/habitable-area inference. Refusals/open outcomes contribute zero admitted area; absent outcomes and absent level geometry are counted separately. Programme reference is footprint target × preferred main-body floor range, not an exact floor-area demand; towers, annexes and user overrides may differ. Comparable totals use only sites with this complete reference; known admitted sum is partial while unknownAcceptedGeometry/unresolved is nonzero. No ratios or inhabitants are inferred.',
        quantiles: 'Exact linear interpolation at (count-1)*p over observed scalar values; missing geometry is not imputed.',
        details: 'HTTP/native refusal evidence supplied separately; never added to plan refusals or accepted-plan areas.',
      } };
    return cache;
  }
  return { consumeMessage, recordDetailRefusal: (item, context) => refusal(details, item, context), snapshot };
}

/** Read only error bodies; successful exterior meshes are never duplicated.
 * Called from existing response observers, and makes no network request. */
export async function recordDetailHttpFailure(response, evidence, context = {}) {
  if (response.status() < 400) return;
  try {
    const building = response.request().postDataJSON()?.building;
    context = { id: building?.id, parcel_id: building?.parcel_id, recipe_id: building?.recipe_id, function: building?.function, ...context };
  } catch { /* Refusal remains counted when request metadata is unavailable. */ }
  let body;
  try { body = await response.json(); } catch { /* HTTP status remains evidence. */ }
  const error = body?.error;
  evidence.recordDetailRefusal({ code: error?.code ?? `http_${response.status()}`,
    message: typeof error === 'string' ? error : error?.message ?? body?.message ?? response.statusText() }, context);
}
