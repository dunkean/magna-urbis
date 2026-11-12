import type { Vec2, Polyline } from '../core/geom';

/** Language families the toponym grammars cover. */
export type NameFamily =
  | 'french' | 'english' | 'german' | 'italian' | 'arabic' | 'chinese' | 'japanese'
  | 'sanskrit' | 'norse' | 'elven' | 'dwarven' | 'orcish' | 'halfling';

export const NAME_FAMILIES: NameFamily[] = [
  'french', 'english', 'german', 'italian', 'arabic', 'chinese', 'japanese',
  'sanskrit', 'norse', 'elven', 'dwarven', 'orcish', 'halfling',
];

export type NameKind =
  | 'town' | 'quarter' | 'street' | 'road' | 'square' | 'church' | 'castle' | 'gate'
  | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'village' | 'farm' | 'bridge' | 'building';

export type NameDisplayLanguage = 'fr' | 'en' | 'ja' | 'ar' | 'es' | 'pt' | 'zh' | 'ru';
export type NameSource = 'auto' | 'geographic' | 'invented' | 'mixed';
export interface NamingPolicy { profile?: string; source?: NameSource }
export interface NamingSettings extends NamingPolicy {
  title?: string;
  places?: Record<string, string>;
  mode?: 'cultural' | 'localized';
  /** Kept for import compatibility; mapLanguage is the explicit override. */
  displayLanguage?: NameDisplayLanguage;
  mapLanguage?: 'ui' | NameDisplayLanguage;
  script?: 'source' | 'latin';
  region?: NamingPolicy;
  local?: Record<string, NamingPolicy>;
  features?: Record<string, NamingPolicy>;
  variations?: Record<string, number>;
  labels?: Record<string, import('../../v2/mapLabels').LabelEdit>;
}
export interface NamePresentation { mode?: 'cultural' | 'localized'; language?: NameDisplayLanguage; script?: 'source' | 'latin' }
export interface NameMeaning { concept: string; qualifier?: string; viaGate?: boolean }
/** Decomposed at composition time, never by stripping words from a complete name. */
export interface NameParts {
  proper: string;
  cultural: string;
  kind: NameKind | 'region';
  generic?: 'mosque' | 'temple' | 'church' | 'cathedral' | 'monastery' | 'shrine' | 'tower';
  /** Imported full labels and fixed lexical names remain intact in every display mode. */
  opaque: boolean;
  meaning?: NameMeaning;
  /** Semantic role, independent of the engine's legacy French description. */
  role?: string;
  profile?: string;
  sourceMode?: string;
  diagnostic?: string;
  latin?: string;
}

export interface NameEntry {
  id: string;
  /** Stable identity of the feature, independent of label order and display text. */
  entityKey?: string;
  /** Migration of old n0/n1 edits; new edits always use id. */
  legacyId?: string;
  /** 0 = most important; 1 = smallest local detail. */
  detail?: number;
  policyKey?: string;
  cityKey?: string;
  parentKey?: string;
  canonicalText?: string;
  parts?: NameParts;
  /** Semantic destination: re-render this label when that place is renamed. */
  reference?: { key: string; family: NameFamily; culture?: string; language?: string; form: 'name' | 'castle' | 'road' | 'gate' | 'street' | 'gate-street' };
  /** Distinguishes generated site names from user-provided landmark names on a naming-only rebuild. */
  generated?: boolean;
  kind: NameKind;
  text: string;
  /** 0 = most important; used with the kind for collision priority. */
  rank: number;
  /** World anchor: point features, area label center, or the middle of a linear feature. */
  anchor: Vec2;
  /** Linear features (rivers, streets, roads): the text runs along this polyline. */
  path?: Polyline;
  /** Area features: approximate free width (m) around the anchor. */
  span?: number;
  /** Free-form tag, e.g. 'exit' for a village named at a regional road exit. */
  sub?: string;
  /** Optional author typography, shared by canvas and vector exports. */
  labelStyle?: { color?: string; size?: number; bold?: boolean; italic?: boolean };
  manual?: boolean;
  /** Original anchor of a separately drawn city label replaced by an author. */
  replacedAnchor?: Vec2;
}

export interface NamesLayer {
  nativeManaged?: boolean;
  /** Frozen generated names survive corpus updates until explicit regeneration. */
  bank?: Record<string, { parts: NameParts; policyKey?: string }>;
  family: NameFamily;
  presentation?: NamePresentation;
  regionParts?: NameParts;
  /** Regional profile defaults to the main settlement's culture; independent of the title. */
  region?: string;
  profile?: string;
  sourceMode?: 'country' | 'constructed' | 'generator';
  coherence?: 'modern-geographic' | 'fictional-phonotactic' | 'fantasy-generator';
  rootGrammar?: string;
  sourceCountry?: string;
  diagnostic?: string;
  algorithmVersion?: string;
  corpusVersion?: string;
  corpusFingerprint?: string;
  /** The town's own name (cartouche title). */
  town: string;
  entries: NameEntry[];
}
