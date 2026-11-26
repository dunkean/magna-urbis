import type { ExportRect } from '../ui/exportCropGeometry';
import { TREE_BLOCK, TREE_STRIDE, buildNearTreesSteps, type TreeInputs } from '../ui/terrain3dTrees';
import { TREE_MESHES, PAINTED_TREES, SATELLITE_TREES } from '../render/world/treesShader';
import { treeBuildings } from '../render/world/treesBuildings';
import type { Building3dScene, BuildingVector } from '../render/urbanBuildingGeometry';
import { bareMiddleMesh } from '../../../rust/bridge/bareTree';
import { renderV2ZoneUniform } from '../../../rust/bridge/terrainRenderV2Zones';
import { seedHash } from '../../../rust/bridge/terrainAdjust';
import { rustSettlementRaster } from './rustUrban';
import { v2DisplayForestAsync, v2ForestOccupationAsync } from './displayForest';
import { displayTerrainSettings } from './displayBiome';
import { resolveSettingsAppearance } from './appearance';
import { riverCover } from '../render/world/treesWater';
import type { MeshPart } from './mapMesh';
import type { World } from '../gen/types';
import type { V2Settings } from './contracts';

const MAX_TREES = 8000;
const MAX_BLOCKS = 4096;
const clamp = (x: number, low: number, high: number): number => Math.min(high, Math.max(low, x));
const profiles = [
  { height: [0.0, 0.1, 0.3, 0.55, 0.8, 1], radius: [0, 0.72, 0.98, 0.9, 0.68, 0] },
  { height: [0, 0.3, 0.33, 0.62, 0.65, 1], radius: [1, 0.69, 0.86, 0.51, 0.61, 0] },
  { height: [0, 0.3, 0.62, 0.86, 0.96, 1], radius: [0, 0.55, 0.88, 1, 0.92, 0] },
];

export async function exportTreeInputs(world: World, settings: V2Settings): Promise<Omit<TreeInputs, 'height'> | undefined> {
  const selected = resolveSettingsAppearance(settings, world, 'export');
  if (selected.underdark) return;
  // Cartographic styles may paint symbols only. The terrain's same procedural stand is still available for geometry.
  const recipe = selected.composition.recipe;
  const forestLook = selected.composition.vegetation.procedural
    ? selected
    : resolveSettingsAppearance({ ...settings, appearance: { ...settings.appearance, style: settings.options.style, composition: { ...recipe, vegetation: { ...recipe.vegetation, look: 'procedural-canopy' } } } }, world, 'export');
  const [field, occupation] = await Promise.all([v2DisplayForestAsync(world, settings, forestLook), v2ForestOccupationAsync(world)]);
  if (!field) return;
  const { climateValues, climateZone } = displayTerrainSettings(settings, world.mapSize);
  if (!climateValues) return;
  const raster = rustSettlementRaster(world);
  // A retained river can cross between raster cell centres. Use its drawn extent where it is available.
  const segments = world.terrain.rivers.flatMap(river =>
    river.path.slice(1).flatMap((b, i) => {
      const a = river.path[i],
        ra = river.width[i] ?? 0,
        rb = river.width[i + 1] ?? ra;
      return [a.x, a.y, b.x, b.y, ra, rb, 0, 0, 0];
    }),
  );
  const riverAt = segments.length ? riverCover(Float32Array.from(segments)) : undefined;
  const cells = raster.n / raster.width;
  const water = (x: number, y: number): number => {
    const i = clamp(Math.floor(y * cells), 0, raster.n - 1) * raster.n + clamp(Math.floor(x * cells), 0, raster.n - 1);
    const code = raster.rock?.[i] ? 0 : raster.water[i];
    return code === 1 || code === 2 || (riverAt ? riverAt(x, y) : code === 3) ? 1 : 0;
  };
  return {
    field,
    occupation,
    seed: seedHash(world.seed),
    climate: climateValues,
    climateZone,
    zone: renderV2ZoneUniform(climateZone),
    season: selected.ground.season,
    calendar: selected.ground.calendar,
    renderV2: selected.traits.satelliteVariant || 1,
    paperMap: selected.traits.paperMap || selected.styleId === 'parchment',
    water,
  };
}

function treeColor(rgb: readonly number[], snow: number): string {
  const white = [0.84, 0.88, 0.9];
  return '#' + rgb.map((x, i) => (Math.round(clamp(x + (white[i] - x) * snow, 0, 1) * 15) * 17).toString(16).padStart(2, '0')).join('');
}

