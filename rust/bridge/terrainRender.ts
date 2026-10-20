import { isFantasyStyle, renderFantasyTerrain, DEFAULT_FANTASY_OPTIONS, type FantasyOptions } from './fantasyTerrain';
import { renderMaterialPixels } from './terrainMaterialRaster';
import { terrainLights, DEFAULT_TERRAIN_LAYERS, DEFAULT_TERRAIN_LIGHTING, type TerrainLayers, type TerrainLighting } from '../../web/src/render/terrainLighting';
import type { World } from '../../web/src/gen/types';
import { marchingSquares } from '../../web/src/gen/terrain/contour';
import { slopeGrid } from '../../web/src/gen/core/grid';
import { contourSet, CONTOUR_INTERVAL } from '../../web/src/render/contours';
import { CANVAS_MAP_STROKES, mapStrokeWidth } from '../../web/src/render/strokes';
import { encodePng, pngDataUrl, renderTerrainPixels } from '../../web/src/render/raster';
import type { TerrainData, TerrainSettings } from './terrain';

import { terrainStyle, type TerrainStyle } from '../../web/src/render/terrainStyle';
import { seaDistanceSurface, seaMaterialSvg } from '../../web/src/render/terrainWater';
export type { TerrainStyle } from '../../web/src/render/terrainStyle';
export interface TerrainScene { svg: string; imageUrl: string; contourStep: number; profile?: { pixelsMs: number; imageMs: number; contoursMs: number } }
let coastClipId = 0;
const contourPaths = new WeakMap<TerrainData, { relief: string; mapWidth: number; step: number; thin: string; index: string }>();

/** Close land outside the tile, including mainland edges and holes, then smooth
 * the sub-cell contour. SVG antialiases this boundary at the actual screen zoom. */
export function terrainLandClip(terrain: TerrainData): string {
  const n = terrain.resolution, cell = terrain.width / n, size = n + 4;
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.max(0, Math.min(n - 1, x - 2)), sy = Math.max(0, Math.min(n - 1, y - 2));
    const h = terrain.height[sy * n + sx];
    field[y * size + x] = x === 0 || y === 0 || x === size - 1 || y === size - 1 ? -Math.max(1, Math.abs(h)) : h;
  }
  const paths = marchingSquares(field, size, size, 0, cell, -1.5 * cell, -1.5 * cell);
  return paths.map(path => {
    const points = path.pts;
    if (!path.closed || points.length < 3) return '';
    const middle = (i: number, j: number): string => `${((points[i].x + points[j].x) / 2).toFixed(3)},${((points[i].y + points[j].y) / 2).toFixed(3)}`;
    return `M${middle(points.length - 1, 0)}` + points.map((point, i) => `Q${point.x.toFixed(3)},${point.y.toFixed(3)} ${middle(i, (i + 1) % points.length)}`).join('') + 'Z';
  }).join('');
}

function coastImage(terrain: TerrainData, imageUrl: string, sea: string, clipNamespace: string): string {
  const width = terrain.width, id = `terrain-land-${clipNamespace}-${++coastClipId}`;
  return `<defs><clipPath id="${id}"><path d="${terrainLandClip(terrain)}" clip-rule="evenodd"/></clipPath></defs>${sea}<image width="${width}" height="${width}" href="${imageUrl}" clip-path="url(#${id})"/>`;
}

// Extend land color slightly past its geometric edge so clipped raster filtering
// cannot paint a paper/sea fringe over the antialiased vector shoreline.
function extendLandColors(rgb: Uint8Array, terrain: TerrainData): void {
  const n = terrain.resolution, original = rgb.slice();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (terrain.height[i] > 0) continue;
    let nearest = -1, distance = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy, d = dx * dx + dy * dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n || d >= distance) continue;
      const index = yy * n + xx;
      if (terrain.height[index] > 0) { nearest = index; distance = d; }
    }
    if (nearest >= 0) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = original[nearest * 3 + c];
  }
}

/** Match the working application's Canvas stroke weights at the current zoom. */
export function terrainContourWidths(style: TerrainStyle, scale: number): { thin: number; index: number } {
  const pal = terrainStyle(style).palette;
  return {
    thin: mapStrokeWidth(CANVAS_MAP_STROKES.contour, scale) * scale,
    index: mapStrokeWidth(CANVAS_MAP_STROKES.contourIndex, scale, pal.contourIndexW / 1.6) * scale,
  };
}

// Low to high elevation; interpolate RGB directly, without lighting or contours.
const elevationColors = [
  [0, 32, 96], [0, 160, 70], [255, 230, 0], [235, 35, 20],
  [128, 128, 128], [255, 255, 255],
] as const;

