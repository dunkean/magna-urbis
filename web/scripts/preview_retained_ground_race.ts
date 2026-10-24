/** Diagnostic CPU means only. No PBR/lighting, no new source fields or density.
 * node --import tsx scripts/preview_retained_ground_race.ts packet outputDir
 * Emits40m/256px previews from real saved GR inputs at20000,20000. */
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
import{decodeSurfaceBinary}from'../src/surface/binary';import{hydrateSurfaceWorld}from'../src/surface/compiler';import{groundResponseWeights,createGroundResponseSampler}from'../src/surface/groundResponse';import{unpackMaterialMean}from'../src/surface/materials';import{createDetailRaceSampler,reanchorDetailMean}from'../src/surface/detailDistribution';
if(!process.argv[2]||!process.argv[3])throw Error('Expected retained packet and new output directory');
const input=resolve(process.argv[2]),out=resolve(process.argv[3]),bytes=readFileSync(input);if(bytes.length>512*1024*1024)throw Error('Packet exceeds512MiB');
const packet=decodeSurfaceBinary<any>(bytes),world=hydrateSurfaceWorld(packet.world),c=world.canonicalContext;if(!c?.groundResponse)throw Error('Explicit canonical ground-response inputs required');
const gr=c.groundResponse,g=c.grid,f=c.fields,materials=world.materials,M=Object.fromEntries(materials.map((r,i)=>[r.id,i])),rocks=new Map(world.geology.units.map(r=>[r.id,r]));
const meanSample=createGroundResponseSampler(gr,f,materials,world.geology.units),groundRace=createDetailRaceSampler(world.seed),lowRace=createDetailRaceSampler(world.seed,0,0,.371,.619);
const n=256,extent=40,footprint=.02,images=Object.fromEntries(['ground-before','ground-race','composed-before','composed-race'].map(k=>[k,Buffer.alloc(n*n*3)]));let centre:any;
function sample(x:number,z:number){
  const gx=Math.max(0,Math.min(g.width-1,(x-g.originX)/g.spacingM)),gz=Math.max(0,Math.min(g.height-1,(z-g.originZ)/g.spacingM)),ix=Math.min(g.width-2,Math.floor(gx)),iz=Math.min(g.height-2,Math.floor(gz)),tx=gx-ix,tz=gz-iz;
  const I=[iz*g.width+ix,iz*g.width+ix+1,(iz+1)*g.width+ix,(iz+1)*g.width+ix+1],W=[(1-tx)*(1-tz),tx*(1-tz),(1-tx)*tz,tx*tz],nearest=Math.round(gz)*g.width+Math.round(gx),v=(a:ArrayLike<number>)=>I.reduce((sum,j,k)=>sum+a[j]*W[k],0);
  const params={stoniness:v(f.stoniness),slopeRadians:v(f.slope),organic:Math.min(1,v(f.organic)),rockRecipe:gr.fields.rockRecipe[nearest],occupation:f.occupation[nearest],alluvial:v(gr.fields.alluvial),gravity:v(gr.fields.gravity),wind:v(gr.fields.wind),coastal:v(gr.fields.coastal),aridity:v(gr.fields.aridity),moisturePreSaturation:Math.min(1,v(gr.fields.moisturePreSaturation))};
  const pairs=groundResponseWeights(params,M),total=pairs.reduce((sum,p)=>sum+p[1],0),probabilities=pairs.map(p=>p[1]/total),colors=pairs.map(([id])=>materials[id].family==='gravity'?rocks.get(f.sourceRock[nearest])!.colorLinear:['bedrock','karst','volcanic','rocky-coast'].includes(materials[id].family)?rocks.get(f.bedrock[nearest])!.colorLinear:materials[id].colorLinear);
  const target=meanSample(I,W,nearest).mean,local=groundRace(probabilities,x,z,footprint),ground=reanchorDetailMean(target,probabilities,colors,local);
  const low=new Map<number,number>(),lowTarget=[0,0,0];let alpha=0;
  for(let k=0;k<4;k++){const j=I[k],weight=W[k]*f.lowCoverOpacity![j];alpha+=weight;const mean=unpackMaterialMean(f.lowCoverMaterialMeanColor![j]);for(let channel=0;channel<3;channel++)lowTarget[channel]+=mean[channel]*weight;for(const [id,p]of[[f.lowCoverMaterial![j],1-f.lowCoverMaterialBlend![j]],[f.lowCoverMaterialSecondary![j],f.lowCoverMaterialBlend![j]]])low.set(id,(low.get(id)??0)+weight*p);}
  const entries=[...low].filter(([,p])=>p>0).sort((a,b)=>a[0]-b[0]),lowP=entries.map(p=>p[1]),lowColors=entries.map(p=>materials[p[0]].colorLinear);let lowMean=lowTarget.map(v=>alpha>0?v/alpha:0),lowLocal=lowRace(lowP,x,z,footprint,entries.map(p=>p[0]+32)),localAlpha=lowLocal.reduce((a,b)=>a+b,0);
  if(alpha>0&&localAlpha>0)lowMean=reanchorDetailMean(lowMean,lowP.map(p=>p/alpha),lowColors,lowLocal.map(p=>p/localAlpha));
  const before=target.map((v,i)=>v*(1-alpha)+(alpha>0?lowTarget[i]:0)),after=ground.map((v,i)=>v*(1-localAlpha)+lowMean[i]*localAlpha);
  return{target,ground,before,after,probabilities,recipeIds:pairs.map(p=>p[0]),lowP,lowIds:entries.map(p=>p[0]),alpha,localAlpha,params};
}
for(let z=0;z<n;z++)for(let x=0;x<n;x++){
  const s=sample(20000-extent/2+(x+.5)*extent/n,20000-extent/2+(z+.5)*extent/n);if(x===n/2&&z===n/2)centre=s;
  for(const[key,color]of Object.entries({'ground-before':s.target,'ground-race':s.ground,'composed-before':s.before,'composed-race':s.after}))for(let i=0;i<3;i++){const value=Math.max(0,Math.min(1,color[i])),srgb=value<=.0031308?12.92*value:1.055*value**(1/2.4)-.055;images[key][(z*n+x)*3+i]=Math.round(srgb*255);}
}
mkdirSync(out,{recursive:true});for(const[key,data]of Object.entries(images))writeFileSync(join(out,key+'.ppm'),Buffer.concat([Buffer.from(`P6\n${n} ${n}\n255\n`),data]));
writeFileSync(join(out,'report.json'),JSON.stringify({status:'RETAINED_CPU_MEAN_DIAGNOSTIC_ONLY',input,sourceSha256:createHash('sha256').update(bytes).digest('hex'),contextId:c.id,groundResponseId:gr.id,extentM:extent,focus:[20000,20000],resolution:n,shaderFootprintM:footprint,centre,limits:['No PBR/normal/lighting or native-quality claim.','Existing physical context/ground-response source inputs, unchanged; no new observed fine geology.','Output sampling resolution differs from supplied shader footprint; this is a mean-distribution diagnostic.','Categorical conservation is seed-ensemble expectation, not exact mass in one patch.']},null,2)+'\n');console.log(JSON.stringify({out,sourceContext:c.id,centreRecipeProbabilities:centre.probabilities,centreLowOpacity:centre.alpha}));
