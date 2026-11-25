/** Three metres of roof covering. The tile's +y axis points toward the eaves.
 * The renderer supplies the roof colour. Local pigments describe glaze, foliage, mineral facets and panels. */
import { COVER_GRAINS, roofGrain } from './buildingMaterials';

const SIDE = 256;
const TURN = 2 * Math.PI;
type Brush = CanvasRenderingContext2D;
type Random = () => number;
const grey = (value: number): string => `rgb(${Math.round(value)} ${Math.round(value)} ${Math.round(value)})`;
const pigment = (base: number, r: number, g: number, b: number): string => `rgb(${Math.round(base + r)} ${Math.round(base + g)} ${Math.round(base + b)})`;
const wrap = (v: number, period: number): number => ((v % period) + period) % period;
const styles = new Set<string>([...COVER_GRAINS, 'leaf-scale', 'obsidian', 'riveted', 'service-panel', 'cassette', 'glazing', 'solar', 'canopy', 'snow', 'bitumen', 'fungal', 'membrane']);
const indian = new Set(['indian-temple', 'dravidian-temple', 'rajput-fort', 'south-asian-metropolis']);
const catalogueCovers: Readonly<Record<string, string>> = {
  'MAT-TILE-CLAY': 'tile',
  'MAT-PLASTER-LIME': 'plaster',
  'MAT-SLATE': 'slate',
  'MAT-STONE-ASHLAR': 'stone',
  'MAT-STONE-DRY': 'stone',
  'MAT-STONE-MORTAR': 'stone',
  'MAT-BASALT': 'stone',
  'MAT-LIMESTONE': 'stone',
  'MAT-THATCH': 'thatch',
  'MAT-REED': 'reed',
  'MAT-PALM': 'palm',
  'MAT-BARK': 'bark',
  'MAT-BAMBOO': 'bamboo',
  'MAT-WOOD-SHINGLES': 'shingle',
  'MAT-FELT': 'felt',
  'MAT-HIDE': 'hide',
  'MAT-TURF': 'turf',
  'MAT-MUD-PLASTER': 'earth',
};
export type RoofFaceForm = 'terrace' | 'pitch' | 'tower';

/** The actual pan decides the laying direction. Steep masonry over a temple may take dressed
 * courses; a sloped annex or a flat crown on the same site keeps its own construction. */
export function roofFaceForm(normal: readonly number[], role: string): RoofFaceForm {
  const up = Math.abs(normal[2]) / (Math.hypot(normal[0], normal[1], normal[2]) || 1);
  if (up > 0.995) return 'terrace';
  return up < 0.72 && /^(?:worship\.(?:temple|shrine)(?:\.|$)|(?:vimana|gopuram)$)/.test(role) ? 'tower' : 'pitch';
}

