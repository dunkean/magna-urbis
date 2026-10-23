import type { Decor } from '../../ui/decor';
import { archiveSurfaceSource } from './sourceArchive';
import { registrationFieldFingerprint } from '../registrationBinding';
import { resolveSurfaceFrame } from './frame';

/** Original hydrology and vector geography are source records, separate from the
 * physically resolved wet cells. Both offline and live consumers receive them.
 */
export function magnaSurfaceSource(decor: Decor, options: {
  encoding?: 'json' | 'binary'; cornerX?: number; cornerZ?: number; translationX?: number; translationZ?: number;
  sourceWaterValidation?: unknown; extra?: Record<string, unknown>;
} = {}) {
  const r = decor.raster, cell = r.width / r.n, x = options.cornerX ?? 0, z = options.cornerZ ?? 0;
  const binary = options.encoding === 'binary';
  const source = { meta: decor.meta, geometry: r.geometry, frame:resolveSurfaceFrame(decor),
    retainedField:{format:'surface-retained-field' as const,version:1 as const,n:r.n,widthM:r.width,fingerprint:registrationFieldFingerprint({n:r.n,width:r.width,data:r.height})},
    sourceToWorldTranslation: { x: options.translationX ?? 0, z: options.translationZ ?? 0 }, sourceWaterValidation: options.sourceWaterValidation,
    hydrology: { authority: 'retained-magna-water-network', geometryReference: 'source.geometry', vectorSvgReference: 'source.meta.waterSvg',
      originalRasterReference: 'source.water', rawClassEncoding: { dry: 0, ocean: 1, lake: 2, riverSafetyEnvelope: 3 },
      compiledClassEncoding: { dry: 0, river: 1, lake: 2, ocean: 3 },
      contextualWetPolicy: 'positive-depth-only-1mm', derivedRoutingRole: 'soil-HAND-TWI diagnostics only; never a replacement river network',
      sourceReceiverAvailability: 'not retained in DECOR; no observed downstream topology asserted' },
    water: { classEncoding: 'magna-0dry-1sea-2lake-3river-safety-envelope' as const, n: r.n, width: r.width, originX: x + cell / 2, originZ: z + cell / 2, cornerX: x, cornerZ: z, originConvention: 'first-sample-centre' as const,
      classes: binary ? r.water : Array.from(r.water), levelM: binary ? r.waterLevel : Array.from(r.waterLevel),
      riverIds: binary ? r.riverIds : Array.from(r.riverIds), riverWidthM: binary ? r.riverWidth : Array.from(r.riverWidth) }, ...options.extra };
  return binary ? archiveSurfaceSource(source) : structuredClone(source);
}
