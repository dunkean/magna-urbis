// One-time data port: geometry and parameter application execute in Rust.
import { writeFileSync } from 'node:fs';
import { BENCH_PRESETS, BENCH_FIELDS, benchRecipes } from '../../web/src/gen/urban/testbenchConfig';
import { CULTURES } from '../../web/src/gen/urban/culture';
import { resolveMorph } from '../../web/src/gen/urban/morphology';

const presets = Object.fromEntries(Object.entries(BENCH_PRESETS).map(([id, p]) => [id, { label: p.label, params: resolveMorph(p.ref) }]));
const cultures = Object.fromEntries(Object.values(CULTURES).map(c => [c.id, { label: c.label, recipes: benchRecipes(c).map(r => ({ id: r.id, label: r.label, zone: r.zone, preset: `${c.id}/${r.id}` })) }]));
writeFileSync(new URL('../crates/core/src/urban/catalogue.json', import.meta.url), JSON.stringify({ version: 1, fields: { quarters: BENCH_FIELDS.streets, parcels: BENCH_FIELDS.plots }, presets, cultures }, null, 2) + '\n');
