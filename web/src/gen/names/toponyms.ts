// Countries reachable by a profile only (scripts/names_runtime_pack.ts); the full corpus stays the source.
import pack from './data/names-pack-runtime.json';
import manifest from './data/names-manifest.json';
import { Rng } from '../core/rng';
import authored from './data/cultural-roots.json';
import { resolveToponymProfile, type ToponymProfile, type ToponymSourceMode, type ToponymCoherence } from './profiles';
import { formatToponym, type ToponymForm } from './syntax';
import type { NameSource } from './types';
import { authoredProper } from './roots';

export const ALGORITHM_VERSION = '3';
export const CORPUS_VERSION = `${pack.version}/${authored.version}`;
export const BASE_CORPUS_SHA256 = manifest.artifact.sha256;
/** SHA-256 of the exact authored JSON bytes; checked against the source file in corpus-quality tests. */
export const AUTHORED_CORPUS_SHA256 = '72fa7b7d7ed46a85b6cad23ec6ed6f11679529535e4d27742840815e2914022b';
/** SHA-256 of BASE_CORPUS_SHA256 + ':' + AUTHORED_CORPUS_SHA256. */
export const CORPUS_FINGERPRINT = 'bae38bc101a567e331ba69fa94621e1fd6b9a6305880930d2708256e52a5975d';
export const CORPUS_SHA256 = CORPUS_FINGERPRINT;
export type ToponymKind = 'place' | 'town' | 'city' | 'village' | 'hamlet' | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'region' | 'farm';
export interface ToponymContext { seed: string | number; key: string; kind: ToponymKind; culture: string; language?: string; source?: NameSource }
type Country = { settlements: string[]; water: string[]; lakes: string[]; relief: string[]; regions: string[] };
type Generator = { pattern: { variants: Array<{ concat: string[]; space?: boolean; space_pos?: number }> }; arrays: Record<string, string[]> };
const countries: Record<string, Country> = pack.countries;
const generators: Record<string, Generator> = pack.generators;
type RootKind = 'habitation' | 'river' | 'lake' | 'sea' | 'forest' | 'hill' | 'region' | 'farm';
const SETTLEMENT_KINDS = new Set<ToponymKind>(['place', 'town', 'city', 'village', 'hamlet']);

/** Names retain their original proper string independently of display-language descriptors. */
export interface ToponymRecord {
  proper: string;
  cultural: string;
  kind: ToponymKind;
  opaque: boolean;
  profile: string;
  sourceMode: ToponymSourceMode;
  coherence: ToponymCoherence;
  diagnostic?: string;
  /** Exact original entry, when this record comes from the geographic corpus. */
  corpusLabel?: string;
}

// Reviewed standalone descriptors only. These rules annotate, never strip, a source label.
// Bound morphology (Walmerbach, TsingTao) stays inside the unchanged proper name.
const DESCRIPTORS: Record<Exclude<RootKind, 'habitation'>, RegExp> = {
  river: /(?:^|[\s,()\-])(?:river|creek|brook|stream|burn|beck|rivière|riviere|fleuve|ruisseau|ru|canal|oued|wadi|nahr|rud|rūd|gawa|kawa|he|jiang|río|rio|ribeira|arroyo|fluss|flus|reka|rzeka)(?:$|[\s,()\-])/iu,
  lake: /(?:^|[\s,()\-])(?:lake|loch|lough|mere|pond|reservoir|lac|étang|etang|mare|see|gölü|golu|gol|ko|ike|hu|lago|laguna|lagune|jezioro|jezero|ozero)(?:$|[\s,()\-])/iu,
  sea: /(?:^|[\s,()\-])(?:sea|ocean|mer|meer|mar|bahr|denizi|hai|kai)(?:$|[\s,()\-])/iu,
  forest: /(?:^|[\s,()\-])(?:forest|woods?|grove|forêt|foret|bois|wald|mori|bosco|orman)(?:$|[\s,()\-])/iu,
  hill: /(?:^|[\s,()\-])(?:mount|mountain|mountains|hill|hills|peak|ridge|valley|mont|montagne|pic|col|berg|gebirge|yama|san|shan|jabal|djebel|kuh|kūh|cerro|sierra|monte|planina)(?:$|[\s,()\-])/iu,
  region: /(?:^|[\s,()\-])(?:region|région|county|district|province|provincia|département|departement|municipality|commune|oblasti?|rayon|raion|prefecture|préfecture)(?:$|[\s,()\-])/iu,
  farm: /(?:^|[\s,()\-])(?:farm|ferme|hof|podere|finca|granja)(?:$|[\s,()\-])/iu,
};

