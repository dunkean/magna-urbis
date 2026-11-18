/**
 * WebGL sky, terrain patches and scene recording, called by Terrain3d.renderFrame.
 * Reads/writes: Reads frame geometry, materials and scene state; writes GL bindings/uniforms, shore-ring resources and MSAA resolve status on the supplied context.
 */
import { waterSeasonUniforms } from '../../render/seasonPalette';
import { bindForest, bindLandDetail } from '../terrainGl';
import { shoreRingPixels, shoreRingTexture } from '../../../../rust/bridge/terrainForestBeach';
import { bindForestBrushes } from '../../render/forestBrushAtlas';
import { renderV2GlacierSources } from '../../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform, setSeasonCalendarGl } from '../../../../rust/bridge/terrainRenderV2Zones';
import { terrainLights } from '../../render/terrainLighting';
import type { BuildingFrame } from '../urbanBuilding3d';
import { groundCoverActive } from '../../render/materialLook';
import { PatchDraw, FrameGeometry } from './terrainTypes';
import type { Terrain3dContext } from './terrainContext';

export function renderPatch(context: Terrain3dContext, draw: PatchDraw, frame: FrameGeometry): void {
  const { patch, material, clip } = draw,
    gl = context.gl,
    c = context.camera,
    tile = patch.tile;
  gl.uniform3f(context.uniform('patchOffset'), patch.tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, patch.tile.y - c.y);
  gl.uniform3f(context.uniform('physicalOrigin'), patch.tile.x, patch.heightOrigin, patch.tile.y);
  gl.uniform3f(context.uniform('patchRect'), patch.tile.x, patch.tile.y, patch.tile.width);
  gl.uniform1f(context.uniform('morph'), draw.morph);
  gl.uniform4fv(context.uniform('textureRect'), draw.textureRect);
  gl.uniform4fv(context.uniform('previousRect'), draw.previousRect);
  gl.uniform1f(context.uniform('textureBlend'), material.blend);
  for (const [ref, name, flag, unit] of [
    [material.to, 'drapedMaterial', 'hasRaisedMaterial', 14],
    [material.from, 'previousDrapedMaterial', 'hasPreviousRaisedMaterial', 15],
  ] as const) {
    const raised = context.raisedMaterials.get(ref.texture);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, raised ?? context.empty);
    gl.uniform1i(context.uniform(name), unit);
    gl.uniform1i(context.uniform(flag), raised ? 1 : 0);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, material.to.texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, material.from.texture);
  for (const [ref, name, flag, unit] of [
    [material.to, 'semanticTile', 'hasSemanticTile', 12],
    [material.from, 'previousSemanticTile', 'hasPreviousSemanticTile', 13],
  ] as const) {
    const overlay = context.semanticTiles.get(ref.texture);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, overlay?.texture ?? context.empty);
    gl.uniform1i(context.uniform(name), unit);
    gl.uniform1i(context.uniform(flag), overlay?.semantic ? 1 : 0);
    gl.uniform4fv(context.uniform(name === 'semanticTile' ? 'semanticRect' : 'previousSemanticRect'), context.overlayRect(ref, tile));
    gl.uniform1i(context.uniform(name === 'semanticTile' ? 'hasGroundTile' : 'hasPreviousGroundTile'), overlay?.atlas ? 1 : 0);
    gl.uniform4fv(context.uniform(name === 'semanticTile' ? 'groundRect' : 'previousGroundRect'), context.overlayRect(ref, tile, true));
  }
  for (const [ref, prefix, unit] of [
    [material.to, '', 6],
    [material.from, 'previous', 7],
  ] as const) {
    const mask = context.waterMasks.get(ref.texture),
      name = prefix ? 'previousCanopyWater' : 'canopyWater';
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, mask?.texture ?? context.empty);
    gl.uniform1i(context.uniform(name), unit);
    gl.uniform1i(context.uniform(prefix ? 'hasPreviousCanopyWater' : 'hasCanopyWater'), mask ? 1 : 0);
    gl.uniform3f(context.uniform(`${name}Rect`), mask?.rect[0] ?? 0, mask?.rect[1] ?? 0, mask?.rect[2] ?? 1);
  }
  const geometry = context.rectangleIndices(tile, clip);
  gl.bindVertexArray(patch.vao!);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER, context.seams);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, draw.correction);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 12, 0);
  gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
}

