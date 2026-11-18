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
 * Every function depends on world metres and the pixel footprint only: 2D and 3D draw the same ground. Mushroom caps
 * follow the crown rule over water (terrainCrownWater.ts): the host shader includes CROWN_WATER_GLSL and defines
 * crownFootWater(world) (water cover 0-1 at a point) before this module; it reads udCapCover for the water mix.
 */
/** Fungus-farm look of the cultivated land (occupation class 13) in the satellite looks and the 3D (2D beds and 3D farm
 * mushrooms). Off: the user rejected it; the drawing code stays, unreachable, until a new look is validated. */
export const UNDERDARK_FARMS = false;
export const UNDERDARK_GLSL = `
// Resolved cover of the mushroom cap drawn at this fragment (0-1), set by underdarkFloor: the water mix keeps it whole.
float udCapCover=0.;
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
  if(udHash(i+vec2(401.,77.))>.2)return vec4(0.);
  vec2 c=vec2(udHash(i+vec2(5.,71.)),udHash(i+vec2(61.,2.)))*.56+.22;
  // A cap is one object: whether it exists is decided once, by the grove field at its centre (fungusGroveAt in
  // ui/terrain3dFungi.ts), never per pixel by the slope, the water or the land under each pixel.
  vec2 cw=(i+c-seed)*CELL;
  float groveAt=smoothstep(.04,.2,udFbm(cw+vec2(-517.,233.),520.,px)+.2*smoothstep(.05,.25,udFbm(cw+vec2(191.,23.),240.,px)-.1)-.1);
  if(h>.7*groveAt)return vec4(0.);
  float room=min(min(c.x,1.-c.x),min(c.y,1.-c.y))*CELL;
  float size=min(room*.95,CELL*(.16+.2*udHash(i+vec2(23.,9.))));
  vec2 d=(f-c)*CELL;float r=length(d)/size;
  float resolved=clamp(size*2./px-.5,0.,1.);
  shadow=resolved*(1.-smoothstep(.75,1.15,length(d-vec2(.5,.42)*size*.55)/size))*step(1.,r);
  if(r>=1.&&shadow<=0.)return vec4(0.);
  // A cap stands only on land: its stem (the cap's centre) out of the water (crownRooted), then drawn whole over the bank.
  if(!crownRooted(crownFootWater((i+c-seed)*CELL))){shadow=0.;return vec4(0.);}
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
  shadow=0.;udCapCover=0.;
  if(grove<=0.)return vec4(0.);
  float s1,s2;
  vec4 a=underdarkMushroomCell(world,px,grove,31.,vec2(0.),s1);
  vec4 b=underdarkMushroomCell(world,px,grove,19.,vec2(.37,.61),s2);
  shadow=max(s1,s2);
  vec4 cap=a.a>0.?a:b;
  udCapCover=cap.a;
  vec3 mean=vec3(.19,.14,.17);
  float haze=.16*grove*(1.-clamp(14./px-.5,0.,1.));
  return vec4(mix(mean,cap.rgb,cap.a),max(cap.a,haze));
}
// Fungus beds (occupation class 13, FUNGUS_BED in web/src/ui/forestOccupation.ts): organic patches of dense low
// mushrooms, no straight edge, no rows. The bilinear share of class 13 over the 2×2 texels (as forestOpenShares), its
// edge warped by an fbm; pale, ochre and violet caps on a dark compost, resolved near, an even tint far.
float underdarkBedShare(vec2 world){
  if(uHasOccupation==0)return 0.;
  float n=uOccupationN;vec2 g=(world-uOccupationRect.xy)/uOccupationRect.z*n-.5,f=fract(g);ivec2 b=ivec2(floor(g)),hi=ivec2(int(n)-1);
  float share=0.;
  for(int k=0;k<4;k++){
    ivec2 o=ivec2(k-2*(k/2),k/2);float cls=texelFetch(uOccupation,clamp(b+o,ivec2(0),hi),0).b*255.;
    share+=(abs(cls-13.)<.5?1.:0.)*(o.x==1?f.x:1.-f.x)*(o.y==1?f.y:1.-f.y);
  }
  return share;
}
// Switch of the farm look (UNDERDARK_FARMS): off until a new look is validated; the cultivated land is bare floor.
const bool UD_FARMS=${UNDERDARK_FARMS};
vec3 udBedLight=vec3(0.);
// Share of the painted grove caps (1 in 2D; the 3D ground lowers it where its modelled mushrooms stand).
float udPaintCaps=1.;
// A mushroom farm on the cultivated land: fields (44 m blocks) each with its own row direction and spacing; rows of
// compost beds broken by cross paths, every fifth row a path; per bed one cap size and colour, caps at a jittered
// spacing along the bed; a few beds glow (udBedLight). Same layout as the 3D farms (ui/terrain3dFungi.ts, section 3).
vec4 underdarkFarmBeds(vec2 world,float px){
  udBedLight=vec3(0.);
  if(!UD_FARMS)return vec4(0.);
  float share=underdarkBedShare(world);
  if(share<=0.)return vec4(0.);
  float cover=smoothstep(.3,.7,share+.45*udFbm(world+vec2(613.,-41.),55.,px));
  if(cover<=0.)return vec4(0.);
  vec2 b=floor(world/44.),d=world-(b+.5)*44.;
  float angle=udHash(b+vec2(3001.,7.))*3.14159265,spacing=2.2+.9*udHash(b+vec2(3003.,11.));
  vec2 dir=vec2(cos(angle),sin(angle));
  float u=dot(d,dir),v=dot(d,vec2(-dir.y,dir.x)),r=floor(v/spacing+.5),dv=v-r*spacing;
  float len=6.+6.*udHash(vec2(b.x+r,b.y+3005.)),seg=floor(u/len),within=u/len-seg;
  float bed=udHash(vec2(b.x*131.+r,b.y*71.+seg)),size=bed<.4?.3:bed<.8?.5:.8;
  bool path=mod(r,5.)>3.5||within>.84||bed>.93;
  vec3 walk=vec3(.20,.185,.16),compost=vec3(.085,.07,.06)*(1.+.3*udFbm(world+vec2(31.,-77.),9.,px));
  float rows=clamp(spacing/px*.5-.5,0.,1.);
  float ridge=path?0.:1.-smoothstep(.42,.6,abs(dv));
  vec3 tint=bed<.45?vec3(.56,.52,.45):bed<.75?vec3(.50,.37,.24):vec3(.44,.35,.40);
  float pitch=size*2.,k=floor(u/pitch),along=(fract(u/pitch)-.5)*pitch+(udHash(vec2(k,r+b.y))-.5)*size*.6;
  float cap=ridge*(1.-smoothstep(size*.35,size*.5,length(vec2(along,dv))))*clamp(size*2.5/px-.6,0.,1.);
  vec3 c=mix(walk,compost,ridge);
  c=mix(c,tint*(.85+.3*udHash(vec2(k,seg+r))),cap);
  vec3 mean=mix(walk,compost,.6);
  if(!path&&udHash(vec2(b.x+seg,b.y+r*7.))<.06)udBedLight=(bed>.5?vec3(.62,.30,.95):vec3(.15,.85,.90))*(cap*.6+.05*ridge)*cover;
  return vec4(mix(mean,c,rows),cover);
}
// The few glowing beds of the farms (set by underdarkFarmBeds).
vec3 underdarkBedGlow(vec2 world,float px,float cover){return udBedLight;}
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
  // No damp-floor cut: near water a cap is kept or dropped whole by its foot (underdarkMushroomCell), not sliced by the shore.
  // Where caps may stand (an early out and the far haze); each cap is decided at its own centre (underdarkMushroomCell).
  float grove=smoothstep(-.02,.2,udFbm(world+vec2(-517.,233.),520.,px)+.2*moss-.1);
  float shade;vec4 cap=underdarkMushrooms(world,px,grove,shade);
  cap.a*=udPaintCaps;shade*=udPaintCaps;
  c*=1.-.55*shade;
  c=mix(c,cap.rgb*(1.-.45*ao),cap.a);
  if(uNight==0)c+=vec3(.20,.12,.05)*beds.a; // inhabited period: farm lamps, using the existing ambience flag
  return c+underdarkBedGlow(world,px,beds.a)*(1.-.6*ao);
}
// Rock mass over the floor; rim: the thin cold light where floor meets wall (0-1).
vec3 underdarkRock(vec3 s,vec2 world,float px,float rim){
  float t=udFbm(world+vec2(401.,13.),180.,px)+.6*udFbm(world*1.3+vec2(17.,88.),25.,px);
  // Basalt: near-black, slightly cool and matte; the crags carry the form under a dim key light, a lit ledge at the wall.
  vec3 c=vec3(.052,.056,.066)*(1.+.6*t)*(.25+.9*udLight(s.yz));
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
  // Basalt column tops seen from above, on the level tops of the masses only: an irregular Voronoi of five- to
  // seven-sided cells whose size wanders between about 3 and 6 m, joints only slightly darker, each top a little
  // tilted so the key light picks some out; gone before the cells shrink to a few pixels.
  float columns=clamp(3.4/px*.25-.6,0.,1.)*(1.-smoothstep(.06,.25,length(s.yz)));
  if(columns>0.){
    float scale=4.5*(.7+.6*udNoise(world/37.+vec2(13.,7.)));
    vec2 p=world/scale,i=floor(p),f=p-i,id=i;float d1=9.,d2=9.;
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
      vec2 o=vec2(float(x),float(y)),cc=o+vec2(udHash(i+o+vec2(3.,17.)),udHash(i+o+vec2(29.,5.)))*.85+.075;
      float d=length(cc-f);
      if(d<d1){d2=d1;d1=d;id=i+o;}else if(d<d2)d2=d;
    }
    float joint=1.-smoothstep(.04,.12+1.2*px,(d2-d1)*.5*scale);
    vec3 tn=normalize(vec3((vec2(udHash(id+vec2(41.,3.)),udHash(id+vec2(7.,59.)))-.5)*.4,1.));
    float top=(.9+.2*udHash(id+vec2(11.,47.)))*(.88+.24*max(dot(tn,normalize(vec3(-.55,-.45,.62))),0.));
    c*=mix(1.,top*(1.-.2*joint),columns);
  }
  // A wall seen from above (the steep ramp at the edge of a mass): darker, the shadowed face of the cave wall.
  c*=1.-.45*smoothstep(.35,1.4,length(s.yz));
  return c+vec3(.15,.16,.17)*rim;
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
export function underdarkFarmBeds(farms: readonly { pos: { x: number; y: number }; angle: number; lot?: readonly { x: number; y: number }[] }[] | undefined, towns: readonly { center: { x: number; y: number }; radius?: number; main?: boolean }[] = []): Float32Array {
  const out = new Float32Array(128);
  let k = 0;
  const push = (x: number, y: number, size: number, angle: number) => {
    if (k < 32) out.set([x, y, size, angle], 4 * k++);
  };
  for (const f of farms ?? []) {
    let size = 55;
    if (f.lot?.length) {
      const xs = f.lot.map(p => p.x),
        ys = f.lot.map(p => p.y);
      size = Math.max(25, Math.min(140, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.7));
    }
    push(f.pos.x, f.pos.y, size, f.angle);
  }
  const hash = (a: number, b: number) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  for (const t of towns) {
    const r = Math.max(60, t.radius ?? 150),
      count = t.main ? 4 : 2;
    for (let j = 0; j < count; j++) {
      const a = ((j + hash(t.center.x, t.center.y + j)) / count) * Math.PI * 2,
        d = r * (1.15 + 0.45 * hash(t.center.y, t.center.x + j));
      push(t.center.x + Math.cos(a) * d, t.center.y + Math.sin(a) * d, 30 + 25 * hash(j, t.center.x), a + Math.PI / 2 + (hash(t.center.x + j, 3) - 0.5) * 0.6);
    }
  }
  return out;
}
