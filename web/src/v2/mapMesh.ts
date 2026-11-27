import type { World } from '../gen/types';
import type { ExportLayers } from '../render/exportLayers';
import { TerrainHeights } from '../render/world/heights';
import { groundShapeSteps } from '../render/world/groundShape';
import { city3dBuildingsSteps, city3dFarmBuildings, city3dFarmSources, city3dPadSteps, city3dStructures, city3dWithExtras } from '../render/city3d/display';
import { city3dWorldHeight } from '../render/city3d/seatedMeshes';
import { COVERS, WALLS } from '../render/city3d/materials';
import { placeholderPlacedBuildings } from '../render/farmRoofs';
import { eachBuildingTriangle, type Building3dVisual, type BuildingTriangle, type BuildingVector } from '../render/urbanBuildingGeometry';
import { houseMaterialColor } from '../../../rust/bridge/houseRender';
import { blockOutlines, groundShapeLots } from '../ui/urbanGroundShape';
import { UrbanGroundCuts } from '../ui/urbanGroundCuts';
import type { ExportRect } from '../ui/exportCropGeometry';
import { nativeCitiesOf, nativeTerrainOf } from './nativeProducts';
import { activityScene } from './activitySites';
import { combineV2NativeScenes, withV2ActivityScene } from './urban3d';
import { townRoadStreets } from './rustUrban';
import type { TreeInputs } from '../ui/terrain3dTrees';
import { exportTreeParts } from './exportTrees';
import type { MapMetadata } from './exportMetadata';

export interface MeshPart {
  name: string;
  color: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array;
  featureRanges?: { sourceId: string; firstTriangle: number; triangleCount: number }[];
}

export interface MapMesh {
  parts: MeshPart[];
  origin: { x: number; y: number };
  width: number;
  depth: number;
  lowestPoint: number;
  highestPoint: number;
  metadata?: MapMetadata;
}

/** East, up, south in a right-handed system. Altitude stays measured from sea level. */
const metricPoint = ([x, y, z]: BuildingVector, area: ExportRect): BuildingVector => [x - area.x, z, y - area.y];
const metricNormal = ([x, y, z]: BuildingVector): BuildingVector => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, z / length, y / length];
};

async function finish<T>(work: Generator<void, T>): Promise<T> {
  let frame = performance.now();
  for (let step = work.next(); ; step = work.next()) {
    if (step.done) return step.value;
    if (performance.now() - frame > 12) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      frame = performance.now();
    }
  }
}

function terrainMesh(heightAt: (x: number, y: number) => number, area: ExportRect, resolution: number): MeshPart {
  const edge = Math.max(area.width, area.height),
    nx = Math.max(1, Math.round((resolution * area.width) / edge)),
    ny = Math.max(1, Math.round((resolution * area.height) / edge)),
    count = (nx + 1) * (ny + 1);
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3),
    uvs = new Float32Array(count * 2);
  const indices = new Uint32Array(nx * ny * 6);
  const sx = area.width / nx,
    sy = area.height / ny;
  for (let y = 0; y <= ny; y++)
    for (let x = 0; x <= nx; x++) {
      const i = y * (nx + 1) + x,
        east = area.x + x * sx,
        south = area.y + y * sy;
      positions.set([x * sx, heightAt(east, south), y * sy], i * 3);
      const dx = (heightAt(east + sx / 2, south) - heightAt(east - sx / 2, south)) / sx;
      const dy = (heightAt(east, south + sy / 2) - heightAt(east, south - sy / 2)) / sy;
      normals.set(metricNormal([-dx, -dy, 1]), i * 3);
      uvs.set([x / nx, y / ny], i * 2);
      if (x < nx && y < ny) {
        const next = i + nx + 1;
        indices.set([i, next, i + 1, i + 1, next, next + 1], (y * nx + x) * 6);
      }
    }
  return { name: 'Terrain', color: '#ffffff', positions, normals, uvs, indices };
}

