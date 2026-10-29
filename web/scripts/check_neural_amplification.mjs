// Actual HTTP registration/tile/release contract, using a retained Magna raster.
// node scripts/check_neural_amplification.mjs SOURCE.f32 [N=512] [WIDTH=50000] [SERVER=http://127.0.0.1:8793]
import { readFile } from 'node:fs/promises';
const [path,nArg='512',widthArg='50000',server='http://127.0.0.1:8793'] = process.argv.slice(2);
if (!path) throw new Error('Supply an actual retained square FP32 heightfield');
const n=Number(nArg),width=Number(widthArg),raw=await readFile(path),ids=new Set();
let nativeReference;
if(raw.length!==n*n*4)throw new Error('Source dimensions do not match');
async function post(route,body){const response=await fetch(`${server}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`${route}: ${await response.text()}`);return response;}
for(const amplification of ['classic','phasor','hybrid','mse']){
  const registration=await (await post('/refinement/register',{n,width,seed:'17',heights:raw.toString('base64'),amplification})).json();
  try{
    if(registration.amplification!==amplification||ids.has(registration.id))throw new Error('Method identity not preserved');
    ids.add(registration.id);
    const nativeResponse=await post('/refinement/tile',{id:registration.id,x:15000,y:35000,width:960,resolution:32});
    const native=Buffer.from(await nativeResponse.arrayBuffer());
    if(nativeReference&&!native.equals(nativeReference))throw new Error('Amplification changed the native retained surface');
    nativeReference??=native;
    const response=await post('/refinement/tile',{id:registration.id,x:15000,y:35000,width:240,resolution:32});
    const meta=JSON.parse(response.headers.get('x-neural-meta')??'{}'),values=new Float32Array(await response.arrayBuffer());
    if(values.length!==32*32||values.some(v=>!Number.isFinite(v))||meta.amplification!==amplification)throw new Error('Invalid amplified tile');
    console.log(JSON.stringify({amplification,methodVersion:meta.methodVersion,decoderUsed:meta.decoderUsed,samples:values.length,passed:true}));
  }finally{await post('/refinement/release',{id:registration.id});}
}
for(const options of [{amplification:'unknown'},{amplification:'phasor',intensity:-1}]){
  const response=await fetch(`${server}/refinement/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({n,width,seed:'17',heights:raw.toString('base64'),...options})});
  if(response.status!==400)throw new Error(`Invalid amplification accepted: ${response.status}`);
}
console.log('Invalid mode and intensity rejected (400).');
