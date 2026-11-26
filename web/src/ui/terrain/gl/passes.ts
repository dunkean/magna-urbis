/**
 * Water passes of a WebGL2 ground redraw: the river capsules (MAX-blended into their own target, then composited),
 * the retained water raster, and their composite as painted water (renderWaterShader.ts) or as plain ink. The water
 * layer and the map pass call them with the destination framebuffer (redraw.ts lists the passes).
 */
import { renderWaterRings } from '../../../render/renderWaterShader';
import { waterBed } from '../../../render/waterPalette';
import { hexToRgb } from '../../../render/styles';
import { waterUniforms } from '../../../render/waterStyle';
import { styleTraits } from '../../../render/terrainStyle';
import { rgbaTarget, type GlViewTargets } from './resources';
import { capsuleRegime, layerFreshWater, layerWaterInk, waterDrawn, type LookPalettes, type RedrawFrame } from '../redraw';
import type { GlPrograms } from './programs';
import type { RetainedWaterSource } from '../retainedWater';
import type { TerrainLook } from '../contract';

/** What the water passes of one redraw read; built once per draw. */
export interface GlWaterPass {
  gl: WebGL2RenderingContext;
  programs: GlPrograms;
  targets: GlViewTargets;
  look: TerrainLook;
  frame: RedrawFrame;
  stylePixelRatio: number;
  water: LookPalettes['water'];
  /** The look paints its water (and is not the water-only capture). */
  painted: boolean;
  band: number;
  /** Captures link the painted-water program now. */
  waitPainted: boolean;
  empty: WebGLTexture;
  lake?: WebGLTexture;
  lakeMode: number;
  lakeN: number;
  overlay?: WebGLTexture;
}

/** Composite a coverage layer (texture unit `unit`, bound) as painted water; blending is set by the caller. Plain
 * composite while the painted-water program links. */
export function paintWater(c: GlWaterPass, unit: number, regime: boolean | number): void {
  const { gl, frame, stylePixelRatio: dpr, band } = c;
  const ready = c.programs.water(c.waitPainted);
  if (!ready) {
    c.programs.drawComposite(unit);
    return;
  }
  const { program, u: cache } = c.programs.painted!;
  const u = (name: string): WebGLUniformLocation | null => {
    let location = cache.get(name);
    if (location === undefined) cache.set(name, (location = gl.getUniformLocation(program, name)));
    return location;
  };
  const palette = waterUniforms(c.water),
    rings = renderWaterRings(frame.px, band);
  // Bilinear taps (the bound layer is only ever read with texelFetch elsewhere).
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.useProgram(program);
  gl.uniform1i(u('uLayer'), unit);
  gl.uniform2f(u('uCanvas'), frame.width, frame.height);
  gl.uniform2f(u('uOrigin'), frame.origin[0], frame.origin[1]);
  gl.uniform1f(u('uPx'), frame.px);
  gl.uniform1f(u('uDpr'), dpr);
  gl.uniform1f(u('uBand'), band);
  gl.uniform1f(u('uBankPx'), Math.min(6 * dpr, Math.max(1.5 * dpr, 7 / frame.px)));
  gl.uniform1fv(u('uRings[0]'), rings);
  gl.uniform1i(u('uRingCount'), rings.length);
  gl.uniform3fv(u('uWaterStops[0]'), palette.colors);
  gl.uniform1fv(u('uWaterStopT[0]'), palette.positions);
  gl.uniform1i(u('uWaterStopCount'), c.water.stops.length);
  gl.uniform1i(u('uRegime'), Number(regime));
  gl.uniform4f(u('uFreshWater'), ...layerFreshWater(c.look, c.water, c.painted));
  gl.uniform3f(u('uWaterBed'), ...waterBed(c.look.climateZone));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** River capsules, premultiplied and MAX-blended so overlapping capsules cover like one stroke, then composited over
 * `destination`. Diagnostic colours (overlay) keep the plain composite. */
export function renderRivers(c: GlWaterPass, rivers: { vao: WebGLVertexArrayObject; count: number; regime: boolean }, destination: WebGLFramebuffer | null): void {
  if (!rivers.count || !waterDrawn(c.look)) return;
  const { gl, frame, look } = c;
  const target = (c.targets.river = rgbaTarget(gl, frame.width, frame.height, c.targets.river));
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(c.programs.river);
  const r = (name: string): WebGLUniformLocation | null => c.programs.riverUniform(name);
  gl.uniform2f(r('uCanvas'), frame.width, frame.height);
  gl.uniform2f(r('uOrigin'), frame.origin[0], frame.origin[1]);
  gl.uniform1f(r('uPx'), frame.px);
  gl.uniform1f(r('uDpr'), c.stylePixelRatio);
  gl.uniform1i(r('uPhysicalWidth'), styleTraits(look.style).physicalRiverWidth ? 1 : 0);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, c.lake ?? c.empty);
  gl.uniform1i(r('uLake'), 2);
  gl.uniform1f(r('uMapW'), look.mapWidth);
  // Until the painted program links, a regime layer must use real water ink, never its encoded RGB.
  const regime = capsuleRegime(look, rivers.regime);
  const paint = c.painted && !c.overlay && !!c.programs.water(c.waitPainted),
    flat = rivers.regime && !c.overlay && !paint,
    color = hexToRgb(layerWaterInk(look, c.water, c.painted));
  gl.uniform4f(r('uFlatWater'), color[0] / 255, color[1] / 255, color[2] / 255, flat ? 1 : paint && rivers.regime ? (regime === 4 ? -2 : -1) : 0);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, c.overlay ?? c.empty);
  gl.uniform1i(r('uOverlay'), 3);
  gl.uniform1i(r('uHasOverlay'), c.overlay ? 1 : 0);
  gl.uniform1i(r('uHasLake'), c.lake ? c.lakeMode : 0);
  gl.uniform1f(r('uLakeN'), c.lakeN);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MAX);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(rivers.vao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, rivers.count);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  if (paint) {
    paintWater(c, 0, regime);
    return;
  }
  c.programs.drawComposite(0);
}

/** The retained water's viewport raster (repainted on Canvas 2D when the view changed, uploaded flipped and
 * premultiplied on unit 11), composited over `destination`. */
export function renderRetainedWater(c: GlWaterPass, source: RetainedWaterSource, destination: WebGLFramebuffer | null): void {
  if (!source.paths.length || !waterDrawn(c.look)) return;
  const { gl, frame, look, targets } = c;
  targets.retainedTexture ??= gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE11);
  gl.bindTexture(gl.TEXTURE_2D, targets.retainedTexture);
  if (targets.retained.paint(source, frame.origin, frame.px, frame.width, frame.height, layerWaterInk(look, c.water, c.painted), c.painted, look.waterStyle ?? look.style)) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targets.retained.canvas!);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (c.painted) {
    paintWater(c, 11, targets.retained.coded);
    return;
  }
  c.programs.drawComposite(11);
}
