// npx tsx scripts/export_surface_world.ts INPUT.decor OUTPUT.json [--crop x,y,n]
// Crop indices retain actual source samples and source spacing, without interpolation.
import { readFile, writeFile } from 'node:fs/promises';
import { readDecorFile } from '../src/ui/decorFile';
import { exportSurfacePacket } from '../src/surface/adapters/export';
import type { Building3dScene } from '../src/render/urbanBuildingGeometry';
import { encodeSurfaceBinary } from '../src/surface/binary';
import { resolveSurfaceFrame } from '../src/surface/adapters/frame';
import { surfaceGeologyScenario, withSurfaceGeologyQuery } from '../src/surface/adapters/geology';

const [input, output, ...args] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: export_surface_world.ts INPUT.decor OUTPUT.json [--crop x,y,n] [--candidates all|centre] [--candidate-limit 100000] [--native-scene FILE.json] [--surface-geology tilted-strata-v1] [--surface-geology-descriptor FILE.json]');
const bytes = await readFile(input);
let decor = await readDecorFile(new Blob([new Uint8Array(bytes)]));
// Query opt-in remains part of the exported/shareable source recipe.
if (args.includes('--surface-geology') || args.includes('--surface-geology-descriptor')) {
  const params = new URLSearchParams(decor.meta.query);
  if (args.includes('--surface-geology')) params.set('surface_geology', args[args.indexOf('--surface-geology') + 1] ?? '');
  if (args.includes('--surface-geology-descriptor')) {
    const path = args[args.indexOf('--surface-geology-descriptor') + 1];
    if (!path) throw new Error('--surface-geology-descriptor requires a JSON file');
    params.set('surface_geology_descriptor', await readFile(path, 'utf8'));
  }
  const scenario = surfaceGeologyScenario(params);
  if (!scenario) throw new Error('Explicit CLI geology requires --surface-geology tilted-strata-v1');
  decor = { ...decor, meta: { ...decor.meta, query: withSurfaceGeologyQuery(params.toString(), scenario) } };
}
let originX = 0, originZ = 0;
const cropIndex = args.indexOf('--crop');
if (cropIndex >= 0) {
  const [x, y, n] = (args[cropIndex + 1] ?? '').split(',').map(Number), r = decor.raster;
  if (![x, y, n].every(Number.isInteger) || x < 0 || y < 0 || n < 3 || x + n > r.n || y + n > r.n)
    throw new Error('Invalid crop: expected source raster x,y,n.');
  // Do not shift city/vector source coordinates implicitly. Crop is deliberately
  // disallowed when source geometry would otherwise be silently misregistered.
  if (decor.meta.pipeline?.urban?.buildingState?.scene || decor.meta.pipeline?.urban?.buildingState?.cold)
    throw new Error('Crop mode only supports terrain captures without retained buildings.');
  const cut = <T extends Float32Array | Int32Array | Uint8Array>(values: T): T => {
    const result = new (values.constructor as { new(length: number): T })(n * n);
    for (let row = 0; row < n; row++) result.set(values.subarray((y + row) * r.n + x, (y + row) * r.n + x + n), row * n);
    return result;
  };
  const cell = r.width / r.n;
  const previousFrame=resolveSurfaceFrame(decor);
  originX = x * cell; originZ = y * cell;
  // Export full source geometry in metadata; compile crop using canonical origin.
  decor = { meta: structuredClone(decor.meta), raster: { ...r, n, width: n * cell,
    height: cut(r.height), water: cut(r.water), waterLevel: cut(r.waterLevel), riverWidth: cut(r.riverWidth), riverIds: cut(r.riverIds) } };
  const cropFrame={x:x*cell,y:y*cell,width:n*cell,sourceWidth:previousFrame.fullSource.widthM,coordinateFrame:previousFrame.geometrySourceOrigin.x===0 && previousFrame.geometrySourceOrigin.z===0 ? 'source-global' as const : 'retained-input' as const,
    sourceOriginX:previousFrame.terrainSourceOrigin.x+originX,sourceOriginZ:previousFrame.terrainSourceOrigin.z+originZ,
    geometryOriginX:previousFrame.geometrySourceOrigin.x,geometryOriginZ:previousFrame.geometrySourceOrigin.z};
  decor.meta.pipeline = { ...decor.meta.pipeline, stage: decor.meta.pipeline?.stage ?? 'terrain', crop:cropFrame };
}
const candidateMode = args[args.indexOf('--candidates') + 1] ?? 'centre';
if (args.includes('--candidates') && !['all', 'centre'].includes(candidateMode)) throw new Error('Candidates must be all or centre.');
const candidateLimit = args.includes('--candidate-limit') ? Number(args[args.indexOf('--candidate-limit') + 1]) : 100000;
if (!Number.isInteger(candidateLimit) || candidateLimit < 0) throw new Error('Candidate limit must be a nonnegative integer.');
const nativePath = args.includes('--native-scene') ? args[args.indexOf('--native-scene') + 1] : undefined;
const nativeScene = nativePath ? JSON.parse(await readFile(nativePath, 'utf8')) as Building3dScene : undefined;
const requestedFormat = args.includes('--format') ? args[args.indexOf('--format') + 1] : output.endsWith('.json') ? 'json' : 'binary';
if (!['json', 'binary'].includes(requestedFormat)) throw new Error('Format must be json or binary. Prefer binary for full-resolution worlds.');
const packet = exportSurfacePacket(decor, nativeScene, { candidateBounds: candidateMode === 'all' ? 'all' : undefined, candidateLimit, encoding: requestedFormat as 'json' | 'binary' });
if (nativePath) Object.assign(packet.source, { externalNativeScene: { file: nativePath, coordinates: 'unchanged source XY',
  relationshipToTerrain: 'Explicit external native-scene diagnostic. Matching terrain capture lineage is not asserted.' } });
const encoded = requestedFormat === 'binary' ? encodeSurfaceBinary(packet) : JSON.stringify(packet);
await writeFile(output, encoded);
const grid = packet.world.terrain;
console.log(JSON.stringify({ output, format: requestedFormat, bytes: typeof encoded === 'string' ? Buffer.byteLength(encoded) : encoded.byteLength,
  sourceId: decor.meta.id, sourceSeed: decor.meta.seed, terrain: { width: grid.width, height: grid.height,
    originX: grid.originX, originZ: grid.originZ, spacingM: grid.spacingM, source: grid.source }, buildings: packet.urban.buildings.length }));
