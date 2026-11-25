/** A three-metre sample of the material between the openings. Cornices, belts,
 * frames and other details whose position belongs to a building are mesh geometry. */
type Ctx = CanvasRenderingContext2D;
type Finish =
  | 'brick'
  | 'handBrick'
  | 'rubble'
  | 'ashlar'
  | 'cyclopean'
  | 'slate'
  | 'obsidian'
  | 'coral'
  | 'snow'
  | 'earth'
  | 'lime'
  | 'whitewash'
  | 'clay'
  | 'timberInfill'
  | 'boards'
  | 'logs'
  | 'oiledWood'
  | 'salvagedWood'
  | 'treeBark'
  | 'barkSheets'
  | 'wattle'
  | 'bamboo'
  | 'felt'
  | 'hide'
  | 'stem'
  | 'concrete'
  | 'boardConcrete'
  | 'steel'
  | 'iron'
  | 'enamel'
  | 'glass'
  | 'door'
  | 'metalDoor'
  | 'window'
  | 'metalWindow';

const MATERIALS: Record<string, Finish> = {
  stone: 'rubble',
  ashlar: 'ashlar',
  coral: 'coral',
  earth: 'earth',
  plaster: 'lime',
  brick: 'brick',
  timber: 'boards',
  wood: 'boards',
  wattle: 'wattle',
  bamboo: 'bamboo',
  hide: 'hide',
  felt: 'felt',
  trunk: 'treeBark',
  steel: 'steel',
  glass: 'glass',
  concrete: 'concrete',
  snow: 'snow',
  door: 'door',
  window: 'window',
};

const regional = new Map<string, Partial<Record<Finish, Finish>>>();
function finishes(cultures: string, overrides: Partial<Record<Finish, Finish>>) {
  for (const culture of cultures.split(' ')) regional.set(culture, overrides);
}
finishes('mongol-ordu nomad-camp', { hide: 'felt' });
finishes('tibetan-monastery himalayan-terraces', { rubble: 'slate', lime: 'whitewash' });
finishes('elven', { boards: 'treeBark' });
finishes('native-iroquoian', { boards: 'barkSheets' });
finishes('myconid-colony biopunk-organic-city', { boards: 'stem', wattle: 'stem', lime: 'stem' });
finishes('merfolk-tidal swahili-stone-town', { rubble: 'coral', lime: 'whitewash' });
finishes('wizard-city necropolis dwarven', { rubble: 'ashlar' });
finishes('inca giant-hold', { rubble: 'cyclopean' });
finishes('duergar-hold', { rubble: 'slate', steel: 'iron' });
finishes('drow-enclave', { rubble: 'obsidian' });
finishes('medina persian al-andalus hadhrami-tower roman-core byzantine-greek', { lime: 'whitewash', brick: 'handBrick' });
finishes('sahel ksar-oasis hausa-kano native-pueblo egyptian-planned', { earth: 'clay' });
finishes('european-organic bastide halfling garden-city', { lime: 'timberInfill' });
finishes('newar ottoman chinese korean japanese-jokamachi vietnamese-citadel javanese-courts', { boards: 'oiledWood', brick: 'handBrick' });
finishes('norse-ringfort barbarian-norse slavic-gord russian-kremlin', { boards: 'logs' });
finishes('goblin-warren orcish lizardfolk-swamp', { boards: 'salvagedWood' });
finishes('industrial-victorian hanseatic flemish-cloth-town italian-comune', { brick: 'handBrick' });
finishes('dystopian-brutalism modernist-functionalist', { concrete: 'boardConcrete', door: 'metalDoor', window: 'metalWindow' });
finishes('dieselpunk post-apocalyptic-ruins', { boards: 'salvagedWood', steel: 'iron', door: 'metalDoor', window: 'metalWindow' });
finishes('cyberpunk futuristic-space-colony corporate-arcology atompunk-retrofuturist solarpunk global-high-rise gulf-contemporary chinese-megacity korean-high-rise japanese-contemporary', { steel: 'enamel', door: 'metalDoor', window: 'metalWindow' });