/** Canonical artwork key. Different cultures share a layer when their construction is identical. */
export function houseRoofStyle(culture: string, raw: string, form: RoofFaceForm = 'pitch', fallback?: string): string {
  // Only catalogue IDs require a pattern fallback. Massing covers already name their material.
  const declared = catalogueCovers[raw] ?? raw;
  if (indian.has(culture)) {
    if (declared === 'tile') {
      if (form === 'terrace') return 'terrace-clay';
      return culture === 'south-asian-metropolis' ? 'pressed-clay' : 'country-clay';
    }
    if (declared === 'MAT-BURNT-BRICK') return form === 'terrace' ? 'terrace-clay' : 'brick-courses';
    if (declared === 'stone' || declared === 'slab') {
      if (form === 'tower') return 'dressed-courses';
      if (form === 'terrace') return culture === 'rajput-fort' ? 'sandstone-flags' : 'stone-flags';
      return 'roof-slabs';
    }
    if ((declared === 'plaster' || declared === 'lime') && form === 'terrace') return 'lime-terrace';
  }
  const cover = catalogueCovers[raw] ?? fallback ?? raw;
  const material = /^(?:zinc|metal|lead|bitumen|glass|fungal|snow|ruin)$/.test(cover) ? cover : (roofGrain(cover, form === 'terrace', culture) ?? cover);
  const skin = ['lime', 'felt', 'metal', 'steel', 'zinc', 'glass', 'bitumen', 'plaster'].includes(material);
  if (skin) {
    if (culture === 'futuristic-space-colony' || culture === 'corporate-arcology') return material === 'glass' ? 'glazing' : 'cassette';
    if (culture === 'cyberpunk') return 'service-panel';
    if (culture === 'solarpunk' && material !== 'plaster') return 'solar';
    if (culture === 'duergar-hold' || culture === 'dieselpunk' || culture === 'dwarven' || culture === 'gnomish') return 'riveted';
    if (culture === 'biopunk-organic-city') return 'membrane';
    if (culture === 'myconid-colony') return 'fungal';
  }
  if ((culture === 'elven' || culture === 'merfolk-tidal') && ['tile', 'slate', 'shingle', 'palm'].includes(material)) return 'leaf-scale';
  if (culture === 'drow-enclave' && ['slab', 'slate', 'stone', 'paving'].includes(material)) return 'obsidian';
  if (material === 'tile') return roofGrain('tile', false, culture) ?? 'tile';
  switch (material) {
    case 'plaster':
      return 'lime';
    case 'lead':
    case 'zinc':
    case 'steel':
      return 'metal';
    case 'glass':
      return 'glazing';
    case 'ruin':
    case 'stone':
      return 'slab';
    case 'wood':
      return 'shingle';
    case 'fabric':
      return 'felt';
    default:
      return styles.has(material) ? material : '';
  }
}

