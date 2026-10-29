import type { HeightLayer } from './terrainGl';

export type TerrainAmplification = 'classic' | 'phasor' | 'mse' | 'hybrid';
export type TerrainRefinement = 'source' | 'noise' | 'neural-earth' | 'neural-earth-phasor' | 'neural-earth-mse' | 'neural-earth-hybrid';
export function isNeuralRefinement(value: string): boolean {
  return ['neural-earth', 'neural-earth-phasor', 'neural-earth-mse', 'neural-earth-hybrid'].includes(value);
}
export function refinementAmplification(value: TerrainRefinement): TerrainAmplification {
  return value === 'neural-earth-phasor' ? 'phasor' : value === 'neural-earth-mse' ? 'mse' : value === 'neural-earth-hybrid' ? 'hybrid' : 'classic';
}
export interface RefinementRegistration {
  id: string; version: string; minMpp: number; nativeMpp: number; decoderUsed: boolean;
  amplification?: TerrainAmplification; methodVersion?: string;
}
interface RefinementMeta { x: number; y: number; width: number; n: number; sourceCell: number; lod: number; version: string; decoderUsed: boolean }
export interface RefinedHeightLayer extends HeightLayer { refinement: RefinementMeta }

const base64 = (data: Float32Array): string => {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
};

/** Truncated inverse of the cubic B-spline sampling filter. Both the mesh and
 * material consume these coefficients, so samples retain the upstream heights.
 * The service supplies a halo; the outer twelve samples are never displayed. */
function splineCoefficients(samples: Float32Array, n: number): Float32Array {
  const pole = Math.sqrt(3) - 2, radius = 12, taps = Array.from({ length: radius * 2 + 1 }, (_, i) => pole ** Math.abs(i - radius));
  const sum = taps.reduce((a, b) => a + b, 0); taps.forEach((v, i) => { taps[i] = v / sum; });
  const temp = new Float32Array(samples.length), result = new Float32Array(samples.length);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let value = 0;
    for (let k = -radius; k <= radius; k++) value += samples[y * n + Math.max(0, Math.min(n - 1, x + k))] * taps[k + radius];
    temp[y * n + x] = value;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let value = 0;
    for (let k = -radius; k <= radius; k++) value += temp[Math.max(0, Math.min(n - 1, y + k)) * n + x] * taps[k + radius];
    result[y * n + x] = value;
  }
  return result;
}

/** One immutable retained surface per service context. Requests are deduplicated
 * and bounded; a camera change never changes the seed or regenerates the map. */
export class TerrainRefinementSession {
  private cache = new Map<string, RefinedHeightLayer>();
  private pending = new Map<string, Promise<RefinedHeightLayer>>();
  private abort = new AbortController();
  private bytes = 0;
  private constructor(readonly server: string, public registration: RefinementRegistration, private reconnect: () => Promise<RefinementRegistration>) {}

  static async create(server: string, field: HeightLayer, options: { seed: string; source?: string; amplification?: TerrainAmplification; intensity?: number; neuralToken?: string; neuralWindow?: { x: number; y: number; width: number; heightScale: number } }): Promise<TerrainRefinementSession> {
    const body = JSON.stringify({ ...options, width: field.width, n: field.n, heights: base64(field.data), interpolation: 'bspline' });
    const connect = async (): Promise<RefinementRegistration> => {
      let response: Response;
      try { response = await fetch(`${server}/refinement/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
      catch { throw new Error('Neural Earth : démarrez le service avec npm run neural:python.'); }
      if (!response.ok) throw new Error(`Neural Earth : ${await response.text()}`);
      const registration = await response.json() as RefinementRegistration;
      if (!registration.id || !Number.isFinite(registration.minMpp) || registration.minMpp <= 0) throw new Error('Service de raffinement incompatible : relancez npm run neural:python.');
      if (options.amplification && options.amplification !== 'classic' && registration.amplification !== options.amplification) throw new Error('Ce service Neural Earth ne prend pas en charge la méthode demandée. Relancez npm run neural:python.');
      return registration;
    };
    return new TerrainRefinementSession(server, await connect(), connect);
  }

  tile(region: { x: number; y: number; width: number }, pixels: number): Promise<RefinedHeightLayer> {
    // A 16-cell halo covers the spline inverse and four interpolation taps.
    const spacing = Math.max(this.registration.minMpp, region.width / pixels), halo = 16;
    const n = Math.max(8, Math.min(992, Math.ceil(region.width / spacing))) + 2 * halo;
    const cell = region.width / (n - 2 * halo), width = cell * n;
    const x = region.x - halo * cell, y = region.y - halo * cell;
    const key = `${x}:${y}:${width}:${n}`;
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return Promise.resolve(cached); }
    let pending = this.pending.get(key);
    if (!pending) {
      pending = (async () => {
        const request = () => fetch(`${this.server}/refinement/tile`, { method: 'POST', signal: this.abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: this.registration.id, x, y, width, resolution: n }) });
        let response = await request();
        if (!response.ok) {
          const error = await response.text();
          if (response.status === 400 && error.includes('source expired or unknown')) {
            this.registration = await this.reconnect(); response = await request();
          } else throw new Error(`Tuile Neural Earth : ${error}`);
        }
        if (!response.ok) throw new Error(`Tuile Neural Earth : ${await response.text()}`);
        const meta = JSON.parse(response.headers.get('X-Neural-Meta') ?? '{}') as RefinementMeta;
        const data = new Float32Array(await response.arrayBuffer());
        if (!Number.isInteger(meta.n) || meta.n < 4 || data.length !== meta.n * meta.n || data.some(v => !Number.isFinite(v))) throw new Error('Tuile Neural Earth incomplète.');
        const layer: RefinedHeightLayer = { x: meta.x, y: meta.y, width: meta.width, n: meta.n, data: splineCoefficients(data, meta.n), refinement: meta };
        this.cache.set(key, layer); this.bytes += layer.data.byteLength;
        while (this.bytes > 64 * 1024 * 1024 && this.cache.size > 1) {
          const first = this.cache.keys().next().value!; this.bytes -= this.cache.get(first)!.data.byteLength; this.cache.delete(first);
        }
        return layer;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }

  dispose(): void { this.abort.abort(); this.cache.clear(); this.pending.clear(); this.bytes = 0; }
}
