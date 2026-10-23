// npx tsx scripts/export_surface_world.ts INPUT.decor OUTPUT.json [--crop x,y,n]
// Crop indices retain actual source samples and source spacing, without interpolation.
import { readFile, writeFile } from 'node:fs/promises';
import { readDecorFile } from '../src/ui/decorFile';
import { exportSurfacePacket } from '../src/surface/adapters/export';

const [input, output, ...args] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: export_surface_world.ts INPUT.decor OUTPUT.json [--crop x,y,n]');
const bytes = await readFile(input);
let decor = await readDecorFile(new Blob([new Uint8Array(bytes)]));
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
  originX = x * cell; originZ = y * cell;
  // Export full source geometry in metadata; compile crop using canonical origin.
  decor = { meta: structuredClone(decor.meta), raster: { ...r, n, width: n * cell,
    height: cut(r.height), water: cut(r.water), waterLevel: cut(r.waterLevel), riverWidth: cut(r.riverWidth), riverIds: cut(r.riverIds) } };
  decor.meta.pipeline = { ...decor.meta.pipeline, stage: decor.meta.pipeline?.stage ?? 'terrain', crop: { x: x * cell, y: y * cell, width: n * cell, sourceWidth: r.width } };
}
const packet = exportSurfacePacket(decor, undefined, { originX, originZ });
await writeFile(output, JSON.stringify(packet));
console.log(JSON.stringify({ output, sourceId: decor.meta.id, sourceSeed: decor.meta.seed, terrain: packet.world.terrain,
  buildings: packet.urban.buildings.length }, (key, value) => key === 'heights' ? '[retained source samples]' : value));
