// From web/: node scripts/city_code_decode.mjs "<MU3.… V2 city code>"
// Prints the raw recipe (seed, biome, culture, relief, extent, settings delta, variations, mods) as JSON.
import { tsImport } from 'tsx/esm/api';
import { readFileSync } from 'node:fs';
const m = await tsImport('../src/ui/recipeCodec.ts', import.meta.url);
const { decodeCompact } = m.decodeCompact ? m : m.default;
const defaults = JSON.parse(readFileSync(new URL('../src/v2/cityCodeDefaults.json', import.meta.url)));
const baseline = defaults.settings;
const code = process.argv.slice(2).join(' ').trim().replace(/\s/g, '');
const [root, choices, extent, saved = baseline, variations = {}, mods = []] = decodeCompact(code, ['', 0, baseline.extent, baseline, {}, []], 'MU3.');
console.log(JSON.stringify({ seed: root, biome: defaults.biomes[choices & 7], culture: defaults.cultures[(choices >>> 3) & 255],
  relief: defaults.reliefs[choices >>> 11], extent: extent === 0 ? 'auto' : extent, settings: saved, variations, mods }, null, 1));
