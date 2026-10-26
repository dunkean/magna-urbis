/** npx tsx scripts/import_regional_surface.ts REGION.surfacebin MAPPING.json OUTPUT.surfacebin
 * [--geology GEOLOGY.surfacebin] [--terrain PRIMARY.surfacebin] [--report REPORT.json] */
import { readFile, writeFile } from 'node:fs/promises';
import { decodeSurfaceBinary, encodeSurfaceBinary } from '../src/surface/binary';
import { deserializeRegionalPackage, validateRegionalPackage } from '../src/surface/adapters/neuralEarth';
import { compileRegionalSurfaceWorld, type RegionalSurfaceMapping } from '../src/surface/adapters/regionalCompiler';
import { validateSurfacePacket } from '../src/surface/packet';
import type { SurfaceWorld } from '../src/surface/model';

const [input, mappingPath, output, ...args] = process.argv.slice(2);
if (!input || !mappingPath || !output) throw new Error('Usage: import_regional_surface.ts REGION.surfacebin MAPPING.json OUTPUT.surfacebin [--geology GEOLOGY.surfacebin] [--terrain PRIMARY.surfacebin] [--report REPORT.json]');
const flag = (key: string) => { const index = args.indexOf(key); if (index < 0) return undefined; if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing ${key} value`); return args[index + 1]; };
async function readRegion(path: string) {
  const bytes = await readFile(path);
  const value = bytes.subarray(0, 8).toString() === 'MUFSURF1' ? decodeSurfaceBinary(new Uint8Array(bytes)) : deserializeRegionalPackage(bytes.toString('utf8'));
  validateRegionalPackage(value); return value;
}
const packet = await readRegion(input), mapping = JSON.parse(await readFile(mappingPath, 'utf8')) as RegionalSurfaceMapping;
const geologyPath = flag('--geology'), terrainPath = flag('--terrain');
const geologyPackage = geologyPath ? await readRegion(geologyPath) : undefined;
let primary: { world: SurfaceWorld } | undefined;
if (terrainPath) { const value = decodeSurfaceBinary(new Uint8Array(await readFile(terrainPath))); validateSurfacePacket(value); primary = value; }
const start = performance.now(), world = compileRegionalSurfaceWorld(packet, mapping, { geologyPackage, terrain: primary?.world.terrain });
const result = { format: 'magna-surface-packet', version: 1, world,
  source: { regional: world.regionalSource, primaryTerrain: terrainPath ? { file: terrainPath, frame: 'Explicit caller assertion: unchanged source coordinates use this regional package frame.' } : undefined } };
validateSurfacePacket(result);
const bytes = encodeSurfaceBinary(result); await writeFile(output, bytes);
const report = { input, mappingPath, geologyPath, terrainPath, output, elapsedMs: performance.now() - start, bytes: bytes.byteLength,
  source: world.terrain.source, provenance: world.regionalSource, diagnostics: world.diagnostics };
if (flag('--report')) await writeFile(flag('--report')!, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
