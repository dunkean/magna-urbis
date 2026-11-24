/** Forest stature per biome: crown size, the social classes of a stand and its giant trees. One table and two twin
 * descriptions of the same rules, the GLSL one read per pixel by the painted crowns (terrainForest.ts forestCrown,
 * forestRadius) and the TypeScript one by the modelled 3D trees standing on those crowns (web/src/ui/terrain3dTrees.ts),
 * so a 3D tree keeps its painted crown's radius in every biome. Display only.
 *
 * Rows follow CLIMATE_ZONES (terrainClimate.ts); row 11 is a map without a V2 zone. The forest field's own stand
 * height (G channel, 0-50 m) already follows the climate; `stature` and `cap` map it to each biome's real canopy height
 * for the 3D trees (the painted crowns keep field heights: their shadows search a window sized on them). Orders of
 * magnitude (canopy top height, crown diameter of a canopy tree):
 * - temperate broadleaf/mixed: 20-30 m (European beech/oak yield tables, top heights 25-35 m), crowns 8-12 m;
 * - Mediterranean sclerophyll woodland: 8-15 m (holm and cork oak 10-15 m, Aleppo pine 10-20 m), broad low crowns
 *   8-12 m, umbrella pines;
 * - continental (hemiboreal mixed): 18-28 m, Scots pine crowns 3-5 m;
 * - nordic (boreal): slender 12-20 m spruce and pine, crowns 2-3 m (dense: 1000-2000 stems/ha);
 * - alpine (montane spruce/fir/larch): 25-35 m in the montane belt down to krummholz at the treeline (Körner 2012);
 * - arctic (forest-tundra): 2-6 m spruce, larch and birch;
 * - steppe (forest-steppe groves of birch, aspen, oak, pine): 10-18 m;
 * - desert (wadi and oasis acacia, tamarisk): 4-10 m;
 * - savanna: scattered flat-topped acacias 6-12 m with crowns 10-15 m, wider than tall; baobabs 20-25 m;
 * - tropical rainforest: 35-45 m canopy, crowns 12-20 m, emergents 55-70 m (dipterocarps, Ceiba; Whitmore 1998);
 * - wetland (swamp forest, alder carr, mangrove): low and dense, 10-20 m, crowns 5-8 m.
 * Giants: tropical emergents; elsewhere veteran broadleaves about 1.5-1.8 times their stand with a much wider crown
 * (veteran/ancient tree surveys), and landmark trees in open land. A conifer giant barely passes its stand
 * (terrain3dTrees.ts CONIFER_GIANT). */

export interface ForestBiome {
  /** 3D stand top height = softCap(field height x stature, cap) (m). */
  stature: number;
  cap: number;
  /** Mean crown radius factors of the painted crowns (forestRadius), broadleaf and conifer: crown size and spacing. */
  broad: number;
  needle: number;
  /** Shares added to the suppressed/understory and young classes of a stand. */
  suppressed: number;
  young: number;
  /** Added to the live crown ratio of the 3D trees (broad low crowns in dry woodland, tall boles in rainforest). */
  crown: number;
  /** Share of giants among stand trees: the one value a "giant trees" slider would scale (see forestGiant). */
  giant: number;
  /** Giant height over the stand top (3D), and the widening of its crown (painted and 3D, within the lattice reach). */
  giantHeight: number;
  giantWiden: number;
}
const row = (stature: number, cap: number, broad: number, needle: number, suppressed: number, young: number, crown: number, giant: number, giantHeight: number, giantWiden: number): ForestBiome => ({
  stature,
  cap,
  broad,
  needle,
  suppressed,
  young,
  crown,
  giant,
  giantHeight,
  giantWiden,
});
/** stature and cap: the zone's default climate gives a field height H (3 + 31 humid^.8 x thermal, terrainForest.ts);
 * stature = 1.17 x target / (1.05 H) and cap = 1.6 x target put the typical stand top on the target above. Radius factors
 * bring the field's crown allometry (forestRadius) to the crown diameters above. */
