/**
 * Live town layer (live compositor, contract.ts): while the 2D view moves, the towns are drawn from retained meshes by
 * a cityGl renderer bound to the compositor's shared WebGL2 context, for every look the layer covers (liveCityBlock).
 *
 * The meshes are the ones the classic WebGL2 path builds (cityGlBuild: plan fills, canals, street, wall and tower
 * instances, building surfaces, roof pans and cast shadows in 512 m chunks), plus the lot enclosures (cityGlYards). All
 * preparation is sliced to a few milliseconds per `work` call: the scene merge, the polygon packing (cityGl `step`), the
 * colour tables of each level of detail (cityGl `prepareSteps`); triangulation runs on the workers; uploads go one
 * buffer set per call. Nothing heavy starts while the view moves, and a frame whose level of detail has no prepared
 * tables shows the stand-in instead of computing them. A frame sets uniforms and issues one draw per visible run of
 * chunks per layer. Nothing per building runs in `draw`.
 *
 * Buildings drawn by the native house renderer (house-plan towns, activity sites) are held as their city volumes. On
 * satellite grounds each town's far raster (cityFarRaster.ts) is a texture drawn over the buildings with the Canvas
 * fade; the town canopy (cityGrove.ts) is instanced discs above everything, as finishCityFrame draws it last.
 *
 * Every colour, width and threshold is the town's look (render/city/look.ts), the rules the Canvas town paints with.
 * `restExact` says whether a frame of this layer is the picture of the town at rest: only where the look's
 * townRestGaps finds nothing the Canvas town would paint differently (render/city/restCoverage.ts lists what is left).
 * Otherwise the exact Canvas 2D town (cityCanvas drawCitySteps) repaints the view at rest, as it does captures and exports.
 */
import type { LiveCityEnv, LiveFrame, LiveLayer, LiveLayerStats } from './contract';
import type { ResolvedAppearance } from '../appearanceRecipe';
import type { ExportLayers } from '../exportLayers';
import type { Box, CityBuildings, CityLayers, CityLod, CityPalette, CityScene } from '../cityCanvas';
import { FAR_TOWN_FADE, buildingsShown, farTownAlpha, planFrame, planLineWidthPx, roofPansShown, selectCityLod, townOpacity, townRestGaps, type RestState, type TownContent } from '../city/look';
import { groundRoadLook } from '../composition';
import { mapGroundSnow } from '../seasonPalette';
import { createCityGlRendererOn, finishProgram, programLinked, startProgram, type CityGlDrawOptions, type CityGlSharedRenderer, type PendingProgram, type Program } from '../cityGl';
import { cityBuildingAppearance } from '../cityDrawOptions';
import { farTownRaster, heldFarTownRaster, type FarRaster } from '../cityFarRaster';
import { townWaterColour } from '../townWater';
import { grainMeansReady, grainMeansStep } from '../cityGlGrain';
import type { YardBoundary } from '../cityLotEnclosures';
import { INKS as CANOPY_INKS, SHADE as CANOPY_SHADE, type CityCanopy } from '../cityGrove';

/** What the owner of the towns (v2/nativeCityMap.ts) gives the layer. */
export interface LiveCityTowns {
  /** Every town's plan and buildings merged as one GL scene (the GL path's plan; buildings of every town, those of the
   * native house renderer as their city volumes), in resumable steps. Run at rest, once per town content. */
  sceneSteps(): Generator<void, { plan: CityScene; buildings: CityBuildings }>;
  /** Merged buildings for a view when a town is prepared in tiers (more than LARGE_TOWN_BUILDINGS): the same object
   * while the tiers of that view do not change. Undefined: no tiered town. */
  buildingsFor?(viewport: Box, mpp: number): CityBuildings | undefined;
  /** Layers a classic frame draws with this appearance and visibility (nativeCityMap townLayers). */
  layers(appearance: ResolvedAppearance, visibility: Partial<ExportLayers>): CityLayers;
  /** Towns drawn as a far raster on satellite grounds, with the whole town's buildings (drawFarTown's key). */
  farTowns(): readonly { plan: CityScene; buildings: CityBuildings }[];
  /** Each town's lot enclosures as the Canvas town last derived them (`scene.lotEnclosures`), in entry order. */
  enclosures(): readonly (readonly YardBoundary[] | undefined)[];
  /** Each town's canopy (finishCityFrame: cityCanopy of its layouts and buildings), in entry order. */
  canopies(): readonly CityCanopy[];
  /** Refused parcels of every town (access diagnostic). */
  refused(): ReadonlySet<string>;
  /** Some activity site has drawn ground (drawInstallations); some town is drawn by the native house renderer. */
  sites(): boolean;
  housePlans(): boolean;
}

/** Why the live layer cannot stand for the classic town of this appearance (null: it can). Per-frame conditions are
 * checked in `ready`. */
