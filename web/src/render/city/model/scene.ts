/**
 * Builds the plan of a town (`CityScene`) from its layouts and partitions: blocks and parcels clipped against the
 * water, streets with their mean width, walls cut at their gates, districts, landmarks, spatial bins. Called once per
 * town by the pages (v2/nativeCityMap.ts, City Bench, the 3D city).
 */
import type { Layout, Partition, Point, Quay, Shape } from '../../../../../rust/bridge/urban';
// enclosures hook (cityLotEnclosures.ts)
// walls hook (cityWalls.ts)
import { cityGroundFor, boardwalkWidth, isBoardwalk, type CityGroundRaster } from '../../cityGround';
import { softenRuralGround } from '../../countryside';
import { roleFamily } from '../look';
import { CityDistrict, CityAllocation, CityBlock, CityParcel, CityStreet, CityWall, CityLandmark, CityScene } from './contract';
import { EMPTY, grow, shapeBox, centroid, SpatialBins } from './geometry';
import { landmarkName } from './roles';

/** Optional contract fields read defensively: older plans render without them. */
type DistrictContract = { role?: string; label?: string; wealth?: number };
export type AllocationContract = { role?: string; label?: string; wealth?: number; landmark?: boolean; households?: number };
type EnclosureContract = { towers?: Point[] };

/** The wall stroke stops at each gate, so roads remain visible through it. */
function wallPieces(points: Point[], gates: Point[]): { pieces: Point[][]; gateTowers: Point[] } {
  const pieces: Point[][] = [],
    gateTowers: Point[] = [];
  if (points.length < 2) return { pieces, gateTowers };
  const closed = points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y ? points : [...points, points[0]];
  let current: Point[] = [];
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1],
      b = closed[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const at = (d: number): Point => ({ x: a.x + (dx * d) / length, y: a.y + (dy * d) / length });
    const gaps = gates
      .flatMap(g => {
        const along = ((g.x - a.x) * dx + (g.y - a.y) * dy) / length,
          across = Math.abs((g.x - a.x) * dy - (g.y - a.y) * dx) / length;
        if (across > 6 || along < -6 || along > length + 6) return [];
        const half = Math.sqrt(36 - across * across);
        return [[Math.max(0, along - half), Math.min(length, along + half)]];
      })
      .sort((p, q) => p[0] - q[0]);
    let start = 0;
    if (!current.length) current.push(a);
    for (const [from, to] of gaps) {
      if (from > start) current.push(at(from));
      if (current.length > 1) pieces.push(current);
      if (from > 0.01) gateTowers.push(at(from));
      if (to < length - 0.01) gateTowers.push(at(to));
      current = [at(Math.max(start, to))];
      start = Math.max(start, to);
    }
    current.push(b);
  }
  if (current.length > 1) pieces.push(current);
  return { pieces, gateTowers };
}

/** The shapes `buildCityScene` clips against the water for these layouts and partitions (blocks, lots, allocated
 * ground), the very objects it will ask for: a clip ahead (CityGround.clipAhead) then answers them from its cache.
 * A shape missing here is simply clipped by the scene itself. */
