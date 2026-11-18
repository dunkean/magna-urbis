// The published centre of a place is its built core.
//
// Placement gives a place a site (`Settlement.center`); the urban stage may build beside it: a village moves to its
// landing on the shore, a farm stands beside its road, a string follows the road that passes near. The label, the click
// target and the camera then follow the buildings (`Settlement.core`), while `center` stays the placed site that the
// generation keys, the roads and the placement read.

export interface CorePoint {
  x: number;
  y: number;
}
/** What the built core reads of an urban layout (`rust/bridge/urban` `Layout`). */
export interface CoreLayout {
  blocks?: readonly { kind: string; shape: { outer: readonly CorePoint[] } }[];
}

/** A town is "beside its centre" when its built land is centred farther than this from the placed centre:
 * 25 m, or 35 % of the place's radius. */
export function coreTolerance(radius: number): number {
  return Math.max(25, 0.35 * radius);
}

/** Area-weighted centre of the built land of a town: its blocks, programme-reserved blocks included (a farm, a
 * landmark), without the land given back to the fields (`reserve`). `undefined` when nothing is built. */
export function builtLandCentre(layouts: readonly CoreLayout[] | undefined): CorePoint | undefined {
  let x = 0,
    y = 0,
    total = 0;
  for (const layout of layouts ?? [])
    for (const block of layout.blocks ?? []) {
      const ring = block.shape.outer;
      if (block.kind === 'reserve' || ring.length < 3) continue;
      let area = 0,
        cx = 0,
        cy = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          cross = a.x * b.y - b.x * a.y;
        area += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
      }
      if (Math.abs(area) < 1e-6) continue;
      const weight = Math.abs(area) / 2;
      x += (cx / (3 * area)) * weight;
      y += (cy / (3 * area)) * weight;
      total += weight;
    }
  return total > 0 ? { x: x / total, y: y / total } : undefined;
}

/** Mean position of the buildings of a town (each one counted once, at the mean of its outline). `undefined` without
 * any building. */
export function buildingsCentre(buildings: readonly { poly?: readonly CorePoint[] }[] | undefined): CorePoint | undefined {
  let x = 0,
    y = 0,
    count = 0;
  for (const building of buildings ?? []) {
    const ring = building.poly;
    if (!ring?.length) continue;
    let bx = 0,
      by = 0;
    for (const p of ring) {
      bx += p.x;
      by += p.y;
    }
    x += bx / ring.length;
    y += by / ring.length;
    count++;
  }
  return count ? { x: x / count, y: y / count } : undefined;
}

/** The built core to publish for a place: the centre of its buildings (of its built land while only the plan exists)
 * when the town stands beside its placed centre, `undefined` when it stands round it (or is not built). */
export function builtCore(layouts: readonly CoreLayout[] | undefined, center: CorePoint, radius: number, buildings?: readonly { poly?: readonly CorePoint[] }[]): CorePoint | undefined {
  const core = buildingsCentre(buildings) ?? builtLandCentre(layouts);
  if (!core || !Number.isFinite(core.x) || !Number.isFinite(core.y)) return undefined;
  return Math.hypot(core.x - center.x, core.y - center.y) > coreTolerance(radius) ? core : undefined;
}

/** The published centre of a place: its built core, else its placed centre. */
export function publishedCentre(place: { center: CorePoint; core?: CorePoint }): CorePoint {
  return place.core ?? place.center;
}
