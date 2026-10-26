#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.
layout(set = 0, binding = 0, std140) uniform RenderUniforms {
  layout(offset = 0) vec2 uCanvas;
  layout(offset = 8) vec2 uOrigin;
  layout(offset = 16) float uPx;
  layout(offset = 20) float uDpr;
  layout(offset = 24) float uBand;
  layout(offset = 28) float uBankPx;
  layout(offset = 32) float uRings[12];
  layout(offset = 224) int uRingCount;
  layout(offset = 240) vec3 uWaterStops[8];
  layout(offset = 368) float uWaterStopT[8];
  layout(offset = 496) int uWaterStopCount;
};


void main() { vec2 p = vec2(gl_VertexIndex & 1, gl_VertexIndex >> 1) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }