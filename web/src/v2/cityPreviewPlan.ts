import { bbox, lerp, polygonArea, polygonCentroid, v2, type Polygon, type Vec2 } from '../gen/core/geom';
import { Rng } from '../gen/core/rng';
import { clipRingRect } from '../render/cartography/geometry';
import type { Rect4 } from '../render/view';
import type { ExternalCityHints } from './externalCity/types';

export interface CityPreviewPlan {
  bounds: Rect4;
  water: Polygon[];
  banks: Vec2[][];
  blocks: { ring: Polygon; tone: number }[];
  roads: Vec2[][];
  walls: Vec2[][];
  gates: Vec2[][];
  bridges: Vec2[][];
  docks: Vec2[][];
  landmarks: Polygon[];
  squares: Polygon[];
}

export interface CityPreviewDetail {
  lanes: Vec2[][];
  roofs: Polygon[];
}

interface Block {
  ring: Polygon;
  tone: number;
}

type Projection = (p: Vec2) => Vec2;
type Axis = 'x' | 'y';
type WaterSide = 'N' | 'E' | 'S' | 'W';

interface PreviewDraft {
  plan: CityPreviewPlan;
  blocks: Block[];
  project: Projection;
  camp: boolean;
  seed: string;
  population: number;
}

const SIDES: readonly WaterSide[] = ['N', 'E', 'S', 'W'];
const PLANNED = /chinese|bastide|roman|planned|jokamachi|egyptian|grid|citadel|aztec|khmer/;
const CAMP = /camp|ordu|kraal|native-plains/;
const MAP_EDGE = 1400;
const box = (minX: number, minY: number, maxX: number, maxY: number): Rect4 => ({ minX, minY, maxX, maxY });
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const rotate = (p: Vec2, side: WaterSide): Vec2 => {
  switch (side) {
    case 'E':
      return v2(-p.y, p.x);
    case 'S':
      return v2(-p.x, -p.y);
    case 'W':
      return v2(p.y, -p.x);
    default:
      return p;
  }
};

/** One curved grid serves streets and plots so neighbouring blocks keep common edges. */
function projection(rng: Rng, bend: number, side: WaterSide): Projection {
  const xPhase = rng.range(0, 6),
    yPhase = rng.range(0, 6),
    skew = rng.range(-0.13, 0.13);
  return ({ x, y }) => rotate(v2(x + bend * Math.sin(y / 50 + xPhase) + skew * y, y + bend * 0.62 * Math.sin(x / 43 + yPhase)), side);
}

function projectedPath(points: readonly Vec2[], project: Projection, closed = false): Polygon {
  const path = [project(points[0])];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10));
    for (let step = 1; step <= steps; step++) {
      if (closed && i === count - 1 && step === steps) break;
      path.push(project(lerp(a, b, step / steps)));
    }
  }
  return path;
}

function cuts(rng: Rng, count: number, size: number, jitter: number): number[] {
  const step = (2 * size) / count;
  return Array.from({ length: count + 1 }, (_, i) => (i === 0 ? -size : i === count ? size : -size + i * step + rng.range(-jitter, jitter) * step));
}

function slice(ring: Polygon, axis: Axis, value: number): [Vec2, Vec2] | undefined {
  const hits: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    if (a[axis] > value === b[axis] > value) continue;
    hits.push(lerp(a, b, (value - a[axis]) / (b[axis] - a[axis])));
  }
  const direction = other(axis);
  hits.sort((a, b) => a[direction] - b[direction]);
  return hits.length >= 2 ? [hits[0], hits[hits.length - 1]] : undefined;
}

function inset(ring: Polygon, amount: number): Polygon {
  const center = polygonCentroid(ring);
  return ring.map(p => lerp(p, center, amount));
}

