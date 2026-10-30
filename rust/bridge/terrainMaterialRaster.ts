import { RENDER_V2_GLSL, renderV2GlacierSources } from './terrainRenderV2';
import { renderV2ZoneUniform } from './terrainRenderV2Zones';
import { NEURAL_EARTH_MATERIAL_GLSL } from './terrainMaterial';
import { RENDER_3D_MATERIAL_GLSL } from './terrainMaterial3d';
import { FOREST_PRELUDE_GLSL, type ForestField, type ForestOccupation } from './terrainForest';
import { seedHash } from './terrainAdjust';
import type { TerrainData, TerrainSettings } from './terrain';
import { CLIMATE_VALUES } from './terrain';
import { bindForestBrushes } from '../../web/src/render/forestBrushAtlas';
import { createMaterialRasterContext, type MaterialRasterContext } from './terrainMaterialContext';

/** Render3D forest for rasters: the live view's canonical field/occupation and
 * its sun direction (map x, map y, up; terrainLights().primary). */
export interface ForestWaterRaster { x: number; y: number; width: number; n: number; alpha: Uint8Array; key: string }
export interface ForestRaster { field?: ForestField; occupation?: ForestOccupation; water?: ForestWaterRaster; light?: readonly number[]; light2?: readonly number[]; lightingStrength?: number; brushes?: boolean; renderV2?: number; v2Season?: number; waterVisible?: boolean }
export interface MaterialRaster { rgb: Uint8Array; canopyAlpha: Uint8Array }
interface Uploaded { key: string; texture: WebGLTexture }
interface RasterRenderer extends MaterialRasterContext { program: WebGLProgram; texture: WebGLTexture; field?: Uploaded; bank?: Uploaded; occupation?: Uploaded; water?: Uploaded; target?: { n: number; texture: WebGLTexture; framebuffer: WebGLFramebuffer } }
let renderer: RasterRenderer | undefined;
let renderer3d: typeof renderer;
const sharedRenderers = new WeakMap<WebGL2RenderingContext, { base?: RasterRenderer; enhanced?: RasterRenderer }>();
/** Upload a forest raster once per key; clamp-to-edge, field with box mipmaps. */
function forestTexture(gl: WebGL2RenderingContext, previous: Uploaded | undefined, raster: { n: number; rgba: Uint8Array; key: string }, mipmaps: boolean): Uploaded {
  if (previous?.key === raster.key) return previous;
  if (previous) gl.deleteTexture(previous.texture);
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, raster.n, raster.n, 0, gl.RGBA, gl.UNSIGNED_BYTE, raster.rgba);
  if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { key: raster.key, texture };
}
/** Same material shader as the live view, for worker SVG rasters and exports.
 * Render3D rasters show the forest only when `forest.field` is given; callers
 * caching rasters must include field.key and occupation.key. */
