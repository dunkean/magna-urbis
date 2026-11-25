/** One repeating three-metre facade bay. The mesh supplies openings, storey heights and
 * paint colours. Neutral grounds preserve those colours; joinery, glaze and metalwork
 * carry their own pigments where they interrupt the wall. */
type Ctx = CanvasRenderingContext2D;
const BAY = 96;

// The same structural detail can be shared by several traditions. Explicit material
// choices still determine what is visible between beams, strings and buttresses.
const DETAILS = {
  brace: 'european-organic bastide garden-city halfling',
  brickband: 'hanseatic flemish-cloth-town rynek-town industrial-victorian american-grid european-contemporary',
  cornice: 'roman-core italian-comune venetian-lagoon haussmannian belle-epoque latin-american-grid',
  lacing: 'byzantine-greek',
  arabesque: 'medina al-andalus persian oasis-caravan',
  oriel: 'ottoman newar',
  toron: 'sahel',
  relief: 'hausa-kano ksar-oasis',
  limeband: 'hadhrami-tower swahili-stone-town',
  terraces: 'himalayan-terraces tibetan-monastery',
  fret: 'maya aztec',
  screen: 'rajput-fort indian-temple dravidian-temple',
  post: 'chinese korean japanese-jokamachi vietnamese-citadel javanese-courts khmer bagan',
  logs: 'barbarian-norse norse-ringfort slavic-gord russian-kremlin',
  lashing: 'stilt-town maori-pa pnw-plank-village native-iroquoian guarani-village barbarian barbarian-celtic celtic-oppidum kraal',
  girths: 'mongol-ordu nomad-camp',
  chevron: 'great-zimbabwe',
  cyclopean: 'inca giant-hold',
  dressed: 'dwarven necropolis',
  iron: 'duergar-hold dieselpunk',
  crystal: 'drow-enclave',
  branches: 'elven',
  lamellae: 'myconid-colony biopunk-organic-city',
  tide: 'merfolk-tidal',
  pegs: 'orcish goblin-warren lizardfolk-swamp',
  tracery: 'wizard-city',
  straps: 'gnomish',
  fin: 'art-deco-metropolis',
  ribbon: 'modernist-functionalist soviet-socialist post-socialist-european global-high-rise chinese-megacity korean-high-rise japanese-contemporary',
  shade: 'southeast-asian-tropical gulf-contemporary south-asian-metropolis middle-eastern-contemporary north-african-contemporary mediterranean-modern sub-saharan-african-metropolis',
  trellis: 'solarpunk eco-city',
  conduit: 'cyberpunk',
  coffer: 'dystopian-brutalism',
  streamline: 'atompunk-retrofuturist',
  shell: 'futuristic-space-colony',
  exoskeleton: 'corporate-arcology',
  salvage: 'post-apocalyptic-ruins informal-urban-expansion latin-american-hillside',
} as const;
type Detail = keyof typeof DETAILS | 'bare';
const CULTURE_DETAIL = new Map<string, Detail>();
for (const [detail, cultures] of Object.entries(DETAILS)) for (const culture of cultures.split(' ')) CULTURE_DETAIL.set(culture, detail as Detail);

type Ground = 'brick' | 'stone' | 'ashlar' | 'coral' | 'earth' | 'plaster' | 'boards' | 'woven' | 'fabric' | 'snow' | 'concrete' | 'steel' | 'glass' | 'bark' | 'door' | 'metalDoor' | 'window' | 'metalWindow';
const GROUNDS: Readonly<Record<string, Ground>> = {
  brick: 'brick',
  stone: 'stone',
  ashlar: 'ashlar',
  coral: 'coral',
  earth: 'earth',
  plaster: 'plaster',
  timber: 'boards',
  wood: 'boards',
  bamboo: 'woven',
  wattle: 'woven',
  hide: 'fabric',
  felt: 'fabric',
  snow: 'snow',
  concrete: 'concrete',
  steel: 'steel',
  glass: 'glass',
  trunk: 'bark',
};

