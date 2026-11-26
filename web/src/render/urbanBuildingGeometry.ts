import type { MaterialSlots, Point, Surface } from '../../../rust/bridge/housesContract';
import type { ArchitectureVolume, PlacedBuilding } from '../../../rust/bridge/urbanArchitecture';
import type { HouseMaterial } from '../../../rust/bridge/housesContract';
import type { NativeBuildingProjection } from '../ui/urbanBuildingProjection';
import type { ParentMember3dVisual } from '../ui/urbanParent3d';
import { retainBuildingFeature, type BuildingFeatureLod } from './urbanBuildingFeatureLod';
import { earcut } from './cityGlEarcut';
import type { RoofMesh } from './city3d/types';
import { boundaryOf, emitBoundary } from './craftedBoundaries';
import { craftedYurt } from './craftedYurt';
import { craftedArchitecture } from './craftedArchitecture';
import { craftedRoofMesh } from './craftedRoofMesh';
import { craftedMageCity } from './craftedMageCity';
import { architectureUse } from './siteArchitecture';
import { siteCrown } from './siteCrown';
import { ruralSiteDetails } from './ruralSiteDetail';
import { detailedHouseFront } from './houseFronts';
import { craftedRoofRoom } from './craftedRoofRoom';
import { craftedIndianMassing } from './craftedIndianMassing';

export type BuildingVector = [number, number, number];
export interface OverviewVolume extends ArchitectureVolume {
  /** Original preview footprint when a single parcel contains several working buildings. */
  ruralPiece?: number;
  /** Source tree and platform sites for the crafted dwelling. */
  displayTree?: import('./cityTrees').TreeDwelling;
  /** Raised deck height above its source seat, for stairs and ladders. */
  stiltHeight_m?: number;
  /** The massing roof shape, including profiles sharing the same native family (a barrel and a gable). */
  displayRoofForm?: import('./cityMassing').MassingRoof;
  /** Main roof pans and gables to draw in place of the overview cap. */
  overview_roof_faces?: [number, number];
  /** Standing details that remain visible at the overview scale, such as sails. */
  overview_faces?: [number, number];
}
const FACE_TRIANGLES = new WeakMap<object, number[]>();
/** Native roof pans can be concave. Triangulate in their own plane so a fan
 * cannot cover a neighbouring pan or courtyard when the near LOD appears. */
function faceTriangles(mesh: RoofMesh, face: RoofMesh['faces'][number]): number[] {
  const cached = FACE_TRIANGLES.get(face);
  if (cached) return cached;
  const indices = face.vertices;
  if (indices.length === 3) return indices;
  if (indices.some(i => !mesh.vertices[i])) return [];
  const n = face.normal.map(Math.abs),
    drop = n.indexOf(Math.max(...n));
  const coords = indices.flatMap(i => {
    const p = mesh.vertices[i];
    return drop === 0 ? [p.y, p.z] : drop === 1 ? [p.x, p.z] : [p.x, p.y];
  });
  const triangles = earcut(coords).map(i => indices[i]);
  FACE_TRIANGLES.set(face, triangles);
  return triangles;
}

function emitRoofFaces(mesh: RoofMesh, materials: MaterialSlots, emit: (triangle: BuildingTriangle) => void, start = 0, end = mesh.faces.length): void {
  for (let f = start; f < end && f < mesh.faces.length; f++) {
    const face = mesh.faces[f],
      { hiddenEdge } = face;
    const triangles = faceTriangles(mesh, face);
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const points = triangles.slice(i, i + 3).map(index => mesh.vertices[index]);
      if (points.some(p => !p)) continue;
      const triangle: BuildingTriangle = { points: points.map(p => [p.x, p.y, p.z]) as BuildingTriangle['points'], normal: face.normal, materials, material: face.material, surface: 'roof' };
      if ((face as { entrance?: true }).entrance) triangle.entrance = true;
      if (hiddenEdge !== undefined) triangle.hiddenEdge = hiddenEdge;
      emit(triangle);
    }
  }
}
/** `yard`: a lot boundary, its own class: the building colours never reach it. `ground`: the ground under each point, when the
 * mesh does not stand on one level. `lateral`: the side of the line each point of a strip lies on (unit plan vectors): the
 * tilted map's shader widens the strip along it as it gets thin on screen; its face is level when `normal` points up. */
