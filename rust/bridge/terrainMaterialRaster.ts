import { NEURAL_EARTH_MATERIAL_GLSL } from './terrainMaterial';
import { RENDER_3D_MATERIAL_GLSL } from './terrainMaterial3d';
import { FOREST_PRELUDE_GLSL, type ForestField, type ForestOccupation } from './terrainForest';
import { seedHash } from './terrainAdjust';
import type { TerrainData, TerrainSettings } from './terrain';
import { CLIMATE_VALUES } from './terrain';
import { bindForestBrushes } from '../../web/src/render/forestBrushAtlas';

/** Render3D forest for rasters: the live view's canonical field/occupation and
 * its sun direction (map x, map y, up; terrainLights().primary). */
export interface ForestWaterRaster { x: number; y: number; width: number; n: number; alpha: Uint8Array; key: string }
export interface ForestRaster { field?: ForestField; occupation?: ForestOccupation; water?: ForestWaterRaster; light?: readonly number[]; brushes?: boolean }
export interface MaterialRaster { rgb: Uint8Array; canopyAlpha: Uint8Array }
interface Uploaded { key: string; texture: WebGLTexture }
let renderer: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; program: WebGLProgram; texture: WebGLTexture; field?: Uploaded; occupation?: Uploaded; water?: Uploaded } | undefined;
let renderer3d: typeof renderer;
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
export function renderMaterialRaster(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues'>, enhanced3d = false, forest?: ForestRaster): MaterialRaster {
  let active = enhanced3d ? renderer3d : renderer;
  if (!active) {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('Le style Render nécessite WebGL2 pour composer ses matériaux.');
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
      ${enhanced3d ? `${FOREST_PRELUDE_GLSL}uniform vec3 uForestLight;
      uniform sampler2D uForestWater;uniform int uHasForestWater;uniform vec3 uForestWaterRect;
      float forestWaterCoverage(vec2 world){
        vec2 uv=(world-uForestWaterRect.xy)/uForestWaterRect.z;
        if(uHasForestWater==0||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 0.;
        return textureLod(uForestWater,uv,0.).r;
      }` : ''}
      ${NEURAL_EARTH_MATERIAL_GLSL}
      ${enhanced3d ? RENDER_3D_MATERIAL_GLSL : ''}
      float h(ivec2 p){return texelFetch(heights,clamp(p,ivec2(0),ivec2(n-1)),0).r;}
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
        vec3 material=${enhanced3d ? 'terrain3dMaterial' : 'earthMaterial'}(vec3(height,gradient),origin+(vec2(p)+.5)*cell,cell,(height-mean)/(6.*radius),shore,openness${enhanced3d ? ',uForestLight' : ''});
        color=vec4(material,${enhanced3d ? 'forestResolvedCover' : '0.'});
      }`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Material program');
    active = { canvas, gl, program, texture: gl.createTexture()! };
    if (enhanced3d) renderer3d = active; else renderer = active;
  }
  const { canvas, gl, program, texture } = active, n = terrain.resolution;
  canvas.width = n; canvas.height = n;
  gl.viewport(0, 0, n, n); gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, n, 0, gl.RED, gl.FLOAT, terrain.height);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform1i(u('heights'), 0); gl.uniform1i(u('n'), n); gl.uniform1f(u('cell'), terrain.width / n); gl.uniform2f(u('origin'), terrain.x, terrain.y);
  const climate = settings.climateValues ?? CLIMATE_VALUES[settings.climate ?? 'temperate'];
  gl.uniform2f(u('uMaterialClimate'), climate.temperature, climate.precipitation); gl.uniform1ui(u('uMaterialSeed'), seedHash(settings.seed));
  if (enhanced3d) {
    // Units 1 field, 2 occupation; undefined keeps the legacy macro canopy exactly.
    const field = forest?.field, occupation = field ? forest?.occupation : undefined, water = field ? forest?.water : undefined, light = forest?.light ?? [-.5, -.5, .7071];
    gl.activeTexture(gl.TEXTURE3); // upload unit: keep the heights bound on unit 0
    if (field) active.field = forestTexture(gl, active.field, field, true);
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
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, water ? active.water!.texture : texture);
    gl.uniform1i(u('uForestWater'), 4); gl.uniform1i(u('uHasForestWater'), water ? 1 : 0);
    gl.uniform3f(u('uForestWaterRect'), water?.x ?? 0, water?.y ?? 0, water?.width ?? 1);
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

/** Compatibility API for callers which only need the opaque ground raster. */
export function renderMaterialPixels(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues'>, enhanced3d = false, forest?: ForestRaster): Uint8Array {
  return renderMaterialRaster(terrain, settings, enhanced3d, forest).rgb;
}