export function renderMaterialRaster(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues' | 'climateZone'>, enhanced3d = false, forest?: ForestRaster, shared?: MaterialRasterContext): MaterialRaster {
  const context = shared && !shared.gl.isContextLost() ? shared : undefined;
  const gl = context?.gl, state = gl && saveContextState(gl);
  try { return composeMaterialRaster(terrain, settings, enhanced3d, forest, context); }
  finally { if (gl && state) restoreContextState(gl, state); }
}
function composeMaterialRaster(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues' | 'climateZone'>, enhanced3d: boolean, forest?: ForestRaster, shared?: MaterialRasterContext): MaterialRaster {
  const cached = shared && sharedRenderers.get(shared.gl);
  let active = shared ? enhanced3d ? cached?.enhanced : cached?.base : enhanced3d ? renderer3d : renderer;
  if (active?.gl.isContextLost()) active = undefined;
  if (!active) {
    const { canvas, gl } = shared ?? createMaterialRasterContext();
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Material shader');
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;precision highp int;precision highp sampler2D;
      uniform sampler2D heights;uniform int n;uniform float cell;uniform vec2 origin;
      out vec4 color;
      ${enhanced3d ? `${FOREST_PRELUDE_GLSL}uniform vec3 uForestLight,uForestLight2;uniform float uForestStrength;
      uniform sampler2D uForestWater;uniform int uHasForestWater;uniform vec3 uForestWaterRect;
      float forestWaterCoverage(vec2 world){
        vec2 uv=(world-uForestWaterRect.xy)/uForestWaterRect.z;
        if(uHasForestWater==0||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
        return textureLod(uForestWater,uv,0.).r;
      }` : ''}
      ${NEURAL_EARTH_MATERIAL_GLSL}
      ${enhanced3d ? RENDER_3D_MATERIAL_GLSL + RENDER_V2_GLSL + `
      vec3 rasterMaterial(vec3 s,vec2 world,float fp,float tpi,float shore,float openness,vec3 light){
        GroundMaterial m;
        vec3 macro=earthMaterial(s,world,max(fp,1.),tpi,shore,openness);
        if(uRenderV2>0)m=v2Ground(s,world,fp,tpi,light,uForestLight2,uForestStrength,renderGuideBaseOpen);
        else {m=terrainGroundMaterial(s,world,fp,macro,uMaterialClimate,uMaterialSeed);}
        vec3 rgb;
        if(uRenderV2>0){
          GroundMaterial bareMaterial=v2MeanOpen;
          if(uForest==1)applyForest(m,world,fp,light);
          vec3 bareLit=shadeTerrainGround(bareMaterial,vec3(0.,1.,0.),light,uForestLight2,uForestStrength);
          rgb=v2ShadeGround(m,vec3(0.,1.,0.),light,uForestLight2,uForestStrength)*groundToDisplay(bareMaterial.albedo)/max(bareLit,vec3(.0001));
        }
        else if(uForest==1){vec3 l=normalize(light);float bare=forestRasterLight(m,l);applyForest(m,world,fp,l);rgb=groundToDisplay(m.albedo*forestRasterLight(m,l)/max(bare,1e-3));}
        else rgb=groundToDisplay(m.albedo);
        return uRenderV2>0?v2DisplayShoulder(rgb):rgb;
      }` : ''}
      float h(ivec2 p){return texelFetch(heights,clamp(p,ivec2(0),ivec2(n-1)),0).r;}
      ${enhanced3d ? `
      vec3 forestRootSurface(vec2 world){
        vec2 g=(world-origin)/cell-.5,t=fract(g);ivec2 b=ivec2(floor(g))-1;
        vec4 wx=vec4(pow(1.-t.x,3.),3.*t.x*t.x*t.x-6.*t.x*t.x+4.,-3.*t.x*t.x*t.x+3.*t.x*t.x+3.*t.x+1.,t.x*t.x*t.x)/6.;
        vec4 wy=vec4(pow(1.-t.y,3.),3.*t.y*t.y*t.y-6.*t.y*t.y+4.,-3.*t.y*t.y*t.y+3.*t.y*t.y+3.*t.y+1.,t.y*t.y*t.y)/6.;
        vec4 dx=vec4(-.5*(1.-t.x)*(1.-t.x),1.5*t.x*t.x-2.*t.x,-1.5*t.x*t.x+t.x+.5,.5*t.x*t.x);
        vec4 dy=vec4(-.5*(1.-t.y)*(1.-t.y),1.5*t.y*t.y-2.*t.y,-1.5*t.y*t.y+t.y+.5,.5*t.y*t.y);
        vec3 s=vec3(0.);
        for(int j=0;j<4;j++)for(int i=0;i<4;i++)s+=h(b+ivec2(i,j))*vec3(wx[i]*wy[j],dx[i]*wy[j]/cell,wx[i]*dy[j]/cell);
        return s;
      }
      float forestRootCell(){return cell;}` : ''}

      void main(){
        ivec2 p=ivec2(int(gl_FragCoord.x),n-1-int(gl_FragCoord.y));
        float height=h(p);vec2 gradient=vec2(h(p+ivec2(1,0))-h(p-ivec2(1,0)),h(p+ivec2(0,1))-h(p-ivec2(0,1)))/(2.*cell);
        int r=max(2,int(300./cell));float radius=float(r)*cell;
        float mean=(h(p+ivec2(r,0))+h(p-ivec2(r,0))+h(p+ivec2(0,r))+h(p-ivec2(0,r)))*.25;
        float shore=1e9,openness=0.;
        if(height<12. && length(gradient)<.5) for(int i=0;i<12;i++){vec2 d=vec2(cos(float(i)*.523598776),sin(float(i)*.523598776));
          if(h(p+ivec2(round(d*float(r))))<0.){shore=min(shore,radius);openness+=1./12.;}
          if(h(p+ivec2(round(d*float(r)*.5)))<0.)shore=min(shore,radius*.5);
        }
        shore=min(shore,max(height,0.)/max(length(gradient),.0001));
        vec3 material=${enhanced3d ? 'rasterMaterial' : 'earthMaterial'}(vec3(height,gradient),origin+(vec2(p)+.5)*cell,cell,(height-mean)/(6.*radius),shore,openness${enhanced3d ? ',uForestLight' : ''});
        ${enhanced3d ? `if(uRenderV2>0){V2Env e=v2Local(vec3(height,gradient),origin+(vec2(p)+.5)*cell,(height-mean)/(6.*radius),cell);if(uRenderV2>1)material=v2Color(e,float(uRenderV2-1));float water=forestWaterCoverage(origin+(vec2(p)+.5)*cell);water=max(water,height<0.?1.:0.);material=v2WaterAt(material,vec3(height,gradient),origin+(vec2(p)+.5)*cell,cell,water,height<0.?1.:3.,height<0.?-height:8.*water);}` : ''}
        color=vec4(material,${enhanced3d ? 'forestResolvedCover' : '0.'});
      }`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Material program');
    active = { canvas, gl, program, texture: gl.createTexture()! };
    if (shared) {
      const entries = cached ?? {}; if (enhanced3d) entries.enhanced = active; else entries.base = active;
      sharedRenderers.set(gl, entries);
    } else if (enhanced3d) renderer3d = active; else renderer = active;
  }
  const { gl, program, texture } = active, n = terrain.resolution;
  // Render into RGBA even when the shared map canvas is opaque. This retains
  // canopy coverage and leaves the map's drawing buffer and dimensions intact.
  if (!active.target || active.target.n !== n) {
    if (active.target) { gl.deleteTexture(active.target.texture); gl.deleteFramebuffer(active.target.framebuffer); }
    const color = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Impossible de préparer le framebuffer des matériaux.');
    active.target = { n, texture: color, framebuffer };
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, active.target.framebuffer); gl.bindVertexArray(null);
  for (const capability of [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE]) gl.disable(capability);
  gl.colorMask(true, true, true, true); gl.enable(gl.DITHER);
  gl.viewport(0, 0, n, n); gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, n, 0, gl.RED, gl.FLOAT, terrain.height);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform1i(u('heights'), 0); gl.uniform1i(u('n'), n); gl.uniform1f(u('cell'), terrain.width / n); gl.uniform2f(u('origin'), terrain.x, terrain.y);
  const climate = settings.climateValues ?? CLIMATE_VALUES[settings.climate ?? 'temperate'];
  gl.uniform2f(u('uMaterialClimate'), climate.temperature, climate.precipitation); gl.uniform1ui(u('uMaterialSeed'), seedHash(settings.seed));
  if (enhanced3d) {
    // Units 1 field, 2 occupation, 4 water, 5 bank envelope; undefined keeps the legacy macro canopy exactly.
    gl.uniform1i(u('uRenderV2'),forest?.renderV2??0);gl.uniform1i(u('uV2WaterVisible'),forest?.waterVisible===false?0:1);gl.uniform4fv(u('uV2GlacierSources[0]'),renderV2GlacierSources({x:terrain.x,y:terrain.y,width:terrain.width,n,data:terrain.height},climate));gl.uniform1f(u('uV2Season'),forest?.v2Season??.5);gl.uniform1i(u('uMaterialZone'),renderV2ZoneUniform(settings.climateZone));
    const field = forest?.field, occupation = field ? forest?.occupation : undefined, water = (field||forest?.renderV2) ? forest?.water : undefined, light = forest?.light ?? [-.5, -.5, .7071];
    gl.activeTexture(gl.TEXTURE3); // upload unit: keep the heights bound on unit 0
    if (field) active.field = forestTexture(gl, active.field, field, true);
    if (field?.bank) active.bank = forestTexture(gl, active.bank, { n: field.n, rgba: field.bank, key: `${field.key}:bank` }, true);
    if (occupation) active.occupation = forestTexture(gl, active.occupation, occupation, false);
    if (water && active.water?.key !== water.key) {
      if (active.water) gl.deleteTexture(active.water.texture);
      const waterTexture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, waterTexture); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, water.n, water.n, 0, gl.RED, gl.UNSIGNED_BYTE, water.alpha);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      active.water = { key: water.key, texture: waterTexture };
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, field ? active.field!.texture : texture);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, occupation ? active.occupation!.texture : texture);
    gl.uniform1i(u('uForest'), field ? 1 : 0); gl.uniform1i(u('uForestField'), 1); gl.uniform1i(u('uOccupation'), 2);
    gl.uniform3f(u('uForestRect'), field?.x ?? 0, field?.y ?? 0, field?.width ?? 1);
    gl.uniform1i(u('uHasOccupation'), occupation ? 1 : 0);
    gl.uniform3f(u('uOccupationRect'), occupation?.x ?? 0, occupation?.y ?? 0, occupation?.width ?? 1); gl.uniform1f(u('uOccupationN'), occupation?.n ?? 1);
    gl.uniform3f(u('uForestLight'), light[0], light[2], light[1]);
    const light2=forest?.light2??[.2,-.75,.63];
    gl.uniform3f(u('uForestLight2'),light2[0],light2[2],light2[1]);gl.uniform1f(u('uForestStrength'),forest?.lightingStrength??1);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, water ? active.water!.texture : texture);
    gl.uniform1i(u('uForestWater'), 4); gl.uniform1i(u('uHasForestWater'), water ? 1 : 0);
    gl.uniform3f(u('uForestWaterRect'), water?.x ?? 0, water?.y ?? 0, water?.width ?? 1);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, field?.bank ? active.bank!.texture : texture);
    gl.uniform1i(u('uForestBank'), 5); gl.uniform1i(u('uHasForestBank'), field?.bank ? 1 : 0);
    gl.uniform1f(u('uForestBankDensity'), field?.bankDensity ?? 1);
    bindForestBrushes(gl, u, !!forest?.brushes, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const rgba = new Uint8Array(n * n * 4), rgb = new Uint8Array(n * n * 3), canopyAlpha = new Uint8Array(n * n);
  gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, j = ((n - y - 1) * n + x) * 4;
    rgb[i * 3] = rgba[j]; rgb[i * 3 + 1] = rgba[j + 1]; rgb[i * 3 + 2] = rgba[j + 2];
    canopyAlpha[i] = rgba[j + 3];
  }
  return { rgb, canopyAlpha };
}

/** Borrow a live map context without altering its framebuffer, textures or draw state. */
function saveContextState(gl: WebGL2RenderingContext) {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  const textures = Array.from({ length: 6 }, (_, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    return { image: gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null, array: gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture | null };
  });
  gl.activeTexture(activeTexture);
  return { activeTexture, textures, framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    readFramebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array, program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null, unpack: gl.getParameter(gl.UNPACK_ALIGNMENT) as number,
    mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[], capabilities: [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.DITHER].map(capability => ({ capability, enabled: gl.isEnabled(capability) })) };
}
function restoreContextState(gl: WebGL2RenderingContext, state: ReturnType<typeof saveContextState>): void {
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.framebuffer); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
  gl.viewport(state.viewport[0], state.viewport[1], state.viewport[2], state.viewport[3]); gl.useProgram(state.program); gl.bindVertexArray(state.vao);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, state.unpack); gl.colorMask(state.mask[0], state.mask[1], state.mask[2], state.mask[3]);
  for (const { capability, enabled } of state.capabilities) if (enabled) gl.enable(capability); else gl.disable(capability);
  state.textures.forEach((texture, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture.image); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture.array); });
  gl.activeTexture(state.activeTexture);
}

/** Compatibility API for callers which only need the opaque ground raster. */
export function renderMaterialPixels(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues' | 'climateZone'>, enhanced3d = false, forest?: ForestRaster): Uint8Array {
  return renderMaterialRaster(terrain, settings, enhanced3d, forest).rgb;
}
