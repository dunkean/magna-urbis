import type { ExplicitSurfaceLayerFields, SurfaceFields, SurfaceLayerMetadata, SurfaceLayerSample } from './model';
import { fingerprint } from './hash';

export const SURFACE_LAYERS_VERSION = 'surface-layers-1' as const;
export const SURFACE_LAYER_SHORT_FIELDS = ['groundMaterial','groundMaterialSecondary','lowCoverMaterial','lowCoverMaterialSecondary'] as const;
export const SURFACE_LAYER_FLOAT_FIELDS = ['groundMaterialBlend','lowCoverMaterialBlend','lowCoverOpacity'] as const;
export const SURFACE_LAYER_MEAN_FIELDS = ['groundMaterialMeanColor','lowCoverMaterialMeanColor'] as const;
export const SURFACE_LAYER_FIELDS = [...SURFACE_LAYER_SHORT_FIELDS,...SURFACE_LAYER_FLOAT_FIELDS,...SURFACE_LAYER_MEAN_FIELDS] as const;
export const SURFACE_LAYER_BYTES_PER_SAMPLE = 28;
export const LEGACY_SURFACE_LAYERS_WARNING = 'Legacy composite-only packet: bare ground and low-cover layers are unavailable; the legacy material pair already mixes soil, litter and herbs and cannot be unmixed.';

export function hasExplicitSurfaceLayers(fields: SurfaceFields): fields is SurfaceFields & ExplicitSurfaceLayerFields {
  return SURFACE_LAYER_FIELDS.every(key=>fields[key]!==undefined);
}
export function surfaceLayerFieldsVersion(fields: SurfaceFields): string | undefined {
  return hasExplicitSurfaceLayers(fields)?fingerprint([SURFACE_LAYERS_VERSION,...SURFACE_LAYER_FIELDS.map(key=>fields[key])]):undefined;
}
export function surfaceLayerMetadata(fields: SurfaceFields): SurfaceLayerMetadata {
  const fieldsVersion=surfaceLayerFieldsVersion(fields);
  return fieldsVersion ? {version:SURFACE_LAYERS_VERSION,groundAvailability:'explicit',lowCoverAvailability:'explicit',fieldsVersion}
    : {version:SURFACE_LAYERS_VERSION,groundAvailability:'legacy-composite-unavailable',lowCoverAvailability:'legacy-composite-unavailable'};
}
/** A renderer/mapper visibility selection, not a physical-context edit. Canopy
 * colours, footprints and residual optical coverage belong to the renderer. */
export function selectSurfaceLayerView(sample: SurfaceLayerSample, visible: {lowCover?:boolean;trees?:boolean} = {}): SurfaceLayerSample {
  return {...sample,lowCover:sample.lowCover?{...sample.lowCover,opacity:visible.lowCover===false?0:sample.lowCover.opacity}:undefined,
    trees:{...sample.trees,crownCover:visible.trees===false?0:sample.trees.crownCover}};
}
