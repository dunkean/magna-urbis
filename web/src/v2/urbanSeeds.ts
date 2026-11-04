import type { UrbanSeedStage, V2Settings } from './contracts';
import type { LayoutConfig } from '../../../rust/bridge/urbanConfig';
import type { Layout } from '../../../rust/bridge/urban';
import { readGenerationSeed, rerollSeed, seedRoot, setStepSeed, stepSeed, writeGenerationSeed } from '../../../rust/bridge/generationSeed';

export const URBAN_SEED_STAGES: readonly UrbanSeedStage[] = ['composition', 'streets', 'parcels', 'programme', 'buildings', 'houses'];

/** Keep the historical draw exactly when no independent city seed is set. */
export function urbanSeed(settings: V2Settings, key: string, stage?: UrbanSeedStage): string {
  const local = settings.urban?.local?.[key], global = settings.urban;
  const inherited = local?.seed ?? global?.seed ?? settings.local[key]?.seed ?? seedRoot(settings.options.seed);
  const base = stepSeed(settings.options.seed, `city/${key}/default`, stepSeed(settings.options.seed, 'city/*/default', inherited));
  return stage ? stepSeed(settings.options.seed, `city/${key}/${stage}`,
    stepSeed(settings.options.seed, `city/*/${stage}`, local?.seeds?.[stage] ?? global?.seeds?.[stage] ?? base)) : base;
}

/** Older projects kept city choices in sparse UI records. Move those choices into the portable general seed. */
export function migrateUrbanSeeds(settings: V2Settings): void {
  const parsed = readGenerationSeed(settings.options.seed);
  const globalDefault = settings.urban?.seed;
  const keep = (key: string, seed: string | undefined) => { if (seed !== undefined && parsed.variations[key] === undefined) parsed.variations[key] = seed; };
  keep('city/*/default', settings.urban?.seed);
  for (const [stage, seed] of Object.entries(settings.urban?.seeds ?? {})) keep(`city/*/${stage}`, seed);
  for (const [key, controls] of Object.entries(settings.urban?.local ?? {})) {
    keep(`city/${key}/default`, controls.seed);
    for (const [stage, seed] of Object.entries(controls.seeds ?? {})) keep(`city/${key}/${stage}`, seed);
    delete controls.seed; delete controls.seeds;
  }
  for (const [key, options] of Object.entries(settings.local)) { if (globalDefault === undefined) keep(`city/${key}/default`, options.seed); delete options.seed; }
  if (settings.urban) { delete settings.urban.seed; delete settings.urban.seeds; }
  settings.options.seed = writeGenerationSeed(parsed);
}

/** Each target owns its draw, so retrying a selection never changes its neighbours or upstream recipe. */
export function rerollUrbanSeeds(settings: V2Settings, keys: readonly string[], stage: UrbanSeedStage): void {
  if (!keys.length) return;
  migrateUrbanSeeds(settings);
  settings.options.seed = rerollSeed(settings.options.seed, keys.map(key => `city/${key}/${stage}`));
}

/** The editor shows effective values; sparse overrides remain an implementation detail. */
export function setUrbanSeed(settings: V2Settings, key: string, stage: UrbanSeedStage, seed: string): void {
  migrateUrbanSeeds(settings);
  settings.options.seed = setStepSeed(settings.options.seed, `city/${key}/${stage}`, seed);
}

/** Reuse the native quarter-edit splice: it freezes composition, outlines and main streets.
 * Only the random streams of interior cuts and closes receive a new salt. */
export function streetSeedConfig(config: LayoutConfig, composition: readonly Layout[], seed: string): LayoutConfig {
  const quarters = { ...config.overrides?.quarters };
  for (let i = 0; i < (composition[0]?.quarters.length ?? 0); i++) {
    const previous = quarters[String(i)];
    let hash = 2166136261;
    for (const char of `${seed}/${i}/${previous?.salt ?? 0}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    quarters[String(i)] = { ...previous, salt: (hash >>> 0) % 2147483647 + 1 };
  }
  return { ...config, overrides: { ...config.overrides, quarters } };
}
