// From web/: npx vite-node scripts/city_code_decode.mjs "<short city code or debug text>" | @<file holding it>
// (vite-node, not node: the code module graph imports CSS and JSON.)
// Prints the parsed code (seed, header, params, edits, pins) and the main decoded choices as JSON.
import { readFileSync } from 'node:fs';
import { parseCode, decodeCityCode, cityCodeFromInput } from '../src/v2/cityCode.ts';
const argument = process.argv.slice(2).join(' ').trim();
const text = argument.startsWith('@') ? readFileSync(argument.slice(1), 'utf8') : argument;
const { settings } = decodeCityCode(text);
const o = settings.options;
console.log(
  JSON.stringify(
    {
      code: parseCode(cityCodeFromInput(text.trim().split(/\r?\n/)[0])),
      seed: o.seed,
      biome: o.biome,
      culture: o.culture,
      cultureChosenBy: settings.region?.demography?.followCulture === false ? 'user' : 'environment',
      relief: settings.terrain?.relief ?? o.relief,
      extent: settings.extent,
      source: settings.runtime?.source,
      pins: settings.pins ?? [],
    },
    null,
    1,
  ),
);
