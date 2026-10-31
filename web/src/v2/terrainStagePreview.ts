import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import type { GenerationStage } from '../../../rust/bridge/terrainGenerationRecipe';

export const TERRAIN_STAGE_OUTPUTS: Record<string, GenerationStage> = {
  'relief-source': 'initialize', 'relief-climate': 'initialize', 'relief-grids': 'grids',
  'relief-noise': 'initialize', 'relief-regional': 'regional', 'relief-relax': 'regionalFinish',
  'relief-coast-cut': 'coastCut',
  'relief-reconstruct': 'reconstruct', 'relief-calibrate': 'amplitude', 'relief-detail': 'ridged',
  'relief-surface': 'surface', 'relief-datum': 'normalize', 'relief-phasor': 'phasor',
  'relief-conditioning': 'posterior', 'relief-aeolian': 'wind', 'relief-coasts': 'coasts',
};

/** Stops inspection at an output while the bridge retains its resumable checkpoints. */
export class TerrainStageOutput {
  constructor(readonly height: Float32Array, readonly stage: GenerationStage) {}
}

/** A sampled intermediate field needs normals for the same renderers used by complete terrain. */
export function previewTerrainData(source: Float32Array, settings: TerrainSettings, resolution: number, generationMs: number): TerrainData {
  const n = Math.sqrt(source.length);
  if (!Number.isInteger(n) || !source.every(Number.isFinite)) throw new Error('Invalid intermediate terrain output.');
  const height = new Float32Array(resolution ** 2), normalX = height.slice(), normalY = height.slice(), normalZ = height.slice();
  let minHeight = Infinity, maxHeight = -Infinity;
  const at = (x: number, y: number) => source[Math.max(0, Math.min(n - 1, y)) * n + Math.max(0, Math.min(n - 1, x))];
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const px = Math.max(0, Math.min(n - 1, (x + .5) * n / resolution - .5)), py = Math.max(0, Math.min(n - 1, (y + .5) * n / resolution - .5));
    const ix = Math.floor(px), iy = Math.floor(py), tx = px - ix, ty = py - iy, i = y * resolution + x;
    const value = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
    height[i] = value; minHeight = Math.min(minHeight, value); maxHeight = Math.max(maxHeight, value);
  }
  const cell = settings.width / resolution;
  const h = (x: number, y: number) => height[Math.max(0, Math.min(resolution - 1, y)) * resolution + Math.max(0, Math.min(resolution - 1, x))];
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const i = y * resolution + x, dx = (h(x - 1, y) - h(x + 1, y)) / (2 * cell), dy = (h(x, y - 1) - h(x, y + 1)) / (2 * cell), length = Math.hypot(dx, dy, 1);
    normalX[i] = dx / length; normalY[i] = dy / length; normalZ[i] = 1 / length;
  }
  return { x: 0, y: 0, width: settings.width, resolution, height, normalX, normalY, normalZ, caveMask: new Uint8Array(0),
    minHeight, maxHeight, globalMinHeight: minHeight, globalMaxHeight: maxHeight, motifSize: settings.motifSize, generationMs,
    field: { n, data: source.slice(), exact: true, floor: Math.min(0, minHeight) }, backend: 'wasm', generationBackend: 'cpu' };
}
