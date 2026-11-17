/** Retained harbour platforms and furniture as prisms: quay walls down into the water, decks on piles, boats, masts, cranes
 * and sheds. Materials and water-relative furniture heights come from harbourStyle.ts,
 * shared with the 2D plan; bank decks meet the displayed 3D terrain. */
import type { Layout, Point, Quay, Shape } from '../../../rust/bridge/urban';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import { CityGlPacker, triangulatePolygons } from './cityGlBuild';
import type { City3dHeight } from './city3dMeshes';
import { harbourPlatform, harbourPrism } from './harbourStyle';

/** Weathered timber of piles and posts (final sRGB): a lit deck never reads white from above. */
const PILE_TINT = '6b5640';
/** Farthest the 3D quay wall is carried past the drawn waterline (m). */
const APRON_REACH = 15;

/** The paving between a stone quay wall and the 3D water. The plan's waterline (the drawn shore) and the 3D terrain's own
 * waterline differ by a beach band: the 3D ground can still stand above the water a few metres past the drawn shore. The
 * coping strip (`kerb`, four corners, its long sides along the water) is carried towards the water, side by side, until
 * the terrain under its far edge is at or below the water level, so the wall stands in the water and no beach shows in
 * front of it. Null when the wall already stands in the water or no terrain is given. */
export function kerbApron(kerb: Shape, water: number, heightAt?: City3dHeight): Shape | null {
  const ring = kerb.outer;
  if (!heightAt || ring.length !== 4) return null;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // The long side on lower ground faces the water; the outward normal points from the other long side to it.
  const sides: [number, number][] = [[0, 1], [2, 3]];
  const [near, far] = sides.map(([i, j]) => ({ a: ring[i], b: ring[j], m: mid(ring[i], ring[j]) }))
    .sort((u, v) => heightAt(u.m.x, u.m.y) - heightAt(v.m.x, v.m.y));
  const dx = near.m.x - far.m.x, dy = near.m.y - far.m.y, length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const n = { x: dx / length, y: dy / length };
  const out = (p: { x: number; y: number }, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });
  const dry = (d: number) => [near.a, near.b, near.m].some(p => { const q = out(p, d); return heightAt(q.x, q.y) > water + 0.05; });
  if (!dry(0)) return null;
  let d = 0.5;
  while (d < APRON_REACH && dry(d)) d += 0.5;
  // Corners in ring order: the water side, then its offset.
  return { outer: [near.a, near.b, out(near.b, d), out(near.a, d)], holes: [] };
}
/** `tint` colours the top face, `side` the walls (the top tint when absent). */
function slab(id: string, shape: Shape, bottom: number, top: number, timber: boolean, tint = '', side = tint): ArchitectureVolume {
  const at = (material: string): string => tint ? `${material}@${tint}` : material;
  const material = side ? `${timber ? 'city3d:wall:timber' : 'city3d:wall:stone'}@${side}` : timber ? 'city3d:wall:timber' : 'city3d:wall:stone';
  const materials: MaterialSlots = { frame: material, infill: material, coating: material, base: material,
    cladding: at(timber ? 'city3d:road:timber' : 'city3d:road:quay'), roof_frame: 'city3d:wall:timber' };
  const packer = new CityGlPacker({ x: 0, y: 0 }); packer.add(shape, 0);
  const p = packer.done(), triangles = triangulatePolygons(p).triangles;
  const vertices = Array.from({ length: p.coords.length / 2 }, (_, i) => ({ x: p.coords[i * 2], y: p.coords[i * 2 + 1], z: top }));
  const faces = Array.from({ length: triangles.length / 3 }, (_, i) => ({ vertices: Array.from(triangles.subarray(i * 3, i * 3 + 3)), normal: [0, 0, 1] as [number, number, number], material: materials.cladding, kind: 'slab' as const }));
  const footprint = [shape];
  // The sides come from the levels (urbanBuildingGeometry `eachBuildingTriangle`): without one the prism is only its top face.
  return { id, footprint, levels: [{ index: 0, footprint, z_m: bottom, height_m: top - bottom }], z_m: bottom, wall_height_m: top - bottom, roof_height_m: 0,
    roof_system: 'RF-FLAT', roof_pitch_deg: 0, overhang_m: 0, roof_spec: {} as ArchitectureVolume['roof_spec'],
    materials, role: 'main', envelope: 'walled', roof_mesh: { vertices, faces, edges: [], groups: [] },
    foundation: { footprint, z_min_m: bottom, z_max_m: bottom } };
}

