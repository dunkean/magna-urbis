import type { Polygon } from '../gen/core/geom';
import type { LandArea, LandUseLayer, World } from '../gen/types';
import type { ForestOccupation, LandDetail } from '../../../rust/bridge/terrainForest';
import { fillRings } from './forestOccupation';
import { cultureEra } from '../gen/options';
const details = new WeakMap<LandUseLayer, Map<string, LandDetail | undefined>>();

/**
 * Crop positions on the shader's field ramp (`landFieldTone`), hue running one way along it: freshly turned soil,
 * plough, grey-brown fallow, stubble, wheat (gold when ripe), barley, rapeseed and sunflower (yellow in season only),
 * the grey-green of rye, oats, clover, beans.
 */
const CROP_TONES = [0, .07, .14, .21, .32, .43, .53, .61, .70, .79, .89, 1] as const;
/** Spread of the strips of a holding around its crop: a quarter of the gap to the next stop; the yellow crops stay
 * on theirs, so a rapeseed strip never takes the sunflower's tone. */
const CROP_SPREAD = [.02, .02, .02, .025, .025, .025, .008, .008, .02, .025, .025, .025] as const;
/**
 * Shares by agrarian tradition, in the order of CROP_TONES. Diversity stays discreet: the culture of the place shifts
 * the mosaic (more stubble, fallow and turned soil in dry traditions, more oats, clover and beans in wet and northern
 * ones, more wheat around the Mediterranean), with a few percent of rapeseed or sunflower where they are grown.
 */
