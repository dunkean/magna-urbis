/**
 * The GPU town renderer: the retained state of one town scene on one WebGL2 context and its lifecycle.
 *
 * Geometry is built and uploaded once per scene (setScene) and once per building set (setBuildings); a view,
 * palette, layer or level-of-detail change rewrites per-feature colour tables (styleTables.ts), never geometry; a
 * frame (frame.ts) sets uniforms and issues a fixed handful of draws. Two owners: `createCityGlRenderer` on its own
 * canvas (City Bench, the V2's exact output of the drawn plans, through cityGlView.ts), which uploads when a build
 * completes and handles context loss; `createCityGlRendererOn` on the live compositor's context (the live town
 * layer), where packing, uploads, table preparation and program links are sliced and run from the owner's work.
 * One closure on purpose: programs, packs, state keys and pending commits change together at every upload, context
 * loss and dispose, and nothing outside reads them except a frame, which receives them as `GpuTown`.
 */
import type { Point } from '../../../../../rust/bridge/urban';
import type { CityBuildings, CityLod, CityScene } from '../model/contract';
import { selectCityLod } from '../levels';
import { buildStreetStrokes, buildTowers, cityOrigin, fillMesh, packBuildingsSteps, packPlanSteps, runSteps, STROKE_STRIDE, type CityGlBox4, type CityGlFillMesh, type CityGlFillSource, type CityGlStrokes } from '../../cityGlBuild';
import { buildingColors, buildingColorsSteps, DEFAULT_LAYERS, planColors, planColorsSteps, planMaterialTable, roofMaterialTable, streetColors, streetColorsSteps, streetMaterialTable, type CityGlDraws, type CityGlStyleState } from './styleTables';
import { SELECTION } from '../look';
import { buildYardStrokes, yardColors } from '../../cityGlYards';
import type { YardBoundary } from '../../cityLotEnclosures';
import { isBlended } from '../../groundBlend';
import { roofSeasonKey } from '../../seasonPalette';
import { toneKey } from '../../groundTone';
import { loadMaterialImages, uploadMaterialArrays } from '../../buildingMaterials';
import { cityStrokedWalls, cityWallColors, cityWallStrokes, createCityGlWalls, type CityGlWalls } from '../../cityWalls'; // walls hook (cityWalls.ts)
import { CityGlDrawOptions, CityGlFrame, CityGlBuildStats, CityGlRenderer, CityGlSharedRenderer, CityGlCreateOptions } from './contract';
import { FILL_VS, FILL_FS, PAVED_VS, PAVED_FS, STROKE_VS, STROKE_FS, TFILL_VS, TFILL_FS, DISC_VS, DISC_FS, WATER_VS, WATER_FS, strokeVariant } from './shaders';
import { Program, PendingProgram, startProgram, programLinked, finishProgram, compile } from './programs';
import { FillPack, FillPages, StrokePack, crossingStart, type FillPage } from './packs';
import { concatPolygons, sameBuildingPage, samePlanPage, splitBuildingsSteps, splitPlanSteps, splitTriangulation, type CityGlBuildingPage, type CityGlPlanPage } from './pages';
import { drawTownFrame } from './frame';
import { Triangulator } from './triangulator';
import { cityGlPick } from './hostTools';
import { SOFTWARE_GL } from '../../softwareGl';
import { countWork } from '../../workCount';

