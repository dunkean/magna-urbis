import catalogue from '../../../rust/crates/core/src/urban/catalogue.json';
import { contributorCultures } from '../gen/contributorCultures';

export interface UrbanCatalogue {
  fields: Record<'quarters' | 'parcels', string[]>;
  presets: Record<string, { label: string; params: Record<string, unknown> }>;
  cultures: Record<string, { label: string; recipes: { id: string; label: string; zone: string; preset: string }[] }>;
}

// Both city inspectors see the same contributed profiles and recipe choices.
const builtIn = catalogue as unknown as UrbanCatalogue;
export const cityCultureCatalogue: UrbanCatalogue = { ...builtIn, cultures: { ...builtIn.cultures }, presets: { ...builtIn.presets } };
for (const entry of contributorCultures) {
  const base = builtIn.cultures[entry.base];
  const recipes = base.recipes.map(recipe => {
    const preset = `${entry.id}/${recipe.id}`;
    cityCultureCatalogue.presets[preset] = builtIn.presets[entry.recipes?.[recipe.id] ?? recipe.preset];
    return { ...recipe, preset };
  });
  cityCultureCatalogue.cultures[entry.id] = { ...base, label: entry.label, recipes };
}
