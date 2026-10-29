// Compatibility exports for existing benchmarks and callers. Both presets use one scheduler.
import { generateGpuTerrain, erodeGpuCoast } from './terrainErosion';
import type { TerrainSettings } from './terrain';
export type { ErosionProfile } from './terrainErosion';
const compact = (settings: TerrainSettings): TerrainSettings => ({ ...settings, source: 'procedural-phasor', ...(settings.procedural ? { procedural: { ...settings.procedural, preset: 'compact' } } : {}) });
export const generateCompactTerrain: typeof generateGpuTerrain = (state, settings, timing, progress) => generateGpuTerrain(state, compact(settings), timing, progress);
export const erodeCompactCoast: typeof erodeGpuCoast = (state, settings, source, tuning, progress) => erodeGpuCoast(state, compact(settings), source, tuning, progress);