function random(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

/** Repaint the few crossing units just outside the tile with their wrapped seed. Start at the
 * eaves so each upper course can cast a lip over the top of the course below. */
function courses(ctx: Brush, cols: number, rows: number, stagger: boolean, seed: number, draw: (w: number, h: number, rand: Random, column: number, row: number) => void): void {
  const w = SIDE / cols,
    h = SIDE / rows;
  for (let row = rows; row >= -1; row--) {
    const r = wrap(row, rows);
    for (let col = -1; col <= cols; col++) {
      const c = wrap(col, cols);
      ctx.save();
      ctx.translate((col + (stagger ? (r & 1) * 0.5 : 0)) * w, row * h);
      draw(w, h, random(seed ^ Math.imul(c + 1, 0x68bc21eb) ^ Math.imul(r + 1, 0x2c1b3c6d)), c, r);
      ctx.restore();
    }
  }
}

function stroke(ctx: Brush, tone: number, width: number, x1: number, y1: number, x2: number, y2: number): void {
  ctx.strokeStyle = grey(tone);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Stone flags and terrace tiles meet edge to edge. Dressed tower courses are shallower;
 * only inclined roof slabs leave a slightly darker lap along their lower edge. */
function fittedCourses(ctx: Brush, style: string, seed: number): void {
  const brick = style === 'brick-courses',
    fired = brick || style === 'terrace-clay',
    sandstone = style === 'sandstone-flags';
  const cols = brick ? 12 : fired ? 10 : style === 'paving' ? 6 : 4;
  const rows = brick ? 31 : fired ? 12 : style === 'dressed-courses' ? 11 : style === 'roof-slabs' ? 7 : 5;
  const mortar = style === 'roof-slabs' ? 1.2 : 0.55;
  const shift = (c: number, r: number): number => random(seed ^ Math.imul(wrap(c, cols) + 1, 0x68bc21eb) ^ Math.imul(wrap(r, rows) + 1, 0x2c1b3c6d))() - 0.5;
  courses(ctx, cols, rows, true, seed, (w, h, rand, c, r) => {
    const x = shift(c, r) * w * 0.3,
      end = w + shift(c + 1, r) * w * 0.3;
    const y = shift(0, r) * h * 0.22,
      bottom = h + shift(0, r + 1) * h * 0.22;
    const tone = 207 + (rand() - 0.5) * (fired ? 17 : 9);
    ctx.fillStyle = fired ? pigment(tone, 13, -3, -13) : sandstone ? pigment(tone, 8, 1, -11) : pigment(tone, 1, 0, -2);
    ctx.fillRect(x, y, end - x + 0.2, bottom - y + 0.2);
    stroke(ctx, tone - 32, mortar, x + 0.2, y, x + 0.2, bottom);
    stroke(ctx, tone - 34, mortar, x, bottom - 0.4, end, bottom - 0.4);
    if (!fired) {
      for (let i = 0; i < 8; i++) {
        const px = x + (end - x) * rand(),
          py = y + (bottom - y) * rand();
        stroke(ctx, tone + (rand() - 0.5) * 20, 0.45, px, py, Math.min(end, px + 1 + rand() * 3), py + 0.3);
      }
    }
  });
}

/** Handmade split-cylinder coverings sit in a pan and cap arrangement. Later pressed clay
 * has broad, flatter faces with shallow longitudinal flutes and narrow interlocking edges. */
function clayCover(ctx: Brush, pressed: boolean, seed: number): void {
  courses(ctx, pressed ? 12 : 16, pressed ? 8 : 9, false, seed, (w, h, rand, col) => {
    const tone = 204 + (rand() - 0.5) * (pressed ? 13 : 22);
    const clay = (shade: number): string => pigment(tone + shade, 15, -2, -14);
    // Slightly offset lap joints in adjacent runs. Every wrapped copy of a column uses the same shift.
    ctx.translate(0, h * 0.32 * random(seed ^ Math.imul(col + 1, 0x85ebca6b))());
    const pan = ctx.createLinearGradient(0, 0, w, 0);
    for (const [at, shade] of pressed
      ? [
          [0, -19],
          [0.13, 5],
          [0.24, 2],
          [0.32, -7],
          [0.38, 3],
          [0.62, 3],
          [0.69, -7],
          [0.77, 3],
          [0.9, 4],
          [1, -16],
        ]
      : [
          [0, 3],
          [0.28, -7],
          [0.54, -2],
          [0.8, 6],
          [1, 1],
        ])
      pan.addColorStop(at, clay(shade));
    ctx.fillStyle = pan;
    ctx.fillRect(0, 0, w + 0.2, h + 0.3);
    stroke(ctx, tone - 25, 0.8, w * 0.05, h - 1.4, w * 0.57, h - 0.8);
    if (pressed) return;
    const left = w * (0.56 + rand() * 0.045),
      right = w * 0.98,
      swell = 0.055 * w;
    const roll = ctx.createLinearGradient(left - swell, 0, right, 0);
    roll.addColorStop(0, clay(-24));
    roll.addColorStop(0.36, clay(14));
    roll.addColorStop(0.62, clay(8));
    roll.addColorStop(1, clay(-15));
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(right - swell, 0);
    ctx.lineTo(right, h - 1);
    ctx.quadraticCurveTo((left + right) / 2, h + 1.3, left - swell, h - 0.7);
    ctx.closePath();
    ctx.fillStyle = roll;
    ctx.fill();
    stroke(ctx, tone - 32, 1, left - swell, h - 0.65, right, h - 1.05);
  });
}

function limeTerrace(ctx: Brush, seed: number): void {
  courses(ctx, 4, 4, false, seed, (w, h, rand) => {
    for (let k = 0; k < 5; k++) {
      const x = rand() * w,
        y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + w * 0.14, y - h * 0.1, x + w * 0.29, y - h * 0.07);
      ctx.strokeStyle = grey(205 + rand() * 8);
      ctx.lineWidth = 0.7 + rand() * 1.1;
      ctx.stroke();
    }
  });
}

function roofUnits(ctx: Brush, style: string, seed: number): void {
  const timber = style === 'shingle';
  const scale = style === 'leaf-scale';
  const rock = style === 'slab' || style === 'obsidian';
  const cols = rock ? 6 : scale ? 9 : 13;
  const rows = scale ? 8 : 12;
  courses(ctx, cols, rows, true, seed, (w, h, rand) => {
    const tint = 192 + rand() * 35,
      end = h + rand() * (rock ? 2.4 : 1.5);
    const tip = scale ? h * 0.36 : style === 'tile' ? h * 0.14 : rand() * 1.5;
    const lip = 0.7 + rand() * 0.7,
      left = 0.45 + rand() * 0.45,
      right = w - 0.45;
    ctx.fillStyle = grey(115);
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(left, -0.5);
    ctx.lineTo(right, -0.5);
    ctx.lineTo(right, end - tip);
    ctx.quadraticCurveTo(w * 0.84, end, w * 0.5, end + tip * 0.2);
    ctx.lineTo(left + w * 0.09, end - tip * 0.35);
    ctx.lineTo(left, end - tip - rand() * 1.6);
    ctx.closePath();
    const wash = ctx.createLinearGradient(0, 0, 0, end);
    wash.addColorStop(0, grey(tint - 18));
    wash.addColorStop(0.35, grey(tint));
    wash.addColorStop(0.91, grey(tint + 4));
    wash.addColorStop(1, grey(tint - 18));
    ctx.strokeStyle = grey(124);
    ctx.lineWidth = lip * 2;
    ctx.stroke();
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.clip();
    if (style === 'tile' && rand() < 0.34) {
      ctx.fillStyle = rand() < 0.6 ? 'rgba(172,87,42,.21)' : 'rgba(242,180,110,.19)';
      ctx.fillRect(0, 0, w, end);
    }
    if (scale) {
      ctx.fillStyle = rand() < 0.27 ? 'rgba(220,188,108,.26)' : 'rgba(82,159,141,.17)';
      ctx.fillRect(0, 0, w, end);
      stroke(ctx, tint + 14, 0.8, w * 0.5, 1, w * 0.5, end);
      for (let i = 1; i <= 4; i++) {
        const y = (i * h) / 5;
        stroke(ctx, tint - 15, 0.7, 0, y - 4, w * 0.5, y + 3);
        stroke(ctx, tint - 15, 0.7, w, y - 4, w * 0.5, y + 3);
      }
    } else if (timber) {
      for (let i = 0; i < 12; i++) {
        const x = rand() * w,
          y = rand() * h;
        stroke(ctx, tint + (rand() - 0.54) * 54, 0.3 + rand() * 0.8, x, y - h * 0.65, x + rand() * 1.5, y + h * 0.75);
      }
      if (rand() < 0.5) {
        const x = w * (0.2 + 0.6 * rand());
        stroke(ctx, tint - 52, 0.75, x, end, x + 0.5, end - h * (0.15 + rand() * 0.5));
      }
    } else if (rock || style === 'slate') {
      for (let i = 0; i < 4; i++) {
        const x = w * rand(),
          y = h * rand();
        stroke(ctx, tint + (rand() - 0.48) * 48, 0.4 + rand() * 0.7, x - w * 0.2, y + h * 0.1, x + w * 0.28, y - h * 0.08);
      }
      if (style === 'obsidian') {
        ctx.fillStyle = pigment(tint - 20, 15, -15, 27);
        ctx.beginPath();
        ctx.moveTo(w, h * 0.28);
        ctx.lineTo(w, h);
        ctx.lineTo(w * 0.64, h);
        ctx.fill();
        ctx.strokeStyle = 'rgba(225,151,231,.72)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(w, h * 0.28);
        ctx.lineTo(w * 0.64, h);
        ctx.stroke();
      }
    }
    if (!scale) stroke(ctx, tint + 15, 0.8, w * 0.13, end - 1.6, w * (0.53 + rand() * 0.31), end - 1.5);
  });
}

function channels(ctx: Brush, style: string, seed: number): void {
  const glazed = style === 'glazed',
    cane = style === 'bamboo';
  courses(ctx, cane ? 25 : glazed ? 11 : 10, cane ? 1 : 8, false, seed, (w, h, rand) => {
    const tint = 191 + rand() * (glazed ? 15 : 32);
    const profile = ctx.createLinearGradient(0, 0, w, 0);
    // The raised half-round cover sits over the joint between the concave pans.
    for (const [at, shade] of [
      [0, -39],
      [0.09, -18],
      [0.28, 4],
      [0.53, 10],
      [0.61, -39],
      [0.69, 8],
      [0.76, glazed ? 38 : 27],
      [0.85, 7],
      [1, -39],
    ]) {
      const tone = tint + shade;
      profile.addColorStop(at, glazed ? pigment(tone, -20 + shade * 0.18, 7, 5 + shade * 0.18) : cane ? grey(tone) : pigment(tone, 12, -2, -13));
    }
    ctx.fillStyle = profile;
    ctx.fillRect(0, 0, w + 0.1, h + 0.1);
    if (cane) {
      const offset = rand() * 32;
      for (let y = offset; y < h; y += h / 8) {
        stroke(ctx, tint - 33, 1.8, 0.4, y, w - 0.4, y + 0.4);
        stroke(ctx, tint + 18, 0.7, 0.6, y + 0.8, w - 0.8, y + 1.2);
      }
    } else {
      ctx.strokeStyle = grey(tint - 52);
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(0, h - 1.6);
      ctx.quadraticCurveTo(0.32 * w, h + 0.8, 0.61 * w, h - 1.3);
      ctx.quadraticCurveTo(0.78 * w, h - 4.7, w, h - 1.6);
      ctx.stroke();
      stroke(ctx, tint + 20, 0.6, w * 0.68, h - 2.8, w * 0.8, h - 3.65);
    }
  });
}

function thatching(ctx: Brush, style: string, seed: number): void {
  const palm = style === 'palm',
    reed = style === 'reed';
  courses(ctx, palm ? 10 : 13, palm ? 6 : 4, true, seed, (w, h, rand) => {
    const center = w * (0.4 + rand() * 0.2),
      swing = (rand() - 0.5) * w * 0.29;
    const bottom = h * (0.95 + rand() * 0.17);
    for (let i = 0; i < (palm ? 34 : 71); i++) {
      const t = rand() - 0.5;
      const x = center + t * w * 1.33;
      const y = bottom - (palm ? Math.abs(t) * h * 0.45 : 0) + rand() * h * 0.12;
      const startX = palm ? center : x + swing + (rand() - 0.5) * 3;
      const startY = palm ? Math.abs(t) * -h * 0.6 : -h * rand() * 0.22;
      const tone = 160 + rand() * 81;
      stroke(ctx, tone, palm ? 2.1 : reed ? 0.65 : 0.9, startX, startY, x + swing, y);
      stroke(ctx, tone - 32, palm ? 0.75 : 0.5, x + swing, y - 1.3, x + swing, y + 0.25);
    }
    if (palm) stroke(ctx, 225, 1, center, 0, center + swing, bottom);
  });
}

/** Leaf clusters grow out along branching shoots at several depths. Cross-boundary branches and
 * leaves are redrawn by the same wrapped cell, retaining their contours when the crown repeats. */
function canopy(ctx: Brush, seed: number): void {
  ctx.fillStyle = grey(147);
  ctx.fillRect(0, 0, SIDE, SIDE);
  for (let depth = 0; depth < 2; depth++) {
    courses(ctx, 5, 6, true, seed ^ Math.imul(depth, 0x7f4a7c15), (w, h, rand) => {
      ctx.translate(w * rand(), h * rand());
      ctx.rotate(rand() * TURN);
      for (let stem = 0; stem < 4; stem++) {
        ctx.rotate(0.9 + rand());
        const length = h * (0.55 + rand() * 0.44);
        stroke(ctx, 151 + depth * 15, 1.25, 0, 0, 0, length);
        for (let pair = 0; pair < 5; pair++)
          for (const side of [-1, 1]) {
            const y = ((pair + 0.7) * length) / 5;
            const reach = (5 + rand() * 5) * (1 - 0.09 * pair);
            const tone = 160 + depth * 22 + rand() * 48;
            const midX = reach * side * 0.58,
              midY = y + reach * 0.44;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.quadraticCurveTo(midX, y - 1.6, reach * side, y + reach * 0.65);
            ctx.quadraticCurveTo(midX, midY + 3, 0, y);
            ctx.fillStyle = depth ? pigment(tone, 4, 14, -24) : pigment(tone, -13, 7, -6);
            ctx.fill();
            stroke(ctx, tone + 15, 0.45, 0, y, midX, midY);
          }
      }
    });
  }
}

/** Bark peels off the trunk in broad, uneven sheets. Each lap holds rough fibres and
 * split ridges; its comparatively faint edges never turn a longhouse into a shingle roof. */
function barkSheets(ctx: Brush, seed: number): void {
  courses(ctx, 3, 2, true, seed, (w, h, rand) => {
    const tone = 199 + rand() * 15;
    ctx.fillStyle = pigment(tone, 4, 0, -7);
    ctx.fillRect(0, 0, w, h + 0.5);
    for (let i = 0; i < 65; i++) {
      const x = rand() * w,
        y = rand() * h,
        end = Math.min(h, y + 6 + rand() * 50);
      const curl = (rand() - 0.5) * 3.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + curl, y + 4, x - curl, end - 5, x + curl * 0.45, end);
      ctx.strokeStyle = grey(tone + (rand() - 0.58) * 37);
      ctx.lineWidth = 0.4 + rand() * 1.15;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, h - 1.2);
    for (let k = 1; k <= 9; k++) ctx.lineTo((k * w) / 9, h - rand() * 1.8);
    ctx.strokeStyle = grey(tone - 25);
    ctx.lineWidth = 1;
    ctx.stroke();
    stroke(ctx, tone - 18, 0.9, 0.5, h * 0.15, 0.8, h);
  });
}

