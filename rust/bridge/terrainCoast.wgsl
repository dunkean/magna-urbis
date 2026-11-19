// The dedicated third simplex stream matches Rust's shore-noise fork.
// Sixteen header vec4s (profile, unused offsets and turns, character, six bumps, then the
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
    if(base+coast[7].w*s*0.165<=distance){continue;}
    if(shape.w!=cachedPhase){
      detail=coast[7].w*s*(0.14*fbm(uv/(s*1.1)+vec2<f32>(shape.w,-shape.w),2u,7u,0.56,footprint/(s*1.1))
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
  // Seeded bays and headlands, as in Rust; islets keep their own outline.
  if(isletHeight==0.0){
    for(var k=0u;k<min(u32(coast[7].z),6u);k++){
      let bump=coast[8u+k];let d2=dot(uv-bump.xy,uv-bump.xy)/(bump.z*bump.z);
      if(d2<1.0){distance+=coast[7].w*bump.w*(1.0-d2)*(1.0-d2);}
    }
    // Fitted shift and relief drowning, as Rust `Coast::distance`.
    let fit=coast[14];distance+=fit.x;
    if(fit.z!=0.0){distance+=fit.w*tanh(clamp((height-fit.y)*fit.z,-9.0,9.0))*smooth01(1.0-abs(distance)/coast[15].x);}
  }
  if(isletHeight>0.0){height=isletHeight;}
  let shoreNoise=fbm(uv/0.12,2u,3u,0.5,0.0);
  let cliff=smooth01((shoreNoise-0.20)/0.25);
  let widthVariation=0.65+1.1*smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);
  let ramp=min(max(config.z,height/(p.values[0].x*0.45)),scale*0.18)*widthVariation*apron*(1.0-0.90*cliff);
  if(distance<=0.0){return -config.w*smooth01(-distance/(ramp*4.0*coast[15].y));}
  let original=height*smooth01(distance/ramp);
  let inland=distance*p.values[0].x;
  var band=coast[1].y;
  if(isletHeight>0.0){band=min(band,scale*p.values[0].x*0.15);}
  let t=clamp((inland-band*0.25)/(band*0.75),0.0,1.0);
  let join=t*t*t*(10.0+t*(-15.0+6.0*t));
  let low=min(height,inland*0.015);
  let gentle=min(original,low+(height-low)*join);
  let share=coast[2].x;
  var rock=0.0;
  if(share>=1.0){rock=1.0;}
  else if(share>0.0){
    let fit=coast[14];
    let z=tanh(clamp((height-fit.y)*fit.z,-9.0,9.0));
    rock=smooth01((shoreNoise+0.15*z-(0.65-1.3*share))/0.15+0.5);
  }
  return original+coast[1].x*(1.0-rock)*(gentle-original);
}
