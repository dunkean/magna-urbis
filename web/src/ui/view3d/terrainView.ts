/**
 * Terrain3d, the 3D terrain view the owners hold (V2 3D view, City 3D, terrain bench, illustration captures): it
 * assembles the parts under terrain/ around one shared context, takes their inputs, and is the WebGL2 backend through
 * its protected resource and frame hooks, which the WebGPU view (gpu/view.ts) overrides. The renderer host
 * (host/host.ts) may replace one view by another with transferTo.
 */
import { onDisplayQualityChange } from '../../render/displayQuality';
import type { ForestTextures } from '../terrain/gl/forest';
import type { HeightLayer } from '../terrain/contract';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../rust/bridge/terrainForest';
import type { CavernField } from '../../render/underdarkCavern';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { Building3dVisual, Building3dScene } from '../../render/urbanBuildingGeometry';
import { UrbanBuildingPass } from '../urbanBuilding3d';
import type { UrbanGroundCuts } from '../urbanGroundCuts';
import type { UrbanGroundShape } from '../urbanGroundShape';
import type { RoadSqueeze } from '../../render/steepRoads';
import type { Terrain3dBillboard, Terrain3dBillboards } from '../terrain3dBillboards';
import { TerrainViewContext } from './terrain/context';
import type { FrameGeometry, Patch, PatchDraw, Terrain3dCamera, Terrain3dForestSettings, Terrain3dGroundSettings, Terrain3dLookSettings, Terrain3dOptions, Terrain3dStatus, Terrain3dTile, Terrain3dTileContent, TerrainResources, WaterSurface } from './terrain/contract';
import { FOV } from './terrain/policy';
import { TerrainStatus } from './terrain/status';
import { TerrainSurface } from './terrain/surface';
import { TerrainCavern } from './terrain/cavern';
import { TerrainCameraRig } from './terrain/camera';
import { TerrainNavigation } from './terrain/navigation';
import { TerrainBuildings } from './terrain/buildings';
import { TerrainForest } from './terrain/forest';
import { PatchTree } from './terrain/patchTree';
import { PatchMeshes } from './terrain/meshes';
import { TileMaterials } from './terrain/tiles';
import { NearTrees } from './terrain/trees';
import { UnderdarkFungi } from './terrain/fungi';
import { TerrainBillboards } from './terrain/billboards';
import { TerrainProjection, type LabelProjector } from './terrain/projection';
import { TerrainFrameLoop, type TerrainLod } from './terrain/frame';
import type { TerrainParts } from './terrain/parts';
import { GlTerrainRenderer } from './gl/renderer';

export class Terrain3d {
  protected readonly context: TerrainViewContext;
  protected readonly parts: TerrainParts;
  private readonly navigation: TerrainNavigation;
  private readonly projection: TerrainProjection;
  private readonly frames: TerrainFrameLoop;
  /** The WebGL2 backend's objects (absent in the WebGPU view). */
  private webgl?: GlTerrainRenderer;
  /** The whole-map texture and its stamps as given, replayed on a restored context or another view. */
  private textureSource?: TexImageSource;
  private unlistenQuality?: () => void;

