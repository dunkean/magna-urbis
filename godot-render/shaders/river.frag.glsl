#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.
layout(set = 0, binding = 0, std140) uniform RenderUniforms {
  layout(offset = 0) vec2 uCanvas;
  layout(offset = 8) vec2 uOrigin;
  layout(offset = 16) float uPx;
  layout(offset = 20) float uDpr;
  layout(offset = 24) float uMapW;
  layout(offset = 28) int uHasOverlay;
  layout(offset = 32) int uHasLake;
  layout(offset = 36) float uLakeN;
};
layout(set = 0, binding = 1) uniform sampler2D uOverlay;
layout(set = 0, binding = 2) uniform sampler2D uLake;

layout(location = 0) in vec2 vP; layout(location = 1) flat in vec4 vSeg; layout(location = 2) flat in vec2 vHalf; layout(location = 3) flat in vec3 vColor;
layout(location = 0) out vec4 outColor;
  
 
  
vec4 bw(float t) { float t2=t*t,t3=t2*t,u=1.-t; return vec4(u*u*u,3.*t3-6.*t2+4.,-3.*t3+3.*t2+3.*t+1.,t3)/6.; }

float shoreHash(ivec2 p) {
  uint h = uint(p.x) * 374761393u ^ uint(p.y) * 668265263u ^ 1597334677u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0 * 2.0 - 1.0;
}
float shoreNoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(shoreHash(i), shoreHash(i + ivec2(1, 0)), u.x), mix(shoreHash(i + ivec2(0, 1)), shoreHash(i + ivec2(1)), u.x), u.y);
}
float lakeShore(vec2 world, bool procedural) {
  vec2 g = world * uLakeN / uMapW - 0.5, f = floor(g);
  vec4 wx = bw(g.x - f.x), wy = bw(g.y - f.y);
  ivec2 b = ivec2(f) - 1; int n = int(uLakeN); float m = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    ivec2 p = b + ivec2(i, j);
    float v = any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, ivec2(n))) ? -4.0 : texelFetch(uLake, p, 0).r;
    m += v * wx[i] * wy[j];
  }
  float fade = procedural ? 1.0 - smoothstep(0.5, 0.8, abs(m)) : 0.0;
  if (fade > 0.0) m += fade * (0.18 * shoreNoise(g * 0.7) + 0.055 * shoreNoise(g * 2.3) + 0.018 * shoreNoise(g * 6.1));
  return m;
}
void main() {
  vec2 a = vSeg.xy, b = vSeg.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * h);
  float alpha = clamp(mix(vHalf.x, vHalf.y, h) + 0.5 - d, 0.0, 1.0);
  if (uHasLake > 0) {
    float m = lakeShore(uOrigin + vP * uPx, uHasLake == 1);
    alpha *= 1. - clamp(m / max(fwidth(m), 1e-4) + .5, 0., 1.);
  }
  if (alpha <= 0.0) discard;
  // Premultiplied; blended with MAX so overlapping capsules cover like one stroke.
  vec3 color = vColor;
  if (uHasOverlay == 1) { vec4 overlay = texture(uOverlay, (uOrigin + vP * uPx) / uMapW); color = mix(color, overlay.rgb, overlay.a); }
  outColor = vec4(color * alpha, alpha);
}