/** A gabled roof over a four-cornered footprint: the ridge runs along the long axis, `rise` above the eaves at `top`. */
function gable(volume: ArchitectureVolume, shape: Shape, top: number, rise: number): void {
  const [a, b, c, d] = shape.outer, long = Math.hypot(b.x - a.x, b.y - a.y) >= Math.hypot(c.x - b.x, c.y - b.y);
  // Corners in order p0..p3 with p0→p1 a long side; the ridge joins the middles of the two short sides.
  const p = long ? [a, b, c, d] : [b, c, d, a], mid = (u: typeof a, v: typeof a) => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2, z: top + rise });
  const vertices = [...p.map(q => ({ x: q.x, y: q.y, z: top })), mid(p[1], p[2]), mid(p[3], p[0])], material = volume.materials.cladding;
  const centre = { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 };
  const face = (i: number, j: number, k: number) => {
    const u = vertices[i], v = vertices[j], w = vertices[k];
    let n: [number, number, number] = [(v.y - u.y) * (w.z - u.z) - (v.z - u.z) * (w.y - u.y), (v.z - u.z) * (w.x - u.x) - (v.x - u.x) * (w.z - u.z), (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x)];
    const length = Math.hypot(...n) || 1; n = [n[0] / length, n[1] / length, n[2] / length];
    // Pans look up, gable ends look away from the centre.
    const out = Math.abs(n[2]) > 1e-6 ? n[2] : n[0] * ((u.x + v.x + w.x) / 3 - centre.x) + n[1] * ((u.y + v.y + w.y) / 3 - centre.y);
    return out >= 0 ? { vertices: [i, j, k], normal: n, material, kind: 'slab' as const } : { vertices: [i, k, j], normal: [-n[0], -n[1], -n[2]] as [number, number, number], material, kind: 'slab' as const };
  };
  volume.roof_mesh = { vertices, faces: [face(0, 1, 4), face(0, 4, 5), face(2, 3, 5), face(2, 5, 4), face(1, 2, 4), face(3, 0, 5)], edges: [], groups: [] };
  volume.roof_height_m = rise;
}

/** A bank band has two matching chains, joined at their ends (harbour_furniture::quay_band).
 * Keep the land edge on the displayed terrain, with a gently smoothed walking surface
 * across the width. Explicit wall vertices reach below both water and ground without
 * turning the land side into a raised prism or changing the band's plan footprint. */
