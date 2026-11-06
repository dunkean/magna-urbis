/** One immutable instance stream; atlas coordinates use the canvas's top-left origin. */
export interface Terrain3dBillboard { x: number; y: number; width: number; height: number; rect: readonly [number, number, number, number]; flip: boolean; opacity: number }
export interface Terrain3dBillboards { stamps: readonly Terrain3dBillboard[]; atlas: HTMLCanvasElement }

/** Shared by the ground and the relief pass: 0 is the original overhead painting, 1 is upright. */
export function terrain3dRaisedBlend(down: number): number {
  const t = Math.max(0, Math.min(1, (.985 - down) / .22)); return t * t * (3 - 2 * t);
}

export const RAISED_MATERIAL_GLSL = `
uniform sampler2D drapedMaterial,previousDrapedMaterial;
uniform int hasRaisedMaterial,hasPreviousRaisedMaterial;
uniform float raisedBlend;
vec4 reliefCurrent(vec2 uv){
  if(hasRaisedMaterial==0 || raisedBlend>=1.)return texture(material,uv);
  if(raisedBlend<=0.)return texture(drapedMaterial,uv);
  return mix(texture(drapedMaterial,uv),texture(material,uv),raisedBlend);
}
vec4 reliefPrevious(vec2 uv){
  if(hasPreviousRaisedMaterial==0 || raisedBlend>=1.)return texture(previousMaterial,uv);
  if(raisedBlend<=0.)return texture(previousDrapedMaterial,uv);
  return mix(texture(previousDrapedMaterial,uv),texture(previousMaterial,uv),raisedBlend);
}
`;

export const BILLBOARD_3D_GLSL = {
  vertex: `#version 300 es
precision highp float;
layout(location=0) in vec4 anchorWidth;
layout(location=1) in vec4 atlasRect;
layout(location=2) in vec4 shape;
uniform mat4 matrix;
uniform vec3 cameraOrigin;
uniform vec2 cameraRight;
uniform float exaggeration,raisedBlend;
out vec2 texcoord;
out vec3 world;
out float opacity;
void main(){
  int i=int(gl_VertexID);
  vec2 q=vec2(i==1 || i==2 || i==4?1.:0.,i==2 || i==4 || i==5?1.:0.);
  float height=shape.x*mix(.35,1.,raisedBlend);
  vec2 p=anchorWidth.xy+cameraRight*((q.x-.5)*anchorWidth.w);
  // The source anchor is 95% down the brush: bury its transparent skirt rather than float it.
  world=vec3(p.x-cameraOrigin.x,anchorWidth.z*exaggeration-cameraOrigin.y+(q.y-.05)*height,p.y-cameraOrigin.z);
  texcoord=atlasRect.xy+vec2(shape.y<0.?1.-q.x:q.x,1.-q.y)*atlasRect.zw;
  opacity=shape.z*raisedBlend;
  gl_Position=matrix*vec4(world,1.);
}`,
  fragment: `#version 300 es
precision highp float;
in vec2 texcoord;
in vec3 world;
in float opacity;
uniform sampler2D billboardAtlas;
uniform vec3 eye;
uniform float fogDistance;
uniform int uNight;
out vec4 color;
void main(){
  vec4 brush=texture(billboardAtlas,texcoord);
  float alpha=brush.a*opacity;
  if(alpha<.015)discard;
  vec3 base=brush.rgb/max(brush.a,.001);
  if(uNight==1)base*=vec3(.149,.196,.31);
  float fog=1.-exp(-pow(length(world-eye)/fogDistance,2.)*.11);
  base=mix(base,uNight==1?vec3(.018,.028,.065):vec3(.77,.85,.88),min(.62,fog));
  color=vec4(base,alpha);
}`,
};

/** The flat painting that replaces a draped texture once its stamps stand as billboards. Kept here: terrain3d.ts and the WGSL generator must not load the painter. */
const raisedTextures = new WeakMap<object, HTMLCanvasElement>();
export const terrain3dRaisedTexture = (source: object): HTMLCanvasElement | undefined => raisedTextures.get(source);
export function terrain3dSetRaisedTexture(source: object, draped: HTMLCanvasElement): void { raisedTextures.set(source, draped); }