  constructor(
    protected canvas: HTMLCanvasElement,
    onChange: () => void,
    onRender?: () => void,
    protected options: Terrain3dOptions = {},
  ) {
    const element = options.element ?? canvas;
    const context = (this.context = new TerrainViewContext(
      canvas,
      element,
      options,
      () => this.frames.request(),
      () => this.contextLost(),
    ));
    // The parts reach the backend through these hooks, so the WebGPU view's overrides apply to them.
    const resources: TerrainResources = {
      uploadTexture: source => this.uploadTexture(source),
      deleteTexture: texture => this.deleteTexture(texture),
      uploadWaterMask: water => this.uploadWaterMask(water),
      uploadMacroField: layer => this.uploadMacroField(layer),
      uploadCavern: field => this.uploadCavern(field),
      uploadRoof: mesh => this.uploadRoof(mesh),
      uploadForest: field => this.uploadForest(field),
      releaseForest: textures => this.releaseForest(textures),
      uploadOccupation: occupation => this.uploadOccupation(occupation),
      patchOccupation: (texture, previous, next, rects) => this.patchOccupation(texture, previous, next, rects),
      uploadLandDetail: detail => this.uploadLandDetail(detail),
      uploadMesh: (patch, values) => this.uploadMesh(patch, values),
      releaseMesh: patch => this.releaseMesh(patch),
      uploadTrees: values => this.uploadTrees(values),
      uploadFungi: values => this.uploadFungi(values),
      uploadBillboards: (values, atlas) => this.uploadBillboards(values, atlas),
    };
    const status = new TerrainStatus(element, !!options.silent);
    const surface: TerrainSurface = new TerrainSurface(context, () => cavern.field);
    const rig: TerrainCameraRig = new TerrainCameraRig(
      context,
      surface,
      () => cavern.field,
      (x, y) => this.projection.screenToWorld(x, y),
      onChange,
    );
    const cavern: TerrainCavern = new TerrainCavern(
      context,
      resources,
      () => rig.camera,
      () => this.clearPatches(),
    );
    const buildings = new TerrainBuildings(surface);
    const forest = new TerrainForest(
      context,
      resources,
      () => buildings.scene,
      procedural => this.selectTerrainProgram(procedural),
    );
    const release = (texture: WebGLTexture): void => tiles.release(texture),
      requireHeights = (): boolean => tiles.requireHeights;
    const tree = new PatchTree(context, surface, rig, resources, release, requireHeights);
    const meshes = new PatchMeshes(context, surface, tree, rig, resources, release, requireHeights);
    const tiles: TileMaterials = new TileMaterials(
      context,
      resources,
      surface,
      rig,
      tree,
      () => meshes,
      (x, y, width) => trees.waterMaskChanged(x, y, width),
      () => this.clearPatches(),
    );
    const waterAt = (x: number, y: number): number => tiles.waterAt(x, y);
    const trees = new NearTrees(context, resources, surface, rig, forest, waterAt);
    const fungi = new UnderdarkFungi(context, resources, surface, rig, cavern, forest, waterAt);
    const billboards = new TerrainBillboards(context, resources, surface, rig, () => this.billboardsReady());
    this.parts = { status, surface, cavern, rig, buildings, forest, tree, meshes, tiles, trees, fungi, billboards };
    this.navigation = new TerrainNavigation(context, rig, surface, buildings);
    this.frames = new TerrainFrameLoop(context, this.parts, (frame, w, h, draws) => this.renderFrame(frame, w, h, draws), onRender);
    this.projection = new TerrainProjection(context, surface, rig, () => this.frames.displayedGrids, buildings);
    this.attach();
    element.style.touchAction = 'none';
    this.navigation.install();
    this.unlistenQuality = onDisplayQualityChange(() => {
      this.invalidateTiles();
      billboards.dirty = true;
      context.request();
    });
  }

  getStatus(key: Terrain3dStatus): string | undefined {
    return this.parts.status.get(key);
  }

  showStatus(): void {
    this.parts.status.show();
  }

  getShaderProfile(): 'map' | 'procedural' {
    return this.context.useMapShader ? 'map' : 'procedural';
  }

  /** The draped-map shader unless a material ground (or a forest) needs the procedural one. */
  protected selectTerrainProgram(procedural: boolean): void {
    const context = this.context;
    context.useMapShader = !!context.options.fastMapShader && !procedural;
    if (context.useMapShader) this.prepareMapShader();
    this.parts.status.mark('terrainShader', context.useMapShader ? 'map' : 'procedural');
  }

  /** Every input of the surface: patches, grids, meshes and streams are rebuilt under a new epoch. */
  private clearPatches(): void {
    const { meshes, trees, fungi, billboards, tree } = this.parts;
    ++this.context.epoch;
    this.context.preparation.clear();
    meshes.clear();
    trees.reset();
    fungi.reset();
    billboards.dirty = true;
    tree.clear();
    this.frames.clear();
  }

  setSurface(layer: HeightLayer, water?: WaterSurface, waterVisible = true): void {
    const { surface, billboards, cavern, rig } = this.parts;
    if (surface.same(layer, water, waterVisible)) return;
    surface.layer = layer;
    surface.water = water;
    surface.waterVisible = waterVisible;
    billboards.dirty = true;
    this.deleteTexture(surface.macroTexture);
    surface.macroTexture = this.uploadMacroField(layer);
    cavern.refresh(layer);
    surface.measure();
    this.clearPatches();
    rig.limit();
    this.context.request();
  }

  setHeightSampler(sample: ((x: number, y: number, metresPerPixel: number) => number) | undefined): void {
    if (sample === this.parts.surface.heightSampler) return;
    this.parts.surface.heightSampler = sample;
    this.clearPatches();
    this.context.request();
    this.parts.billboards.dirty = true;
  }