function bankDeck(volume: ArchitectureVolume, shape: Shape, engineDeck: number, heightAt: City3dHeight, waterAt?: City3dHeight): void {
  const ring = shape.outer, half = ring.length / 2;
  if (shape.holes.length || !Number.isInteger(half) || half < 2) return;
  const chains = [ring.slice(0, half), ring.slice(half).reverse()];
  const mean = (chain: Point[]) => chain.reduce((sum, p) => sum + heightAt(p.x, p.y), 0) / chain.length;
  const [land, wet] = mean(chains[0]) >= mean(chains[1]) ? chains : [chains[1], chains[0]];
  const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const stations: { land: Point; wet: Point; bank: number; water: number }[] = [];
  for (let i = 0; i < half - 1; i++) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(land[i+1].x-land[i].x, land[i+1].y-land[i].y), Math.hypot(wet[i+1].x-wet[i].x, wet[i+1].y-wet[i].y)) / 2));
    for (let k = i ? 1 : 0; k <= steps; k++) {
      const a = lerp(land[i], land[i+1], k / steps), b = lerp(wet[i], wet[i+1], k / steps), water = waterAt?.(b.x, b.y);
      stations.push({ land: a, wet: b, bank: heightAt(a.x, a.y), water: Number.isFinite(water) ? water! : engineDeck - 1 });
    }
  }
  const vertices: ArchitectureVolume['roof_mesh']['vertices'] = [], faces: ArchitectureVolume['roof_mesh']['faces'] = [];
  const add = (a: number, b: number, c: number, material: string) => {
    const p = vertices[a], q = vertices[b], r = vertices[c];
    const n: [number, number, number] = [(q.y-p.y)*(r.z-p.z)-(q.z-p.z)*(r.y-p.y), (q.z-p.z)*(r.x-p.x)-(q.x-p.x)*(r.z-p.z), (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)];
    const length = Math.hypot(...n) || 1;
    faces.push({ vertices: [a, b, c], normal: n.map(v => v / length) as [number, number, number], material, kind: 'slab' });
  };
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    // Smooth in metres, independent of the engine's river-piece tessellation.
    const smooth = [-2, -1, 0, 1, 2].reduce((sum, d) => sum + stations[Math.max(0, Math.min(stations.length-1, i+d))].bank, 0) / 5;
    const top = Math.max(s.water + .4, Math.min(s.bank + .25, Math.max(s.bank - .15, smooth + .02)));
    vertices.push({ ...s.land, z: s.bank + .02 }, { ...s.wet, z: top },
      { ...s.wet, z: Math.min(s.water, heightAt(s.wet.x, s.wet.y)) - .1 }, { ...s.land, z: s.bank - .1 });
    if (!i) continue;
    const a = (i-1)*4, b = i*4;
    // Orient every cross-section consistently, whichever chain faces the water.
    const p = vertices[a], q = vertices[a+1], r = vertices[b];
    const up = (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x) > 0;
    const quad = (j: number, k: number, l: number, m: number, material: string) => {
      if (up) { add(j, k, l, material); add(j, l, m, material); }
      else { add(j, l, k, material); add(j, m, l, material); }
    };
    quad(a, a+1, b+1, b, volume.materials.cladding);
    quad(a+1, a+2, b+2, b+1, volume.materials.base);
    quad(a+3, a, b, b+3, volume.materials.base);
    if (i === 1) quad(a+3, a+2, a+1, a, volume.materials.base);
    if (i === stations.length-1) quad(b, b+1, b+2, b+3, volume.materials.base);
  }
  const low = Math.min(...vertices.map(p => p.z)), high = Math.max(...vertices.map(p => p.z));
  // Mesh-only volume: the generic prism and overview cap would restore a flat wall.
  volume.footprint = []; volume.levels = []; volume.foundation = { footprint: [], z_min_m: low, z_max_m: low };
  volume.z_m = low; volume.wall_height_m = high-low;
  volume.roof_mesh = { vertices, faces, edges: [], groups: [] };
  (volume as ArchitectureVolume & { overview_faces: [number, number] }).overview_faces = [0, faces.length];
}

