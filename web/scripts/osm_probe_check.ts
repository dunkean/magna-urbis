// From web/: npx vite-node scripts/osm_probe_check.ts out/osm-probe/carcassonne.muproj
// Opens a .muproj with the V2 parser (parseProjectBinary: validateSettings + validateWorld), as the page does.
import { readFileSync } from 'node:fs';
import { parseProjectBinary } from '../src/v2/projectBinary';
const bytes = readFileSync(process.argv[2]);
const project = await parseProjectBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
console.log('parsed OK', project.engine, 'buildings', project.world?.urban?.buildings.length, 'extent', project.settings.extent);
