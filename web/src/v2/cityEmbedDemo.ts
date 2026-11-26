/** cityEmbed's demonstration profiles: randomize coherent city inputs while keeping every result shareable as an FMG-style URL. */
import { cityEmbedHints, cityEmbedSource } from './cityEmbedInput';

const profiles = [
  { base: 'English', type: 'Generic', name: 'Brackenford', biome: 'Temperate deciduous forest', temperature: 12, rain: 900, elevation: 120, min: 500, max: 12000 },
  { base: 'Nordic', type: 'Naval', name: 'Kaldvik', biome: 'Taiga', temperature: 3, rain: 800, elevation: 40, min: 150, max: 5000 },
  { base: 'Arabic', type: 'Generic', name: 'Qalat Safra', biome: 'Hot desert', temperature: 28, rain: 150, elevation: 350, min: 800, max: 14000 },
  { base: 'Chinese', type: 'River', name: 'Longxi', biome: 'Temperate deciduous forest', temperature: 18, rain: 1400, elevation: 80, min: 1500, max: 16000 },
  { base: 'Mongolian', type: 'Nomadic', name: 'Karak Ordu', biome: 'Grassland', temperature: 8, rain: 350, elevation: 900, min: 150, max: 3000 },
  { base: 'Italian', type: 'Naval', name: 'Porto Selva', biome: 'Temperate deciduous forest', temperature: 19, rain: 650, elevation: 30, min: 1200, max: 14000 },
  { base: 'Japanese', type: 'Highland', name: 'Takayama', biome: 'Temperate rainforest', temperature: 9, rain: 1800, elevation: 1200, min: 400, max: 8000 },
  { base: 'Elven', type: 'Hunting', name: 'Aelindor', biome: 'Temperate deciduous forest', temperature: 14, rain: 1200, elevation: 300, min: 250, max: 5000 },
] as const;

export function randomCityEmbedUrl(current: URL, random: () => number = Math.random): URL {
  // Change the cultural profile on every click, in addition to the seed and all geographic/feature flags.
  const previous = current.searchParams.get('cultureBase');
  const choices = profiles.filter(profile => profile.base !== previous);
  const profile = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
  const coast = profile.type === 'Naval' || (profile.type !== 'Nomadic' && random() < 0.3);
  const river = profile.type === 'River' || random() < 0.45;
  const population = Math.round(Math.exp(Math.log(profile.min) + random() * Math.log(profile.max / profile.min)) / 50) * 50;
  const flag = (chance: number) => (random() < chance ? '1' : '0');
  const url = new URL(current.pathname, current);
  url.search = new URLSearchParams({
    preview: '1',
    demo: '1',
    name: profile.name,
    population: String(population),
    seed: String(Math.floor(random() * 0x100000000)),
    cultureBase: profile.base,
    cultureType: profile.type,
    biome: profile.biome,
    temperature: String(profile.temperature),
    precipitation: String(profile.rain),
    elevation: String(profile.elevation),
    coast: coast ? '1' : '0',
    sea: String(Math.floor(random() * 4) / 2),
    river: river ? '1' : '0',
    port: coast ? '1' : '0',
    walls: profile.type === 'Nomadic' || profile.type === 'Hunting' ? '0' : flag(0.65),
    citadel: flag(0.5),
    capital: flag(0.25),
    temple: flag(0.5),
    plaza: flag(0.65),
    shantytown: flag(0.35),
    hub: flag(0.6),
    farms: flag(0.7),
  }).toString();
  const language = current.searchParams.get('lang');
  if (language) url.searchParams.set('lang', language);
  if (current.searchParams.get('profile') === 'local') url.searchParams.set('profile', 'local');
  if (current.searchParams.get('threads') === 'off') url.searchParams.set('threads', 'off');
  return url;
}

/** Change the effective population and preserve the rest of the burg URL. */
export function cityEmbedPopulationUrl(current: URL, population: number): URL {
  const next = new URL(current);
  const fragment = new URLSearchParams(next.hash.slice(1));
  const burg = fragment.get('burg');
  if (burg === null) {
    if (!next.searchParams.get('seed')?.trim()) {
      // The Watabou importer derives a seed from the original query when none is supplied.
      const { seed } = cityEmbedHints(cityEmbedSource(current));
      next.searchParams.set('seed', seed.slice('mfcg-'.length));
    }
    next.searchParams.set('population', String(population));
  } else {
    fragment.set('burg', JSON.stringify({ ...JSON.parse(burg), population }));
    next.hash = fragment.toString();
  }
  return next;
}

export function mountCityEmbedPopulation(current: URL, population: number): void {
  const form = document.querySelector<HTMLFormElement>('#population-form')!;
  const field = form.querySelector<HTMLInputElement>('#preview-population')!;
  const initial = Math.min(Number(field.max), Math.max(Number(field.min), population));
  field.value = String(initial);
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.reportValidity() || field.valueAsNumber === initial) return;
    const next = cityEmbedPopulationUrl(current, field.valueAsNumber);
    if (next.search !== current.search) location.assign(next);
    else {
      // A change confined to the rich burg fragment would only navigate within the page.
      history.replaceState(history.state, '', next);
      location.reload();
    }
  };
}