/** The atlas shares a finish across cultures wherever the material works the same way. */
export function houseWallStyle(culture: string, material: string): Finish {
  const base = MATERIALS[material] ?? 'lime';
  return regional.get(culture)?.[base] ?? base;
}

type Noise = (u: number, v: number, across: number, down: number, salt?: number) => number;
function fields(seed: number) {
  let state = (seed + 1) >>> 0;
  const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const lattice = Float32Array.from({ length: 256 * 256 }, () => rand() * 2 - 1);
  const cell = (x: number, y: number, salt = 0) => lattice[(((y + 37 * salt) & 255) << 8) + ((x + 61 * salt) & 255)];
  // Every octave closes on the tile boundary, including directional fields on
  // bent grain. Grid sizes are powers of two; negative coordinates wrap too.
  const noise: Noise = (u, v, across, down, salt = 0) => {
    const px = u * across,
      py = v * down,
      x = Math.floor(px),
      y = Math.floor(py);
    let a = px - x,
      b = py - y;
    a *= a * (3 - 2 * a);
    b *= b * (3 - 2 * b);
    const x0 = x & (across - 1),
      x1 = (x + 1) & (across - 1),
      y0 = y & (down - 1),
      y1 = (y + 1) & (down - 1);
    const lo = cell(x0, y0, salt) * (1 - a) + cell(x1, y0, salt) * a;
    const hi = cell(x0, y1, salt) * (1 - a) + cell(x1, y1, salt) * a;
    return lo + (hi - lo) * b;
  };
  return { rand, cell, noise };
}
type Fields = ReturnType<typeof fields>;
type Pigment = { cloud: number; speckle: number; r: number; g: number; b: number };
type Sample = (u: number, v: number, p: Pigment) => number;
const fract = (x: number) => x - Math.floor(x);
const unit = (x: number) => Math.max(0, Math.min(1, x));
const seam = (x: number) => Math.min(fract(x), 1 - fract(x));

/** Face-by-face joints and slight bevels. The material chooses its block lengths,
 * bedding and mortar; plastering and bleaching are separate finishes. */
function masonry(style: Finish, f: Fields): Sample {
  const fired = style === 'brick' || style === 'handBrick';
  const rough = style === 'rubble' || style === 'slate' || style === 'coral';
  const rows = fired ? 36 : style === 'slate' ? 18 : rough ? 12 : 8;
  const cols = fired ? 13 : rough ? 6 : 4;
  const split = style === 'handBrick';
  return (u, v, p) => {
    const bed = v + (rough ? 0.011 : 0.0016) * f.noise(u, v, 8, 8, 1);
    const row = Math.floor(bed * rows),
      cy = ((row % rows) + rows) % rows;
    const dx = rough ? 0.048 * f.noise(u, v, 8, 16, 4) : 0;
    const count = cols * (split && cy % 4 === 3 ? 2 : 1);
    const offset = (cy % 2) * 0.5 + (rough ? f.cell(1, cy, 9) * 0.26 : 0);
    const across = (u + dx) * count + offset,
      col = Math.floor(across);
    const lot = f.cell(((col % count) + count) % count, cy, 3);
    const edge = Math.min(seam(across) / count, seam(bed * rows) / rows);
    const grout = unit(1 - edge / (fired ? 0.0023 : 0.0038));
    const bevel = unit(1 - edge / (rough ? 0.011 : 0.005));
    if (fired) {
      p.r += lot * 5;
      p.b -= lot * 6;
    }
    if (style === 'coral') {
      const shell = unit((f.noise(u, v, 64, 64, 2) - 0.38) * 3);
      p.r += 3 * shell;
      p.b -= 2 * shell;
      return 211 + p.cloud * 6 + lot * 3 - grout * 9 - bevel * 3 - shell * 12 + p.speckle * 5;
    }
    // Chiselling catches light on part of a dressed face. Its direction changes
    // with the block so marks never continue through a joint into the next stone.
    const tool = style === 'ashlar' ? unit((f.noise(u, v, 16, 16, 4) + lot * 0.18) * 1.8) * 3.6 * Math.sin(2 * Math.PI * (96 * u + (lot > 0 ? 48 : -48) * v + lot)) : 0;
    return 212 + lot * (fired ? 10 : 7) + p.cloud * 7 + p.speckle * 4 + tool - grout * (style === 'snow' ? 6 : 18) - bevel * (rough ? 9 : 4);
  };
}

