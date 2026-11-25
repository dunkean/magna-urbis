/** Metre-space value noise for water and exposed sediment. Hash integer lattice corners before
 * interpolation so neighbouring cells agree even far from the map origin. */
export const RIVER_NOISE_GLSL = `
float riverCorner(ivec2 p) {
  uint h = uint(p.x)*0x9e3779b9u ^ uint(p.y)*0x85ebca6bu;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u;
  return float(h >> 8u) / 16777216.;
}
float riverNoise(vec2 p) {
  ivec2 i=ivec2(floor(p)); vec2 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(riverCorner(i),riverCorner(i+ivec2(1,0)),f.x),
             mix(riverCorner(i+ivec2(0,1)),riverCorner(i+ivec2(1,1)),f.x), f.y);
}
`;
