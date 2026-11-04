/** A style supplies appearance; a layer supplies visible content. A diagnostic
 * visualizes retained computation data. A mask is input data, never a style. */
import type { HydrologyOverlay } from '../../../rust/bridge/hydrology';
export type VectorOverlay = 'none' | 'v-accumulation' | 'v-basins' | 'v-depth' | 'v-conditioning' | 'v-lakes' | 'v-styles';
export const VECTOR_OVERLAYS: VectorOverlay[] = ['v-accumulation', 'v-basins', 'v-depth', 'v-conditioning', 'v-lakes', 'v-styles'];
export const VECTOR_LEGENDS: Record<VectorOverlay, string> = {
  none: '',
  'v-accumulation': 'Drained area (weighted by runoff), logarithmic scale.',
  'v-basins': 'One color per outlet: sea, map edge or closed lake.',
  'v-depth': 'Depression filling: water height if every depression spilled, orange → red.',
  'v-conditioning': 'Pre-hydrology conditioning: blue = lowered terrain (sills, valleys), brown = filled terrain (sediment).',
  'v-lakes': 'Water balance: blue = spilling lake, purple = closed lake (evaporation equals inflow).',
  'v-styles': 'Channel styles: blue straight, red meandering, purple confluence links, orange braided, magenta anabranching, green delta.',
};
export const HYDROLOGY_LEGENDS: Record<HydrologyOverlay, string> = {
  none: 'Vector water: lakes and banks at their physical width.',
  basins: 'One color per watershed draining to the same outlet; transparent sea.',
  accumulation: 'Drained area: blue → turquoise → yellow → red, logarithmic scale in m².',
  flow: 'Downstream arrows; drainage is sampled to keep the map readable.',
  depressions: 'Depressions: difference between spill elevation and terrain, light blue → dark blue.',
  lakes: 'Retained lakes: depth below water level, light blue → dark blue.',
  channels: 'Graph: orange = main channel, blue = tributaries; downstream arrows, points = sources and connections.',
  'raw-basins': 'Raw drainage: watersheds before convergent routing across flat surfaces.',
  'raw-accumulation': 'Raw drainage: contributing area before convergent routing.',
  'raw-flow': 'Raw drainage: directions before convergent routing.',
  'raw-depressions': 'Depressions before treatment: difference between the raw spill elevation and initial physical height.',
  flats: 'One color per flat component; physical slopes remain transparent.',
  'flat-rank': 'Land rank before lake aggregation: blue near outlets, red at high ranks; no elevation added.',
};

