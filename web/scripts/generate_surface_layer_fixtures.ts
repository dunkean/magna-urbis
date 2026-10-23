import{mkdirSync,writeFileSync}from'node:fs';
import{resolve}from'node:path';
import{surfaceLayerInput}from'../tests/fixtures/surfaceLayerInput';
import{compileSurfaceWorld,retargetSurfaceWorld,serializeSurfaceWorld,sampleSurface}from'../src/surface/compiler';
import{encodeSurfaceBinary}from'../src/surface/binary';
import{unpackMaterialMean}from'../src/surface/materials';
// Reproducible CPU-only GD interoperability fixtures. No renderer or service.
const args=process.argv.slice(2),index=args.indexOf('--out');
if(index>=0&&(!args[index+1]||args[index+1].startsWith('--')))throw Error('--out requires a directory');
const out=resolve(index>=0?args[index+1]:'out/surface/layer-gd-fixtures');mkdirSync(out,{recursive:true});
const base=compileSurfaceWorld(surfaceLayerInput(),{topographicRadiiM:[32,64,128]});
const fine={...base.terrain,width:33,height:33,originX:96,originZ:96,spacingM:4,
  source:{...base.terrain.source,sourceLOD:-1,nativeSpacingM:4},
  heights:Float32Array.from({length:33*33},(_,i)=>sampleSurface(base,96+i%33*4,96+Math.floor(i/33)*4).heightM)};
const refined=retargetSurfaceWorld(base,fine);
const references:any={format:'surface-layers-gd-fixture-references',version:1,compilerVersion:base.compilerVersion,scope:'Authored unit height/context fixture; no real terrain-generation claim',worlds:{}};
for(const[name,world]of[['canonical',base],['refined',refined]]as const){
  writeFileSync(`${out}/${name}.json`,serializeSurfaceWorld(world));writeFileSync(`${out}/${name}.surfacebin`,encodeSurfaceBinary({world}));
  const f=world.fields;const indices=[...new Set([0,1,...(name==='canonical'?[18,73,105]:[f.lowCoverOpacity!.findIndex(value=>value===0)]),Math.floor(world.terrain.heights.length/2),world.terrain.heights.length-1].filter(value=>value>=0))];
  references.worlds[name]={id:world.id,grid:{width:world.terrain.width,height:world.terrain.height,spacingM:world.terrain.spacingM,originX:world.terrain.originX,originZ:world.terrain.originZ},
    surfaceLayers:world.surfaceLayers,versions:world.versions,canonicalContextRef:world.canonicalContextRef,
    samples:indices.map(i=>({index:i,groundIds:[f.groundMaterial![i],f.groundMaterialSecondary![i],f.groundMaterialBlend![i]],
      groundMeanPacked:f.groundMaterialMeanColor![i],groundMeanLinear:unpackMaterialMean(f.groundMaterialMeanColor![i]),
      lowIds:[f.lowCoverMaterial![i],f.lowCoverMaterialSecondary![i],f.lowCoverMaterialBlend![i],f.lowCoverOpacity![i]],
      lowMeanPacked:f.lowCoverMaterialMeanColor![i],lowMeanLinear:unpackMaterialMean(f.lowCoverMaterialMeanColor![i]),
      groundRoughness:world.materials[f.groundMaterial![i]].roughness*(1-f.groundMaterialBlend![i])+world.materials[f.groundMaterialSecondary![i]].roughness*f.groundMaterialBlend![i],
      lowCoverRoughness:world.materials[f.lowCoverMaterial![i]].roughness*(1-f.lowCoverMaterialBlend![i])+world.materials[f.lowCoverMaterialSecondary![i]].roughness*f.lowCoverMaterialBlend![i],
      lowPremulRGBA:unpackMaterialMean(f.lowCoverMaterialMeanColor![i]).map(v=>Math.fround(v*f.lowCoverOpacity![i])).concat(f.lowCoverOpacity![i])}))};
}
writeFileSync(`${out}/expected.json`,JSON.stringify(references,null,2));console.log(JSON.stringify({out,compilerVersion:base.compilerVersion,canonical:base.surfaceLayers,refined:refined.surfaceLayers,canonicalRef:refined.canonicalContextRef}));
