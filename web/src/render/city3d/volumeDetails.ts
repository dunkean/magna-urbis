/**
 * Facade openings, parapets and roof details of a resolved volume. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads volume/material/id inputs; appends faces to the supplied RoofBuilder in the original order.
 */
import type { Point, Vertex3 } from '../../../../rust/bridge/housesContract';
import { scaledRing, type ResolvedVolume } from '../cityMassing';
import { RoofBuilder, ringArea, insetRing, ringCentre } from './roofGeometry';
import { featureDome, featureBox, facadeDoor, facadeQuad } from './features';
import { OPENING, LIT_WINDOW } from './materials';
import { hash, CITY3D_LEVEL_M } from './massing';
import type { City3dHeight } from './types';

/** Smallest height of a door, and clear height of an opening over the ground outside, m. */
const LEAST_DOOR_M = 1.6,
  CLEAR_M = 0.15;

/** Parapet, roof-top features, trim, facade openings and tent pole of a volume (detailed LOD only), into its roof mesh.
 * `groundAt`: the ground along the walls of a building on a slope: no opening stands under it, the door opens at it, and the
 * wall under the floor (`cellar`) that it leaves bare is a lower storey with openings of its own. */
export function volumeDetails(roof: RoofBuilder, v: ResolvedVolume, ground: number, wallId: string, id: string, groundAt?: City3dHeight, cellar = false): void {
  const d = v.detail ?? {},
    ring = d.form === 'battered' ? scaledRing(v.shape.outer, 0.92) : v.shape.outer,
    n = ring.length,
    eave = ground + v.eave_m,
    out = ringArea(ring) >= 0 ? 1 : -1;
  // A roof given by explicit pans has no flat rim to stand a parapet on.
  const parapet = v.roof === 'flat' && !v.pans ? (d.parapet_m ?? 0) : 0;
  if (parapet > 0.05) {
    const inner = insetRing(ring, 0.3, true),
      top = eave + parapet;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        a = ring[i],
        b = ring[j],
        e = inner[i],
        f = inner[j];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3) continue;
      roof.face(
        [
          { ...a, z: eave },
          { ...b, z: eave },
          { ...b, z: top },
          { ...a, z: top },
        ],
        wallId,
      );
      roof.face(
        [
          { ...e, z: eave },
          { ...f, z: eave },
          { ...f, z: top },
          { ...e, z: top },
        ],
        wallId,
      );
      roof.face(
        [
          { ...a, z: top },
          { ...b, z: top },
          { ...f, z: top },
          { ...e, z: top },
        ],
        wallId,
      );
    }
  }
  // Sails and wheels are raised by standingFeatures, whatever the roof; the boxes below are roof-top works of flat roofs.
  for (const f of v.roof === 'flat' ? (d.features ?? []).filter(g => g.kind === 'stair' || g.kind === 'dome' || g.kind === 'windcatcher') : []) {
    if (f.kind === 'dome') {
      featureDome(roof, f.x, f.y, f.w / 2, f.h, eave, wallId);
      continue;
    }
    featureBox(roof, f.x, f.y, f.w, f.d, f.h, f.angle, eave, wallId);
    const ca = Math.cos(f.angle),
      sa = Math.sin(f.angle),
      z0 = f.kind === 'stair' ? eave + 0.05 : eave + f.h - 1.3,
      z1 = f.kind === 'stair' ? eave + 1.9 : eave + f.h - 0.2;
    const at = (s: number, t: number, z: number): Vertex3 => ({ x: f.x + s * ca - t * sa, y: f.y + s * sa + t * ca, z });
    const hw = f.kind === 'stair' ? 0.4 : 0.3,
      sx = f.w / 2 + 0.04,
      sy = f.d / 2 + 0.04;
    // One stair head in two stands open on a lit house at night: flat-roofed towns show their light on the roofs too.
    roof.face([at(sx, -hw, z0), at(sx, hw, z0), at(sx, hw, z1), at(sx, -hw, z1)], f.kind === 'stair' && (hash(id) >>> 13) % 2 ? LIT_WINDOW : OPENING);
    if (f.kind === 'windcatcher')
      for (const [s, t] of [
        [-sx, 0],
        [0, sy],
        [0, -sy],
      ])
        roof.face(s ? [at(s, -hw, z0), at(s, hw, z0), at(s, hw, z1), at(s, -hw, z1)] : [at(-hw, t, z0), at(hw, t, z0), at(hw, t, z1), at(-hw, t, z1)], OPENING);
  }
  if (v.roof === 'tent' && v.rise_m > 0.05) {
    const c = ringCentre(ring),
      top = eave + v.rise_m,
      r = 0.07,
      form = d.form,
      DARK = 'city3d:wall:wood@393126',
      // Two tents in three have their hearth lit at night: the door flap (and a yurt's crown) glows; by day it is as dark.
      hearth = (hash(id) >>> 9) % 3 ? LIT_WINDOW : DARK;
    if (form) {
      // Door on the longest facet: a flap rising up the slope.
      const e = ring.map((a, i) => ({ a, b: ring[(i + 1) % n] })).sort((x, y) => Math.hypot(y.b.x - y.a.x, y.b.y - y.a.y) - Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y))[0];
      const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 },
        l = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1,
        ux = (e.b.x - e.a.x) / l,
        uy = (e.b.y - e.a.y) / l;
      const ol = Math.hypot(m.x - c.x, m.y - c.y) || 1,
        ox = ((m.x - c.x) / ol) * 0.04,
        oy = ((m.y - c.y) / ol) * 0.04,
        w = Math.min(0.5, l * 0.3);
      if (form === 'yurt') facadeDoor(roof, e.a, e.b, out, l / 2 - w, l / 2 + w, ground + 0.02, ground + Math.min(1.4, v.eave_m - 0.1), 0.04, hearth);
      else {
        const t = 0.4,
          lift = (p: Point, k: number): Vertex3 => ({ x: p.x + (c.x - p.x) * k + ox, y: p.y + (c.y - p.y) * k + oy, z: ground + 0.02 + (top - ground - 0.02) * k });
        const b0 = { x: m.x - ux * w, y: m.y - uy * w },
          b1 = { x: m.x + ux * w, y: m.y + uy * w };
        roof.face([lift(b0, 0), lift(b1, 0), lift({ x: b1.x - ux * w * 0.5, y: b1.y - uy * w * 0.5 }, t), lift({ x: b0.x + ux * w * 0.5, y: b0.y + uy * w * 0.5 }, t)], hearth);
      }
    }
    if (form === 'yurt') {
      // Dark crown ring on the apex (a flat cap seen from above and the side).
      const cr = Math.min(0.55, v.rise_m * 0.9),
        z0 = top - 0.12;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4,
          b = a + Math.PI / 4;
        roof.face(
          [
            { x: c.x + Math.cos(a) * cr, y: c.y + Math.sin(a) * cr, z: z0 },
            { x: c.x + Math.cos(b) * cr, y: c.y + Math.sin(b) * cr, z: z0 },
            { x: c.x + Math.cos(b) * cr * 0.7, y: c.y + Math.sin(b) * cr * 0.7, z: top + 0.1 },
            { x: c.x + Math.cos(a) * cr * 0.7, y: c.y + Math.sin(a) * cr * 0.7, z: top + 0.1 },
          ],
          DARK,
        );
      }
      // The smoke hole over a lit hearth glows.
      roof.face(
        Array.from({ length: 8 }, (_, i) => ({ x: c.x + Math.cos((i * Math.PI) / 4) * cr * 0.7, y: c.y + Math.sin((i * Math.PI) / 4) * cr * 0.7, z: top + 0.1 })),
        hearth,
      );
      return;
    }
    if (form === 'tipi') {
      // Poles crossing above the apex: thin crossed blades.
      const h = hash(id);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + (h % 7) * 0.1,
          tx = c.x + Math.cos(a) * 0.35,
          ty = c.y + Math.sin(a) * 0.35,
          hw = 0.035,
          sx = -Math.sin(a) * hw,
          sy = Math.cos(a) * hw;
        roof.face(
          [
            { x: c.x * 0.9 + tx * 0.1 + sx, y: c.y * 0.9 + ty * 0.1 + sy, z: top - 0.5 },
            { x: c.x * 0.9 + tx * 0.1 - sx, y: c.y * 0.9 + ty * 0.1 - sy, z: top - 0.5 },
            { x: tx - sx, y: ty - sy, z: top + 0.9 },
            { x: tx + sx, y: ty + sy, z: top + 0.9 },
          ],
          'city3d:wall:wood',
        );
        roof.face(
          [
            { x: c.x * 0.9 + tx * 0.1 - sy, y: c.y * 0.9 + ty * 0.1 + sx, z: top - 0.5 },
            { x: c.x * 0.9 + tx * 0.1 + sy, y: c.y * 0.9 + ty * 0.1 - sx, z: top - 0.5 },
            { x: tx + sy, y: ty - sx, z: top + 0.9 },
            { x: tx - sy, y: ty + sx, z: top + 0.9 },
          ],
          'city3d:wall:wood',
        );
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2,
        b = a + Math.PI / 2;
      roof.face(
        [
          { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: top },
          { x: c.x + Math.cos(b) * r, y: c.y + Math.sin(b) * r, z: top },
          { x: c.x, y: c.y, z: top + 1 },
        ],
        'city3d:wall:wood',
      );
    }
    return;
  }
  // Mouth of a snow house's entrance tunnel, across its axis (the inner end stands inside the dome).
  if (d.form === 'igloo' && v.roof === 'barrel' && v.ridges.length) {
    const [x0, y0, x1, y1] = v.ridges[0],
      l = Math.hypot(x1 - x0, y1 - y0) || 1;
    for (let i = 0; i < n; i++) {
      const a = v.shape.outer[i],
        b = v.shape.outer[(i + 1) % n],
        w = Math.hypot(b.x - a.x, b.y - a.y);
      // One snow house in two shows its lamp at the mouth.
      if (w > 0.2 && Math.abs((b.x - a.x) * (x1 - x0) + (b.y - a.y) * (y1 - y0)) < 0.2 * w * l) facadeDoor(roof, a, b, out, 0.18 * w, 0.82 * w, ground + 0.02, eave + 0.55 * v.rise_m, 0.04, (hash(id) >>> 9) % 2 ? LIT_WINDOW : OPENING);
    }
    return;
  }
  // Edges by length: red trim band, then a door and windows on the longest ones.
  // Small decorative volumes (chimneys, dormers, porches) have no openings.
  if (d.openings === 'none' || v.minor) return;
  // The wall of a volume standing on another one starts at its base: openings are measured from there, and it has no door.
  const raised = v.base_m ?? 0,
    foot = ground + raised,
    wall = v.eave_m - raised;
  const facade = v.shape.outer,
    batter = d.form === 'battered' ? { center: ringCentre(facade), ground: foot, height: wall } : undefined;
  const edges = facade
    .map((a, i) => {
      const b = facade[(i + 1) % n];
      return { a, b, l: Math.hypot(b.x - a.x, b.y - a.y) };
    })
    .filter(e => e.l >= 2.2)
    .sort((x, y) => y.l - x.l);
  const h = hash(id),
    storey = wall / Math.max(1, v.floors),
    hut = (d.overhang_m ?? 0) > 0 || v.roof === 'cone';
  // Openings at human size (door 1.0 × 2.1 m, window 0.9 × 1.2 m), scaled for giants by the storey and for small folk by `body_scale`.
  const body = d.body_scale,
    scale = d.form ? 1 : body ? body * Math.max(1, Math.min(2.5, storey / (CITY3D_LEVEL_M * body))) : Math.max(1, Math.min(2.5, storey / CITY3D_LEVEL_M));
  if (scale > 1.8)
    for (const e of edges) {
      facadeQuad(roof, e.a, e.b, out, 0, e.l, eave - 0.65, eave - 0.05, 0.06, 'city3d:wall:timber');
      for (const s of [0.3, e.l - 0.8]) facadeQuad(roof, e.a, e.b, out, s, s + 0.5, foot, eave, 0.07, 'city3d:wall:timber');
    }
  if (d.trim === 'red' && parapet > 0) for (const e of edges) facadeQuad(roof, e.a, e.b, out, 0.15, e.l - 0.15, eave - 0.95, eave - 0.4, 0.03, 'city3d:wall:plaster@a75e4b');
  /** The ground outside the wall at `s` along an edge, over the floor of the volume or not. */
  const outside = (e: (typeof edges)[number], s: number): number => {
    const ux = (e.b.x - e.a.x) / e.l,
      uy = (e.b.y - e.a.y) / e.l,
      h = groundAt!(e.a.x + ux * s + uy * out * 0.3, e.a.y + uy * s - ux * out * 0.3);
    return Number.isFinite(h) ? h : -Infinity;
  };
  let windows = 0,
    doors = 0;
  const cap = body ? 24 : 10,
    faces = groundAt ? edges.length : hut ? 1 : body ? 4 : 2;
  edges.slice(0, faces).forEach((e, k) => {
    // On a slope the door takes the next wall where the longest ones are in the hill.
    if (k >= (hut ? 1 : body ? 4 : 2) && doors) return;
    const doorW = (hut ? 0.8 : 1.0) * scale,
      doorH = (hut ? 1.6 : 2.1) * scale,
      doorAt = Math.max(0.3, Math.min(e.l - doorW - 0.3, (((h >>> (k * 3)) % 100) / 100) * e.l)),
      step = groundAt ? Math.max(ground, outside(e, doorAt + doorW / 2)) : ground,
      lintel = Math.min(step + doorH, ground + v.eave_m - 0.2);
    const door = !raised && (k === 0 || !doors || (h >>> 5) % 3 === 0) && (step === ground || lintel - step >= Math.min(LEAST_DOOR_M, doorH));
    if (door) {
      doors++;
      facadeDoor(roof, e.a, e.b, out, doorAt, doorAt + doorW, step + 0.02, lintel, 0.04, (h >>> 9) % 4 ? LIT_WINDOW : OPENING, batter); // three doors in four stand open on a lit room at night
    }
    if (hut || d.openings === 'door') return;
    // Openness (culture data): massive warm-climate walls get fewer, smaller windows, spaced by 1/openness and thinned on the street floor.
    const medina = v.roof === 'flat',
      open = d.openness ?? 1,
      gap = ((medina ? 3.4 : body ? 2.4 : 2.6) * scale) / open,
      count = Math.floor((e.l - 1) / gap);
    const ww = (medina ? (body ? 0.7 : 0.4) : body ? 0.9 : 0.85) * scale * (0.7 + 0.3 * open),
      wh = Math.min((medina ? (body ? 0.9 : 0.55) : body ? 1.2 : 1.1) * scale * (0.8 + 0.2 * open), body ? storey * 0.5 : Infinity);
    const sill = Math.min((medina ? (body ? 1.4 : 1.8) : body ? 0.9 : 1.0) * scale, body ? storey * 0.32 : Infinity);
    for (let f = medina ? 1 : 0; f < v.floors && windows < cap; f++)
      for (let c = 0; c < count && windows < cap; c++) {
        const s = 0.5 + ((c + 0.5) * (e.l - 1)) / count - ww / 2,
          z0 = f * storey + sill;
        if (z0 + wh > wall - 0.25 || (medina && (h >>> (c + f)) % 3 === 0)) continue;
        if (f === 0 && open < 1 && ((h >>> (c + 7 * k)) % 100) / 100 >= open * open) continue;
        if (f === 0 && !raised && s < doorAt + doorW + 0.3 && s + ww > doorAt - 0.3) continue;
        if (groundAt && (outside(e, s + ww / 2) > foot + z0 - CLEAR_M || (door && foot + z0 < lintel + 0.2 && s < doorAt + doorW + 0.3 && s + ww > doorAt - 0.3))) continue;
        // One window in two is lit at night, the same ones at every redraw.
        const lit = (Math.imul(h ^ (c * 73 + f * 151 + k * 283 + 1), 2654435761) >>> 0) % 2 === 0;
        facadeQuad(roof, e.a, e.b, out, s, s + ww, foot + z0, foot + z0 + wh, 0.04, lit ? LIT_WINDOW : OPENING, batter);
        windows++;
      }
  });
  if (groundAt && cellar && !raised && !batter) lowerStorey(roof, edges, out, ground, outside, h);
}

