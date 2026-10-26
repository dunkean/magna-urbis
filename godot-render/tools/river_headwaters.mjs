// Display-only headwater emergence. The retained drainage graph, discharge,
// downstream hydraulic widths and water levels remain authoritative.
export const HEADWATER_PROFILE={version:1,minimumWidthMetres:.6,minimumReachMetres:100,maximumReachMetres:420,widthMultiples:10};

function segmentDistance(x,y,points,i){
 const ax=points[2*i],ay=points[2*i+1],dx=points[2*i+2]-ax,dy=points[2*i+3]-ay;
 const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(x-ax-t*dx,y-ay-t*dy);
}

/** Classify only actual small headwaters, not inflows, outlets or branches. */
export function isHeadwater(line,network,hydro,threshold){
 const p=line.points,cell=hydro.width/hydro.n,x=p[0],y=p[1];
 if(line.area.length<2||x<2*cell||y<2*cell||x>hydro.width-2*cell||y>hydro.width-2*cell)return false;
 if(line.area[0]>threshold*2)return false;
 const ix=Math.floor(x/cell),iy=Math.floor(y/cell);
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
  const xx=ix+dx,yy=iy+dy;if(xx<0||yy<0||xx>=hydro.n||yy>=hydro.n)continue;
  if(hydro.sea[yy*hydro.n+xx]||hydro.lake[yy*hydro.n+xx])return false;
 }
 for(const other of [...network.rivers,...(network.lakeLinks??[])]){
  if(other===line)continue;
  for(let i=0;i+1<other.area.length;i++){
   if(segmentDistance(x,y,other.points,i)<cell*.8)return false;
  }
 }
 return true;
}

/** Smoothly resolve a small spring/channel into its retained bankfull width. */
export function headwaterGeometry(line,widths,enabled){
 if(!enabled)return {points:line.points,widths,levels:line.level,reach:0};
 const settings=HEADWATER_PROFILE;
 let total=0;
 for(let i=1;i<widths.length;i++)total+=Math.hypot(line.points[2*i]-line.points[2*i-2],line.points[2*i+1]-line.points[2*i-1]);
 // Short streams still recover their full width well before the confluence.
 const reach=Math.min(total*.6,Math.max(settings.minimumReachMetres,Math.min(settings.maximumReachMetres,widths[0]*settings.widthMultiples)));
 const points=[],out=[],levels=[];let arc=0;
 const add=(x,y,width,level,distance)=>{
  const u=Math.min(1,distance/Math.max(.001,reach)),smooth=u*u*(3-2*u);
  points.push(x,y);out.push(Math.min(width,settings.minimumWidthMetres)+(width-Math.min(width,settings.minimumWidthMetres))*smooth);levels.push(level);
 };
 add(line.points[0],line.points[1],widths[0],line.level[0],0);
 for(let i=1;i<widths.length;i++){
  const x0=line.points[2*i-2],y0=line.points[2*i-1],x1=line.points[2*i],y1=line.points[2*i+1],length=Math.hypot(x1-x0,y1-y0);
  const pieces=arc<reach?Math.max(1,Math.ceil(length/Math.max(2,reach/24))):1;
  for(let j=1;j<=pieces;j++){
   const t=j/pieces;add(x0+(x1-x0)*t,y0+(y1-y0)*t,widths[i-1]+(widths[i]-widths[i-1])*t,line.level[i-1]+(line.level[i]-line.level[i-1])*t,arc+length*t);
  }
  arc+=length;
 }
 return {points,widths:out,levels,reach};
}

export function riverBankPath(geometry,bank){
 const {points,widths,levels}=geometry,packed=new Float32Array(widths.length*4);
 for(let i=0;i<widths.length;i++)packed.set([points[2*i],points[2*i+1],widths[i],levels[i]],i*4);
 let path=bank(packed,0,widths.length);
 for(const i of [0,widths.length-1]){
  const x=points[2*i],y=points[2*i+1],r=widths[i]/2;
  path+=`M${(x+r).toFixed(3)},${y.toFixed(3)}a${r.toFixed(3)},${r.toFixed(3)} 0 1 0 ${(-2*r).toFixed(3)},0a${r.toFixed(3)},${r.toFixed(3)} 0 1 0 ${(2*r).toFixed(3)},0Z`;
 }
 return path;
}
