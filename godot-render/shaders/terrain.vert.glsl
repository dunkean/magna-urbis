#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.
layout(set = 0, binding = 0, std140) uniform RenderUniforms {
  layout(offset = 0) vec4 uQuad;
  layout(offset = 16) vec2 uCanvas;
  layout(offset = 24) vec2 uOrigin;
  layout(offset = 32) float uPx;
  layout(offset = 36) float uDpr;
  layout(offset = 40) float uMapW;
  layout(offset = 44) int uFieldN;
  layout(offset = 48) vec2 uFieldOrigin;
  layout(offset = 56) float uFieldCell;
  layout(offset = 60) int uMaxLod;
  layout(offset = 64) float uAlpha;
  layout(offset = 68) int uBase;
  layout(offset = 72) int uHasCave;
  layout(offset = 76) int uHasLake;
  layout(offset = 80) float uLakeN;
  layout(offset = 84) int uHasOverlay;
  layout(offset = 88) int uUseWaterLayer;
  layout(offset = 92) int uWaterVisible;
  layout(offset = 96) int uRelief;
  layout(offset = 100) int uMode;
  layout(offset = 112) vec3 uPaper;
  layout(offset = 128) vec3 uSea;
  layout(offset = 144) vec3 uBackground;
  layout(offset = 160) vec3 uFrameColor;
  layout(offset = 176) vec3 uContourColor;
  layout(offset = 192) vec3 uShore;
  layout(offset = 204) int uCoastalSea;
  layout(offset = 208) float uSeaBand;
  layout(offset = 216) vec2 uCoastOrigin;
  layout(offset = 224) float uCoastWidth;
  layout(offset = 228) int uCoastN;
  layout(offset = 240) vec3 uStops[8];
  layout(offset = 368) float uStopT[8];
  layout(offset = 496) int uStopCount;
  layout(offset = 512) vec3 uLight;
  layout(offset = 528) vec3 uLight2;
  layout(offset = 540) float uExaggeration;
  layout(offset = 544) float uFlatLight;
  layout(offset = 548) float uRockStrength;
  layout(offset = 552) float uShade;
  layout(offset = 556) float uMinH;
  layout(offset = 560) float uMaxH;
  layout(offset = 564) float uGlobalMin;
  layout(offset = 568) float uFloor;
  layout(offset = 572) int uCoastal;
  layout(offset = 576) int uFrame;
  layout(offset = 580) int uContours;
  layout(offset = 584) float uStep;
  layout(offset = 588) float uThinW;
  layout(offset = 592) float uIndexW;
  layout(offset = 596) float uThinA;
  layout(offset = 600) float uIndexA;
  layout(offset = 604) float uFlatSlope;
  layout(offset = 608) int uRefine;
  layout(offset = 612) float uSourceCell;
  layout(offset = 616) uint uSeed;
  layout(offset = 620) int uEnhanced3d;
  layout(offset = 624) int uGroundCapture;
  layout(offset = 628) int uRefinementMode;
  layout(offset = 640) vec4 uRefinedRect;
  layout(offset = 656) vec4 uPreviousRefinedRect;
  layout(offset = 672) int uRefinedN;
  layout(offset = 676) int uPreviousRefinedN;
  layout(offset = 680) float uRefinedAlpha;
  layout(offset = 688) vec4 uDetailA;
  layout(offset = 704) vec3 uDetailB;
  layout(offset = 716) int uOctaves;
  layout(offset = 720) int uForest;
  layout(offset = 724) int uForestBrushes;
  layout(offset = 736) vec3 uForestRect;
  layout(offset = 748) int uHasForestBank;
  layout(offset = 752) float uForestBankDensity;
  layout(offset = 756) int uHasOccupation;
  layout(offset = 768) vec3 uOccupationRect;
  layout(offset = 780) float uOccupationN;
  layout(offset = 784) uint uMaterialSeed;
  layout(offset = 792) vec2 uMaterialClimate;
  layout(offset = 800) vec3 uWaterStops[8];
  layout(offset = 928) float uWaterStopT[8];
  layout(offset = 1056) int uWaterStopCount;
};


// device-pixel rectangle x0, y0, x1, y1 (y down)

void main() {
  vec2 corner = vec2(gl_VertexIndex & 1, gl_VertexIndex >> 1);
  vec2 p = mix(uQuad.xy, uQuad.zw, corner);
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
}