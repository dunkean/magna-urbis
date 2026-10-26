/** Isolated CPU feasibility measurement; does not change any retained terrain. */
import{mkdirSync,writeFileSync}from'node:fs';
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const measurements=[];
for(const width of [320,1000,2000]){
 const cell=2,n=Math.ceil(width/cell),height=Float32Array.from({length:n*n},(_,i)=>100+Math.floor(i/n)*cell*.15),delta=new Float32Array(n*n);
 const runs=[];let cut=0,fill=0,maximum=0;
 for(let run=0;run<4;run++){
  const start=performance.now();cut=0;fill=0;maximum=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=y*n+x,z=height[i],rise=1.5,phase=(z-100)/rise,step=Math.floor(phase),fraction=phase-step;
   const target=100+rise*(step+.41+smooth(.82,1,fraction));
   const edge=Math.min((x+.5)*cell,(y+.5)*cell,(n-x-.5)*cell,(n-y-.5)*cell);
   const d=(target-z)*smooth(0,12,edge);delta[i]=d;maximum=Math.max(maximum,Math.abs(d));if(d<0)cut-=d*cell*cell;else fill+=d*cell*cell;
  }
  runs.push(performance.now()-start);
 }
 measurements.push({areaKm2:width*width/1e6,cellMeters:cell,samples:n*n,heightAndDeltaMiB:(height.byteLength+delta.byteLength)/1048576,bestCpuMs:Math.min(...runs.slice(1)),maxChangeMeters:maximum,cutM3:cut,fillM3:fill});
}
const result={scope:'CPU height deltas only; excludes hydrology, tile upload, normals, walls, roads and buildings',global40kmAt2m:{samples:400000000,singleFloat32GridGiB:400000000*4/1024**3},measurements};
mkdirSync('out/landuse-review',{recursive:true});writeFileSync('out/landuse-review/terrace-feasibility.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
