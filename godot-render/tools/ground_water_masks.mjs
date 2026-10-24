// Rasterize the retained vector banks, without deriving water from Render RGB.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {Resvg}=await import(pathToFileURL(path.join(root,'../web/node_modules/@resvg/resvg-js/index.js')));
const args=process.argv.slice(2), only=args.includes('--tile')?args[args.indexOf('--tile')+1]:null;
const catalog=JSON.parse(await readFile(path.join(root,'tiles/catalog.json'),'utf8'));
for(const entry of catalog.tiles){
 if(only&&entry.id!==only)continue;
 const dir=path.join(root,'tiles',path.dirname(entry.file));
 const meta=JSON.parse(await readFile(path.join(dir,'tile.json'),'utf8'));
 const svg=await readFile(path.join(dir,meta.hydrology.svg),'utf8');
 // Filled river-bank polygons are hydraulic geometry. The hairline axes are
 // cosmetic at map scale and must not inflate the physical wet footprint.
 const paths=[...svg.matchAll(/<path\b[^>]*>/g)].map(m=>m[0]).filter(p=>!p.includes('water-lakes')&&!/fill="none"/.test(p));
 const white=paths.map(p=>p.replace(/fill="[^"]*"/g,'fill="white"').replace(/stroke="[^"]*"/g,'stroke="none"')).join('');
 const image=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40000 40000">'+white+'</svg>',{fitTo:{mode:'width',value:4096}}).render().asPng();
 await writeFile(path.join(dir,'surface-river-footprint.png'),image);
 console.log('WATER MASK '+entry.id);
}
