/** One shareable seed records the base draw and every independent pipeline variation. */
export interface GenerationSeed { base: string; variations: Record<string, number | string> }
const prefix = 'MU2.';
export function readGenerationSeed(seed: string): GenerationSeed {
  if (seed.startsWith(prefix)) try {
    const bytes = Uint8Array.from(atob(seed.slice(prefix.length).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed.b === 'string' && parsed.v && typeof parsed.v === 'object' && !Array.isArray(parsed.v)
      && Object.keys(parsed.v).length <= 2000 && Object.entries(parsed.v).every(([key, value]) => key.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(key)
        && (typeof value === 'string' && value.length <= 4096 || Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff)))
      return { base: parsed.b, variations: parsed.v };
  } catch { /* An arbitrary user seed remains a literal seed. */ }
  return { base: seed, variations: {} };
}
export function writeGenerationSeed(value: GenerationSeed): string {
  const variations = Object.fromEntries(Object.entries(value.variations).filter(([, v]) => v !== 0 && v !== value.base).sort(([a], [b]) => a.localeCompare(b)));
  if (!Object.keys(variations).length) return value.base;
  const bytes = new TextEncoder().encode(JSON.stringify({ b: value.base, v: variations }));
  return prefix + btoa(Array.from(bytes, c => String.fromCharCode(c)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const seedRoot = (seed: string): string => readGenerationSeed(seed).base;
export function stepSeed(seed: string, step: string, fallback?: string): string {
  const parsed = readGenerationSeed(seed), variation = parsed.variations[step], base = fallback ?? parsed.base;
  return typeof variation === 'string' ? variation : variation ? `${base}\u0001${step}\u0001${variation}` : base;
}
export function rerollSeed(seed: string, steps: readonly string[]): string {
  const parsed = readGenerationSeed(seed);
  for (const step of new Set(steps)) {
    const previous = parsed.variations[step];
    parsed.variations[step] = typeof previous === 'number' && previous < 0xffffffff ? previous + 1 : 1;
  }
  return writeGenerationSeed(parsed);
}
export function setStepSeed(seed: string, step: string, value: string): string {
  const parsed = readGenerationSeed(seed); parsed.variations[step] = value;
  return writeGenerationSeed(parsed);
}
/** Cache keys depend on the relevant choices, never on variations of a different pipeline. */
export function seedSubset(seed: string, belongs: (key: string) => boolean): string {
  const parsed = readGenerationSeed(seed);
  return writeGenerationSeed({ base: parsed.base, variations: Object.fromEntries(Object.entries(parsed.variations).filter(([key]) => belongs(key))) });
}