  setGroundMaterial(settings: Terrain3dGroundSettings | undefined): void {
    const context = this.context,
      { surface, cavern, rig, tiles, forest } = this.parts,
      previous = context.ground;
    if (settings && (settings.ambience !== undefined || settings.waterLook !== undefined)) this.setLook(settings);
    // Compile before committing the switch: a failed optional material keeps
    // the current renderer and retained geometry usable.
    this.selectTerrainProgram(!!settings || !!forest.textures);
    context.ground = settings;
    cavern.refresh(surface.layer);
    rig.reframeOnTowns();
    if (settings?.renderV2 && !previous?.renderV2 && !this.textureSource) {
      this.deleteTexture(tiles.material);
      tiles.material = this.uploadTexture(new Uint8Array([0, 0, 0, 0]));
    }
    if (
      !!previous?.displacement !== !!settings?.displacement ||
      (settings?.displacement && (previous?.seed !== settings.seed || previous?.sourceCell !== settings.sourceCell || previous?.climate.temperature !== settings.climate.temperature || previous?.climate.precipitation !== settings.climate.precipitation))
    )
      this.clearPatches();
    rig.limit();
    context.request();
  }

  setRenderV2Season(season: number): void {
    if (this.context.ground?.renderV2) {
      this.context.ground = { ...this.context.ground, v2Season: season };
      this.context.request();
    }
  }

  setLook(look: Terrain3dLookSettings): void {
    const current = this.context.look;
    if (current.paperMap === look.paperMap && current.ambience === look.ambience && current.waterLook === look.waterLook && current.waterVisible === look.waterVisible && current.groundCover === look.groundCover && !!current.craftedBeds === !!look.craftedBeds) return;
    if (!!current.craftedBeds !== !!look.craftedBeds) this.parts.fungi.reset();
    this.context.look = { ...look };
    this.context.request();
  }

  setTileBoundaries(visible: boolean): void {
    this.context.tileBounds = visible;
    this.context.request();
  }

  /** Ground cuts (town moats): built once per set of circuits; a new set reshapes the patches. */
  setGroundCuts(cuts: UrbanGroundCuts): void {
    if (cuts === this.parts.surface.groundCuts) return;
    this.parts.surface.groundCuts = cuts;
    this.clearPatches();
    this.context.request();
  }

  /** Levelled hillside lots (urbanGroundShape.ts), undefined for the natural ground: built once per town content by the
   * 3D view on `naturalGroundAt`; a new one reshapes the patches. */
  setGroundShape(shape: UrbanGroundShape | undefined): void {
    if (shape === this.parts.surface.groundShape) return;
    this.parts.surface.groundShape = shape;
    this.clearPatches();
    this.context.request();
  }

  /** Squeeze of the regional roads on steep slopes (render/steepRoads.ts), undefined when none is steep: built once per
   * roads and relief by the 3D view on `naturalGroundAt`; a new one rebuilds the meshes, whose vertices hold it. */
  setRoadSqueeze(squeeze: RoadSqueeze | undefined): void {
    if (squeeze === this.parts.surface.roadSqueeze) return;
    this.parts.surface.roadSqueeze = squeeze;
    this.clearPatches();
    this.context.request();
  }

  /** Presentation consumes the same immutable native scene as the map. */
  setBuildings(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance, visible = true): void {
    const { buildings, billboards, forest } = this.parts;
    if (buildings.assign(scene, appearance, visible)) {
      billboards.dirty = true;
      this.clearPatches();
      forest.refresh();
    }
    buildings.pass.setScene(buildings.shown(), appearance);
    this.context.request();
  }

  /** Swap a few buildings of the current scene (native exteriors in or out):
   * only their sectors rebuild; relief, patches and forest stay untouched. */
  replaceBuildings(changes: readonly Building3dVisual[]): string[] {
    const buildings = this.parts.buildings;
    if (!buildings.visible || !changes.length) return [];
    const missing = buildings.pass.replaceBuildings(changes);
    const absent = new Set(missing);
    for (const building of changes) if (!absent.has(building.id)) buildings.walkCollisions.replace(building);
    this.context.request();
    return missing;
  }

  /** Render3D forest: texture uploads only, no mesh or material tile rebuild. */
  setForest(field: ForestField | undefined, occupation?: ForestOccupation, settings: Terrain3dForestSettings | undefined = this.parts.forest.settings): void {
    this.parts.forest.set(field, occupation, settings);
  }