export function generateCityPreview(hints: ExternalCityHints): PreviewDraft {
  const rng = new Rng(hints.seed);
  const population = Math.max(1, Math.min(5e6, hints.population ?? 2500));
  const culture = hints.culture ?? 'european-organic';
  const camp = CAMP.test(culture);
  const planned = PLANNED.test(culture);
  const coastal = hints.lakeShore ?? (hints.coast === 'none' ? undefined : hints.coast);
  const coast = coastal === 'random' ? rng.pick(SIDES) : coastal;
  const hasRiver = !!hints.river && hints.river !== 'none';
  const project = projection(rng, planned ? 3 : camp ? 8 : 15, coast ?? rng.pick(SIDES));
  const radiusX = rng.range(95, 109),
    radiusY = rng.range(73, 92);
  const count = Math.max(2, Math.min(12, Math.round(Math.log10(population) * 1.9 - 1)));
  const exponent = planned ? 0.54 : 0.94;
  const phase = rng.range(0, 0.2);
  const outline = Array.from({ length: 20 }, (_, i) => {
    const a = phase + (i * Math.PI) / 10;
    const shape = (n: number) => Math.sign(n) * Math.pow(Math.abs(n), exponent);
    return v2(radiusX * shape(Math.cos(a)), radiusY * shape(Math.sin(a)));
  });

  const shore = coast ? -radiusY * (hints.port ? 0.61 : 0.8) : -MAP_EDGE;
  const channel = rng.range(15, 35);
  const halfWidth = hints.river === 'major' ? 8 : hints.river === 'stream' ? 2.7 : 5;
  const left = hasRiver ? channel - halfWidth : MAP_EDGE;
  const right = channel + halfWidth;
  const land = [box(-MAP_EDGE, shore, left, MAP_EDGE)];
  if (hasRiver) land.push(box(right, shore, MAP_EDGE, MAP_EDGE));
  const dryTown = land.map(dry => clipRingRect(outline, dry));
  const bounds = bbox(dryTown.flatMap(ring => ring.map(project)));
  const plan: CityPreviewPlan = { bounds, water: [], banks: [], blocks: [], roads: [], walls: [], gates: [], bridges: [], docks: [], landmarks: [], squares: [] };
  if (coast) {
    const bank = projectedPath([v2(-380, shore), v2(380, shore)], project);
    plan.water.push([project(v2(-MAP_EDGE, shore)), ...bank, project(v2(MAP_EDGE, shore)), project(v2(MAP_EDGE, -MAP_EDGE)), project(v2(-MAP_EDGE, -MAP_EDGE))]);
    plan.banks.push(bank);
  }
  if (hasRiver) {
    const head = coast ? shore - 2 : -MAP_EDGE;
    const south = 360;
    const bankLeft = projectedPath([v2(left, coast ? shore : -360), v2(left, south)], project);
    const bankRight = projectedPath([v2(right, south), v2(right, coast ? shore : -360)], project);
    // River and shore use a single fill; the circuit extends outside the normal viewport.
    plan.water.push([...bankLeft, project(v2(left, MAP_EDGE)), project(v2(right, MAP_EDGE)), ...bankRight, project(v2(right, head)), project(v2(left, head))]);
    if (!coast) plan.banks.push(bankLeft, bankRight);
    else {
      plan.banks = [projectedPath([v2(-380, shore), v2(left, shore)], project), projectedPath([v2(right, shore), v2(380, shore)], project), bankLeft, bankRight];
    }
  }

  const xs = cuts(rng, count, radiusX + 4, planned ? 0.08 : 0.3);
  const ys = cuts(rng, Math.max(2, count - 1), radiusY + 4, planned ? 0.07 : 0.29);
  const mainY = ys[Math.floor(ys.length / 2)];
  const mainX = xs.slice(1, -1).reduce((a, b) => (Math.abs(a + 16) < Math.abs(b + 16) ? a : b), xs[1]);
  const roadCount = hints.roads ?? (population >= 400 ? 3 : 1);
  const routes: { path: [Vec2, Vec2]; axis: Axis }[] = [];
  for (const reach of dryTown) {
    const cross = slice(reach, 'y', mainY);
    if (cross) {
      plan.roads.push(projectedPath(cross, project));
      routes.push({ path: cross, axis: 'y' });
    }
    const spine = slice(reach, 'x', mainX);
    if (spine) {
      plan.roads.push(projectedPath(spine, project));
      routes.push({ path: spine, axis: 'x' });
    }
    if (hints.walls && reach.length > 2) {
      const ring = projectedPath(reach, project, true);
      plan.walls.push([...ring, ring[0]]);
    }
  }
  const exits = routes
    .flatMap(({ path, axis }) =>
      path.map((point, i) => {
        const direction = i === 0 ? -1 : 1;
        const edge = { ...point, [other(axis)]: point[other(axis)] + direction * 28 };
        return { point, edge, axis };
      }),
    )
    .filter(({ point, edge }) => edge.y > shore + 1 && point.y > shore + 1 && (!hasRiver || (point.x < left - 0.05 && edge.x < left) || (point.x > right + 0.05 && edge.x > right)));
  for (const { point, edge, axis } of exits.slice(0, roadCount)) {
    plan.roads.push(projectedPath([point, edge], project));
    if (hints.walls) {
      // A road-width opening in the wall.
      const a = { ...point, [other(axis)]: point[other(axis)] - 4 };
      const b = { ...point, [other(axis)]: point[other(axis)] + 4 };
      plan.gates.push(projectedPath([a, b], project));
    }
  }
  if (hasRiver && routes.some(({ path, axis }) => axis === 'y' && Math.abs(path[1].x - left) < 0.01) && routes.some(({ path, axis }) => axis === 'y' && Math.abs(path[0].x - right) < 0.01)) {
    plan.bridges.push(projectedPath([v2(left - 3, mainY), v2(right + 3, mainY)], project));
  }
  if (hints.port && coast) {
    const x = hasRiver ? left - 15 : radiusX * 0.23;
    plan.docks.push(projectedPath([v2(x - 11, shore + 2), v2(x + 11, shore + 2)], project));
    for (const offset of [-7, 4]) plan.docks.push(projectedPath([v2(x + offset, shore + 3), v2(x + offset, shore - 12)], project));
  } else if (hints.port && hasRiver) {
    plan.docks.push(projectedPath([v2(left + 1.5, mainY + 7), v2(left + 1.5, mainY + 22)], project));
  }

  const blocks: Block[] = [];
  for (let i = 1; i < xs.length; i++)
    for (let j = 1; j < ys.length; j++) {
      const pad = camp ? 4 : 2.3;
      for (const dry of land) {
        const cell = box(Math.max(xs[i - 1] + pad, dry.minX + pad), Math.max(ys[j - 1] + pad, dry.minY + pad), Math.min(xs[i] - pad, dry.maxX - pad), Math.min(ys[j] - pad, dry.maxY - pad));
        if (cell.minX >= cell.maxX || cell.minY >= cell.maxY) continue;
        const ring = clipRingRect(outline, cell);
        if (ring.length < 3 || polygonArea(ring) < 27) continue;
        blocks.push({ ring, tone: rng.int(0, 2) });
      }
    }
  const distanceToCenter = (block: Block) => {
    const p = polygonCentroid(block.ring);
    return Math.hypot(p.x - mainX, p.y - mainY);
  };
  const central = [...blocks].sort((a, b) => distanceToCenter(a) - distanceToCenter(b));
  // Even the smallest village or camp keeps one residential block.
  const reserve = (requested?: boolean) => (requested && central.length > 1 ? central.shift() : undefined);
  const square = reserve(hints.plaza);
  const temple = reserve(hints.temple);
  const keep = reserve(hints.citadel || hints.urbanCastle || hints.capital);
  if (square) plan.squares.push(projectedPath(square.ring, project, true));
  for (const landmark of [temple, keep]) {
    if (!landmark) continue;
    const ring = inset(landmark.ring, 0.28);
    plan.landmarks.push(projectedPath(ring, project, true));
  }
  const residential = blocks.filter(block => block !== square && block !== temple && block !== keep);
  plan.blocks = residential.map(({ ring, tone }) => ({ ring: projectedPath(ring, project, true), tone }));
  return { plan, blocks: residential, project, camp, seed: hints.seed, population };
}