export function cityGroundSubjects(layouts: readonly Layout[], partitions: readonly Partition[] = []): Shape[] {
  const shapes: Shape[] = [];
  for (const layout of layouts) {
    for (const block of layout.blocks) if (block.kind !== 'deleted') shapes.push(block.kind === 'reserve' ? softenRuralGround(block.shape) : block.shape);
    for (const shape of layout.structure?.allocated?.length ? layout.structure.allocated : layout.quarters.map(q => q.shape)) shapes.push(shape);
    for (const parcel of partitions.find(p => p.key === layout.key)?.parcels ?? []) shapes.push(parcel.use === 'reserve' ? softenRuralGround(parcel.shape) : parcel.shape);
  }
  return shapes;
}
export function buildCityScene(layouts: readonly Layout[], partitions: readonly Partition[] = [], terrain?: CityGroundRaster): CityScene {
  const ground = terrain && cityGroundFor(terrain);
  const blocks: CityBlock[] = [],
    parcels: CityParcel[] = [],
    streets: CityStreet[] = [],
    walls: CityWall[] = [],
    districts: CityDistrict[] = [];
  const landmarks: CityLandmark[] = [],
    footprint: Shape[] = [],
    parcelById = new Map<string, number>();
  const extent = { ...EMPTY },
    quays: Quay[] = [];
  // Water clipping runs once for the whole scene (one Rust call), after the walk.
  const pendingGround: { target: { ground?: Shape[] }; shape: Shape }[] = [],
    footprintSources: Shape[] = [];
  layouts.forEach((layout, li) => {
    for (const q of layout.structure?.quays ?? []) {
      quays.push(q);
      grow(extent, q.shape.outer);
    }
    const phases = layout.phases ?? [];
    const byQuarter = new Map<number, CityDistrict>(),
      districtShapes = new Map<CityDistrict, Shape[]>();
    for (const d of layout.structure?.districts ?? []) {
      const extra = d as typeof d & DistrictContract;
      const district: CityDistrict = { layout: li, id: d.id, role: extra.role || undefined, label: extra.label || undefined, wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined, tissue: d.tissue, phase: d.phase };
      districts.push(district);
      districtShapes.set(district, []);
      for (const q of d.quarters) byQuarter.set(q, district);
    }
    const walled = (layout.enclosures?.length ?? 0) > 0;
    const zoneOf = (quarter: number, zone?: string, phase?: number): { zone: string; phase: number; peripheral: boolean } => {
      const q = layout.quarters[quarter],
        p = phase ?? q?.phase ?? 0,
        growth = phases[p];
      const z = zone ?? q?.zone ?? growth?.zone ?? 'core',
        kind = growth?.kind;
      return { zone: kind === 'faubourg' ? 'faubourg' : z, phase: p, peripheral: kind === 'faubourg' || (['edge', 'faubourg', 'village'].includes(growth?.zone ?? z) && !walled) };
    };
    layout.blocks.forEach((block, bi) => {
      // A deleted native block keeps its slot so the indices of the others stay those of the native layout.
      if (block.kind === 'deleted') return;
      const z = zoneOf(block.quarter, block.zone, block.phase),
        district = byQuarter.get(block.quarter);
      const shape = block.kind === 'reserve' ? softenRuralGround(block.shape) : block.shape;
      const item: CityBlock = { layout: li, index: bi, shape, ground: undefined, kind: block.kind, zone: z.zone, phase: z.phase, quarter: block.quarter, district, peripheral: z.peripheral };
      blocks.push(item);
      if (ground) pendingGround.push({ target: item, shape });
      if (district && !block.kind.startsWith('reserve')) districtShapes.get(district)!.push(block.shape);
      grow(extent, block.shape.outer);
    });
    for (const [district, shapes] of districtShapes) district.anchor = centroid(shapes);
    footprintSources.push(...(layout.structure?.allocated?.length ? layout.structure.allocated : layout.quarters.map(q => q.shape)));
    layout.streets.forEach((street, si) => {
      const width = street.widths.length ? street.widths.reduce((s, w) => s + w, 0) / street.widths.length : 4;
      streets.push({ layout: li, index: si, street, width: isBoardwalk(street.role) ? boardwalkWidth(width) : Number.isFinite(width) && width > 0 ? width : 4, rank: street.rank, role: street.role });
    });
    for (const enclosure of layout.enclosures ?? []) {
      const { pieces, gateTowers } = wallPieces(enclosure.path, enclosure.gates);
      walls.push({ kind: enclosure.kind, pieces, gates: enclosure.gates, gateTowers, towers: (enclosure as typeof enclosure & EnclosureContract).towers ?? [] });
    }
    const partition = partitions.find(p => p.key === layout.key);
    if (!partition) return;
    const allocations = new Map<string, CityAllocation>();
    for (const a of partition.programme?.allocations ?? []) {
      const extra = a as typeof a & AllocationContract;
      allocations.set(a.parcelId, {
        role: extra.role || undefined,
        label: extra.label || undefined,
        wealth: typeof extra.wealth === 'number' ? extra.wealth : undefined,
        function: a.function,
        landmark: extra.landmark === true,
        households: typeof extra.households === 'number' ? extra.households : undefined,
        residents: a.residents,
        demandId: a.demandId,
        culture: a.culture,
      });
    }
    partition.parcels.forEach((parcel, pi) => {
      const block = layout.blocks[parcel.block],
        z = zoneOf(block?.quarter ?? -1, block?.zone, block?.phase);
      const allocation = parcel.id ? allocations.get(parcel.id) : undefined,
        index = parcels.length;
      const shape = parcel.use === 'reserve' ? softenRuralGround(parcel.shape) : parcel.shape;
      const item: CityParcel = { layout: li, index: pi, shape, ground: undefined, use: parcel.use, block: parcel.block, zone: z.zone, id: parcel.id, allocation, district: block && byQuarter.get(block.quarter), peripheral: z.peripheral, source: parcel };
      parcels.push(item);
      if (ground) pendingGround.push({ target: item, shape });
      if (parcel.id) parcelById.set(parcel.id, index);
      if (allocation?.landmark || parcel.use === 'market') {
        const point = centroid([parcel.shape]);
        if (point)
          landmarks.push({
            point,
            parcel: index,
            box: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y },
            family: parcel.use === 'market' && !allocation?.role ? 'commerce' : roleFamily(allocation?.role, allocation?.function),
            label: landmarkName(allocation?.role, parcel.use === 'market' ? 'Market' : 'Monument', allocation?.label),
          });
      }
    });
  });
  if (ground) {
    const clipped = ground.clipMany([...pendingGround.map(p => p.shape), ...footprintSources]);
    pendingGround.forEach((p, i) => {
      p.target.ground = clipped[i];
    });
    footprint.push(...clipped.slice(pendingGround.length).flat());
  } else footprint.push(...footprintSources);
  // Native previews supply occupied houses later; an empty cadastre has no fences.
  const lotEnclosures: import('../../../../../rust/bridge/urban').LotEnclosure[] = [];
  const enclosureProfiles = layouts.map(l => partitions.find(p => p.key === l.key)?.enclosure);
  return {
    layouts,
    blocks,
    parcels,
    streets,
    walls,
    districts,
    landmarks,
    footprint,
    extent,
    parcelById,
    quays,
    ground,
    lotEnclosures,
    enclosureProfiles,
    bins: {
      blocks: new SpatialBins(
        blocks.map(b => shapeBox(b.shape)),
        128,
      ),
      parcels: new SpatialBins(
        parcels.map(p => shapeBox(p.shape)),
        64,
      ),
      streets: new SpatialBins(
        streets.map(s => grow({ ...EMPTY }, s.street.path, s.width)),
        128,
      ),
      landmarks: new SpatialBins(
        landmarks.map(l => l.box),
        128,
      ),
    },
  };
}
