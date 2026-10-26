/** Rebuild the shared native/local style catalogue from Magna's canonical map tokens. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PALETTES } from '../src/render/styles';
import { TERRAIN_STYLE_LIST, terrainStyle } from '../src/render/terrainStyle';
const sourceFilesSha256: Record<string,string> = {};
for (const file of ['styles.ts','waterStyle.ts','terrainStyle.ts']) sourceFilesSha256[`web/src/render/${file}`] = createHash('sha256').update((await readFile(new URL(`../src/render/${file}`,import.meta.url),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
const terrainStyles = Object.fromEntries([...TERRAIN_STYLE_LIST.map(s => s.id), 'copernicus' as const].map(id => [id,terrainStyle(id)]));
const catalogue = { format: 'magna-surface-palette-catalogue', version: 1, paletteSource: 'web/src/render/styles.ts', sourceFilesSha256, palettes: PALETTES, terrainStyles };
const output = new URL('../../surface/presentation/palettes.json',import.meta.url);
await writeFile(output, JSON.stringify(catalogue,null,2)+'\n');
console.log(`Exported ${Object.keys(PALETTES).length} canonical mapper styles: ${output.pathname}`);