/** Meshes made from the same lattice, species and world-view indexed silhouettes, independent of camera distance. */
export function* exportTreeParts(inputs: TreeInputs, area: ExportRect, buildings?: Building3dScene): Generator<void, MeshPart[]> {
  const rect = { minX: Math.floor(area.x / TREE_BLOCK) * TREE_BLOCK, minY: Math.floor(area.y / TREE_BLOCK) * TREE_BLOCK, maxX: Math.ceil((area.x + area.width) / TREE_BLOCK) * TREE_BLOCK, maxY: Math.ceil((area.y + area.height) / TREE_BLOCK) * TREE_BLOCK };
  const parallel = Math.ceil(Math.sqrt(((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / TREE_BLOCK ** 2 / MAX_BLOCKS));
  const trees = yield* buildNearTreesSteps(inputs, { x: area.x, y: area.y, forwardX: 0, forwardY: 1, area: rect, areaBlockStep: parallel });
  const occupied = treeBuildings(buildings);
  const kept: number[] = [];
  for (let i = 0; i < trees.length; i += TREE_STRIDE) {
    const x = trees[i],
      y = trees[i + 1];
    if (x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height && (!occupied || occupied.keeps(x, y, trees[i + 3]))) kept.push(i);
  }
  const parts = new Map<string, { positions: number[]; normals: number[] }>();
  const count = Math.min(MAX_TREES, kept.length);
  const palette = inputs.paperMap ? PAINTED_TREES : SATELLITE_TREES;
  for (let j = 0; j < count; j++) {
    const i = kept[Math.floor((j * kept.length) / count)];
    const [x, y, z, r, h, depth, form, phase, red, green, blue, flags] = trees.subarray(i, i + TREE_STRIDE);
    const conifer = form === 1 || form === 3,
      parasol = form >= 2,
      bare = flags >= 1;
    const bottom = clamp(h - depth, 0.02 * h, 0.75 * h);
    const stem = Math.max(conifer ? h / 90 : h / 64, r / (conifer ? 8 : 12), 0.17);
    const snow = clamp((flags % 1) / 0.45, 0, 0.95);
    const trunk = treeColor(palette.trunk, bare ? snow * 0.25 : 0),
      crown = treeColor([red, green, blue], snow);
    const source = bare ? bareMiddleMesh : TREE_MESHES[1];
    const profile = profiles[parasol ? 2 : conifer ? 1 : 0];
    const points: BuildingVector[] = [];
    const cos = Math.cos(phase),
      sin = Math.sin(phase);
    for (let v = 0; v < source.vertices.length; v += 4) {
      const [ring, shape, u, vAxis] = source.vertices.slice(v, v + 4);
      let altitude: number, a: number, b: number;
      if (bare) {
        a = ring * r;
        b = u * r;
        altitude = shape * h;
      } else {
        const k = form === 1 && ring === 2 ? 0 : ring;
        const width = ring < 0 ? (ring === -2 ? stem * 1.3 : stem * 0.78) : r * profile.radius[k];
        a = u * width + (parasol && ring >= 0 ? 0.14 * r * profile.height[k] : 0);
        b = vAxis * width;
        altitude = ring === -2 ? -0.25 : ring === -3 ? bottom + 0.25 * (h - bottom) : bottom + profile.height[k] * (h - bottom);
      }
      points.push([x - area.x + a * cos - b * sin, z + altitude, y - area.y + a * sin + b * cos]);
    }
    for (let k = 0; k < source.indices.length; k += 3) {
      const a = points[source.indices[k]],
        b = points[source.indices[k + 2]],
        c = points[source.indices[k + 1]];
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(...normal);
      if (!length) continue;
      const tint = bare || k < 12 ? trunk : crown;
      let batch = parts.get(tint);
      if (!batch) parts.set(tint, (batch = { positions: [], normals: [] }));
      const n = normal.map(v => v / length);
      batch.positions.push(...a, ...b, ...c);
      batch.normals.push(...n, ...n, ...n);
    }
    if (j % 128 === 0) yield;
  }
  return [...parts].map(([color, part]) => ({ name: 'Trees', color, positions: Float32Array.from(part.positions), normals: Float32Array.from(part.normals) }));
}