/** Conservative source annotation for partial translation; original text is never parsed apart. */
export function isOpaqueCorpusLabel(kind: ToponymKind, name: string): boolean {
  if (SETTLEMENT_KINDS.has(kind)) return true;
  return DESCRIPTORS[kind as Exclude<RootKind, 'habitation'>].test(name);
}

/** Evaluate only the exported concatenation format; missing arrays invalidate a variant. */
export function readGenerator(generator: Generator | undefined, rng: Rng): string | undefined {
  if (!generator || !Array.isArray(generator.pattern?.variants)) return undefined;
  const valid = generator.pattern.variants.filter(v => Array.isArray(v.concat) && v.concat.length > 0 && v.concat.every(k => Array.isArray(generator.arrays[k]) && generator.arrays[k].length > 0));
  if (!valid.length) return undefined;
  const variant = rng.fork('variant').pick(valid);
  const parts = variant.concat.map((key, i) => rng.fork(`part:${i}`).pick(generator.arrays[key]));
  const pos = variant.space_pos ?? 0;
  const result = variant.space && pos > 0 && pos < parts.length ? `${parts.slice(0, pos).join('')} ${parts.slice(pos).join('')}` : parts.join('');
  const trimmed = result.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : undefined;
}

/** Stable per-feature stream: adding or reordering other entities does not rename this one. */
export function generateToponymRecord(context: ToponymContext): ToponymRecord {
  const { culture, language, kind, key } = context;
  const seed = String(context.seed);
  const selected = resolveToponymProfile(culture, language, seed);
  const profile = { ...selected };
  const source = context.source ?? 'auto';
  const r = new Rng(seed).fork(`toponym:${ALGORITHM_VERSION}`).fork(profile.id).fork(kind).fork(key);
  if (source === 'invented' || source === 'mixed' && r.fork('source').chance(.5)) profile.sourceMode = profile.generator ? 'generator' : 'constructed';
  if (source === 'geographic' || source === 'mixed' && profile.sourceMode !== 'constructed') {
    if (profile.country) profile.sourceMode = 'country';
    else profile.diagnostic = `No geographic corpus for ${profile.id}; using its invented names`;
  }
  const record = (proper: string, cultural: string, opaque: boolean, sourceMode: ToponymSourceMode,
    coherence: ToponymCoherence, corpusLabel?: string): ToponymRecord =>
    ({ proper, cultural, kind, opaque, profile: profile.id, sourceMode, coherence, ...(profile.diagnostic ? { diagnostic: profile.diagnostic } : {}), ...(corpusLabel === undefined ? {} : { corpusLabel }) });
  const settlement = SETTLEMENT_KINDS.has(kind);
  if (profile.sourceMode === 'country' && profile.country) {
    const country = countries[profile.country];
    const pool = settlement ? country?.settlements : kind === 'river' ? country?.water
      : kind === 'lake' ? country?.lakes : kind === 'hill' ? country?.relief
      : kind === 'region' ? country?.regions : undefined;
    if (pool?.length) {
      const name = r.fork(`geographic:${kind}`).pick(pool);
      return record(name, name, isOpaqueCorpusLabel(kind, name), 'country', 'modern-geographic', name);
    }
  }
  if (settlement && profile.sourceMode === 'generator' && profile.generator) {
    const name = readGenerator(generators[profile.generator], r.fork('settlement-generator'));
    if (name) return record(name, name, false, 'generator', 'fantasy-generator');
  }
  // Complete English feature generators have no semantic boundaries. Typed roots
  // keep the cultural generic localizable without parsing their output.
  const root = authoredProper(profile, kind, r.fork('authored-root'));
  const cultural = settlement ? root.proper : root.template
    ? root.template.replace('{proper}', root.proper)
    : formatToponym(profile, kind as ToponymForm, root.proper);
  return record(root.proper, cultural, false, 'constructed', 'fictional-phonotactic');
}

/** Cultural spelling convenience API; display language belongs to a separate presentation layer. */
export function generateToponym(context: ToponymContext): string {
  return generateToponymRecord(context).cultural;
}
