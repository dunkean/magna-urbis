/**
 * Bridge deck, parapet and pier display meshes. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads street spans and height/water samplers; builds local volume records with unchanged camber/clearance rules.
 */
import { wetBridgeSpans } from '../cityBridges';
import type { ArchitectureVolume, PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots, Point, Surface } from '../../../../rust/bridge/housesContract';
import { City3dHeight } from './types';
import { slots } from './materials';
import { WallMesh } from './wallGeometry';
import { baseVolume } from './volume';
import { RoofBuilder } from './roofGeometry';

// ---------------------------------------------------------------- bridges
/** Deck top over the water surface reached by the camber (m), and the steepest end grade the camber may take. */
const BRIDGE_CLEARANCE = 1.5,
  BRIDGE_GRADE = 0.08;

/** Camber (rise of the parabola at mid-span above the abutment line) of a bridge deck from `za` to `zb`: a shallow
 * default crown, raised so the deck top clears the water surface by BRIDGE_CLEARANCE in the inner span, but never
 * steeper than BRIDGE_GRADE at the ends. Near the banks the deck simply continues the road. */
export function bridgeCamber(path: readonly Point[], span: number, za: number, zb: number, waterAt?: City3dHeight): number {
  const gentle = Math.min(2, span / 80),
    cap = Math.max(gentle, (span * BRIDGE_GRADE) / 4);
  let need = gentle,
    along = 0;
  if (waterAt && span > 0)
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1],
        q = path[i],
        len = Math.hypot(q.x - p.x, q.y - p.y),
        steps = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k <= steps; k++) {
        const t = (along + (len * k) / steps) / span,
          bow = 4 * t * (1 - t),
          w = waterAt(p.x + ((q.x - p.x) * k) / steps, p.y + ((q.y - p.y) * k) / steps);
        // Inner span only (bow >= 0.5): the abutments meet their banks whatever the water does next to them.
        if (bow >= 0.5 && Number.isFinite(w)) need = Math.max(need, (w + BRIDGE_CLEARANCE - (za + (zb - za) * t)) / bow);
      }
      along += len;
    }
  return Math.min(cap, need);
}

/** Bridge and causeway streets as decks over the water: the plan drapes
 * streets into the ground texture, which hides them under the water surface. On dry ground a causeway is an ordinary
 * road of that texture (a raised bank approach), without deck nor parapet (`causewayWater`: the water a causeway crosses).
 * The 0.9 m deck joins each bank at the road's height (bridgeCamber) and stands on piers every ~14 m. These are
 * city volumes for the 3D view only, not authoritative architecture. */
