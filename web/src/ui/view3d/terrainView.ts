/**
 * Terrain3d facade and virtual backend hooks, called by 3D owners and the WebGPU subclass.
 * Reads/writes: Owns the Terrain3dState instance and constructor callbacks; passes that instance explicitly to responsibility modules while preserving virtual dispatch.
 */
import { Terrain3dState } from './terrainState';

import { onDisplayQualityChange } from '../../render/displayQuality';
import { type ForestTextures, type HeightLayer } from '../terrainGl';
import { type ForestField, type ForestOccupation, type LandDetail } from '../../../../rust/bridge/terrainForest';
import { type CavernField, type UnderdarkCavern3d } from '../../render/underdarkCavern';
import { type TerrainStitchedPiece } from '../terrain3dStitch';
import type { UrbanBuildingAppearance } from '../../render/urbanBuildingStyle';
import type { Building3dVisual, Building3dScene } from '../../render/urbanBuildingGeometry';
import type { BuildingFrame } from '../urbanBuilding3d';
import { UrbanGroundCuts } from '../urbanGroundCuts';
import { type TreeInputs } from '../terrain3dTrees';
import { type Terrain3dBillboard, type Terrain3dBillboards } from '../terrain3dBillboards';
import { Terrain3dTileContent, WaterSurface, Terrain3dGroundSettings, Terrain3dLookSettings, Terrain3dTile, Patch, Node, Terrain3dCamera, Terrain3dStatus, Terrain3dOptions, RenderPiece, FrameGeometry, MaterialRef, PatchMaterial, PatchDraw } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';
import * as terrainLifecycle from './terrainLifecycle';
import * as terrainPrograms from './terrainPrograms';
import * as terrainCavern from './terrainCavern';
import * as terrainWebglResources from './terrainWebglResources';
import * as terrainInputs from './terrainInputs';
import * as terrainTiles from './terrainTiles';
import * as terrainPatches from './terrainPatches';
import * as terrainSampling from './terrainSampling';
import * as terrainProjection from './terrainProjection';
import * as terrainCamera from './terrainCamera';
import * as terrainSelection from './terrainSelection';
import * as terrainMesh from './terrainMesh';
import * as terrainMorph from './terrainMorph';
import * as terrainWebglFrame from './terrainWebglFrame';
import * as terrainBillboards from './terrainBillboards';
import * as terrainTrees from './terrainTrees';
import * as terrainFungi from './terrainFungi';
import * as terrainNavigation from './terrainNavigation';
import * as terrainCapture from './terrainCapture';
import * as terrainFrame from './terrainFrame';
import * as terrainAntialiasing from './terrainAntialiasing';

/** Quadtree geometry and regional map materials, independent of generation. WebGL2 backend; the WebGPU
 * backend (terrain3dGpu.ts) overrides the protected GPU hooks (attach, upload*, release*, renderFrame...). */