  setTileLoader(loader: ((tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>) | undefined, requireHeights = false): void {
    this.parts.tiles.setLoader(loader, requireHeights);
  }

  /** Repaint the ground textures: all of them, the tiles overlapping a world `region`, or one tile by its key.
   * A tile keeps showing its current texture until the replacement is built and uploaded (swap on ready). */
  invalidateTiles(region?: { minX: number; minY: number; maxX: number; maxY: number } | string): void {
    this.parts.tiles.invalidate(region);
  }

  /** The whole-map material, and the raised stamps drawn with it. */
  setTexture(source: TexImageSource, billboards?: Terrain3dBillboards): void {
    this.textureSource = source;
    this.setBillboards(billboards?.stamps, billboards?.atlas);
    this.parts.tiles.setWholeMap(source);
  }

  /** Also accepted by setTexture so the renderer host mirrors this input during backend replacement. */
  setBillboards(stamps: readonly Terrain3dBillboard[] | undefined, atlas?: HTMLCanvasElement): void {
    this.parts.billboards.set(stamps, atlas);
  }

  setNearTrees(enabled: boolean): void {
    this.parts.trees.setEnabled(enabled);
  }

  setTreeDistance(metres: number): void {
    this.parts.trees.setDistance(metres);
  }

  getLodInfo(): TerrainLod & { covered: boolean } {
    return this.frames.lodInfo();
  }

  heightAt(x: number, y: number): number | undefined {
    return this.parts.surface.heightAt(x, y);
  }

  groundAt(x: number, y: number): number | undefined {
    return this.parts.surface.groundAt(x, y);
  }

  naturalGroundAt(x: number, y: number): number | undefined {
    return this.parts.surface.naturalAt(x, y);
  }

  pickBuilding(x: number, y: number): string | undefined {
    return this.projection.pickBuilding(x, y);
  }

  screenToWorld(x: number, y: number): [number, number] | null {
    return this.projection.screenToWorld(x, y);
  }

  worldToScreen(x: number, y: number): [number, number] | null {
    return this.projection.worldToScreen(x, y);
  }

  labelProjector(): LabelProjector | undefined {
    return this.projection.labelProjector();
  }

  framingView(x: number, y: number, distance: number): { x: number; y: number; distance: number; pitch: number } {
    return this.parts.rig.framingView(x, y, distance);
  }

  framingPitch(x?: number, y?: number, distance?: number): number {
    return this.parts.rig.framingPitch(x, y, distance);
  }

  setCamera(camera: Terrain3dCamera): void {
    this.navigation.stopWalking();
    this.parts.rig.set(camera);
  }

  getCamera(): Terrain3dCamera {
    return { ...this.parts.rig.camera };
  }

  setNavigation(navigation: 'orbit' | 'walk' | 'fly'): void {
    this.navigation.setNavigation(navigation);
  }

  fit(x?: number, y?: number, visibleWidth?: number): void {
    if (!this.parts.surface.layer) return;
    this.navigation.stopWalking();
    this.parts.rig.fit(x, y, visibleWidth);
  }

  zoom(factor: number, cursorX?: number, cursorY?: number): void {
    this.parts.rig.zoom(factor, cursorX, cursorY);
  }

  north(): void {
    this.parts.rig.north();
  }

  setActive(active: boolean): void {
    this.context.active = active;
    if (active) this.context.request();
    else {
      this.navigation.stopWalking();
      this.frames.cancel();
      this.parts.rig.rest();
      this.navigation.release();
    }
  }

  resize(width: number, height: number): void {
    this.context.width = Math.max(1, width);
    this.context.height = Math.max(1, height);
    this.parts.rig.limit();
    this.context.request();
  }

  /** Refine live previews through the original whole-tile painter before encoding. */
  private async prepareCapture(): Promise<void> {
    const context = this.context,
      { tiles, meshes } = this.parts;
    context.captureMode = true;
    try {
      do {
        this.frames.draw(true);
        if (!context.active || context.disposed || this.contextLost()) throw new DOMException('Capture cancelled', 'AbortError');
        if (!tiles.jobs.size && !context.preparation.pending && !meshes.jobs.size && !context.animating) return;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      } while (true);
    } catch (error) {
      context.captureMode = false;
      throw error;
    }
  }

  /** Draw and read in the same task: no permanent drawing-buffer retention. */
  async capture(): Promise<Blob> {
    const context = this.context;
    if (!context.active || !this.parts.surface.layer || this.contextLost()) return Promise.reject(new Error('Ouvrez la vue 3D avant de la capturer.'));
    await this.prepareCapture();
    try {
      return await new Promise<Blob>((resolve, reject) => this.canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.'))), 'image/png'));
    } finally {
      context.captureMode = false;
      context.request();
    }
  }

  /** The frame, its normalized inverse depth and the camera that drew it, for the illustration pipeline. */
  async captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }> {
    const context = this.context,
      { surface, rig } = this.parts;
    if (!context.active || !surface.layer || this.contextLost()) throw new Error('Ouvrez la vue 3D avant de la capturer.');
    await this.prepareCapture();
    try {
      const camera = this.getCamera(),
        geometry = rig.frameGeometry();
      camera.heightAboveTargetMetres = geometry.eye[1];
      camera.viewAngleDegrees = (Math.atan2(-geometry.forward[1], Math.hypot(geometry.forward[0], geometry.forward[2])) * 180) / Math.PI;
      // Map north is decreasing world y; yaw=0 puts the eye south of the target.
      camera.azimuthDegrees = ((((-camera.yaw * 180) / Math.PI) % 360) + 360) % 360;
      camera.verticalFovDegrees = (FOV * 180) / Math.PI;
      if (camera.exaggeration === 1) camera.altitudeMetres = geometry.targetHeight + geometry.eye[1];
      const far = Math.max(camera.distance * 4, surface.layer!.width * 2 + surface.heightRange * camera.exaggeration * 2);
      const frame = await this.captureFrame(Math.max(0.02, camera.distance * 0.0002), far);
      context.request();
      const encode = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Capture 3D indisponible.'))), 'image/png'));
      const [image, depth] = await Promise.all([encode(frame.color), encode(frame.depth)]);
      return { image, depth, camera };
    } finally {
      context.captureMode = false;
      context.request();
    }
  }

  /** Replays the retained CPU-side inputs on another view (backend switch, device recovery): relief, water,
   * height sampler, ground settings, buildings (with their swapped exteriors), forest, tile loader, map
   * texture, size, camera and activity. GPU objects are not shared: the target re-uploads, and its tiles
   * load again through the same loader. */
  transferTo(target: Terrain3d): void {
    const context = this.context,
      { surface, buildings, forest, trees, tiles, billboards, rig } = this.parts;
    target.setGroundMaterial(context.ground);
    target.setLook(context.look);
    if (surface.layer) target.setSurface(surface.layer, surface.water, surface.waterVisible);
    target.setHeightSampler(surface.heightSampler);
    target.setGroundCuts(surface.groundCuts);
    target.setGroundShape(surface.groundShape);
    target.setRoadSqueeze(surface.roadSqueeze);
    target.setTileBoundaries(context.tileBounds);
    target.setBuildings(buildings.scene, buildings.appearance, buildings.visible);
    const replaced = buildings.pass.replacedBuildings();
    if (replaced.length) target.replaceBuildings(replaced);
    target.setForest(forest.field, forest.source, forest.settings);
    target.setTreeDistance(trees.distance);
    target.setNearTrees(trees.enabled);
    target.setTileLoader(tiles.loader, tiles.requireHeights);
    if (this.textureSource) target.setTexture(this.textureSource, billboards.source);
    else target.setBillboards(billboards.source?.stamps, billboards.source?.atlas);
    target.resize(context.width, context.height);
    target.setCamera(rig.camera);
    target.navigation.orbitBeforeWalk = this.navigation.orbitBeforeWalk && { ...this.navigation.orbitBeforeWalk };
    target.setActive(context.active);
  }

  isSettled(): boolean {
    return this.frames.isSettled();
  }

  get isActive(): boolean {
    return this.context.active;
  }

  dispose(): void {
    const context = this.context,
      { rig, buildings, surface, forest, tiles, billboards } = this.parts;
    rig.rest();
    this.unlistenQuality?.();
    context.disposed = true;
    context.active = false;
    this.navigation.stopWalking();
    this.frames.cancel();
    context.events.abort();
    this.clearPatches();
    buildings.pass.dispose();
    buildings.assign(undefined, buildings.appearance, false);
    forest.clear();
    this.disposeBackend();
    forest.forget();
    this.textureSource = undefined;
    surface.layer = undefined;
    surface.water = undefined;
    surface.heightSampler = undefined;
    surface.groundShape = undefined;
    surface.roadSqueeze = undefined;
    tiles.loader = undefined;
    this.navigation.forgetPointers();
    billboards.source = undefined;
  }

  // WebGL2 backend hooks. The WebGPU view overrides every one of them (gpu/view.ts).

  /** Takes the canvas context and creates the GPU objects (called by the constructor, before any
   * subclass field exists: the WebGPU backend overrides it with a no-op and initializes afterwards). */
  protected attach(): void {
    const canvas = this.canvas,
      context = this.context;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('La vue 3D nécessite WebGL2.');
    this.webgl = new GlTerrainRenderer(gl, context, this.parts);
    this.initialize();
    this.parts.status.mark('renderer', 'webgl');
    canvas.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();
        this.frames.cancel();
        ++context.epoch;
        this.parts.tree.forget();
      },
      { signal: context.events.signal },
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        if (context.disposed) return;
        this.initialize();
        if (this.textureSource) this.setTexture(this.textureSource, this.parts.billboards.source);
        context.request();
      },
      { signal: context.events.signal },
    );
  }

  /** Creates every object of a new or restored WebGL context and re-uploads the retained inputs. */
  private initialize(): void {
    const webgl = this.webgl!,
      { tiles, billboards, buildings, surface, cavern, forest } = this.parts;
    webgl.restart();
    tiles.raised.clear();
    billboards.dirty = true;
    this.selectTerrainProgram(!!this.context.ground || !!forest.field);
    webgl.programs.createSky();
    buildings.pass?.dispose();
    buildings.pass = new UrbanBuildingPass(webgl.gl, () => this.context.request());
    buildings.pass.setScene(buildings.shown(), buildings.appearance);
    webgl.createPatchBuffers();
    tiles.material = this.uploadTexture(new Uint8Array([203, 211, 182, 255]));
    surface.macroTexture = this.uploadMacroField(surface.layer);
    cavern.forgetTexture();
    cavern.refresh(surface.layer, true);
    webgl.createEmpty();
    // A restored context comes back empty: re-upload the retained forest rasters.
    forest.reupload();
  }

  protected prepareMapShader(): void {
    this.webgl!.programs.prepareMap();
  }

  protected contextLost(): boolean {
    return this.webgl!.gl.isContextLost();
  }

  protected uploadCavern(field: CavernField): WebGLTexture {
    return this.webgl!.uploadCavern(field);
  }

  protected uploadMacroField(layer?: HeightLayer): WebGLTexture {
    return this.webgl!.uploadMacroField(layer);
  }

  protected uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture {
    return this.webgl!.uploadTexture(source);
  }

  protected deleteTexture(texture: WebGLTexture): void {
    this.webgl!.deleteTexture(texture);
  }

  protected uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
    return this.webgl!.uploadWaterMask(water);
  }

  protected uploadForest(field: ForestField): ForestTextures {
    return this.webgl!.uploadForest(field);
  }

  protected releaseForest(textures: ForestTextures | undefined): void {
    this.webgl!.releaseForest(textures);
  }

  protected uploadOccupation(occupation: ForestOccupation): WebGLTexture {
    return this.webgl!.uploadOccupation(occupation);
  }

  protected patchOccupation(texture: WebGLTexture, _previous: ForestOccupation, next: ForestOccupation, rects: NonNullable<ForestOccupation['dirty']>['rects']): void {
    this.webgl!.patchOccupation(texture, next, rects);
  }

  protected uploadLandDetail(detail: LandDetail): WebGLTexture {
    return this.webgl!.uploadLandDetail(detail);
  }

  protected uploadMesh(patch: Patch, values: Float32Array): void {
    this.webgl!.uploadMesh(patch, values);
  }

  protected releaseMesh(patch: Patch): void {
    this.webgl!.releaseMesh(patch);
  }

  protected uploadTrees(values: Float32Array): void {
    this.webgl!.instances.uploadTrees(values);
  }

  protected uploadFungi(values: Float32Array): void {
    this.webgl!.instances.uploadFungi(values);
  }

  protected uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    this.webgl!.instances.uploadRoof(mesh);
  }

  protected uploadBillboards(values: Float32Array, atlas?: HTMLCanvasElement): void {
    this.webgl!.uploadBillboards(values, atlas);
  }

  protected billboardsReady(): boolean {
    return this.webgl!.instances.billboardsReady();
  }

  protected renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    return this.webgl!.renderFrame(frame, w, h, draws);
  }

  protected captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    return this.webgl!.captureFrame(near, far);
  }

  /** Releases the backend's own objects (patches and buildings are already released). */
  protected disposeBackend(): void {
    this.webgl!.dispose();
  }
}