export interface BuildingTriangle {
  points: [BuildingVector, BuildingVector, BuildingVector];
  normal: BuildingVector;
  surface: 'wall' | 'roof' | 'yard';
  materials: MaterialSlots;
  material?: string;
  entrance?: true;
  /** Side from this vertex to the next, internal to a roof pan. */
  hiddenEdge?: number;
  ground?: [number, number, number];
  lateral?: [Point, Point, Point];
}
/** Display works can retain separate solid prisms, so gate lintels do not fill their passages. */
export interface BuildingWalkSolid {
  footprint: Surface;
  z_min_m: number;
  z_max_m: number;
}
/** A cartographic projection is never a PlacedBuilding or a realization input. */
export type Building3dVisual = (PlacedBuilding | NativeBuildingProjection | ParentMember3dVisual) & { walkSolids?: readonly BuildingWalkSolid[] };
export interface Building3dScene {
  grove?: import('./city3d/groveInstances').GroveInstances;
  buildings: readonly Building3dVisual[];
  materials?: HouseMaterial[];
  /** Accepted source records for terrain/forest exclusion, independent of
   * purely visual exterior overlays. Omitted on legacy scenes. */
  occupationBuildings?: readonly Building3dVisual[];
}
/** A projection whose walls start below its ground, at the bottom of the footing of the building it stands for. */
export interface FootedProjection {
  base_z_m?: number;
}
export function isBuildingProjection(building: Building3dVisual): building is NativeBuildingProjection | ParentMember3dVisual {
  return 'projection' in building && (building.projection === 'native-building-visual-1' || building.projection === 'native-parent-member-3d-1');
}
export function building3dHeight(building: Building3dVisual): number {
  if (isBuildingProjection(building)) return building.height_m;
  return building.cartographic?.height_m ?? building.volumes.reduce((height, v) => Math.max(height, v.z_m + v.wall_height_m + v.roof_height_m - building.ground_z_m), 0);
}
/** A point of a lot boundary: `mx, my` is its left offset (mitred on the vertices), `s` its arc length, `g` the ground under it. */
export interface YardStation {
  x: number;
  y: number;
  mx: number;
  my: number;
  s: number;
  g: number;
}
/** A run of lot boundary for the ribbon levels: its line, height above the ground, real half width and two materials. */
export interface YardLine {
  stations: YardStation[];
  closed: boolean;
  height: number;
  half: number;
  side: string;
  top: string;
}
/** What a lot boundary batch adds to its near mesh (the volume's `roof_mesh`): the ground of each mesh vertex and the ribbons. */
export interface YardMesh {
  ground: number[];
  lines: YardLine[];
  sheetFaces?: [number, number][];
}
/** Levels of a lot boundary: 0 the full mesh; then a plain ribbon. Pixels per metre below which each level starts, and the
 * ribbon's smallest half width there, which keeps the fence on screen once a post or a sheet is well under a pixel. */