const SHARES: Record<string, readonly number[]> = {
  //            turned plough fallow stubble wheat barley rape   sun    rye    oats  clover beans
  european:      [0,    .10,   0,    .10,   .28,  .19,   .03,   0,     0,    .19,   .03,  .08],
  northern:      [.02,  .08,   .03,  .08,   .16,  .20,   .04,   0,     .08,  .20,   .04,  .07],
  mediterranean: [.03,  .09,   .04,  .14,   .35,  .18,   0,     .03,   0,    .08,   .02,  .04],
  levant:        [.04,  .10,   .05,  .18,   .28,  .20,   0,     .02,   0,    .07,   .02,  .04],
  monsoon:       [.02,  .06,   .04,  .08,   .14,  .14,   .04,   0,     0,    .24,   .04,  .20],
  southAsia:     [.03,  .08,   .04,  .12,   .20,  .14,   .04,   .02,   0,    .17,   .04,  .12],
  aridSouthAsia: [.05,  .10,   .06,  .20,   .24,  .18,   .03,   0,     0,    .08,   .02,  .04],
  highland:      [.03,  .10,   .04,  .10,   .12,  .32,   .02,   0,     .06,  .15,   .02,  .04],
  mesoamerican:  [.03,  .10,   .05,  .12,   .12,  .12,   0,     .02,   0,    .22,   .02,  .20],
  andean:        [.03,  .10,   .04,  .10,   .13,  .24,   0,     0,     .02,  .18,   .02,  .14],
  savanna:       [.06,  .12,   .08,  .22,   .16,  .18,   0,     .02,   0,    .10,   0,    .06],
  ethiopian:     [.04,  .10,   .04,  .13,   .25,  .26,   0,     0,     0,    .10,   .02,  .06],
  nile:          [.03,  .09,   .03,  .12,   .32,  .20,   0,     0,     0,    .09,   .06,  .06],
  steppe:        [.04,  .10,   .06,  .18,   .20,  .25,   0,     .03,   .02,  .10,   0,    .02],
  wetland:       [.02,  .06,   .04,  .08,   .14,  .14,   .02,   0,     0,    .26,   .04,  .20],
  pacific:       [.03,  .10,   .04,  .10,   .14,  .14,   0,     0,     0,    .24,   .02,  .19],
  american:      [0,    .10,   .02,  .10,   .28,  .16,   .02,   .04,   0,    .18,   .03,  .07],
};
/** Agrarian tradition of each culture id (urban/cultures*.ts and the Rust catalogue); others farm the European way. */
const TRADITION: Record<string, string> = Object.fromEntries(Object.entries({
  northern: ['hanseatic', 'russian-kremlin', 'slavic-gord', 'rynek-town', 'flemish-cloth-town', 'barbarian', 'barbarian-celtic', 'barbarian-norse', 'norse-ringfort', 'celtic-oppidum', 'dwarven', 'giant-hold'],
  mediterranean: ['roman-core', 'italian-comune', 'byzantine-greek', 'venetian-lagoon', 'al-andalus', 'bastide', 'caucasian-highland'],
  levant: ['medina', 'ottoman', 'persian', 'mesopotamian', 'levantine-tell', 'ksar-oasis', 'oasis-caravan', 'hadhrami-tower'],
  monsoon: ['chinese', 'japanese-jokamachi', 'korean', 'vietnamese-citadel', 'khmer', 'bagan', 'javanese-courts', 'stilt-town'],
  southAsia: ['indian-temple', 'dravidian-temple', 'newar'],
  aridSouthAsia: ['rajput-fort', 'indus-planned'],
  highland: ['himalayan-terraces', 'tibetan-monastery'],
  mesoamerican: ['aztec', 'maya', 'mississippian', 'native-iroquoian', 'native-pueblo', 'guarani-village'],
  andean: ['inca'],
  savanna: ['sahel', 'hausa-kano', 'yoruba', 'great-zimbabwe', 'kraal', 'swahili-bazaar', 'swahili-stone', 'swahili-stone-town'],
  ethiopian: ['ethiopian-highland'],
  nile: ['egyptian-planned', 'nubian-fortified'],
  steppe: ['mongol-ordu', 'nomad-camp', 'native-plains', 'siberian-camp', 'inuit-camp', 'pnw-plank-village', 'budj-bim'],
  wetland: ['lizardfolk-swamp'],
  pacific: ['maori-pa'],
  american: ['american-grid'],
}).flatMap(([tradition, ids]) => ids.map(id => [id, tradition])));
/** The climate shifts the same mosaic: dry biomes leave more stubble and turned soil, wet and cold ones more green. */
const BIOME_SHIFT: Record<string, readonly number[]> = {
  desert: [1.3, 1.3, 1.4, 1.4, 1, 1, .8, 1.2, .8, .6, .5, .5], steppe: [1.2, 1.2, 1.3, 1.3, 1, 1, .9, 1.3, 1, .75, .6, .65],
  forest: [.9, .95, .9, .9, .9, 1, 1.1, .6, 1.2, 1.15, 1.1, 1.1], tundra: [.9, .95, .9, .9, .8, 1.05, .9, .2, 1.4, 1.25, 1, 1.1],
  tropical: [.9, .9, .9, .85, .85, .95, .8, 1, .6, 1.2, 1.2, 1.3],
};
type Crops = readonly (readonly [tone: number, share: number, spread: number])[];
const cropTables = new Map<string, Crops>();
/** Crop table of a culture and biome; temperate tables are used as written, others renormalised. */
function cropsOf(culture: string | undefined, biome: string | undefined): Crops {
  // A culture of a modern era farms like the listed modern one, whatever its id (gen/options cultureEra).
  const tradition = TRADITION[culture ?? ''] ?? (cultureEra(culture) === 'modern' ? 'american' : 'european'), shift = BIOME_SHIFT[biome ?? ''], key = `${tradition}:${shift ? biome : ''}`;
  let crops = cropTables.get(key);
  if (!crops) {
    const shares = SHARES[tradition].map((share, i) => share * (shift?.[i] ?? 1)), total = shift ? shares.reduce((a, b) => a + b, 0) : 1;
    crops = CROP_TONES.map((tone, i) => [tone, shares[i] / total, CROP_SPREAD[i]] as const);
    cropTables.set(key, crops);
  }
  return crops;
}
/** Share of the strips of a holding sown apart from it: the open-field mosaic. */
const STRAY_STRIP = .2;
/** Metres of edge distance held by the alpha channel; the shader reads the same range. */
const LAND_EDGE_RANGE = 6;
const DETAILED = new Set<LandArea['kind']>(['field', 'orchard', 'garden']);

