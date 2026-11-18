/**
 * Terrain context attachment, restoration and disposal, called by the Terrain3d facade.
 * Reads/writes: Reads canvas/options and retained inputs; creates/restores backend resources and releases view jobs, caches and event subscriptions on the supplied context.
 */
import { deleteForestTextures } from '../terrainGl';
import { disposeForestBrushes } from '../../render/forestBrushAtlas';
import { ShaderVariants } from '../glVariants';
import { UrbanBuildingPass } from '../urbanBuilding3d';
import { UrbanBuildingGround } from '../urbanBuildingGround';
import { Terrain3dStatus } from './terrainTypes';
import { program } from './webglProgram';
import { skyVertex, skyFragment } from './terrainShaders';
import { GRID } from './terrainPolicy';
import { fullPatchIndices } from './patchIndices';
import type { Terrain3dContext } from './terrainContext';

/** Records a status attribute, shown on the element unless the view is silent. */
export function mark(context: Terrain3dContext, key: Terrain3dStatus, value: string): void {
  context.status[key] = value;
  if (!context.silent) context.element.dataset[key] = value;
}

export function getStatus(context: Terrain3dContext, key: Terrain3dStatus): string | undefined {
  return context.status[key];
}

/** A silent view becomes the displayed one: its status attributes replace the previous view's. */
export function showStatus(context: Terrain3dContext): void {
  context.silent = false;
  for (const key of ['renderer', 'terrainShader', 'groundVariant'] as const) {
    if (context.status[key] === undefined) delete context.element.dataset[key];
    else context.element.dataset[key] = context.status[key];
  }
}

/** Takes the canvas context and creates the GPU objects (called by the constructor, before any
 * subclass field exists: the WebGPU backend overrides it with a no-op and initializes afterwards). */
export function attach(context: Terrain3dContext): void {
  const canvas = context.canvas;
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('La vue 3D nécessite WebGL2.');
  context.gl = gl;
  context.initialize();
  context.mark('renderer', 'webgl');
  canvas.addEventListener(
    'webglcontextlost',
    event => {
      event.preventDefault();
      cancelAnimationFrame(context.frame);
      context.frame = 0;
      ++context.epoch;
      context.patches.clear();
      context.root = undefined;
    },
    { signal: context.events.signal },
  );
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      if (context.disposed) return;
      context.initialize();
      if (context.textureSource) context.setTexture(context.textureSource, context.billboardSource);
      context.request();
    },
    { signal: context.events.signal },
  );
}

export function initialize(context: Terrain3dContext): void {
  const gl = context.gl;
  context.msaa = undefined;
  context.maxFramebufferDimension = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  context.raisedMaterials.clear();
  context.billboardProgram = undefined;
  context.billboardVao = undefined;
  context.billboardBuffer = undefined;
  context.billboardAtlas = undefined;
  context.billboardDirty = true;
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  context.textureAnisotropy = anisotropy ? { parameter: anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, value: Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) } : undefined;
  context.uniformLocations = new WeakMap();
  context.clippedIndices.clear();
  context.mapProgram = context.lastGround = undefined;
  context.groundVariants?.reset();
  context.groundVariants = new ShaderVariants(gl, () => context.request());
  context.selectTerrainProgram(!!context.groundSettings || !!context.forestField);
  context.skyProgram = program(gl, skyVertex, skyFragment);
  context.buildings?.dispose();
  context.buildings = new UrbanBuildingPass(gl, () => context.request());
  context.buildings.setScene(context.buildingsVisible ? context.buildingScene : undefined, context.buildingAppearance);
  const side = GRID + 1,
    surfaceVertices = side * side,
    indices = fullPatchIndices();
  context.indices = gl.createBuffer()!;
  context.indexCount = indices.length;
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, context.indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  context.seams = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, context.seams);
  gl.bufferData(gl.ARRAY_BUFFER, (surfaceVertices + 4 * side) * 3 * 4, gl.DYNAMIC_DRAW);
  context.material = context.uploadTexture(new Uint8Array([203, 211, 182, 255]));
  context.macroTexture = context.uploadMacroField(context.layer);
  context.caveTexture = undefined;
  context.refreshCavern(true);
  context.shoreRing = undefined;
  context.empty = context.uploadMacroField();
  // A restored context comes back empty: re-upload the retained forest rasters.
  context.forest = context.occupation = undefined;
  context.setForest(context.forestField, context.forestOccupation);
}

export function dispose(context: Terrain3dContext): void {
  clearTimeout(context.settleTimer);
  context.unlistenQuality?.();
  context.disposed = true;
  context.active = false;
  context.stopWalking();
  cancelAnimationFrame(context.frame);
  context.events.abort();
  context.clearPatches();
  context.buildings.dispose();
  context.buildingScene = undefined;
  context.buildingGround = new UrbanBuildingGround();
  context.mergedOccupation = context.mergedOccupationSource = undefined;
  context.mergedOccupationScene = undefined;
  context.disposeBackend();
  context.forest = context.occupation = context.forestField = context.forestOccupation = undefined;
  context.textureSource = undefined;
  context.layer = undefined;
  context.water = undefined;
  context.heightSampler = undefined;
  context.tileLoader = undefined;
  context.pointers.clear();
  context.billboardSource = undefined;
}

/** Releases the backend's own objects (patches and buildings are already released). */
export function disposeBackend(context: Terrain3dContext): void {
  const gl = context.gl;
  context.releaseMsaa();
  if (context.billboardProgram) gl.deleteProgram(context.billboardProgram);
  if (context.billboardVao) gl.deleteVertexArray(context.billboardVao);
  if (context.billboardBuffer) gl.deleteBuffer(context.billboardBuffer);
  if (context.billboardAtlas) gl.deleteTexture(context.billboardAtlas.texture);
  for (const texture of context.raisedMaterials.values()) context.deleteTexture(texture);
  context.raisedMaterials.clear();
  gl.deleteBuffer(context.indices);
  gl.deleteBuffer(context.seams);
  gl.deleteTexture(context.material);
  gl.deleteTexture(context.macroTexture);
  if (context.caveTexture) gl.deleteTexture(context.caveTexture);
  gl.deleteTexture(context.empty);
  if (context.shoreRing) gl.deleteTexture(context.shoreRing.texture);
  if (context.mapProgram) gl.deleteProgram(context.mapProgram);
  context.groundVariants.reset(true);
  gl.deleteProgram(context.skyProgram);
  for (const geometry of context.clippedIndices.values()) gl.deleteBuffer(geometry.buffer);
  context.clippedIndices.clear();
  deleteForestTextures(gl, context.forest);
  if (context.occupation) gl.deleteTexture(context.occupation.texture);
  if (context.landDetail) gl.deleteTexture(context.landDetail.texture);
  disposeForestBrushes(gl);
}