/** The ger's construction seams are geometry. At this scale the wool itself only shows
 * compressed nap and stray short fibres. Hide has longer, soft, branching wrinkles. */
function softCover(ctx: Brush, hide: boolean, seed: number): void {
  courses(ctx, 8, 8, false, seed, (w, h, rand) => {
    for (let k = 0; k < (hide ? 3 : 38); k++) {
      const x = w * rand(),
        y = h * rand(),
        angle = rand() * TURN;
      const len = hide ? w * (0.22 + rand() * 0.42) : 0.8 + rand() * 2.1;
      const dx = Math.cos(angle) * len,
        dy = Math.sin(angle) * len;
      const light = 208 + (rand() - 0.55) * (hide ? 22 : 32);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dx * 0.57 - dy * 0.09, y + dy * 0.54 + dx * 0.09, x + dx, y + dy);
      ctx.strokeStyle = pigment(light, 2, 0, -3);
      ctx.lineWidth = hide ? 0.7 : 0.45;
      ctx.stroke();
    }
  });
}

function sheets(ctx: Brush, style: string, seed: number): void {
  const glass = style === 'glazing' || style === 'solar';
  const plate = style === 'riveted' || style === 'cassette' || style === 'service-panel';
  courses(ctx, glass || plate ? 3 : 6, glass ? 4 : plate ? 3 : 2, !glass, seed, (w, h, rand) => {
    const tone = 199 + rand() * 19;
    const wash = ctx.createLinearGradient(0, 0, w, glass ? h * 0.63 : 0);
    const pane = (light: number): string => (style === 'solar' ? pigment(light, -32, -7, 21) : glass ? pigment(light, -18, 5, 11) : grey(light));
    wash.addColorStop(0, pane(tone - (glass ? 27 : 12)));
    wash.addColorStop(0.44, glass ? pigment(tone + 6, -2, 12, 22) : grey(tone + 5));
    wash.addColorStop(0.46, pane(tone + (glass ? 2 : 5)));
    wash.addColorStop(1, pane(tone - 4));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w + 0.2, h + 0.2);
    stroke(ctx, tone - (glass ? 81 : 47), glass ? 3.3 : 2.4, 1.5, 0, 1.5, h);
    stroke(ctx, tone + 26, 1, 3, 0, 3, h);
    stroke(ctx, tone - 46, glass ? 2.7 : 1.2, 0, h - 1, w, h - 1);
    if (plate) {
      for (const x of [6, w - 5])
        for (const y of [5, h - 6]) {
          ctx.fillStyle = grey(tone - 63);
          ctx.beginPath();
          ctx.arc(x, y, 1.35, 0, TURN);
          ctx.fill();
          ctx.fillStyle = grey(tone + 25);
          ctx.fillRect(x - 0.7, y - 0.9, 1.1, 0.9);
        }
      if (style === 'service-panel' && rand() < 0.42) {
        ctx.fillStyle = grey(tone - 21);
        ctx.fillRect(w * 0.3, h * 0.28, w * 0.43, h * 0.38);
        for (let i = 0; i < 6; i++) stroke(ctx, tone - 66, 1.5, w * 0.34, h * 0.32 + i * h * 0.052, w * 0.69, h * 0.32 + i * h * 0.052);
        ctx.fillStyle = '#685e66';
        ctx.fillRect(w * 0.29, h * 0.68, w * 0.36, 4);
        ctx.fillStyle = rand() < 0.7 ? '#83f3ec' : '#ffc98b';
        ctx.fillRect(w * 0.31, h * 0.68 + 0.7, w * 0.26, 2.4);
      } else if (style === 'cassette') {
        const y = h * 0.78;
        stroke(ctx, tone - 21, 1.25, 6, y, w * 0.3, y);
        stroke(ctx, tone - 21, 1.25, w * 0.3, y, w * 0.36, y + 5);
        stroke(ctx, tone - 21, 1.25, w * 0.36, y + 5, w - 7, y + 5);
        ctx.fillStyle = rand() < 0.78 ? '#81c9db' : '#dcaa6b';
        ctx.fillRect(w * 0.4, y + 3.5, w * 0.23, 2.5);
      }
    } else if (style === 'solar') {
      for (let i = 1; i < 8; i++) stroke(ctx, tone - 34, 0.85, (i * w) / 8, 1, (i * w) / 8, h - 2);
      for (let i = 1; i < 6; i++) stroke(ctx, tone + 15, 0.65, 3, (i * h) / 6, w, (i * h) / 6);
    }
  });
}