function renderElevation(terrain: TerrainData, frame: boolean, clipNamespace: string, waterStyle: TerrainStyle, showWater = true, referenceWidth = terrain.width, showTerrain = true): TerrainScene {
  const n = terrain.resolution, width = terrain.width;
  const rgb = new Uint8Array(n * n * 3);
  const coastal = terrain.globalMinHeight < 0;
  const landMin = coastal ? 0 : terrain.globalMinHeight;
  const range = Math.max(1e-6, terrain.globalMaxHeight - landMin);
  for (let i = 0; i < terrain.height.length; i++) {
    // Use the engine's global range so camera regions retain the same colors.
    if (coastal && terrain.height[i] <= 0) {
      const depth = Math.max(0, Math.min(1, terrain.height[i] / terrain.globalMinHeight));
      rgb[i * 3] = Math.round(35 - 27 * depth); rgb[i * 3 + 1] = Math.round(125 - 85 * depth); rgb[i * 3 + 2] = Math.round(175 - 79 * depth);
      continue;
    }
    const t = Math.max(0, Math.min(1, (terrain.height[i] - landMin) / range));
    const position = (coastal ? 1 : 0) + t * (elevationColors.length - (coastal ? 2 : 1));
    const index = Math.min(elevationColors.length - 2, Math.floor(position));
    const a = elevationColors[index], b = elevationColors[index + 1], u = position - index;
    for (let channel = 0; channel < 3; channel++) rgb[i * 3 + channel] = Math.round(a[channel] + (b[channel] - a[channel]) * u);
  }
  let sea = '';
  if (coastal) {
    sea = showWater ? seaMaterialSvg(seaDistanceSurface(terrain, referenceWidth), terrain.x, terrain.y, waterStyle, terrain.width) : '';
    extendLandColors(rgb, terrain);
  }
  const imageUrl = pngDataUrl(encodePng(rgb, n, n, 3, 1));
  let svg = coastal ? coastImage(terrain, imageUrl, sea, clipNamespace) : `<image width="${width}" height="${width}" href="${imageUrl}"/>`;
  if (!showTerrain) svg = `<rect width="${width}" height="${width}" fill="#eee2c3"/>` + sea + (coastal ? `<path d="${terrainLandClip(terrain)}" fill="#eee2c3" fill-rule="evenodd"/>` : '');
  if (frame) svg += `<rect width="${width}" height="${width}" fill="none" stroke="#333333" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
  return { svg, imageUrl, contourStep: 0 };
}

/** Transitional renderer adapter. Rust never depends on the legacy World schema. */
export function renderRustTerrain(terrain: TerrainData, style: TerrainStyle, frame = true, settings: Pick<TerrainSettings, 'relief' | 'width'> & Partial<Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues'>> = { relief: 'mountains', width: terrain.width }, showContours = true, clipNamespace = 'main', lighting: TerrainLighting = DEFAULT_TERRAIN_LIGHTING, layers: TerrainLayers = DEFAULT_TERRAIN_LAYERS, fantasyOptions: FantasyOptions = DEFAULT_FANTASY_OPTIONS, paintBrushes = true, waterStyle: TerrainStyle = style): TerrainScene {
  frame &&= layers.frame;
  if (style === 'copernicus') {
    const scene = renderElevation(terrain, frame, clipNamespace, waterStyle, layers.water !== false, settings.width, layers.relief);
    return scene;
  }
  const started = performance.now();
  const n = terrain.resolution, width = terrain.width, cell = width / n;
  const cavern = terrain.caveMask.length > 0;
  const coastal = terrain.globalMinHeight < 0 && !cavern;
  // Stable continuous shading, without engraved bands or high-frequency paper grain.
  const pal = { ...terrainStyle(style).palette, hatch: 0, grain: 0 };
  if (isFantasyStyle(style)) { pal.paper = style === 'fantasy-ink' ? '#faf9f4' : '#eee6ce'; pal.hypso = [[0, pal.paper], [1, pal.paper]]; lighting = { ...lighting, strength: .12 }; pal.seaFill = style === 'fantasy-ink' ? '#e5e7e6' : '#b9ccd0'; }
  if (!layers.hypsometry) pal.hypso = [[0, pal.paper], [1, pal.paper]];
  // The shared rasterizer only reads mapSize, terrain.height and terrain.water.
  const legacyRasterInput = {
    mapSize: width,
    terrain: { height: { w: n, h: n, cell, data: terrain.height }, water: new Uint8Array(n * n) },
  } as unknown as World;
  const pixels = renderTerrainPixels(legacyRasterInput, pal, {
    pixels: n, surface: terrain.height,
    normals: { x: terrain.normalX, y: terrain.normalY, z: terrain.normalZ },
    lighting,
    heightRange: { min: Math.max(0, terrain.globalMinHeight), max: terrain.globalMaxHeight }, exaggeration: 2,
    grainCoordinates: { x: terrain.x, y: terrain.y, cell: terrain.motifSize / 512 },
  });
  if (style === 'render' && layers.hypsometry) {
    const material = renderMaterialPixels(terrain, { seed: settings.seed ?? '42', climate: settings.climate, climateValues: settings.climateValues });
    const neutral = renderTerrainPixels(legacyRasterInput, { ...pal, hypso: [[0, '#ffffff'], [1, '#ffffff']] }, {
      pixels: n, surface: terrain.height, normals: { x: terrain.normalX, y: terrain.normalY, z: terrain.normalZ }, lighting,
      heightRange: { min: Math.max(0, terrain.globalMinHeight), max: terrain.globalMaxHeight }, exaggeration: 2,
    });
    for (let i = 0; i < n * n; i++) for (let c = 0; c < 3; c++) {
      pixels.rgb[i * 3 + c] = Math.round(material[i * 3 + c] * (terrain.height[i] >= 0 ? neutral.rgb[i * 3 + c] / 255 : 1));
    }
  }
  let sea = '';
  if (coastal) {
    sea = layers.water !== false ? seaMaterialSvg(seaDistanceSurface(terrain, settings.width), terrain.x, terrain.y, waterStyle, terrain.width) : '';
  }
  if (coastal) extendLandColors(pixels.rgb, terrain);
  if (cavern) {
    const light = terrainLights(lighting).primary;
    for (let i = 0; i < n * n; i++) if (terrain.caveMask[i]) {
      // Black rock with continuous inward-facing wall light; no stripes or grain.
      const gx = terrain.normalX[i] / Math.max(1e-8, terrain.normalZ[i]) * lighting.exaggeration * 0.5;
      const gy = terrain.normalY[i] / Math.max(1e-8, terrain.normalZ[i]) * lighting.exaggeration * 0.5;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1), nx = gx * inv, ny = gy * inv, nz = inv;
      const slope = Math.hypot(nx, ny);
      const shade = Math.max(0, Math.min(72, (lighting.enabled ? lighting.strength : 0) * (slope * (36 + 84 * (nx * light[0] + ny * light[1])) + (1 - nz) * 12)));
      pixels.rgb[i * 3] = shade; pixels.rgb[i * 3 + 1] = shade; pixels.rgb[i * 3 + 2] = shade;
    }
  }
  // Camera PNGs are transient: fast, lossless compression keeps their pixels
  // identical while avoiding export-grade compression on the UI thread.
  const pixelsMs = performance.now() - started, imageStarted = performance.now();
  const background = pngDataUrl(encodePng(pixels.rgb, pixels.w, pixels.h, 3, 1));
  const imageMs = performance.now() - imageStarted, contourStarted = performance.now();
  // The engine samples a continuous physical surface for each camera region.
  // Contours use those same samples; their levels remain fixed across cameras.
  // Wider mountain spacing avoids tinting steep slopes with dense ink.
  // Keep the shared smoothing and small/near-flat loop filtering.
  const relief = settings.relief === 'flat' || settings.relief === 'hills' || settings.relief === 'valley' ? settings.relief : 'mountains';
  const step = CONTOUR_INTERVAL[relief] * (relief === 'mountains' ? 2 : 1);
  let paths = contourPaths.get(terrain);
  if (!cavern && !isFantasyStyle(style) && showContours && (!paths || paths.relief !== relief || paths.mapWidth !== settings.width)) {
    const height = legacyRasterInput.terrain.height;
    const contours = contourSet({ terrain: { height, slope: slopeGrid(height) }, options: { relief } } as unknown as World, settings.width / 1600, step, true);
    const pathData = (lines: typeof contours.thin): string => lines.map(path => path.pts.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('') + (path.closed ? 'Z' : '')).join('');
    paths = { relief, mapWidth: settings.width, step, thin: pathData(contours.thin), index: pathData(contours.index) };
    contourPaths.set(terrain, paths);
  }
  const weights = terrainContourWidths(style, 1e-6);
  let svg = `<rect width="${width}" height="${width}" fill="${pal.paper}"/>`;
  if (!layers.relief && coastal && layers.water !== false) svg += sea + `<path d="${terrainLandClip(terrain)}" fill="${pal.paper}" fill-rule="evenodd"/>`;
  if (layers.relief) svg += coastal ? coastImage(terrain, background, sea, clipNamespace) : `<image width="${width}" height="${width}" href="${background}"/>`;
  if (paintBrushes && clipNamespace !== 'detail' && isFantasyStyle(style) && layers.relief) svg += renderFantasyTerrain(terrain, style, { ...settings, seed: settings.seed ?? '42' }, fantasyOptions);
  if (!cavern && showContours && !isFantasyStyle(style)) svg += `<g class="layer-contours" fill="none" stroke="${pal.contour}" stroke-linejoin="round" stroke-linecap="round"><path d="${paths!.thin}" style="stroke-width:var(--terrain-contour-width,${weights.thin}px)" vector-effect="non-scaling-stroke" opacity="${pal.contourOpacity * 0.5}"/><path d="${paths!.index}" style="stroke-width:var(--terrain-contour-index-width,${weights.index}px)" vector-effect="non-scaling-stroke" opacity="${pal.contourOpacity * 0.75}"/></g>`;
  if (frame) svg += `<rect x="0" y="0" width="${width}" height="${width}" fill="none" stroke="${pal.frame}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
  return { svg, imageUrl: background, contourStep: cavern || isFantasyStyle(style) ? 0 : step, profile: { pixelsMs, imageMs, contoursMs: performance.now() - contourStarted } };
}
