import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIPELINE_VERSION = 'source-tufts-height1-cw-tangents-v1';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const serialized = value => JSON.stringify(canonical(value));
const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENTS = { 5126: ['getFloat32', 4], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5121: ['getUint8', 1] };

export function accessor(document, binary, index) {
  const a = document.accessors[index];
  if (!a || a.sparse || a.normalized || !COMPONENTS[a.componentType] || !TYPES[a.type]) throw new Error('Unsupported source accessor');
  const b = document.bufferViews[a.bufferView];
  const [method, bytes] = COMPONENTS[a.componentType];
  const count = TYPES[a.type], stride = b.byteStride ?? count * bytes;
  const offset = (a.byteOffset ?? 0) + (b.byteOffset ?? 0);
  if (b.buffer !== 0 || offset + (a.count - 1) * stride + count * bytes > binary.length) throw new Error('Accessor outside source buffer');
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: count }, (_, k) => view[method](offset + i * stride + k * bytes, true)));
}
const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => { const n = Math.hypot(...a); return n > 1e-12 ? a.map(x => x/n) : [1,0,0]; };

// Source glTF is CCW. ArrayMesh is CW. Generate tangent handedness in source UV space
// before reversing each triangle, without flipping the authored outward normals.
export function prepareTuft(document, binary, name) {
  const node = document.nodes.find(value => value.name === name);
  if (!node || node.rotation || node.scale || node.matrix) throw new Error(`Unsupported source transform: ${name}`);
  const primitives = document.meshes[node.mesh].primitives;
  if (primitives.length !== 1 || (primitives[0].mode ?? 4) !== 4) throw new Error('Expected one triangle surface');
  const p = primitives[0];
  const positions = accessor(document,binary,p.attributes.POSITION);
  const normals = accessor(document,binary,p.attributes.NORMAL).map(unit);
  const uv = accessor(document,binary,p.attributes.TEXCOORD_0);
  const sourceIndices = accessor(document,binary,p.indices).flat();
  if (sourceIndices.some(i => i >= positions.length) || sourceIndices.length % 3) throw new Error('Invalid source indices');
  const min = [0,1,2].map(k => Math.min(...positions.map(v => v[k])));
  const max = [0,1,2].map(k => Math.max(...positions.map(v => v[k])));
  const height = max[1]-min[1];
  if (!(height > 0) || !Number.isFinite(height)) throw new Error('Invalid source height');
  const pivot = [(min[0]+max[0])/2,min[1],(min[2]+max[2])/2];
  const normalized = positions.map(v => v.map((x,k) => (x-pivot[k])/height - (k===1 ? .5 : 0)));
  const tangent = positions.map(() => [0,0,0]), bitangent = positions.map(() => [0,0,0]);
  for (let i=0;i<sourceIndices.length;i+=3) {
    const ids=sourceIndices.slice(i,i+3), [a,b,c]=ids.map(j=>normalized[j]), [ta,tb,tc]=ids.map(j=>uv[j]);
    const e1=b.map((x,k)=>x-a[k]),e2=c.map((x,k)=>x-a[k]);
    const u1=tb[0]-ta[0],v1=tb[1]-ta[1],u2=tc[0]-ta[0],v2=tc[1]-ta[1], det=u1*v2-u2*v1;
    if (Math.abs(det)<1e-12) continue;
    for (const id of ids) for(let k=0;k<3;k++) {
      tangent[id][k]+=(e1[k]*v2-e2[k]*v1)/det;
      bitangent[id][k]+=(e2[k]*u1-e1[k]*u2)/det;
    }
  }
  const tangents=tangent.map((t,i)=>{const n=normals[i],d=dot(n,t); const axis=unit(t.map((x,k)=>x-n[k]*d));return [...axis,dot(cross(n,axis),bitangent[i])<0?-1:1];});
  const indices=sourceIndices.flatMap((v,i)=>i%3===0?[v,sourceIndices[i+2],sourceIndices[i+1]]:[]);
  return {id:name,triangleCount:indices.length/3,sourceBounds:{min,max},sourceCollectionTranslation:node.translation??[0,0,0],
    normalization:{pivot,uniformScale:1/height,preparedHeight:1,preparedBottom:-.5,preparedTop:.5,positionUnits:'candidate-size'},
    positions:normalized.flat(),normals:normals.flat(),uv:uv.flat(),tangents:tangents.flat(),indices};
}

export async function ingest(cataloguePath, out, offline=false) {
  const catalogue=JSON.parse(await readFile(cataloguePath,'utf8'));
  if(catalogue.format!=='magna-vegetation-assets'||catalogue.version!==1) throw new Error('Invalid catalogue');
  await mkdir(path.join(out,'source'),{recursive:true});
  const assets=[];
  for(const asset of catalogue.assets) {
    if(asset.license!=='CC0-1.0') throw new Error('Expected explicit CC0 asset');
    const sources={};
    for(const [role,file] of Object.entries(asset.sourceFiles)) {
      const destination=path.join(out,'source',path.basename(new URL(file.url).pathname));
      let bytes;try {bytes=await readFile(destination);}catch {}
      if(!bytes||sha256(bytes)!==file.sha256) {
        if(offline) throw new Error(`Missing or edited source: ${role}`);
        const response=await fetch(file.url); if(!response.ok) throw new Error(`Download ${response.status}: ${role}`);
        bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256) throw new Error(`Pinned source mismatch: ${role}`);
        await writeFile(destination,bytes);
      }
      if(bytes.length!==file.bytes) throw new Error(`Source size mismatch: ${role}`);
      sources[role]={...file,path:path.relative(out,destination).replaceAll('\\','/')};
    }
    const document=JSON.parse(await readFile(path.join(out,sources.gltf.path),'utf8'));
    const binary=await readFile(path.join(out,sources.geometry.path));
    const product={format:'magna-vegetation-meshes',version:1,pipelineVersion:PIPELINE_VERSION,assetId:asset.id,
      variants:asset.sourceMeshNames.map(name=>prepareTuft(document,binary,name))};
    const body=serialized(product),productPath=`${asset.id}.meshes.json`;
    await writeFile(path.join(out,productPath),body+'\n');
    assets.push({...asset,sources,product:{path:productPath,sha256:sha256(body+'\n'),bytes:Buffer.byteLength(body+'\n')}});
  }
  // Absolute installation/cache paths never enter the renderer identity.
  const identity={format:catalogue.format,version:1,pipelineVersion:PIPELINE_VERSION,assets:assets.map(({sources,...asset})=>({...asset,sourceFiles:Object.fromEntries(Object.entries(sources).map(([role,{path:local,...file}])=>[role,file]))}))};
  const resolved={...identity,digest:sha256(serialized(identity)),assets};
  await writeFile(path.join(out,'resolved.json'),JSON.stringify(resolved,null,2)+'\n');
  return resolved;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const resolved=await ingest(path.resolve(value('--catalogue',path.join(root,'surface/vegetation/catalogue.json'))),path.resolve(value('--out',path.join(root,'web/out/vegetation-assets'))),args.includes('--offline'));
  console.log(JSON.stringify({format:resolved.format,digest:resolved.digest,assets:resolved.assets.map(a=>({id:a.id,product:a.product.path}))}));
}
