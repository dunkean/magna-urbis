/** Retained harbour platforms as low slabs, with timber supports for piers. */
import type { Layout, Quay, Shape } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { CityGlPacker, triangulatePolygons } from './cityGlBuild';

function slab(id: string, shape: Shape, bottom: number, top: number, timber: boolean): ArchitectureVolume {
  const material = timber ? 'city3d:wall:timber' : 'city3d:wall:stone';
  const materials: MaterialSlots = { frame: material, infill: material, coating: material, base: material,
    cladding: timber ? 'city3d:road:timber' : 'city3d:road:bridge', roof_frame: 'city3d:wall:timber' };
  const packer = new CityGlPacker({ x: 0, y: 0 }); packer.add(shape, 0);
  const p = packer.done(), triangles = triangulatePolygons(p).triangles;
  const vertices = Array.from({ length: p.coords.length / 2 }, (_, i) => ({ x: p.coords[i * 2], y: p.coords[i * 2 + 1], z: top }));
  const faces = Array.from({ length: triangles.length / 3 }, (_, i) => ({ vertices: Array.from(triangles.subarray(i * 3, i * 3 + 3)), normal: [0, 0, 1] as [number, number, number], material: materials.cladding, kind: 'slab' as const }));
  const footprint = [shape];
  return { id, footprint, levels: [], z_m: bottom, wall_height_m: top - bottom, roof_height_m: 0,
    roof_system: 'RF-FLAT', roof_pitch_deg: 0, overhang_m: 0, roof_spec: {} as ArchitectureVolume['roof_spec'],
    materials, role: 'main', envelope: 'walled', roof_mesh: { vertices, faces, edges: [], groups: [] },
    foundation: { footprint, z_min_m: bottom, z_max_m: bottom } };
}

export function city3dQuays(layouts: readonly Layout[]): PlacedBuilding[] {
  return layouts.flatMap((layout, li) => (layout.structure?.quays ?? []).map((q: Quay, qi) => {
    const id = `city3d-quay:${li}:${qi}`, timber = q.material === 'timber', top = q.deck_z_m;
    const thickness = timber ? 0.5 : 1.8, volumes = [slab(`${id}:deck`, q.shape, top - thickness, top, timber)];
    if (timber) for (let i = 0; i < q.shape.outer.length; i++) {
      const a = q.shape.outer[i], b = q.shape.outer[(i + 1) % q.shape.outer.length], length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 1; d < length; d += 8) {
        const x = a.x + (b.x - a.x) * d / length, y = a.y + (b.y - a.y) * d / length, r = 0.22;
        volumes.push(slab(`${id}:post:${i}:${d}`, { outer: [{ x: x-r, y: y-r }, { x: x+r, y: y-r }, { x: x+r, y: y+r }, { x: x-r, y: y+r }], holes: [] }, top - 3.5, top - 0.7, true));
      }
    }
    const origin = q.shape.outer[0], footprint = [q.shape];
    return { id, parcel_id: '', function: 'open_space', culture: { culture: layout.culture, pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
      recipe_id: 'city3d-quay', variant_id: q.kind, transform: { origin, orientation_deg: 0 }, ground_z_m: top - thickness,
      footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: origin, access_id: '', volumes,
      useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null } as PlacedBuilding;
  }));
}
