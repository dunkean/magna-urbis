/**
 * One frame of the GPU town: binds the target, marks the drawn water in the stencil, then draws the plan fills and
 * outlines, quays, wall grounds, streets, lot enclosures, walls and towers, canals, buildings with their shadows and
 * roof pans, and the selection — the order of the Canvas town (canvas/town.ts). Called by renderer.ts with its
 * retained state (`GpuTown`) and the style of the frame's state; it creates nothing and keeps nothing. Widths,
 * thresholds and inks are the look's (render/city/look.ts). One function on purpose: the draw order of a frame reads
 * top to bottom.
 */
import type { CityLayers, CityPalette } from '../model/contract';
import type { Point } from '../../../../../rust/bridge/urban';
import type { CityBuildings, CityLod } from '../model/contract';
import { visibleRanges } from '../../cityGlBuild';
import { rgba01, type CityGlDraws } from './styleTables';
import { ENCLOSURE_MID_WIDTH, enclosureFade, enclosureJambRank } from '../planLook';
import { castShadowTint } from '../buildingLook';
import { lineCoverage, paintedGroundShadow, type PlanPath } from '../planPath';
import { GRAIN_SHIFT, PAN_EDGE, PARCHMENT_HATCH, RIM_DEVICE_MPP, SELECTION, WALL_CORE, buildingEdgePx, canalBridgeEdgePx, farTownBuildingsShown, planLineWidthPx, streetEdgePx, streetMaxRank, wallLook, wallMinPx, type StreetMode } from '../look';
import { groundRoadLook } from '../../composition';
import { snowMeans } from '../../cityGlGrain';
import { COVER_GRAIN_PX_M, COVER_GRAIN_TILE, coverGrainFrame } from '../../buildingMaterials';
import { RUIN_INK, RUIN_PAPER } from '../../cityRuins';
import { MATERIALS } from '../../buildingMaterials';
import { type CityGlWalls } from '../../cityWalls';
// walls hook (cityWalls.ts)
import { CityGlDrawOptions, CityGlFrame } from './contract';
import { WATER_BIT } from './shaders';
import { Program } from './programs';
import { FillPack, StrokePack } from './packs';