// Tie each treatment to the surfaces where it belongs: a stone foundation beneath
// a log house keeps its courses. This also bounds the shared atlas across scene changes.
const DETAIL_GROUNDS: Record<Exclude<Detail, 'bare'>, readonly Ground[]> = {
  brace: ['boards', 'plaster'],
  brickband: ['brick'],
  cornice: ['ashlar', 'plaster', 'brick'],
  lacing: ['stone', 'brick'],
  arabesque: ['plaster', 'earth', 'brick'],
  oriel: ['boards', 'brick'],
  toron: ['earth'],
  relief: ['earth'],
  limeband: ['earth', 'coral'],
  terraces: ['stone', 'plaster'],
  fret: ['earth', 'plaster', 'woven'],
  screen: ['stone', 'brick'],
  post: ['boards', 'plaster', 'brick'],
  logs: ['boards'],
  lashing: ['boards', 'woven'],
  girths: ['fabric'],
  chevron: ['stone'],
  cyclopean: ['stone'],
  dressed: ['stone', 'ashlar'],
  iron: ['stone', 'brick', 'steel'],
  crystal: ['stone'],
  branches: ['boards'],
  lamellae: ['plaster', 'boards', 'woven'],
  tide: ['stone', 'coral'],
  pegs: ['boards', 'stone', 'woven'],
  tracery: ['stone', 'plaster'],
  straps: ['brick', 'boards'],
  fin: ['ashlar', 'brick'],
  ribbon: ['concrete'],
  shade: ['plaster', 'concrete'],
  trellis: ['boards'],
  conduit: ['glass', 'concrete'],
  coffer: ['concrete'],
  streamline: ['plaster'],
  shell: ['steel'],
  exoskeleton: ['glass', 'concrete'],
  salvage: ['brick', 'concrete'],
};
const METAL_FRAMES = new Set<Detail>(['fin', 'ribbon', 'shade', 'trellis', 'conduit', 'coffer', 'streamline', 'shell', 'exoskeleton', 'salvage']);

/** Stable texture-array cache key. Palette and lot tone are applied later by the renderer. */
export function houseWallStyle(culture: string, material: string): string {
  const detail = CULTURE_DETAIL.get(culture);
  if (material === 'window' || material === 'door') {
    const metal = detail && METAL_FRAMES.has(detail);
    return (metal ? (material === 'door' ? 'metalDoor' : 'metalWindow') : material) + '/bare';
  }
  const ground = GROUNDS[material] ?? 'plaster';
  return ground + '/' + (detail && detail !== 'bare' && DETAIL_GROUNDS[detail].includes(ground) ? detail : 'bare');
}

type Ink = number | string;
function color(tone: Ink): string {
  if (typeof tone === 'string') return tone;
  const v = Math.round(tone);
  return `rgb(${v},${v},${v})`;
}
function rect(ctx: Ctx, tone: Ink, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color(tone);
  ctx.fillRect(x, y, w, h);
}
function line(ctx: Ctx, tone: Ink, width: number, ...xy: number[]) {
  ctx.strokeStyle = color(tone);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(xy[0], xy[1]);
  for (let i = 2; i < xy.length; i += 2) ctx.lineTo(xy[i], xy[i + 1]);
  ctx.stroke();
}
function band(ctx: Ctx, y: number, h: number, tone: Ink = 172) {
  rect(ctx, tone, 0, y, BAY, h);
  rect(ctx, 242, 0, y, BAY, 0.9);
  rect(ctx, 151, 0, y + h, BAY, 0.9);
}
function course(ctx: Ctx, rows: number, cols: number, rough: number, joint: number, random: () => number, fired = false) {
  // Each stone's two copies across the seam share their outline and their colour.
  const h = BAY / rows,
    w = BAY / cols;
  rect(ctx, 159, 0, 0, BAY, BAY);
  for (let row = 0; row < rows; row++) {
    const y = row * h;
    for (let col = 0; col < cols; col++) {
      const x = (col + (row % 2) / 2) * w,
        tone = Math.round(201 + random() * 38);
      const chamfer = (0.2 + random()) * rough;
      // Kiln variation from slightly over-fired to pale bricks within a single bond.
      const firing = fired ? (random() - 0.38) * 27 : 0;
      ctx.fillStyle = `rgb(${tone + firing},${tone},${tone - firing})`;
      for (const left of [x, x - BAY]) {
        ctx.beginPath();
        ctx.moveTo(left + joint + chamfer, y + joint);
        ctx.lineTo(left + w - chamfer, y + joint);
        ctx.lineTo(left + w, y + joint + chamfer);
        ctx.lineTo(left + w - chamfer, y + h - joint);
        ctx.lineTo(left + chamfer, y + h);
        ctx.lineTo(left + joint, y + h - chamfer);
        ctx.closePath();
        ctx.fill();
        line(ctx, tone + 9, 0.75, left + joint + chamfer, y + joint + 0.6, left + w - chamfer, y + joint + 0.6);
      }
    }
  }
}