function clipTriangle(points: BuildingTriangle['points'], area: ExportRect): BuildingVector[] {
  let polygon: BuildingVector[] = points;
  for (const [axis, limit, sign] of [
    [0, area.x, 1],
    [0, area.x + area.width, -1],
    [1, area.y, 1],
    [1, area.y + area.height, -1],
  ] as const) {
    const inside = (p: BuildingVector) => (p[axis] - limit) * sign >= 0;
    if (polygon.every(inside)) continue;
    const clipped: BuildingVector[] = [];
    for (const [i, dst] of polygon.entries()) {
      const src = polygon[(i + polygon.length - 1) % polygon.length],
        a = inside(src),
        b = inside(dst);
      if (a !== b) {
        const t = (limit - src[axis]) / (dst[axis] - src[axis]);
        const point = src.map((value, k) => value + (dst[k] - value) * t) as BuildingVector;
        point[axis] = limit;
        clipped.push(point);
      }
      if (b) clipped.push(dst);
    }
    if (clipped.length < 3) return [];
    polygon = clipped;
  }
  return polygon;
}

function nearArea(building: Building3dVisual, rect: ExportRect): boolean {
  const margin = 18;
  return building.footprint.some(({ outer }) => !outer.every(p => p.x < rect.x - margin) && !outer.every(p => p.x > rect.x + rect.width + margin) && !outer.every(p => p.y < rect.y - margin) && !outer.every(p => p.y > rect.y + rect.height + margin));
}

function* objectParts(objects: readonly Building3dVisual[], area: ExportRect, group: string, materialColor: (id: string) => string, trackFeatures: boolean): Generator<void, MeshPart[]> {
  const batches = new Map<string, { positions: number[]; normals: number[]; featureRanges?: NonNullable<MeshPart['featureRanges']> }>();
  for (const [index, building] of objects.entries()) {
    if (!nearArea(building, area)) continue;
    eachBuildingTriangle(
      building,
      triangle => {
        const polygon = clipTriangle(triangle.points, area);
        if (polygon.length < 3) return;
        const material = triangle.material ?? (triangle.surface === 'roof' ? triangle.materials.cladding : triangle.materials.coating);
        const color = materialColor(material);
        let batch = batches.get(color);
        if (!batch) batches.set(color, (batch = { positions: [], normals: [] }));
        const normal = metricNormal(triangle.normal);
        const a = metricPoint(polygon[0], area);
        for (let i = 1; i + 1 < polygon.length; i++) {
          const b = metricPoint(polygon[i], area),
            c = metricPoint(polygon[i + 1], area);
          const [ux, uy, uz] = b.map((v, k) => v - a[k]),
            [vx, vy, vz] = c.map((v, k) => v - a[k]);
          const dot = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
          if (Math.abs(dot) < 1e-9) continue;
          if (trackFeatures) {
            const ranges = (batch.featureRanges ??= []);
            const last = ranges.at(-1);
            if (last?.sourceId === building.id) last.triangleCount++;
            else ranges.push({ sourceId: building.id, firstTriangle: batch.positions.length / 9, triangleCount: 1 });
          }
          batch.positions.push(...a, ...(dot < 0 ? c : b), ...(dot < 0 ? b : c));
          batch.normals.push(...normal, ...normal, ...normal);
        }
      },
      false,
      undefined,
      0,
      false,
      true,
    );
    if (index % 16 === 0) yield;
  }
  return [...batches].flatMap(([color, batch]) => (batch.positions.length ? [{ name: group, color, positions: Float32Array.from(batch.positions), normals: Float32Array.from(batch.normals), featureRanges: batch.featureRanges }] : []));
}