const YARD_LEVELS = [
  { pixels: Infinity, half: 0 },
  { pixels: 3.3, half: 0.16 },
  { pixels: 0.8, half: 0.5 },
];
export function yardLod(pixels: number, previous = 0): number {
  let lod = 0;
  for (let i = 1; i < YARD_LEVELS.length; i++) if (pixels < YARD_LEVELS[i].pixels * (i <= previous ? 1.15 : 1)) lod = i;
  return lod;
}
export const isYardMesh = (building: Building3dVisual): boolean => 'yard' in building;
/** Quads of the ribbon: both sides and the top per stretch, caps at the free ends. */
function yardRibbon(line: YardLine, lod: number, materials: MaterialSlots, emit: (triangle: BuildingTriangle) => void): void {
  const half = Math.max(line.half, YARD_LEVELS[lod].half),
    S = line.stations;
  const quad = (a: BuildingVector, b: BuildingVector, c: BuildingVector, d: BuildingVector, ga: number, gb: number, normal: BuildingVector, material: string): void => {
    emit({ points: [a, b, c], normal, materials, material, surface: 'yard', ground: [ga, gb, gb] });
    emit({ points: [a, c, d], normal, materials, material, surface: 'yard', ground: [ga, gb, ga] });
  };
  const side = (p: YardStation, q: YardStation, o: number, normal: BuildingVector, material: string): void => {
    const px = p.x + p.mx * o,
      py = p.y + p.my * o,
      qx = q.x + q.mx * o,
      qy = q.y + q.my * o;
    quad([px, py, p.g - 0.15], [qx, qy, q.g - 0.15], [qx, qy, q.g + line.height], [px, py, p.g + line.height], p.g, q.g, normal, material);
  };
  for (let j = 1; j < S.length; j++) {
    const p = S[j - 1],
      q = S[j],
      l = Math.hypot(q.x - p.x, q.y - p.y) || 1,
      nx = -(q.y - p.y) / l,
      ny = (q.x - p.x) / l;
    side(p, q, half, [nx, ny, 0], line.side);
    side(p, q, -half, [-nx, -ny, 0], line.side);
    const z0 = p.g + line.height,
      z1 = q.g + line.height;
    quad([p.x + p.mx * half, p.y + p.my * half, z0], [q.x + q.mx * half, q.y + q.my * half, z1], [q.x - q.mx * half, q.y - q.my * half, z1], [p.x - p.mx * half, p.y - p.my * half, z0], p.g, q.g, [0, 0, 1], line.top);
  }
  if (!line.closed)
    for (const [p, sign] of [
      [S[0], -1],
      [S[S.length - 1], 1],
    ] as const) {
      const a: BuildingVector = [p.x + p.mx * half, p.y + p.my * half, p.g - 0.15],
        b: BuildingVector = [p.x - p.mx * half, p.y - p.my * half, p.g - 0.15];
      quad(a, b, [b[0], b[1], p.g + line.height], [a[0], a[1], p.g + line.height], p.g, p.g, [sign * p.my, -sign * p.mx, 0], line.side);
    }
}
/** A lot boundary as a strip at its real width: its top, and both sides while they span a pixel (`sides`). The tilted map
 * draws it past the near mesh at every distance (its shader keeps it about a pixel wide, then sinks it into the ground),
 * so a boundary never jumps from one width to another. */
function yardStrip(line: YardLine, sides: boolean, materials: MaterialSlots, emit: (triangle: BuildingTriangle) => void): void {
  const { half, height, stations } = line;
  const edge = (s: YardStation, sign: number): { at: (z: number) => BuildingVector; side: Point; g: number } => {
    const l = Math.hypot(s.mx, s.my) || 1;
    return { at: z => [s.x + sign * s.mx * half, s.y + sign * s.my * half, s.g + z], side: { x: (sign * s.mx) / l, y: (sign * s.my) / l }, g: s.g };
  };
  type Edge = ReturnType<typeof edge>;
  const quad = (corners: readonly [Edge, number][], normal: BuildingVector, material: string): void => {
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 3],
    ]) {
      const [a, b, c] = [corners[i], corners[j], corners[k]];
      emit({ points: [a[0].at(a[1]), b[0].at(b[1]), c[0].at(c[1])], normal, materials, material, surface: 'yard', ground: [a[0].g, b[0].g, c[0].g], lateral: [a[0].side, b[0].side, c[0].side] });
    }
  };
  for (let j = 1; j < stations.length; j++) {
    const p = stations[j - 1],
      q = stations[j],
      pairs = [1, -1].map(sign => [edge(p, sign), edge(q, sign)] as const),
      [[pl, ql], [pr, qr]] = pairs;
    quad(
      [
        [pl, height],
        [ql, height],
        [qr, height],
        [pr, height],
      ],
      [0, 0, 1],
      line.top,
    );
    if (!sides) continue;
    for (const [a, b] of pairs)
      quad(
        [
          [a, -0.15],
          [b, -0.15],
          [b, height],
          [a, height],
        ],
        [a.side.x, a.side.y, 0],
        line.side,
      );
  }
}
/** A display volume seated below its building's ground (a barn downhill of its house, city3dMeshes.ts) names its own
 * ground: under the relief exaggeration its walls keep their height above that ground, not above the building's. */