/** Openings of the storeys under the floor, on the walls the hill leaves bare downhill: windows level along each wall, and a
 * door at the ground where a whole storey stands free. */
function lowerStorey(roof: RoofBuilder, edges: readonly { a: Point; b: Point; l: number }[], out: number, floor: number, outside: (e: { a: Point; b: Point; l: number }, s: number) => number, h: number): void {
  let doors = 0;
  for (const e of edges) {
    const count = Math.max(1, Math.floor((e.l - 0.6) / 2.8));
    for (let c = 0; c < count; c++) {
      const s = 0.3 + ((c + 0.5) * (e.l - 0.6)) / count,
        bare = floor - outside(e, s);
      if (!(bare > 1.4)) continue;
      const door = !doors && bare > 2.4 && bare < CITY3D_LEVEL_M * 1.6;
      if (door) {
        doors++;
        facadeDoor(roof, e.a, e.b, out, s - 0.5, s + 0.5, floor - bare + 0.02, Math.min(floor - 0.2, floor - bare + 2.1), 0.04, OPENING);
        continue;
      }
      for (let top = 0.4, storey = 0; top + 0.8 + CLEAR_M < bare && storey < 6; top += CITY3D_LEVEL_M, storey++) facadeQuad(roof, e.a, e.b, out, s - 0.35, s + 0.35, floor - top - 0.75, floor - top, 0.04, ((h >>> ((c + storey) % 24)) & 3) === 0 ? LIT_WINDOW : OPENING);
    }
  }
}
