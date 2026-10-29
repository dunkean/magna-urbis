// Positive cubic B-spline: no overshoot across coarse drainage steps.
fn compactWeights(t:f32)->vec4<f32>{let q=1.0-t;return vec4<f32>(q*q*q,3.0*t*t*t-6.0*t*t+4.0,-3.0*t*t*t+3.0*t*t+3.0*t+1.0,t*t*t)/6.0;}
fn compactRegional(pos:vec2<f32>)->f32{
  let xy=vec2<i32>(floor(pos));let wx=compactWeights(fract(pos.x));let wy=compactWeights(fract(pos.y));var value=0.0;
  for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){value+=wx[x]*wy[y]*at(xy+vec2<i32>(i32(x)-1,i32(y)-1),false);}}
  return value;
}

// Unlike the old smoothstep, regional mountain coverage has no clipped upper band.
fn compactMountainWeight(distribution:f32,mix:f32)->f32{
  let x=(distribution+(mix-.5)*1.4)/.28;
  return .5+.5*x/sqrt(1.0+x*x);
}
@compute @workgroup_size(256)
fn compactInitialize(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=count()){return;}let n=size();
  let xy=(vec2<f32>(f32(i%n),f32(i/n))+.5)*p.values[1].x+p.values[1].y;
  let env=fbm(xy/p.values[1].z+vec2<f32>(3.1,-1.7),0u,3u,.5,0.0);
  let distribution=fbm(xy/(2700.0*p.values[0].w)+vec2<f32>(8.4,0.0),1u,3u,.5,0.0);
  let mix=p.values[3].z;
  let mountains=select(smooth01((distribution+(mix-.5)*1.4+.28)/.56),compactMountainWeight(distribution,mix),p.values[7].x>0.0);
  let q=dot(xy-p.values[0].x*.5,p.values[5].xy)/p.values[0].x;
  let skeleton=ridge(xy/p.values[1].z+vec2<f32>(5.7,-3.2),3u);
  let crest=1.0+p.values[7].x*mountains*(.24+1.8*skeleton*skeleton-1.0);
  let u=max(.12,.7+.5*env-.25*q)*(.20+.80*mountains)*crest;
  let border=f32(min(min(i%n,i/n),min(n-1u-i%n,n-1u-i/n)))/(.1*f32(n));
  nodes[i].uplift=u*(.25+.75*smooth01(border));
  nodes[i].routingPriority=seededRoutingPriority(i);
  nodes[i].h=select(2.5*u+.6*fbm(xy/p.values[1].w,1u,3u,.5,0.0),0.0,edge(i));nodes[i].acc=1.0;
}

