// Parity of the TS port (rust/bridge/terrainForestBeach.ts) against the real GLSL forestBeachCoverage.
// Run: npx tsx scripts/forest_beach_parity.mjs   (from web/)
import { chromium } from 'playwright';
import { forestBeachCoverageAt } from '../../rust/bridge/terrainForestBeach.ts';

const N = 256, WIDTH = 4000, X0 = -2000, Y0 = -2000, SEED = 123456789;

// Synthetic coast: sea in the west, gentle shelf and low beaches, hills inland, bays and islets.
function makeLayer() {
  const data = new Float32Array(N * N), cell = WIDTH / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = X0 + (i + .5) * cell, y = Y0 + (j + .5) * cell;
    const shoreX = -600 + 350 * Math.sin(y / 420) + 150 * Math.sin(y / 130 + 1);
    const t = (x - shoreX) / 300;
    let h = t < 0 ? -30 + 30 * Math.exp(t * .6) - 20 * (1 - Math.exp(t * .15)) : 2 + 3.5 * t + 6 * Math.max(0, t - 3);
    h += 25 * Math.max(0, Math.sin(x / 500) * Math.cos(y / 600)) * Math.min(1, Math.max(0, t / 4));
    h += 4 * Math.sin(x / 90 + y / 70) * Math.min(1, Math.max(0, t));
    h -= 14 * Math.exp(-((x - 1200) ** 2 + (y + 200) ** 2) / 250000) + 22 * Math.exp(-((x - 1000) ** 2 + (y - 900) ** 2) / 90000);
    h += 5 * Math.exp(-((x + 1400) ** 2 + (y - 300) ** 2) / 20000);
    data[j * N + i] = h;
  }
  return { x: X0, y: Y0, width: WIDTH, n: N, data };
}
const layer = makeLayer();

// Points: texel centres of a 512 grid, then random points.
const G = 512, RAND = 40 * G, W = G, H = G + RAND / G;
const pts = new Float32Array(W * H * 2);
let k = 0;
for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { pts[k++] = X0 + (i + .5) * WIDTH / G; pts[k++] = Y0 + (j + .5) * WIDTH / G; }
let s = 12345; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let q = 0; q < RAND; q++) { pts[k++] = X0 + rnd() * WIDTH; pts[k++] = Y0 + rnd() * WIDTH; }