const defaultWorkers = (): number => Math.max(0, Math.min(4, ((globalThis.navigator?.hardwareConcurrency ?? 2) >> 1) - 1));
export function createCityGlRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, create: CityGlCreateOptions = {}): CityGlRenderer {
  const maybe = canvas.getContext('webgl2', { antialias: create.antialias ?? true, premultipliedAlpha: true, alpha: true, depth: false, stencil: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: !create.allowSoftware }) as WebGL2RenderingContext | null;
  if (!maybe) throw new Error(create.allowSoftware ? 'WebGL2 indisponible' : 'WebGL2 matériel indisponible');
  const gl: WebGL2RenderingContext = maybe;
  if (!create.allowSoftware) {
    const info = gl.getExtension('WEBGL_debug_renderer_info'),
      name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (SOFTWARE_GL.test(name)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw new Error(`WebGL2 logiciel (${name})`);
    }
  }
  const core = cityGlCore(gl, canvas, create, false);
  return Object.assign(core, {
    canvas,
    resize(width?: number, height?: number): void {
      const el = canvas as HTMLCanvasElement,
        dpr = globalThis.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(width ?? (el.clientWidth || canvas.width / dpr) * dpr)),
        h = Math.max(1, Math.round(height ?? (el.clientHeight || canvas.height / dpr) * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    },
  });
}
/** A cityGl renderer on a context owned by someone else (the live compositor's shared WebGL2 context). Throws when a
 * program does not compile. Every draw takes its target from `options.target`. */
export function createCityGlRendererOn(gl: WebGL2RenderingContext, create: Pick<CityGlCreateOptions, 'onInvalidate'> = {}): CityGlSharedRenderer {
  return cityGlCore(gl, undefined, create, true);
}
/** The renderer on `gl`. `canvas`: the renderer's own canvas (context events handled here); `deferUpload`: built meshes
 * wait for `upload()` instead of being uploaded when their build completes. */
function cityGlCore(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement | OffscreenCanvas | undefined, create: CityGlCreateOptions, deferUpload: boolean): CityGlSharedRenderer {
  let fillP: Program, strokeP: Program, casingP: Program, surfaceP: Program, discP: Program, pavedP: Program, tfillP: Program, texturedP: Program, waterP: Program;
  let water: { source: Float32Array; vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined,
    streetCrossings = 0;
  // Textured materials: the albedo array (loaded lazily on the first textured draw) and the key of each uploaded material table.
  let albedoTex: WebGLTexture | undefined,
    albedoLoading = false,
    planMatKey = '',
    streetMatKey = '',
    builtMatKey = '';
  // The fills as spatial pages (pages.ts): an edit packs, triangulates, colours and uploads only the pages it changed.
  let plan: FillPages<CityGlPlanPage> | undefined, built: FillPages<CityGlBuildingPage> | undefined, streets: StrokePack | undefined, walls: StrokePack | undefined, selection: StrokePack | undefined;
  let towers: { vbo: WebGLBuffer; vao: WebGLVertexArrayObject; count: number } | undefined;
  let scene: CityScene | undefined,
    buildings: CityBuildings | undefined,
    origin: Point = { x: 0, y: 0 };
  let streetSurface = true;
  let planMesh: PageBuild<CityGlPlanPage>[] | undefined, builtMesh: PageBuild<CityGlBuildingPage>[] | undefined, streetData: CityGlStrokes | undefined, wallData: CityGlStrokes | undefined, towerData: Float32Array | undefined;
  let styleKey = '',
    streetKey = '',
    builtKey = '',
    draws: CityGlDraws | undefined,
    towerColors: [string, string] = ['#5a5248', '#2f2a24'];
  let selectionKey = '',
    lastLod: CityLod | undefined,
    generation = 0,
    buildingGeneration = 0,
    lost = false,
    disposed = false,
    lastFrame: CityGlFrame | undefined;
  let buildStats: CityGlBuildStats | undefined, buildingStats: CityGlBuildStats | undefined;
  // Deferred uploads (shared context): the commits of the last completed builds, run by `upload()`.
  let commitPlan: (() => number) | undefined, commitBuildings: (() => number) | undefined;
  // Lot enclosures of the live look (setYards): instances, the looks of their features, the palette of their colours.
  let yards: { runs: StrokePack; jambs: StrokePack; looks: YardBoundary[]; palette: string } | undefined;
  // Sliced packing (shared context): resumable packers advanced by `step()`, oldest first; `done(false)` drops one.
  interface PackJob {
    kind: 'scene' | 'buildings';
    steps: Generator<void, void>;
    done(finished: boolean): void;
    fail(error: unknown): void;
  }
  const packJobs: PackJob[] = [];
  const packed = (kind: PackJob['kind'], steps: Generator<void, void>): Promise<boolean> =>
    new Promise((done, fail) => {
      packJobs.push({ kind, steps, done, fail });
      invalidate();
    });
  /** Drops the packings in progress (all, or the building sets only): their setScene / setBuildings return unfinished. */
  const abortPacking = (all: boolean): void => {
    for (let i = packJobs.length - 1; i >= 0; i--)
      if (all || packJobs[i].kind === 'buildings') {
        const [job] = packJobs.splice(i, 1);
        job.done(false);
      }
  };
  const abortedStats = (start: number): CityGlBuildStats => ({ packMs: 0, triangulateMs: 0, assembleMs: 0, uploadMs: 0, workers: 0, totalMs: performance.now() - start });
  const triangulator = new Triangulator();
  // On its own canvas the renderer is the plan path of the look (render/city/planPath.ts): its own street floors.
  const planPath = !deferUpload;

  let wallGl: CityGlWalls; // walls hook: detailed fortifications (cityWalls.ts)
  function init(): void {
    fillP = compile(gl, FILL_VS, FILL_FS);
    strokeP = compile(gl, strokeVariant(STROKE_VS, 0), strokeVariant(STROKE_FS, 0));
    casingP = compile(gl, strokeVariant(STROKE_VS, 1), strokeVariant(STROKE_FS, 1));
    surfaceP = compile(gl, strokeVariant(STROKE_VS, 2), strokeVariant(STROKE_FS, 2));
    discP = compile(gl, DISC_VS, DISC_FS);
    pavedP = compile(gl, PAVED_VS, PAVED_FS);
    tfillP = compile(gl, TFILL_VS, TFILL_FS);
    texturedP = compile(gl, strokeVariant(STROKE_VS, 3), strokeVariant(STROKE_FS, 3));
    waterP = compile(gl, WATER_VS, WATER_FS);
    wallGl = createCityGlWalls(gl); // walls hook
  }
  // Shared context: the same programs linked without blocking (`programsStep`, from the owner's work), never on first
  // use; the private canvas compiles them at once as before.
  const parallelLink = deferUpload && !!gl.getExtension('KHR_parallel_shader_compile');
  const programDefs: Array<[string, string, (p: Program) => void]> = [
    [
      FILL_VS,
      FILL_FS,
      p => {
        fillP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 0),
      strokeVariant(STROKE_FS, 0),
      p => {
        strokeP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 1),
      strokeVariant(STROKE_FS, 1),
      p => {
        casingP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 2),
      strokeVariant(STROKE_FS, 2),
      p => {
        surfaceP = p;
      },
    ],
    [
      DISC_VS,
      DISC_FS,
      p => {
        discP = p;
      },
    ],
    [
      PAVED_VS,
      PAVED_FS,
      p => {
        pavedP = p;
      },
    ],
    [
      TFILL_VS,
      TFILL_FS,
      p => {
        tfillP = p;
      },
    ],
    [
      strokeVariant(STROKE_VS, 3),
      strokeVariant(STROKE_FS, 3),
      p => {
        texturedP = p;
      },
    ],
    [
      WATER_VS,
      WATER_FS,
      p => {
        waterP = p;
      },
    ],
  ];
  const linking: { pending: PendingProgram; set: (p: Program) => void; done: boolean }[] = [];
  let programsReady = !deferUpload,
    wallsMade = !deferUpload;
  const madePrograms = (): Program[] => [fillP, strokeP, casingP, surfaceP, discP, pavedP, tfillP, texturedP, waterP].filter(p => !!p);
  if (!deferUpload) init();
  /** The pages of a build on the GPU: the kept ones as they are (made again only when a later upload let them go), the
   * others from their new mesh; the pages of `previous` not kept are released. */
  function pagesOn<T>(builds: readonly PageBuild<T>[], previous: FillPages<T> | undefined): FillPages<T> {
    const alive = new Set(previous?.pages.map(p => p.pack));
    const pages = builds.map((b): FillPage<T> => (b.kept && alive.has(b.kept.pack) ? b.kept : { key: b.key, part: b.part, pack: new FillPack(gl, b.mesh ?? b.kept!.pack.mesh), box: meshBox(b.mesh ?? b.kept!.pack.mesh) }));
    const kept = new Set(pages.map(p => p.pack));
    for (const p of previous?.pages ?? []) if (!kept.has(p.pack)) p.pack.dispose();
    return new FillPages(pages);
  }
  function uploadPlan(): number {
    const t = performance.now();
    const previous = plan;
    streets?.dispose();
    walls?.dispose();
    // Lot enclosures are relative to the scene origin: the owner sets them again for a new scene.
    if (yards) {
      yards.runs.dispose();
      yards.jambs.dispose();
      yards = undefined;
    }
    if (towers) {
      gl.deleteBuffer(towers.vbo);
      gl.deleteVertexArray(towers.vao);
      towers = undefined;
    }
    plan = planMesh ? pagesOn(planMesh, previous) : (previous?.dispose(), undefined);
    wallGl.upload(scene, origin); // walls hook
    streets = streetData && new StrokePack(gl, streetData);
    walls = wallData && new StrokePack(gl, wallData);
    streetCrossings = crossingStart(streetData);
    if (towerData) {
      const vbo = gl.createBuffer()!,
        vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, towerData, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);
      towers = { vbo, vao, count: towerData.length / 2 };
    }
    styleKey = streetKey = selectionKey = planMatKey = streetMatKey = '';
    return performance.now() - t;
  }
  function uploadBuildings(): number {
    const t = performance.now();
    built = builtMesh ? pagesOn(builtMesh, built) : (built?.dispose(), undefined);
    builtKey = builtMatKey = '';
    return performance.now() - t;
  }
  const invalidate = (): void => {
    if (!disposed) create.onInvalidate?.();
  };
  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    invalidate();
  };
  const onRestored = (): void => {
    // Old GL objects are invalid after restoration. Keep Canvas active until
    // programmes and the latest retained CPU meshes have all been reuploaded.
    lost = true;
    plan = built = streets = walls = selection = undefined;
    towers = undefined;
    water = undefined;
    albedoTex = undefined;
    albedoLoading = false;
    try {
      init();
      // Every page made again from its mesh (no previous pages: the old handles are dead).
      uploadPlan();
      uploadBuildings();
      lost = false;
    } catch (error) {
      console.warn('Restauration WebGL de la ville indisponible, Canvas 2D utilisé', error);
    } finally {
      invalidate();
    }
  };
  canvas?.addEventListener('webglcontextlost', onLost as EventListener);
  canvas?.addEventListener('webglcontextrestored', onRestored as EventListener);

  /** The meshes of the pages a build packed again, triangulated in one run. `kind`: the plan or the buildings, each
   * triangulating only the polygons its last packing did not hold. */
  async function buildFills<T>(builds: PageBuild<T>[], workers: number, kind: 'plan' | 'buildings'): Promise<{ triangulateMs: number; assembleMs: number; workers: number }> {
    const fresh = builds.filter(b => b.source);
    if (!fresh.length) return { triangulateMs: 0, assembleMs: 0, workers: 0 };
    let t = performance.now();
    const polygons = fresh.map(b => b.source!.polygons);
    const { result, workers: used } = await triangulator.run({ ...fresh[0].source!, polygons: concatPolygons(polygons) }, workers, kind);
    const triangulateMs = performance.now() - t;
    t = performance.now();
    const parts = splitTriangulation(result, polygons);
    fresh.forEach((b, i) => {
      b.mesh = fillMesh(b.source!, parts[i]);
      b.source = undefined;
    });
    return { triangulateMs, assembleMs: performance.now() - t, workers: used };
  }

  /** Keys and style state of a draw: the plan tables depend on the level of detail, streets and buildings do not. */
  function stateOf(o: CityGlDrawOptions, lod: CityLod) {
    const palette = o.palette ?? 'growth',
      layers = { ...DEFAULT_LAYERS, ...o.layers };
    const footprint = o.buildingStyle === 'silhouette';
    // The live look stands in for the Canvas 2D frame of the V2, which has no render background.
    const renderBackground = !o.live && globalThis.document?.documentElement.dataset.cityBackground === 'render',
      painted = !footprint && (o.paintedBuildings ?? renderBackground);
    const style: CityGlStyleState = {
      buildingStyle: o.buildingStyle,
      roof: o.roof,
      view: o.view,
      lod,
      palette,
      layers,
      buildingsVisible: o.buildingsVisible ?? true,
      diagnostic: o.diagnostic ?? 'none',
      refusedParcels: o.refusedParcels,
      painted,
      blended: o.groundBlend ?? isBlended(),
      colors: o.colors,
      live: o.live,
    };
    const colorKey = o.colors ? JSON.stringify(o.colors) : '',
      liveKey = o.live ? `live:${o.live.roadLook}:${o.live.emphasis}:${o.live.waterColor ?? ''}:${o.live.grain ? 1 : 0}:${o.live.farTown ? 1 : 0}` : '';
    const key = JSON.stringify([o.view, lod, palette, layers, style.buildingsVisible, o.buildingStyle, refusedKey(o.refusedParcels), painted, style.blended, toneKey(), palette === 'parchment' ? roofSeasonKey() : '']) + liveKey;
    const softStreets = !!style.blended && !(o.textured && palette !== 'parchment' && palette !== 'ink'),
      sKey = `${palette}|${softStreets}|${colorKey}|${toneKey()}|${liveKey}`;
        // Each page keeps the tables of its own buildings: no building generation in the key.
    const bKey = `${o.view}|${palette}|${style.diagnostic}|${o.buildingStyle}|${o.roof ?? ''}|${painted}|${colorKey}|${roofSeasonKey()}|${liveKey}`;
    return { palette, layers, footprint, renderBackground, painted, style, key, softStreets, sKey, bKey };
  }
  /** What a draw state needs on the GPU besides the meshes: street strokes of the road-surface switch, colour and
   * material tables, the drawn water. Each is rebuilt only when its state key changes (plan tables are kept per key),
   * so a frame of a known state only reads them; `prepareSteps` builds the heavy tables ahead in slices. Requires a
   * scene and a plan. */
  function styleFrame(o: CityGlDrawOptions, lod: CityLod) {
    const s = scene!,
      pl = plan!;
    const { palette, layers, footprint, renderBackground, painted, style, key, softStreets, sKey, bKey } = stateOf(o, lod);
    // Road surface layer toggled: rebuild the street strokes (round caps, one width when off).
    const surface = layers.roadSurface !== false;
    if (surface !== streetSurface) {
      streetSurface = surface;
      if (scene && origin && !lost && !gl.isContextLost()) {
        streetData = buildStreetStrokes(scene, origin, surface, planPath);
        streets?.dispose();
        streets = new StrokePack(gl, streetData);
        streetCrossings = crossingStart(streetData);
        streetKey = '';
      }
    }
    // Colour tables: rebuilt only when the state changes (plan tables of recent states are kept).
    if (key !== styleKey) {
      // Only the pages that lack the tables of this state compute them.
      if (!pl.has(key)) {
        for (const page of pl.pages)
          if (!page.pack.has(key)) {
            const pc = planColors(page.part.plan, page.pack.mesh, style);
            page.pack.colors(pc.fill, pc.line, key, pc.draws, { hatch: pc.hatch });
          }
        pl.forget(key);
      }
      draws = pl.table(key)!.draws;
      styleKey = key;
    }
    if (sKey !== streetKey) {
      const sc = streetColors(s, palette, softStreets, o.colors, o.live),
        wc = cityWallColors(s, palette); // walls hook
      streets?.colors(sc.outer, sc.inner);
      walls?.colors(wc.outer, wc.inner);
      towerColors = wc.tower;
      streetKey = sKey;
    }
    if (built && bKey !== builtKey) {
      for (const page of built.pages)
        if (!page.pack.has(bKey)) {
          const bc = buildingColors(page.part.buildings, style);
          page.pack.colors(bc.fill, bc.line, bKey, undefined, { ...bc.roofGrain });
        }
      built.table(bKey);
      builtKey = bKey;
    }
    // Lot enclosures (live look): a few texels per look, by palette.
    if (yards && yards.palette !== palette) {
      const c = yardColors(yards.looks, palette);
      yards.runs.colors(c.line, c.line);
      yards.jambs.colors(c.jamb, c.jamb);
      yards.palette = palette;
    }
    // Textured materials: albedo array loaded once (the plan is drawn flat until it arrives, then repainted).
    const textured = !!o.textured && !!albedoTex;
    if (o.textured && !albedoTex && !albedoLoading) {
      albedoLoading = true;
      loadMaterialImages()
        .then(images => {
          if (disposed || lost || gl.isContextLost()) return;
          albedoTex = uploadMaterialArrays(gl, images, false).albedo;
          invalidate();
        })
        .catch(e => {
          console.warn('Matières texturées indisponibles', e);
        })
        .finally(() => {
          albedoLoading = false;
        });
    }
    if (textured) {
      const pk = `${styleKey}|${o.textured}`;
      if (planMatKey !== pk) {
        for (const page of pl.pages) page.pack.materials(planMaterialTable(page.part.plan, page.pack.mesh));
        planMatKey = pk;
      }
      if (streets && streetMatKey !== 'on') {
        streets.materials(streetMaterialTable(s));
        streetMatKey = 'on';
      }
      if (built && builtMatKey !== bKey) {
        for (const page of built.pages) page.pack.materials(roofMaterialTable(page.part.buildings, style));
        builtMatKey = bKey;
      }
    }
    if (o.water !== water?.source) {
      if (water) {
        gl.deleteBuffer(water.vbo);
        gl.deleteVertexArray(water.vao);
        water = undefined;
      }
      if (o.water && o.water.length >= 9) {
        const vbo = gl.createBuffer()!,
          vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, o.water, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 16);
        gl.vertexAttribDivisor(1, 1);
        gl.bindVertexArray(null);
        water = { source: o.water, vbo, vao, count: Math.floor(o.water.length / 9) };
      }
    }
    return { palette, layers, footprint, renderBackground, painted, softStreets, textured, d: draws! };
  }
  const renderer: CityGlSharedRenderer = {
    gl,
    get ready() {
      return programsReady && !disposed && !lost && !gl.isContextLost() && !!scene && !!plan;
    },
    get programsLinked() {
      return programsReady;
    },
    programsStep() {
      if (programsReady || disposed || gl.isContextLost()) return false;
      if (parallelLink) {
        // All compiles and links issued at once; finished as the driver completes them, polled on later calls.
        if (!linking.length) for (const [vs, fs, set] of programDefs) linking.push({ pending: startProgram(gl, vs, fs), set, done: false });
        for (const l of linking)
          if (!l.done && programLinked(gl, l.pending, true)) {
            l.set(finishProgram(gl, l.pending));
            l.done = true;
          }
        if (linking.some(l => !l.done)) return true;
      } else if (linking.length < programDefs.length) {
        // No parallel compile: one program per call.
        const [vs, fs, set] = programDefs[linking.length],
          pending = startProgram(gl, vs, fs);
        linking.push({ pending, set, done: true });
        set(finishProgram(gl, pending));
        return true;
      }
      // The detailed walls' program (cityWalls.ts links it at once): alone in its call.
      if (!wallsMade) {
        wallGl = createCityGlWalls(gl);
        wallsMade = true;
        return true;
      } // walls hook
      programsReady = true;
      invalidate();
      return false;
    },
    check(o) {
      if (!renderer.ready) return 'scene not uploaded';
      if (o.textured) return 'textured materials'; // the albedo array loads on first use
      const lod = o.lod ?? selectCityLod(o.metresPerPixel, lastLod),
        st = stateOf(o, lod);
      if ((st.layers.roadSurface !== false) !== streetSurface) return 'street surface';
      if (st.key !== styleKey && !plan!.has(st.key)) return 'plan tables';
      if (st.sKey !== streetKey) return 'street tables';
      if (built && st.bKey !== builtKey && !built.has(st.bKey)) return 'building tables';
      if (o.water !== water?.source) return 'water';
      if (yards && yards.palette !== st.palette) return 'enclosure colours';
      return '';
    },
    get pendingUpload() {
      return !!commitPlan || !!commitBuildings;
    },
    upload() {
      if (!programsReady || disposed || lost || gl.isContextLost()) return false;
      // One commit per call: the plan (with its strokes), then the buildings, each a few buffers.
      const p = commitPlan,
        b = p ? undefined : commitBuildings;
      if (p) commitPlan = undefined;
      else commitBuildings = undefined;
      const ms = p?.() ?? b?.() ?? 0;
      if (p || b) countWork('town.upload');
      gl.bindVertexArray(null); // StrokePack leaves its VAO bound: nothing of ours stays bound in the shared context
      if (p && buildStats) buildStats.uploadMs = ms;
      else if (b && buildingStats) buildingStats.uploadMs = ms;
      return !!p || !!b;
    },
    prepare(o) {
      if (!renderer.ready) return;
      styleFrame(o, o.lod ?? selectCityLod(o.metresPerPixel, lastLod));
      gl.bindVertexArray(null);
    },
    *prepareSteps(o) {
      if (!renderer.ready || commitPlan || commitBuildings) return;
      const lod = o.lod ?? selectCityLod(o.metresPerPixel, lastLod),
        st = stateOf(o, lod),
        pl = plan!,
        s = scene!;
      // The heavy tables (a pass over every block and parcel, every building and pan, every street) in slices, kept
      // per key; then the rest of the state at once, which finds them kept.
      if (!pl.has(st.key)) {
        for (const page of pl.pages) {
          if (page.pack.has(st.key)) continue;
          const pc = yield* planColorsSteps(page.part.plan, page.pack.mesh, st.style);
          if (plan !== pl) return;
          page.pack.colors(pc.fill, pc.line, st.key, pc.draws, { hatch: pc.hatch });
          if (styleKey) page.pack.table(styleKey); // `colors` made the new tables current: the draw state stays the drawn one
        }
        pl.forget(st.key);
      }
      if (st.sKey !== streetKey) {
        const sc = yield* streetColorsSteps(s, st.palette, st.softStreets, o.colors, o.live);
        if (scene !== s) return;
        const wc = cityWallColors(s, st.palette); // walls hook
        streets?.colors(sc.outer, sc.inner);
        walls?.colors(wc.outer, wc.inner);
        towerColors = wc.tower;
        streetKey = st.sKey;
      }
      const bb = built;
      if (bb && !bb.has(st.bKey))
        for (const page of bb.pages) {
          if (page.pack.has(st.bKey)) continue;
          const bc = yield* buildingColorsSteps(page.part.buildings, st.style);
          if (built !== bb) return;
          page.pack.colors(bc.fill, bc.line, st.bKey, undefined, { ...bc.roofGrain });
          if (builtKey) page.pack.table(builtKey);
        }
      styleFrame(o, lod);
      gl.bindVertexArray(null);
    },
    setYards(lists) {
      if (yards) {
        yards.runs.dispose();
        yards.jambs.dispose();
        yards = undefined;
      }
      if (!scene || lost || gl.isContextLost()) return;
      const y = buildYardStrokes(lists, origin);
      if (y) yards = { runs: new StrokePack(gl, y.runs), jambs: new StrokePack(gl, y.jambs), looks: y.looks, palette: '' };
      gl.bindVertexArray(null);
    },
    get packing() {
      return packJobs.length > 0;
    },
    step(budgetMs) {
      const t = performance.now();
      while (packJobs.length) {
        const job = packJobs[0];
        try {
          for (;;) {
            if (job.steps.next().done) {
              packJobs.shift();
              job.done(true);
              break;
            }
            if (performance.now() - t >= budgetMs) return true;
          }
        } catch (error) {
          packJobs.shift();
          job.fail(error);
        }
      }
      return false;
    },
    async setScene(next, nextBuildings, options = {}) {
      countWork('town.packScene');
      const gen = ++generation,
        start = performance.now(),
        workers = options.workers ?? defaultWorkers();
      const t = performance.now();
      let o = cityOrigin(next);
      const out: { plan?: PageBuild<CityGlPlanPage>[]; streets?: CityGlStrokes; walls?: CityGlStrokes; towers?: Float32Array; built?: PageBuild<CityGlBuildingPage>[] } = {};
      const pack = function* (): Generator<void, void> {
        // The pages whose elements are those of a drawn page keep its GPU data; the others are packed again.
        const planPages = yield* splitPlanSteps(next);
        if (!planPages.size) planPages.set(-1, { key: -1, plan: next, blocks: [], parcels: [], footprint: [], quays: [], waterways: [] });
        const buildingPages = nextBuildings && (yield* splitBuildingsSteps(nextBuildings));
        out.plan = matchPages(planPages, plan, samePlanPage);
        out.built = buildingPages && matchPages(buildingPages, built, sameBuildingPage);
        // Kept pages are relative to the drawn origin: the new pages take it too.
        if (out.plan.some(b => b.kept) || out.built?.some(b => b.kept)) o = origin;
        rebase(out.plan, o);
        if (out.built) rebase(out.built, o);
        for (const b of out.plan) if (!b.kept) b.source = yield* packPlanSteps(b.part.plan, o);
        yield;
        out.streets = buildStreetStrokes(next, o, streetSurface, planPath);
        yield;
        out.walls = cityWallStrokes(next, o);
        out.towers = buildTowers(cityStrokedWalls(next), o);
        yield; // walls hook
        if (out.built) {
          countWork('town.planHouseMesh');
          for (const b of out.built) if (!b.kept) b.source = yield* packBuildingsSteps(b.part.buildings, o);
        }
      };
      // Shared context: packed in slices by `step()`; a newer scene drops every packing in progress.
      if (deferUpload) {
        abortPacking(true);
        if (!(await packed('scene', pack()))) return abortedStats(start);
      } else runSteps(pack());
      const packMs = performance.now() - t;
      if (gen !== generation) return abortedStats(start);
      const sd = out.streets!,
        wd = out.walls!,
        td = out.towers!,
        pb = out.plan!,
        bb = out.built;
      const [p, b] = await Promise.all([buildFills(pb, workers, 'plan'), bb && buildFills(bb, workers, 'buildings')]);
      if (gen !== generation) return { packMs, triangulateMs: p.triangulateMs, assembleMs: p.assembleMs, uploadMs: 0, workers: p.workers, totalMs: performance.now() - start };
      const commit = (): number => {
        scene = next;
        origin = o;
        planMesh = pb;
        streetData = sd;
        wallData = wd;
        towerData = td;
        buildings = nextBuildings;
        builtMesh = bb;
        return lost || gl.isContextLost() ? 0 : uploadPlan() + uploadBuildings();
      };
      buildingGeneration++;
      // Deferred: the scene (with its building set, not drawable until both are up) at one `upload()`, the building
      // buffers at the next; an earlier building set is dropped.
      let uploadMs = 0;
      if (deferUpload) {
        commitPlan = () => {
          scene = next;
          origin = o;
          planMesh = pb;
          streetData = sd;
          wallData = wd;
          towerData = td;
          buildings = nextBuildings;
          builtMesh = bb;
          return lost || gl.isContextLost() ? 0 : uploadPlan();
        };
        commitBuildings = () => (lost || gl.isContextLost() ? 0 : uploadBuildings());
      } else uploadMs = commit();
      buildStats = { packMs, triangulateMs: p.triangulateMs + (b?.triangulateMs ?? 0), assembleMs: p.assembleMs + (b?.assembleMs ?? 0), uploadMs, workers: p.workers, totalMs: performance.now() - start };
      invalidate();
      return buildStats;
    },
    async setBuildings(next, options = {}) {
      countWork('town.packBuildings');
      const gen = ++buildingGeneration,
        start = performance.now(),
        workers = options.workers ?? defaultWorkers(),
        o = origin;
      const t = performance.now();
      const out: { built?: PageBuild<CityGlBuildingPage>[] } = {};
      const pack = function* (): Generator<void, void> {
        if (!next) return;
        // Only the pages of the set that differ from the drawn ones (a tier swap of one large town, an edit).
        out.built = matchPages(yield* splitBuildingsSteps(next), built, sameBuildingPage);
        rebase(out.built, o);
        for (const b of out.built) if (!b.kept) b.source = yield* packBuildingsSteps(b.part.buildings, o);
      };
      if (deferUpload) {
        abortPacking(false);
        if (!(await packed('buildings', pack()))) return abortedStats(start);
      } else runSteps(pack());
      const packMs = performance.now() - t;
      if (gen !== buildingGeneration) return abortedStats(start);
      const source = out.built,
        b = source && (await buildFills(source, workers, 'buildings'));
      if (gen !== buildingGeneration) return { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs: 0, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      const commit = (): number => {
        buildings = next;
        builtMesh = source;
        return lost || gl.isContextLost() ? 0 : uploadBuildings();
      };
      let uploadMs = 0;
      if (deferUpload) commitBuildings = commit;
      else uploadMs = commit();
      buildingStats = { packMs, triangulateMs: b?.triangulateMs ?? 0, assembleMs: b?.assembleMs ?? 0, uploadMs, workers: b?.workers ?? 0, totalMs: performance.now() - start };
      invalidate();
      return buildingStats;
    },
    draw(o) {
      const start = performance.now(),
        lod = o.lod ?? selectCityLod(o.metresPerPixel, lastLod);
      lastLod = lod;
      const frame: CityGlFrame = { lod, drawCalls: 0, instances: 0, triangles: 0, cpuMs: 0 };
      if (renderer.ready && scene && plan) {
        const style = styleFrame(o, lod);
        // Selection: a 2 px outline built on demand (a few segments).
        const selKey = `${o.buildingStyle ?? ''}|${o.selectedId ?? ''}|${o.selectedParcel ?? ''}|${generation}|${buildingGeneration}`;
        if (selKey !== selectionKey) {
          selection?.dispose();
          selection = selectionStrokes(o);
          selectionKey = selKey;
        }
        drawTownFrame({ gl, fillP, strokeP, casingP, surfaceP, discP, pavedP, tfillP, texturedP, waterP, plan, built, streets, walls, selection, yards, towers, water, wallGl, origin, buildings, streetCrossings, streetSurface, albedoTex, towerColors }, o, lod, style, frame);
      }
      frame.cpuMs = performance.now() - start;
      lastFrame = frame;
      return frame;
    },
    pick(point, o) {
      if (!scene) return {};
      const lod = o?.lod ?? (o?.metresPerPixel ? selectCityLod(o.metresPerPixel, lastLod) : (lastLod ?? 'near'));
      const showBuildings = (o?.buildingsVisible ?? true) && (lod === 'near' || lod === 'close') && (!o?.view || o.view === 'buildings' || o.view === 'roles');
      return cityGlPick(scene, showBuildings ? buildings : undefined, point);
    },
    stats() {
      const fs = (pages?: FillPages<unknown>) => {
        if (!pages) return undefined;
        const out = { vertices: 0, triangles: 0, edges: 0, features: 0 };
        for (const { pack } of pages.pages) {
          out.vertices += pack.mesh.positions.length / 2;
          out.triangles += pack.mesh.triangles.length / 3;
          out.edges += pack.mesh.lines.length / 2;
          out.features += pack.mesh.featureCount;
        }
        return out;
      };
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        plan: fs(plan),
        buildings: fs(built),
        pages: (plan?.pages.length ?? 0) + (built?.pages.length ?? 0),
        streets: streetData?.count ?? 0,
        walls: wallData?.count ?? 0,
        towers: (towerData?.length ?? 0) / 2,
        gpuBytes: (plan?.bytes ?? 0) + (built?.bytes ?? 0) + (streets?.bytes ?? 0) + (walls?.bytes ?? 0) + (towerData?.byteLength ?? 0) + (wallGl?.bytes ?? 0) + (water?.source.byteLength ?? 0),
        build: buildStats,
        buildingsBuild: buildingStats,
        frame: lastFrame,
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      };
    },
    dispose() {
      disposed = true;
      generation++;
      buildingGeneration++;
      triangulator.dispose();
      plan?.dispose();
      built?.dispose();
      streets?.dispose();
      walls?.dispose();
      selection?.dispose();
      if (towers) {
        gl.deleteBuffer(towers.vbo);
        gl.deleteVertexArray(towers.vao);
      }
      for (const p of madePrograms()) gl.deleteProgram(p.program);
      for (const l of linking)
        if (!l.done) {
          gl.deleteProgram(l.pending.program);
          l.pending.shaders.forEach(s => gl.deleteShader(s));
        }
      if (water) {
        gl.deleteBuffer(water.vbo);
        gl.deleteVertexArray(water.vao);
        water = undefined;
      }
      if (albedoTex) gl.deleteTexture(albedoTex);
      if (wallsMade) wallGl.dispose(); // walls hook
      canvas?.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas?.removeEventListener('webglcontextrestored', onRestored as EventListener);
      commitPlan = commitBuildings = undefined;
      abortPacking(true);
      if (yards) {
        yards.runs.dispose();
        yards.jambs.dispose();
        yards = undefined;
      }
      plan = built = streets = walls = selection = undefined;
      towers = undefined;
      scene = undefined;
      buildings = undefined;
      planMesh = builtMesh = undefined;
    },
  };

  function selectionStrokes(o: CityGlDrawOptions): StrokePack | undefined {
    if (!scene) return undefined;
    const b = o.selectedId === undefined ? undefined : buildings?.byId.get(o.selectedId);
    const parcel = o.selectedParcel ?? (o.selectedId === undefined ? undefined : scene.parcelById.get(o.selectedId));
    const shapes = b !== undefined ? (o.buildingStyle === 'silhouette' ? (buildings!.items[b].footprint ?? buildings!.items[b].building.footprint) : buildings!.items[b].surface) : parcel !== undefined && scene.parcels[parcel] ? [scene.parcels[parcel].shape] : [];
    const rings = shapes.flatMap(s => [s.outer, ...(s.holes ?? [])]).filter(r => r.length >= 2);
    if (!rings.length) return undefined;
    const n = rings.reduce((s, r) => s + r.length, 0),
      buffer = new ArrayBuffer(n * STROKE_STRIDE * 4),
      f = new Float32Array(buffer),
      u32 = new Uint32Array(buffer);
    let k = 0;
    for (const r of rings)
      for (let i = 0; i < r.length; i++) {
        const a = r[i],
          c = r[(i + 1) % r.length],
          j = k++ * STROKE_STRIDE;
        f[j] = a.x - origin.x;
        f[j + 1] = a.y - origin.y;
        f[j + 2] = c.x - origin.x;
        f[j + 3] = c.y - origin.y;
        f[j + 4] = 0;
        f[j + 5] = SELECTION.widthPx!;
        f[j + 6] = 0;
        u32[j + 7] = 0;
        u32[j + 8] = 0;
      }
    return new StrokePack(gl, { data: buffer, count: k, firstWithRank: [] }, true);
  }
  return renderer;
}
/** A page of a build: kept from the drawn fills, or packed again (`source`, then `mesh` once triangulated). */
interface PageBuild<T> {
  key: number;
  part: T;
  kept?: FillPage<T>;
  source?: CityGlFillSource;
  mesh?: CityGlFillMesh;
}
/** The pages of a split, each kept from `previous` when it holds the same elements. */
function matchPages<T extends { key: number }>(pages: ReadonlyMap<number, T>, previous: FillPages<T> | undefined, same: (a: T, b: T) => boolean): PageBuild<T>[] {
  const old = new Map(previous?.pages.map(p => [p.key, p]));
  return [...pages.values()].map(part => {
    const k = old.get(part.key);
    return k && same(k.part, part) ? { key: part.key, part: k.part, kept: k } : { key: part.key, part };
  });
}
/** Kept pages packed around another origin are packed again. */
function rebase<T>(builds: PageBuild<T>[], o: Point): void {
  for (const b of builds) if (b.kept && (b.kept.pack.mesh.origin.x !== o.x || b.kept.pack.mesh.origin.y !== o.y)) b.kept = undefined;
}
/** World box of a mesh's chunks. */
function meshBox(mesh: CityGlFillMesh): CityGlBox4 {
  const b: CityGlBox4 = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of Object.values(mesh.layers))
    for (const c of l.chunks) {
      if (c.box[0] < b[0]) b[0] = c.box[0];
      if (c.box[1] < b[1]) b[1] = c.box[1];
      if (c.box[2] > b[2]) b[2] = c.box[2];
      if (c.box[3] > b[3]) b[3] = c.box[3];
    }
  return b;
}
const refusedIds = new WeakMap<ReadonlySet<string>, number>();
let refusedNext = 1;
function refusedKey(set?: ReadonlySet<string>): string {
  if (!set?.size) return '';
  let id = refusedIds.get(set);
  if (!id) {
    id = refusedNext++;
    refusedIds.set(set, id);
  }
  return `${id}:${set.size}`;
}
