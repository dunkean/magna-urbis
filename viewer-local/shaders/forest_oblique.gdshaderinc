uniform bool forest_oblique_full_enabled=false;
uniform float forest_oblique_full_weight=0.0;
// Complementary per-pixel representation selection. Terrain paint and ALL full
// forest fragments use the same pixel, preventing simultaneous double coverage.
float forest_oblique_selector(vec2 pixel){
 if(!forest_oblique_full_enabled)return 0.0;
 float h=fract(sin(dot(floor(pixel),vec2(12.9898,78.233)))*43758.5453);
 return step(h,forest_oblique_full_weight)*step(.000001,forest_oblique_full_weight);
}
