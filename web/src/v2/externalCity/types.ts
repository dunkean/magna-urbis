import type { BiomeName } from '../../gen/biomes';
import type { CoastOpt, Relief, RiverOpt } from '../../gen/options';
import type { ClimateZone } from '../../../../rust/bridge/terrainClimate';

/**
 * A city described by another generator (watabou MFCG / village generator, Azgaar FMG burg),
 * reduced to the hints Magna Urbis can honour. Every field is optional: absent = keep the default.
 * Parsers fill it; `applyExternalCity` (./apply.ts) turns it into V2 settings.
 */
export interface ExternalCityHints {
  source: 'watabou-city' | 'watabou-village' | 'azgaar-burg';
  /** Stable seed text derived from the source (e.g. `mfcg-<seed>`); same input → same city. */
  seed: string;
  name?: string;
  /** Inhabitants, already scaled to real people. */
  population?: number;
  river?: RiverOpt;
  coast?: CoastOpt;
  walls?: boolean;
  /** Light wooden enclosure instead of a curtain wall (village `palisade` tag). */
  palisade?: boolean;
  citadel?: boolean;
  /** Citadel inside the town rather than at its edge (MFCG `urban_castle`). */
  urbanCastle?: boolean;
  plaza?: boolean;
  temple?: boolean;
  shantytown?: boolean;
  /** Regional road exits, 0 = isolated; undefined = automatic. */
  roads?: number;
  farms?: boolean;
  capital?: boolean;
  port?: boolean;
  /** 0.5 compact … 2 loose; 1 = the culture's baseline. */
  sprawl?: number;
  biome?: BiomeName;
  /** Magna Urbis climate zone (`terrain.climate`). */
  climateZone?: ClimateZone;
  /** Annual mean temperature brought to sea level, °C (the unit of `terrain.climateValues.temperature`). */
  temperature?: number;
  /** Annual precipitation, mm. */
  precipitation?: number;
  relief?: Relief;
  /** A Magna Urbis culture id from `cityCodeDefaults.json` `cultures`. */
  culture?: string;
  /** A Magna Urbis toponym language id. */
  language?: string;
}
