/** Worker progress is partial/uncommitted display, never a complete scene.
 * Keep only current-camera real child contours under explicit finite budgets. */
import type { NativeBuildingProjectionScene, NativeBuildingProjection } from './urbanBuildingProjection';
import type { ChunkBounds } from './urbanBuildingChunkStore';
import type { HouseMaterial } from '../../../rust/bridge/housesContract';
export function createColdStreamWindow() {
  let key = '', encoded = 0, vertices = 0;
  const records = new Map<string, { building: NativeBuildingProjection; bytes: number; vertices: number; materials: HouseMaterial[] }>();
  const count = (b: NativeBuildingProjection) => { const seen = new WeakSet<object>(); let n = 0;
    const visit = (v: unknown) => { if (!v || typeof v !== 'object' || seen.has(v)) return; seen.add(v);
      if ('x' in v && 'y' in v) n++; for (const child of Object.values(v)) visit(child); }; visit(b); return n; };
  return {
    append(chunk: NativeBuildingProjectionScene, box: ChunkBounds): NativeBuildingProjectionScene {
      const next = JSON.stringify(box); if (key !== next) { key = next; records.clear(); encoded = vertices = 0; }
      for (const b of chunk.buildings) {
        const points = (b.roof_footprint.length ? b.roof_footprint : b.footprint).flatMap(s => s.outer);
        if (!points.length || Math.min(...points.map(p => p.x)) > box[2] || Math.max(...points.map(p => p.x)) < box[0]
          || Math.min(...points.map(p => p.y)) > box[3] || Math.max(...points.map(p => p.y)) < box[1]) continue;
        const used = new Set(Object.values(b.materials ?? {})), materials = (chunk.materials ?? []).filter(m => used.has(m.id));
        const bytes = new TextEncoder().encode(JSON.stringify({ b, materials })).byteLength, n = count(b), old = records.get(b.id);
        if (old) { records.delete(b.id); encoded -= old.bytes; vertices -= old.vertices; }
        if (bytes > 8 * 1024 * 1024 || n > 200000) continue;
        while (records.size >= 2048 || encoded + bytes > 8 * 1024 * 1024 || vertices + n > 200000) {
          const id = records.keys().next().value!, old = records.get(id)!; encoded -= old.bytes; vertices -= old.vertices; records.delete(id);
        }
        records.set(b.id, { building: b, bytes, vertices: n, materials }); encoded += bytes; vertices += n;
      }
      // Materials derive only from currently retained records; no global catalogue map.
      const buildings = [...records.values()].map(v => v.building), palette = new Map<string, HouseMaterial>();
      for (const record of records.values()) for (const m of record.materials) {
        const old = palette.get(m.id); if (old && JSON.stringify(old) !== JSON.stringify(m)) throw new Error('Conflicting stream material.'); palette.set(m.id, m);
      }
      return { projection: 'native-building-visual-scene-1', buildings, materials: [...palette.values()], refusals: [],
        metrics: { scope: 'provided-records', buildings: buildings.length, refusals: 0, openSpaces: 0, errors: 0,
          usefulAreaM2: buildings.reduce((a, b) => a + b.useful_area_m2, 0), domesticUnits: buildings.reduce((a, b) => a + b.domestic_units, 0) } };
    },
    get stats() { return { records: records.size, encodedBytes: encoded, vertices, complete: false as const }; },
    clear() { records.clear(); encoded = vertices = 0; key = ''; },
  };
}