export function city3dBridges(streets: readonly { path: Point[]; widths: number[]; role: string }[], heightAt?: City3dHeight, waterAt?: City3dHeight, causewayWater = waterAt): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const h = (p: Point): number => (heightAt ? heightAt(p.x, p.y) : 0) || 0;
  streets
    .flatMap(s => (s.role === 'causeway' ? (causewayWater ? wetBridgeSpans(s, causewayWater) : []) : wetBridgeSpans(s, waterAt)))
    .forEach((street, si) => {
      if ((street.role !== 'bridge' && street.role !== 'causeway') || street.path.length < 2) return;
      const a = street.path[0],
        b = street.path[street.path.length - 1];
      const span = street.path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - street.path[i].x, p.y - street.path[i].y), 0);
      // Local surface under the deck (ground or water): the deck never sinks into it.
      const surface = (v: Point): number => {
        const w = waterAt?.(v.x, v.y);
        return Math.max(h(v), Number.isFinite(w) ? (w as number) : -Infinity);
      };
      // Each landing continues its own road: the deck end sits on the drawn ground under the road's end, never on
      // a water sample farther along the river, and is never lifted. Between the abutments the deck is the straight
      // line between its two ends plus a gentle camber, so it stays a road over the water, not an aqueduct.
      const za = h(a) + 0.12,
        zb = h(b) + 0.12;
      const crown = street.role === 'bridge' ? bridgeCamber(street.path, span, za, zb, waterAt) : 0;
      const deck = Math.max(za, zb) + crown;
      const width = Math.max(3, ...street.widths.filter(Number.isFinite)) + 0.8;
      // Narrow bridges are timber decks (as in the textured 2D plan), wider ones stone paving.
      const materials: MaterialSlots = { ...slots('stone', 'stone'), cladding: width < 4.8 ? 'city3d:road:timber' : 'city3d:road:bridge' },
        volumes: ArchitectureVolume[] = [],
        footprint: Surface = [];
      let along = 0;
      for (let i = 1; i < street.path.length; i++) {
        const p = street.path[i - 1],
          q = street.path[i],
          len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 0.2) continue;
        const nx = ((-(q.y - p.y) / len) * width) / 2,
          ny = (((q.x - p.x) / len) * width) / 2;
        const quad = [
          { x: p.x + nx, y: p.y + ny },
          { x: q.x + nx, y: q.y + ny },
          { x: q.x - nx, y: q.y - ny },
          { x: p.x - nx, y: p.y - ny },
        ];
        const shape = { outer: quad, holes: [] },
          start = along;
        const level = (v: Point): number => {
          const t = Math.max(0, Math.min(1, (start + Math.max(0, Math.min(len, ((v.x - p.x) * (q.x - p.x) + (v.y - p.y) * (q.y - p.y)) / len))) / span));
          return Math.max(surface(v) + 0.12, za + (zb - za) * t + crown * 4 * t * (1 - t));
        };
        const prism = (id: string, s: typeof shape, low: (p: Point) => number, high: (p: Point) => number): void => {
          const mesh = new WallMesh(),
            k = Math.max(1, Math.ceil(len / 8));
          const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
          // Longitudinal strips keep the crown in the cap triangulation too.
          for (let j = 0; j < k; j++) {
            const [a, b, c, d] = s.outer;
            mesh.prism({ outer: [at(a, b, j / k), at(a, b, (j + 1) / k), at(d, c, (j + 1) / k), at(d, c, j / k)], holes: [] }, low, high, materials.cladding, materials.cladding, true);
          }
          volumes.push(baseVolume(id, [s], mesh.bottom, mesh.top - mesh.bottom, 0, materials, mesh.roof.mesh(), 'RF-FLAT', { footprint: [s], z_min_m: mesh.bottom, z_max_m: mesh.bottom }, []));
        };
        footprint.push(shape);
        prism(`bridge:${si}:${i}:deck`, shape, v => level(v) - 0.9, level);
        // Two parapets share the deck's volume batch and leave the bank ends open.
        const railWidth = Math.min(0.45, width * 0.1),
          railHeight = 1.05;
        for (const side of [-1, 1]) {
          const inner = 1 - railWidth / (width / 2);
          const rail = {
            outer: [
              { x: p.x + nx * side, y: p.y + ny * side },
              { x: q.x + nx * side, y: q.y + ny * side },
              { x: q.x + nx * side * inner, y: q.y + ny * side * inner },
              { x: p.x + nx * side * inner, y: p.y + ny * side * inner },
            ],
            holes: [],
          };
          prism(`bridge:${si}:${i}:parapet:${side}`, rail, level, v => level(v) + railHeight);
        }
        // Piers, only where the deck stands clear of the ground (over water or a ravine).
        for (let t = 14; t < len - 4; t += 14) {
          const c = { x: p.x + ((q.x - p.x) * t) / len, y: p.y + ((q.y - p.y) * t) / len },
            bed = h(c);
          const top = level(c) - 0.9;
          if (top - bed < 1.5) continue;
          const ux = ((q.x - p.x) / len) * 0.9,
            uy = ((q.y - p.y) / len) * 0.9,
            wx = nx * 0.8,
            wy = ny * 0.8;
          const pier = {
            outer: [
              { x: c.x - ux + wx, y: c.y - uy + wy },
              { x: c.x + ux + wx, y: c.y + uy + wy },
              { x: c.x + ux - wx, y: c.y + uy - wy },
              { x: c.x - ux - wx, y: c.y - uy - wy },
            ],
            holes: [],
          };
          volumes.push(baseVolume(`bridge:${si}:${i}:pier:${t}`, [pier], bed, top - bed, 0, materials, new RoofBuilder().mesh(), 'RF-FLAT', { footprint: [pier], z_min_m: bed - 0.5, z_max_m: bed }));
        }
        along += len;
      }
      if (!volumes.length) return;
      const mid = street.path[street.path.length >> 1];
      out.push({
        id: `city3d-bridge:${si}`,
        parcel_id: '',
        function: 'open_space',
        culture: { culture: '', pack: '', mode: 'inspired', borrowing: null } as unknown as PlacedBuilding['culture'],
        recipe_id: 'city3d-bridge',
        variant_id: street.role,
        transform: { origin: mid, orientation_deg: 0 },
        ground_z_m: deck - 0.9,
        footprint,
        roof_footprint: footprint,
        courtyards: [],
        circulation: [],
        entrance: mid,
        access_id: '',
        volumes,
        useful_area_m2: 0,
        domestic_units: 0,
        structural_features: [],
        simplification: 'recipe_volumes',
        diagnostics: ['city3d bridge deck (display only)'],
        resolved: null,
      });
    });
  return out;
}
