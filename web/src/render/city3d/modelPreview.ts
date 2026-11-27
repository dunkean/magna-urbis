import type { Layout, Shape } from '../../../../rust/bridge/urban';
import type { Decor } from '../../ui/decor';
import { siteVisualScene } from '../../ui/urbanSilhouettes';
import { keepProceduralPreview, roleModelById } from './authoredModels';
import type { View } from '../view';
import { presetComposition } from '../composition';
import { resolveAppearance } from '../appearanceRecipe';

const MAP_SIZE = 8192;
const CENTER = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
const GROUND_M = 40;

function rectangle(x: number, y: number, width: number, depth: number): Shape {
  return {
    outer: [
      { x: x - width / 2, y: y - depth / 2 },
      { x: x + width / 2, y: y - depth / 2 },
      { x: x + width / 2, y: y + depth / 2 },
      { x: x - width / 2, y: y + depth / 2 },
    ],
    holes: [],
  };
}

/** Two fixed sites on a flat retained surface. Stable ids, dimensions and placements make screenshots comparable. */
export function modelPreviewFixture(id: string) {
  const model = roleModelById(id);
  if (!model) throw new Error(`Unknown or invalid 3D model: ${id}`);
  const [width, depth] = model.footprintM,
    label = model.label + ' · 3D model preview',
    block = rectangle(CENTER.x, CENTER.y, 2.8 * width, depth + 16),
    n = 16,
    height = new Float32Array(n * n).fill(GROUND_M);
  const layout: Layout = {
    key: 'main',
    culture: model.culture,
    center: CENTER,
    quarters: [{ shape: block, phase: 1, zone: 'core' }],
    blocks: [{ shape: block, quarter: 0, kind: 'block', axis: { x: 1, y: 0 }, phase: 1, zone: 'core' }],
    streets: [
      {
        path: [
          { x: CENTER.x - 1.4 * width, y: CENTER.y + depth / 2 + 8 },
          { x: CENTER.x + 1.4 * width, y: CENTER.y + depth / 2 + 8 },
        ],
        widths: [5, 5],
        rank: 1,
        role: 'street',
      },
    ],
    warnings: [],
  };
  const eave = model.heightM * (5.5 / 9),
    sites = ['authored', 'baseline'].map((name, offset) => {
      const x = CENTER.x + (offset === 0 ? -0.65 : 0.65) * width;
      return {
        id: name,
        parcel_id: name,
        offset,
        function: 'collective' as const,
        culture: { culture: model.culture, pack: 'western', mode: 'historical_inspired' as const, borrowing: null },
        programme: { role: model.role, landmark: true, massing: [{ floors: 1, eave_m: eave, rise_m: model.heightM - eave, roof: 'gable', ridges: [[x - width / 2, CENTER.y, x + width / 2, CENTER.y]], wall: 'stone', cover: 'tile' }] },
        surface: [rectangle(x, CENTER.y, width, depth)],
        preview: true,
        ground_z_m: GROUND_M,
        entrance: { x, y: CENTER.y + depth / 2 + 2 },
        access_id: 'street',
      };
    });
  const decor: Decor = {
    meta: {
      format: 'magna-decor',
      version: 1,
      id: 'model-preview-' + id,
      label,
      tags: { relief: 'flat', climate: 'temperate' },
      seed: 'model-preview',
      width: MAP_SIZE,
      query: 'relief=flat&climate=temperate',
      created: '2026-11-27T00:00:00.000Z',
      settlements: [],
      roadConfig: null,
      roads: null,
      waterSvg: '',
      stats: { land: 1, minHeight: GROUND_M, maxHeight: GROUND_M, riverKm: 0, roadKm: 0 },
    },
    raster: { width: MAP_SIZE, n, height, water: new Uint8Array(n * n), waterLevel: height, riverWidth: new Float32Array(n * n), riverIds: new Int32Array(n * n).fill(-1) },
  };
  const composition = presetComposition('atlas');
  composition.quality = 'full';
  const appearance = { style: 'atlas' as const, renderer: 'bench' as const, composition, city: { exaggeration: 1, trees3d: false, refinement: 'source' as const } };
  const resolved = resolveAppearance(appearance, { mapStyle: 'atlas' }, { nativeCities: true, nativeTerrain: true, buildings: true }, 'view3d');
  const scene = siteVisualScene(sites);
  keepProceduralPreview(scene.buildings[1]);
  return { label, decor, layouts: [layout], scene, buildingsWidth: width, appearance, resolved };
}

export function modelPreviewView(fixture: ReturnType<typeof modelPreviewFixture>, overview: boolean, viewportWidth: number): View {
  const width = fixture.buildingsWidth;
  return { cx: CENTER.x, cy: CENTER.y, scale: (overview ? 4 : Math.min(160, viewportWidth / 3)) / width, yaw: 0.12, pitch: 0.96 };
}
