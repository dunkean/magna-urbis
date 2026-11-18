/**
 * WebGPU sky, ground patches and scene command recording, called by Terrain3dGpu.renderFrame.
 * Reads/writes: Reads the supplied view context and frame draws; writes parameter pools, shore-ring resources, pass bindings and queued buffer disposal in the existing recording order.
 */
import { waterSeasonUniforms } from '../../render/seasonPalette';
import { shoreRingPixels } from '../../../../rust/bridge/terrainForestBeach';
import { renderV2GlacierSources } from '../../../../rust/bridge/terrainRenderV2';
import { renderV2ZoneUniform, setSeasonCalendarGpu } from '../../../../rust/bridge/terrainRenderV2Zones';
import { terrainLights } from '../../render/terrainLighting';
import { groundCoverActive } from '../../render/materialLook';
import { type FrameGeometry, type PatchDraw } from '../terrain3d';
import { TerrainTexture, TERRAIN_TEXTURES, T } from './gpuLayouts';
import { image } from './gpuImages';
import { UrbanBuildingPassGpu } from './gpuBuildings';
import type { TerrainGpuContext } from './terrainGpuContext';

export function renderFrame(context: TerrainGpuContext, frame: FrameGeometry, w: number, h: number, draws: PatchDraw[]): boolean {
  const device = context.device,
    gpu = context.gpu,
    layer = context.layer!,
    c = context.camera,
    settings = context.groundSettings;
  context.prepareBillboards();
  context.prepareTrees(frame);
  context.prepareFungi();
  const raisedBlend = context.raisedBlend(frame);
  const targets = context.ensureTargets(w, h);
  context.params.begin();
  context.seamPool.begin();
  const encoder = device.createCommandEncoder({ label: 'terrain 3d' });
  const pass = encoder.beginRenderPass({
    label: 'terrain 3d',
    colorAttachments: [
      {
        view: targets.samples > 1 ? targets.colorView : context.context.getCurrentTexture().createView(),
        resolveTarget: targets.samples > 1 ? context.context.getCurrentTexture().createView() : undefined,
        clearValue: [0, 0, 0, 1],
        loadOp: 'clear',
        storeOp: targets.samples > 1 ? 'discard' : 'store',
      },
    ],
    depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
  });
  const sky = context.pipeline('sky');
  if (sky) {
    context.skyParams.set('height', h);
    context.skyParams.set('uNight', context.groundSettings?.underdark ? 2 : context.lookSettings.ambience === 'night' ? 1 : 0);
    const slot = context.params.alloc(context.skyParams.bytes);
    pass.setPipeline(sky);
    pass.setBindGroup(0, device.createBindGroup({ layout: gpu.layouts.sky, entries: [{ binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: context.skyParams.bytes.byteLength } }] }));
    pass.draw(3);
  }
  const pipeline = context.terrainPipeline(),
    p = context.terrainParams,
    empty = context.blank.view;
  p.set('proceduralPreview', settings ? 1 : 0);
  const textures: Partial<Record<TerrainTexture, GPUTextureView>> = { macroField: image(context.macroTexture).view };
  p.set('uQuality', context.frameQuality);
  p.setArray('matrix', frame.matrix);
  p.set('exaggeration', c.exaggeration);
  p.setArray('eye', frame.eye);
  p.set('raisedBlend', raisedBlend);
  p.set('fogDistance', context.fogDistance());
  p.set('showTileBounds', context.tileBounds ? 1 : 0);
  p.set('uNight', context.lookSettings.ambience === 'night' ? 1 : 0);
  p.set('uNaturalWater', context.lookSettings.waterLook === 'natural' ? 1 : 0);
  p.set('displayWaterVisible', context.lookSettings.waterVisible === false ? 0 : 1);
  p.set('displayWaterBand', layer.width * 0.016);
  p.setArray('uWaterSeason', waterSeasonUniforms(settings?.v2Season, settings?.climateZone, settings?.v2Calendar));
  const canopy = settings ?? context.forestSettings;
  if (canopy) {
    const lights = terrainLights(canopy.lighting);
    p.set('uMaterialSeed', canopy.seed >>> 0);
    p.set('uMaterialClimate', canopy.climate.temperature, canopy.climate.precipitation);
    p.setArray('uForestTrees', context.forestTreesUniform(frame));
    p.set('groundEye', c.x + frame.eye[0], (frame.targetHeight + frame.eye[1]) / c.exaggeration, c.y + frame.eye[2]);
    p.set('groundLight', lights.primary[0], lights.primary[2], lights.primary[1]);
    p.set('uGroundCover', lights.primary[0], lights.primary[2], lights.primary[1], groundCoverActive(settings?.renderV2 ?? 0, !!settings?.forestBrushes, !!settings && !!context.forest, context.lookSettings.groundCover));
    p.set('groundLight2', lights.secondary[0], lights.secondary[2], lights.secondary[1]);
    p.set('groundStrength', canopy.lighting.enabled ? canopy.lighting.strength : 0);
    p.set('macroRect', layer.x, layer.y, layer.width);
    p.set('macroN', layer.n);
  }
  if (settings) {
    const v2 = settings.renderV2 ?? 0;
    p.set('uV2WaterVisible', settings.waterVisible === false ? 0 : 1);
    p.setArray('uV2GlacierSources', renderV2GlacierSources(layer, settings.climate));
    p.set('uV2Season', settings.v2Season ?? 0.5);
    setSeasonCalendarGpu(p, settings.climateZone, settings.v2Calendar);
    p.set('uMaterialZone', renderV2ZoneUniform(settings.climateZone));
    // Shore ring and relief light (rgba16float: shore distance, openness, sky occlusion, horizon tangent toward
    // the light); a new light azimuth re-bakes the last channel off the frame path and bumps the revision.
    const pixels = v2 > 0 ? shoreRingPixels(layer, settings.lighting.azimuth, context.ringChanged) : undefined;
    if (pixels && (context.ring?.layer !== layer || context.ring.revision !== pixels.revision)) {
      if (context.ring) context.deleteTexture(context.ring.image);
      const grid = pixels.grid;
      context.ring = { layer, revision: pixels.revision, image: context.image(grid.n, grid.n, 'rgba16float', pixels.half, 8), x: grid.x, y: grid.y, width: grid.width };
    }
    const ring = pixels?.grid;
    p.set('uShoreRingRect', ring?.x ?? 0, ring?.y ?? 0, ring?.width ?? 1);
    const contours = settings.contours;
    p.set('groundContours', contours ? 1 : 0);
    p.set('groundContourStep', contours?.step ?? 1);
    p.set('groundContourOpacity', contours?.opacity ?? 0);
    p.set('groundFlatSlope', contours?.flat ? 0.004 : 0.012);
    if (contours) {
      const value = contours.color.replace('#', '');
      p.set('groundContourColor', parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
    }
  }
  textures.uShoreRing = context.ring?.image.view ?? empty;
  const field = context.forest,
    applied = context.occupation,
    beach = field?.field.beach;
  textures.uForestField = field ? image(field.texture).view : empty;
  p.set('uForestRect', field?.field.x ?? 0, field?.field.y ?? 0, field?.field.width ?? 1);
  textures.uForestBank = field?.bank ? image(field.bank).view : empty;
  p.set('uHasForestBank', field?.bank ? 1 : 0);
  p.set('uForestBankDensity', field?.field.bankDensity ?? 1);
  textures.uForestBeach = field?.beach ? image(field.beach).view : empty;
  p.set('uHasForestBeach', field?.beach ? 1 : 0);
  p.set('uForestBeachRect', beach?.x ?? 0, beach?.y ?? 0, beach?.width ?? 1);
  textures.uOccupation = applied ? image(applied.texture).view : empty;
  p.set('uHasOccupation', applied ? 1 : 0);
  p.set('uOccupationRect', applied?.data.x ?? 0, applied?.data.y ?? 0, applied?.data.width ?? 1);
  p.set('uOccupationN', applied?.data.n ?? 1);
  p.set('uPaperMap', settings?.paperMap ? 1 : 0);
  // Underdark: the cave mask in the forest beach slot (terrain3d.ts), forest off.
  p.set('uHasCave', settings?.underdark && context.caveTexture ? 1 : 0);
  p.setArray('uCavern', context.cavernParameters());
  p.setArray('uFungusArea', context.fungusArea());
  {
    const lamps = context.townGlowUniform();
    p.setArray('uCaveLamps', lamps.values);
    p.set('uCaveLampCount', lamps.count);
  }
  {
    const g = settings?.townGlow ?? new Float32Array(0),
      a = new Float32Array(64);
    for (let k = 0; k < Math.min(16, (g.length / 3) | 0); k++) a.set(g.subarray(k * 3, k * 3 + 3), k * 4);
    p.setArray('uTownGlow', a);
    p.set('uTownGlowCount', Math.min(16, (g.length / 3) | 0));
  }
  {
    const f = settings?.farmBeds ?? new Float32Array(128);
    p.setArray('uFarmBeds', f);
    let n = 0;
    for (let k = 0; k < 32; k++) if (f[k * 4 + 2] > 0) n = k + 1;
    p.set('uFarmBedCount', n);
  }
  if (settings?.underdark) {
    textures.uForestBeach = context.caveTexture ? image(context.caveTexture).view : empty;
    p.set('uHasForestBeach', 0);
    p.set('uForestBeachRect', layer.x, layer.y, layer.width);
  }
  const detail = context.landDetail;
  textures.uLandDetail = detail ? image(detail.texture).view : empty;
  p.set('uHasLandDetail', detail ? 1 : 0);
  p.set('uLandDetailRect', detail?.data.x ?? 0, detail?.data.y ?? 0, detail?.data.width ?? 1);
  p.set('uLandDetailN', detail?.data.n ?? 1);
  textures.uForestBrushAtlas = context.brushAtlas(!!settings?.forestBrushes);
  if (pipeline) {
    pass.setPipeline(pipeline);
    for (const draw of draws) {
      const { patch, material } = draw,
        tile = patch.tile;
      p.set('patchOffset', tile.x - c.x, patch.heightOrigin * c.exaggeration - frame.targetHeight, tile.y - c.y);
      p.set('physicalOrigin', tile.x, patch.heightOrigin, tile.y);
      p.set('patchRect', tile.x, tile.y, tile.width);
      p.set('morph', draw.morph);
      p.setArray('textureRect', draw.textureRect);
      p.setArray('previousRect', draw.previousRect);
      p.set('textureBlend', material.blend);
      textures.material = image(material.to.texture).view;
      textures.previousMaterial = image(material.from.texture).view;
      for (const [ref, name, flag] of [
        [material.to, 'drapedMaterial', 'hasRaisedMaterial'],
        [material.from, 'previousDrapedMaterial', 'hasPreviousRaisedMaterial'],
      ] as const) {
        const raised = context.raisedMaterials.get(ref.texture);
        textures[name] = raised ? image(raised).view : empty;
        p.set(flag, raised ? 1 : 0);
      }
      for (const [ref, name] of [
        [material.to, 'canopyWater'],
        [material.from, 'previousCanopyWater'],
      ] as const) {
        const mask = context.waterMasks.get(ref.texture);
        textures[name] = mask ? image(mask.texture).view : empty;
        p.set(name === 'canopyWater' ? 'hasCanopyWater' : 'hasPreviousCanopyWater', mask ? 1 : 0);
        p.set(`${name}Rect`, mask?.rect[0] ?? 0, mask?.rect[1] ?? 0, mask?.rect[2] ?? 1);
      }
      for (const [ref, name, flag] of [
        [material.to, 'semanticTile', 'hasSemanticTile'],
        [material.from, 'previousSemanticTile', 'hasPreviousSemanticTile'],
      ] as const) {
        const overlay = context.semanticTiles.get(ref.texture);
        textures[name] = overlay ? image(overlay.texture).view : empty;
        p.set(flag, overlay?.semantic ? 1 : 0);
        p.setArray(name === 'semanticTile' ? 'semanticRect' : 'previousSemanticRect', context.overlayRect(ref, tile));
        p.set(name === 'semanticTile' ? 'hasGroundTile' : 'hasPreviousGroundTile', overlay?.atlas ? 1 : 0);
        p.setArray(name === 'semanticTile' ? 'groundRect' : 'previousGroundRect', context.overlayRect(ref, tile, true));
      }
      const slot = context.params.alloc(p.bytes),
        seams = context.seamPool.alloc(draw.correction),
        indices = context.patchIndices(tile, draw.clip);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: gpu.layouts.terrain,
          entries: [
            { binding: 0, resource: { buffer: slot.buffer, offset: slot.offset, size: p.bytes.byteLength } },
            { binding: 1, resource: gpu.samplers.nearest },
            { binding: 2, resource: gpu.samplers.linear },
            { binding: 3, resource: gpu.samplers.aniso },
            ...TERRAIN_TEXTURES.map(name => ({ binding: T[name], resource: name === 'macroField' ? (textures.macroField ?? context.emptyUnfilterable.view) : (textures[name] ?? empty) })),
          ],
        }),
      );
      pass.setVertexBuffer(0, patch.vao as GPUBuffer);
      pass.setVertexBuffer(1, seams.buffer, seams.offset, draw.correction.byteLength);
      pass.setIndexBuffer(indices.buffer, 'uint16');
      pass.drawIndexed(indices.count);
    }
  }
  const buildings = context.buildings as UrbanBuildingPassGpu;
  buildings.target = { pass, params: context.params, samples: context.samples };
  let pending: boolean;
  try {
    pending = buildings.draw(context.buildingFrame(frame));
  } finally {
    buildings.target = undefined;
  }
  context.recordTrees(pass, frame);
  context.recordRoof(pass, frame);
  context.recordFungi(pass, frame);
  pending = context.recordBillboards(pass, frame, raisedBlend) || pending;
  pass.end();
  context.params.flush();
  context.seamPool.flush();
  device.queue.submit([encoder.finish()]);
  for (const buffer of context.garbage.splice(0)) buffer.destroy();
  return pending || !pipeline;
}