const mix32 = (value: number): number => {
  let h = Math.imul(value ^ value >>> 16, 0x7feb352d); h = Math.imul(h ^ h >>> 15, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
};
const unit = (value: number): number => mix32(value) / 4294967296;
function pickCrop(crops: Crops, u: number): readonly [tone: number, share: number, spread: number] {
  let sum = 0;
  for (const crop of crops) { sum += crop[1]; if (u < sum) return crop; }
  return crops[crops.length - 1];
}

/** A place whose culture farms the holdings around it: a settlement (with its built radius) or a farmstead. */
export interface LandPlace { x: number; y: number; r?: number; culture?: string }
/** Cultures of the places of a map; land-use farmsteads always count. `culture` is the map's own, used far from all;
 * `biome` (World options) shifts the shares with the climate. */
export interface LandCultures { culture?: string; biome?: string; places?: LandPlace[] }
export const worldLandCultures = (world: Pick<World, 'settlements' | 'options'>): LandCultures => ({
  culture: world.options?.culture, biome: world.options?.biome,
  places: (world.settlements ?? []).map(s => ({ x: s.center.x, y: s.center.y, r: s.radius, culture: s.culture })),
});
const culturesKey = (cultures: LandCultures | undefined): string => !cultures ? '' : `${cultures.culture ?? ''}|${cultures.biome ?? ''}|${(cultures.places ?? [])
  .map(p => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.r ?? 0)},${p.culture ?? ''}`).join(';')}`;
/** Culture of the nearest place: settlements count from their built edge, farmsteads through a bucket grid. */
function cultureResolver(landuse: LandUseLayer, cultures: LandCultures | undefined): (x: number, y: number) => string | undefined {
  const towns = (cultures?.places ?? []).filter(p => p.culture);
  const farms = landuse.farmsteads.filter(f => f.culture);
  const size = 400, buckets = new Map<string, typeof farms>();
  let k0 = Infinity, k1 = -Infinity, l0 = Infinity, l1 = -Infinity;
  for (const farm of farms) {
    const i = Math.floor(farm.pos.x / size), j = Math.floor(farm.pos.y / size), key = `${i},${j}`;
    k0 = Math.min(k0, i); k1 = Math.max(k1, i); l0 = Math.min(l0, j); l1 = Math.max(l1, j);
    const list = buckets.get(key); if (list) list.push(farm); else buckets.set(key, [farm]);
  }
  return (x, y) => {
    let best = Infinity, culture = cultures?.culture;
    for (const town of towns) {
      const d = Math.max(0, Math.hypot(town.x - x, town.y - y) - (town.r ?? 0));
      if (d < best) { best = d; culture = town.culture; }
    }
    if (!farms.length) return culture;
    const ci = Math.floor(x / size), cj = Math.floor(y / size);
    const reach = Math.max(Math.abs(ci - k0), Math.abs(ci - k1), Math.abs(cj - l0), Math.abs(cj - l1));
    // Cells of ring k + 1 lie at least k cells away: stop once the best place is closer.
    for (let k = 0; k <= reach && best > (k - 1) * size; k++) {
      for (let j = cj - k; j <= cj + k; j++) for (let i = ci - k; i <= ci + k; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== k) continue;
        for (const farm of buckets.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(farm.pos.x - x, farm.pos.y - y);
          if (d < best) { best = d; culture = farm.culture; }
        }
      }
    }
    return culture;
  };
}
/** Direction of the longest edge: rows of an orchard or a garden follow their plot. */
function longestEdge(ring: Polygon): number {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (d > best) { best = d; angle = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  return angle;
}

/**
 * Rasterises the holdings of the rural land use for the satellite ground: the shader draws crops, furrows and
 * balks from it, so fields keep their real strips and directions without any vector overlay.
 * RGBA8, filterable: R crop position (the crops of the culture of the nearest place), G and B cos 2a and sin 2a of the
 * row direction, A exact signed distance to the nearest strip edge (.5 + d / 2 LAND_EDGE_RANGE: above .5 inside a holding,
 * below outside, 0 beyond the range); unowned texels along a holding carry its R, G and B. A garden's R is a
 * plain crop position too, jittered like a strip: the shader hashes R, G and B into the plot's identity.
 * Deterministic: same layer and cultures, same bytes.
 */
export function landDetail(landuse: LandUseLayer, cultures?: LandCultures, maxN = 3072, minCell = 1): LandDetail | undefined {
  let entries = details.get(landuse); if (!entries) { entries = new Map(); details.set(landuse, entries); }
  const key = `1:${maxN}:${minCell}:${culturesKey(cultures)}`;
  if (entries.has(key)) return entries.get(key);
  const result = buildLandDetail(landuse, cultures, maxN, minCell); entries.set(key, result);
  if (entries.size > 4) entries.delete(entries.keys().next().value!);
  return result;
}
function buildLandDetail(landuse: LandUseLayer, cultures: LandCultures | undefined, maxN: number, minCell: number): LandDetail | undefined {
  const areas = landuse.areas.filter(area => DETAILED.has(area.kind));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const area of areas) for (const p of area.poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (!(maxX > minX && maxY > minY)) return undefined;
  const side = Math.max(maxX - minX, maxY - minY), cell = Math.max(minCell, side / (maxN - 4)), n = Math.min(maxN, Math.ceil(side / cell) + 4);
  const x = (Math.floor(minX / cell) - 2) * cell, y = (Math.floor(minY / cell) - 2) * cell;
  const owner = new Uint32Array(n * n), edge = new Float32Array(n * n).fill(LAND_EDGE_RANGE), crop: number[] = [0], angle: number[] = [0];
  // Exact distance to a ring: per segment, refresh only the texels of its capsule of radius LAND_EDGE_RANGE (only
  // d < LAND_EDGE_RANGE can lower `edge`). Row by row, the texel centres within R of the segment lie within R in x of
  // the part of the segment whose y is within R of the row: a superset of the capsule, so the result is exact.
  const R = LAND_EDGE_RANGE;
  const stamp = (ring: Polygon): void => {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - R - y) / cell - .5)), j1 = Math.min(n - 1, Math.ceil((Math.max(a.y, b.y) + R - y) / cell - .5));
      for (let j = j0; j <= j1; j++) {
        const yc = y + (j + .5) * cell;
        // Segment parameters with |a.y + t dy - yc| <= R.
        let t0 = 0, t1 = 1;
        if (dy !== 0) { const u = (yc - R - a.y) / dy, v = (yc + R - a.y) / dy; t0 = Math.max(0, Math.min(u, v)); t1 = Math.min(1, Math.max(u, v)); if (t0 > t1) continue; }
        else if (Math.abs(a.y - yc) > R) continue;
        const xa = a.x + t0 * dx, xb = a.x + t1 * dx;
        const i0 = Math.max(0, Math.floor((Math.min(xa, xb) - R - x) / cell - .5)), i1 = Math.min(n - 1, Math.ceil((Math.max(xa, xb) + R - x) / cell - .5));
        const py = yc - a.y, row = j * n;
        for (let i = i0; i <= i1; i++) {
          const px = x + (i + .5) * cell - a.x, t = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
          const qx = px - t * dx, qy = py - t * dy, d2 = qx * qx + qy * qy, at = row + i, e = edge[at];
          if (d2 < e * e) edge[at] = Math.sqrt(d2);
        }
      }
    }
  };
  let next = 1;
  // A holding under its strips only shows in the slivers between them: those take the neighbouring strip.
  const under = new Set<number>();
  const paint = (rings: Polygon[], tone: number, direction: number, hidden = false): void => {
    const id = next++; crop[id] = tone; angle[id] = direction; if (hidden) under.add(id);
    fillRings(rings, x, y, cell, n, (from, to) => owner.fill(id, from, to));
    rings.forEach(stamp);
  };
  const cultureAt = cultureResolver(landuse, cultures);
  areas.forEach((area, index) => {
    let cx = 0, cy = 0; for (const p of area.poly) { cx += p.x; cy += p.y; }
    const crops = cropsOf(cultureAt(cx / area.poly.length, cy / area.poly.length), cultures?.biome);
    const [base, , spread] = pickCrop(crops, unit(index * 2 + 1)), direction = area.stripAngle ?? longestEdge(area.poly);
    // A garden's crop is jittered like a strip: with its direction it gives each plot its own identity in the shader.
    const tone = area.kind === 'garden' ? Math.min(1, Math.max(0, base + (unit(index * 2 + 2) * 2 - 1) * spread)) : base;
    paint([area.poly, ...area.holes ?? []], tone, direction, !!area.strips?.length);
    area.strips?.forEach((strip, k) => {
      const salt = index * 8191 + k * 2 + 1, stray = unit(salt) < STRAY_STRIP;
      paint([strip], stray ? pickCrop(crops, unit(salt + 1))[0] : Math.min(1, Math.max(0, base + (unit(salt + 1) * 2 - 1) * spread)), direction);
    });
  });
  const rgba = new Uint8Array(n * n * 4), scale = 127.5 / LAND_EDGE_RANGE;
  const cos2 = angle.map(a => Math.round((Math.cos(2 * a) * .5 + .5) * 255)), sin2 = angle.map(a => Math.round((Math.sin(2 * a) * .5 + .5) * 255)), tone = crop.map(c => Math.round(c * 255));
  // Crops meet at the true edge: a texel across from another strip takes its share, so filtering draws a straight line.
  const across = (i: number, id: number): number => {
    for (const step of [1, -1, n, -n, n + 1, n - 1, 1 - n, -1 - n]) { const other = owner[i + step]; if (other && other !== id) return other; }
    return 0;
  };
  // Unowned texels next to a holding take its crop and direction (two rings): filtering at the outer limit of the
  // fields then mixes crops, never a crop with the zero byte, which drew a dark rim around every field.
  let grown = owner;
  for (let pass = 0; pass < 2; pass++) {
    const step = grown.slice();
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const at = j * n + i; if (grown[at] || edge[at] >= 2 * cell) continue;
      for (const k of [1, -1, n, -n]) { const id = grown[at + k]; if (id) { step[at] = id; break; } }
    }
    grown = step;
  }
  let hash = 0x811c9dc5;
  for (let i = 0, o = 0; i < n * n; i++, o += 4) {
    const id = owner[i];
    // Alpha: signed distance to the nearest strip edge over ±LAND_EDGE_RANGE, positive inside a holding, negative
    // outside, so the outer limit of the fields filters into a straight line; 0 beyond the range outside.
    if (!id) {
      const near = grown[i]; if (!near && edge[i] >= LAND_EDGE_RANGE) continue;
      if (near) { rgba[o] = tone[near]; rgba[o + 1] = cos2[near]; rgba[o + 2] = sin2[near]; }
      rgba[o + 3] = Math.max(0, Math.min(127, Math.round(127.5 - edge[i] * scale)));
      continue;
    }
    const other = (under.has(id) || edge[i] < cell) && i > n && i < n * n - n - 1 ? across(i, id) : 0;
    rgba[o] = !other ? tone[id] : under.has(id) ? tone[other] : Math.round(tone[id] + (under.has(other) ? 0 : (tone[other] - tone[id]) * .5 * (1 - edge[i] / cell))); rgba[o + 1] = cos2[id]; rgba[o + 2] = sin2[id]; rgba[o + 3] = Math.max(128, Math.min(255, Math.round(127.5 + edge[i] * scale)));
    hash = Math.imul(hash ^ id ^ i ^ rgba[o] << 24 ^ (rgba[o + 1] << 8) ^ (rgba[o + 2] << 16), 0x01000193);
  }
  const orchards = areas.filter(a => a.kind === 'orchard').map(a => {
    const direction = a.stripAngle ?? longestEdge(a.poly);
    const co = Math.round((Math.cos(2 * direction) * .5 + .5) * 255) / 255 * 2 - 1;
    const si = Math.round((Math.sin(2 * direction) * .5 + .5) * 255) / 255 * 2 - 1;
    const angle = .5 * Math.atan2(si, co);
    return { poly: a.poly, holes: a.holes, along: [Math.cos(angle), Math.sin(angle)] as [number, number] };
  });
  return { x, y, width: n * cell, n, rgba, orchards, key: `land:${x}:${y}:${n * cell}:${n}:${(hash >>> 0).toString(36)}` };
}

/** The occupation of a land use with its holdings attached. */
export function withLandDetail(occupation: ForestOccupation | undefined, landuse: LandUseLayer, cultures?: LandCultures): ForestOccupation | undefined {
  return occupation && { ...occupation, detail: landDetail(landuse, cultures) };
}