/** Each platform of the harbour planner is one 3D structure; the furniture of a layout is grouped by 48 items. */
const GROUP = 48;
export function city3dQuays(layouts: readonly Layout[], heightAt?: City3dHeight, waterAt?: City3dHeight): PlacedBuilding[] {
  const structure = (id: string, kind: string, culture: string, shapes: Shape[], volumes: ArchitectureVolume[], ground: number): PlacedBuilding => {
    const origin = shapes[0].outer[0];
    return { id, parcel_id: '', function: 'open_space', culture: { culture, pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
      recipe_id: 'city3d-quay', variant_id: kind, transform: { origin, orientation_deg: 0 }, ground_z_m: ground,
      footprint: shapes, roof_footprint: shapes, courtyards: [], circulation: [], entrance: origin, access_id: '', volumes,
      useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null } as PlacedBuilding;
  };
  return layouts.flatMap((layout, li) => {
    const out: PlacedBuilding[] = [], furniture: { shape: Shape; volumes: ArchitectureVolume[]; ground: number }[] = [];
    (layout.structure?.quays ?? []).forEach((q: Quay, qi) => {
      const prism = harbourPrism(q.kind, q.material, q.deck_z_m); if (!prism || q.shape.outer.length < 3) return;
      // Timber piers/pontoons stay close to the displayed water, independently of bank decks.
      if (waterAt && prism.timber && ['pier', 'landing', 'pontoon', 'raft'].includes(q.kind)) {
        const levels = q.shape.outer.map(p => waterAt(p.x, p.y)).filter(Number.isFinite);
        if (levels.length) { const water = levels.reduce((sum, z) => sum+z, 0) / levels.length; prism.top = water + .4; prism.bottom = prism.top - .2; }
      }
      const id = `city3d-quay:${li}:${qi}`, deck = slab(`${id}:deck`, q.shape, prism.bottom, prism.top, prism.timber, prism.tint, prism.side ?? prism.tint), volumes = [deck];
      if (q.kind === 'quay' && heightAt) bankDeck(deck, q.shape, q.deck_z_m, heightAt, waterAt);
      if (prism.ridge && q.shape.outer.length === 4 && !q.shape.holes.length) gable(deck, q.shape, prism.top, prism.ridge);
      if (prism.piles) {
        const ring = q.shape.outer, perimeter = ring.reduce((sum, a, i) => sum + Math.hypot(ring[(i + 1) % ring.length].x - a.x, ring[(i + 1) % ring.length].y - a.y), 0), step = Math.max(8, perimeter / 12);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length], length = Math.hypot(b.x - a.x, b.y - a.y);
          for (let d = 1; d < length; d += step) {
            const x = a.x + (b.x - a.x) * d / length, y = a.y + (b.y - a.y) * d / length, r = 0.22;
            volumes.push(slab(`${id}:post:${i}:${d}`, { outer: [{ x: x-r, y: y-r }, { x: x+r, y: y-r }, { x: x+r, y: y+r }, { x: x-r, y: y+r }], holes: [] }, prism.top - 3.5, prism.bottom - 0.2, true, PILE_TINT));
          }
        }
      }
      if (harbourPlatform(q.kind)) out.push(structure(id, q.kind, layout.culture, [q.shape], volumes, prism.bottom));
      else furniture.push({ shape: q.shape, volumes, ground: prism.bottom });
      // A stone quay wall stands in the 3D water: its paving is carried over the beach band in front of it.
      const apron = q.kind === 'kerb' && !prism.timber ? kerbApron(q.shape, q.deck_z_m - 1, heightAt) : null;
      if (apron) {
        const paving = harbourPrism('quay', 'stone', q.deck_z_m)!;
        furniture.push({ shape: apron, volumes: [slab(`${id}:apron`, apron, paving.bottom, paving.top, false, paving.tint, paving.side ?? paving.tint)], ground: paving.bottom });
      }
    });
    for (let i = 0; i < furniture.length; i += GROUP) {
      const group = furniture.slice(i, i + GROUP);
      out.push(structure(`city3d-harbour:${li}:${i / GROUP}`, 'furniture', layout.culture, group.map(f => f.shape), group.flatMap(f => f.volumes), Math.min(...group.map(f => f.ground))));
    }
    return out;
  });
}

/** Lagoon channels are water surfaces above the bed, with small dry crossings. */
export function city3dWaterways(layouts: readonly Layout[], color = '#8aaeb8', waterSurfaces = true): PlacedBuilding[] {
  return layouts.flatMap((layout, li) => (layout.structure?.waterways ?? []).flatMap((w, wi) => [
    ...(waterSurfaces ? [{ shape: w.shape, water: true }] : []), ...[...w.crossings, ...(w.locks ?? [])].map(shape => ({ shape, water: false })),
  ].map(({ shape, water }, si) => {
    // The 3D ground is not dug: canal water lies just above the lowest bank of its piece, decks above it.
    const id = `city3d-canal:${li}:${wi}:${si}`, top = (w.bankM !== undefined ? w.bankM + .04 : w.levelM) + (water ? 0 : 0.25), v = slab(id, shape, top - 0.03, top, false);
    if (water) { v.materials.cladding = `city3d:water@${color.replace('#', '')}`; for (const f of v.roof_mesh.faces) f.material = v.materials.cladding; }
    const footprint = [shape], origin = shape.outer[0];
    return { id, parcel_id: '', function: 'open_space', culture: { culture: layout.culture, pack: '', mode: 'inspired', borrowing: null },
      recipe_id: 'city3d-canal', variant_id: water ? 'water' : 'crossing', transform: { origin, orientation_deg: 0 }, ground_z_m: top,
      footprint, roof_footprint: footprint, courtyards: [], circulation: [], entrance: origin, access_id: '', volumes: [v],
      useful_area_m2: 0, domestic_units: 0, structural_features: [], simplification: 'recipe_volumes', diagnostics: [], resolved: null } as unknown as PlacedBuilding;
  })));
}