export function detailCityPreview({ blocks, project, camp, seed, population }: PreviewDraft): CityPreviewDetail {
  const rng = new Rng(seed).fork('preview roofs');
  const lanes: Vec2[][] = [],
    roofs: Polygon[] = [];
  for (const { ring } of blocks) {
    const interior = inset(ring, camp ? 0.14 : 0.09);
    const { minX, maxX, minY, maxY } = bbox(interior);
    const width = maxX - minX,
      height = maxY - minY;
    const cols = Math.max(1, Math.min(camp ? 5 : 7, Math.floor(width / (camp ? 7 : 4.2))));
    const rows = Math.max(1, Math.min(camp ? 5 : 7, Math.floor(height / (camp ? 7 : 4.5))));
    const stepX = width / cols,
      stepY = height / rows;
    const laneRow = !camp && rows >= 4 ? Math.floor(rows / 2) : -1;
    const laneY = minY + (laneRow + 0.5) * stepY;
    if (laneRow >= 0) {
      const path = slice(ring, 'y', laneY);
      if (path) lanes.push(projectedPath(path, project));
    }
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        if (j === laneRow || rng.chance(camp ? 0.32 : 0.2)) continue;
        const x = minX + (i + rng.range(0.39, 0.61)) * stepX;
        const y = minY + (j + rng.range(0.39, 0.61)) * stepY;
        const w = stepX * rng.range(0.51, 0.83),
          h = stepY * rng.range(0.48, 0.79);
        const plot = clipRingRect(interior, box(x - w / 2, y - h / 2, x + w / 2, y + h / 2));
        if (plot.length < 3 || polygonArea(plot) < 2.5) continue;
        if (camp) {
          const p = polygonCentroid(plot);
          const size = Math.min(w, h) * 0.32;
          const tent = Array.from({ length: 8 }, (_, k) => v2(p.x + size * Math.cos((k * Math.PI) / 4), p.y + size * Math.sin((k * Math.PI) / 4)));
          roofs.push(projectedPath(tent, project, true));
        } else roofs.push(projectedPath(plot, project, true));
      }
  }
  const limit = Math.max(1, Math.min(1200, Math.round(population / (camp ? 4 : 7))));
  // Draw a deterministic sample when the town's population cannot fill the whole plan.
  for (let i = 0; i < limit && roofs.length > limit; i++) {
    const j = rng.int(i, roofs.length - 1);
    [roofs[i], roofs[j]] = [roofs[j], roofs[i]];
  }
  return { lanes, roofs: roofs.slice(0, limit) };
}
