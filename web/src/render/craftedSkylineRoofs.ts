import type { Vertex3 } from '../../../rust/bridge/housesContract';
import type { RoofBuilder } from './city3d/roofGeometry';

type At = (x: number, y: number, z: number) => Vertex3;
const iron = 'city3d:wall:steel@4d4745',
  bronze = 'city3d:cover:metal@927550',
  obsidian = 'city3d:wall:stone@514758',
  glass = 'city3d:detail:glass@60576c';
/** An occupied roof or workshop vent, measured inside the tested clear rectangle of a flat roof. */
export function culturalRoofWork(culture: string, mesh: RoofBuilder, at: At, w: number, d: number, h: number, seed: number): boolean {
  const quad = (a: Vertex3, b: Vertex3, c: Vertex3, e: Vertex3, m: string) => mesh.face([a, b, c, e], m);
  const rect = (x: number, y: number, a: number, b: number, z: number) => [at(x - a, y - b, z), at(x + a, y - b, z), at(x + a, y + b, z), at(x - a, y + b, z)];
  const ring = (x: number, y: number, a: number, b: number, z: number, n = 8) => Array.from({ length: n }, (_, i) => at(x + a * Math.cos((i * 2 * Math.PI) / n), y + b * Math.sin((i * 2 * Math.PI) / n), z));
  function link(a: Vertex3[], b: Vertex3[], m: string) {
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      quad(a[i], a[j], b[j], b[i], m);
    }
  }
  if (culture === 'drow-enclave') {
    // Four swept ribs suspend a folded, translucent spider-silk lantern over its octagonal curb.
    const foot = ring(0, d * 0.5, w * 0.7, d * 0.33, 0),
      rim = ring(0, d * 0.5, w * 0.71, d * 0.335, 0.24);
    link(foot, rim, obsidian);
    const silk = 'city3d:cover:felt@79667e',
      peak = at(w * 0.18, d * 0.44, h * 0.61);
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8,
        shoulder = at(w * 0.76 * Math.cos((i * Math.PI) / 4), d * 0.5 + d * 0.35 * Math.sin((i * Math.PI) / 4), i % 2 ? 0.55 : h * 0.84);
      const next = at(w * 0.76 * Math.cos((j * Math.PI) / 4), d * 0.5 + d * 0.35 * Math.sin((j * Math.PI) / 4), j % 2 ? 0.55 : h * 0.84);
      quad(rim[i], rim[j], next, shoulder, glass);
      mesh.face([shoulder, next, peak], silk);
      if (i % 2 === 0) {
        const x = Math.cos((i * Math.PI) / 4),
          y = Math.sin((i * Math.PI) / 4);
        const root = rect(x * w * 0.91, d * 0.5 + y * d * 0.455, 0.105, 0.1, 0),
          knee = rect(x * w * 0.93, d * 0.5 + y * d * 0.45, 0.075, 0.075, h * 0.43),
          tip = rect(x * w * 0.69, d * 0.5 + y * d * 0.32, 0.022, 0.022, h);
        link(root, knee, obsidian);
        link(knee, tip, obsidian);
        mesh.face(tip, bronze);
      }
    }
  } else if (culture === 'duergar-hold') {
    // Unequal chimneys: open dark flues with cast collars, linked by a low plenum.
    const plinth = rect(0, d * 0.5, w * 0.88, d * 0.36, 0.45);
    link(rect(0, d * 0.5, w * 0.88, d * 0.36, 0), plinth, iron);
    mesh.face(plinth, iron);
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * w * 0.55,
        y = d * (0.46 + 0.1 * (k % 2)),
        r = Math.min(w * 0.224, d * 0.18),
        top = h * (0.68 + 0.14 * ((k + seed) % 3));
      const base = ring(x, y, r, r, 0.45),
        lip = ring(x, y, r * 0.83, r * 0.83, top - 0.17),
        outer = ring(x, y, r, r, top),
        inner = ring(x, y, r * 0.64, r * 0.64, top - 0.012);
      link(base, lip, iron);
      link(lip, outer, bronze);
      link(outer, inner, bronze);
      const low = ring(x, y, r * 0.6, r * 0.6, top - 0.46);
      link(inner, low, iron);
      mesh.face(low, 'city3d:detail:soot@352e2a');
    }
  } else if (culture === 'giant-hold') {
    // Two monolithic pairs hold a tilted capstone above a recessed smoke opening.
    for (const x of [-w * 0.57, w * 0.57])
      for (const y of [d * 0.28, d * 0.73]) {
        const lo = rect(x, y, w * 0.22, d * 0.14, 0),
          hi = rect(x * 0.92, y, w * 0.16, d * 0.105, h * 0.66);
        link(lo, hi, 'city3d:wall:stone@88877d');
        mesh.face(hi, 'city3d:wall:stone@999587');
      }
    const lo = ring(0, d * 0.5, w * 0.98, d * 0.465, h * 0.65, 8),
      hi = ring(-w * 0.04, d * 0.5, w * 0.93, d * 0.435, h * 0.9, 8);
    hi.forEach((p, i) => {
      p.z += 0.13 * Math.cos((i * Math.PI) / 4);
    });
    link(lo, hi, 'city3d:wall:stone@848379');
    mesh.face(hi, 'city3d:wall:stone@99998a');
  } else if (culture === 'solarpunk') {
    // A sawtooth winter garden: sloped photovoltaic panes alternate with vertical clerestories.
    for (let i = 0; i < 3; i++) {
      const x = -w + (i * 2 * w) / 3,
        xx = x + (2 * w) / 3;
      quad(at(x, 0, 0.38), at(xx, 0, h * 0.68), at(xx, d, h * 0.68), at(x, d, 0.38), 'city3d:detail:panel@4e6970');
      quad(at(xx, 0, 0.38), at(xx, d, 0.38), at(xx, d, h * 0.68), at(xx, 0, h * 0.68), 'city3d:cover:glass@829c8e');
      for (const y of [0, d]) mesh.face([at(x, y, 0.38), at(xx, y, 0.38), at(xx, y, h * 0.68)], bronze);
    }
    const deck = rect(0, d / 2, w, d / 2, 0.38);
    link(rect(0, d / 2, w, d / 2, 0), deck, iron);
  } else if (culture === 'futuristic-space-colony' || culture === 'corporate-arcology') {
    const space = culture === 'futuristic-space-colony',
      material = space ? 'city3d:wall:steel@a4a69c' : 'city3d:wall:concrete@c5c5b7';
    const base = ring(0, d * 0.5, w * 0.9, d * 0.43, 0),
      sill = ring(0, d * 0.5, w * 0.87, d * 0.42, h * 0.33),
      glassTop = ring(w * 0.06, d * 0.51, w * 0.8, d * 0.39, h * 0.77),
      edge = ring(w * 0.06, d * 0.51, w * 0.9, d * 0.44, h * 0.83),
      top = ring(w * 0.05, d * 0.51, w * 0.65, d * 0.34, h);
    link(base, sill, material);
    link(sill, glassTop, space ? 'city3d:detail:glass@576970' : 'city3d:detail:glass@658184');
    link(glassTop, edge, iron);
    link(edge, top, material);
    mesh.face(top, material);
    for (let i = 0; i < 8; i += 2) {
      const a = (i * Math.PI) / 4,
        dx = Math.cos(a),
        dy = Math.sin(a);
      link(rect(w * 0.9 * dx, d * (0.5 + 0.43 * dy), 0.085, 0.085, 0.12), rect(w * 0.06 + w * 0.8 * dx, d * (0.51 + 0.39 * dy), 0.055, 0.055, h * 0.79), material);
    }
  } else return false;
  return true;
}
