/**
 * The WebGL2 backend of the 3D terrain view: the context's objects (patch indices and seam stream, ground programs,
 * instanced passes, multisampled target, shore ring), the uploads the parts ask for, and the frame: sky, ground patches,
 * buildings, then trees, roof, mushrooms and raised stamps. Terrain3d creates it on its canvas and replaces it on a
 * restored context; the WebGPU view (gpu/view.ts) has its own and never creates this one.
 */
import { waterSeasonUniforms } from '../../../render/seasonPalette';
import { bindForest, bindLandDetail, deleteForestTextures, forestTexture, forestTextures, type ForestTextures } from '../../terrain/gl/forest';
import type { HeightLayer } from '../../terrain/contract';
import { shoreRingPixels, shoreRingTexture } from '../../../../../rust/bridge/terrainForestBeach';
import { bindForestBrushes, disposeForestBrushes } from '../../../render/forestBrushAtlas';
import { renderV2GlacierSources } from '../../../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform, setSeasonCalendarGl } from '../../../../../rust/bridge/terrainRenderV2Zones';
import { terrainLights } from '../../../render/terrainLighting';
import { groundCoverActive } from '../../../render/materialLook';
import type { ForestField, ForestOccupation, LandDetail } from '../../../../../rust/bridge/terrainForest';
import type { CavernField } from '../../../render/underdarkCavern';
import { captureWebGlFrame } from '../../illustrationDepth';
import type { BuildingFrame } from '../../urbanBuilding3d';
import { GRID } from '../terrain/policy';
import { fullPatchIndices, patchClipKey, clippedPatchIndices } from '../terrain/patchIndices';
import { paddedMaterial } from '../terrain/materialImages';
import type { TerrainViewContext } from '../terrain/context';
import type { FrameGeometry, Patch, PatchDraw, Terrain3dGroundSettings, Terrain3dTile, Terrain3dTileContent } from '../terrain/contract';
import type { TerrainParts } from '../terrain/parts';
import { GlGroundPrograms } from './programs';
import { GlInstances } from './instances';

type Msaa = { width: number; height: number; framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer; checked?: boolean };

export class GlTerrainRenderer {
  readonly programs: GlGroundPrograms;
  readonly instances: GlInstances;
  private textureAnisotropy?: { parameter: number; value: number };
  private indices!: WebGLBuffer;
  private indexCount = 0;
  private seams!: WebGLBuffer;
  private clippedIndices = new Map<string, { buffer: WebGLBuffer; count: number }>();
  private empty!: WebGLTexture;
  private shoreRing?: { layer: object; revision: number; texture: WebGLTexture };
  private msaa?: Msaa;
  /** The drawing buffer refused the MSAA resolve (ANGLE Vulkan: alpha:false back buffer is not RGBA8): draw to it directly. */
  private msaaUnsupported = false;
  /** A cast-shadow bake for a new light azimuth has landed in the shore ring: draw again to upload it. */
  private readonly ringChanged = (): void => this.context.request();

  constructor(
    readonly gl: WebGL2RenderingContext,
    private readonly context: TerrainViewContext,
    private readonly parts: TerrainParts,
  ) {
    this.programs = new GlGroundPrograms(gl, parts.status);
    this.instances = new GlInstances(gl, context, parts, this.programs);
  }