export async function mapMesh(world: World, area: ExportRect, resolution: number, layers: Partial<ExportLayers>, groundShaping: boolean, terraces: boolean, trees?: Omit<TreeInputs, 'height'>, metadata?: MapMetadata): Promise<MapMesh> {
  const native = nativeTerrainOf(world);
  const grid = world.terrain.height;
  const n = native?.field?.n ?? native?.resolution ?? grid.w;
  const data = native?.field?.data ?? native?.height ?? grid.data;
  const terrain = new TerrainHeights(data, n, world.mapSize, -Infinity, 1);
  const natural = (x: number, y: number) => terrain.naturalAt(x, y);
  const cities = layers.city === false ? [] : nativeCitiesOf(world);
  const layouts = cities.flatMap(city => city.layouts);
  const source = withV2ActivityScene(combineV2NativeScenes(cities), layers.city === false ? undefined : activityScene(world));
  const local = source && { ...source, buildings: source.buildings.filter(building => nearArea(building, area)) };
  const ground = { at: natural, cut: groundShaping, blockAt: blockOutlines(layouts) };
  const farms = layers.city === false ? [] : city3dFarmSources(world.landuse?.farmsteads, placeholderPlacedBuildings(world), natural).filter(building => nearArea(building, area));
  if (groundShaping && layouts.length) {
    const pads = await finish(city3dPadSteps([...(local?.buildings ?? []), ...farms], ground));
    const lots = groundShapeLots(
      cities.flatMap(city => city.partitions ?? []),
      pads,
      true,
    );
    const streets = layers.streets === false ? [] : layouts.flatMap(layout => layout.streets);
    terrain.shape = await finish(groundShapeSteps(world.mapSize, [{ lots, streets }], new UrbanGroundCuts(layouts.flatMap(layout => layout.enclosures ?? [])), natural));
  }
  const heightAt = city3dWorldHeight(terrain);
  const display = await finish(city3dBuildingsSteps(local, { heightAt, ground, terraces }));
  const farmMeshes = city3dFarmBuildings(farms, { heightAt, ground });
  const works = city3dStructures(layouts, layers.roads === false ? [] : townRoadStreets(world), { height: heightAt, quayHeight: heightAt }, undefined, layers.water !== false);
  const materialScene = city3dWithExtras(display, [...farmMeshes, ...works.walls, ...works.bridges, ...works.quays, ...works.boardwalks]);
  const catalogue = { materials: materialScene?.materials ?? [] };
  const materialColor = (id: string): string => {
    const tint = /@([0-9a-f]{6})$/i.exec(id);
    if (tint) return '#' + tint[1];
    if (id === 'city3d:water') return '#8aaeb8';
    const material = /^city3d:(wall|cover):(.+)$/.exec(id);
    const pattern = material?.[1] === 'wall' ? WALLS[material[2]] : material ? COVERS[material[2]] : undefined;
    return houseMaterialColor(catalogue, pattern ? 'city3d:' + pattern : id);
  };
  const parts: MeshPart[] = [];
  if (layers.terrain !== false) parts.push(terrainMesh((x, y) => terrain.heightAt(x, y), area, resolution));
  for (const [name, models] of [
    ['Buildings', [...(display?.buildings ?? []), ...farmMeshes]],
    ['Fortifications', works.walls],
    ['Bridges', works.bridges],
    ['Waterfront', [...works.quays, ...works.boardwalks]],
  ] as const)
    parts.push(...(await finish(objectParts(models, area, name, materialColor, !!metadata))));
  if (trees) parts.push(...(await finish(exportTreeParts({ ...trees, height: (x, y) => terrain.heightAt(x, y) }, area, materialScene))));
  let lowestPoint = Infinity,
    highestPoint = -Infinity;
  for (const part of parts) {
    for (let i = 1; i < part.positions.length; i += 3) {
      lowestPoint = Math.min(lowestPoint, part.positions[i]);
      highestPoint = Math.max(highestPoint, part.positions[i]);
    }
  }
  return { parts, origin: { x: area.x, y: area.y }, width: area.width, depth: area.height, lowestPoint, highestPoint, metadata };
}