export type SeatedVolume = PlacedBuilding['volumes'][number] & { ground_m?: number };
/** `role` of a small decorative display volume (city3dMeshes.ts): drawn in the detailed mesh, left out of the overview. */
export const MINOR_VOLUME_ROLE = 'minor';
const PROXY_MATERIALS: MaterialSlots = { frame: '', infill: '', coating: '', cladding: '', base: '', roof_frame: '' };

/** Exact even-odd horizontal trapezoids, split only at boundary vertices. This
 * display triangulation retains holes and changes no native boundary. */
export function surfaceTriangles(surface: Surface): [Point, Point, Point][] {
  const triangles: [Point, Point, Point][] = [];
  for (const shape of surface) {
    const rings = [shape.outer, ...shape.holes];
    const ys = [...new Set(rings.flatMap(r => r.map(p => p.y)))].sort((a, b) => a - b);
    for (let j = 1; j < ys.length; j++) {
      const low = ys[j - 1],
        high = ys[j],
        middle = (low + high) / 2;
      const edges: { a: Point; b: Point; x: number }[] = [];
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          if (middle > Math.min(a.y, b.y) && middle < Math.max(a.y, b.y)) edges.push({ a, b, x: a.x + ((middle - a.y) / (b.y - a.y)) * (b.x - a.x) });
        }
      edges.sort((a, b) => a.x - b.x);
      const at = (edge: (typeof edges)[number], y: number): Point => ({ x: edge.a.x + ((y - edge.a.y) / (edge.b.y - edge.a.y)) * (edge.b.x - edge.a.x), y });
      for (let i = 0; i + 1 < edges.length; i += 2) {
        const a = at(edges[i], low),
          b = at(edges[i + 1], low),
          c = at(edges[i + 1], high),
          d = at(edges[i], high);
        if (b.x - a.x > 1e-9) triangles.push([a, b, c]);
        if (c.x - d.x > 1e-9) triangles.push([a, c, d]);
      }
    }
  }
  return triangles;
}

/** One display mesh iterator shared by GPU preparation and picking. All z are
 * absolute physical metres; roof faces are copied from native geometry. `yardStrips`: the coarse levels of a lot
 * boundary are strips (the tilted map) instead of ribbons of a fixed width per level. */
