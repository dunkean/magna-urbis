/**
 * Look of the town buildings: wall base and outline, roof pans (light, weathering, grain, wall rims, snow), cast
 * shadows, and when buildings, pans and shadows show.
 *
 * Part of the town's look (city/look.ts). The Canvas town (cityCanvas.ts drawCitySteps, drawPlanRoofsSteps,
 * drawRoofedBuildings) paints what these rules return; the GPU town (cityGlStyle.ts) writes the same values into its
 * per-feature tables and applies the frame-dependent ones (grain level and strength, rims) in its shader.
 */
import type { CityBuilding, CityLod, CityPalette, CityRoofs, CityView } from './model/contract';
import type { RenderColors } from '../customColors';
import { COVER_GRAINS, coverGrainFrame, roofGrain } from '../buildingMaterials';
import { roofLight } from '../cityMassing';
import { tintedWallColor } from '../buildingPalette';
import { planBuildingColors, planRoofColor, planShade } from '../cityBuildingPalette';
import { caveRoof, nightRoof } from '../cityNight';
import { toneStamp } from '../groundTone';
import { planPanLight } from '../roofPlaneLight';
import { mapGroundSnow, roofSeasonKey } from '../seasonPalette';
import { urbanFunctionColor } from '../urbanBuildingStyle';
import { CITY_LOD_OFF, atLeast } from './levels';
import { FAMILY_COLORS, mix } from './planLook';
import { farTownBuildingsShown } from './farTown';
import { paintedBuildings, type PlanPath } from './planPath';
import { TURF_LOOK, turfCover } from './turfLook';
import type { RoofMode } from '../roofMode';

// ---------------------------------------------------------------- when buildings show
export interface BuildingsShownInput {
  view: CityView;
  lod: CityLod;
  mpp: number;
  /** Flat footprints ('silhouette'): shown at every level, in every view. */ footprint: boolean;
  diagnostic: string;
  buildingsVisible: boolean;
  /** Satellite grounds: the far raster stands for the buildings above its fade band. */ farTown?: boolean;
  /** A native house renderer draws the buildings (no far raster, no pans). */ houseRenderer?: boolean;
}
/** The far raster of a satellite town is drawn (cross-faded with the buildings, whatever the level's hysteresis). */
export const farTownShown = (o: BuildingsShownInput): boolean => !!o.farTown && o.buildingsVisible && o.view === 'buildings' && !o.footprint && o.diagnostic === 'none' && !o.houseRenderer && !CITY_LOD_OFF;
/** The building bodies are drawn. */
export const buildingsShown = (o: BuildingsShownInput): boolean => o.buildingsVisible && (o.footprint || (farTownShown(o) ? farTownBuildingsShown(o.mpp) : atLeast(o.lod, 'near'))) && (o.footprint || o.view === 'buildings' || o.view === 'roles');
/** Roof pans and cast shadows are drawn over the bodies. */
export const roofPansShown = (o: Pick<BuildingsShownInput, 'view' | 'footprint' | 'diagnostic'> & { planPath?: PlanPath }): boolean => !o.footprint && (!!o.planPath || (o.view === 'buildings' && o.diagnostic !== 'uses'));

// ---------------------------------------------------------------- bodies
export interface BuildingFrame {
  view: CityView;
  palette: CityPalette;
  footprint: boolean;
  diagnostic: string;
  /** The user's building and edge colours (night tables included). */ colors?: RenderColors;
  /** The frame is the GPU plan renderer's (planPath.ts). */ planPath?: PlanPath;
}
/** Outline ink of a building body: the user's, else dark (pale on the dark masses of parchment footprints). */
export const buildingEdgeInk = (colors: RenderColors | undefined, footprint: boolean, parchment: boolean): string => colors?.buildingEdge ?? (footprint && parchment ? '#f1e5c6' : '#2e261d');
/** Outline width of a building body, CSS px. */
export const buildingEdgePx = (footprint: boolean, parchment: boolean): number => (footprint && parchment ? 0.3 : 0.55);
/** Second, darker outline of flat footprints off parchment, CSS px. */
export const FOOTPRINT_EDGE_PX = 0.4;
/** Fill, outline and outline width of a building body. `roofed`: the town has roof pans (the body is then the wall
 * base under them). Party walls: every body keeps a dark edge, so adjoining houses of a row stay distinct. */
