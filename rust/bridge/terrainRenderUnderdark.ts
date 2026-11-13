/**
 * Underdark (Outreterre) ground for the satellite looks (Render v2 family, Satellite 2 · Painted), shared by the
 * 2D map shader (web/src/ui/terrainGl.ts, WebGPU twin generated from it) and the 3D ground (terrain3d.ts).
 *
 * The world is one cave system: open floor keeps the relief, rock masses (the cave mask, 1 = rock) close it.
 * - floor: dark limestone/basalt and wet sediment, slope-dependent, damp near water, mineral streaks, teal moss
 *   and sparse bioluminescent fungi (hashed in world metres, LOD-stable, an even haze once unresolved);
 * - light: a low, cold key light and a dim ambient; no sun, no sky, no snow, no season;
 * - rock: near-black textured stone, a soft occlusion onto the floor near walls and a thin cold rim;
 * - water: deep dark blue-green, a faint luminous edge, no sky reflection.
 * Every function depends on world metres and the pixel footprint only: 2D and 3D draw the same ground.
 */
export const UNDERDARK_GLSL = `
// Fungal farms (champignonnières): x, y, half-size (m), row angle of each farm lot, up to 32.
uniform vec4 uFarmBeds[32]; uniform int uFarmBedCount;
float udHash(vec2 p){
  uvec2 q=uvec2(ivec2(floor(p)));
  uint h=(q.x*374761393u)^(q.y*668265263u)^2654435769u;
  h=(h^(h>>13u))*1274126177u;h^=h>>16u;
  return float(h)/4294967296.;
}
float udNoise(vec2 p){
  vec2 i=floor(p),f=p-i,u=f*f*(3.-2.*f);
  return mix(mix(udHash(i),udHash(i+vec2(1.,0.)),u.x),mix(udHash(i+vec2(0.,1.)),udHash(i+vec2(1.,1.)),u.x),u.y);
}
// Four octaves from wavelength (m); each fades out between four and two pixels (no shimmer). About [-.5, .5].
float udFbm(vec2 world,float wavelength,float px){
  float sum=0.,amp=.5,norm=0.;
  for(int k=0;k<4;k++){
    float w=clamp(wavelength/px*.5-1.,0.,1.);
    sum+=amp*w*(udNoise(world/wavelength+vec2(float(k)*17.31,float(k)*9.17))-.5);norm+=amp;
    wavelength*=.5;amp*=.55;
  }
  return sum/norm;
}
// Cold, low key light from the north-west (fixed: there is no sun underground) over a dim ambient.
float udLight(vec2 gradient){
  vec3 n=normalize(vec3(-gradient*3.,1.));
  return .3+.95*max(dot(n,normalize(vec3(-.55,-.45,.62))),0.);
}
// Bioluminescent fungi: sparse specks (cyan, some violet) in clusters on damp floors. A speck smaller than a pixel
// gives way to the even glow of its cluster, so zooming out never sparkles.
vec3 underdarkFungi(vec2 world,float px,float moss){
  float cluster=smoothstep(.12,.32,udFbm(world+vec2(911.,377.),420.,px)+.3*moss);
  vec3 cyan=vec3(.15,.85,.90),violet=vec3(.62,.30,.95);
  if(cluster<=0.)return vec3(0.);
  float CELL=14.;
  vec2 g=world/CELL,i=floor(g),f=g-i;
  float h=udHash(i+vec2(53.,7.));
  vec2 c=vec2(udHash(i+vec2(1.,91.)),udHash(i+vec2(17.,3.)))*.6+.2;
  float size=.8+1.6*h,r=length((f-c)*CELL);
  float resolved=clamp(size*2./px-.5,0.,1.);
  float speck=(1.-smoothstep(size*.35,size+px,r))*step(.5,h);
  vec3 tint=mix(cyan,violet,step(.82,h));
  return cluster*(tint*speck*resolved*.75+mix(cyan,violet,.25)*.035*(1.-resolved));
}
// Stalagmites and fallen debris, resolved only when a few metres span several pixels. Returns (shade, lit):
// shade darkens (the cone's shadow, debris), lit brightens (the cone's lit flank).
vec2 underdarkFloorDetail(vec2 world,float px,float wet){
  vec2 r=vec2(0.);
  // Debris: pebbles and flakes on a 2.5 m lattice.
  {float CELL=2.5;vec2 g=world/CELL,i=floor(g),f=g-i;float h=udHash(i+vec2(5.,77.));
   vec2 c=vec2(udHash(i+vec2(9.,1.)),udHash(i+vec2(2.,13.)))*.7+.15;float size=.15+.35*h,d=length((f-c)*CELL);
   float resolved=clamp(size*3./px-.6,0.,1.);r.x+=.3*(1.-smoothstep(size*.6,size,d))*step(.82,h)*resolved;}
  // Stalagmites in clusters (dry floors), a cone lit from the key light with a short shadow.
  float cluster=smoothstep(.0,.25,udFbm(world+vec2(311.,-57.),160.,px))*(1.-wet);
  if(cluster>0.){
    float CELL=9.;vec2 g=world/CELL,i=floor(g),f=g-i;float h=udHash(i+vec2(71.,19.));
    if(h<.55*cluster){
      vec2 c=vec2(udHash(i+vec2(3.,57.)),udHash(i+vec2(41.,8.)))*.6+.2;float size=.6+1.6*udHash(i+vec2(88.,4.));
      vec2 d=(f-c)*CELL;float resolved=clamp(size*2.5/px-.6,0.,1.);
      float cone=1.-smoothstep(size*.7,size,length(d));
      float lit=cone*clamp(dot(normalize(d+1e-4),normalize(vec2(-.55,-.45)))*.5+.5,0.,1.)*(1.-length(d)/size);
      float shadow=(1.-smoothstep(size*.6,size*1.3,length(d-vec2(.55,.45)*size*1.2)))*(1.-cone);
      r+=resolved*vec2(.55*shadow+.25*cone,.9*lit);
    }
  }
  return r;
}
// Giant mushroom groves on damp floors, seen from above: domed caps (violet, rust, pale teal) lit by the key
// light, pale spots, a cast shadow and, on some, a luminous gill rim. Below a few pixels a cap gives way to
// the grove's mean tint. Returns the cap colour (rgb, unlit by the floor light) and its cover (a); shadow in .
vec4 underdarkMushroomCell(vec2 world,float px,float grove,float CELL,vec2 seed,out float shadow){
  shadow=0.;
  vec2 g=world/CELL+seed,i=floor(g),f=g-i;
  float h=udHash(i+vec2(17.,233.)+seed);
  if(h>.7*grove)return vec4(0.);
  vec2 c=vec2(udHash(i+vec2(5.,71.)),udHash(i+vec2(61.,2.)))*.56+.22;
  float room=min(min(c.x,1.-c.x),min(c.y,1.-c.y))*CELL;
  float size=min(room*.95,CELL*(.16+.2*udHash(i+vec2(23.,9.))));
  vec2 d=(f-c)*CELL;float r=length(d)/size;
  float resolved=clamp(size*2./px-.5,0.,1.);
  shadow=resolved*(1.-smoothstep(.75,1.15,length(d-vec2(.5,.42)*size*.55)/size))*step(1.,r);
  if(r>=1.)return vec4(0.);
  float k=udHash(i+vec2(88.,13.));
  vec3 cap=k<.45?vec3(.30,.19,.33):k<.8?vec3(.34,.21,.14):vec3(.20,.30,.27);
  cap*=.8+.4*udHash(i+vec2(1.,301.));
  vec3 n=normalize(vec3(d/size*1.3,sqrt(max(1.-r*r,0.))));
  float lit=.3+.85*max(dot(n,normalize(vec3(-.55,-.45,.62))),0.);
  vec2 sp=d/size*3.2+vec2(k*9.,h*7.);float spot=step(.72,udHash(floor(sp)+vec2(3.,3.)))*(1.-smoothstep(.18,.32,length(fract(sp)-.5)));
  vec3 col=mix(cap*lit*(1.-.35*smoothstep(.75,1.,r)),vec3(.62,.58,.52)*lit,.5*spot*step(.55,k));
  col+=step(.66,udHash(i+vec2(7.,7.)))*smoothstep(.84,.98,r)*vec3(.08,.42,.40);
  return vec4(col,(1.-smoothstep(1.-px/size,1.,r))*resolved);
}
// Giant mushroom groves on damp floors, seen from above: two jittered lattices of domed caps (violet, rust,
// pale teal) lit by the key light, pale spots, a cast shadow and, on some, a luminous gill rim. Unresolved caps
// give way to the grove's mean tint. Returns the cap colour (rgb) and its cover (a) and the cast shadow.
vec4 underdarkMushrooms(vec2 world,float px,float grove,out float shadow){
  shadow=0.;
  if(grove<=0.)return vec4(0.);
  float s1,s2;
  vec4 a=underdarkMushroomCell(world,px,grove,31.,vec2(0.),s1);
  vec4 b=underdarkMushroomCell(world,px,grove,19.,vec2(.37,.61),s2);
  shadow=max(s1,s2);
  vec4 cap=a.a>0.?a:b;
  vec3 mean=vec3(.19,.14,.17);
  float haze=.16*grove*(1.-clamp(14./px-.5,0.,1.));
  return vec4(mix(mean,cap.rgb,cap.a),max(cap.a,haze));
}
// Mushroom beds of the fungal farms: dark compost ridges in rows along the lot, pale caps in lines on each ridge,
// lighter walkways between; below a couple of pixels per row, an even compost tint. Returns colour and cover.
vec4 underdarkFarmBeds(vec2 world,float px){
  for(int k=0;k<32;k++){
    if(k>=uFarmBedCount)break;
    vec4 f=uFarmBeds[k];vec2 d=world-f.xy;
    if(dot(d,d)>f.z*f.z*2.)continue;
    vec2 a=vec2(cos(f.w),sin(f.w));vec2 l=vec2(dot(d,a),dot(d,vec2(-a.y,a.x)));
    vec2 hs=vec2(f.z,f.z*.62);
    float edge=min(hs.x-abs(l.x),hs.y-abs(l.y));
    if(edge<=0.)continue;
    float cover=smoothstep(0.,2.5,edge);
    if(cover<=0.)continue;
    float rows=clamp(3.2/px-.8,0.,1.);
    float ridge=smoothstep(.12,.22,fract(l.y/3.2))*(1.-smoothstep(.62,.72,fract(l.y/3.2)));
    vec3 compost=vec3(.12,.095,.075),walk=vec3(.24,.22,.19);
    vec2 g=vec2(l.x/1.3,l.y/3.2),i=floor(g),q=fract(g)-vec2(.5,.42);
    float cap=(1.-smoothstep(.16,.26,length(q*vec2(1.3,3.2)/1.3)))*step(.25,udHash(i+vec2(f.x,f.y)*.01));
    float capsOn=clamp(1.3/px-.7,0.,1.);
    vec3 detail=mix(walk,compost,ridge);
    detail=mix(detail,vec3(.58,.53,.45),cap*ridge*capsOn);
    vec3 mean=mix(walk,compost,.55);
    return vec4(mix(mean,detail,rows),cover);
  }
  return vec4(0.);
}
// Cave floor. s: height and gradient (m/m); wet: dampness near water (0-1); ao: occlusion near walls (0-1).
vec3 underdarkFloor(vec3 s,vec2 world,float px,float wet,float ao){
  float slope=length(s.yz);
  float mineral=udFbm(world,900.,px),grain=udFbm(world*1.7+vec2(31.,5.),60.,px),fine=udFbm(world+vec2(73.,41.),6.,px);
  float rocky=smoothstep(.12,.45,slope+.15*grain);
  vec3 c=mix(vec3(.27,.24,.20),vec3(.33,.32,.31),smoothstep(-.15,.2,mineral));       // wet sediment -> limestone
  c=mix(c,vec3(.17,.17,.18),rocky);                                                   // basalt on slopes
  c*=1.+.35*grain+.25*fine;
  c=mix(c,vec3(.24,.17,.12),.35*smoothstep(.18,.3,mineral)*(1.-rocky));              // ochre mineral streaks
  c=mix(c,c*vec3(.55,.62,.66),wet);                                                   // damp floor near water
  float moss=smoothstep(.05,.25,udFbm(world+vec2(191.,23.),240.,px)+.25*wet-.1)*(1.-rocky);
  c=mix(c,vec3(.15,.24,.20)*(1.+.5*fine),.7*moss);                                    // moss and lichen
  vec4 beds=underdarkFarmBeds(world,px);
  vec2 detail=underdarkFloorDetail(world,px,wet)*(1.-beds.a);
  c=c*(1.-detail.x)+vec3(.30,.29,.27)*detail.y;
  c=mix(c,beds.rgb,beds.a);
  c*=udLight(s.yz)*(1.-.62*ao);
  float grove=smoothstep(.04,.2,udFbm(world+vec2(-517.,233.),520.,px)+.1*wet+.2*moss-.1)*(1.-rocky)*(1.-smoothstep(.15,.45,wet))*(1.-beds.a);
  float shade;vec4 cap=underdarkMushrooms(world,px,grove,shade);
  c*=1.-.55*shade;
  c=mix(c,cap.rgb*(1.-.45*ao),cap.a);
  return c+underdarkFungi(world,px,moss)*(1.-.6*ao)*(1.-cap.a);
}
// Rock mass over the floor; rim: the thin cold light where floor meets wall (0-1).
vec3 underdarkRock(vec3 s,vec2 world,float px,float rim){
  float t=udFbm(world+vec2(401.,13.),180.,px)+.6*udFbm(world*1.3+vec2(17.,88.),25.,px);
  // Crags of the rock surface carry the form: a dim key light over near-black stone, a lit ledge at the wall.
  vec3 c=vec3(.075,.072,.08)*(1.+.8*t)*(.18+.95*udLight(s.yz));
  // Fractured bedrock: ridged cracks at three scales (narrower when smaller), faded before they alias, over a fine grain.
  float crack=0.;
  for(int k=0;k<3;k++){
    float len=k==0?140.:k==1?38.:10.,w=clamp(len/px*.35-1.,0.,1.);
    vec2 q=world/len+vec2(float(k)*41.7,float(k)*13.3);q+=.35*vec2(udNoise(q*1.7+3.1),udNoise(q*1.7-8.4));
    float sharp=k==0?.955:k==1?.965:.975;
    crack=max(crack,w*(k==2?.7:1.)*smoothstep(sharp-.06,sharp,1.-abs(2.*udNoise(q)-1.)));
  }
  c*=1.+.55*udFbm(world+vec2(5.,61.),4.,px)+.3*udFbm(world+vec2(29.,3.),1.2,px);
  // Faceted blocks once a few metres span several pixels: a crag micro-relief lit by the key light.
  float facet=clamp(26./px*.25-.5,0.,1.);
  if(facet>0.){
    float e=max(px,.8);
    vec2 q=world+vec2(71.,-13.);
    float hx=udFbm(q+vec2(e,0.),26.,px)+.5*udFbm(q+vec2(e,0.)+vec2(9.,4.),8.,px)-udFbm(q-vec2(e,0.),26.,px)-.5*udFbm(q-vec2(e,0.)+vec2(9.,4.),8.,px);
    float hy=udFbm(q+vec2(0.,e),26.,px)+.5*udFbm(q+vec2(0.,e)+vec2(9.,4.),8.,px)-udFbm(q-vec2(0.,e),26.,px)-.5*udFbm(q-vec2(0.,e)+vec2(9.,4.),8.,px);
    vec3 fn=normalize(vec3(-vec2(hx,hy)/(2.*e)*14.,1.));
    float lit=max(dot(fn,normalize(vec3(-.55,-.45,.62))),0.);
    c*=mix(1.,.45+1.1*lit,facet);
  }
  c*=1.-.6*crack;
  return c+vec3(.16,.17,.17)*rim;
}
// Cave water: depth in metres, edge 0-1 near the shore (faint luminous rim).
vec3 underdarkWater(vec2 world,float px,float depth,float edge){
  vec3 c=mix(vec3(.04,.11,.12),vec3(.016,.055,.065),smoothstep(0.,4.,depth));
  // Slow ripples catching the faint glow of the fungi.
  c*=1.+.3*udFbm(world+vec2(77.,301.),40.,px)+.25*udFbm(world*vec2(1.,2.3)+vec2(13.,5.),9.,px);
  return c+vec3(.04,.17,.18)*edge;
}
// Satellite 2 · Painted: the same values as sepia washes on the parchment.
vec3 underdarkPaper(vec3 c){
  float l=clamp(dot(c,vec3(.3,.55,.15))*2.6,0.,1.);
  return mix(vec3(.17,.13,.10),vec3(.66,.58,.44),l);
}
`;