/** A wrapped value-noise grid gives weathering continuous across UV boundaries and scales
 * independently of texel resolution. Centred at zero so the palette survives mip filtering. */
function noiseField(cols: number, rows: number, rand: Random): (u: number, v: number) => number {
  const width = cols + 1;
  const grid = new Float32Array(width * (rows + 1));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) grid[y * width + x] = rand() - 0.5;
    grid[y * width + cols] = grid[y * width];
  }
  grid.copyWithin(rows * width, 0, width);
  return (u, v) => {
    const x = u * cols,
      y = v * rows;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      i = iy * width + ix;
    const fx = x - ix,
      fy = y - iy;
    const tx = fx * fx * (3 - 2 * fx),
      ty = fy * fy * (3 - 2 * fy);
    const a = grid[i] + (grid[i + 1] - grid[i]) * tx;
    const b = grid[i + width] + (grid[i + width + 1] - grid[i + width]) * tx;
    return a + (b - a) * ty;
  };
}

/** Paint one opaque tile whose average sRGB luminance is approximately .82. */
export function paintHouseRoof(ctx: Brush, size: number, style: string, variant = 0): void {
  let seed = variant | 0;
  for (let i = 0; i < style.length; i++) seed = (Math.imul(seed, 31) + style.charCodeAt(i)) | 0;
  ctx.save();
  ctx.scale(size / SIDE, size / SIDE);
  ctx.fillStyle = grey(209);
  ctx.fillRect(0, 0, SIDE, SIDE);
  switch (style) {
    case 'tile':
    case 'slate':
    case 'slab':
    case 'shingle':
    case 'obsidian':
    case 'leaf-scale':
      roofUnits(ctx, style, seed);
      break;
    case 'paving':
    case 'brick-courses':
    case 'terrace-clay':
    case 'stone-flags':
    case 'sandstone-flags':
    case 'roof-slabs':
    case 'dressed-courses':
      fittedCourses(ctx, style, seed);
      break;
    case 'country-clay':
    case 'pressed-clay':
      clayCover(ctx, style === 'pressed-clay', seed);
      break;
    case 'lime-terrace':
      limeTerrace(ctx, seed);
      break;
    case 'bark':
      barkSheets(ctx, seed);
      break;
    case 'felt':
    case 'hide':
      softCover(ctx, style === 'hide', seed);
      break;
    case 'pantile':
    case 'glazed':
    case 'bamboo':
      channels(ctx, style, seed);
      break;
    case 'palm':
    case 'thatch':
    case 'reed':
      thatching(ctx, style, seed);
      break;
    case 'canopy':
      canopy(ctx, seed);
      break;
    case 'metal':
    case 'riveted':
    case 'cassette':
    case 'service-panel':
    case 'glazing':
    case 'solar':
    case 'bitumen':
      sheets(ctx, style, seed);
      break;
  }
  ctx.restore();

  // Fibre, aggregate, mineral flecks and soft, wind-scoured snow read at different scales.
  const rand = random(seed ^ 0xbea5909),
    turf = style === 'turf',
    skin = style === 'fungal' || style === 'membrane';
  const soft = style === 'felt' || style === 'hide';
  const grit = style === 'earth' || style === 'bitumen',
    wood = style === 'shingle' || style === 'bark';
  const clouds = noiseField(5, style === 'snow' ? 9 : 5, rand);
  const spots = noiseField(turf ? 39 : style === 'fungal' ? 10 : 18, turf ? 30 : style === 'fungal' ? 9 : 16, rand);
  const grain = noiseField(wood ? 112 : 84, wood ? 9 : 79, rand);
  const pixels = ctx.getImageData(0, 0, size, size),
    data = pixels.data;
  let sum = 0;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        offset = (y * size + x) * 4;
      const spot = spots(u, v),
        fleck = grain(u, v);
      let relief = 0,
        red = 0,
        green = 0,
        blue = 0;
      if (skin) {
        if (style === 'fungal') {
          // Low, pale scales emerge from a waxy continuous skin. Their edges soften
          // into the cap; the underlying pigments can still vary between individuals.
          const patch = Math.max(0, Math.min(1, (spot + fleck * 0.075 - 0.24) * 8));
          relief = 22 * patch + spot * 6;
          red = 4 + 10 * patch;
          green = -2 + 8 * patch;
          blue = -4 + 3 * patch;
        } else {
          const vein = Math.abs(spot + 0.12 * fleck);
          relief = vein < 0.034 ? 18 : vein < 0.069 ? -13 : spot * 34;
          if (vein < 0.034) {
            red = -32;
            green = 28;
            blue = 8;
          } else {
            red = 6;
            green = -4;
            blue = 10;
          }
        }
      } else if (turf) {
        // Dry tufts warm to straw while the hollows hold damp moss.
        red = 46 * spot - 6;
        green = 10;
        blue = -18 - 18 * spot;
      } else if (style === 'earth' && Math.abs(spot + 0.07 * fleck) < 0.015 && clouds(u, v) > 0.1) relief = -23;
      const weather = relief + (turf ? 38 : soft ? 12 : 19) * clouds(u, v) + (turf ? 60 : soft ? 5 : 11) * spot + (turf || wood ? 31 : grit ? 22 : soft ? 6 : 10) * fleck + (rand() - 0.5) * (grit ? 24 : turf ? 19 : soft ? 5 : 9);
      data[offset] += weather + red;
      data[offset + 1] += weather + green;
      data[offset + 2] += weather + blue;
      sum += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    }
  }
  const adjust = 209 - sum / (size * size);
  for (let i = 0; i < data.length; i += 4) {
    data[i] += adjust;
    data[i + 1] += adjust;
    data[i + 2] += adjust;
  }
  ctx.putImageData(pixels, 0, 0);
}
