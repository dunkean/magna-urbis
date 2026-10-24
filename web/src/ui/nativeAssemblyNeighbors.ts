/** Exact retained neighbours for the bounded selected-parent assembly experiment.
 * Parts stay separate until native geometry unions them; no JS hull/clip/union. */
import type { PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { Surface } from '../../../rust/bridge/housesContract';
export type AssemblyBounds = readonly [number, number, number, number];
function intersects(surface: Surface, box: AssemblyBounds): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const shape of surface) for (const ring of [shape.outer, ...shape.holes]) for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Voisinage natif non fini.');
    x0 = Math.min(x0, point.x); y0 = Math.min(y0, point.y); x1 = Math.max(x1, point.x); y1 = Math.max(y1, point.y);
  }
  return x0 <= box[2] && x1 >= box[0] && y0 <= box[3] && y1 >= box[1];
}
export function assemblyNeighborParts(buildings: readonly PlacedBuilding[], parentId: string, box: AssemblyBounds,
  limits = { scanned: 10000, matched: 512 }): { occupied_parts: Surface[]; occupied_roof_parts: Surface[]; neighbors: number } {
  if (box.length !== 4 || !box.every(Number.isFinite) || box[0] > box[2] || box[1] > box[3]
    || ![limits.scanned, limits.matched].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Bornes de voisinage invalides.');
  if (buildings.length > limits.scanned) throw new Error('La scène dépasse le budget de lecture des vrais voisins natifs.');
  const occupied_parts: Surface[] = [], occupied_roof_parts: Surface[] = [], seen = new Set<string>(); let matched = 0;
  for (const building of buildings) {
    if (seen.has(building.id)) throw new Error('Identité de voisin natif dupliquée.'); seen.add(building.id);
    if (building.id === parentId) continue;
    if (building.simplification !== 'architectural_plan') throw new Error('Un aperçu ne peut pas servir de voisin natif.');
    const parts = [building.footprint, building.courtyards, building.circulation, ...building.structural_features.map(f => f.surface)];
    if (!parts.some(part => intersects(part, box)) && !intersects(building.roof_footprint, box)) continue;
    if (++matched > limits.matched) throw new Error('Le voisinage natif dépasse le budget ; aucun voisin ne sera omis.');
    for (const part of parts) if (part.length) occupied_parts.push(part);
    if (building.roof_footprint.length) occupied_roof_parts.push(building.roof_footprint);
  }
  return { occupied_parts, occupied_roof_parts, neighbors: matched };
}

/** Native-only bounded reader. Never opens the legacy cold session, derivative
 * repair, global overview or projection accumulator, even on cache miss. */
export async function readBoundedAssemblyNeighbors(
  backend: import('./urbanBuildingChunkStore').BuildingChunkBackend,
  state: Pick<import('./urbanBuildingsPanel').UrbanColdBuildingState, 'store' | 'counts' | 'offset'>,
  box: AssemblyBounds,
): Promise<PlacedBuilding[]> {
  if ((state.offset?.x ?? 0) !== 0 || (state.offset?.y ?? 0) !== 0) throw new Error('Coordonnées natives translatées non prises en charge.');
  const { openUrbanBuildingChunks } = await import('./urbanBuildingChunkStore');
  const reader = await openUrbanBuildingChunks(backend, state.store.sceneId, { maxCachedChunks: 1, maxCacheBytes: 8 * 1024 * 1024 });
  try {
    const m = reader.manifest, c = state.counts;
    if (m.format !== state.store.format || m.sceneId !== state.store.sceneId || m.fingerprint !== state.store.fingerprint
      || m.sourceFingerprint !== state.store.sourceFingerprint || m.schema_version !== c.schema_version
      || m.generator_version !== c.generator_version || m.buildings !== c.buildings || m.refusals !== c.refusals || m.openSpaces !== c.open_spaces)
      throw new Error('La révision native de la scène sélectionnée a changé.');
    const nearby = await reader.readVisible([...box], { maxTiles: 256, maxCandidates: 2048, maxBuildings: 512,
      maxChunks: 16, maxBytes: 16 * 1024 * 1024 });
    if (nearby.truncated) throw new Error('Voisinage natif incomplet dans le budget ; aucun voisin ne sera omis.');
    return nearby.buildings.map(value => value.building);
  } finally { reader.clearCache(); }
}