export function buildingBody(f: BuildingFrame, b: CityBuilding, roofed: boolean): { fill: string; stroke: string; strokeAlpha: number; widthPx: number } {
  const parchment = f.palette === 'parchment',
    tint = planBuildingColors(b, f.footprint ? 'terrain' : f.palette);
  const fill =
    f.view === 'roles'
      ? (FAMILY_COLORS[b.family] ?? '#5a4b3c')
      : f.diagnostic === 'uses'
        ? urbanFunctionColor(b.fn)
        : (f.colors?.building ?? (f.footprint ? tint.roof : roofed ? (f.planPath ? tint.wall : tintedWall(tint.wall, b.material?.tint, f.palette, b.material?.wall)) : tint.roof));
  // Render background (planPath): dark party-wall edges at 0.8, pale landmark edges.
  const painted = !f.footprint && paintedBuildings(f.planPath, f.palette, f.view, f.diagnostic),
    strokeAlpha = painted && !b.landmark ? 0.8 : 1;
  if (!f.footprint && b.stilts) return { fill, stroke: '#514431', strokeAlpha, widthPx: 0.6 };
  // An earth-sheltered mound on a natural ground stands in its cut bank (turfLook.ts).
  if (!f.footprint && !painted && f.palette === 'terrain' && f.view === 'buildings' && f.diagnostic === 'none' && !f.colors?.building && !f.colors?.buildingEdge && turfCover(b.material?.cover, b.material?.wall))
    return { fill, stroke: TURF_LOOK.ring.ink, strokeAlpha: TURF_LOOK.ring.alpha, widthPx: TURF_LOOK.ring.widthPx };
  return { fill, stroke: painted && !f.colors?.buildingEdge ? (b.landmark ? '#e2d3a6' : '#1f1811') : buildingEdgeInk(f.colors, f.footprint, parchment), strokeAlpha, widthPx: buildingEdgePx(f.footprint, parchment) };
}

// ---------------------------------------------------------------- walls and shadows
/** Walls whose top shows around a flat roof as a parapet of their own material. */
const MASONRY = /^(brick|stone|coral|concrete|ashlar)$/;
/** Wall colour on a natural ground: pulled three quarters of the way to the muted tone of the tint the building asks
 * for (its beige, its grey, the darker or warmer glass of a tower: buildingPalette.ts tintedWallColor, shared with
 * the 3D meshes); the drawn plans keep their own conventions. `material`: the wall material. */
