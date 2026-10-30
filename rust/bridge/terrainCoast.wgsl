// The dedicated third simplex stream matches Rust's shore-noise fork.
// Fourteen header vec4s (profile, shore offsets, shore turns, character, six bumps), then
// each capsule is three vec4s: endpoints; radii/scale/phase; islet height/center/apron.
@group(0) @binding(6) var<storage, read> coast: array<vec4<f32>>;
fn headerValue(i:u32)->f32 {return coast[i/4u][i%4u];}
fn coastalHeight(xy:vec2<f32>, terrainHeight:f32)->f32 {
  let config=coast[0];let mask=u32(config.x);
  if(mask==0u){return terrainHeight;}
  // Same marine datum and smooth positive floor as Rust coastal plains.
  var height=terrainHeight;
  let datum=coast[1].w;
  if(datum>0.0){let relative=height-datum;height=0.3+0.5*(relative+sqrt(relative*relative+1.0));}
  let uv=xy/p.values[0].x;let footprint=p.values[2].w/p.values[0].x;
  var distance=-2.0;var scale=0.2;var isletHeight=0.0;var apron=1.0;
  if(mask!=255u){
    let character=coast[6];let fine=coast[7];
    let warped=uv+character.x*vec2<f32>(fbm(uv/character.y+vec2<f32>(5.2,1.3),2u,3u,0.5,footprint/character.y),
      fbm(uv/character.y+vec2<f32>(-7.7,9.1),2u,3u,0.5,footprint/character.y));
    // Seeded shoreline per sea direction, smoothly united as in Rust.
    var shore=10.0;
    for(var i=0u;i<8u;i++){
      if((mask&(1u<<i))==0u){continue;}
      let angle=f32(i)*0.7853981633974483+headerValue(16u+i);
      let d=headerValue(8u+i)-((warped.x-0.5)*sin(angle)-(warped.y-0.5)*cos(angle));
      let h=max(0.12-abs(shore-d),0.0)/0.12;
      shore=min(shore,d)-h*h*0.03;
    }
    distance=shore
      +character.z*fbm(uv/character.w,2u,7u,0.56,footprint/character.w)
      +fine.x*fbm(uv/fine.y,2u,5u,0.55,footprint/fine.y);
  }
  var cachedPhase=-1.0;var detail=0.0;
  for(var i=0u;i<u32(config.y);i++){
    let ends=coast[14u+i*3u];let shape=coast[15u+i*3u];let geology=coast[16u+i*3u];let delta=ends.zw-ends.xy;
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
  // Seeded bays and headlands, as in Rust; islets keep their own outline.
  if(isletHeight==0.0){
    for(var k=0u;k<min(u32(coast[7].z),6u);k++){
      let bump=coast[8u+k];let d2=dot(uv-bump.xy,uv-bump.xy)/(bump.z*bump.z);
      if(d2<1.0){distance+=bump.w*(1.0-d2)*(1.0-d2);}
    }
  }
  if(isletHeight>0.0){height=isletHeight;}
  let cliff=smooth01((fbm(uv/0.12,2u,3u,0.5,0.0)-0.20)/0.25);
  let widthVariation=0.65+1.1*smooth01(fbm(uv/0.21+vec2<f32>(11.7,-4.2),2u,3u,0.5,0.0)+0.5);
  let ramp=min(max(config.z,height/(p.values[0].x*0.45)),scale*0.18)*widthVariation*apron*(1.0-0.90*cliff);
  if(distance<=0.0){return -config.w*smooth01(-distance/(ramp*4.0));}
  return height*smooth01(distance/ramp);
}
