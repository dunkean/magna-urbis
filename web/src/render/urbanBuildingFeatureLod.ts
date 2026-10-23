import type { Feature } from '../../../rust/bridge/housesContract';

/** Display only. Physical features stay in the retained plan and occupation. */
export interface BuildingFeatureLod {
  metresPerPixel: number;
  verticalExaggeration: number;
}
const SMALL_FEATURE_PIXELS = 2;
const OPTIONAL_SMALL_FEATURES = new Set(['post', 'frame', 'portal_lintel']);
/** Compute when scene/sector membership changes, never on every frame. */
export const hasBuildingFeatureLod = (features: readonly Feature[]): boolean =>
  features.some(feature => OPTIONAL_SMALL_FEATURES.has(feature.kind) && !feature.roof);
const valid = (v: BuildingFeatureLod | undefined): v is BuildingFeatureLod => !!v
  && Number.isFinite(v.metresPerPixel) && v.metresPerPixel > 0
  && Number.isFinite(v.verticalExaggeration) && v.verticalExaggeration > 0;

/** Perspective Jacobian bound over the entire sector sphere, in the already
 * exaggerated space. The Gram terms also cover nonorthogonal Float32 rows.
 * For a rigid camera this is f/dMin * sqrt(1 + (rhoMax/dMin)^2).
 * A sphere crossing the camera plane cannot support feature omission. */
export function buildingFeatureMetresPerPixel(matrix: ArrayLike<number>, point: readonly number[],
  radius: number, focal: number): number | undefined {
  if (matrix.length !== 16 || point.length !== 3 || !point.every(Number.isFinite)
    || !Number.isFinite(radius) || radius < 0 || !Number.isFinite(focal) || focal <= 0) return undefined;
  const a = [matrix[0], matrix[4], matrix[8]], b = [matrix[1], matrix[5], matrix[9]], c = [matrix[3], matrix[7], matrix[11]];
  const an = Math.hypot(...a), bn = Math.hypot(...b), cn = Math.hypot(...c);
  if (![an, bn, cn, matrix[12], matrix[13], matrix[15]].every(Number.isFinite) || Math.min(an, bn, cn) <= 0) return undefined;
  const n0 = a.map(v => v / an), n1 = b.map(v => v / bn);
  const dot = (u: readonly number[], v: readonly number[]): number => u.reduce((sum, x, i) => sum + x * v[i], 0);
  const dMin = dot(c, point) + matrix[15] - cn * radius;
  if (!Number.isFinite(dMin) || dMin <= 0) return undefined;
  const lambda2 = 1 + Math.abs(dot(n0, n1));
  const rhoMax = Math.hypot((dot(a, point) + matrix[12]) / an, (dot(b, point) + matrix[13]) / bn) + Math.sqrt(lambda2) * radius;
  const r = rhoMax / dMin, cross = Math.hypot(dot(n0, c), dot(n1, c));
  const metresPerPixel = dMin / (focal * Math.sqrt(lambda2 + 2 * cross * r + cn * cn * r * r));
  return Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : undefined;
}

/** Round toward finer detail, with a one-octave zoom-out hysteresis. This avoids
 * rebuilding on every camera move and never coarsens beyond the supplied m/px.
 * Missing/invalid projection retains every feature. */
export function buildingFeatureLod(metresPerPixel: number, verticalExaggeration: number,
  previous?: BuildingFeatureLod): BuildingFeatureLod | undefined {
  const candidate = { metresPerPixel: 2 ** Math.floor(Math.log2(metresPerPixel)), verticalExaggeration };
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0 || !valid(candidate)) return undefined;
  if (valid(previous) && previous.verticalExaggeration === verticalExaggeration
    && candidate.metresPerPixel === previous.metresPerPixel * 2
    && metresPerPixel < candidate.metresPerPixel * 1.15) return previous;
  return candidate;
}
export function sameBuildingFeatureLod(a?: BuildingFeatureLod, b?: BuildingFeatureLod): boolean {
  return a === b || !!a && !!b && a.metresPerPixel === b.metresPerPixel && a.verticalExaggeration === b.verticalExaggeration;
}

/** The full prism/vertex bound protects large columns and frames even when a
 * sector's average building width has selected overview. Walls, retaining
 * structures, stairs, roofs and unknown kinds are always retained. */
export function retainBuildingFeature(feature: Feature, overview: boolean, lod?: BuildingFeatureLod): boolean {
  if (!overview || !valid(lod) || !OPTIONAL_SMALL_FEATURES.has(feature.kind) || feature.roof) return true;
  if (!Number.isFinite(feature.z_m) || !Number.isFinite(feature.height_m) || feature.height_m < 0 || !feature.surface.length) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let minZ = feature.z_m, maxZ = feature.z_m + feature.height_m;
  if (!Number.isFinite(maxZ)) return true;
  for (const shape of feature.surface) for (const ring of [shape.outer, ...shape.holes]) for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return true;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  for (const p of feature.vertices3d) {
    if (![p.x, p.y, p.z].every(Number.isFinite)) return true;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.hypot(maxX - minX, maxY - minY, (maxZ - minZ) * lod.verticalExaggeration);
  return !Number.isFinite(span) || span / lod.metresPerPixel >= SMALL_FEATURE_PIXELS;
}