/** Dry-fitted stones. The two nearest seeded centres give a continuous bevel along
 * the actual neighbouring faces, including the stones that cross the tile edge. */
function megalith(f: Fields): Sample {
  return (u, v, p) => {
    const x = 3 * u + 0.032 * f.noise(u, v, 16, 8, 5),
      y = 5 * v + 0.023 * p.cloud;
    const col = Math.floor(x),
      row = Math.floor(y);
    let nearest = 10,
      next = 10,
      tone = 0;
    for (let j = row - 1; j <= row + 1; j++)
      for (let i = col - 1; i <= col + 1; i++) {
        const ix = (i + 6) % 3,
          iy = (j + 10) % 5;
        const dx = i + 0.5 + 0.33 * f.cell(ix, iy, 1) - x;
        const dy = j + 0.5 + 0.29 * f.cell(ix, iy, 2) - y;
        const dist = dx * dx + dy * dy;
        if (dist < nearest) {
          next = nearest;
          nearest = dist;
          tone = f.cell(ix, iy, 0);
        } else if (dist < next) next = dist;
      }
    const edge = next - nearest;
    return 211 + tone * 8 + p.cloud * 8 + p.speckle * 5 - unit(1 - edge / 0.065) * 20 - unit(1 - edge / 0.16) * 5;
  };
}

function wood(style: Finish, f: Fields): Sample {
  const logs = style === 'logs',
    bark = style === 'treeBark' || style === 'barkSheets';
  const boards = logs ? 11 : style === 'door' ? 19 : bark ? 4 : 15;
  return (u, v, p) => {
    const a = logs ? v : u,
      b = logs ? u : v;
    const bow = f.noise(a, b, 8, 2, 1),
      wave = f.noise(a, b, 16, 4, 7);
    const bend = a + bow * (bark ? 0.028 : 0.007) + wave * (bark ? 0.009 : 0.002);
    const grain = f.noise(bend, b, 64, 4, 9) * 0.67 + f.noise(bend, b, 128, 8, 2) * 0.33;
    if (bark) {
      const cleft = unit((grain - 0.07) * 2.3);
      let cut = 0;
      if (style === 'barkSheets') {
        const sheet = a * 4 + wave * 0.14,
          id = (Math.floor(sheet) + 4) % 4;
        const end = 2 * b + f.cell(id, 1, 2) * 0.46 + 0.026 * bow;
        cut = Math.max(unit(1 - seam(sheet) * 48), unit(1 - seam(end) * 65));
      }
      p.r += 3 * bow;
      p.g += 1;
      p.b -= 3 * bow;
      return 210 + p.cloud * 10 + bow * 9 + grain * 6 - cleft * 26 - cut * 12 + p.speckle * 5;
    }
    const plank = a * boards,
      plankId = Math.floor(plank) % boards;
    const joint = unit(1 - seam(plank) * (logs ? 11 : 19));
    const tint = f.cell(plankId, 3, 1);
    p.r += tint * 3 + 2;
    p.b -= tint * 5 + 3;
    const hewn = logs ? 8 * Math.cos((fract(plank) - 0.4) * 2 * Math.PI) : 0;
    const amplitude = style === 'salvagedWood' ? 18 : style === 'oiledWood' ? 8 : 12;
    return 210 + hewn + grain * amplitude + tint * 7 + p.cloud * 6 + p.speckle * 3 - joint * (style === 'door' ? 36 : 22);
  };
}