  /** First steps of a new or restored context: limits, extensions and program caches. */
  restart(): void {
    const gl = this.gl;
    this.msaa = undefined;
    this.context.maxFramebufferDimension = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    this.instances.resetBillboards();
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    this.textureAnisotropy = anisotropy ? { parameter: anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, value: Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) } : undefined;
    this.clippedIndices.clear();
    this.programs.reset(this.context.request);
  }

  /** The full-patch index buffer and the per-draw seam correction stream (vertex attribute 5). */
  createPatchBuffers(): void {
    const gl = this.gl,
      side = GRID + 1,
      surfaceVertices = side * side,
      indices = fullPatchIndices();
    this.indices = gl.createBuffer()!;
    this.indexCount = indices.length;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.seams = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seams);
    gl.bufferData(gl.ARRAY_BUFFER, (surfaceVertices + 4 * side) * 3 * 4, gl.DYNAMIC_DRAW);
  }

  /** The empty texture bound wherever an optional input is absent (and the shore ring forgotten with the old context). */
  createEmpty(): void {
    this.shoreRing = undefined;
    this.empty = this.uploadMacroField();
  }

  uploadMacroField(layer?: HeightLayer): WebGLTexture {
    const gl = this.gl,
      texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, layer?.n ?? 1, layer?.n ?? 1, 0, gl.RED, gl.FLOAT, layer?.data ?? new Float32Array(1));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Underdark cavern texels (RGBA16F, linear: soft rock 0-1, roof above the base, openness, clearance; see
   * render/underdarkCavern.ts): the shader's rim, occlusion and section cut read them. */
  uploadCavern(field: CavernField): WebGLTexture {
    const gl = this.gl,
      texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field.n, field.n, 0, gl.RGBA, gl.FLOAT, field.texels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Index buffer of a patch clipped to `clip` (a quadrant drawn by an ancestor's mesh), cached by clip. */
  private rectangleIndices(tile: Terrain3dTile, clip: Terrain3dTile): { buffer: WebGLBuffer; count: number } {
    const key = patchClipKey(tile, clip);
    if (!key) return { buffer: this.indices, count: this.indexCount };
    const cached = this.clippedIndices.get(key);
    if (cached) {
      this.clippedIndices.delete(key);
      this.clippedIndices.set(key, cached);
      return cached;
    }
    const indices = clippedPatchIndices(key);
    const gl = this.gl,
      buffer = gl.createBuffer()!;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const result = { buffer, count: indices.length };
    this.clippedIndices.set(key, result);
    if (this.clippedIndices.size > 64) {
      const oldest = this.clippedIndices.keys().next().value!;
      gl.deleteBuffer(this.clippedIndices.get(oldest)!.buffer);
      this.clippedIndices.delete(oldest);
    }
    return result;
  }

  /** Premultiplied RGBA8 with a one-texel border and mipmaps (a 1×1 colour from bytes). */
  uploadTexture(source: TexImageSource | Uint8Array): WebGLTexture {
    const gl = this.gl,
      texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (source instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paddedMaterial(source));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    // A capability query here synchronizes every tile upload with the preceding canopy draw.
    if (this.textureAnisotropy) gl.texParameterf(gl.TEXTURE_2D, this.textureAnisotropy.parameter, this.textureAnisotropy.value);
    return texture;
  }

  uploadBillboards(values: Float32Array, atlas?: HTMLCanvasElement): void {
    this.instances.uploadBillboards(values, atlas, source => this.uploadTexture(source), this.textureAnisotropy);
  }

  uploadForest(field: ForestField): ForestTextures {
    return forestTextures(this.gl, field);
  }

  releaseForest(textures: ForestTextures | undefined): void {
    deleteForestTextures(this.gl, textures);
  }

  uploadOccupation(occupation: ForestOccupation): WebGLTexture {
    return forestTexture(this.gl, occupation, true);
  }

  uploadLandDetail(detail: LandDetail): WebGLTexture {
    return forestTexture(this.gl, detail, true);
  }

  deleteTexture(texture: WebGLTexture): void {
    this.gl.deleteTexture(texture);
  }

  uploadWaterMask(water: NonNullable<Terrain3dTileContent['water']>): WebGLTexture {
    const gl = this.gl,
      mask = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, water.n, water.n, 0, gl.RED, gl.UNSIGNED_BYTE, water.alpha);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return mask;
  }

  /** Patch vertex buffer (10 floats per vertex, see PatchMeshes); sets patch.vao and patch.vertices. */
  uploadMesh(patch: Patch, values: Float32Array): void {
    const gl = this.gl;
    patch.vao = gl.createVertexArray()!;
    patch.vertices = gl.createBuffer()!;
    gl.bindVertexArray(patch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, patch.vertices);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 28);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 40, 32);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bindVertexArray(null);
  }

  /** Deletes the GPU objects of a patch mesh (the caller resets the fields). */
  releaseMesh(patch: Patch): void {
    if (patch.vao) this.gl.deleteVertexArray(patch.vao);
    if (patch.vertices) this.gl.deleteBuffer(patch.vertices);
  }

  private releaseMsaa(): void {
    if (!this.msaa) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.msaa.framebuffer);
    gl.deleteRenderbuffer(this.msaa.color);
    gl.deleteRenderbuffer(this.msaa.depth);
    this.msaa = undefined;
  }

  /** The multisampled target of the frames at rest (up to 4 samples), when the context can resolve it. */
  private msaaTarget(width: number, height: number): Msaa | undefined {
    if (this.msaa?.width === width && this.msaa.height === height) return this.msaa;
    this.releaseMsaa();
    if (this.msaaUnsupported) return undefined;
    const gl = this.gl;
    const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES) as Int32Array;
    const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array;
    const samples = [...colorSamples].find(n => n <= 4 && n > 1 && depthSamples.includes(n));
    if (!samples) return undefined;
    const framebuffer = gl.createFramebuffer()!,
      color = gl.createRenderbuffer()!,
      depth = gl.createRenderbuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    for (const [buffer, format, attachment] of [
      [color, gl.RGBA8, gl.COLOR_ATTACHMENT0],
      [depth, gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
    ] as const) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
    }
    this.msaa = { width, height, framebuffer, color, depth };
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.releaseMsaa();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return undefined;
    }
    return this.msaa;
  }

  /** Colour and normalized inverse depth of the frame just drawn (illustrationDepth.ts). */
  captureFrame(near: number, far: number): Promise<{ color: HTMLCanvasElement; depth: HTMLCanvasElement }> {
    return Promise.resolve(captureWebGlFrame(this.gl, near, far, this.msaa?.framebuffer));
  }

  private renderPatch(draw: PatchDraw, frame: FrameGeometry): void {
    const { patch, material, clip } = draw,
      gl = this.gl,
      { tiles, rig } = this.parts,
      u = (name: string): WebGLUniformLocation | null => this.programs.uniform(name),
      c = rig.camera,
      tile = patch.tile;
    gl.uniform3f(u('patchOffset'), patch.tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, patch.tile.y - c.y);
    gl.uniform3f(u('physicalOrigin'), patch.tile.x, patch.heightOrigin, patch.tile.y);
    gl.uniform3f(u('patchRect'), patch.tile.x, patch.tile.y, patch.tile.width);
    gl.uniform1f(u('morph'), draw.morph);
    gl.uniform4fv(u('textureRect'), draw.textureRect);
    gl.uniform4fv(u('previousRect'), draw.previousRect);
    gl.uniform1f(u('textureBlend'), material.blend);
    for (const [ref, name, flag, unit] of [
      [material.to, 'drapedMaterial', 'hasRaisedMaterial', 14],
      [material.from, 'previousDrapedMaterial', 'hasPreviousRaisedMaterial', 15],
    ] as const) {
      const raised = tiles.raised.get(ref.texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, raised ?? this.empty);
      gl.uniform1i(u(name), unit);
      gl.uniform1i(u(flag), raised ? 1 : 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, material.to.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, material.from.texture);
    for (const [ref, name, flag, unit] of [
      [material.to, 'semanticTile', 'hasSemanticTile', 12],
      [material.from, 'previousSemanticTile', 'hasPreviousSemanticTile', 13],
    ] as const) {
      const overlay = tiles.semantic.get(ref.texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, overlay?.texture ?? this.empty);
      gl.uniform1i(u(name), unit);
      gl.uniform1i(u(flag), overlay?.semantic ? 1 : 0);
      gl.uniform4fv(u(name === 'semanticTile' ? 'semanticRect' : 'previousSemanticRect'), tiles.overlayRect(ref, tile));
      gl.uniform1i(u(name === 'semanticTile' ? 'hasGroundTile' : 'hasPreviousGroundTile'), overlay?.atlas ? 1 : 0);
      gl.uniform4fv(u(name === 'semanticTile' ? 'groundRect' : 'previousGroundRect'), tiles.overlayRect(ref, tile, true));
    }
    for (const [ref, prefix, unit] of [
      [material.to, '', 6],
      [material.from, 'previous', 7],
    ] as const) {
      const mask = tiles.waterMasks.get(ref.texture),
        name = prefix ? 'previousCanopyWater' : 'canopyWater';
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, mask?.texture ?? this.empty);
      gl.uniform1i(u(name), unit);
      gl.uniform1i(u(prefix ? 'hasPreviousCanopyWater' : 'hasCanopyWater'), mask ? 1 : 0);
      gl.uniform3f(u(`${name}Rect`), mask?.rect[0] ?? 0, mask?.rect[1] ?? 0, mask?.rect[2] ?? 1);
    }
    const geometry = this.rectangleIndices(tile, clip);
    gl.bindVertexArray(patch.vao!);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seams);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, draw.correction);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 12, 0);
    gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
  }

  /** Sky, terrain patches and buildings of one frame; returns whether buildings are still preparing. */
  renderFrame(frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
    const gl = this.gl,
      context = this.context,
      programs = this.programs,
      { surface, rig, forest, cavern, trees, fungi, billboards, buildings } = this.parts,
      layer = surface.layer!,
      u = (name: string): WebGLUniformLocation | null => programs.uniform(name);
    const target = context.frameInteracting || context.frameQuality > 0 ? undefined : this.msaaTarget(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    billboards.prepare();
    trees.prepare(frame);
    fungi.prepare();
    const raisedBlend = billboards.raisedBlend(frame);
    gl.viewport(0, 0, w, h);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    const night = context.look.ambience === 'night';
    gl.useProgram(programs.sky);
    gl.uniform1f(programs.uniform('height', programs.sky), h);
    gl.uniform1i(programs.uniform('uNight', programs.sky), context.ground?.underdark ? 2 : +night);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    programs.terrain = context.useMapShader ? programs.map! : programs.ground(context.ground, forest.textures, !!forest.occupation);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(programs.terrain);
    gl.uniform1i(u('uQuality'), context.frameQuality);
    gl.uniformMatrix4fv(u('matrix'), false, frame.matrix);
    gl.uniform1f(u('exaggeration'), rig.camera.exaggeration);
    gl.uniform1f(u('raisedBlend'), raisedBlend);
    gl.uniform3fv(u('eye'), frame.eye);
    gl.uniform1f(u('fogDistance'), rig.fogDistance());
    const settings = context.ground;
    gl.uniform2fv(u('uWaterSeason'), waterSeasonUniforms(settings?.v2Season, settings?.climateZone, settings?.v2Calendar));
    const canopy = settings ?? forest.settings;
    gl.uniform1i(u('groundEnabled'), settings ? 1 : 0);
    gl.uniform1i(u('proceduralPreview'), settings ? 1 : 0);
    gl.uniform1i(u('showTileBounds'), context.tileBounds ? 1 : 0);
    gl.uniform1i(u('uNight'), +night);
    gl.uniform1i(u('uNaturalWater'), +(context.look.waterLook === 'natural'));
    gl.uniform1i(u('displayWaterVisible'), context.look.waterVisible === false ? 0 : 1);
    gl.uniform1f(u('displayWaterBand'), layer.width * 0.016);
    if (canopy) {
      const lights = terrainLights(canopy.lighting);
      gl.uniform1ui(u('uMaterialSeed'), canopy.seed >>> 0);
      gl.uniform2f(u('uMaterialClimate'), canopy.climate.temperature, canopy.climate.precipitation);
      gl.uniform3f(u('groundEye'), rig.camera.x + frame.eye[0], (frame.targetHeight + frame.eye[1]) / rig.camera.exaggeration, rig.camera.y + frame.eye[2]);
      gl.uniform3f(u('groundLight'), lights.primary[0], lights.primary[2], lights.primary[1]);
      gl.uniform4f(u('uGroundCover'), lights.primary[0], lights.primary[2], lights.primary[1], groundCoverActive(settings?.renderV2 ?? 0, !!settings?.forestBrushes, !!settings && !!forest.textures, context.look.groundCover));
      gl.uniform3f(u('groundLight2'), lights.secondary[0], lights.secondary[2], lights.secondary[1]);
      gl.uniform1f(u('groundStrength'), canopy.lighting.enabled ? canopy.lighting.strength : 0);
      gl.uniform3f(u('macroRect'), layer.x, layer.y, layer.width);
      gl.uniform1i(u('macroN'), layer.n);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, surface.macroTexture);
      gl.uniform1i(u('macroField'), 2);
    }
    if (settings) {
      gl.uniform1i(u('uRenderV2'), settings.renderV2 ?? 0);
      gl.uniform1i(u('uV2WaterVisible'), settings.waterVisible === false ? 0 : 1);
      gl.uniform4fv(u('uV2GlacierSources[0]'), renderV2GlacierSources(layer, settings.climate));
      gl.uniform1f(u('uV2Season'), settings.v2Season ?? 0.5);
      setSeasonCalendarGl(gl, name => u(name), settings.climateZone, settings.v2Calendar);
      gl.uniform1i(u('uMaterialZone'), renderV2ZoneUniform(settings.climateZone));
      // Shore ring and relief light (RGBA16F: shore distance, openness, sky occlusion, horizon tangent toward the
      // light); a new light azimuth re-bakes the last channel off the frame path and bumps the revision.
      const ringPixels = (settings.renderV2 ?? 0) > 0 ? shoreRingPixels(layer, settings.lighting.azimuth, this.ringChanged) : undefined;
      if (ringPixels && (this.shoreRing?.layer !== layer || this.shoreRing.revision !== ringPixels.revision)) {
        if (this.shoreRing) gl.deleteTexture(this.shoreRing.texture);
        this.shoreRing = { layer, revision: ringPixels.revision, texture: shoreRingTexture(gl, ringPixels) };
      }
      const ring = ringPixels?.grid;
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, this.shoreRing?.texture ?? this.empty);
      gl.uniform1i(u('uShoreRing'), 10);
      gl.uniform3f(u('uShoreRingRect'), ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
      gl.uniform1i(u('uUnderdark'), settings.underdark ? 1 : 0);
      gl.uniform4fv(u('uCavern'), cavern.parameters());
      gl.uniform4fv(u('uFungusArea'), fungi.area());
      {
        const lamps = cavern.townGlowUniform();
        gl.uniform4fv(u('uCaveLamps[0]'), lamps.values);
        gl.uniform1i(u('uCaveLampCount'), lamps.count);
      }
      {
        const g = settings.townGlow ?? new Float32Array(0),
          a = new Float32Array(64);
        for (let k = 0; k < Math.min(16, (g.length / 3) | 0); k++) a.set(g.subarray(k * 3, k * 3 + 3), k * 4);
        gl.uniform4fv(u('uTownGlow[0]'), a);
        gl.uniform1i(u('uTownGlowCount'), Math.min(16, (g.length / 3) | 0));
      }
      {
        const f = settings.farmBeds ?? new Float32Array(128);
        gl.uniform4fv(u('uFarmBeds[0]'), f);
        let n = 0;
        for (let k = 0; k < 32; k++) if (f[k * 4 + 2] > 0) n = k + 1;
        gl.uniform1i(u('uFarmBedCount'), n);
      }
      const contours = settings.contours;
      gl.uniform1i(u('groundContours'), contours ? 1 : 0);
      gl.uniform1f(u('groundContourStep'), contours?.step ?? 1);
      gl.uniform1f(u('groundContourOpacity'), contours?.opacity ?? 0);
      gl.uniform1f(u('groundFlatSlope'), contours?.flat ? 0.004 : 0.012);
      if (contours) {
        const value = contours.color.replace('#', '');
        gl.uniform3f(u('groundContourColor'), parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
      }
    }
    // Textures 3 forest field, 4 occupation, 8 bank envelope.
    bindForest(gl, name => u(name), forest.textures, forest.occupation, this.empty, true, 3, 4, 8, 9);
    // Underdark: the cave mask in the forest beach slot (unit 9), forest off.
    gl.uniform1i(u('uHasCave'), settings?.underdark && cavern.texture ? 1 : 0);
    if (settings?.underdark) {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, cavern.texture ?? this.empty);
      gl.uniform1i(u('uHasForestBeach'), 0);
      gl.uniform3f(u('uForestBeachRect'), layer.x, layer.y, layer.width);
    }
    bindLandDetail(gl, name => u(name), forest.landDetail, this.empty);
    gl.uniform1i(u('uPaperMap'), settings?.paperMap ? 1 : 0);
    gl.uniform4fv(u('uForestTrees'), trees.forestTreesUniform(frame));
    bindForestBrushes(gl, name => u(name), !!settings?.forestBrushes, 5);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u('material'), 0);
    gl.uniform1i(u('previousMaterial'), 1);
    for (const draw of draws) this.renderPatch(draw, frame);
    gl.bindVertexArray(null);
    const pending = buildings.pass.draw(buildingFrame(this.parts, context.ground, frame));
    this.instances.drawTrees(frame);
    this.instances.drawRoof(frame);
    this.instances.drawFungi(frame);
    this.instances.drawBillboards(frame, raisedBlend);
    if (target) {
      // The first resolve of a target is checked once: a multisampled blit needs identical read/draw formats, and some
      // back ends give the alpha:false drawing buffer another format. Then the canvas stayed black; fall back to direct drawing.
      if (!target.checked)
        while (gl.getError() !== gl.NO_ERROR) {
          /* drain earlier errors */
        }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!target.checked) {
        target.checked = true;
        if (gl.getError() === gl.INVALID_OPERATION) {
          this.msaaUnsupported = true;
          this.releaseMsaa();
          context.request();
        }
      }
    }
    return pending;
  }

  /** Releases the context's objects (patches and buildings are already released). */
  dispose(): void {
    const gl = this.gl,
      { tiles, surface, cavern, forest } = this.parts;
    this.releaseMsaa();
    this.instances.dispose();
    for (const texture of tiles.raised.values()) this.deleteTexture(texture);
    tiles.raised.clear();
    gl.deleteBuffer(this.indices);
    gl.deleteBuffer(this.seams);
    gl.deleteTexture(tiles.material);
    gl.deleteTexture(surface.macroTexture);
    if (cavern.texture) gl.deleteTexture(cavern.texture);
    gl.deleteTexture(this.empty);
    if (this.shoreRing) gl.deleteTexture(this.shoreRing.texture);
    this.programs.dispose();
    for (const geometry of this.clippedIndices.values()) gl.deleteBuffer(geometry.buffer);
    this.clippedIndices.clear();
    deleteForestTextures(gl, forest.textures);
    if (forest.occupation) gl.deleteTexture(forest.occupation.texture);
    if (forest.landDetail) gl.deleteTexture(forest.landDetail.texture);
    disposeForestBrushes(gl);
  }
}

/** What the building pass needs of the frame: camera, focal, and the cave light and fog in the Underdark. */
export function buildingFrame(parts: Pick<TerrainParts, 'rig' | 'cavern'>, ground: Terrain3dGroundSettings | undefined, frame: FrameGeometry): BuildingFrame {
  const c = parts.rig.camera,
    cave = parts.cavern.field && ground?.underdark && !ground.paperMap ? parts.cavern.parameters() : undefined;
  return {
    matrix: frame.matrix,
    cameraX: c.x,
    cameraY: c.y,
    targetHeight: frame.targetHeight,
    exaggeration: c.exaggeration,
    focal: frame.focal,
    dpr: parts.rig.dpr(),
    distance: c.distance,
    // Underdark: lit by the town's lanterns, dissolving into the cave's darkness with the ground (fog in metres).
    ...(cave ? { cave: { light: 1.05 - 0.45 * cave[1], fog: [cave[2] / c.exaggeration, cave[3] / c.exaggeration] as [number, number], eye: [c.x + frame.eye[0], c.y + frame.eye[2], Math.max(0, frame.eye[1] / c.exaggeration)] as [number, number, number] } } : {}),
  };
}
