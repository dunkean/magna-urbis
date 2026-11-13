/** Open (non-wooded, non-tilled) ground of the Render v2 satellite look: plains, wetlands, steppe,
 * desert surfaces (sand seas and dunes, gravel plains, rock pavements, salt pans) and arctic ground.
 * Emitted in RENDER_V2_GLSL after the relief and winter modules, before v2ZoneEnv / v2ZoneOpen.
 * The per-zone tables (V2_ZONE_UNITS, V2_ZONE_PAVEMENT, V2_ZONE_GRAVEL, V2_ZONE_PAN) live in terrainRenderV2Zones. */
export const RENDER_V2_GROUND_GLSL = `
// Slope (dH/dx, dH/dy, m/m) of the procedural landforms of this fragment that the height layer does not
// carry (dunes): already footprint-filtered, zero where there is none. Written while the open ground is
// evaluated (v2GroundEnv), then added to the ground normal and to the macro normal read by crowns and relief light.
vec2 v2GroundFormSlope=vec2(0.);
// Geomorphic units of the open ground of this fragment, as exclusive shares (0..1): x sand sea, y gravel plain,
// z rock pavement (hamada, blockfield, limestone pavement, lateritic crust), w pan (salt or clay flat).
// Set by v2ZoneEnv (v2GroundUnits), painted by v2ZoneOpen.
vec4 v2GroundUnit=vec4(0.);
// Site of this fragment: x damp rim around a pan, y wash (pale channel floor of a hollow), z relief position
// (-1 hollow, 1 knob, from the 300 m TPI), w the 900 m mottle of v2ZoneEnv.
vec4 v2GroundSite=vec4(0.);
// Level of a unit-variance field above which a share of the ground lies (logistic approximation of the normal quantile).
float v2GroundQuantile(float share){float p=clamp(share,.001,.999);return .5*log((1.-p)/p);}
// Splits the open ground of a zone into its geomorphic units. Each unit is the part of a field above the level
// of its share (U, from V2_ZONE_UNITS); the fields combine the two stand mosaics already evaluated (2.4 km and
// 900 m), the relief position (pavements on knobs and plateaux, sand and pans in the low ground, pans on level
// floors only) and two finer octaves that make the contacts ragged. Contacts are a pixel wide: the units meet
// along lines that follow the relief, with no gradient between two tints. Pans cover sand, sand covers rock,
// rock covers gravel. 'open' removes woods, wet ground and water; occupied land (fields, towns) keeps the plain
// zone ground. A zone without units pays nothing.
void v2GroundUnits(vec4 U,float wash,vec3 s,vec2 world,float tpi,float fp,float mottle,float mosaic,float open){
  float slope=length(s.yz),rel=clamp(tpi*40.,-1.,1.);
  v2GroundUnit=vec4(0.);v2GroundSite=vec4(0.,0.,rel,mottle);
  if(open>.003&&U.x+U.y+U.z+U.w>0.){
    float free=open;
    if(uHasOccupation==1){
      // Tended land (fields, orchards, gardens, town ground, buildings, lanes) keeps the plain zone ground. Grazing,
      // commons and meadows cover most of the countryside of a map: in dry and cold zones they are the open ground
      // itself and carry its units.
      int cls=int(groundOccupation(world).z);
      if(cls==1||cls==4||cls==5||cls==7||cls==8||cls==9)free=0.;
    }
    float edge=0.;
    if(uQuality==0){
      for(int k=0;k<2;k++){
        if(fp<(k==0?63.:14.4))edge+=(k==0?.42:.2)*v2Pattern(vec3(world,0.),k==0?210.:48.,fp,uMaterialSeed+771u+uint(k));
      }
    }
    float w=clamp(.006*fp,.035,.6),gentle=1.-sstep(.10,.28,slope);
    float pan=0.,rim=0.,sand=0.,pave=0.,gravel=0.;
    if(U.w>0.){
      float f=-.6*(mosaic+mottle)-1.4*rel+.5*edge,q=v2GroundQuantile(U.w),floored=1.-sstep(.012,.04,slope);
      pan=sstep(q-w,q+w,f)*floored;rim=sstep(q-.3-w,q-.1,f)*floored*(1.-pan);
    }
    // Sand seas and gravel plains are broad (the 2.4 km mosaic splits them) and feather into the plain ground over
    // tens of metres; only rock and pans keep a crisp contact.
    float soft=max(w,.3);
    if(U.x>0.){float q=v2GroundQuantile(U.x);sand=sstep(q-soft,q+soft,.95*mosaic-.8*rel+.3*edge)*(1.-sstep(.06,.18,slope))*(1.-pan);}
    if(U.z>0.){float q=v2GroundQuantile(U.z);pave=sstep(q-w,q+w,.6*mosaic+1.4*rel+edge)*gentle*(1.-pan)*(1.-sand);}
    if(U.y>0.){float q=v2GroundQuantile(U.y);gravel=sstep(q-soft,q+soft,-.95*mosaic+.5*rel+.3*edge)*gentle*(1.-pan)*(1.-sand)*(1.-pave);}
    // Hollows with a gradient carry washed sand over the rock and gravel of dry zones.
    float fan=wash*sstep(.15,.6,-rel)*sstep(.015,.06,slope)*(1.-sstep(.2,.4,slope))*(1.-pan)*(1.-sand);
    pave*=1.-.85*fan;gravel*=1.-.7*fan;
    v2GroundUnit=vec4(sand,gravel,pave,pan)*free;v2GroundSite=vec4(rim*free,fan*free,rel,mottle);
  }
}
// Noise averaged along the fall line (four taps): rills, wash threads and stone stripes that follow the relief,
// with no global coordinate to swirl where the slope turns. Zero mean, about unit deviation.
float v2GroundStreak(vec2 world,vec2 fall,float across,uint salt){
  float n=0.;
  for(int i=0;i<4;i++)n+=surfaceNoise(vec3((world+fall*(.75*across*(float(i)-1.5)))/across,0.),salt);
  return n*.38;
}
// Dune field of a sand sea. Transverse ridges across the map's wind (the direction of the close-range ripples):
// one wavelength per map (150 to 500 m), a skewed profile (long gentle windward side, short slip face in the lee,
// about 26 degrees), crests bent and unevenly spaced by two warps, heights that swell and die out along the field,
// and second-order dunes of about a quarter of the wavelength riding on top, 25 degrees off the main crests.
// Adds the slope to v2GroundFormSlope and returns the zero-mean tone (pale crests, darker interdune floors).
// Each order fades between 8 and 4 pixels per local wavelength, so the far view converges to the flat mean.
float v2GroundDunes(vec2 world,float fp,float amount){
  uint salt=uMaterialSeed;float tone=0.;
  float lambda=150.+350.*float((salt>>10u)&255u)/255.;
  if(uQuality==0&&amount>.01&&fp<.3*lambda){
    float angle=float(salt&1023u)*.006135923;vec2 wind=vec2(cos(angle),sin(angle));
    vec3 bend=vec3(0.),kink=vec3(0.);
    for(int i=0;i<2;i++){vec3 n=surfaceBand(world,(i==0?3.6:1.3)*lambda,salt+781u+uint(i));if(i==0)bend=n;else kink=n;}
    float swell=(.55+.45*sstep(-1.2,.8,bend.x-.6*kink.x))*amount;
    for(int k=0;k<2;k++){
      float l=k==0?lambda:.23*lambda,wave=6.283185307/l,b=k==0?3.2:5.,c=k==0?1.5:3.5;
      vec2 dir=k==0?wind:vec2(.906*wind.x-.423*wind.y,.423*wind.x+.906*wind.y);
      float phase=dot(world,dir)*wave+b*bend.x+c*kink.x;
      vec2 rate=dir*wave+b*bend.yz+c*kink.yz;
      float keep=1.-sstep(.125,.25,fp*length(rate)/6.283185307);
      if(keep>0.){
        float skew=phase-.7*sin(phase),gain=swell*keep;
        v2GroundFormSlope+=(k==0?.03:.022)*l*gain*cos(skew)*(1.-.7*cos(phase))*rate;
        tone+=(k==0?.032:.025)*gain*sin(skew);
      }
    }
  }
  return tone;
}
// Colours and close-range structure of the units. Gravel plains take a grittier micro tone and a faint stone
// mosaic (the same cells as the pavements, without joints); pavements are dark
// jointed rock (block tones from afar, joints up close); pans are bright, with polygon cracks up close and a
// darker damp rim; washes are pale sand threaded along the fall line. Frost zones (pavement.a) sort their stones:
// coarse dark borders around polygons on level ground, stripes down the slopes ('stripe', a fall-line streak).
// 'thread' is the zero-mean line pattern of the same streak at the scale of the washes.
vec3 v2GroundPaint(vec3 c,int z,V2Env e,vec2 world,float fp,float stripe,float thread){
  vec4 U=v2GroundUnit,pave=V2_ZONE_PAVEMENT[z],grav=V2_ZONE_GRAVEL[z],pan=V2_ZONE_PAN[z];
  float rim=v2GroundSite.x,fan=v2GroundSite.y,tone=.93+.14*e.tone;
  vec3 micro=surfaceMicroTone,grit=vec3(1.)+1.6*(micro-vec3(1.));
  vec3 sand=V2_ZONE_BARE[z].rgb*vec3(1.07,1.04,.97);
  float block=0.,joint=0.,border=0.;
  float celled=U.y+U.z+U.w*pan.a;
  if(uQuality==0&&celled>.01&&fp<7.5){
    bool wide=U.w>U.y+U.z;
    for(int k=0;k<2;k++){
      float size=k==0?(wide?30.:14.):(wide?7.:3.2),keep=1.-sstep(size*.1,size*.25,fp);
      if(keep>0.){
        vec4 f=surfaceFacets(world/size,uMaterialSeed+791u+uint(k));
        block+=keep*(k==0?.10:.07)*f.x;
        // Rock shows the joints of its small blocks only; a pan cracks in broad polygons too.
        if(k==1||wide)joint=max(joint,keep*surfaceJoint(f.y,fp/size));
        // Centred share of a cell that lies near its joints: the coarse border of a sorted polygon.
        if(k==1)border=keep*(.55-sstep(.03,.2,f.y));
      }
    }
  }
  vec3 gravel=grav.rgb*tone*grit*(1.+(.35+.25*pave.a)*block+pave.a*(.09*stripe-.10*border));
  vec3 rock=pave.rgb*tone*micro*(1.+1.3*block-.16*joint+.07*pave.a*stripe);
  vec3 floored=pan.rgb*(vec3(1.)+.5*(micro-vec3(1.)))*(1.+pan.a*(.3*block-.22*joint));
  c=mix(c,gravel,U.y);c=mix(c,rock,U.z);c=mix(c,sand*tone*micro,U.x);
  c=mix(c,sand*micro*(1.+.10*thread),.6*fan);
  c=mix(c,pan.rgb*.56*micro,.75*rim);
  return mix(c,floored,U.w);
}
// Waterlogged low ground. Paddy zones keep rectangular parcels (one hash per rotated cell). Elsewhere the mosaic
// is organic: reed and sedge mats split along a ragged line, dark pools in the lowest ground (the wet mottle and
// the hollows) and thin meandering channels on the zero line of the broad field, kept about a pixel wide until
// they fade. The mats are lightened by the area the water takes, so the far view keeps the zone's wet colour.
vec3 v2GroundWetland(vec3 wet,int z,vec2 world,float fp){
  vec3 c=wet;
  if(z==9){
    vec2 q=mat2(.94,.34,-.34,.94)*world/vec2(170.,75.);
    uint h=groundHash(ivec3(ivec2(floor(q)),709),uMaterialSeed);
    float u1=float(h&255u)/255.,u2=float((h>>8u)&255u)/255.,keep=1.-sstep(60.,170.,fp);
    vec3 parcel=mix(wet*(.82+.36*u1),u2>.7?vec3(.49,.46,.32):u2<.1?vec3(.20,.27,.28):wet,.55);
    c=mix(wet,parcel,keep);
  }else if(uQuality==0){
    if(fp<45.){
      float broad=0.,fine=0.;
      for(int k=0;k<2;k++){
        if(fp<(k==0?45.:10.)){float n=v2Pattern(vec3(world,0.),k==0?150.:34.,fp,uMaterialSeed+741u+uint(k));if(k==0)broad=n;else fine=n;}
      }
      float seen=1.-sstep(18.,45.,fp),w=clamp(.02*fp,.05,.5),low=v2GroundSite.w-1.2*v2GroundSite.z;
      float sedge=sstep(-w,w,broad+.5*fine+.25*low)-.5;
      c=wet*(vec3(1.+.05*seen)+seen*sedge*vec3(.20,.10,-.04));
      float pond=sstep(-w,w,.45*low+.75*broad+.3*fine-1.2);
      float channel=broad-.3*fine,tight=min(900.,15000./max(fp*fp,.01));
      float line=exp2(-tight*channel*channel)*(1.-sstep(8.,20.,fp));
      c=mix(c,vec3(.13,.17,.17),max(.9*seen*pond,.8*line));
    }
  }
  return c;
}
`;