export function eachBuildingTriangle(building: Building3dVisual, emit: (triangle: BuildingTriangle) => void, overview = false, featureLod?: BuildingFeatureLod, yardLevel = overview ? 1 : 0, yardStrips = false, crafted = false): void {
  const boundary = crafted && !overview && !isBuildingProjection(building) ? boundaryOf(building) : undefined;
  if (isYardMesh(building)) {
    const {
      yard,
      volumes: [{ roof_mesh: mesh, materials }],
    } = building as PlacedBuilding & { yard: YardMesh };
    if (yardLevel > 0) {
      for (const line of yard.lines) {
        if (yardStrips) yardStrip(line, yardLevel === 1, materials, emit);
        else yardRibbon(line, yardLevel, materials, emit);
      }
      return;
    }
    if (boundary) emitBoundary(building as PlacedBuilding, boundary, emit);
    const skip = boundary ? yard.sheetFaces : undefined;
    let range = 0;
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      while (skip && range < skip.length && fi >= skip[range][1]) range++;
      if (skip && range < skip.length && fi >= skip[range][0]) continue;
      const face = mesh.faces[fi];
      for (let i = 1; i + 1 < face.vertices.length; i++) {
        const v = [face.vertices[0], face.vertices[i], face.vertices[i + 1]];
        emit({ points: v.map(k => [mesh.vertices[k].x, mesh.vertices[k].y, mesh.vertices[k].z]) as BuildingTriangle['points'], normal: face.normal, materials, material: face.material, surface: 'yard', ground: v.map(k => yard.ground[k]) as [number, number, number] });
      }
    }
    return;
  }
  if (boundary) {
    emitBoundary(building as PlacedBuilding, boundary, emit);
    if (boundary.replace) return;
    // These volumes already carry their curtain or gate mesh.
    crafted = false;
  }
  // `out` is `emit`, or for a seated volume `emit` with the volume's own ground under each point.
  let out = emit;
  const extrude = (surface: Surface, z: number, height: number, materials: MaterialSlots, cap: boolean, material?: string): void => {
    if (height <= 1e-8) return;
    for (const shape of surface)
      for (const [ri, ring] of [shape.outer, ...shape.holes].entries()) {
        let area = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          area += a.x * b.y - b.x * a.y;
        }
        const sign = (area >= 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length],
            dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          if (length < 1e-8) continue;
          const normal: BuildingVector = [(sign * dy) / length, (-sign * dx) / length, 0];
          out({
            points: [
              [a.x, a.y, z],
              [b.x, b.y, z],
              [b.x, b.y, z + height],
            ],
            normal,
            materials,
            material,
            surface: 'wall',
          });
          out({
            points: [
              [a.x, a.y, z],
              [b.x, b.y, z + height],
              [a.x, a.y, z + height],
            ],
            normal,
            materials,
            material,
            surface: 'wall',
          });
        }
      }
    if (cap) for (const triangle of surfaceTriangles(surface)) out({ points: triangle.map(p => [p.x, p.y, z + height]) as BuildingTriangle['points'], normal: [0, 0, 1], materials, material, surface: 'wall' });
  };
  if (isBuildingProjection(building)) {
    // Display-only height extrusion and horizontal roof-outline cap. These are
    // explicitly cartographic proxies, never fabricated native walls, volumes,
    // foundations, gables or source draws. Picking uses these same triangles.
    const height = building.height_m, materials = building.materials ?? PROXY_MATERIALS,
      base = Math.min(building.ground_z_m, (building as FootedProjection).base_z_m ?? Infinity);
    extrude(building.footprint, base, building.ground_z_m + height - base, materials, false);
    for (const triangle of surfaceTriangles(building.roof_footprint)) emit({ points: triangle.map(p => [p.x, p.y, building.ground_z_m + height]) as BuildingTriangle['points'], normal: [0, 0, 1], materials, material: materials.cladding, surface: 'roof' });
    return;
  }
  if (crafted && building.culture?.culture === 'wizard-city') building = craftedMageCity(building);
  const works = crafted && !overview ? ruralSiteDetails(building) : undefined;
  const front = crafted && !overview ? detailedHouseFront(building) : null;
  const use = crafted && !overview ? architectureUse(building) : undefined;
  const crown = crafted && !overview ? siteCrown(building) : undefined;
  const roofRoom = crafted && !overview ? craftedRoofRoom(building) : null;
  for (const volume of building.volumes as OverviewVolume[]) {
    // Chimneys, dormers and porches are far below a pixel where the overview is shown.
    if (overview && volume.role === MINOR_VOLUME_ROLE) continue;
    const seat = (volume as SeatedVolume).ground_m;
    out =
      seat === undefined
        ? emit
        : t => {
            t.ground = [Math.min(t.points[0][2], seat), Math.min(t.points[1][2], seat), Math.min(t.points[2][2], seat)];
            emit(t);
          };
    const rural = works?.get(volume);
    if (rural) {
      if (rural.volume === volume) emitRoofFaces(rural.mesh, volume.materials, out);
      if (rural.replace) continue;
    }
    const foundation = volume.foundation;
    // A footing right under its walls needs no top: its edge would show as a line around the house.
    if (foundation) extrude(foundation.footprint, foundation.z_min_m, foundation.z_max_m - foundation.z_min_m, volume.materials, volume.envelope === 'open' || foundation.footprint[0] !== volume.levels[0]?.footprint[0]);
    if (volume.envelope !== 'open') for (const level of volume.levels) extrude(level.footprint, level.z_m, level.height_m, level.materials ?? volume.materials, false);
    const mesh = volume.roof_mesh;
    if (!overview) {
      if (crown?.volume === volume) emitRoofFaces(crown.mesh, volume.materials, out);
      if (front?.volume === volume) emitRoofFaces(front.mesh, volume.materials, out);
      if (crafted && craftedYurt(volume, building.culture?.culture ?? '', out)) continue;
      if (mesh) emitRoofFaces(crafted ? craftedRoofMesh(volume, building.culture?.culture ?? '') : mesh, volume.materials, out);
      if (crafted && mesh && !volume.displayTree) {
        const hasRoom = roofRoom?.volume === volume;
        if (hasRoom) emitRoofFaces(roofRoom.mesh, volume.materials, out);
        craftedArchitecture(volume, building.culture?.culture ?? '', out, hasRoom, front?.volume === volume ? front.frame : undefined, use);
        craftedIndianMassing(building, volume, out);
      }
      continue;
    }
    if (mesh && volume.overview_roof_faces) {
      emitRoofFaces(mesh, volume.materials, out, ...volume.overview_roof_faces);
    } else {
      // Complex subpixel facets become a capped native body outline with the same holes and height.
      const eaves = volume.z_m + volume.wall_height_m,
        top = eaves + volume.roof_height_m;
      if (volume.envelope !== 'open') extrude(volume.footprint, eaves, volume.roof_height_m, volume.materials, false, volume.materials.cladding);
      for (const triangle of surfaceTriangles(volume.footprint)) out({ points: triangle.map(p => [p.x, p.y, top]) as BuildingTriangle['points'], normal: [0, 0, 1], materials: volume.materials, material: volume.materials.cladding, surface: 'roof' });
    }
    // Keep the sails of a windmill and other standing works at the overview scale.
    if (mesh && volume.overview_faces) emitRoofFaces(mesh, volume.materials, out, ...volume.overview_faces);
  }
  out = emit;
  const materials = building.volumes[0]?.materials;
  if (materials) for (const foundation of building.structural_foundations ?? []) extrude(foundation.footprint, foundation.z_min_m, foundation.z_max_m - foundation.z_min_m, materials, true, materials.base);
  if (materials)
    for (const feature of building.structural_features ?? []) {
      if (!retainBuildingFeature(feature, overview, featureLod)) continue;
      if (['stair', 'ladder'].includes(feature.kind) && feature.vertices3d.length >= 3) {
        const vertices = feature.vertices3d;
        for (let i = 1; i + 1 < vertices.length; i++) {
          const [a, b, c] = [vertices[0], vertices[i], vertices[i + 1]];
          const ab = [b.x - a.x, b.y - a.y, b.z - a.z],
            ac = [c.x - a.x, c.y - a.y, c.z - a.z];
          const cross: BuildingVector = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]],
            length = Math.hypot(...cross);
          if (length > 1e-9)
            emit({
              points: [
                [a.x, a.y, a.z],
                [b.x, b.y, b.z],
                [c.x, c.y, c.z],
              ],
              normal: cross.map(v => v / length) as BuildingVector,
              materials,
              material: feature.material,
              surface: 'wall',
            });
        }
      } else extrude(feature.surface, feature.z_m, feature.height_m, materials, true, feature.material);
    }
}

/** Moller-Trumbore ray/triangle intersection, double-sided and in metric space. */
export function buildingRayDistance(origin: BuildingVector, direction: BuildingVector, triangle: BuildingTriangle['points']): number | null {
  const [a, b, c] = triangle;
  const sub = (u: BuildingVector, v: BuildingVector): BuildingVector => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const cross = (u: BuildingVector, v: BuildingVector): BuildingVector => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u: BuildingVector, v: BuildingVector): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a),
    ac = sub(c, a),
    p = cross(direction, ac),
    determinant = dot(ab, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inv = 1 / determinant,
    s = sub(origin, a),
    u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, ab),
    v = dot(direction, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(ac, q) * inv;
  return distance >= 0 ? distance : null;
}