function mineral(style: Finish, f: Fields): Sample {
  const lime = style === 'whitewash' || style === 'lime' || style === 'timberInfill';
  return (u, v, p) => {
    const dragged = f.noise(u, v + 0.012 * p.cloud, 16, 32, 3);
    const bloom = f.noise(u, v, 8, 4, 5);
    const chalk = Math.max(0, bloom * 0.65 + p.cloud * 0.65 - 0.16);
    p.r += (lime ? 2 : 5) * dragged;
    p.b -= (lime ? 2 : 4) * dragged;
    if (style === 'timberInfill') {
      // Two full-height uprights. Openings and horizontal members belong to the mesh.
      const stud = seam(u * 2 + dragged * 0.004);
      if (stud < 0.031) {
        p.r += 8;
        p.b -= 9;
        return 136 + f.noise(u, v, 128, 4, 2) * 13 + unit(stud / 0.007) * 7;
      }
    }
    const aggregate = lime ? 0 : Math.max(0, p.speckle - 0.35) * (style === 'clay' ? 6 : 14);
    return (style === 'whitewash' ? 217 : 211) + p.cloud * 7 + dragged * (lime ? 4 : 7) + chalk * 12 + p.speckle * 4 - aggregate;
  };
}

function textile(style: Finish, f: Fields): Sample {
  const felt = style === 'felt';
  return (u, v, p) => {
    const drift = f.noise(u, v, 4, 2, 3);
    const soft = f.noise(u + 0.022 * drift, v, 16, 4, 1);
    const matted = f.noise(u + 0.031 * p.cloud, v, 64, 32, 2);
    // Slight compression and a soft selvage where the two drawn pieces of felt lap.
    const overlap = seam(2 * u + 0.06 * drift);
    const lip = unit(1 - overlap / 0.016);
    const pillow = Math.exp(-overlap * overlap * 390);
    const fiber = felt ? matted * 7 + p.speckle * 6 : matted * 3 + p.speckle * 3;
    p.r += 2 + drift * 2;
    p.b -= 3 + drift * 2;
    return 212 + p.cloud * 9 + soft * 6 + fiber - lip * 11 - pillow * 4;
  };
}

function organic(style: Finish, f: Fields): Sample {
  return (u, v, p) => {
    const bend = u + 0.031 * f.noise(u, v, 4, 2, 4) + 0.008 * p.cloud;
    const thread = f.noise(bend, v, 32, 4, 3) + 0.4 * f.noise(bend, v, 64, 8, 1);
    if (style === 'obsidian') {
      const cleave = unit((Math.abs(thread) - 0.56) * 3);
      p.b += 6 * cleave;
      p.r += 3 * cleave;
      return 208 + p.cloud * 10 + cleave * 12 + p.speckle * 4;
    }
    const bruise = unit((-p.cloud - 0.21) * 1.9);
    p.r += bruise * 6;
    p.g -= bruise * 4;
    p.b += bruise * 3;
    const fibrils = f.noise(bend + thread * 0.003, v, 128, 8, 7);
    return 213 + p.cloud * 8 + thread * 9 + fibrils * (3 + bruise * 4) + p.speckle * 3 - bruise * 9;
  };
}

function woven(style: Finish, f: Fields): Sample {
  return (u, v, p) => {
    const warp = v + 0.002 * f.noise(u, v, 8, 16, 1);
    const n = style === 'bamboo' ? 48 : 62,
      y = warp * n;
    const crossing = Math.floor(v * n) + Math.floor(u * 16);
    const weft = style === 'wattle' ? unit(1 - seam(u * 16 + 0.012 * p.cloud) * 26) * (crossing & 1 ? 8 : -8) : 0;
    return 213 + p.cloud * 6 + p.speckle * 4 + 4 * Math.sin(y * 2 * Math.PI) - 15 * unit(1 - seam(y) * 10) + weft;
  };
}

