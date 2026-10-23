import type { Decor } from '../../ui/decor';
import { archiveSurfaceSource } from './sourceArchive';

/** Original hydrology and vector geography are source records, separate from the
 * physically resolved wet cells. Both offline and live consumers receive them.
 */
export function magnaSurfaceSource(decor: Decor, options: {
  encoding?: 'json' | 'binary'; cornerX?: number; cornerZ?: number; translationX?: number; translationZ?: number;
  sourceWaterValidation?: unknown; extra?: Record<string, unknown>;
} = {}) {
  const r = decor.raster, cell = r.width / r.n, x = options.cornerX ?? 0, z = options.cornerZ ?? 0;
  const binary = options.encoding === 'binary';
  const source = { meta: decor.meta, geometry: r.geometry,
    sourceToWorldTranslation: { x: options.translationX ?? 0, z: options.translationZ ?? 0 }, sourceWaterValidation: options.sourceWaterValidation,
    water: { n: r.n, width: r.width, originX: x + cell / 2, originZ: z + cell / 2, cornerX: x, cornerZ: z, originConvention: 'first-sample-centre' as const,
      classes: binary ? r.water : Array.from(r.water), levelM: binary ? r.waterLevel : Array.from(r.waterLevel),
      riverIds: binary ? r.riverIds : Array.from(r.riverIds), riverWidthM: binary ? r.riverWidth : Array.from(r.riverWidth) }, ...options.extra };
  return binary ? archiveSurfaceSource(source) : structuredClone(source);
}