export const FOREST_BIOMES: readonly ForestBiome[] = [
  row(1.56, 40, 0.95, 1.15, 0, 0, 0, 0.012, 1.6, 1.7), // temperate: target 25 m on H 18 m
  row(1.13, 18, 0.95, 2.2, 0.02, 0.06, 0.12, 0.01, 1.6, 1.8), // mediterranean: 11 m on H 11 m
  row(1.93, 37, 0.9, 1.15, 0, 0.02, 0, 0.012, 1.6, 1.6), // continental: 23 m on H 13 m
  row(0.87, 26, 0.6, 0.75, 0.04, 0.04, 0.1, 0.008, 1.5, 1.3), // nordic: 16 m on H 21 m
  row(1.19, 45, 0.65, 0.85, 0.04, 0.02, 0.05, 0.01, 1.6, 1.4), // alpine: 28 m on H 26 m (lower up the slope)
  row(0.74, 7, 0.6, 0.95, 0.06, 0.08, 0.2, 0.003, 1.5, 1.3), // arctic: 4 m on H 6 m (the zone's .35 stature)
  row(2.4, 21, 1.05, 2, 0, 0.06, 0.05, 0.01, 1.6, 1.7), // steppe: 13 m on H 6 m
  row(2.6, 11, 1.15, 1.9, 0, 0.08, 0.1, 0.02, 1.6, 1.8), // desert: 7 m on H 3 m
  row(1.76, 15, 1.65, 1.5, 0, 0.06, 0, 0.03, 1.8, 2), // savanna: 9 m on H 6 m, crowns wider than tall, baobabs
  row(1.31, 64, 0.8, 1, 0.06, 0, -0.05, 0.05, 1.55, 1.9), // tropical: 40 m on H 34 m, emergents ~62 m
  row(0.95, 23, 0.65, 0.9, 0.06, 0.02, 0.05, 0.012, 1.7, 1.6), // wetland: 14 m on H 16 m
  row(1.1, 28, 1, 1, 0, 0, 0, 0.01, 1.6, 1.6), // no zone: the former sizes
];
export const FOREST_BIOME_NONE = 11;
/** Row of a map: its V2 zone (renderV2ZoneUniform = CLIMATE_ZONES index + 1) under the V2 render, as forestBiome(). */
export const forestBiomeRow = (renderV2: number, zone: number): number => (renderV2 > 0 && zone > 0 ? Math.min(zone - 1, 10) : FOREST_BIOME_NONE);
/** Old-growth cores: one per GROVE-metre cell, a disc of 19-48 m radius where giants are GROVE_IN times as frequent as
 * the biome share (GROVE_OUT elsewhere), so giants come in groves (the mean stays the share). */
export const FOREST_GROVE = 160,
  FOREST_GROVE_IN = 3.7,
  FOREST_GROVE_OUT = 0.15;
/** Open-grown crowns (meadow, pasture, field and stray trees): about 1.5-2 times as wide as a stand-grown tree of the
 * same stem (open-grown crown-width models, e.g. Hasenauer 1997), so 1.4 of the stand crown here; hedgerows and trees
 * kept on built reserves keep their former narrow crown (0.825 = 0.75 x 1.1). */
export const FOREST_LONE_WIDEN = 1.4,
  FOREST_HEDGE_WIDEN = 0.825;
/** Painted giants: crown height for shadows (bounded like the dominants: the shadow search window follows the stand
 * height) and the lift that puts their dome above the neighbouring crowns (fraction of the stand height). */
export const FOREST_GIANT_PAINTED = 1.2,
  FOREST_GIANT_LIFT = 0.5;
/** Landmark trees in open land: the biome giant share times this, at most FOREST_LANDMARK_MAX of the lone trees. */
export const FOREST_LANDMARK = 10,
  FOREST_LANDMARK_MAX = 0.25;

/** Social class of a crown: 0 young, 1 suppressed/understory, 2 intermediate, 3 co-dominant, 4 dominant, 5 open-grown. */
export interface ForestSocial {
  share: number;
  width: number;
  rank: number;
}
/** Kraft (1884) classes, heights as a share of the stand top height: predominant/dominant 0.94-1.24 (cubic tail: few
 * predominant), co-dominant 0.82-0.94, intermediate 0.66-0.82, suppressed/understory 0.45-0.64, young 0.38-0.62;
 * open-grown 0.6-1.0. Class shares: a closed tall canopy keeps few small trees, margins and open stands carry the young
 * growth, tropical forests an understory layer. `u` picks the class, leaned by `size` (the crown's radius draw: wide
 * crowns are the dominant trees), `v` the height within it. Margin trees are lower (-12 %); krummholz is stunted and
 * irregular whatever its class. `width` scales the crown radius (mean about 1 in a closed stand, so the Boolean cover
 * calibration of the τ table holds). GLSL twin: forestSocial in FOREST_STATURE_GLSL. */
export function forestSocial(out: ForestSocial, biome: number, u: number, v: number, size: number, margin: number, closure: number, krumm: number, tropical: number, openGrown: boolean): void {
  let share: number,
    width = 1,
    rank = 5;
  if (openGrown) share = 0.6 + 0.4 * v;
  else {
    const b = FOREST_BIOMES[biome],
      young = 0.3 * margin + (0.06 + b.young) * (1 - closure),
      suppressed = young + (0.16 + (0.04 - 0.16) * closure) + b.suppressed + 0.12 * tropical,
      intermediate = suppressed + 0.14,
      codominant = intermediate + 0.3 - 0.1 * margin;
    const pick = Math.min(Math.max(u + 0.35 * (size - 0.5), 0), 0.999);
    rank = pick < young ? 0 : pick < suppressed ? 1 : pick < intermediate ? 2 : pick < codominant ? 3 : 4;
    share = rank === 0 ? 0.38 + 0.24 * v : rank === 1 ? 0.45 + 0.19 * v : rank === 2 ? 0.66 + 0.16 * v : rank === 3 ? 0.82 + 0.12 * v : 0.94 + 0.3 * v * v * v;
    width = rank < 2 ? 0.9 : rank === 2 ? 0.98 : 1.04;
    share *= 1 - 0.12 * margin;
  }
  out.share = share + (0.55 + 0.6 * v - share) * krumm;
  out.width = width;
  out.rank = rank;
}
/** Giant draw of a stand crown at (x, y): `draw` uniform 0..1 of the crown, `share` the biome giant share. One hashed
 * core per FOREST_GROVE cell (inset so it never crosses the cell: no neighbour search). GLSL twin: forestGiant. */
