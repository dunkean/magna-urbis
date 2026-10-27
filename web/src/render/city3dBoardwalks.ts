/** Narrow timber decks and posts, one mesh per walk, no filled quarter platform. */
import type { Street, Shape, Point } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { boardwalkWidth, isBoardwalk } from './cityGround';
import type { City3dHeight } from './city3dMeshes';

export function city3dBoardwalks(streets: readonly Street[], heightAt?: City3dHeight, waterAt?: City3dHeight): PlacedBuilding[] {
  return streets.flatMap((street, si) => {
    if (!isBoardwalk(street.role) || street.path.length < 2) return [];
    const id = `city3d-boardwalk:${si}`, mesh: ArchitectureVolume['roof_mesh'] = { vertices: [], faces: [], edges: [], groups: [] }, footprint: Shape[] = [];
    const timber = 'city3d:wall:timber', materials: MaterialSlots = { frame: timber, infill: timber, coating: timber, base: timber, cladding: 'city3d:road:bridge_timber', roof_frame: timber };
    let low = Infinity, high = -Infinity;
    const box = (ring: Point[], bottom: number, top: number, cover = timber): void => {
      const base = mesh.vertices.length;
      mesh.vertices.push(...ring.map(p => ({ ...p, z: bottom })), ...ring.map(p => ({ ...p, z: top })));
      const face = (vertices: number[], normal: [number, number, number], material = timber): void => { mesh.faces.push({ vertices: vertices.map(i => i + base), normal, material, kind: 'slab' }); };
      face([4, 5, 6, 7], [0, 0, 1], cover); face([3, 2, 1, 0], [0, 0, -1]);
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, dx = ring[j].x - ring[i].x, dy = ring[j].y - ring[i].y, l = Math.hypot(dx, dy); face([i, j, j + 4, i + 4], [dy / l, -dx / l, 0]); }
      low = Math.min(low, bottom); high = Math.max(high, top);
    };
    const level = (p: Point): number => {
      const z = waterAt?.(p.x, p.y); return Number.isFinite(z) ? z! : heightAt?.(p.x, p.y) || 0;
    };
    for (let i = 1; i < street.path.length; i++) {
      const a = street.path[i - 1], b = street.path[i], len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 0.1) continue;
      const width = boardwalkWidth(street.widths[i - 1] ?? street.widths[0] ?? 2), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, top = Math.max(level(a), level(mid), level(b)) + 1.3;
      const nx = -uy * width / 2, ny = ux * width / 2;
      const ring = [{ x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny }];
      footprint.push({ outer: ring, holes: [] }); box(ring, top - 0.22, top, materials.cladding);
      const count = Math.max(1, Math.ceil(len / 6));
      for (let k = 0; k <= count; k++) for (const side of [-1, 1]) {
        const x = a.x + ux * len * k / count + nx * side * 0.82, y = a.y + uy * len * k / count + ny * side * 0.82;
        const bed = heightAt?.(x, y), bottom = Math.min(Number.isFinite(bed) ? bed! - 0.25 : top - 3, top - 2.5), r = 0.14;
        box([{ x: x-r, y: y-r }, { x: x+r, y: y-r }, { x: x+r, y: y+r }, { x: x-r, y: y+r }], bottom, top + 0.25);
      }
    }
    if (!footprint.length) return [];
    const volume: ArchitectureVolume = { id, footprint, levels: [], z_m: low, wall_height_m: high - low, roof_height_m: 0,
      roof_system: 'RF-FLAT', roof_pitch_deg: 0, overhang_m: 0, roof_spec: {} as ArchitectureVolume['roof_spec'], materials, role: 'main', envelope: 'open', roof_mesh: mesh,
      foundation: { footprint: [], z_min_m: low, z_max_m: low } };
    const origin = street.path[0];
    return [{ id, parcel_id: '', function: 'open_space', culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
      recipe_id: 'city3d-boardwalk', variant_id: street.role, transform: { origin, orientation_deg: 0 }, ground_z_m: low, footprint, roof_footprint: footprint,
      courtyards: [], circulation: [], entrance: origin, access_id: '', volumes: [volume], useful_area_m2: 0, domestic_units: 0,
      structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null } as PlacedBuilding];
  });
}
