/** Offline display triangle inventory; never generates native architecture. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compactBuilding } from '../src/render/city3dMeshes.ts';
import { eachBuildingTriangle } from '../src/render/urbanBuildingGeometry.ts';
import { buildingFeatureLod } from '../src/render/urbanBuildingFeatureLod.ts';

const [folderArg, outputArg] = process.argv.slice(2);
assert(folderArg && outputArg, 'Usage: node --import tsx scripts/benchmark_building_feature_lod.mjs CORPUS_FOLDER NEW_REPORT.json');
const root = resolve(import.meta.dirname, '../..'), folder = resolve(root, folderArg);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const codeFiles = ['web/src/render/city3dMeshes.ts', 'web/src/render/urbanBuildingGeometry.ts',
  'web/src/render/urbanBuildingFeatureLod.ts'];
const code = Object.fromEntries(await Promise.all(codeFiles.map(async p => [p, hash(await readFile(resolve(root, p)))])));
const triangles = (building, overview, lod) => {
  let count = 0; eachBuildingTriangle(building, () => ++count, overview, lod); return count;
};
const scales = [.5, 1, 2, 4, 8, 16].map(metresPerPixel => ({ metresPerPixel, buildings: 0, triangles: 0, featureTriangles: 0 }));
const files = (await readdir(resolve(folder, 'after'))).filter(p => /^\d+-plans\.json$/.test(p)).sort();
const inputs = [], seen = new Set();
let overviewTriangles = 0, overviewFeatureTriangles = 0;
for (const file of files) {
  const bytes = await readFile(resolve(folder, 'after', file)), batch = JSON.parse(bytes.toString('utf8'));
  inputs.push({ file, sha256: hash(bytes), buildings: batch.buildings.length });
  for (const original of batch.buildings) {
    assert(!seen.has(original.id), `Duplicate ${original.id}`); seen.add(original.id);
    const building = compactBuilding(original), noFeatures = { ...building, structural_features: [] };
    const base = triangles(building, true), body = triangles(noFeatures, true);
    overviewTriangles += base; overviewFeatureTriangles += base - body;
    for (const row of scales) {
      const count = triangles(building, true, buildingFeatureLod(row.metresPerPixel, 1));
      ++row.buildings; row.triangles += count; row.featureTriangles += count - body;
    }
  }
}
for (const [p, sha] of Object.entries(code)) assert.equal(hash(await readFile(resolve(root, p))), sha, `Source changed: ${p}`);
for (const row of scales) row.featureReductionPercent = overviewFeatureTriangles ? 100 * (1 - row.featureTriangles / overviewFeatureTriangles) : 0;
const report = { version: 'building-feature-lod-display-inventory-1', corpus: folderArg,
  capturedUtc: new Date().toISOString(), code, inputs, buildings: seen.size,
  overviewTriangles, overviewFeatureTriangles, verticalExaggeration: 1, scales,
  scope: 'Exact current display mesh at explicit m/px contexts; all buildings counted, no camera/sector culling. No native generation, FPS, heap or GPU-residency claim. Retained physical plans are not altered.' };
await writeFile(resolve(root, outputArg), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ buildings: seen.size, overviewTriangles, overviewFeatureTriangles, scales }));