export function forestGiant(x: number, y: number, draw: number, share: number, seed: number, hash: (x: number, y: number, z: number, seed: number) => number): boolean {
  const gx = Math.floor(x / FOREST_GROVE),
    gy = Math.floor(y / FOREST_GROVE),
    h = hash(gx, gy, 727, seed);
  const u8 = (shift: number): number => (((h >>> shift) & 255) + 0.5) / 256;
  const cx = (gx + 0.3 + 0.4 * u8(0)) * FOREST_GROVE,
    cy = (gy + 0.3 + 0.4 * u8(8)) * FOREST_GROVE;
  return draw < share * (Math.hypot(x - cx, y - cy) < (0.12 + 0.18 * u8(16)) * FOREST_GROVE ? FOREST_GROVE_IN : FOREST_GROVE_OUT);
}

const f = (v: number): string => (Number.isInteger(v) ? `${v}.` : String(v));
/** Needs groundHash, forestU8 and v2Zoned/v2Zone (RENDER_V2_ZONE_GLSL). */
export const FOREST_STATURE_GLSL = `
// Biome rows (terrainForestStature.ts FOREST_BIOMES): x/y broadleaf/conifer crown radius factor, z giant share, w giant crown widening.
const vec4 FOREST_BIOME[12]=vec4[12](${FOREST_BIOMES.map(b => `vec4(${f(b.broad)},${f(b.needle)},${f(b.giant)},${f(b.giantWiden)})`).join(',')});
// Shares added to the suppressed and young classes.
const vec2 FOREST_BIOME_CLASS[12]=vec2[12](${FOREST_BIOMES.map(b => `vec2(${f(b.suppressed)},${f(b.young)})`).join(',')});
const float FOREST_GROVE=${f(FOREST_GROVE)},FOREST_GROVE_IN=${f(FOREST_GROVE_IN)},FOREST_GROVE_OUT=${f(FOREST_GROVE_OUT)};
const float FOREST_LONE_WIDEN=${f(FOREST_LONE_WIDEN)},FOREST_HEDGE_WIDEN=${f(FOREST_HEDGE_WIDEN)},FOREST_GIANT_PAINTED=${f(FOREST_GIANT_PAINTED)},FOREST_GIANT_LIFT=${f(FOREST_GIANT_LIFT)};
const float FOREST_LANDMARK=${f(FOREST_LANDMARK)},FOREST_LANDMARK_MAX=${f(FOREST_LANDMARK_MAX)};
int forestBiome(){return v2Zoned()?v2Zone():${FOREST_BIOME_NONE};}
// Height share of the stand and crown width factor of one crown's social class (forestSocial).
vec2 forestSocial(float u,float v,float size,float margin,float closure,float krumm,float tropical,bool openGrown){
  float share=.6+.4*v,width=1.;
  if(!openGrown){
    vec2 add=FOREST_BIOME_CLASS[forestBiome()];
    float young=.3*margin+(.06+add.y)*(1.-closure),supp=young+mix(.16,.04,closure)+add.x+.12*tropical,inter=supp+.14,codom=inter+.3-.1*margin;
    float pick=clamp(u+.35*(size-.5),0.,.999);
    share=pick<young?.38+.24*v:pick<supp?.45+.19*v:pick<inter?.66+.16*v:pick<codom?.82+.12*v:.94+.3*v*v*v;
    width=pick<supp?.9:pick<inter?.98:1.04;
    share*=1.-.12*margin;
  }
  return vec2(mix(share,.55+.6*v,krumm),width);
}
// Giants come in old-growth cores: one hashed disc per FOREST_GROVE cell, inset so no neighbour cell is searched.
bool forestGiant(vec2 c,float draw,float share,uint seed){
  ivec2 g=ivec2(floor(c/FOREST_GROVE));uint h=groundHash(ivec3(g,727),seed);
  vec2 core=(vec2(g)+.3+.4*vec2(forestU8(h,0u),forestU8(h,8u)))*FOREST_GROVE;
  return draw<share*(distance(c,core)<(.12+.18*forestU8(h,16u))*FOREST_GROVE?FOREST_GROVE_IN:FOREST_GROVE_OUT);
}
`;