/** Underdark fungal farms for the ground shaders: x, y, half-size (m), row angle per lot, up to 32. The underdark
 * plans no rural holdings, so each town also gets a ring of mushroom beds around its built extent (deterministic);
 * rock and water drawn over them hide any that fall off the cave floor. */
export function underdarkFarmBeds(farms: readonly { pos: { x: number; y: number }; angle: number; lot?: readonly { x: number; y: number }[] }[] | undefined,
  towns: readonly { center: { x: number; y: number }; radius?: number; main?: boolean }[] = []): Float32Array {
  const out = new Float32Array(128);
  let k = 0;
  const push = (x: number, y: number, size: number, angle: number) => { if (k < 32) out.set([x, y, size, angle], 4 * k++); };
  for (const f of farms ?? []) {
    let size = 55;
    if (f.lot?.length) { const xs = f.lot.map(p => p.x), ys = f.lot.map(p => p.y); size = Math.max(25, Math.min(140, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * .7)); }
    push(f.pos.x, f.pos.y, size, f.angle);
  }
  const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (const t of towns) {
    const r = Math.max(60, t.radius ?? 150), count = t.main ? 4 : 2;
    for (let j = 0; j < count; j++) {
      const a = (j + hash(t.center.x, t.center.y + j)) / count * Math.PI * 2, d = r * (1.15 + .45 * hash(t.center.y, t.center.x + j));
      push(t.center.x + Math.cos(a) * d, t.center.y + Math.sin(a) * d, 30 + 25 * hash(j, t.center.x), a + Math.PI / 2 + (hash(t.center.x + j, 3) - .5) * .6);
    }
  }
  return out;
}
