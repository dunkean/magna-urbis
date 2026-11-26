/** Coastal swell and surf of the Render v2 satellite sea, on the 2D map.
 *
 * Seen from above at hundred-metre to metre scales, a coast shows swell crests that turn parallel to the shore and
 * bunch up as the water shoals, and a thin broken line of foam where they break on exposed shores; sheltered water
 * shows almost nothing. The crests are level lines of a phase built from the retained distance to the coast
 * (`uCoastDistance`, metres, positive at sea): with a shelving bottom the wavelength shrinks like the square root
 * of the distance, so the phase grows like its square root near the shore and linearly offshore. The surf band comes
 * from the refined height of the fragment (the drawn coastline), so it never drifts off the shore line. Exposure is
 * the open water in front of the shore, read up the swell's arrival direction (the seaward normal turned by the
 * map's obliquity) at two distances of the same field: a harbour or a narrow bay faces its other shore and stays calm.
 * Still image: the map is not animated. Every pattern fades before its wavelength reaches a few pixels, and the
 * swell fades with the map scale (none beyond about 4.5 m a pixel) and on silty brown water; the far view keeps a faint surf line on exposed
 * shores only.
 *
 * Emitted in the 2D map fragment shader after the water modules; it reads `uCoastDistance`, `uCoastOrigin`,
 * `uCoastWidth`, `uCoastN`, `uCoastalSea` (declared by the map shader) and `uMaterialSeed`. */
export const RENDER_V2_COAST_GLSL = `
uniform float uCoastWaves;
// Retained distance to the coast (bilinear) and its gradient (the seaward normal times |grad|), from one 2x2 read.
vec3 v2CoastField(vec2 world){
  vec2 g=clamp((world-uCoastOrigin)/uCoastWidth*float(uCoastN)-.5,vec2(0.),vec2(float(uCoastN-1)));
  ivec2 p=ivec2(floor(g)),q=min(p+1,ivec2(uCoastN-1));vec2 f=fract(g);
  float a=texelFetch(uCoastDistance,p,0).r,b=texelFetch(uCoastDistance,ivec2(q.x,p.y),0).r,c=texelFetch(uCoastDistance,ivec2(p.x,q.y),0).r,d=texelFetch(uCoastDistance,q,0).r;
  float cell=uCoastWidth/float(uCoastN);
  return vec3(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),vec2(mix(b-a,d-c,f.y),mix(c-a,d-b,f.x))/cell);
}
// Swell crests and surf over the composited sea colour. cover: share of open sea in the fragment.
vec3 v2CoastSwell(vec3 color,vec2 world,vec3 s,float fp,float cover){
  if(uCoastWaves<=0.||uCoastalSea!=1||cover<=0.)return color;
  float cell=uCoastWidth/float(uCoastN);
  // The swell arrives from the open sea, turned from the shore normal by the map's obliquity; deep-water wavelength.
  uint h=surfaceHash(ivec3(7,3,1),uMaterialSeed+771u);
  float turn=.6*(float(h&1023u)/1023.-.5),L0=95.+60.*float((h>>10u)&255u)/255.,D=450.;
  vec3 here=v2CoastField(world);
  if(here.x>1800.||here.x<-200.)return color;
  vec2 n=here.yz/max(length(here.yz),1e-5),up=vec2(cos(turn)*n.x-sin(turn)*n.y,sin(turn)*n.x+cos(turn)*n.y);
  // Open water up the arrival direction at 300 m and 900 m: the swell reaches this water (exposure).
  float open=1.;
  for(int k=0;k<2;k++){
    float ahead=v2CoastField(world+up*(k==0?300.:900.)).x;
    open*=k==0?sstep(-40.,220.,ahead):mix(.3,1.,sstep(-40.,450.,ahead));
  }
  // Distance to the drawn shore: the refined height's own estimate (depth over slope) within a few texels of the
  // retained coast (measured to the same refined line, render/terrainWater.ts, but only to a texel); the field beyond.
  float depth=max(-s.x,0.),slope=max(length(s.yz),.004);
  float d=mix(min(depth/slope,3.*cell),max(here.x,0.),sstep(cell,3.*cell,here.x));
  float exposure=open*clamp(uCoastWaves,0.,2.);
  if(exposure<.01)return color;
  // Ice and bright shallows carry no visible swell: the crests live on dark open water only (foam over ice is ice-white).
  float dark=1.-sstep(.42,.68,dot(color,vec3(.3,.55,.15)));
  // Silty brown water (river plumes, muddy shallows) shows crests far too strongly: a fifth of the swell there.
  dark*=mix(.2,1.,sstep(-.02,.10,color.b-color.r));
  // Phase: square root of the distance inside the shoaling band, linear beyond (same slope at D).
  float phase=d<D?2.*sqrt(D*d)/L0:(D+d)/L0;
  float L=max(L0*sqrt(min(d,D)/D),6.);
  // One noise call site: a gentle warp of the crests, their breaks along the shore, and the lace of the foam (metres).
  float warp=0.,seg=0.,lace=0.;
  for(int k=0;k<3;k++){
    float v=surfaceNoise(vec3(world/(k==0?5.*L0:k==1?2.*L0:3.5),0.),uMaterialSeed+773u+uint(k));
    if(k==0)warp=v;else if(k==1)seg=v;else lace=v;
  }
  phase+=.18*warp;
  float c=.5+.5*cos(6.2831853*phase);
  float pieces=sstep(-.15,.7,seg);
  // Swell: light crests over broader troughs, zero mean, faded before a wave spans about ten pixels (a still map
  // shows swell only close up) and offshore, where the crests would keep the coast's shape too far out.
  // The swell is a close-up effect: the crests also lose amplitude with the scale itself, whatever their
  // wavelength (full under about 1 m a pixel, a third at 2.5 m, none from 4.5 m), so a zoomed-out coast shows no
  // oscillation.
  float resolved=(1.-sstep(L/40.,L/16.,fp))*mix(1.,.35,sstep(1.,2.5,fp))*(1.-sstep(2.5,4.5,fp));
  // Where two shores' distances meet (the field's ridge, |grad| below 1) crests would fold into chevrons: none there.
  float ridge=sstep(.6,.92,length(here.yz));
  float swell=(c*c-.375)*(.15+.85*pieces)*resolved*ridge*dark*(1.-sstep(250.,800.,d))*sstep(0.,8.,d);
  color+=.05*exposure*swell*vec3(.85,.95,1.)*cover;
  // Surf: a band from the drawn shore, wider on a gently shelving bottom (spilling breakers) than against a steep one,
  // scaled by the exposure. The generated sea floor drops too fast for a depth threshold, so the band is a distance.
  // Below a pixel it keeps its area as a fainter one-pixel line (a thin surf line from afar), never a halo.
  float W=mix(5.,26.,1.-sstep(.04,.5,slope))*min(exposure,1.),band=max(W,1.2*fp),share=W/band;
  float surf=1.-sstep(.4*band,band,d);
  if(surf<=0.)return color;
  float breaking=mix(.3,sstep(.55,.95,c),1.-sstep(L/12.,L/5.,fp));
  float swash=(1.-sstep(.1*band,.3*band,d))*sstep(-.1,.6,seg+.4*warp)*pieces;
  // Foam is a lace of patches, not a ribbon, once a few metres span a pixel; its area mean from afar.
  float holes=mix(.45,sstep(-.3,.9,lace),1.-sstep(.6,1.5,fp));
  float foam=surf*share*max(.75*breaking*pieces,.6*swash)*holes*min(exposure,1.);
  return mix(color,vec3(.84,.88,.87),clamp(.7*foam,0.,.7)*cover);
}
`;