export class Terrain3d extends Terrain3dState {
  constructor(
    protected canvas: HTMLCanvasElement,
    private onChange: () => void,
    private onRender?: () => void,
    protected options: Terrain3dOptions = {},
  ) {
    super();
    const context = this as unknown as Terrain3dContext;
    context.element = options.element ?? canvas;
    context.silent = !!options.silent;
    context.attach();
    context.element.style.touchAction = 'none';
    context.interactions();
    context.unlistenQuality = onDisplayQualityChange(() => {
      context.invalidateTiles();
      context.billboardDirty = true;
      context.request();
    });
  }
  protected mark(key: Terrain3dStatus, value: string): void {
    return terrainLifecycle.mark(this as unknown as Terrain3dContext, key, value);
  }
  getStatus(key: Terrain3dStatus): string | undefined {
    return terrainLifecycle.getStatus(this as unknown as Terrain3dContext, key);
  }
  showStatus(): void {
    return terrainLifecycle.showStatus(this as unknown as Terrain3dContext);
  }
  protected attach(): void {
    return terrainLifecycle.attach(this as unknown as Terrain3dContext);
  }
  private initialize(): void {
    return terrainLifecycle.initialize(this as unknown as Terrain3dContext);
  }
  protected selectTerrainProgram(procedural: boolean): void {
    return terrainPrograms.selectTerrainProgram(this as unknown as Terrain3dContext, procedural);
  }
  protected prepareMapShader(): void {
    return terrainPrograms.prepareMapShader(this as unknown as Terrain3dContext);
  }
  getShaderProfile(): 'map' | 'procedural' {
    return terrainPrograms.getShaderProfile(this as unknown as Terrain3dContext);
  }
  private groundShader(settings: Terrain3dGroundSettings | undefined): WebGLProgram {
    return terrainPrograms.groundShader(this as unknown as Terrain3dContext, settings);
  }
  private uniform(name: string, shader = (this as unknown as Terrain3dContext).terrainProgram): WebGLUniformLocation | null {
    return terrainPrograms.uniform(this as unknown as Terrain3dContext, name, shader);
  }
  protected uploadCavern(field: CavernField): WebGLTexture {
    return terrainCavern.uploadCavern(this as unknown as Terrain3dContext, field);
  }
  protected refreshCavern(force = false): void {
    return terrainCavern.refreshCavern(this as unknown as Terrain3dContext, force);
  }
  protected uploadMacroField(layer?: HeightLayer): WebGLTexture {
    return terrainWebglResources.uploadMacroField(this as unknown as Terrain3dContext, layer);
  }
  private rectangleIndices(tile: Terrain3dTile, clip: Terrain3dTile): { buffer: WebGLBuffer; count: number } {
    return terrainWebglResources.rectangleIndices(this as unknown as Terrain3dContext, tile, clip);
  }
  protected uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture {
    return terrainWebglResources.uploadTexture(this as unknown as Terrain3dContext, source);
  }
  setSurface(layer: HeightLayer, water?: WaterSurface, waterVisible = true): void {
    return terrainInputs.setSurface(this as unknown as Terrain3dContext, layer, water, waterVisible);
  }
  setHeightSampler(sample: ((x: number, y: number, metresPerPixel: number) => number) | undefined): void {
    return terrainInputs.setHeightSampler(this as unknown as Terrain3dContext, sample);
  }
  setGroundMaterial(settings: Terrain3dGroundSettings | undefined): void {
    return terrainInputs.setGroundMaterial(this as unknown as Terrain3dContext, settings);
  }
  setRenderV2Season(season: number): void {
    return terrainInputs.setRenderV2Season(this as unknown as Terrain3dContext, season);
  }
  setLook(look: Terrain3dLookSettings): void {
    return terrainInputs.setLook(this as unknown as Terrain3dContext, look);
  }
  setTileBoundaries(visible: boolean): void {
    return terrainInputs.setTileBoundaries(this as unknown as Terrain3dContext, visible);
  }
  setGroundCuts(cuts: UrbanGroundCuts): void {
    return terrainInputs.setGroundCuts(this as unknown as Terrain3dContext, cuts);
  }
  setBuildings(scene: Building3dScene | undefined, appearance: UrbanBuildingAppearance, visible = true): void {
    return terrainInputs.setBuildings(this as unknown as Terrain3dContext, scene, appearance, visible);
  }
  replaceBuildings(changes: readonly Building3dVisual[]): string[] {
    return terrainInputs.replaceBuildings(this as unknown as Terrain3dContext, changes);
  }
  setForest(field: ForestField | undefined, occupation?: ForestOccupation, settings = this.forestSettings): void {
    return terrainInputs.setForest(this as unknown as Terrain3dContext, field, occupation, settings);
  }
  protected uploadForest(field: ForestField): ForestTextures {
    return terrainWebglResources.uploadForest(this as unknown as Terrain3dContext, field);
  }
  protected releaseForest(textures: ForestTextures | undefined): void {
    return terrainWebglResources.releaseForest(this as unknown as Terrain3dContext, textures);
  }
  protected uploadOccupation(occupation: ForestOccupation): WebGLTexture {
    return terrainWebglResources.uploadOccupation(this as unknown as Terrain3dContext, occupation);
  }
  protected uploadLandDetail(detail: LandDetail): WebGLTexture {
    return terrainWebglResources.uploadLandDetail(this as unknown as Terrain3dContext, detail);
  }
  protected deleteTexture(texture: WebGLTexture): void {
    return terrainWebglResources.deleteTexture(this as unknown as Terrain3dContext, texture);
  }
  protected uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
    return terrainWebglResources.uploadWaterMask(this as unknown as Terrain3dContext, water);
  }
  protected uploadMesh(patch: Patch, values: Float32Array): void {
    return terrainWebglResources.uploadMesh(this as unknown as Terrain3dContext, patch, values);
  }
  protected releaseMesh(patch: Patch): void {
    return terrainWebglResources.releaseMesh(this as unknown as Terrain3dContext, patch);
  }
  protected contextLost(): boolean {
    return terrainWebglResources.contextLost(this as unknown as Terrain3dContext);
  }
  setTileLoader(loader: ((tile: Terrain3dTile) => Promise<TexImageSource | Terrain3dTileContent>) | undefined, requireHeights = false): void {
    return terrainTiles.setTileLoader(this as unknown as Terrain3dContext, loader, requireHeights);
  }
  invalidateTiles(region?: { minX: number; minY: number; maxX: number; maxY: number } | string): void {
    return terrainTiles.invalidateTiles(this as unknown as Terrain3dContext, region);
  }
  private applyStaleTiles(): void {
    return terrainTiles.applyStaleTiles(this as unknown as Terrain3dContext);
  }
  getLodInfo(): Terrain3dContext['lod'] & { covered: boolean } {
    return terrainPatches.getLodInfo(this as unknown as Terrain3dContext);
  }
  private clearPatches(): void {
    return terrainPatches.clearPatches(this as unknown as Terrain3dContext);
  }
  private surface(x: number, y: number, metresPerPixel: number, detail = true, carved = true): number {
    return terrainSampling.surface(this as unknown as Terrain3dContext, x, y, metresPerPixel, detail, carved);
  }
  heightAt(x: number, y: number): number | undefined {
    return terrainSampling.heightAt(this as unknown as Terrain3dContext, x, y);
  }
  groundAt(x: number, y: number): number | undefined {
    return terrainSampling.groundAt(this as unknown as Terrain3dContext, x, y);
  }
  pickBuilding(x: number, y: number): string | undefined {
    return terrainProjection.pickBuilding(this as unknown as Terrain3dContext, x, y);
  }
  screenToWorld(x: number, y: number): [number, number] | null {
    return terrainProjection.screenToWorld(this as unknown as Terrain3dContext, x, y);
  }
  worldToScreen(x: number, y: number): [number, number] | null {
    return terrainProjection.worldToScreen(this as unknown as Terrain3dContext, x, y);
  }
  labelProjector(): { scale: number; project(x: number, y: number): [number, number] | null } | undefined {
    return terrainProjection.labelProjector(this as unknown as Terrain3dContext);
  }
  private patch(level: number, ix: number, iy: number): Patch {
    return terrainPatches.patch(this as unknown as Terrain3dContext, level, ix, iy);
  }
  private frameGeometry(): FrameGeometry {
    return terrainCamera.frameGeometry(this as unknown as Terrain3dContext);
  }
  private nodeError(patch: Patch, frame: FrameGeometry): number {
    return terrainSelection.nodeError(this as unknown as Terrain3dContext, patch, frame);
  }
  private select(frame: FrameGeometry): void {
    return terrainSelection.select(this as unknown as Terrain3dContext, frame);
  }
  private *grid(patch: Patch): Generator<void, Float32Array> {
    return yield* terrainMesh.grid(this as unknown as Terrain3dContext, patch);
  }
  private *decodedGrid(tile: Terrain3dTile, layer: HeightLayer): Generator<void, Float32Array> {
    return yield* terrainMesh.decodedGrid(this as unknown as Terrain3dContext, tile, layer);
  }
  private installHeights(patch: Patch, heights: Float32Array): void {
    return terrainMesh.installHeights(this as unknown as Terrain3dContext, patch, heights);
  }
  private containsLivePatch(patch: Patch): boolean {
    return terrainPatches.containsLivePatch(this as unknown as Terrain3dContext, patch);
  }
  private *buildMesh(patch: Patch): Generator<void, void> {
    return yield* terrainMesh.buildMesh(this as unknown as Terrain3dContext, patch);
  }
  private prepareMeshes(): boolean {
    return terrainMesh.prepareMeshes(this as unknown as Terrain3dContext);
  }
  private loadTiles(): void {
    return terrainTiles.loadTiles(this as unknown as Terrain3dContext);
  }
  private closestTexture(patch: Patch): { texture: WebGLTexture; rect: [number, number, number, number]; texel: number; ready: boolean } {
    return terrainTiles.closestTexture(this as unknown as Terrain3dContext, patch);
  }
  private texturedAncestor(patch: Patch): boolean {
    return terrainTiles.texturedAncestor(this as unknown as Terrain3dContext, patch);
  }
  private subtreeTextured(node: Node): boolean {
    return terrainPatches.subtreeTextured(this as unknown as Terrain3dContext, node);
  }
  private covered(node: Node): boolean {
    return terrainPatches.covered(this as unknown as Terrain3dContext, node);
  }
  private protectMaterial(ref: MaterialRef): void {
    return terrainTiles.protectMaterial(this as unknown as Terrain3dContext, ref);
  }
  private materialFor(patch: Patch, geometryBlend = 1, depth = 0): PatchMaterial {
    return terrainTiles.materialFor(this as unknown as Terrain3dContext, patch, geometryBlend, depth);
  }
  protected textureRect(ref: MaterialRef, tile: Terrain3dTile): [number, number, number, number] {
    return terrainTiles.textureRect(this as unknown as Terrain3dContext, ref, tile);
  }
  protected overlayRect(ref: MaterialRef, tile: Terrain3dTile, ground = false): [number, number, number, number] {
    return terrainTiles.overlayRect(this as unknown as Terrain3dContext, ref, tile, ground);
  }
  private advanceMorphs(node: Node, incomingFull = true): void {
    return terrainMorph.advanceMorphs(this as unknown as Terrain3dContext, node, incomingFull);
  }
  private collectPieces(node: Node, pieces: RenderPiece[], incomingMorph = 1, ancestor?: { patch: Patch; morph: number }): void {
    return terrainMorph.collectPieces(this as unknown as Terrain3dContext, node, pieces, incomingMorph, ancestor);
  }
  private patchDraw(patch: Patch, drawn: Patch[], incomingMorph: number, clip: Terrain3dTile, stitched: TerrainStitchedPiece): PatchDraw | undefined {
    return terrainMorph.patchDraw(this as unknown as Terrain3dContext, patch, drawn, incomingMorph, clip, stitched);
  }
  private renderPatch(draw: PatchDraw, frame: FrameGeometry): void {
    return terrainWebglFrame.renderPatch(this as unknown as Terrain3dContext, draw, frame);
  }
  private releaseMaterial(texture: WebGLTexture): void {
    return terrainTiles.releaseMaterial(this as unknown as Terrain3dContext, texture);
  }
  private releasePatch(patch: Patch, preserveMesh = false): void {
    return terrainPatches.releasePatch(this as unknown as Terrain3dContext, patch, preserveMesh);
  }
  private trim(): void {
    return terrainPatches.trim(this as unknown as Terrain3dContext);
  }
  setTexture(source: TexImageSource, billboards?: Terrain3dBillboards): void {
    return terrainInputs.setTexture(this as unknown as Terrain3dContext, source, billboards);
  }
  setBillboards(stamps: readonly Terrain3dBillboard[] | undefined, atlas?: HTMLCanvasElement): void {
    return terrainBillboards.setBillboards(this as unknown as Terrain3dContext, stamps, atlas);
  }
  protected prepareBillboards(): void {
    return terrainBillboards.prepareBillboards(this as unknown as Terrain3dContext);
  }
  protected uploadBillboards(values: Float32Array, atlas?: HTMLCanvasElement): void {
    return terrainBillboards.uploadBillboards(this as unknown as Terrain3dContext, values, atlas);
  }
  private treeInputs(): TreeInputs | undefined {
    return terrainTrees.treeInputs(this as unknown as Terrain3dContext);
  }
  private waterAt(x: number, y: number): number {
    return terrainTrees.waterAt(this as unknown as Terrain3dContext, x, y);
  }
  private waterMaskChanged(x: number, y: number, width: number): void {
    return terrainTrees.waterMaskChanged(this as unknown as Terrain3dContext, x, y, width);
  }
  protected prepareTrees(frame: FrameGeometry): void {
    return terrainTrees.prepareTrees(this as unknown as Terrain3dContext, frame);
  }
  private updateTrees(frame: FrameGeometry): void {
    return terrainTrees.updateTrees(this as unknown as Terrain3dContext, frame);
  }
  protected uploadTrees(values: Float32Array): void {
    return terrainTrees.uploadTrees(this as unknown as Terrain3dContext, values);
  }
  protected forestTreesUniform(frame: FrameGeometry): [number, number, number, number] {
    return terrainTrees.forestTreesUniform(this as unknown as Terrain3dContext, frame);
  }
  protected treesShown(): boolean {
    return terrainTrees.treesShown(this as unknown as Terrain3dContext);
  }
  setNearTrees(enabled: boolean): void {
    return terrainTrees.setNearTrees(this as unknown as Terrain3dContext, enabled);
  }
  setTreeDistance(metres: number): void {
    return terrainTrees.setTreeDistance(this as unknown as Terrain3dContext, metres);
  }
  protected treeLight(): [number, number, number] {
    return terrainTrees.treeLight(this as unknown as Terrain3dContext);
  }
  protected fogDistance(): number {
    return terrainCamera.fogDistance(this as unknown as Terrain3dContext);
  }
  protected cavernSettings(): UnderdarkCavern3d {
    return terrainCavern.cavernSettings(this as unknown as Terrain3dContext);
  }
  protected cavernParameters(): [number, number, number, number] {
    return terrainCavern.cavernParameters(this as unknown as Terrain3dContext);
  }
  private drawTrees(frame: FrameGeometry): void {
    return terrainTrees.drawTrees(this as unknown as Terrain3dContext, frame);
  }
  protected prepareFungi(): void {
    return terrainFungi.prepareFungi(this as unknown as Terrain3dContext);
  }
  protected uploadFungi(values: Float32Array): void {
    return terrainFungi.uploadFungi(this as unknown as Terrain3dContext, values);
  }
  protected fungusArea(): [number, number, number, number] {
    return terrainFungi.fungusArea(this as unknown as Terrain3dContext);
  }
  framingView(x: number, y: number, distance: number): { x: number; y: number; distance: number; pitch: number } {
    return terrainCamera.framingView(this as unknown as Terrain3dContext, x, y, distance);
  }
  protected fungusFade(): [number, number, number, number] {
    return terrainFungi.fungusFade(this as unknown as Terrain3dContext);
  }
  protected townGlowUniform(): { values: Float32Array; count: number } {
    return terrainCavern.townGlowUniform(this as unknown as Terrain3dContext);
  }
  protected uploadRoof(mesh: { vertices: Float32Array; indices: Uint32Array } | undefined): void {
    return terrainCavern.uploadRoof(this as unknown as Terrain3dContext, mesh);
  }
  protected roofReveal(): [number, number, number, number] {
    return terrainCavern.roofReveal(this as unknown as Terrain3dContext);
  }
  protected roofShown(): boolean {
    return terrainCavern.roofShown(this as unknown as Terrain3dContext);
  }
  framingPitch(x?: number, y?: number, distance?: number): number {
    return terrainCamera.framingPitch(this as unknown as Terrain3dContext, x, y, distance);
  }
  private drawRoof(frame: FrameGeometry): void {
    return terrainCavern.drawRoof(this as unknown as Terrain3dContext, frame);
  }
  private drawFungi(frame: FrameGeometry): void {
    return terrainFungi.drawFungi(this as unknown as Terrain3dContext, frame);
  }
  protected billboardsReady(): boolean {
    return terrainBillboards.billboardsReady(this as unknown as Terrain3dContext);
  }
  protected raisedBlend(frame: FrameGeometry): number {
    return terrainBillboards.raisedBlend(this as unknown as Terrain3dContext, frame);
  }
  private drawBillboards(frame: FrameGeometry, blend: number): void {
    return terrainBillboards.drawBillboards(this as unknown as Terrain3dContext, frame, blend);
  }
  setCamera(camera: Terrain3dCamera): void {
    return terrainCamera.setCamera(this as unknown as Terrain3dContext, camera);
  }
  getCamera(): Terrain3dCamera {
    return terrainCamera.getCamera(this as unknown as Terrain3dContext);
  }
  setNavigation(navigation: 'orbit' | 'walk' | 'fly'): void {
    return terrainNavigation.setNavigation(this as unknown as Terrain3dContext, navigation);
  }
  private prepareCapture(): Promise<void> {
    return terrainCapture.prepareCapture(this as unknown as Terrain3dContext);
  }
  capture(): Promise<Blob> {
    return terrainCapture.capture(this as unknown as Terrain3dContext);
  }
  captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }> {
    return terrainCapture.captureIllustration(this as unknown as Terrain3dContext);
  }
  protected captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    return terrainCapture.captureFrame(this as unknown as Terrain3dContext, near, far);
  }
  setActive(active: boolean): void {
    return terrainFrame.setActive(this as unknown as Terrain3dContext, active);
  }
  resize(width: number, height: number): void {
    return terrainFrame.resize(this as unknown as Terrain3dContext, width, height);
  }
  fit(x?: number, y?: number, visibleWidth?: number): void {
    return terrainCamera.fit(this as unknown as Terrain3dContext, x, y, visibleWidth);
  }
  zoom(factor: number, cursorX?: number, cursorY?: number): void {
    return terrainCamera.zoom(this as unknown as Terrain3dContext, factor, cursorX, cursorY);
  }
  private cursorGround(x: number, y: number): [number, number] | null {
    return terrainCamera.cursorGround(this as unknown as Terrain3dContext, x, y);
  }
  north(): void {
    return terrainCamera.north(this as unknown as Terrain3dContext);
  }
  private interacting(): boolean {
    return terrainAntialiasing.interacting(this as unknown as Terrain3dContext);
  }
  private dpr(): number {
    return terrainAntialiasing.dpr(this as unknown as Terrain3dContext);
  }
  private maxScale(): number {
    return terrainAntialiasing.maxScale(this as unknown as Terrain3dContext);
  }
  private limitCamera(): void {
    return terrainCamera.limitCamera(this as unknown as Terrain3dContext);
  }
  private cameraMoving(): void {
    return terrainCamera.cameraMoving(this as unknown as Terrain3dContext);
  }
  private changed(): void {
    return terrainCamera.changed(this as unknown as Terrain3dContext);
  }
  private keepEyeOutOfGround(): void {
    return terrainCamera.keepEyeOutOfGround(this as unknown as Terrain3dContext);
  }
  protected request(): void {
    return terrainFrame.request(this as unknown as Terrain3dContext);
  }
  private draw(fullQuality = false): void {
    return terrainFrame.draw(this as unknown as Terrain3dContext, fullQuality);
  }
  private drawFrame(): void {
    return terrainFrame.drawFrame(this as unknown as Terrain3dContext);
  }
  protected renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    return terrainWebglFrame.renderFrame(this as unknown as Terrain3dContext, frame, w, h, draws);
  }
  private releaseMsaa(): void {
    return terrainAntialiasing.releaseMsaa(this as unknown as Terrain3dContext);
  }
  private msaaTarget(width: number, height: number): NonNullable<Terrain3d['msaa']> | undefined {
    return terrainAntialiasing.msaaTarget(this as unknown as Terrain3dContext, width, height);
  }
  protected buildingFrame(frame: FrameGeometry): BuildingFrame {
    return terrainWebglFrame.buildingFrame(this as unknown as Terrain3dContext, frame);
  }
  private navigationDistance(): number {
    return terrainCamera.navigationDistance(this as unknown as Terrain3dContext);
  }
  private navigationScale(): number {
    return terrainCamera.navigationScale(this as unknown as Terrain3dContext);
  }
  private orbit(dx: number, dy: number): void {
    return terrainCamera.orbit(this as unknown as Terrain3dContext, dx, dy);
  }
  private pan(dx: number, dy: number): void {
    return terrainCamera.pan(this as unknown as Terrain3dContext, dx, dy);
  }
  private walk(forward: number, right: number, seconds: number, fast = false): void {
    return terrainNavigation.walk(this as unknown as Terrain3dContext, forward, right, seconds, fast);
  }
  private fly(forward: number, right: number, up: number, seconds: number, fast = false): void {
    return terrainNavigation.fly(this as unknown as Terrain3dContext, forward, right, up, seconds, fast);
  }
  private stopWalking(): void {
    return terrainNavigation.stopWalking(this as unknown as Terrain3dContext);
  }
  private startWalking(): void {
    return terrainNavigation.startWalking(this as unknown as Terrain3dContext);
  }
  private touchGesture(): { x: number; y: number; distance: number } | undefined {
    return terrainNavigation.touchGesture(this as unknown as Terrain3dContext);
  }
  private interactions(): void {
    return terrainNavigation.interactions(this as unknown as Terrain3dContext);
  }

  /** Replays the retained CPU-side inputs on another view (backend switch, device recovery): relief, water,
   * height sampler, ground settings, buildings (with their swapped exteriors), forest, tile loader, map
   * texture, size, camera and activity. GPU objects are not shared: the target re-uploads, and its tiles
   * load again through the same loader. */
  transferTo(target: Terrain3d): void {
    const context = this as unknown as Terrain3dContext;
    target.setGroundMaterial(context.groundSettings);
    target.setLook(context.lookSettings);
    if (context.layer) target.setSurface(context.layer, context.water, context.waterVisible);
    target.setHeightSampler(context.heightSampler);
    target.setGroundCuts(context.groundCuts);
    target.setTileBoundaries(context.tileBounds);
    target.setBuildings(context.buildingScene, context.buildingAppearance, context.buildingsVisible);
    const replaced = context.buildings.replacedBuildings();
    if (replaced.length) target.replaceBuildings(replaced);
    target.setForest(context.forestField, context.forestOccupation, context.forestSettings);
    target.setTreeDistance(context.treeDistance);
    target.setNearTrees(context.nearTrees);
    target.setTileLoader(context.tileLoader, context.requireHeights);
    if (context.textureSource) target.setTexture(context.textureSource, context.billboardSource);
    else target.setBillboards(context.billboardSource?.stamps, context.billboardSource?.atlas);
    target.resize(context.width, context.height);
    target.setCamera(context.camera);
    (target as unknown as Terrain3dContext).orbitBeforeWalk = context.orbitBeforeWalk && { ...context.orbitBeforeWalk };
    target.setActive(context.active);
  }
  isSettled(): boolean {
    return terrainFrame.isSettled(this as unknown as Terrain3dContext);
  }
  get isActive(): boolean {
    return (this as unknown as Terrain3dContext).active;
  }
  dispose(): void {
    return terrainLifecycle.dispose(this as unknown as Terrain3dContext);
  }
  protected disposeBackend(): void {
    return terrainLifecycle.disposeBackend(this as unknown as Terrain3dContext);
  }
}