// GLSL copied verbatim from: web/src/ui/terrainGl.ts (bw, bd, level, forestRootSurface/Cell),
// rust/bridge/terrainMaterial.ts (sstep, surfaceHash, surfaceCorner, surfaceNoise, surfaceFbm,
// surfaceBeachWidth, surfaceRootBeach), forestBeachCoverage as formerly in rust/bridge/terrainRenderV2.ts.
const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uField; uniform sampler2D uPts; uniform int uFieldN; uniform vec2 uFieldOrigin; uniform float uFieldCell;
uniform uint uMaterialSeed;
out vec4 o;
float sstep(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec4 bw(float t) { float t2 = t * t, t3 = t2 * t, u = 1.0 - t; return vec4(u * u * u, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0; }
vec4 bd(float t) { float t2 = t * t, u = 1.0 - t; return vec4(-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2); }
vec3 level(int lod, vec2 world) {
  int n = max(1, uFieldN >> lod);
  float cell = uFieldCell * float(1 << lod);
  vec2 g = (world - uFieldOrigin) / cell - 0.5;
  vec2 f = floor(g), t = g - f;
  vec4 wx = bw(t.x), wy = bw(t.y), dx = bd(t.x), dy = bd(t.y);
  ivec2 b = ivec2(f) - 1;
  float h = 0.0, gx = 0.0, gy = 0.0;
  for (int j = 0; j < 4; j++) {
    int row = clamp(b.y + j, 0, n - 1);
    float r = 0.0, rd = 0.0;
    for (int i = 0; i < 4; i++) {
      float v = texelFetch(uField, ivec2(clamp(b.x + i, 0, n - 1), row), lod).r;
      r += v * wx[i]; rd += v * dx[i];
    }
    h += r * wy[j]; gx += rd * wy[j]; gy += r * dy[j];
  }
  return vec3(h, gx / cell, gy / cell);
}
vec3 forestRootSurface(vec2 world){return level(0,world);}
float forestRootCell(){return uFieldCell;}
    uint surfaceHash(ivec3 c,uint salt){
      uvec3 v=uvec3(c);
      uint h=(v.x*0x9e3779b9u)^(v.y*0x85ebca6bu)^(v.z*0xc2b2ae35u)^salt;
      h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
    }
    float surfaceCorner(ivec3 c,vec3 f,ivec3 o,uint salt){
      uint h=surfaceHash(c+o,salt);vec3 d=f-vec3(o);
      vec3 g=vec3(float(h&1023u),float((h>>10u)&1023u),float((h>>20u)&1023u))/511.5-1.;
      return g.x*d.x+g.y*d.y+g.z*d.z;
    }
    float surfaceNoise(vec3 p,uint salt){
      vec3 fl=floor(p);ivec3 c=ivec3(fl);vec3 f=p-fl;vec3 u=f*f*f*(f*(f*6.-15.)+10.);
      float a0=surfaceCorner(c,f,ivec3(0,0,0),salt);float a1=surfaceCorner(c,f,ivec3(1,0,0),salt);
      float a2=surfaceCorner(c,f,ivec3(0,1,0),salt);float a3=surfaceCorner(c,f,ivec3(1,1,0),salt);
      float b0=surfaceCorner(c,f,ivec3(0,0,1),salt);float b1=surfaceCorner(c,f,ivec3(1,0,1),salt);
      float b2=surfaceCorner(c,f,ivec3(0,1,1),salt);float b3=surfaceCorner(c,f,ivec3(1,1,1),salt);
      float x0=a0+(a1-a0)*u.x;float x1=a2+(a3-a2)*u.x;float x2=b0+(b1-b0)*u.x;float x3=b2+(b3-b2)*u.x;
      float y0=x0+(x1-x0)*u.y;float y1=x2+(x3-x2)*u.y;
      return (y0+(y1-y0)*u.z)*5.25;
    }
    vec2 surfaceFbm(vec3 p,float scale,int octaves,float footprint,uint salt){
      float value=0.;float kept=0.;float total=0.;float s=scale;float a=1.;
      for(int i=0;i<octaves;i++){
        total+=a*a;
        if(footprint<s*.25){float fade=1.-sstep(s*.125,s*.25,footprint);value+=a*fade*surfaceNoise(p/s,salt+uint(i)*0x9e37u);kept+=a*fade*a*fade;}
        a*=.5;s*=.5;
      }
      if(kept>0.){value/=sqrt(kept);}
      return vec2(value,kept/total);
    }
    float surfaceBeachWidth(vec2 reach,vec2 grove,vec2 fine,float openness){
      return 140.*sstep(-.15,.75,.65*reach.x*sqrt(reach.y)+.5*grove.x*sqrt(grove.y))*sstep(.15,.4,openness)*(1.+.35*fine.x*sqrt(fine.y));
    }
    float surfaceRootBeach(vec3 s,vec2 world,float shore,float openness){
      vec3 point=vec3(world,0.);float fp=30.;
      vec2 reach=surfaceFbm(point,20000.,3,fp,uMaterialSeed+7u);
      vec2 grove=surfaceFbm(point,4800.,4,fp,uMaterialSeed+3u);
      vec2 fine=surfaceFbm(point,240.,4,fp,uMaterialSeed+5u);
      float width=surfaceBeachWidth(reach,grove,fine,openness);
      return clamp((min(width,20.*fp)-shore+fp)/fp,0.,1.)*(1.-sstep(4.,12.,s.x))*(1.-sstep(.2,.5,length(s.yz)));
    }
float forestBeachCoverage(vec2 world){
  vec3 s=forestRootSurface(world);
  if(s.x<0.||s.x>=12.||length(s.yz)>=.5)return 0.;
  float r=max(300.,2.*forestRootCell()),shore=max(s.x,0.)/max(length(s.yz),.0001),openness=0.;
  for(int i=0;i<12;i++){
    vec2 d=vec2(cos(float(i)*.523598776),sin(float(i)*.523598776));
    if(forestRootSurface(world+d*r).x<0.){shore=min(shore,r);openness+=1./12.;}
    if(forestRootSurface(world+d*r*.5).x<0.)shore=min(shore,r*.5);
  }
  if(openness<=.15)return 0.;
  return surfaceRootBeach(s,world,shore,openness);
}
void main(){
  vec2 w=texelFetch(uPts,ivec2(gl_FragCoord.xy),0).rg;
  o=vec4(forestBeachCoverage(w),0.,0.,1.);
}`;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=vulkan'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c width=4 height=4></canvas>');
const out = await page.evaluate(({ FS, layerData, pts, N, W, H, X0, Y0, WIDTH, SEED }) => {
  const gl = document.getElementById('c').getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('webgl2 / float render target unavailable');
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 v=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(v*2.-1.,0.,1.);}'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);
  const tex = (unit, internal, fmt, w, h, data) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t;
  };
  tex(0, gl.R32F, gl.RED, N, N, new Float32Array(layerData));
  tex(1, gl.RG32F, gl.RG, W, H, new Float32Array(pts));
  gl.uniform1i(gl.getUniformLocation(p, 'uField'), 0); gl.uniform1i(gl.getUniformLocation(p, 'uPts'), 1);
  gl.uniform1i(gl.getUniformLocation(p, 'uFieldN'), N); gl.uniform2f(gl.getUniformLocation(p, 'uFieldOrigin'), X0, Y0);
  gl.uniform1f(gl.getUniformLocation(p, 'uFieldCell'), WIDTH / N); gl.uniform1ui(gl.getUniformLocation(p, 'uMaterialSeed'), SEED);
  gl.activeTexture(gl.TEXTURE2);
  const rt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rt);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, W, H);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0);
  gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const res = new Float32Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, res);
  const r = new Float32Array(W * H); for (let i = 0; i < r.length; i++) r[i] = res[i * 4];
  return Array.from(r);
}, { FS, layerData: Array.from(layer.data), pts: Array.from(pts), N, W, H, X0, Y0, WIDTH, SEED });
await browser.close();

let max = 0, sum = 0, bad = 0, nonzero = 0, worst = -1;
const total = W * H;
for (let i = 0; i < total; i++) {
  const ts = forestBeachCoverageAt(layer, SEED, pts[i * 2], pts[i * 2 + 1]);
  const d = Math.abs(ts - out[i]);
  if (out[i] > 0 || ts > 0) nonzero++;
  sum += d; if (d > max) { max = d; worst = i; } if (d > 1 / 255) bad++;
}
console.log(`points ${total}, nonzero ${nonzero}, max diff ${max.toFixed(5)} (${(max * 255).toFixed(2)}/255), mean ${(sum / total).toExponential(3)}, > 1/255: ${bad}`);
if (worst >= 0) console.log(`worst at (${pts[worst * 2]}, ${pts[worst * 2 + 1]}): glsl ${out[worst]} ts ${forestBeachCoverageAt(layer, SEED, pts[worst * 2], pts[worst * 2 + 1])}`);
if (max > 2 / 255) { console.error('FAIL'); process.exit(1); }
console.log('OK');
