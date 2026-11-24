/** Species of the drawn woods by biome and climate zone: one table for the paper ground's symbols (treeSymbols.ts) and the
 * overlay's crowns (cartography/forest.ts). */
import type { ClimateZone } from '../../../rust/bridge/terrainClimate';
import { biomeName } from '../gen/biomes';
import { mapZone } from './seasonPalette';

export interface TreeMix {
  /** Share of conifers; a broad noise mixes the stands at the transitions. */
  conifer: number;
  /** Share of palms among the other trees. */
  palm: number;
  /** Share of larches among the conifers: gold in autumn, bare in winter. */
  larch: number;
}
const BIOME: Partial<Record<string, Pick<TreeMix, 'conifer' | 'palm'>>> = {
  tundra: { conifer: 0.88, palm: 0 },
  forest: { conifer: 0.5, palm: 0 },
  steppe: { conifer: 0.3, palm: 0 },
  temperate: { conifer: 0.14, palm: 0 },
  tropical: { conifer: 0, palm: 0.28 },
  desert: { conifer: 0, palm: 0.55 },
};
/** Where the climate zone says more than the biome of its palette. */
const ZONE: Partial<Record<ClimateZone, Pick<TreeMix, 'conifer' | 'palm'>>> = {
  mediterranean: { conifer: 0.3, palm: 0.04 },
  continental: { conifer: 0.4, palm: 0 },
  nordic: { conifer: 0.78, palm: 0 },
  alpine: { conifer: 0.82, palm: 0 },
  arctic: { conifer: 0.9, palm: 0 },
  savanna: { conifer: 0, palm: 0.1 },
  wetland: { conifer: 0.08, palm: 0 },
};
export function treeMix(biome: string | undefined): TreeMix {
  const { zone, larch } = mapZone(),
    shares = (zone && ZONE[zone]) ?? BIOME[biomeName(biome)] ?? { conifer: 0, palm: 0 };
  return { ...shares, larch };
}
