// From web/: node scripts/city_situation.mjs "<MU1.… code, or a link containing one>"
// Prints a City Bench situation (map, applied options, camera, pins, notes) as JSON,
// with the bench link that reopens it. Reproduce with screenshots at each pin:
//   node scripts/city_bench_check.mjs --situation "<code>" --out out/city-bench/<tag>
import { tsImport } from 'tsx/esm/api';

const text = process.argv.slice(2).join(' ');
if (!text) { console.error('usage: node scripts/city_situation.mjs <code>'); process.exit(1); }
const m = await tsImport('../src/ui/citySituation.ts', import.meta.url);
const { decodeSituation } = m.decodeSituation ? m : m.default;
const s = await decodeSituation(text);
const q = new URLSearchParams(s.q), parsed = {};
for (const [key, value] of q) { try { parsed[key] = JSON.parse(value); } catch { parsed[key] = value; } }
console.log(JSON.stringify({ ...s, query: parsed, bench: `http://127.0.0.1:5173/citybench.html?standalone=1&${s.q}` }, null, 1));