// Compact-source detail. Same scalar equations as terrainPhasor.ts.
fn phSmooth(a:f32,b:f32,v:f32)->f32{let t=clamp((v-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t);}
fn phHash(x:i32,y:i32,seed:u32)->f32{
  var h=(bitcast<u32>(x)*0x1f123bb5u) ^ (bitcast<u32>(y)*0x5f356495u) ^ seed;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return f32(h^(h>>16u))/4294967296.0;
}
fn phHeight(pos:vec2<f32>)->f32{
  let q=clamp(pos/p.values[8].x-0.5,vec2<f32>(0.0),vec2<f32>(1023.0));let a=vec2<u32>(floor(q));let t=fract(q);
  let b=min(a+1u,vec2<u32>(1023u));
  return mix(mix(fine[a.y*1024u+a.x].x,fine[a.y*1024u+b.x].x,t.x),mix(fine[b.y*1024u+a.x].x,fine[b.y*1024u+b.x].x,t.x),t.y);
}
fn compactPhasor(i:u32)->f32{
  let h=fine[i].x;let intensity=p.values[8].z;if(intensity<=0.0){return h;}
  let cell=p.values[8].x;let pos=(vec2<f32>(f32(i%1024u),f32(i/1024u))+0.5)*cell;
  let span=max(cell,p.values[8].w*.3);
  let ex=vec2<f32>(span,0.0);let ey=vec2<f32>(0.0,span);
  let l=phHeight(pos-ex);let r=phHeight(pos+ex);let t=phHeight(pos-ey);let b=phHeight(pos+ey);
  let slope=length(vec2<f32>(r-l,b-t))/(2.0*span);let curvature=(l+r+t+b-4.0*h)/(span*span);
  let mask=phSmooth(.012,.20,slope)*(1.0-phSmooth(.0005,.004,curvature))*phSmooth(1.0,12.0,h);
  if(mask<=0.0){return h;}
  let seed=u32(p.values[8].y);var delta=0.0;var parent=1.0;var wave=p.values[8].w;
  for(var octave=0u;octave<3u;octave++){
    let resolved=phSmooth(4.0,7.0,wave/cell);
    if(resolved>0.0){
      let c=vec2<i32>(floor(pos/wave));var re=0.0;var im=0.0;var weight=0.0;
      for(var dy=-2;dy<=2;dy++){for(var dx=-2;dx<=2;dx++){
        let ix=c.x+dx;let iy=c.y+dy;let key=seed+octave*17u;
        let point=(vec2<f32>(f32(ix),f32(iy))+.15+.7*vec2<f32>(phHash(ix,iy,key),phHash(ix,iy,key+1u)))*wave;
        let off=(pos-point)/wave;let radius=length(off);if(radius>=2.0){continue;}
        let step=max(cell,wave*.4);let ox=vec2<f32>(step,0.0);let oy=vec2<f32>(0.0,step);
        let g=vec2<f32>(phHeight(point+ox)-phHeight(point-ox),phHeight(point+oy)-phHeight(point-oy));let len=max(1e-6,length(g));
        let jitter=(phHash(ix,iy,key+2u)-.5)*.5;let cs=cos(jitter);let sn=sin(jitter);
        let across=vec2<f32>(-g.y*cs-g.x*sn,-g.y*sn+g.x*cs)/len;
        let angle=6.28318530718*(dot(off,across)*(.85+.3*phHash(ix,iy,seed+3u))+phHash(ix,iy,seed+4u));
        let w=exp(-2.0*dot(off,off))*(1.0-phSmooth(1.3,2.0,radius));re+=w*cos(angle);im+=w*sin(angle);weight+=w;
      }}
      let cosine=clamp(re/sqrt(re*re+im*im+.015*weight*weight+1e-12),-1.0,1.0);let pattern=.636619772368*asin(cosine);
      delta+=min(wave*.025,slope*wave*.12)*intensity*mask*resolved*parent*pattern;
      parent*=.2*phSmooth(-.8,.7,pattern);
    }
    wave/=3.0;
  }
  return max(.3,h+delta);
}

// Optional inspector reconstruction warp; the compact fast default remains zero.
fn compactReconstructionPoint(xy:vec2<f32>)->vec2<f32>{
 let warp=p.values[13].y*min(16.0*p.values[0].w,p.values[1].x*.9);
 if(warp==0.0){return xy;}
 return xy+warp*vec2<f32>(fbm(xy/p.values[2].x+vec2<f32>(11.3,0.),1u,2u,.5,0.),fbm(xy/p.values[2].x+vec2<f32>(-4.7,2.9),1u,2u,.5,0.));
}

// The compact preset's positive reconstruction, selected by the shared scheduler.
@compute @workgroup_size(256)
fn compactReconstruct(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=1048576u){return;}let xy=(vec2<f32>(f32(i%1024u),f32(i/1024u))+0.5)*p.values[2].w;var r=0.0;if(p.values[4].x>0.0){r=ridge(xy/p.values[2].y,u32(p.values[2].z));}fine[i]=vec4<f32>(compactRegional((compactReconstructionPoint(xy)-p.values[1].y)/p.values[1].x-0.5),1.0,r,0.0);}
