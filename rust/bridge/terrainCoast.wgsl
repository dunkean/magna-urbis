// The dedicated third simplex stream matches Rust's shore-noise fork.
// Sixteen header vec4s (profile, smoothing and natural slope, cliff and shore cut, character, six bumps, then the
// relief fit: shift/median/inverse spread/drowning and band/shelf/sea count/field n), then
// the sea capsules, two vec4s each (endpoints; radii), then the optional row-major n*n
// sea field padded to a vec4, then each land capsule is three vec4s:
// endpoints; radii/scale/phase; islet height/center/apron. Same layout as Rust `Coast`.
@group(0) @binding(6) var<storage, read> coast: array<vec4<f32>>;
fn coastFieldValue(base:u32,k:u32)->f32 {
  return coast[base+k/4u][k%4u];
}
// Cell-centred bilinear sea distance, with constant extension beyond the grid.
fn coastSeaField(point:vec2<f32>,n:u32,base:u32)->f32 {
  let f=clamp(point*f32(n)-vec2<f32>(0.5),vec2<f32>(0.0),vec2<f32>(f32(n-1u)));
  let i0=vec2<u32>(floor(f));let i1=min(i0+vec2<u32>(1u),vec2<u32>(n-1u));
  let t=f-vec2<f32>(i0);
  let north=mix(coastFieldValue(base,i0.y*n+i0.x),coastFieldValue(base,i0.y*n+i1.x),t.x);
  let south=mix(coastFieldValue(base,i1.y*n+i0.x),coastFieldValue(base,i1.y*n+i1.x),t.x);
  return mix(north,south,t.y);
}
// The same C2 width field as Rust smoothing_width, from the shore-noise permutation.
fn coastSplineWeights(t:f32)->vec4<f32> {
  let t2=t*t;let t3=t2*t;
  return vec4<f32>((1.0-t)*(1.0-t)*(1.0-t),3.0*t3-6.0*t2+4.0,-3.0*t3+3.0*t2+3.0*t+1.0,t3)/6.0;
}
fn coastWidthWave(xy:vec2<f32>)->f32 {
  let point=xy/1200.0;let cell=vec2<i32>(floor(point));let f=fract(point);
  let wx=coastSplineWeights(f.x);let wy=coastSplineWeights(f.y);var wave=0.0;
  for(var j=0u;j<4u;j++){for(var i=0u;i<4u;i++){
    let cx=u32((cell.x+i32(i)-1)&255);let cy=u32((cell.y+i32(j)-1)&255);
    let value=f32(perm[1024u+cx+perm[1024u+cy]])/127.5-1.0;
    wave+=wx[i]*wy[j]*value;
  }}
  return tanh(2.0*wave);
}
// As Rust `relief_rank`, `rise` and `cliff`.
fn coastRank(height:f32)->f32 {let fit=coast[14];return tanh(clamp((height-fit.y)*fit.z,-9.0,9.0));}
fn coastRise(x:f32,toe:f32)->f32 {let t=clamp(x,0.0,1.0);return t*t*(3.0-2.0*t)+toe*t*(1.0-t)*(1.0-t);}
fn coastCliff(gentle:f32,islet:f32,width:f32)->f32 {
  var limit=min(coast[2].x,width*0.004);
  if(islet>0.0){limit=min(limit,islet*0.04);}
  return limit*smooth01((0.28-gentle)/0.2);
}
fn coastalHeight(xy:vec2<f32>, terrainHeight:f32)->f32 {
  let config=coast[0];let mask=u32(config.x);
  if(mask==0u){return terrainHeight;}
  // Same marine datum and smooth positive floor as Rust coastal plains.
  var height=terrainHeight;
  let datum=coast[1].w;
  if(datum>0.0){let relative=height-datum;height=0.3+0.5*(relative+sqrt(relative*relative+1.0));}
  let uv=xy/p.values[0].x;let footprint=p.values[2].w/p.values[0].x;
  let seaCount=u32(coast[15].z);let fieldN=u32(coast[15].w);
  let fieldBase=16u+2u*seaCount;
  var distance=-2.0;var scale=0.2;var isletHeight=0.0;var apron=1.0;
  if(mask!=255u){
    let character=coast[6];let fine=coast[7];
    let warped=uv+character.x*vec2<f32>(fbm(uv/character.y+vec2<f32>(5.2,1.3),2u,3u,0.5,footprint/character.y),
      fbm(uv/character.y+vec2<f32>(-7.7,9.1),2u,3u,0.5,footprint/character.y));
    // Union of the traced field and edge-sea capsules, positive in the sea.
    var sea=-10.0;
    if(fieldN>0u){
      sea=coastSeaField(warped,fieldN,fieldBase);
    }
    for(var k=0u;k<seaCount;k++){
      let ends=coast[16u+k*2u];let radii=coast[17u+k*2u];let delta=ends.zw-ends.xy;
      let t=clamp(dot(warped-ends.xy,delta)/max(dot(delta,delta),1e-12),0.0,1.0);
      sea=max(sea,mix(radii.x,radii.y,t)-length(warped-ends.xy-t*delta));
    }
    distance=-sea
      +character.z*fbm(uv/character.w,2u,7u,0.56,footprint/character.w)
      +fine.x*fbm(uv/fine.y,2u,5u,0.55,footprint/fine.y);
  }
  var cachedPhase=-1.0;var detail=0.0;
  let land=fieldBase+(fieldN*fieldN+3u)/4u;
  for(var i=0u;i<u32(config.y);i++){
    let ends=coast[land+i*3u];let shape=coast[land+1u+i*3u];let geology=coast[land+2u+i*3u];let delta=ends.zw-ends.xy;
    let t=clamp(dot(uv-ends.xy,delta)/max(dot(delta,delta),1e-12),0.0,1.0);
    let base=mix(shape.x,shape.y,t)-length(uv-ends.xy-t*delta);let s=shape.z;
    if(base+s*0.165<=distance){continue;}
    if(shape.w!=cachedPhase){
      detail=s*(0.14*fbm(uv/(s*1.1)+vec2<f32>(shape.w,-shape.w),2u,7u,0.56,footprint/(s*1.1))
        +0.025*fbm(uv/(s*0.13)+vec2<f32>(-shape.w,shape.w),2u,4u,0.55,footprint/(s*0.13)));
      cachedPhase=shape.w;
    }
    if(base+detail>distance){
      distance=base+detail;scale=s;apron=geology.w;
      // Same shared rise as Rust: a few meters, no tiny-islet or rocky relief.
      isletHeight=geology.x;
      if(apron>1.0){
        let size=smooth01((s/3.0-0.009)/0.016);
        let radial=length(uv-geology.yz)/(s*0.6);
        let rise=8.0*(0.75+0.25*cos(shape.w));
        isletHeight+=rise*size*(1.0-smooth01(radial));
      }
    }
  }
  // Stretches of coast, as Rust `gentleness`.
  let gentle=smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);
  // Seeded bays and headlands, as in Rust; islets keep their own outline.
  if(isletHeight==0.0){
    for(var k=0u;k<min(u32(coast[7].z),6u);k++){
      let bump=coast[8u+k];let d2=dot(uv-bump.xy,uv-bump.xy)/(bump.z*bump.z);
      if(d2<1.0){distance+=bump.w*(1.0-d2)*(1.0-d2);}
    }
    // Fitted shift and relief drowning, as Rust `Coast::distance`.
    let fit=coast[14];distance+=fit.x;
    distance+=fit.w*coastRank(height)*smooth01(1.0-abs(distance)/coast[15].x);
    // Fractal cut near the shoreline, as Rust `shore_cut`.
    let near=1.0-abs(distance)/0.03;
    if(near>0.0){distance+=coast[2].y*(1.15-gentle)*smooth01(near)*fbm(uv/0.012+vec2<f32>(31.7,-8.3),2u,4u,0.6,footprint/0.012);}
  }
  let width=p.values[0].x;
  let islet=isletHeight>0.0;
  if(islet){height=isletHeight;}
  if(distance<=0.0){
    let ramp=max(min(max(config.z,height/(width*0.45)),scale*0.18),config.w/width);
    return -config.w*coastRise(-distance/(4.0*ramp*apron*coast[15].y*(0.65+1.1*gentle)),0.5);
  }
  // Smooth low-frequency stretches of variable width, matching Rust smoothing_width.
  let metres=distance*width;let profile=coast[1];
  let isletSize=select(0.0,scale*width,islet);
  let cliff=coastCliff(gentle,isletSize,width);
  var band=profile.x;
  if(profile.y>0.0){band*=1.0+profile.y*coastWidthWave(xy);}
  band=min(band,width*0.12)*(1.0-0.85*smooth01(cliff/20.0));
  var ground=height;
  if(band>0.0){ground*=coastRise(metres/band,0.3);}
  if(ground<=0.0){return ground;}
  // Natural height limit behind the shore, as Rust `ceiling`.
  var rank=0.0;
  if(!islet){rank=coastRank(height);}
  let steep=1.0-gentle;
  let tilt=clamp(sqrt(250.0/max(profile.x,40.0)),0.5,1.6);
  let slope=profile.z*(0.65+0.7*steep)*tilt*(1.0+0.35*rank)/sqrt(apron);
  let beach=0.25+0.75*steep;
  let ease=beach+(1.0-beach)*metres/(metres+min(width*0.012,120.0));
  var limit=cliff*smooth01(metres/(1.0+0.6*cliff))+slope*metres*ease;
  if(!islet&&coast[0].x!=255.0){limit+=metres*metres/(260.0*clamp(1500.0/max(scale*width,1.0),1.0,6.0));}
  let low=min(ground,limit);let ratio=low/max(ground,limit);let square=ratio*ratio;
  return low/sqrt(sqrt(1.0+square*square));
}