/** The retained GPU state a frame draws from (renderer.ts owns and replaces it). */
export interface GpuTown {
  gl: WebGL2RenderingContext;
  fillP: Program;
  strokeP: Program;
  casingP: Program;
  surfaceP: Program;
  discP: Program;
  pavedP: Program;
  tfillP: Program;
  texturedP: Program;
  waterP: Program;
  plan: FillPack;
  built: FillPack | undefined;
  streets: StrokePack | undefined;
  walls: StrokePack | undefined;
  selection: StrokePack | undefined;
  yards: { runs: StrokePack; jambs: StrokePack } | undefined;
  towers: { vao: WebGLVertexArrayObject; count: number } | undefined;
  water: { vao: WebGLVertexArrayObject; count: number } | undefined;
  wallGl: CityGlWalls;
  origin: Point;
  buildings: CityBuildings | undefined;
  /** First street stroke that is a crossing. */ streetCrossings: number;
  /** The street strokes are the road surface (square covered ends), not round-capped strokes. */ streetSurface: boolean;
  albedoTex: WebGLTexture | undefined;
  towerColors: [string, string];
}
/** What the state of a frame draws (renderer.ts styleFrame). */
interface TownFrameStyle {
  palette: CityPalette;
  layers: CityLayers;
  footprint: boolean;
  renderBackground: boolean;
  painted: boolean;
  softStreets: boolean;
  textured: boolean;
  d: CityGlDraws;
}
/** Draws the town of `o` at level `lod`; counts its draws in `frame`. */
export function drawTownFrame(town: GpuTown, o: CityGlDrawOptions, lod: CityLod, style: TownFrameStyle, frame: CityGlFrame): void {
  const { gl, fillP, strokeP, casingP, surfaceP, discP, pavedP, tfillP, texturedP, waterP, plan, built, streets, walls, selection, yards, towers, water, wallGl, origin, buildings, streetCrossings, streetSurface, albedoTex, towerColors } = town,
    mpp = o.metresPerPixel;
  // Without the live look the frame is the plan path of the look (render/city/planPath.ts).
  const planPath: PlanPath | undefined = o.live ? undefined : { painted: style.painted };
  const target = o.target,
    W = target ? target.width : gl.drawingBufferWidth,
    H = target ? target.height : gl.drawingBufferHeight;
  if (target) {
    // Shared context: the frame's target and every state this draw relies on; nothing cleared (the owner's target).
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.blendEquation(gl.FUNC_ADD);
    gl.viewport(0, 0, W, H);
  } else {
    gl.viewport(0, 0, W, H);
    const c = o.clear ?? [0, 0, 0, 0];
    gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  const { palette, layers, footprint, renderBackground, painted, softStreets, textured, d } = style;
  const v = o.viewport,
    sx = 2 / (v.maxX - v.minX),
    sy = -2 / (v.maxY - v.minY);
  const view = [sx, sy, -1 - (v.minX - origin.x) * sx, 1 - (v.minY - origin.y) * sy];
  const devPx = (v.maxX - v.minX) / Math.max(1, W);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  // The drawn rivers above the town ground and streets: their capsules mark the stencil (WATER_BIT); blocks,
  // parcels and non-crossing streets are drawn only off it, so the river shows through, bridges and fords over it.
  const wet = !!water && water.count > 0;
  if (wet) {
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.ALWAYS, WATER_BIT, WATER_BIT);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.stencilMask(WATER_BIT);
    gl.colorMask(false, false, false, false);
    gl.useProgram(waterP.program);
    gl.uniform4fv(waterP.u.uView, view);
    gl.uniform2f(waterP.u.uOrigin, origin.x, origin.y);
    gl.bindVertexArray(water!.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, water!.count);
    frame.drawCalls++;
    frame.instances += water!.count;
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
  }
  /** Draws only off the drawn water (no-op without it). */
  const dry = (on: boolean): void => {
    if (!wet) return;
    if (!on) {
      gl.disable(gl.STENCIL_TEST);
      return;
    }
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, WATER_BIT);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  };
  gl.activeTexture(gl.TEXTURE0);
  // Binds a material table (unit 1) and the albedo array (unit 2) to a textured program.
  const extents = new Float32Array(32).fill(2);
  MATERIALS.layers.forEach((l, i) => {
    extents[i] = l.extent_m;
  });
  const means = new Float32Array(32).fill(0.5);
  MATERIALS.layers.forEach((l, i) => {
    means[i] = (l.mean_rgb[0] * 0.3 + l.mean_rgb[1] * 0.59 + l.mean_rgb[2] * 0.11) / 255;
  });
  const useTextured = (prog: Program, mats: WebGLTexture | undefined, only: boolean): void => {
    gl.useProgram(prog.program);
    gl.uniform4fv(prog.u.uView, view);
    gl.uniform1i(prog.u.uColors, 0);
    gl.uniform1i(prog.u.uMats, 1);
    gl.uniform1i(prog.u.uAlbedo, 2);
    gl.uniform1fv(prog.u['uExt[0]'], extents);
    gl.uniform1i(prog.u.uOnly, only ? 1 : 0);
    if (prog === tfillP) gl.uniform1fv(prog.u['uMean[0]'], means);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mats ?? null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, albedoTex ?? null);
    gl.activeTexture(gl.TEXTURE0);
  };

  // Fills and outlines.
  gl.useProgram(fillP.program);
  gl.uniform4fv(fillP.u.uView, view);
  gl.uniform1i(fillP.u.uColors, 0);
  gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
  gl.uniform1f(fillP.u.uRuinSpacing, 0);
  gl.uniform4f(fillP.u.uHatch, 0, 0, 0, 0);
  gl.uniform1f(fillP.u.uLineAlpha, 0);
  gl.uniform1i(fillP.u.uRoofGrain, 0);
  gl.uniform1i(fillP.u.uGrainMarks, 0);
  // Units of their own: samplers of different types may not share a unit, even unsampled.
  gl.uniform1i(fillP.u.uGrainLay, 5);
  gl.uniform1i(fillP.u.uCoverGrain, 6);
  // The live town: a GL line is one device pixel; the look's strokes are thinner (CSS px), drawn with coverage.
  // Building edges under roof pans show their outer half only. Factor = stroke width in device pixels.
  const dpr = mpp / Math.max(devPx, 1e-9),
    hasPans = !footprint && !!built?.mesh.layers.roofs?.triangles.count;
  const parchment = palette === 'parchment';
  const strokePx = (layer: string): number =>
    layer === 'blocks' || layer === 'parcels'
      ? planLineWidthPx(o.live?.lineWidth ?? 0.6)
      : layer === 'roofs'
        ? (parchment ? PAN_EDGE.parchment : PAN_EDGE.plan).widthPx
        : layer === 'buildings'
          ? buildingEdgePx(false, parchment) * (hasPans ? 0.5 : 1)
          : layer === 'buildingFootprints'
            ? buildingEdgePx(true, parchment)
            : layer === 'waterwayBridges'
              ? canalBridgeEdgePx(mpp)
              : 1;
  /** Live parchment hatching over a plan layer (drawCitySteps hatchPattern, world-anchored 7 px lines). */
  const hatch = (layer: string): void => {
    if (!d.hatch || !plan?.hatch) return;
    const [r, g, b] = rgba01(PARCHMENT_HATCH.color);
    gl.uniform4f(fillP.u.uHatch, PARCHMENT_HATCH.periodPx * mpp, PARCHMENT_HATCH.widthPx * mpp, devPx, PARCHMENT_HATCH.alpha);
    gl.uniform3f(fillP.u.uHatchColor, r, g, b);
    gl.bindTexture(gl.TEXTURE_2D, plan.hatch);
    gl.bindVertexArray(plan.tri);
    const l = plan.mesh.layers[layer];
    if (l)
      for (const [first, count] of visibleRanges(l.chunks, v, c => c.triangles)) {
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
        frame.drawCalls++;
        frame.triangles += count / 3;
      }
    gl.uniform4f(fillP.u.uHatch, 0, 0, 0, 0);
  };
  const fills = (pack: FillPack | undefined, layer: string, lines: boolean): void => {
    const l = pack?.mesh.layers[layer];
    if (!pack || !l || !(lines ? l.lines : l.triangles).count) return;
    gl.bindTexture(gl.TEXTURE_2D, lines ? pack.edge : pack.fill);
    gl.bindVertexArray(lines ? pack.line : pack.tri);
    if (lines) gl.uniform1f(fillP.u.uLineAlpha, lineCoverage(strokePx(layer), dpr, planPath));
    // Only the grid chunks in view (consecutive ones merged into one call).
    for (const [first, count] of visibleRanges(l.chunks, v, c => (lines ? c.lines : c.triangles))) {
      gl.drawElements(lines ? gl.LINES : gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
      frame.drawCalls++;
      if (!lines) frame.triangles += count / 3;
    }
    if (lines) gl.uniform1f(fillP.u.uLineAlpha, 0);
  };
  dry(true);
  if (lod === 'far') {
    if (d.footprint) fills(plan, 'footprint', false);
    if (d.footprintLines) fills(plan, 'footprint', true);
    hatch('footprint');
  } else {
    if (d.blocks) fills(plan, 'blocks', false);
    if (d.blockLines) fills(plan, 'blocks', true);
    hatch('blocks');
    if (d.parcels) fills(plan, 'parcels', false);
    if (d.parcelLines) fills(plan, 'parcels', true);
    if (d.paved && mpp < 0.3) {
      // setts appear below 0.3 m/px (PAVED_FS `shown`)
      gl.useProgram(pavedP.program);
      gl.uniform4fv(pavedP.u.uView, view);
      gl.uniform1i(pavedP.u.uColors, 0);
      gl.uniform1f(pavedP.u.uMpp, mpp);
      fills(plan, 'blocks', false);
      fills(plan, 'parcels', false);
      gl.useProgram(fillP.program);
    }
    if (textured && plan.mats) {
      // plazas: flagstones over the flat fill, outlines redrawn on top
      useTextured(tfillP, plan.mats, true);
      fills(plan, 'blocks', false);
      fills(plan, 'parcels', false);
      gl.useProgram(fillP.program);
      gl.uniform4fv(fillP.u.uView, view);
      gl.uniform1i(fillP.u.uColors, 0);
      if (d.blockLines) fills(plan, 'blocks', true);
      if (d.parcelLines) fills(plan, 'parcels', true);
    }
  }
  dry(false);
  if (layers.streets) {
    fills(plan, 'quays', false);
    fills(plan, 'quays', true);
  }
  const wallDraw = { view, mpp, lod, palette, painted: renderBackground && palette !== 'parchment' && palette !== 'ink', enabled: layers.enclosures }; // walls hook
  frame.drawCalls += wallGl.draw('ground', wallDraw); // walls hook: ditches and glacis under the streets
  // Strokes: streets (casing then fill), walls (outer then inner line).
  let u = strokeP.u;
  const useStroke = (prog: Program): void => {
    gl.useProgram(prog.program);
    u = prog.u;
    gl.uniform4fv(u.uView, view);
    gl.uniform1i(u.uColors, 0);
    gl.uniform1f(u.uMpp, mpp);
    gl.uniform1f(u.uDevPx, devPx);
    gl.uniform4f(u.uOverride, 0, 0, 0, 0);
    gl.uniform1f(u.uFade, 1);
  };
  useStroke(strokeP);
  const strokes = (pack: StrokePack | undefined, first: number, pass: 0 | 1, p: { edgePx: number; inner: number; minPx: number; maxRank: number; crossings: boolean; dash: number }, single = false): void => {
    if (!pack || pack.strokes.count - first <= 0) return;
    const ranges = pack.strokes.chunks ? visibleRanges(pack.strokes.chunks, v, c => ({ start: c.first, count: c.count }), 8 * mpp, first) : [[first, pack.strokes.count - first]];
    if (!ranges.length) return;
    gl.bindTexture(gl.TEXTURE_2D, pass === 1 ? pack.inner : pack.outer);
    gl.uniform1i(u.uPass, pass);
    gl.uniform1f(u.uEdgePx, p.edgePx);
    gl.uniform1f(u.uInnerScale, p.inner);
    gl.uniform1f(u.uMinPxScale, p.minPx);
    gl.uniform1i(u.uMaxRank, p.maxRank);
    gl.uniform1i(u.uCrossings, p.crossings ? 1 : 0);
    gl.uniform1i(u.uDashKind, p.dash);
    gl.uniform1i(u.uSingle, single ? 1 : 0);
    // Streets stay off the drawn water up to their crossings (sorted last), which run over it.
    const wetFrom = wet && pack === streets ? streetCrossings : -1;
    if (!single) {
      for (const [start, count] of ranges) {
        const end = start + count,
          split = wetFrom < 0 ? start : Math.max(start, Math.min(end, wetFrom));
        if (split > start) {
          dry(true);
          pack.bind(start);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, split - start);
          frame.drawCalls++;
          frame.instances += split - start;
          dry(false);
        }
        if (end > split) {
          pack.bind(split);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - split);
          frame.drawCalls++;
          frame.instances += end - split;
        }
      }
      return;
    }
    // Translucent streets: each rank class covers a sample once (stencil ref rises with the
    // class, minor → major), a major still laid over a minor as before.
    const bounds = pack.strokes.firstWithRank;
    const rankOf = (i: number): number => {
      let r = 0;
      while (r < 15 && bounds[r] > i) r++;
      return r;
    };
    // Over the drawn water the rank bits are cleared, the water bit kept: a sample marked water (≥ WATER_BIT)
    // never passes GREATER against a rank reference, except for the crossings, which compare the rank bits only.
    gl.enable(gl.STENCIL_TEST);
    gl.clearStencil(0);
    gl.stencilMask(wet ? WATER_BIT - 1 : 0xff);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    for (const [start, count] of ranges) {
      for (let i = start, end = start + count; i < end;) {
        const r = rankOf(i),
          stop = Math.min(end, r > 0 ? bounds[r - 1] : end);
        let next = stop > i ? stop : end;
        if (wetFrom >= 0 && i < wetFrom && next > wetFrom) next = wetFrom;
        gl.stencilFunc(gl.GREATER, 16 - r, wetFrom >= 0 && i >= wetFrom ? WATER_BIT - 1 : 0xff);
        pack.bind(i);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, next - i);
        frame.drawCalls++;
        frame.instances += next - i;
        i = next;
      }
    }
    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.uniform1i(u.uSingle, 0);
  };
  if (d.streets && streets) {
    const maxRank = streetMaxRank(lod),
      crossings = true;
    const first = Math.min(streets.strokes.firstWithRank[maxRank], crossings ? streets.strokes.firstWithRank[0] : Infinity);
    // Casing, soft edge or shoulder width of the frame's street paint (the look's streetEdgePx; none far).
    const mode: StreetMode = !o.live ? 'ink' : groundRoadLook(o.live.roadLook) ? 'natural' : softStreets ? 'soft' : 'ink';
    const s = { edgePx: lod === 'far' ? 0 : streetEdgePx(mode, lod) * (mode === 'ink' ? Math.max(1, o.live?.emphasis ?? 1) : 1), inner: 1, minPx: 1, maxRank, crossings, dash: 1 };
    const paintRoads = renderBackground && palette !== 'parchment' && palette !== 'ink' && !softStreets;
    if (paintRoads) useStroke(casingP);
    if (d.streetCasing) strokes(streets, first, 0, s, softStreets && streetSurface);
    if (textured && streets.mats && palette !== 'parchment' && palette !== 'ink' && !o.colors?.road) {
      useStroke(texturedP);
      useTextured(texturedP, streets.mats, false);
      u = texturedP.u;
    } else if (paintRoads) useStroke(surfaceP);
    // The stone deck is render-background art: the look's bridges are their flat fill.
    gl.uniform1i(u.uBridgeDeck, (o.bridgeDeck ?? !o.live) ? 1 : 0);
    strokes(streets, first, 1, s, softStreets && streetSurface);
    gl.uniform1i(u.uBridgeDeck, 0);
  }
  // Lot enclosures (live look; drawLotEnclosures): from the mid level, thinner and fading out across mid; gate jambs
  // near (cart gates) and close (doors). After the streets and quays, before the town walls.
  if (yards && layers.lotEnclosures !== false && !layers.lotEnclosureMeshes && lod !== 'far') {
    useStroke(strokeP);
    const jambs = enclosureJambRank(lod);
    gl.uniform1f(u.uFade, enclosureFade(lod, mpp));
    strokes(yards.runs, 0, 1, { edgePx: 0, inner: 1, minPx: lod === 'mid' ? ENCLOSURE_MID_WIDTH : 1, maxRank: 15, crossings: false, dash: 0 });
    gl.uniform1f(u.uFade, 1);
    if (jambs >= 0) strokes(yards.jambs, 0, 1, { edgePx: 0, inner: 1, minPx: 1, maxRank: jambs, crossings: false, dash: 0 });
  }
  frame.drawCalls += wallGl.draw('shadow', wallDraw);
  useStroke(strokeP); // walls hook: painted wall shadows
  if (d.walls && walls) {
    // Wall instances carry the near minimum width; far walls are thinner (the look's wallMinPx).
    const s = { edgePx: 0, inner: WALL_CORE, minPx: wallMinPx(lod) / wallMinPx('near'), maxRank: 15, crossings: false, dash: 2 };
    strokes(walls, 0, 0, s);
    if (d.wallInner) strokes(walls, 0, 1, s);
  }
  if (d.towers && towers?.count) {
    gl.useProgram(discP.program);
    const tower = wallLook('stone', palette, lod, mpp).tower;
    gl.uniform4fv(discP.u.uView, view);
    gl.uniform1f(discP.u.uRadius, tower?.radius ?? 0);
    gl.uniform1f(discP.u.uDevPx, devPx);
    gl.uniform1f(discP.u.uStroke, (tower?.strokePx ?? 0) * mpp);
    gl.uniform4fv(discP.u.uFill, rgba01(towerColors[0]));
    gl.uniform4fv(discP.u.uEdge, rgba01(towerColors[1]));
    gl.bindVertexArray(towers.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, towers.count);
    frame.drawCalls++;
    frame.instances += towers.count;
  }
  frame.drawCalls += wallGl.draw('works', wallDraw); // walls hook: outworks, towers, gatehouses, lean-tos
  // Canals (live look; drawCityWaterways): water ribbons, then bridges and lock gates with their edge, above the
  // walls and below the buildings.
  if (d.waterways) {
    gl.useProgram(fillP.program);
    gl.uniform4fv(fillP.u.uView, view);
    gl.uniform1i(fillP.u.uColors, 0);
    fills(plan, 'waterways', false);
    fills(plan, 'waterwayBridges', false);
    fills(plan, 'waterwayBridges', true);
  }
  // Buildings above the streets (as in drawCity). On satellite grounds the far raster stands for them above its
  // fade band, whatever the level of detail.
  if (d.buildings && built && (!o.live?.farTown || farTownBuildingsShown(mpp))) {
    gl.useProgram(fillP.program);
    const pans = !footprint && !!built.mesh.layers.roofs?.triangles.count;
    const buildingLayer = footprint ? 'buildingFootprints' : 'buildings';
    if (pans) {
      // Massing shadows: each piece's outline swept by its own height (cityMassing.ts).
      gl.uniform4fv(fillP.u.uTint, castShadowTint(palette, planPath, buildings?.items[0]?.snowAltitude));
      // Live look: each sample shaded once, as the Canvas fills one path per building (its pieces' shadows overlap).
      if (o.live) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilMask(0xff);
        gl.clearStencil(0);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilFunc(gl.EQUAL, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      }
      fills(built, 'shadows', false);
      if (o.live) gl.disable(gl.STENCIL_TEST);
      gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
    } else if (painted && palette !== 'parchment') {
      // Ground shadow: the same triangles, shifted south-east (metres, with a 1 px floor).
      const { dx, dy } = paintedGroundShadow(mpp);
      gl.uniform4fv(fillP.u.uView, [view[0], view[1], view[2] + dx * view[0], view[3] + dy * view[1]]);
      gl.uniform4fv(fillP.u.uTint, castShadowTint(palette, planPath)); // straight RGBA: FILL_FS premultiplies
      fills(built, buildingLayer, false);
      gl.uniform4fv(fillP.u.uView, view);
      gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
    }
    fills(built, buildingLayer, false);
    if (pans) {
      if (textured && built.mats && palette !== 'parchment' && palette !== 'ink') {
        useTextured(tfillP, built.mats, false);
        fills(built, 'roofs', false);
        gl.useProgram(fillP.program);
        gl.uniform4fv(fillP.u.uView, view);
        gl.uniform1i(fillP.u.uColors, 0);
      } else {
        // Live look on natural grounds: the Canvas grain marks, the uneven snow's mean tone (cityGlGrain.ts) and wall rims
        // at this frame's grain level and strength (coverGrainFrame of the device metres per pixel, as drawPlanRoofsSteps).
        const grain = !!o.live?.grain && !!built.grain && !!built.rim;
        if (grain) {
          const gf = coverGrainFrame(devPx);
          gl.uniform1i(fillP.u.uRoofGrain, 1);
          gl.uniform1i(fillP.u.uRims, devPx <= RIM_DEVICE_MPP ? 1 : 0);
          gl.uniform1f(fillP.u.uGrainStrength, gf?.alpha[0] ?? 0);
          gl.uniform4fv(fillP.u['uSnowMean[0]'], snowMeans(gf?.level ?? 0));
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, built.grain);
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, built.rim);
          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(fillP.u.uGrainTab, 3);
          gl.uniform1i(fillP.u.uRimTab, 4);
          // The marks: the tile of the frame's level, as coverGrainPattern (no tiles bound: flat pans).
          const marks = !!gf && !!o.live?.grainMarks && !!built.lay;
          gl.uniform1i(fillP.u.uGrainMarks, marks ? 1 : 0);
          if (marks) {
            gl.uniform1f(fillP.u.uGrainLevel, gf.level);
            gl.uniform2f(fillP.u.uOrigin, origin.x, origin.y);
            gl.uniform2f(fillP.u.uGrainShift, GRAIN_SHIFT[0], GRAIN_SHIFT[1]);
            gl.uniform1f(fillP.u.uGrainTile, COVER_GRAIN_TILE * COVER_GRAIN_PX_M);
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, built.lay);
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, o.live!.grainMarks!);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
        fills(built, 'roofs', false);
        if (grain) {
          gl.uniform1i(fillP.u.uRoofGrain, 0);
          gl.uniform1i(fillP.u.uGrainMarks, 0);
        }
      }
      fills(built, 'roofs', true);
    }
    if (d.buildingLines) fills(built, buildingLayer, true);
    if (footprint && built.mesh.layers.ruins?.triangles.count) {
      // Only native ruin pieces: roofed parts of a decaying lot stay intact.
      gl.uniform4fv(fillP.u.uTint, rgba01(RUIN_PAPER));
      gl.uniform1f(fillP.u.uRuinSpacing, 3 * mpp);
      fills(built, 'ruins', false);
      gl.uniform1f(fillP.u.uRuinSpacing, 0);
      gl.uniform4fv(fillP.u.uTint, rgba01(RUIN_INK));
      fills(built, 'ruins', true);
      gl.uniform4f(fillP.u.uTint, 0, 0, 0, 0);
    }
  }
  if (selection) {
    useStroke(strokeP);
    gl.uniform4fv(u.uOverride, rgba01(SELECTION.stroke!));
    strokes(selection, 0, 1, { edgePx: 0, inner: 1, minPx: 1, maxRank: 15, crossings: true, dash: 0 });
    gl.uniform4f(u.uOverride, 0, 0, 0, 0);
  }
  gl.bindVertexArray(null);
}