export function liveCityBlock(appearance: ResolvedAppearance, visibility: Partial<ExportLayers> | undefined): string | null {
  const c = appearance.composition;
  // Partial exports keep Canvas 2D, which honours each layer switch.
  if (visibility?.city === false || visibility?.roads === false || visibility?.streets === false) return 'export-layers';
  if (c.landuse.urban !== 'off') return 'urban-landuse';
  if (appearance.underdark || c.ambience === 'night') return 'night';
  return null;
}

interface Look {
  appearance: ResolvedAppearance;
  visibility: Partial<ExportLayers> | undefined;
  reason: string | null;
  opacity: number;
  /** Satellite grounds: the Canvas town fades into its far raster from FAR_TOWN_FADE[0] m/px (cityFarRaster.ts). */
  farTown: boolean;
  /** drawFarTown's palette and building ink for this look. */
  far: { palette: CityPalette; night: boolean; custom?: string };
  /** finishCityFrame draws the canopy (buildings view, no diagnostic, town shown). */
  canopy: boolean;
  /** Options of every frame of this look but the view, the level of detail, the water and the target. */
  base: Omit<CityGlDrawOptions, 'viewport' | 'metresPerPixel'>;
}
const LODS: readonly CityLod[] = ['far', 'mid', 'near', 'close'];
const finite = (value: number | undefined, fallback: number, min: number, max: number): number => (value !== undefined && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback);

// Far raster quad: the raster's world rectangle through the frame's world-to-clip matrix, premultiplied texels times
// the fade (drawFarTown: drawImage with globalAlpha over the buildings).
const FAR_VS = `#version 300 es
uniform mat3 uM;
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vUv = c;
  vec3 p = uM * vec3(mix(uRect.xy, uRect.zw, c), 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
const FAR_FS = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv) * uAlpha; }`;
interface FarTexture {
  raster: FarRaster;
  texture: WebGLTexture;
  rect: [number, number, number, number];
  bytes: number;
}

