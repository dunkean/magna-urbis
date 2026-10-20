import type { ExecutionRuntime } from '../../web/src/ui/executionProfile';
import type { TerrainData, TerrainRequest, TerrainSettings } from './terrain';
import { heightmapSurface, parseTerrainSketch } from './terrainSketch';
import { nativeRequest, nativeSession } from './nativeEngine';

interface NativeHeader {
  session: string; x: number; y: number; width: number; resolution: number;
  minHeight: number; maxHeight: number; globalMinHeight: number; globalMaxHeight: number;
  motifSize: number; prepareMs: number; samplingMs: number; fieldN: number; fieldExact: boolean;
  erosionDefaults: number[]; arrays: { name: string; type: 'f32' | 'u8'; count: number }[];
}
let session: string | undefined;

async function sample(settings: TerrainSettings, runtime: ExecutionRuntime, region: TerrainRequest['region'], field: boolean): Promise<TerrainData & { session: string }> {
  session ??= nativeSession();
  // Keep backend/display choices out of the native terrain cache key.
  const { seed, width, motifSize, relief, erosion, mountainMix, environment, zones, erosionTuning, sketch, source } = settings;
  const processing = sketch?.processing;
  const preparedSettings = { seed, width, motifSize, relief, erosion, mountainMix, environment, zones, erosionTuning,
    coastMask: processing ? 0 : settings.coastMask ?? 0, islandMode: settings.islandMode ?? 'island', source,
    ...(processing ? { sketch: { processing }, surface: Array.from(heightmapSurface(parseTerrainSketch(sketch))) } : {}) };
  const response = await nativeRequest(runtime, '/terrain', JSON.stringify({ session, settings: preparedSettings, region, field }));
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 4) throw new Error('Réponse terrain locale incomplète.');
  const headerLength = new DataView(buffer).getUint32(0, true);
  if (headerLength % 4 || 4 + headerLength > buffer.byteLength) throw new Error('En-tête terrain local invalide.');
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as NativeHeader;
  let offset = 4 + headerLength;
  const arrays: Record<string, Float32Array | Uint8Array> = {};
  for (const descriptor of meta.arrays) {
    const bytes = descriptor.count * (descriptor.type === 'f32' ? 4 : 1);
    if (!Number.isSafeInteger(descriptor.count) || descriptor.count < 0 || offset + bytes > buffer.byteLength) throw new Error('Raster terrain local incomplet.');
    arrays[descriptor.name] = descriptor.type === 'f32' ? new Float32Array(buffer, offset, descriptor.count) : new Uint8Array(buffer, offset, descriptor.count);
    offset += bytes;
  }
  const height = arrays.height as Float32Array;
  return { session: meta.session, x: meta.x, y: meta.y, width: meta.width, resolution: meta.resolution,
    minHeight: meta.minHeight, maxHeight: meta.maxHeight, globalMinHeight: meta.globalMinHeight, globalMaxHeight: meta.globalMaxHeight,
    motifSize: meta.motifSize, height, normalX: arrays.normalX as Float32Array, normalY: arrays.normalY as Float32Array,
    normalZ: arrays.normalZ as Float32Array, caveMask: arrays.caveMask as Uint8Array,
    prepareMs: meta.prepareMs, samplingMs: meta.samplingMs, generationMs: meta.prepareMs + meta.samplingMs,
    generationBackend: 'native', generationReason: meta.fieldExact ? 'Rust natif · surface physique conservée' : 'Rust natif · surface analytique échantillonnée à 1024²',
    backend: 'native', backendReason: 'Échantillonnage Rust natif sur le service local.', coastBackend: 'cpu', erosionDefaults: meta.erosionDefaults,
    ...(arrays.field ? { field: { n: meta.fieldN, data: arrays.field as Float32Array, exact: meta.fieldExact, floor: 0 } } : {}),
  };
}

/** Retained native regional sampler; no erosion or generation during camera moves. */
export function sampleNativeTerrain(request: TerrainRequest & { runtime?: ExecutionRuntime }): Promise<TerrainData> {
  if (request.runtime?.profile !== 'local') throw new Error('Le sampler natif requiert le profil local.');
  return sample(request.settings, request.runtime, request.region, request.kind === 'overview');
}

/** Native generation once, then the existing GPU/water chain consumes its metre field. */
export async function prepareNativeTerrain(settings: TerrainSettings, runtime: ExecutionRuntime): Promise<{
  height: Float32Array; prepareMs: number; samplingMs: number; session: string; fieldExact: boolean; erosionDefaults?: number[];
}> {
  const result = await sample(settings, runtime, { x: 0, y: 0, extent: settings.width, resolution: 64 }, true);
  if (!result.field || result.field.data.length !== 1024 * 1024) throw new Error('Surface native 1024² absente.');
  return { height: result.field.data, prepareMs: result.prepareMs ?? 0, samplingMs: result.samplingMs ?? 0,
    session: result.session, fieldExact: result.field.exact, erosionDefaults: result.erosionDefaults };
}