/** Resource-model overlays (Rust `resources/`, activity sites): drawn from a lazily fetched payload, see render/resourceOverlay.ts. */
export type ResourceOverlay = 'res-geology' | 'res-soil-depth' | 'res-moisture' | 'res-drainage' | 'res-alluvial' | 'res-potential' | 'res-deposits' | 'res-sites';
export const RESOURCE_OVERLAYS: ResourceOverlay[] = ['res-geology', 'res-soil-depth', 'res-moisture', 'res-drainage', 'res-alluvial', 'res-potential', 'res-deposits', 'res-sites'];
export const RESOURCE_LEGENDS: Record<ResourceOverlay, string> = {
  'res-geology': 'Bedrock class: granite pink, limestone cream, sandstone ochre, marl olive, basalt dark grey, metamorphic violet, ultrabasic green, evaporite white-blue.',
  'res-soil-depth': 'Soil depth, 0 to 3 m: pale sand → dark brown.',
  'res-moisture': 'Soil moisture index, 0 to 1: sand → deep blue.',
  'res-drainage': 'Drainage class: very poor (dark blue), poor, moderate, well drained (sand).',
  'res-alluvial': 'Alluvial share of the soil, 0 to 1: transparent → ochre.',
  'res-potential': 'Resource potential 0 to 1 (pick the resource below): transparent → yellow → dark green.',
  'res-deposits': 'Small deposits (disc size = recoverable ore) and activity anchors (diamonds), coloured by family or kind.',
  'res-sites': 'Activity sites, coloured by category (extraction, energy, water, forest, pastoral), with a thin line to the parent settlement; network nodes (tolls, ferries, inns, border posts) as crimson circles; installations (quarry faces, heaps, weirs, piers, corrals…) outlined by ground kind.',
};
export type DiagnosticId = HydrologyOverlay | VectorOverlay | ResourceOverlay | 'elevation';
export const isResourceDiagnostic = (id: string | null | undefined): id is ResourceOverlay => !!id && id.startsWith('res-');
export interface DiagnosticDefinition {
  id: DiagnosticId; label: string; group: string; source: 'terrain' | 'rust' | 'vector' | 'resources' | 'none';
  composition: 'overlay' | 'replacement'; legend: string;
}
export const DIAGNOSTICS: DiagnosticDefinition[] = [
  { id: 'none', label: 'Aucun', group: '', source: 'none', composition: 'overlay', legend: '' },
  { id: 'elevation', label: 'Altitude · DEM', group: 'Terrain', source: 'terrain', composition: 'replacement', legend: 'Altitude en mètres. La plage globale reste identique au zoom et dans les portions.' },
  { id: 'v-accumulation', label: 'Accumulation', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-accumulation'] },
  { id: 'v-basins', label: 'Watersheds', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-basins'] },
  { id: 'v-depth', label: 'Depression filling', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-depth'] },
  { id: 'v-conditioning', label: 'Pre-hydrology conditioning', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-conditioning'] },
  { id: 'v-lakes', label: 'Lake water balance', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-lakes'] },
  { id: 'v-styles', label: 'Channel styles', group: 'Vector pipeline', source: 'vector', composition: 'overlay', legend: VECTOR_LEGENDS['v-styles'] },
  { id: 'res-geology', label: 'Géologie · roche', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-geology'] },
  { id: 'res-soil-depth', label: 'Sol · profondeur', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-soil-depth'] },
  { id: 'res-moisture', label: 'Sol · humidité', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-moisture'] },
  { id: 'res-drainage', label: 'Sol · drainage', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-drainage'] },
  { id: 'res-alluvial', label: 'Sol · alluvions', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-alluvial'] },
  { id: 'res-potential', label: 'Ressources · potentiel', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-potential'] },
  { id: 'res-deposits', label: 'Gisements et ancres', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-deposits'] },
  { id: 'res-sites', label: 'Sites d’activité', group: 'Resources', source: 'resources', composition: 'overlay', legend: RESOURCE_LEGENDS['res-sites'] },
  { id: 'basins', label: 'Watersheds', group: 'Rust · final network', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['basins'] },
  { id: 'accumulation', label: 'Accumulation', group: 'Rust · final network', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['accumulation'] },
  { id: 'flow', label: 'Flow', group: 'Rust · final network', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['flow'] },
  { id: 'channels', label: 'Network', group: 'Rust · final network', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['channels'] },
  { id: 'depressions', label: 'Depressions', group: 'Rust · terrain and processing', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['depressions'] },
  { id: 'lakes', label: 'Lakes', group: 'Rust · terrain and processing', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['lakes'] },
  { id: 'flats', label: 'Flat areas', group: 'Rust · terrain and processing', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['flats'] },
  { id: 'flat-rank', label: 'Flat-area ranks', group: 'Rust · terrain and processing', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['flat-rank'] },
  { id: 'raw-basins', label: 'Raw watersheds', group: 'Rust · initial drainage', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['raw-basins'] },
  { id: 'raw-accumulation', label: 'Raw accumulation', group: 'Rust · initial drainage', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['raw-accumulation'] },
  { id: 'raw-flow', label: 'Raw flow', group: 'Rust · initial drainage', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['raw-flow'] },
  { id: 'raw-depressions', label: 'Raw depressions', group: 'Rust · initial drainage', source: 'rust', composition: 'overlay', legend: HYDROLOGY_LEGENDS['raw-depressions'] },
].map(value => value as DiagnosticDefinition);
export const diagnosticDefinition = (id: string | null | undefined): DiagnosticDefinition => DIAGNOSTICS.find(d => d.id === id) ?? DIAGNOSTICS[0];
export function diagnosticAvailable(id: string, source: 'rust' | 'vector' | 'none'): boolean {
  const diagnostic = diagnosticDefinition(id);
  return diagnostic.source === 'none' || diagnostic.source === 'terrain' || diagnostic.source === 'resources' || diagnostic.source === source;
}