/** Sky, terrain patches and buildings of one frame; returns whether buildings are still preparing. */
export function renderFrame(context: Terrain3dContext, frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
  const gl = context.gl,
    layer = context.layer!;
  const target = context.frameInteracting || context.frameQuality > 0 ? undefined : context.msaaTarget(w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  context.prepareBillboards();
  context.prepareTrees(frame);
  context.prepareFungi();
  const raisedBlend = context.raisedBlend(frame);
  gl.viewport(0, 0, w, h);
  gl.clearDepth(1);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(null);
  const night = context.lookSettings.ambience === 'night';
  gl.useProgram(context.skyProgram);
  gl.uniform1f(context.uniform('height', context.skyProgram), h);
  gl.uniform1i(context.uniform('uNight', context.skyProgram), context.groundSettings?.underdark ? 2 : +night);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  context.terrainProgram = context.useMapShader ? context.mapProgram! : context.groundShader(context.groundSettings);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.useProgram(context.terrainProgram);
  gl.uniform1i(context.uniform('uQuality'), context.frameQuality);
  gl.uniformMatrix4fv(context.uniform('matrix'), false, frame.matrix);
  gl.uniform1f(context.uniform('exaggeration'), context.camera.exaggeration);
  gl.uniform1f(context.uniform('raisedBlend'), raisedBlend);
  gl.uniform3fv(context.uniform('eye'), frame.eye);
  gl.uniform1f(context.uniform('fogDistance'), context.fogDistance());
  const settings = context.groundSettings;
  gl.uniform2fv(context.uniform('uWaterSeason'), waterSeasonUniforms(settings?.v2Season, settings?.climateZone, settings?.v2Calendar));
  const canopy = settings ?? context.forestSettings;
  gl.uniform1i(context.uniform('groundEnabled'), settings ? 1 : 0);
  gl.uniform1i(context.uniform('proceduralPreview'), settings ? 1 : 0);
  gl.uniform1i(context.uniform('showTileBounds'), context.tileBounds ? 1 : 0);
  gl.uniform1i(context.uniform('uNight'), +night);
  gl.uniform1i(context.uniform('uNaturalWater'), +(context.lookSettings.waterLook === 'natural'));
  gl.uniform1i(context.uniform('displayWaterVisible'), context.lookSettings.waterVisible === false ? 0 : 1);
  gl.uniform1f(context.uniform('displayWaterBand'), layer.width * 0.016);
  if (canopy) {
    const lights = terrainLights(canopy.lighting);
    gl.uniform1ui(context.uniform('uMaterialSeed'), canopy.seed >>> 0);
    gl.uniform2f(context.uniform('uMaterialClimate'), canopy.climate.temperature, canopy.climate.precipitation);
    gl.uniform3f(context.uniform('groundEye'), context.camera.x + frame.eye[0], (frame.targetHeight + frame.eye[1]) / context.camera.exaggeration, context.camera.y + frame.eye[2]);
    gl.uniform3f(context.uniform('groundLight'), lights.primary[0], lights.primary[2], lights.primary[1]);
    gl.uniform4f(context.uniform('uGroundCover'), lights.primary[0], lights.primary[2], lights.primary[1], groundCoverActive(settings?.renderV2 ?? 0, !!settings?.forestBrushes, !!settings && !!context.forest, context.lookSettings.groundCover));
    gl.uniform3f(context.uniform('groundLight2'), lights.secondary[0], lights.secondary[2], lights.secondary[1]);
    gl.uniform1f(context.uniform('groundStrength'), canopy.lighting.enabled ? canopy.lighting.strength : 0);
    gl.uniform3f(context.uniform('macroRect'), layer.x, layer.y, layer.width);
    gl.uniform1i(context.uniform('macroN'), layer.n);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, context.macroTexture);
    gl.uniform1i(context.uniform('macroField'), 2);
  }
  if (settings) {
    gl.uniform1i(context.uniform('uRenderV2'), settings.renderV2 ?? 0);
    gl.uniform1i(context.uniform('uV2WaterVisible'), settings.waterVisible === false ? 0 : 1);
    gl.uniform4fv(context.uniform('uV2GlacierSources[0]'), renderV2GlacierSources(layer, settings.climate));
    gl.uniform1f(context.uniform('uV2Season'), settings.v2Season ?? 0.5);
    setSeasonCalendarGl(gl, name => context.uniform(name), settings.climateZone, settings.v2Calendar);
    gl.uniform1i(context.uniform('uMaterialZone'), renderV2ZoneUniform(settings.climateZone));
    // Shore ring and relief light (RGBA16F: shore distance, openness, sky occlusion, horizon tangent toward the
    // light); a new light azimuth re-bakes the last channel off the frame path and bumps the revision.
    const ringPixels = (settings.renderV2 ?? 0) > 0 ? shoreRingPixels(layer, settings.lighting.azimuth, context.ringChanged) : undefined;
    if (ringPixels && (context.shoreRing?.layer !== layer || context.shoreRing.revision !== ringPixels.revision)) {
      if (context.shoreRing) gl.deleteTexture(context.shoreRing.texture);
      context.shoreRing = { layer, revision: ringPixels.revision, texture: shoreRingTexture(gl, ringPixels) };
    }
    const ring = ringPixels?.grid;
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, context.shoreRing?.texture ?? context.empty);
    gl.uniform1i(context.uniform('uShoreRing'), 10);
    gl.uniform3f(context.uniform('uShoreRingRect'), ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
    gl.uniform1i(context.uniform('uUnderdark'), settings.underdark ? 1 : 0);
    gl.uniform4fv(context.uniform('uCavern'), context.cavernParameters());
    gl.uniform4fv(context.uniform('uFungusArea'), context.fungusArea());
    {
      const lamps = context.townGlowUniform();
      gl.uniform4fv(context.uniform('uCaveLamps[0]'), lamps.values);
      gl.uniform1i(context.uniform('uCaveLampCount'), lamps.count);
    }
    {
      const g = settings.townGlow ?? new Float32Array(0),
        a = new Float32Array(64);
      for (let k = 0; k < Math.min(16, (g.length / 3) | 0); k++) a.set(g.subarray(k * 3, k * 3 + 3), k * 4);
      gl.uniform4fv(context.uniform('uTownGlow[0]'), a);
      gl.uniform1i(context.uniform('uTownGlowCount'), Math.min(16, (g.length / 3) | 0));
    }
    {
      const f = settings.farmBeds ?? new Float32Array(128);
      gl.uniform4fv(context.uniform('uFarmBeds[0]'), f);
      let n = 0;
      for (let k = 0; k < 32; k++) if (f[k * 4 + 2] > 0) n = k + 1;
      gl.uniform1i(context.uniform('uFarmBedCount'), n);
    }
    const contours = settings.contours;
    gl.uniform1i(context.uniform('groundContours'), contours ? 1 : 0);
    gl.uniform1f(context.uniform('groundContourStep'), contours?.step ?? 1);
    gl.uniform1f(context.uniform('groundContourOpacity'), contours?.opacity ?? 0);
    gl.uniform1f(context.uniform('groundFlatSlope'), contours?.flat ? 0.004 : 0.012);
    if (contours) {
      const value = contours.color.replace('#', '');
      gl.uniform3f(context.uniform('groundContourColor'), parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
    }
  }
  // Textures 3 forest field, 4 occupation, 8 bank envelope.
  bindForest(gl, name => context.uniform(name), context.forest, context.occupation, context.empty, true, 3, 4, 8, 9);
  // Underdark: the cave mask in the forest beach slot (unit 9), forest off.
  gl.uniform1i(context.uniform('uHasCave'), settings?.underdark && context.caveTexture ? 1 : 0);
  if (settings?.underdark) {
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, context.caveTexture ?? context.empty);
    gl.uniform1i(context.uniform('uHasForestBeach'), 0);
    gl.uniform3f(context.uniform('uForestBeachRect'), layer.x, layer.y, layer.width);
  }
  bindLandDetail(gl, name => context.uniform(name), context.landDetail, context.empty);
  gl.uniform1i(context.uniform('uPaperMap'), settings?.paperMap ? 1 : 0);
  gl.uniform4fv(context.uniform('uForestTrees'), context.forestTreesUniform(frame));
  bindForestBrushes(gl, name => context.uniform(name), !!settings?.forestBrushes, 5);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(context.uniform('material'), 0);
  gl.uniform1i(context.uniform('previousMaterial'), 1);
  for (const draw of draws) context.renderPatch(draw, frame);
  gl.bindVertexArray(null);
  const pending = context.buildings.draw(context.buildingFrame(frame));
  context.drawTrees(frame);
  context.drawRoof(frame);
  context.drawFungi(frame);
  context.drawBillboards(frame, raisedBlend);
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
        context.msaaUnsupported = true;
        context.releaseMsaa();
        context.request();
      }
    }
  }
  return pending;
}

export function buildingFrame(context: Terrain3dContext, frame: FrameGeometry): BuildingFrame {
  const c = context.camera,
    cave = context.cavern && context.groundSettings?.underdark && !context.groundSettings.paperMap ? context.cavernParameters() : undefined;
  return {
    matrix: frame.matrix,
    cameraX: c.x,
    cameraY: c.y,
    targetHeight: frame.targetHeight,
    exaggeration: c.exaggeration,
    focal: frame.focal,
    distance: c.distance,
    // Underdark: lit by the town's lanterns, dissolving into the cave's darkness with the ground (fog in metres).
    ...(cave ? { cave: { light: 1.05 - 0.45 * cave[1], fog: [cave[2] / c.exaggeration, cave[3] / c.exaggeration] as [number, number], eye: [c.x + frame.eye[0], c.y + frame.eye[2], Math.max(0, frame.eye[1] / c.exaggeration)] as [number, number, number] } } : {}),
  };
}