function wood(ctx: Ctx, logs: boolean, random: () => number) {
  const n = logs ? 10 : 16,
    step = BAY / n;
  ctx.save();
  if (!logs) {
    ctx.translate(BAY, 0);
    ctx.rotate(Math.PI / 2);
  }
  for (let i = 0; i < n; i++) {
    const y = i * step,
      tone = 201 + random() * 30;
    rect(ctx, tone, 0, y, BAY, step);
    line(ctx, logs ? 132 : 158, logs ? 1.7 : 0.8, 0, y + step - 1, BAY, y + step - 1);
    line(ctx, tone + 14, 0.85, 0, y + 1, BAY, y + 1);
    const knot = 12 + random() * 70;
    for (let j = 0; j < 2; j++) {
      const grain = y + step * (0.32 + j * 0.2);
      line(ctx, tone - 19, 0.55, 0, grain, knot - 9, grain + 0.3, knot, grain + j * 2 - 1, knot + 9, grain, BAY, grain);
    }
  }
  ctx.restore();
}

function groundPaint(ctx: Ctx, ground: Ground, detail: Detail, random: () => number) {
  rect(ctx, 215, 0, 0, BAY, BAY);
  switch (ground) {
    case 'brick':
      course(ctx, 28, 12, 0.16, 0.52, random, true);
      break;
    case 'coral':
    case 'stone':
      course(ctx, detail === 'cyclopean' ? 4 : 10, detail === 'cyclopean' ? 2 : 5, detail === 'cyclopean' ? 4 : 2, 0.85, random);
      break;
    case 'ashlar':
    case 'snow':
      course(ctx, 7, 3, 0.6, ground === 'snow' ? 0.45 : 0.9, random);
      break;
    case 'boards':
      wood(ctx, detail === 'logs', random);
      break;
    case 'door':
      // Sixteen-centimetre timber planks. A section of each opening gets grain,
      // mouldings and a batten even if its UVs begin mid-tile.
      for (let i = 0; i < 19; i++) {
        const w = BAY / 19,
          x = i * w,
          v = Math.round(183 + 46 * random());
        rect(ctx, `rgb(${v + 12},${v},${v - 17})`, x, 0, w, BAY);
        line(ctx, '#74604f', 0.9, x + 0.5, 0, x + 0.5, BAY);
        line(ctx, '#c7af91', 0.55, x + 1.5, 0, x + 1.5, BAY);
        const knot = 12 + random() * 70;
        line(ctx, '#b69a7f', 0.45, x + 3, 0, x + 3, knot - 6, x + 3.8, knot, x + 3, knot + 5, x + 3, BAY);
      }
      for (const y of [16, 64]) {
        band(ctx, y, 3.4, '#a38a70');
        for (let x = 6; x < BAY; x += 16) rect(ctx, '#756e66', x, y + 1.2, 1.1, 1.1);
      }
      break;
    case 'metalDoor':
      for (let i = 0; i < 4; i++) {
        const x = i * 24;
        rect(ctx, i % 2 ? '#c1c8c6' : '#d4dbd8', x, 0, 24, BAY);
        for (let y = 0; y < BAY; y += 48) {
          line(ctx, '#8b9594', 1.2, x + 1, y, x + 1, y + 47, x + 22.6, y + 47);
          line(ctx, '#e6ebe7', 0.7, x + 2, y + 2, x + 21.5, y + 2);
          for (let j = 0; j < 3; j++) rect(ctx, '#8d9695', x + 5, y + 35 + j * 2, 13, 1);
        }
      }
      break;
    case 'window':
    case 'metalWindow': {
      // No outer frame is baked in. The mesh supplies the silhouette of each opening.
      const rows = ground === 'window' ? 10 : 5,
        cols = ground === 'window' ? 12 : 4;
      const w = BAY / cols,
        h = BAY / rows;
      const panes = ['#9fbbca', '#b2c8ce', '#90a7b6', '#bfccd1'];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = i * w,
            y = j * h;
          rect(ctx, panes[Math.floor(random() * panes.length)], x, y, w, h);
          ctx.fillStyle = '#d1e4e8';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + w, y);
          ctx.lineTo(x, y + h * (0.22 + 0.45 * random()));
          ctx.closePath();
          ctx.fill();
          const frame = ground === 'window' ? '#776b5c' : '#677f87';
          line(ctx, frame, ground === 'window' ? 1.1 : 1.8, x + 0.5, y + h, x + 0.5, y + 0.5, x + w, y + 0.5);
          line(ctx, '#d3dad6', 0.55, x + 1.4, y + h, x + 1.4, y + 1.4, x + w, y + 1.4);
        }
      break;
    }
    case 'bark':
      for (let i = 0; i < 18; i++) {
        const x = (i * BAY) / 18,
          bend = random() * 6 - 3;
        for (const offset of [-BAY, 0, BAY]) {
          const u = x + offset;
          line(ctx, 159, 1.6, u, 0, u + bend, 23, u + bend - 1, 45, u - bend, 69, u, BAY);
          line(ctx, 231, 1.1, u + 1.7, 0, u + 2 + bend, 23, u + bend + 1, 45, u - bend + 1.6, 69, u + 1.7, BAY);
        }
      }
      break;
    case 'woven':
      for (let i = 0; i < 24; i++) {
        line(ctx, 183, 1.1, 0, i * 4 + 1, BAY, i * 4 + 1);
        for (let j = 0; j < 12; j++) rect(ctx, (j + i) % 2 ? 188 : 232, j * 8, i * 4, 2, 3.8);
      }
      break;
    case 'earth':
      for (let i = 0; i < 6; i++) {
        const y = i * 16;
        rect(ctx, 209 + random() * 11, 0, y, BAY, 16);
        line(ctx, 197, 1.1, 0, y + 5, 16, y + 4.8, 34, y + 5.4, 68, y + 4.5, BAY, y + 5);
      }
      break;
    case 'fabric':
      for (const x of [16, 64]) {
        line(ctx, 177, 1.6, x, 0, x + 7, 28, x + 9, 58, x, BAY);
        line(ctx, 232, 1.2, x + 2, 0, x + 9, 28, x + 11, 58, x + 2, BAY);
      }
      break;
    case 'glass':
      for (let i = 0; i < 3; i++) {
        const x = i * 32;
        const reflection = ctx.createLinearGradient(x, 0, x + 32, BAY);
        const skyLine = [0.47, 0.39, 0.55][i];
        reflection.addColorStop(0, '#dceaf0');
        reflection.addColorStop(skyLine - 0.02, '#dde6e7');
        reflection.addColorStop(skyLine, '#a9b8bd');
        reflection.addColorStop(1, '#d1d4d2');
        ctx.fillStyle = reflection;
        ctx.fillRect(x, 0, 32, BAY);
        rect(ctx, 118, x, 0, 1.6, BAY);
        rect(ctx, 244, x + 1.6, 0, 0.8, BAY);
      }
      band(ctx, 77, 9);
      break;
    case 'steel':
    case 'concrete':
      for (let i = 0; i < 2; i++) {
        const x = i * 48;
        rect(ctx, 207 + i * 9, x, 0, 48, BAY);
        line(ctx, 159, 1.1, x + 0.6, 0, x + 0.6, BAY);
        for (const y of [9, 41, 57, 89]) rect(ctx, 148, x + 4.6, y, 1.6, 1.6);
      }
      line(ctx, 162, 1, 0, 48, BAY, 48);
      break;
    case 'plaster':
      break;
  }
  if (['plaster', 'earth', 'coral', 'stone'].includes(ground)) {
    // Stipple is subordinate to the construction at a distance.
    for (let i = 0; i < 220; i++) {
      const x = random() * BAY,
        y = random() * BAY;
      rect(ctx, 193 + random() * 43, x, y, 0.4 + random() * 1.4, 0.65);
    }
  }
}