function tintedWall(wall: string, tint: string | undefined, palette: CityPalette, material = ''): string {
  if (!tint || palette !== 'terrain') return wall;
  const v = parseInt(wall.slice(1), 16),
    c = tintedWallColor([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255], tint, material);
  return (
    '#' +
    c
      .map(x =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** Fill of the height shadows cast on the ground. Neutral attenuation cannot brighten any channel of the receiving
 * ground. On a natural ground the cast is a near-black cool shade, and on snow the blue of skylit shade (snow is
 * lighter than that tint in every channel). */
export function castShadowFill(palette: CityPalette, night: boolean, snowAltitude?: number): string {
  if (palette === 'parchment') return 'rgba(0,0,0,0.2)';
  const snow = palette === 'terrain' && !night ? mapGroundSnow(snowAltitude) : -1;
  return snow < 0 ? 'rgba(0,0,0,0.3)' : snow > 0.3 ? 'rgba(22,38,70,0.3)' : 'rgba(10,14,24,0.34)';
}

// ---------------------------------------------------------------- roof pans
/** Covers that gather moss and soot on their shaded pans (not metal, hides or earthen terraces). */
const MOSSY = /^(tile|slate|stone|thatch|reed|palm|shingle|bark|turf)$/;
/** Age is a tone of the whole roof (a new cover a touch lighter, an old one darker), and the shaded pans of an old
 * roof are a little greener than its sunny ones. */
function weatheredRoof(color: string, light: number, age: number, cover: string): string {
  const shade = Math.max(0, Math.min(1, -light * 2.4)),
    toned = planShade(color, (0.5 - age) * 0.07);
  return shade > 0 && MOSSY.test(cover) ? mix(toned, '#4b4f38', shade * (0.04 + 0.1 * age)) : toned;
}
/** Share of the grain a roof colour takes: on a very light cover (lime, snow-white plaster) only the dark marks
 * show, on a very dark one (old slate, tarred bark) only the light ones, so both ends take less. */
export function grainGain(color: string): number {
  const v = parseInt(color.slice(1), 16),
    l = (((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) / 255;
  return 1 - 0.5 * Math.max(0, Math.min(1, (l - 0.68) / 0.2)) - 0.45 * Math.max(0, Math.min(1, (0.3 - l) / 0.15));
}
/** Device metres per pixel under which the rim of a flat roof (about half a metre wide) shows as the wall top. */
export const RIM_DEVICE_MPP = 0.55;
/** Pan light under which a snow patch takes the shaded mantle. */
export const SNOW_SHADE_LIGHT = -0.08;
/** Grain strength under which nothing is laid. */
const GRAIN_MIN = 0.03;
/** Shift of the snow mantle and of the cover grain per unit of building age (pattern tiles): every building its own
 * piece of the tile. */
export const SNOW_SHIFT: readonly [number, number] = [53.1, 71.9],
  GRAIN_SHIFT: readonly [number, number] = [37.7, 91.3];
/** Pan edges (eaves, ridges, hips): ink on the drawn plans, a soft joint on a natural ground; width in CSS px. */
export const PAN_EDGE = { parchment: { color: '#2c2117', alpha: 0.4, widthPx: 0.25 }, natural: { color: '#1f1811', alpha: 0.3, widthPx: 0.35 }, plan: { color: '#1f1811', alpha: 0.4, widthPx: 0.35 } } as const;

interface RoofFrameInput {
  smoothRoofs?: boolean;
  roof?: RoofMode;
  palette: CityPalette;
  /** Metres per CSS pixel and device pixel ratio. */ mpp: number;
  dpr: number;
  night?: boolean;
  cave?: boolean;
  diagnostic: string;
  /** The user's building colours. */ colors?: RenderColors;
  /** Textured materials replace the procedural grain. */ textured?: boolean;
}
export interface RoofFrame {
  palette: CityPalette;
  night: boolean;
  cave: boolean;
  /** One ink for every pan (the user's building colour, outside diagnostics). */ custom?: string;
  /** Natural ground by day: pan light capped per cover, weathering, grain, uneven snow. */ natural: boolean;
  /** Flat-roof rims on masonry are drawn as the wall top. */ rims: boolean;
  /** Level and strengths of the cover grain at this scale (natural, not textured). */ grain?: ReturnType<typeof coverGrainFrame>;
  /** Strength of the uneven snow mantle (0: the flat snow tint). */ unevenSnow: number;
  edge: (typeof PAN_EDGE)[keyof typeof PAN_EDGE];
  /** Changes when the colour of some pan may change (ground tones, palette, season, ink, ambience, rims). */ key: string;
}
export function roofFrame(o: RoofFrameInput): RoofFrame {
  const custom = (o.diagnostic === 'none' && o.colors?.building) || undefined,
    parchment = o.palette === 'parchment';
  const natural = o.palette === 'terrain' && !o.night && !custom && o.diagnostic === 'none';
  // A rim is about half a metre wide: under a device pixel it stays part of the roof.
  const device = o.mpp / (o.dpr || 1),
    rims = natural && !o.smoothRoofs && device <= RIM_DEVICE_MPP;
  const grain = natural && !o.textured && o.roof !== 'flat' && o.roof !== 'minimal' ? coverGrainFrame(device) : undefined;
  return {
    palette: o.palette,
    night: !!o.night,
    cave: !!o.cave,
    custom,
    natural,
    rims,
    grain,
    unevenSnow: grain ? grain.alpha[0] : 0,
    edge: parchment ? PAN_EDGE.parchment : natural ? PAN_EDGE.natural : PAN_EDGE.plan,
    key: toneStamp() + '|' + o.palette + '|' + roofSeasonKey() + '|' + (custom ?? '') + '|' + (o.cave ? 2 : o.night ? 1 : 0) + '|' + (rims ? 1 : 0) + '|' + (o.roof ?? ''),
  };
}
/** Snow on the ground of a building (0: none): a snow patch shows only with it. */
export const buildingGroundSnow = (item: CityBuilding): number => mapGroundSnow(item.snowAltitude ?? item.building.ground_z_m);
/** Colour of pan `k` and the share of the grain it takes. On a natural ground a pitched pan takes the capped light of
 * its cover (thatch never shines) and its weathering; the rim of a flat roof on masonry walls is the top of those
 * walls, in their colour, its sunlit and shaded sides a little apart; elsewhere the shared plan colour. */
export function roofPanPaint(f: RoofFrame, item: CityBuilding, roofs: CityRoofs, k: number, ground: number): { color: string; gain: number; wallRim: boolean } {
  const snowed = !!(roofs.snow?.[k] && ground),
    wallRim = f.rims && !!roofs.rim?.[k] && MASONRY.test(roofs.wall?.[k] ?? '');
  const base = wallRim
    ? planShade(tintedWall(planBuildingColors(item, f.palette, roofs.cover[k], roofs.wall?.[k], roofs.tone[k]).wall, roofs.tint?.[k], f.palette, roofs.wall?.[k]), Math.max(-0.12, Math.min(0.1, roofs.light[k] * 0.3)))
    : f.natural && !roofs.flat?.[k] && !snowed
      ? planShade(planBuildingColors(item, f.palette, roofs.cover[k], roofs.wall?.[k], roofs.tone[k]).roof, planPanLight(roofs.light[k], roofs.cover[k]))
      : planRoofColor(item, roofs, k, f.palette, f.custom);
  const aged = f.natural && !roofs.snow?.[k] && !wallRim ? weatheredRoof(base, roofs.light[k], item.age ?? 0.5, roofs.cover[k]) : base;
  // Grade after snow/material colour: a custom night ink must not leave daylight snow above it.
  return { color: f.cave ? caveRoof(aged) : f.night ? nightRoof(aged, f.palette === 'parchment') : aged, gain: f.natural && !wallRim ? grainGain(aged) : 0, wallRim };
}
/** Opacity of the snow mantle of a patch holding `share` of a full mantle on a ground snowed at `ground`, before the
 * frame's uneven-snow strength. */
export function snowMantle(share: number, ground: number): number {
  const amount = Math.min(1, share * ground),
    t = amount * amount * (3 - 2 * amount);
  return Math.min(1, t * 1.12);
}
/** The uneven snow of pan `k` (a snow patch on a snowed ground, close enough for the mantle to show): the cover under
 * it at `under`, then the mantle tile (`shaded` side or not) at `alpha`. Undefined: the flat pan colour. */
export function roofPanSnow(f: RoofFrame, roofs: CityRoofs, k: number, ground: number): { shaded: boolean; under: number; alpha: number } | undefined {
  if (!(roofs.snow?.[k] && ground) || !roofs.patch?.[k] || !(f.unevenSnow > GRAIN_MIN)) return undefined;
  return { shaded: roofs.light[k] < SNOW_SHADE_LIGHT, under: f.unevenSnow < 0.97 ? 1 - f.unevenSnow : 0, alpha: f.unevenSnow * snowMantle(roofs.snow[k], ground) };
}
/** The cover's own grain shows wherever the cover does: under deep snow only on the pans that kept little of it. */
export const roofPanBare = (roofs: CityRoofs, k: number, ground: number): boolean => ground < 0.6 || !roofs.patch?.[k + 1] || (roofs.snow?.[k + 1] ?? 0) * ground < 0.5;
/** The procedural grain of pan `k` (not snowed): its family (1 + index in COVER_GRAINS) and strength. Undefined: none. */
export function roofPanGrain(f: RoofFrame, roofs: CityRoofs, k: number, ground: number, gain: number): { family: number; strength: number } | undefined {
  const family = f.grain && roofPanBare(roofs, k, ground) ? (roofs.grain?.[k] ?? 0) : 0;
  if (!family) return undefined;
  const strength = f.grain!.alpha[family - 1] * gain;
  return strength > GRAIN_MIN ? { family, strength } : undefined;
}

// ---------------------------------------------------------------- roofs in volume
/** The town look the tilted view's volumes take (render/world/buildingsMesh.ts): the top view's roof frame (no rims:
 * the parapet stands in volume) and the town item of a building by id (its culture, role, age and ground). */
export interface VolumeTownLook {
  readonly frame: RoofFrame;
  item(id: string): CityBuilding | undefined;
}
/** A roof face in volume as one pan of the top view: its volume's massing (render/city3d/materials.ts MassingLook) and
 * its normal (map frame, z up). */
export interface VolumePan {
  cover: string;
  wall: string;
  tone: number;
  tint?: string;
  normal: readonly [number, number, number];
}
const onePan = { shapes: [], owner: new Uint32Array(1), light: new Float32Array(1), cover: [''], wall: [''], tone: new Float32Array(1), dir: new Float32Array(1), flat: new Uint8Array(1), tint: [undefined as string | undefined], shadows: [] } satisfies CityRoofs;
/** The paint roofPanPaint gives that pan in the top view (palette, cover, light of its slope, weathering, ground
 * contrast, night), its grain gain and grain family (1 + COVER_GRAINS index, 0: none). The light is the 2D plan's sun
 * on the face's own slope, so a tilted roof keeps the tone it has from above. Snow stays the volume's own. */
export function volumeRoofPaint(f: RoofFrame, item: CityBuilding, pan: VolumePan): { color: string; gain: number; family: number } {
  const flat = Math.abs(pan.normal[2]) > 0.995 * (Math.hypot(pan.normal[0], pan.normal[1], pan.normal[2]) || 1);
  onePan.light[0] = roofLight(pan.normal);
  onePan.cover[0] = pan.cover;
  onePan.wall[0] = pan.wall;
  onePan.tone[0] = pan.tone;
  onePan.flat[0] = flat ? 1 : 0;
  onePan.tint[0] = pan.tint;
  const paint = roofPanPaint(f, item, onePan, 0, 0),
    grain = f.natural ? roofGrain(pan.cover, flat, item.material?.culture ?? '') : undefined;
  return { color: paint.color, gain: paint.gain, family: grain ? COVER_GRAINS.indexOf(grain) + 1 : 0 };
}
/** The wall colour of that volume as the top view tints it (the wall base under the pans). */
export const volumeWallColor = (f: RoofFrame, item: CityBuilding, pan: Omit<VolumePan, 'normal'>): string => tintedWall(planBuildingColors(item, f.palette, pan.cover, pan.wall, pan.tone).wall, pan.tint, f.palette, pan.wall);

// ---------------------------------------------------------------- cast shadow tint, mill marks
const shadowTints = new Map<string, [number, number, number, number]>();
/** The cast shadow fill by day as a straight RGBA tint (the snow of the first building's ground, as the Canvas town's
 * shadow pass reads it). The plan path keeps black at 0.3 on every ground but parchment (planPath.ts). */
export function castShadowTint(palette: CityPalette, planPath: PlanPath | undefined, snowAltitude?: number): [number, number, number, number] {
  const css = planPath && palette !== 'parchment' ? 'rgba(0,0,0,0.3)' : castShadowFill(palette, false, snowAltitude);
  let tint = shadowTints.get(css);
  if (!tint) {
    const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(css);
    tint = m ? [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 0.3];
    shadowTints.set(css, tint);
  }
  return tint;
}
/** Mill works seen from above on a natural ground: the cast of the sails (as wide as their cloth, at least `minPx`),
 * the pale bar of the sails across the cap, the dark timber of a water wheel and its float boards (close only). */
export const MILL_MARKS = { shadow: { clothShare: 0.6, minPx: 1.2 }, sails: { ink: 'rgba(226,220,202,0.92)', widthPx: 1.1, minWidth: 0.35 }, wheel: { fill: '#3b3127' }, paddles: { ink: 'rgba(128,112,88,0.7)', widthPx: 0.5, minWidth: 0.1, maxMpp: 0.5 } } as const;