function panels(style: Finish, f: Fields): Sample {
  const glazed = style === 'glass' || style === 'window' || style === 'metalWindow';
  const concrete = style === 'concrete' || style === 'boardConcrete';
  const cols = style === 'window' ? 12 : style === 'metalWindow' ? 4 : style === 'glass' ? 3 : style === 'metalDoor' ? 4 : 2;
  const rows = style === 'window' ? 10 : style === 'metalWindow' ? 5 : 2;
  return (u, v, p) => {
    const x = u * cols,
      y = v * rows,
      ix = Math.floor(x),
      iy = Math.floor(y);
    const id = f.cell(ix, iy, 1);
    const edge = Math.min(seam(x) / cols, seam(y) / rows);
    if (glazed) {
      // Continuous sky variation across the panes; each pane shifts reflection
      // slightly. The recess and glazing bars stay on the opening geometry.
      const sky = f.noise(u + 0.015 * id, v, 2, 4, 3);
      const bevel = unit(1 - edge / (style === 'window' ? 0.0048 : 0.007));
      p.r -= 8 + sky * 5;
      p.b += 8;
      p.g += 2;
      return 210 + sky * 20 + id * 8 - bevel * 49 + p.speckle;
    }
    const joint = unit(1 - edge / (concrete ? 0.003 : 0.004));
    const grain = f.noise(u, v, 64, 4, 5);
    const forms = style === 'boardConcrete' ? 4 * grain - 5 * unit(1 - seam(u * 18) * 14) : 0;
    const rust = style === 'iron' ? unit((0.42 - edge * 25) * (p.cloud + 0.8)) : 0;
    p.r += rust * 20;
    p.g -= rust * 5;
    p.b -= rust * 15;
    if (style === 'enamel') {
      p.g += 2;
      p.b += 4;
    }
    return 211 + p.cloud * (concrete ? 7 : 3) + id * 4 + forms - joint * 16 + p.speckle * (concrete ? 5 : 2);
  };
}

function sampler(style: Finish, f: Fields): Sample {
  switch (style) {
    case 'brick':
    case 'handBrick':
    case 'rubble':
    case 'ashlar':
    case 'slate':
    case 'snow':
    case 'coral':
      return masonry(style, f);
    case 'cyclopean':
      return megalith(f);
    case 'boards':
    case 'logs':
    case 'oiledWood':
    case 'salvagedWood':
    case 'door':
    case 'treeBark':
    case 'barkSheets':
      return wood(style, f);
    case 'felt':
    case 'hide':
      return textile(style, f);
    case 'wattle':
    case 'bamboo':
      return woven(style, f);
    case 'stem':
    case 'obsidian':
      return organic(style, f);
    case 'concrete':
    case 'boardConcrete':
    case 'glass':
    case 'steel':
    case 'iron':
    case 'enamel':
    case 'window':
    case 'metalWindow':
    case 'metalDoor':
      return panels(style, f);
    default:
      return mineral(style, f);
  }
}

export function paintHouseWall(ctx: Ctx, size: number, culture: string, material: string, variant = 0): void {
  const style = houseWallStyle(culture, material);
  let seed = variant | 0;
  for (let i = 0; i < style.length; i++) seed = Math.imul(31, seed) + style.charCodeAt(i);
  const f = fields(seed),
    sample = sampler(style, f);
  const image = ctx.createImageData(size, size),
    data = image.data;
  const p: Pigment = { cloud: 0, speckle: 0, r: 0, g: 0, b: 0 };
  for (let y = 0, i = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++, i += 4) {
      const u = (x + 0.5) / size;
      p.cloud = 0.55 * f.noise(u, v, 4, 4) + 0.29 * f.noise(u, v, 8, 8, 1) + 0.16 * f.noise(u, v, 16, 16, 2);
      p.speckle = (f.rand() - 0.5) * 1.3 + f.noise(u, v, 64, 64, 5) * 0.35;
      p.r = p.g = p.b = 0;
      const light = sample(u, v, p);
      data[i] = light + p.r;
      data[i + 1] = light + p.g;
      data[i + 2] = light + p.b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
