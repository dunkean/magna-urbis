// Dumps the Rust `site` test fixture from the TypeScript chooseSite: web/node_modules/.bin/tsx scripts/site_fixture.ts
import { writeFileSync } from 'node:fs';
import { Rng } from '../src/gen/core/rng';
import { terrainForExtent } from '../src/gen/terrain/hydrology';
import { chooseSite } from '../src/gen/site/site';
import { DEFAULTS } from '../src/gen/options';
import { encodeSiteRequest } from '../../rust/bridge/siteWire';

const extent = 1200, seed = 'c';
const base: any = { ...DEFAULTS, seed, size: 'town', relief: 'hills', coast: 'S', river: 'major' };
const { terrain } = terrainForExtent(base, extent, new Rng('magna-urbis:' + seed));
const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) s += a[i]; return s; };
const cases = [{}, { center: { x: 900, y: 300 } }].map(extra => {
  const opts = { ...base, ...extra };
  const root = new Rng('magna-urbis:' + seed);
  const t0 = performance.now();
  const site = chooseSite(terrain, opts, extent, root);
  const ms = performance.now() - t0;
  const f = site.fields;
  return { extra, ms, expected: {
    center: site.center, crossing: site.crossing ?? null, harbor: site.harbor ?? null, citadelSpot: site.citadelSpot ?? null,
    archetype: site.archetype, feature: site.feature ?? null, offers: site.offers, warning: site.warning ?? null,
    sums: { dWater: sum(f.dWater), dSea: sum(f.dSea), dMain: sum(f.dMain), hab: sum(f.hab), slopeS: sum(f.slopeS), cost: sum(site.cost.data),
      riverMask: sum(f.riverMask), bridgeZone: sum(f.bridgeZone), wide: sum(f.wide!) } } };
});
writeFileSync('../rust/crates/core/tests/fixtures/site_request.bin', encodeSiteRequest(terrain, { ...base }, extent, new Rng('magna-urbis:' + seed)));
writeFileSync('../rust/crates/core/tests/fixtures/site_expected.json', JSON.stringify({ n: terrain.height.w, cases: cases.map(c => ({ extra: c.extra, expected: c.expected })) }));
console.log(cases.map(c => `${c.expected.archetype} ${JSON.stringify(c.expected.center)} ${c.ms.toFixed(0)}ms warn=${c.expected.warning}`));