// Canopy discs: one instance (x, y, r) per crown or lobe, grown by uGrow metres (stroke rims), antialiased over uPad
// metres (a device pixel), premultiplied colour.
const DISC_VS = `#version 300 es
layout(location = 0) in vec3 aDisc;
uniform mat3 uM;
uniform float uGrow, uPad;
out vec2 vLocal;
flat out float vR;
void main() {
  float r = aDisc.z + uGrow;
  vR = r;
  vLocal = (vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0) * (r + uPad);
  vec3 p = uM * vec3(aDisc.xy + vLocal, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
const DISC_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vR;
uniform float uPad;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float a = clamp(0.5 - (length(vLocal) - vR) / uPad, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = uColor * a;
}`;
/** Premultiplied RGBA of '#rrggbb' or 'rgba(r,g,b,a)', times `alpha`. */
function premul(css: string, alpha = 1): [number, number, number, number] {
  const m = /rgba?\((\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(css),
    v = m ? 0 : parseInt(css.slice(1, 7), 16) || 0;
  const rgb = m ? [+m[1], +m[2], +m[3]] : [(v >> 16) & 255, (v >> 8) & 255, v & 255],
    a = (m?.[4] === undefined ? 1 : +m[4]) * alpha;
  return [(rgb[0] / 255) * a, (rgb[1] / 255) * a, (rgb[2] / 255) * a, a];
}
type DiscPass = 'shade' | 'crowns' | 'rim' | 'dark' | 'mid' | 'light';
interface CanopyMesh {
  passes: Record<DiscPass, { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number }>;
  bytes: number;
}
/** The canopy discs of drawCityCanopy: cast shade (south-east by height), whole crowns (far and flat inks), and per lobe
 * the stroked rim, the dark body, the mid tone and the lit top. */
function canopyDiscs(canopies: readonly CityCanopy[]): Record<DiscPass, number[]> {
  const out: Record<DiscPass, number[]> = { shade: [], crowns: [], rim: [], dark: [], mid: [], light: [] };
  for (const c of canopies)
    for (const t of [...c.dwellings, ...c.trees]) {
      const k = (t.h + t.r * 0.6) * 0.35;
      out.shade.push(t.x + CANOPY_SHADE.x * k, t.y + CANOPY_SHADE.y * k, t.r * 0.95);
      out.crowns.push(t.x, t.y, t.r);
      for (const l of t.lobes) {
        out.rim.push(l.x + l.r * 0.08, l.y + l.r * 0.1, l.r * 1.04);
        out.dark.push(l.x + l.r * 0.1, l.y + l.r * 0.13, l.r);
        if (l.tone > 0.3) out.mid.push(l.x - l.r * 0.04, l.y - l.r * 0.05, l.r * (0.72 + 0.16 * l.tone));
        if (l.tone > 0.55) out.light.push(l.x - l.r * 0.2, l.y - l.r * 0.24, l.r * 0.5 * l.tone);
      }
    }
  return out;
}

/** Metres per pixel of each level of detail for the warm-up draw (inside each band of CITY_LOD_LIMITS). */
const LEVEL_MPP: Record<CityLod, number> = { close: 0.4, near: 1.2, mid: 4, far: 16 };

export function createLiveCityLayer(gl: WebGL2RenderingContext, env: LiveCityEnv, towns: LiveCityTowns): LiveLayer {
  let renderer: CityGlSharedRenderer | undefined,
    broken = false,
    disposed = false;
  /** The merge in progress, the scene handed to the renderer, the buildings last handed to it, builds still running. */
  let merging: Generator<void, { plan: CityScene; buildings: CityBuildings }> | undefined;
  let requested: CityScene | undefined,
    built: CityBuildings | undefined,
    building = 0;
  let lod: CityLod | undefined,
    look: Look | undefined,
    generation = 0;
  /** Levels of detail whose colour tables are on the GPU for the current look and water; the preparation running. */
  const preparedLods = new Set<CityLod>();
  let preparing: { level: CityLod; steps: Generator<void, void> } | undefined, preparedWater: Float32Array | undefined;
  /** Levels of detail drawn once into the warm-up target with the current look and resources: the driver has built
   * every shader variant their frames use (ANGLE builds them on a program's first draw, not at link). */
  const warmedLods = new Set<CityLod>();
  let warm: { framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer } | undefined;
  /** The layer's own programs (far raster quad, canopy discs), linked without blocking like the renderer's. */
  const parallelLink = !!gl.getExtension('KHR_parallel_shader_compile');
  let farP: Program | undefined, discP: Program | undefined, pendingFar: PendingProgram | undefined, pendingDisc: PendingProgram | undefined;
  /** Far rasters on the GPU, per town buildings; `farReady`: every far town has one (for the current look). */
  const farTextures = new Map<CityBuildings, FarTexture>();
  let farVao: WebGLVertexArrayObject | undefined,
    farReady = false,
    farBytes = 0,
    meshBytes = 0;
  /** Lot enclosure lists handed to the renderer; canopy discs and the canopies they were built from. */
  let yardsFor: readonly (readonly YardBoundary[] | undefined)[] | undefined;
  let canopy: CanopyMesh | undefined, canopyFor: readonly CityCanopy[] | undefined;
  /** What the towns hold that decides whether a frame is the picture at rest (counted once per scene and extras, in
   * `work`), and the last answer of `restExact` with the state it was given for. */
  let content: TownContent | undefined;
  let rest: { look: Look; level: CityLod; dpr: number; farRaster: boolean; snow: number; content: TownContent; gaps: readonly string[] } | undefined;
  /** The options `ready` checked for a frame, reused by its `draw`. */
  let checked: { frame: LiveFrame; options: CityGlDrawOptions; level: CityLod } | undefined;
  const stats: LiveLayerStats = { drawCalls: 0, triangles: 0, ms: 0, instances: 0, gpuBytes: 0, uploadMs: 0, buildMs: 0, packMs: 0, prepareMs: 0, warmMs: 0, farTextures: 0 };

  /** One pass over the scene, at rest: what the look's townRestGaps needs to know of the towns. */
  function townContent(plan: CityScene, buildings: CityBuildings | undefined): TownContent {
    const streetRoles = new Set<string>();
    for (const s of plan.streets) streetRoles.add(s.role);
    return {
      waterways: plan.layouts.some(layout => !!layout.structure?.waterways?.length),
      streetRoles,
      enclosures: towns.enclosures().some(list => !!list?.length),
      canopy: towns.canopies().some(c => c.trees.length > 0 || c.dwellings.length > 0 || c.walkways.length > 0),
      sites: towns.sites(),
      housePlans: towns.housePlans(),
      millMarks: !!buildings?.items.some(b => !!b.marks?.length),
      reserves: plan.blocks.some(b => b.kind.startsWith('reserve')) || plan.parcels.some(p => p.use === 'reserve'),
    };
  }
  /** What the Canvas town would paint differently from this layer for a frame (the look's townRestGaps); kept while
   * the look, the level of detail and the towns' content do not change. */
  function restGaps(frame: LiveFrame, l: Look, level: CityLod, held: TownContent): readonly string[] {
    const mpp = 1 / frame.view.scale,
      farRaster = l.farTown && mpp > FAR_TOWN_FADE[0],
      snow = mapGroundSnow();
    if (rest && rest.look === l && rest.level === level && rest.dpr === frame.dpr && rest.farRaster === farRaster && rest.snow === snow && rest.content === held) return rest.gaps;
    const o = l.base,
      a = l.appearance,
      layers = o.layers as CityLayers,
      live = o.live!;
    const footprint = o.buildingStyle === 'silhouette',
      shown = { view: o.view, lod: level, mpp, footprint, diagnostic: o.diagnostic ?? 'none', buildingsVisible: !!o.buildingsVisible, farTown: l.farTown };
    const state: RestState = {
      palette: o.palette ?? 'parchment',
      view: o.view,
      lod: level,
      mpp,
      dpr: frame.dpr,
      // A street takes the tone of the ground wherever the map gives one, unless the roads are ink.
      streets: groundRoadLook(live.roadLook) ? 'natural' : live.roadLook === 'ink' ? 'ink' : 'soft',
      streetsShown: layers.streets,
      blend: planFrame({ view: o.view, lod: level, palette: o.palette ?? 'parchment', layers, width: live.lineWidth ?? 0.6, groundBlend: o.groundBlend, roadLook: live.roadLook }).blend,
      textured: !!a.city.textured,
      emphasis: live.emphasis,
      snow,
      lineWidthPx: planLineWidthPx(live.lineWidth ?? 0.6),
      buildings: buildingsShown(shown) && (footprint || roofPansShown(shown) || o.view === 'roles'),
      farRaster,
      canopyClearing: !!a.composition.vegetation.procedural,
      diagnostics: !!(layers.fronts || layers.axes || layers.access || layers.reserve || layers.allocated || layers.quarters || layers.centers || o.refusedParcels?.size),
      // The canals of the Canvas town are painted again at full strength over the composited town; this layer has no
      // pass over its group (contract.ts).
      overPass: false,
      content: held,
    };
    rest = { look: l, level, dpr: frame.dpr, farRaster, snow, content: held, gaps: townRestGaps(state) };
    return rest.gaps;
  }
  const unprepare = (): void => {
    preparedLods.clear();
    warmedLods.clear();
    preparing?.steps.return();
    preparing = undefined;
  };
  /** The look of the current appearance and visibility, rebuilt when either object changes. */
  function lookNow(): Look {
    const appearance = env.appearance(),
      visibility = env.visibility();
    if (look && look.appearance === appearance && look.visibility === visibility) return look;
    const city = appearance.city,
      buildingAppearance = cityBuildingAppearance(appearance),
      vis = visibility ?? {};
    const roads = appearance.composition.networks.roads,
      buildingsVisible = vis.city !== false && city.visible;
    // As drawCitySteps decides it (the look's farTownShown), for the towns of city volumes.
    const farTown = !!appearance.traits?.satelliteVariant && buildingsVisible && city.view === 'buildings' && buildingAppearance.style !== 'silhouette' && buildingAppearance.diagnostic === 'none';
    look = {
      appearance,
      visibility,
      reason: liveCityBlock(appearance, visibility),
      opacity: townOpacity(city.opacity),
      farTown,
      // As cityDrawOptions hands them to drawFarTown by day: the city palette, the building ink of the appearance.
      far: { palette: city.palette, night: false, custom: buildingAppearance.colors?.building },
      canopy: buildingsVisible && city.view === 'buildings' && buildingAppearance.diagnostic === 'none',
      base: {
        view: city.view,
        palette: city.palette,
        layers: towns.layers(appearance, vis),
        buildingStyle: buildingAppearance.style,
        // The Canvas town ignores `painted` for city volumes, and the live look omits textures (flat colours).
        paintedBuildings: false,
        textured: false,
        buildingsVisible,
        diagnostic: buildingAppearance.diagnostic,
        refusedParcels: buildingAppearance.diagnostic === 'access' ? towns.refused() : undefined,
        colors: appearance.palette.colors,
        groundBlend: city.groundBlend === 'blended',
        live: {
          roadLook: roads.look,
          emphasis: roads.emphasis ?? 1,
          waterColor: townWaterColour(appearance),
          // Natural grounds: the Canvas town lays its procedural grain unless textured materials replace it.
          grain: !city.textured,
          lineWidth: finite(city.width, 0.6, 0, 5),
          farTown,
        },
      },
    };
    unprepare();
    farReady = false;
    checked = undefined;
    return look;
  }
  /** The frame's world box exactly as the target maps it (device pixels). */
  const viewportOf = (frame: LiveFrame): Box => {
    const [sx, sy, tx, ty] = frame.worldToPixel;
    return { minX: -tx / sx, minY: -ty / sy, maxX: (frame.width - tx) / sx, maxY: (frame.height - ty) / sy };
  };
  const optionsFor = (frame: LiveFrame, l: Look, frameLod: CityLod): CityGlDrawOptions => ({
    ...l.base,
    viewport: viewportOf(frame),
    metresPerPixel: 1 / frame.view.scale,
    lod: frameLod,
    water: env.water?.(),
    target: { framebuffer: frame.target, width: frame.width, height: frame.height },
  });
  function dropExtras(deleteHandles: boolean): void {
    if (deleteHandles) {
      for (const t of farTextures.values()) gl.deleteTexture(t.texture);
      for (const p of [farP, discP]) if (p) gl.deleteProgram(p.program);
      for (const p of [pendingFar, pendingDisc]) if (p) gl.deleteProgram(p.program);
      if (farVao) gl.deleteVertexArray(farVao);
      if (canopy)
        for (const p of Object.values(canopy.passes)) {
          gl.deleteBuffer(p.vbo);
          gl.deleteVertexArray(p.vao);
        }
      if (warm) {
        gl.deleteFramebuffer(warm.framebuffer);
        gl.deleteRenderbuffer(warm.color);
        gl.deleteRenderbuffer(warm.depth);
      }
    }
    farTextures.clear();
    farP = discP = pendingFar = pendingDisc = undefined;
    farVao = undefined;
    warm = undefined;
    farReady = false;
    farBytes = 0;
    canopy = undefined;
    canopyFor = undefined;
  }
  function drop(deleteHandles: boolean): void {
    try {
      renderer?.dispose();
    } catch {
      /* A lost context: the handles are dead anyway. */
    }
    try {
      dropExtras(deleteHandles);
    } catch {
      dropExtras(false);
    }
    merging?.return(undefined as never);
    merging = undefined;
    checked = undefined;
    content = undefined;
    rest = undefined;
    renderer = undefined;
    requested = built = undefined;
    yardsFor = undefined;
    unprepare();
    generation++;
    building = 0;
    meshBytes = 0;
  }
  const track = <T>(job: Promise<T>): void => {
    const gen = generation;
    building++;
    job.then(
      () => {
        if (gen === generation) {
          building--;
          env.invalidate();
        }
      },
      error => {
        if (gen !== generation) return;
        building--;
        broken = true;
        console.warn('Live town meshes unavailable', error);
      },
    );
  };
  const bytes = (): number => meshBytes + farBytes + (canopy?.bytes ?? 0);
  /** Advances a generator for about `budget` ms from `start`; true once it is done. */
  const advance = <T>(steps: Generator<void, T>, start: number, budget: number, done: (value: T) => void): boolean => {
    do {
      const r = steps.next();
      if (r.done) {
        done(r.value);
        return true;
      }
    } while (performance.now() - start < budget);
    return false;
  };
  /** The layer's programs: issued together, finished when linked (one per call without parallel compile). */
  function programsStep(): boolean {
    if (farP && discP) return false;
    if (parallelLink) {
      pendingFar ??= startProgram(gl, FAR_VS, FAR_FS);
      pendingDisc ??= startProgram(gl, DISC_VS, DISC_FS);
    } else if (!farP) pendingFar ??= startProgram(gl, FAR_VS, FAR_FS);
    else pendingDisc ??= startProgram(gl, DISC_VS, DISC_FS);
    if (pendingFar && programLinked(gl, pendingFar, parallelLink)) {
      farP = finishProgram(gl, pendingFar);
      pendingFar = undefined;
      farVao = gl.createVertexArray()!;
    }
    if (pendingDisc && programLinked(gl, pendingDisc, parallelLink)) {
      discP = finishProgram(gl, pendingDisc);
      pendingDisc = undefined;
    }
    return !(farP && discP);
  }
  /** Uploads a town's far raster (finest level, mipmapped by the GPU) as premultiplied RGBA. */
  function uploadFar(key: CityBuildings, raster: FarRaster): void {
    const old = farTextures.get(key),
      texture = old?.texture ?? gl.createTexture()!,
      image = raster.levels[0];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const size = Math.round((raster.w * raster.h * 4 * 4) / 3);
    farBytes += size - (old?.bytes ?? 0);
    farTextures.set(key, { raster, texture, bytes: size, rect: [raster.x0, raster.y0, raster.x0 + raster.w * raster.cell, raster.y0 + raster.h * raster.cell] });
    stats.farTextures = farTextures.size;
  }
  /** One step of the far rasters of a satellite look: re-uploads a raster drawFarTown replaced, builds a missing one at
   * rest (a pass over the town's buildings, as the first Canvas far frame does). True when it did something. */
  function farWork(l: Look, frame: LiveFrame | undefined): boolean {
    let missing = false;
    for (const town of towns.farTowns()) {
      if (!town.buildings.items.length) continue;
      const held = farTextures.get(town.buildings);
      let raster = heldFarTownRaster(town.buildings);
      if (!raster && !frame?.moving) raster = farTownRaster(town.plan, town.buildings, l.far);
      if (!raster) {
        missing = true;
        continue;
      }
      if (held?.raster !== raster) {
        uploadFar(town.buildings, raster);
        return true;
      }
    }
    farReady = !missing;
    return false;
  }
  /** Uploads the canopy discs when the towns' canopies changed (identity per town). */
  function canopyWork(): boolean {
    const list = towns.canopies();
    if (canopyFor && canopyFor.length === list.length && canopyFor.every((c, i) => c === list[i])) return false;
    if (canopy)
      for (const p of Object.values(canopy.passes)) {
        gl.deleteBuffer(p.vbo);
        gl.deleteVertexArray(p.vao);
      }
    canopy = undefined;
    canopyFor = list;
    if (!list.some(c => c.trees.length || c.dwellings.length)) return true;
    const discs = canopyDiscs(list),
      passes = {} as CanopyMesh['passes'];
    let size = 0;
    for (const name of Object.keys(discs) as DiscPass[]) {
      const data = new Float32Array(discs[name]),
        vbo = gl.createBuffer()!,
        vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      passes[name] = { vbo, vao, count: data.length / 3 };
      size += data.byteLength;
    }
    gl.bindVertexArray(null);
    canopy = { passes, bytes: size };
    return true;
  }
  /** drawCityCanopy as discs: shade, then whole crowns (far, flat inks) or rim, dark, mid and lit lobes. Translucent
   * passes cover each sample once (stencil), as one Canvas fill of their union. */
  function drawCanopy(frame: LiveFrame, palette: CityPalette, mpp: number): void {
    if (!canopy || !discP) return;
    const d = discP,
      ink = CANOPY_INKS[palette] ?? CANOPY_INKS.terrain,
      devM = 1 / frame.worldToPixel[0],
      wide = mpp > 2.5,
      flat = !!ink.flat;
    gl.useProgram(d.program);
    gl.uniformMatrix3fv(d.u.uM, false, frame.worldToClip);
    gl.uniform1f(d.u.uPad, devM);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    const pass = (name: DiscPass, color: string, alpha = 1, growPx = 0): void => {
      const p = canopy!.passes[name],
        c = premul(color, alpha);
      if (!p.count || !(c[3] > 0)) return;
      gl.clearStencil(0);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.uniform4f(d.u.uColor, c[0], c[1], c[2], c[3]);
      gl.uniform1f(d.u.uGrow, growPx * mpp);
      gl.bindVertexArray(p.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.count);
      stats.drawCalls++;
      stats.triangles += 2 * p.count;
    };
    if (!flat) pass('shade', ink.shade);
    if (flat || wide) {
      if (ink.stroke) pass('crowns', ink.stroke, 1, (flat ? 0.6 : 0.45) / 2);
      pass('crowns', ink.mid);
    } else {
      if (ink.stroke) pass('rim', ink.stroke, 1, 0.45);
      pass('dark', ink.dark);
      pass('mid', ink.mid);
      pass('light', ink.light, 0.85);
    }
    gl.disable(gl.STENCIL_TEST);
    gl.bindVertexArray(null);
  }
  /** The whole layer into `frame.target`: the town, the far rasters, the canopy. Creates nothing (`check` and the
   * warm-up saw to it). `warmup`: every draw kind of the level at least once, into the warm-up target. */
  function paint(frame: LiveFrame, l: Look, options: CityGlDrawOptions, mpp: number, warmup: boolean): void {
    const f = renderer!.draw(options);
    stats.drawCalls = f.drawCalls;
    stats.triangles = f.triangles;
    stats.instances = f.instances;
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame.target);
    gl.viewport(0, 0, frame.width, frame.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Satellite: the far raster over the buildings, faded in from FAR_TOWN_FADE[0] (drawCitySteps `farTown`).
    const alpha = l.farTown && farP && farVao ? (warmup ? 1 : farTownAlpha(mpp)) : 0;
    if (alpha > 0 && farP && farVao && farTextures.size) {
      const r = frame.rect;
      gl.useProgram(farP.program);
      gl.bindVertexArray(farVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix3fv(farP.u.uM, false, frame.worldToClip);
      gl.uniform1f(farP.u.uAlpha, Math.min(1, alpha));
      gl.uniform1i(farP.u.uTex, 0);
      for (const t of farTextures.values()) {
        const [x0, y0, x1, y1] = t.rect;
        if (!warmup && (x0 > r.maxX || x1 < r.minX || y0 > r.maxY || y1 < r.minY)) continue;
        gl.bindTexture(gl.TEXTURE_2D, t.texture);
        gl.uniform4f(farP.u.uRect, x0, y0, x1, y1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        stats.drawCalls++;
        stats.triangles += 2;
      }
      gl.bindVertexArray(null);
    }
    // The canopy over the roofs (finishCityFrame draws it after the town).
    if (l.canopy) drawCanopy(frame, l.base.palette ?? 'parchment', mpp);
  }
  /** One level of detail drawn into a small offscreen target of the group's format (RGBA8 + depth24/stencil8,
   * multisampled), over the whole town so every chunk kind is drawn: the driver builds the shader variants now, in
   * work, instead of in the first real frame of that level. */
  function warmLevel(frame: LiveFrame, l: Look, level: CityLod): void {
    if (!warm) {
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number),
        framebuffer = gl.createFramebuffer()!,
        color = gl.createRenderbuffer()!,
        depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, 4, 4);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, 4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      warm = { framebuffer, color, depth };
    }
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const e = requested?.extent,
      whole = e && Number.isFinite(e.minX) && e.maxX > e.minX ? e : viewportOf(frame);
    const shadow: LiveFrame = { ...frame, target: warm.framebuffer, width: 4, height: 4 };
    gl.bindFramebuffer(gl.FRAMEBUFFER, warm.framebuffer);
    gl.viewport(0, 0, 4, 4);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    paint(shadow, l, { ...optionsFor(shadow, l, level), viewport: whole, metresPerPixel: LEVEL_MPP[level] }, LEVEL_MPP[level], true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, frame.width, frame.height);
  }

  /** Why `draw` cannot show the towns of this frame ('' when it can). Checks that the draw will create nothing. */
  const notReady = (frame: LiveFrame): string => {
    if (disposed) return 'disposed';
    if (broken) return 'broken';
    if (!renderer) return 'no renderer';
    if (!renderer.programsLinked || !farP || !discP) return 'linking programs';
    if (!requested) return merging ? 'merging' : 'no scene requested';
    // A later building tier packing or uploading keeps the uploaded one drawable; only the first scene waits.
    if (!renderer.ready) return renderer.packing ? 'packing' : 'scene not uploaded';
    if (renderer.pendingUpload) return 'upload pending';
    const l = lookNow();
    if (l.reason) return l.reason;
    // Natural roofs take the mean tone of the Canvas grain: its tile means are measured in work first.
    if (l.base.palette === 'terrain' && l.base.live?.grain && !grainMeansReady()) return 'grain means';
    const level = selectCityLod(1 / frame.view.scale, lod);
    // The colour tables of the frame's level of detail are prepared in `work`; a draw never computes them.
    if (!preparedLods.has(level)) return 'tables not prepared';
    if (!warmedLods.has(level)) return 'warming up';
    // Satellite: from the fade start the Canvas town shows its far raster.
    if (l.farTown && 1 / frame.view.scale > FAR_TOWN_FADE[0] && !farReady) return 'far-town raster';
    const options = optionsFor(frame, l, level),
      missing = renderer.check(options);
    // Something changed under a prepared level (ground tones, season, water): prepare and warm it again.
    if (missing) {
      preparedLods.delete(level);
      warmedLods.delete(level);
      return missing;
    }
    checked = { frame, options, level };
    return '';
  };
  return {
    name: 'city',
    isolated: true,
    opacity: () => lookNow().opacity,
    ready(frame) {
      const why = notReady(frame);
      // Read by the probes (nav_fps_probe.mjs, smoke tests): why the stand-in shows instead of the meshes.
      (globalThis as { __muLiveCityWhy?: string }).__muLiveCityWhy = why;
      return !why;
    },
    restExact(frame) {
      // Strict: any element the Canvas town would paint differently keeps its repaint at rest. Read by the probes:
      // what is still missing for this frame.
      const held = content,
        gaps = held && !notReady(frame) ? restGaps(frame, lookNow(), selectCityLod(1 / frame.view.scale, lod), held) : undefined;
      (globalThis as { __muLiveCityGaps?: readonly string[] }).__muLiveCityGaps = gaps;
      return !!gaps && gaps.length === 0;
    },
    draw(frame) {
      const start = performance.now(),
        l = lookNow();
      stats.drawCalls = stats.triangles = stats.instances = 0;
      // Only after `ready` answered true for this frame: its checked options, nothing to create.
      const c = checked?.frame === frame ? checked : undefined;
      stats.opacity = l.opacity;
      // The target is the frame's at draw time: `ready` runs before the compositor binds the isolated group, so the
      // options it checked still name the canvas (drawing there skipped the group and its opacity: an opaque town).
      if (renderer && c && l.opacity > 0) {
        lod = c.level;
        paint(frame, l, { ...c.options, target: { framebuffer: frame.target, width: frame.width, height: frame.height } }, 1 / frame.view.scale, false);
      }
      checked = undefined;
      stats.ms = performance.now() - start;
    },
    work(budgetMs, frame) {
      // A lost context compiles nothing: wait for the restore (contextLost dropped the renderer).
      if (disposed || broken || gl.isContextLost()) return false;
      const start = performance.now(),
        moving = !!frame?.moving;
      try {
        if (!renderer) renderer = createCityGlRendererOn(gl, { onInvalidate: () => env.invalidate() });
        // Programs: issued at once and polled (parallel compile), never linked by a draw.
        const linkingRenderer = renderer.programsStep(),
          linkingOwn = programsStep();
        if (linkingRenderer || linkingOwn) return true;
      } catch (error) {
        broken = true;
        console.warn('Live town programs unavailable', error);
        return false;
      }
      if (!requested) {
        // The scene is merged and requested at rest only (slices); its polygons are then packed a slice per call.
        if (moving && !merging) return true;
        merging ??= towns.sceneSteps();
        const r = renderer;
        advance(merging, start, budgetMs, scene => {
          merging = undefined;
          requested = scene.plan;
          built = scene.buildings;
          track(r.setScene(scene.plan, scene.buildings));
        });
        stats.buildMs = (stats.buildMs ?? 0) + performance.now() - start;
        return true;
      }
      if (renderer.packing) {
        const t = performance.now();
        const more = renderer.step(Math.max(1, budgetMs - (t - start)));
        stats.packMs = (stats.packMs ?? 0) + performance.now() - t;
        return more || building > 0;
      }
      if (renderer.pendingUpload) {
        // One buffer set per call, at rest.
        if (moving) return true;
        const t = performance.now();
        renderer.upload();
        stats.uploadMs = performance.now() - t;
        meshBytes = renderer.stats().gpuBytes;
        stats.gpuBytes = bytes();
        unprepare();
        yardsFor = undefined;
        content = undefined;
        return true;
      }
      if (!renderer.ready) return building > 0;
      // Large towns: the tier of a resting view (base items, or the detail of the visible tiles), as the classic draw
      // swaps it. A moving view keeps the uploaded tier.
      if (frame && towns.buildingsFor && !moving && !building) {
        const next = towns.buildingsFor(viewportOf(frame), 1 / frame.view.scale);
        if (next && next !== built) {
          built = next;
          track(renderer.setBuildings(next));
          return true;
        }
      }
      if (!frame) return building > 0;
      const l = lookNow(),
        water = env.water?.();
      if (l.reason) return building > 0;
      // The grain tile means (one cover kind per call, a few ms), shared by every town layer.
      if (l.base.palette === 'terrain' && l.base.live?.grain && grainMeansStep()) return true;
      if (preparedWater !== water) {
        unprepare();
        preparedWater = water;
      }
      const own = selectCityLod(1 / frame.view.scale, lod);
      // Colour tables, one level of detail at a time in slices: the view's level first, then the others, so a zoom
      // across a level finds its tables kept.
      if (preparing || preparedLods.size < LODS.length) {
        if (!preparing) {
          const level = preparedLods.has(own) ? LODS.find(x => !preparedLods.has(x))! : own;
          preparing = { level, steps: renderer.prepareSteps(optionsFor(frame, l, level)) };
        }
        const job = preparing,
          t = performance.now();
        advance(job.steps, start, budgetMs, () => {
          preparedLods.add(job.level);
          preparing = undefined;
        });
        stats.prepareMs = performance.now() - t;
        return true;
      }
      // Warm-up, one level per call (own level first), at rest or for the level the moving view needs.
      const cold = !warmedLods.has(own) ? own : moving ? undefined : LODS.find(x => !warmedLods.has(x));
      if (cold) {
        const t = performance.now();
        try {
          warmLevel(frame, l, cold);
        } catch (error) {
          broken = true;
          console.warn('Live town warm-up failed', error);
          return false;
        }
        warmedLods.add(cold);
        stats.warmMs = performance.now() - t;
        return true;
      }
      // Retained extras, at rest: lot enclosures, canopy, far rasters (one item per call). Each change draws differently:
      // the levels are warmed up again.
      if (moving) return building > 0;
      try {
        const lists = towns.enclosures();
        if (!yardsFor || yardsFor.length !== lists.length || yardsFor.some((x, i) => x !== lists[i])) {
          renderer.setYards(lists);
          yardsFor = lists;
          content = undefined;
          meshBytes = renderer.stats().gpuBytes;
          stats.gpuBytes = bytes();
          // New enclosure colour tables: prepared again (a few texels), then warmed.
          unprepare();
          return true;
        }
        if (canopyWork()) {
          stats.gpuBytes = bytes();
          warmedLods.clear();
          content = undefined;
          return true;
        }
        if (l.farTown && farWork(l, frame)) {
          stats.gpuBytes = bytes();
          warmedLods.clear();
          return true;
        }
        // Last: what the towns hold, for `restExact` (one pass over the scene).
        if (!content && requested && !building) {
          content = townContent(requested, built);
          env.invalidate();
          return true;
        }
      } catch (error) {
        broken = true;
        console.warn('Live town extras unavailable', error);
        return false;
      }
      return building > 0;
    },
    invalidate() {
      look = undefined;
      rest = undefined;
      unprepare();
      farReady = false;
      checked = undefined;
    },
    contextLost() {
      drop(false);
    },
    stats: () => stats,
    dispose() {
      disposed = true;
      drop(true);
    },
  };
}