function detailPaint(ctx: Ctx, d: Detail) {
  switch (d) {
    case 'bare':
    case 'logs':
    case 'cyclopean':
      return;
    case 'girths':
      for (const y of [19, 58, 81]) band(ctx, y, 2.2, '#ac876c');
      break;
    case 'brace':
      line(ctx, '#795e4f', 5.6, 5, 7, 31, 50, 52, 8);
      line(ctx, '#89725f', 4.6, 54, 82, 90, 38);
      for (const x of [3, 50]) {
        rect(ctx, '#735d50', x, 0, 5.4, BAY);
        rect(ctx, '#a98b71', x, 0, 0.9, BAY);
      }
      band(ctx, 4, 5, '#806756');
      band(ctx, 85, 4, '#897261');
      break;
    case 'post':
    case 'oriel':
      for (const x of [5, 53]) {
        rect(ctx, '#866859', x, 0, 4.5, BAY);
        rect(ctx, '#b2977a', x - 3, 9, 10, 4);
        rect(ctx, '#98735f', x - 5, 6, 14, 3);
      }
      band(ctx, 4, 3, '#896858');
      if (d === 'oriel') for (let x = 0; x < BAY; x += 6) line(ctx, '#917661', 1.4, x, 10, x, 21);
      band(ctx, 23, 2.7);
      break;
    case 'brickband':
    case 'lacing':
      for (let i = 0; i < (d === 'lacing' ? 3 : 1); i++) band(ctx, 8 + 4 * i, 2.2, d === 'lacing' ? '#b57260' : '#b48c78');
      if (d === 'brickband') for (let x = 1; x < BAY; x += 6) rect(ctx, x % 12 === 1 ? '#c09982' : '#a37d6e', x, 11, 3.7, 3.4);
      break;
    case 'cornice':
    case 'limeband':
    case 'terraces':
      if (d === 'terraces') {
        band(ctx, 5, 8, '#a65b4a');
        rect(ctx, '#773f38', 0, 10.6, BAY, 2.4);
      } else if (d === 'limeband') {
        rect(ctx, '#ac8d77', 0, 5, BAY, 8);
        band(ctx, 5, 4.8, '#fff9ee');
      } else band(ctx, 5, 2.9, '#c0b7a6');
      band(ctx, 15, 1.9, d === 'limeband' ? '#fffbed' : '#c5ae98');
      if (d === 'cornice') for (let x = 2; x < BAY; x += 8) rect(ctx, 179, x, 9, 3, 3);
      break;
    case 'arabesque':
    case 'screen':
    case 'chevron':
    case 'relief':
      if (d === 'arabesque') rect(ctx, '#f1e9d5', 0, 8, BAY, 13);
      band(ctx, 7, 2, d === 'arabesque' ? '#70989a' : 172);
      band(ctx, 20, 1.5);
      for (let x = 0; x < BAY; x += 12) {
        line(ctx, d === 'arabesque' ? '#689297' : 151, d === 'relief' || d === 'arabesque' ? 2.3 : 1.5, x, 18, x + 6, 10, x + 12, 18);
        if (d === 'arabesque' || d === 'screen') line(ctx, d === 'arabesque' ? '#8298ad' : 180, 1.5, x, 10, x + 6, 18, x + 12, 10);
      }
      break;
    case 'fret':
      band(ctx, 4, 2);
      for (let x = 0; x < BAY; x += 24) line(ctx, '#aa7662', 3.1, x, 19, x + 6, 19, x + 6, 13, x + 12, 13, x + 12, 8, x + 20, 8, x + 20, 19, x + 24, 19);
      break;
    case 'toron':
      for (let x = 8; x < BAY; x += 24) {
        rect(ctx, 177, x - 1, 22, 5, 5);
        rect(ctx, '#796450', x - 2, 20, 5, 3);
      }
      break;
    case 'lashing':
    case 'pegs':
      for (const x of [9, 56]) {
        line(ctx, 148, 3.5, x, 0, x, BAY);
        for (const y of [17, 72]) {
          line(ctx, 135, 2.8, x - 2, y + 4, x + 3, y);
          line(ctx, 230, 1.1, x - 2, y + 4.8, x + 3, y + 0.8);
        }
      }
      if (d === 'pegs') line(ctx, 167, 3.4, 12, 75, 53, 23);
      break;
    case 'dressed':
    case 'crystal':
    case 'tracery':
      band(ctx, 8, 2);
      for (let x = 0; x < BAY; x += 32) {
        const h = d === 'crystal' ? 26 : 13;
        line(ctx, 144, 2.3, x, 11, x + 11, 11, x + 16, 11 + h, x + 21, 11, x + 32, 11);
        if (d === 'tracery') line(ctx, 165, 1.3, x + 2, 23, x + 16, 11, x + 30, 23);
        if (d === 'crystal') {
          line(ctx, '#b58fc8', 3.1, x + 11, 11, x + 16, 34, x + 20, 11);
          line(ctx, '#f2cdf3', 1.4, x + 16, 29, x + 16, 14, x + 20, 10);
        }
      }
      break;
    case 'branches':
    case 'lamellae':
    case 'tide':
      // Cubic ribs meet on tile boundaries with the same tangent.
      for (let x = -24; x < BAY + 24; x += 24) {
        const organic = d === 'lamellae';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x, 24, x + (organic ? 13 : 4), 31, x + 9, 48);
        ctx.bezierCurveTo(x + 6, 65, x, 73, x, BAY);
        ctx.strokeStyle = organic ? '#b296b0' : d === 'tide' ? '#83abae' : '#98ac83';
        ctx.lineWidth = organic ? 3.4 : 2.1;
        ctx.stroke();
        if (!organic) {
          ctx.beginPath();
          ctx.moveTo(x + 7, 55);
          ctx.quadraticCurveTo(x + 9, d === 'tide' ? 75 : 35, x + 25, 25);
          ctx.stroke();
        }
      }
      break;
    case 'iron':
    case 'straps':
    case 'salvage':
      band(ctx, 18, 4.2, d === 'straps' ? '#9c9c76' : '#9d7562');
      for (let x = 4; x < BAY; x += 16) rect(ctx, '#d6c0a5', x, 19, 2.2, 1.8);
      if (d === 'salvage') {
        rect(ctx, '#bec7c6', 10, 26, 45, 30);
        for (let x = 12; x < 53; x += 4) line(ctx, '#9b8c80', 1.7, x, 26, x - 2, 54);
        line(ctx, '#a1806d', 2, 10, 56, 54, 54);
      } else {
        for (const x of [9, 57]) {
          rect(ctx, d === 'iron' ? '#897466' : '#819a8d', x, 0, 3.4, BAY);
          rect(ctx, d === 'iron' ? '#af785c' : '#b1b99b', x, 23, 2.1, x < 40 ? 15 : 7);
        }
      }
      break;
    case 'fin':
    case 'ribbon':
    case 'shade':
    case 'streamline':
      band(ctx, 15, d === 'ribbon' ? 9 : 3.5, 173);
      if (d === 'shade' || d === 'streamline') for (const y of [21, 26]) band(ctx, y, 1.9);
      if (d === 'fin') for (const x of [9, 13, 17]) rect(ctx, '#ac9778', x, 0, 2.4, BAY);
      break;
    case 'coffer':
    case 'shell':
    case 'conduit':
    case 'exoskeleton':
    case 'trellis':
      if (d === 'coffer' || d === 'shell') {
        const c = d === 'shell' ? 8 : 1;
        for (const x of [3, 51]) {
          line(ctx, 144, 2.2, x + c, 8, x + 41 - c, 8, x + 41, 8 + c, x + 41, 83 - c, x + 41 - c, 83, x + c, 83, x, 83 - c, x, 8 + c, x + c, 8);
          line(ctx, 240, 1.4, x + c, 10, x + 40 - c, 10);
          if (d === 'shell') {
            rect(ctx, x === 3 ? '#b9d0ca' : '#d0b89a', x + 8, 60, x === 3 ? 22 : 12, 3.3);
            for (let i = 0; i < (x === 3 ? 3 : 2); i++) rect(ctx, '#92a3a6', x + 8, 66 + 3 * i, 11, 1.3);
          }
        }
      } else if (d === 'conduit') {
        band(ctx, 71, 7, '#748388');
        for (const x of [9, 13, 17]) line(ctx, x === 13 ? '#69e4e9' : '#72878f', x === 13 ? 3.1 : 1.9, x, 0, x, 29, x + 8, 37, x + 8, 62, x, 70, x, BAY);
        for (let x = 42; x < 78; x += 5) rect(ctx, '#8b9c9f', x, 44, 2.1, 12);
        rect(ctx, '#9cdee0', 43, 59, 20, 2.3);
        rect(ctx, '#d394a9', 66, 59, 7, 2.3);
      } else {
        for (let x = -48; x <= BAY; x += 48) {
          const rib = d === 'trellis' ? '#8faa83' : '#9cafa9';
          line(ctx, rib, d === 'trellis' ? 2.4 : 4, x, 0, x + 48, BAY);
          line(ctx, rib, d === 'trellis' ? 2.4 : 4, x + 48, 0, x, BAY);
        }
        band(ctx, 73, d === 'trellis' ? 4 : 2);
      }
      break;
  }
}

export function paintHouseWall(ctx: Ctx, size: number, culture: string, material: string, variant = 0): void {
  const [ground, detail] = houseWallStyle(culture, material).split('/') as [Ground, Detail];
  let state = (variant + 1) >>> 0;
  const random = () => (state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296;
  ctx.save();
  ctx.scale(size / BAY, size / BAY);
  groundPaint(ctx, ground, detail, random);
  detailPaint(ctx, detail);
  ctx.restore();
}
