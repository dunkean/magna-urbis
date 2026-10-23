// Export a captured urban request and its exact decor raster for the Rust CLI
// `urban_case_replay`. No native server, network request or terrain regeneration.
// From web/: node scripts/urban_case_fixture.mjs decor-id quarters.json parcels.json out.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const [decorId, requestPath, parcelsPath, outputPath] = process.argv.slice(2);
if (!outputPath || !/^[a-z0-9-]+$/.test(decorId)) throw new Error('Expected decor-id quarters.json parcels.json out.json');
const module = await tsImport('../src/ui/decor.ts', import.meta.url);
const { decodeDecor } = module.decodeDecor ? module : module.default;
const decorBytes = readFileSync(`decors/${decorId}.decor`), requestBytes = readFileSync(requestPath);
const request = JSON.parse(requestBytes), parcels = JSON.parse(readFileSync(parcelsPath));
const { raster: r } = decodeDecor(new Uint8Array(decorBytes));
const fixture = { ...request, parcelConfig: parcels.parcelConfig ?? {}, width: r.width, n: r.n,
  height: Array.from(r.height), water: Array.from(r.water), waterLevel: Array.from(r.waterLevel),
  geometry: r.geometry,
  fixtureProvenance: { decorId, requestPath: resolve(requestPath),
    requestSha256: createHash('sha256').update(requestBytes).digest('hex'),
    decorSha256: createHash('sha256').update(decorBytes).digest('hex') } };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(fixture));
console.log(JSON.stringify({ outputPath, width: r.width, n: r.n, sites: request.sites, seed: request.seed }));
