import type { TerrainSettings } from './terrain';

/** Physical source definition. Overview pixels and camera LOD never select it. */
export const DEFAULT_SAMPLE_SPACING = 30;
export const MAX_SOURCE_RESOLUTION = 8192;
export const MAX_SOURCE_WORKING_BYTES = 1536 * 1024 * 1024;
export const NEURAL_NATIVE_SPACING = 30;
export interface TerrainCapability {
  minWidth: number; maxWidth: number; minSpacing: number;
  kind: 'procedural' | 'neural' | 'finite-neural' | 'imported' | 'classic';
}
type DefinitionInput = Pick<TerrainSettings, 'width' | 'source' | 'baseModel' | 'sketch' | 'sourceNativeResolution'> & { sampleSpacing?: number };
export interface SourceDefinition extends TerrainCapability {
  width: number; n: number; spacing: number; requestedSpacing: number;
  /** Metres per cell of the effective hydraulic erosion grid, when used. */
  erosionSpacing?: number;
  /** Metres per cell of regional erosion, including its geographic margin. */
  regionalErosionSpacing?: number;
  nativeSpacing?: number; sourceBytes: number; estimatedWorkingBytes: number;
}

export function terrainCapability(input: { source?: string; baseModel?: string; sketch?: TerrainSettings['sketch']; backend?: string; sourceNativeResolution?: number }): TerrainCapability {
  if (input.backend === 'typescript') return { kind: 'classic', minWidth: 600, maxWidth: 40000, minSpacing: 1 };
  if (input.sketch?.processing || input.sourceNativeResolution) {
    const nativeN = input.sketch?.processing === 'surface' ? input.sketch.resolution : input.sourceNativeResolution;
    return { kind: 'imported', minWidth: 500, maxWidth: nativeN ? Math.min(100000, nativeN * 1000) : 100000, minSpacing: 1 };
  }
  const neural = ['neural', 'neural-python', 'neural-wasm'].includes(input.source ?? 'procedural');
  if (!neural) return { kind: 'procedural', minWidth: 500, maxWidth: 100000, minSpacing: 1 };
  if (input.source === 'neural-python' && input.baseModel === 'residual8k')
    return { kind: 'finite-neural', minWidth: 40000, maxWidth: 40000, minSpacing: 40000 / 1024 };
  return { kind: 'neural', minWidth: 500, maxWidth: 200000, minSpacing: NEURAL_NATIVE_SPACING };
}

/** An explicit procedural GPU request cannot generate a non-1024 source; imports and painted zones use another path. */
export function unsupportedExplicitGpuResolution(settings: Pick<TerrainSettings, 'source' | 'generationCompute' | 'sketch' | 'zones'>, n: number): boolean {
  return n !== 1024 && !!settings.generationCompute && ['gpu', 'gpu-all', 'gpu-erosion'].includes(settings.generationCompute)
    && !settings.sketch && !settings.zones && terrainCapability(settings).kind === 'procedural';
}

/** Imports preserve available detail up to a practical default of 4096 samples per side. */
export function defaultSourceSpacing(settings: DefinitionInput): number {
  const capability = terrainCapability(settings);
  const nativeN = settings.sketch?.processing === 'surface' ? settings.sketch.resolution : settings.sourceNativeResolution;
  return nativeN ? Math.max(capability.minSpacing, settings.width / nativeN, settings.width / 4096)
    : Math.max(DEFAULT_SAMPLE_SPACING, capability.minSpacing);
}

/** Validate before allocating any physical source or starting model inference. */
export function sourceDefinition(settings: DefinitionInput): SourceDefinition {
  const capability = terrainCapability(settings), width = settings.width;
  if (!Number.isFinite(width) || width < capability.minWidth || width > capability.maxWidth)
    throw new Error(`Terrain ${capability.kind}: largeur ${capability.minWidth}–${capability.maxWidth} m requise.`);
  const importedN = settings.sketch?.processing === 'surface' ? settings.sketch.resolution : settings.sourceNativeResolution;
  if (importedN !== undefined && (!Number.isSafeInteger(importedN) || importedN < 16 || importedN > MAX_SOURCE_RESOLUTION))
    throw new Error('Heightmap: définition native 16–8192 requise pour les villes.');
  const requestedSpacing = settings.sampleSpacing ?? defaultSourceSpacing(settings);
  if (capability.kind === 'finite-neural' && requestedSpacing !== capability.minSpacing)
    throw new Error(`Tile40: définition de sortie fixe ${capability.minSpacing} m (1024²).`);
  const maxSpacing = Math.min(1000, width / 16);
  if (!Number.isFinite(requestedSpacing) || requestedSpacing < capability.minSpacing || requestedSpacing > maxSpacing)
    throw new Error(`Terrain ${capability.kind}: pas de génération ${capability.minSpacing}–${maxSpacing} m requis.`);
  const nativeSpacing = capability.kind.includes('neural') ? NEURAL_NATIVE_SPACING : importedN ? width / importedN : undefined;
  if (importedN && requestedSpacing < width / importedN)
    throw new Error(`Heightmap: définition native ${(width / importedN).toFixed(2)} m ; un pas inférieur ne crée pas de détail.`);
  const n = importedN ? Math.min(importedN, Math.max(2, Math.ceil(width / requestedSpacing)))
    : capability.kind === 'finite-neural' ? 1024 : Math.max(2, Math.ceil(width / requestedSpacing));
  if (!Number.isSafeInteger(n) || n < 16 || n > MAX_SOURCE_RESOLUTION)
    throw new Error(`Terrain: ${n}² échantillons demandés ; maximum ${MAX_SOURCE_RESOLUTION}². Augmentez le pas de génération.`);
  const sourceBytes = n * n * 4;
  // Conservative CPU raster estimate, excluding model weights/activations and renderer caches.
  const estimatedWorkingBytes = n * n * (capability.kind.includes('neural') ? 32 : 96);
  if (estimatedWorkingBytes > MAX_SOURCE_WORKING_BYTES)
    throw new Error(`Terrain: budget des rasters dépassé (${Math.ceil(estimatedWorkingBytes / 1048576)} Mio estimés). Augmentez le pas de génération.`);
  return { ...capability, width, n, spacing: width / n, requestedSpacing, nativeSpacing, sourceBytes, estimatedWorkingBytes };
}
