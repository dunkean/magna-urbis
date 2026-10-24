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

layout(set = 0, binding = 3, std430) readonly buffer RiverInstances { float riverData[]; };
layout(location = 0) out vec2 vP; layout(location = 1) flat out vec4 vSeg; layout(location = 2) flat out vec2 vHalf; layout(location = 3) flat out vec3 vColor;
void main() {
  int riverOffset = gl_InstanceIndex * 9;
  vec4 aSeg = vec4(riverData[riverOffset], riverData[riverOffset+1], riverData[riverOffset+2], riverData[riverOffset+3]);
  vec2 aWidth = vec2(riverData[riverOffset+4], riverData[riverOffset+5]);
  vec3 aColor = vec3(riverData[riverOffset+6], riverData[riverOffset+7], riverData[riverOffset+8]);

  vec2 a = (aSeg.xy - uOrigin) / uPx, b = (aSeg.zw - uOrigin) / uPx;
  vec2 d = b - a; float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
  // Cartographic width: below its physical size on screen, a river keeps a
  // stroke growing with the logarithm of its width: hairline streams (about
  // 2 kmÂ² drained, 7 m wide), 1 px at 20 kmÂ², bold trunks.
  vec2 carto = clamp(0.35 + 0.4 * log2(max(aWidth, vec2(6.0)) / 6.0), 0.35, 3.2) * uDpr;
  vec2 half_ = max(aWidth / uPx, carto) * 0.5;
  float r = max(half_.x, half_.y) + 1.0;
  vec2 corner = vec2(gl_VertexIndex & 1, gl_VertexIndex >> 1);
  vec2 p = mix(a - dir * r, b + dir * r, corner.x) + nrm * r * (corner.y * 2.0 - 1.0);
  vP = p; vSeg = vec4(a, b); vHalf = half_; vColor = aColor;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}