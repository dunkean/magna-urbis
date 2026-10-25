// Pin and reuse the original Render3D forest, without V2's clearing profile.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(project,'../../magna-urbis-render-original-reference');
if(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='dff14f387a6d1edc89d93737f861ee91e022a5aa')throw Error('Original Render3D reference moved');
execFileSync('git',['-C',source,'diff','--quiet','HEAD','--','rust/bridge/terrainForest.ts','rust/bridge/terrainGround.ts']);
const {tsImport}=await import(pathToFileURL(path.join(source,'web/node_modules/tsx/dist/esm/api/index.mjs')));
const load=p=>tsImport(pathToFileURL(path.join(source,p)).href,import.meta.url);
const {FOREST_GLSL,buildForestField,DEFAULT_FOREST_SETTINGS}=await load('rust/bridge/terrainForest.ts');
const {GROUND_FIELD_GLSL}=await load('rust/bridge/terrainGround.ts');
const {riverSegments}=await load('web/src/ui/vectorWaterRender.ts');
const {encodePng}=await load('web/src/render/raster.ts');
const sha=v=>createHash('sha256').update(v).digest('hex');
let forest=FOREST_GLSL.replace('float forestResolvedCover=0.;','');
const signature='void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light){';
if(!forest.includes(signature))throw Error('Original forest signature changed');
forest=forest.replace(signature,'void applyForest(inout GroundMaterial m,vec2 world,float footprint,vec3 light,vec3 renderGuideColor,vec3 renderGuideOpen,vec3 renderGuideClosed,float renderGuideWoods,out float forestResolvedCover){');
// Godot has no arrays inside structs. Flatten only this nine-gradient cache;
// hash, probabilities, crown geometry, palettes and shading remain verbatim.
forest=forest.replace('struct ForestPatch{ivec2 base;vec2 g[9];};',
 'struct ForestPatch{ivec2 base;'+Array.from({length:9},(_,i)=>'vec2 g'+i+';').join('')+'};\nvec2 forestPatchGradient(ForestPatch q,int k){'+Array.from({length:8},(_,i)=>'if(k=='+i+')return q.g'+i+';').join('')+'return q.g8;}');
forest=forest.replace('for(int j=0;j<3;j++)for(int i=0;i<3;i++)q.g[j*3+i]=forestGradient(q.base+ivec2(i,j));',
 Array.from({length:9},(_,i)=>`q.g${i}=forestGradient(q.base+ivec2(${i%3},${Math.floor(i/3)}));`).join(''));
forest=forest.replace(/q\.g\[([^\]]+)\]/g,'forestPatchGradient(q,$1)');
const strictTypes=s=>s.replace(/(?<!i)vec2\(i,j\)/g,'vec2(float(i),float(j))').replace(/mat2\(([-.\d]+),([-.\d]+),([-.\d]+),([-.\d]+)\)/g,'mat2(vec2($1,$2),vec2($3,$4))');
const header=`// Generated from original Render3D, pinned dff14f387a6d1edc89d93737f861ee91e022a5aa.
// No render-v2 source or progressive clearing profile. Regenerate with prepare_original_cover.mjs.
uniform sampler2D uForestField : filter_linear_mipmap, repeat_disable;
uniform sampler2D uForestBank : filter_linear_mipmap, repeat_disable;
uniform vec3 uForestRect=vec3(0,0,40000);
uniform uint uMaterialSeed=1905266606u;
uniform vec2 uMaterialClimate=vec2(18,1000);
uniform int uHasForestBank=0;
uniform float uForestBankDensity=1.0;
const int uForest=1;
const int uHasOccupation=0;
const int uForestBrushes=0;
uniform sampler2D uOccupation;
uniform sampler2DArray uForestBrushAtlas;
const vec3 uOccupationRect=vec3(0,0,40000);
const float uOccupationN=1.0;
`;
await mkdir(path.join(project,'shaders'),{recursive:true});
const adapted=header+strictTypes(GROUND_FIELD_GLSL)+'\n'+strictTypes(forest);
await writeFile(path.join(project,'shaders/original_forest.gdshaderinc'),adapted);
await writeFile(path.join(project,'shaders/original_forest_source.json'),JSON.stringify({sourceHead:'dff14f387a6d1edc89d93737f861ee91e022a5aa',forestSha256:sha(FOREST_GLSL),groundSha256:sha(GROUND_FIELD_GLSL),portedSha256:sha(adapted.replaceAll('\r\n','\n')),profile:'original',settings:DEFAULT_FOREST_SETTINGS},null,2));
const catalogue=JSON.parse(await readFile(path.join(project,'tiles/catalog.json'),'utf8'));
const args=process.argv.slice(2),only=args.includes('--tile')?args[args.indexOf('--tile')+1]:null;
if(args.includes('--shader-only'))process.exit(0);
for(const entry of catalogue.tiles){
 if(only&&entry.id!==only)continue;
 const directory=path.join(project,'tiles',path.dirname(entry.file)),meta=JSON.parse(await readFile(path.join(directory,'tile.json'),'utf8'));
 const data=await readFile(path.join(directory,meta.height));
 const height={x:0,y:0,width:meta.width,n:meta.n,data:new Float32Array(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength))};
 const blob=gunzipSync(await readFile(path.join(directory,meta.hydrology.grids.file)));
 const read=(name,Type)=>{const f=meta.hydrology.grids.fields[name];return new Type(blob.buffer.slice(blob.byteOffset+f.offset,blob.byteOffset+f.offset+f.bytes));};
 const sea=read('sea',Uint8Array),lake=read('lake',Uint8Array),water=new Uint8Array(meta.n**2);
 for(let i=0;i<water.length;i++)water[i]=sea[i]?1:lake[i]?2:0;
 const network=JSON.parse(await readFile(path.join(directory,meta.hydrology.network),'utf8'));
 const vectors=riverSegments({rivers:network.rivers,widthScale:network.settings.widthScale,hydro:{width:meta.width,n:meta.n,sea},lake},
 {style:'render',showLakes:true,showOxbows:true,riverArea:network.settings.riverArea,riverMode:'vector',overlay:'none'});
 const field=buildForestField({seed:1905266606,climate:[meta.temperature,meta.precipitation],height,water,riverSegments:vectors},DEFAULT_FOREST_SETTINGS);
 await writeFile(path.join(directory,'original-forest-field.png'),encodePng(field.rgba,field.n,field.n,4,1));
 const files=['original-forest-field.png'];
 if(field.bank){await writeFile(path.join(directory,'original-forest-bank.png'),encodePng(field.bank,field.n,field.n,4,1));files.push('original-forest-bank.png');}
 await writeFile(path.join(directory,'original-forest.json'),JSON.stringify({version:1,profile:'original-render3d',sourceHead:'dff14f387a6d1edc89d93737f861ee91e022a5aa',seed:1905266606,fieldKey:field.key,n:field.n,settings:DEFAULT_FOREST_SETTINGS,bankDensity:field.bankDensity??1,heightSha256:meta.heightSha256,files:await Promise.all(files.map(async file=>({file,sha256:sha(await readFile(path.join(directory,file)))})))},null,2));
 console.log('ORIGINAL FOREST '+entry.id);
}
