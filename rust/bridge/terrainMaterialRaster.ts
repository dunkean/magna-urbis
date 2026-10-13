import { NEURAL_EARTH_MATERIAL_GLSL } from './terrainMaterial';
import { seedHash } from './terrainAdjust';
import type { TerrainData, TerrainSettings } from './terrain';
import { CLIMATE_VALUES } from './terrain';

let renderer: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas; program: WebGLProgram; texture: WebGLTexture } | undefined;
/** Same material shader as the live view, for worker SVG rasters and exports. */
export function renderMaterialPixels(terrain: TerrainData, settings: Pick<TerrainSettings, 'seed' | 'climate' | 'climateValues'>): Uint8Array {
  if (!renderer) {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
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
      ${NEURAL_EARTH_MATERIAL_GLSL}
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
        color=vec4(earthMaterial(vec3(height,gradient),origin+(vec2(p)+.5)*cell,cell,(height-mean)/(6.*radius),shore,openness),1.);
      }`);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Material program');
    renderer = { canvas, gl, program, texture: gl.createTexture()! };
  }
  const { canvas, gl, program, texture } = renderer, n = terrain.resolution;
  canvas.width = n; canvas.height = n;
  gl.viewport(0, 0, n, n); gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, n, 0, gl.RED, gl.FLOAT, terrain.height);
  const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform1i(u('heights'), 0); gl.uniform1i(u('n'), n); gl.uniform1f(u('cell'), terrain.width / n); gl.uniform2f(u('origin'), terrain.x, terrain.y);
  const climate = settings.climateValues ?? CLIMATE_VALUES[settings.climate ?? 'temperate'];
  gl.uniform2f(u('uMaterialClimate'), climate.temperature, climate.precipitation); gl.uniform1ui(u('uMaterialSeed'), seedHash(settings.seed));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const rgba = new Uint8Array(n * n * 4), rgb = new Uint8Array(n * n * 3);
  gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, j = ((n - y - 1) * n + x) * 4;
    rgb.set(rgba.subarray(j, j + 3), i * 3);
  }
  return rgb;
}
