// Inline SVG diagrams of the atlas. Original drawings, not to scale unless stated.
// Every label is a pair [en, fr]; colours come from the page tokens through the .dg classes.
import { esc } from './shell.mjs';

let L = 'en';
const t = pair => esc(typeof pair === 'string' ? pair : pair[L === 'fr' ? 1 : 0]);
let uid = 0;

function svg(w, h, title, body) {
  const id = `dg${++uid}`;
  return `<svg class="dg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}t" xmlns="http://www.w3.org/2000/svg"><title id="${id}t">${t(title)}</title><defs>${['', 'water', 'ochre', 'town'].map(c => `<marker id="${id}m${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="head ${c}"/></marker>`).join('')}<pattern id="${id}hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="3" y1="0" x2="3" y2="6" class="ln town" style="stroke-width:1.1"/></pattern></defs>${body.replaceAll('url(#M', `url(#${id}m`).replaceAll('url(#HATCH)', `url(#${id}hatch)`)}</svg>`;
}
/** Multi-line centred label; first line bold unless plain. */
function label(x, y, lines, { cls = '', lh = 15, head = true, anchor = 'middle' } = {}) {
  const arr = (Array.isArray(lines) && typeof lines[0] !== 'string') || (Array.isArray(lines) && lines.length && Array.isArray(lines[0])) ? lines : [lines];
  const y0 = y - ((arr.length - 1) * lh) / 2;
  return arr.map((ln, i) => `<text x="${x}" y="${y0 + i * lh}" text-anchor="${anchor}" dominant-baseline="middle" class="${i === 0 && head ? 't-head' : head ? 't-small' : 't-body'} ${cls}">${t(ln)}</text>`).join('');
}
function box(x, y, w, h, lines, cls = '', o = {}) {
  return `<rect class="bx ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 7}"/>` + label(x + w / 2, y + h / 2, lines, o);
}
const arrow = (x1, y1, x2, y2, cls = '', m = '') => `<line class="ln ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#M${m})"/>`;
const path = (d, cls = '', m = '') => `<path class="ln ${cls}" d="${d}"${m === null ? '' : ` marker-end="url(#M${m})"`}/>`;
const text = (x, y, s, cls = 't-note', anchor = 'start') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${t(s)}</text>`;
const dot = (x, y, r, cls) => `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`;
const num = (x, y, n, cls = 'f-ochre') => `<circle cx="${x}" cy="${y}" r="10" class="${cls}"/><text x="${x}" y="${y + .5}" text-anchor="middle" dominant-baseline="middle" class="t-small" style="fill:var(--paper);font-weight:600">${n}</text>`;

/* ------------------------------------------------------------------ */
const D = {};

/** Hero: one landscape section, from the mountains to the sea, with every generation layer on it. */
D.section = () => {
  let s = '';
  // sea
  s += `<path class="f-sea" d="M960 300 L1200 300 L1200 420 L960 420 Z"/>`;
  s += `<line x1="960" y1="300" x2="1200" y2="300" class="ln water thin"/>`;
  // ground profile
  const ground = 'M0 420 L0 170 L36 140 L70 92 L96 118 L132 66 L170 104 L205 150 L245 186 L292 214 L338 238 L372 252 L388 262 L402 262 L416 252 L470 244 L530 240 L600 238 L700 236 L790 238 L860 248 L920 268 L962 296 L985 304 L1060 336 L1200 360 L1200 420 Z';
  s += `<path class="f-land" d="${ground}"/>`;
  // strata
  for (const [dy, op] of [[34, .5], [70, .35], [110, .25]]) s += `<path class="ln relief thin" style="opacity:${op}" d="M0 ${170 + dy} L70 ${92 + dy} L132 ${66 + dy * 1.1} L205 ${150 + dy * .8} L338 ${238 + dy * .6} L530 ${240 + dy * .55} L860 ${248 + dy * .5} L1060 ${336 + dy * .3}"/>`;
  s += `<path class="ln relief" d="${ground.replace(/ L1200 420 L0 420 Z| Z/g, '').replace('M0 420 L0 170', 'M0 170')}"/>`;
  // underdark cave
  s += `<path class="f-paper3 s-ink" style="stroke:var(--relief);stroke-width:1" d="M78 262 C96 236 150 232 186 246 C214 258 236 252 250 270 C240 296 196 300 160 292 C120 302 84 290 78 262 Z"/>`;
  s += `<path class="f-water" style="opacity:.55" d="M150 290 C170 284 196 286 214 291 C200 297 168 298 150 290 Z"/>`;
  s += `<path class="ln relief thin" d="M250 270 C276 286 300 288 330 300"/>`;
  // snow on peaks
  s += `<path class="f-paper" d="M58 108 L70 92 L84 104 L76 108 L70 102 Z M120 82 L132 66 L146 82 L138 80 L132 76 Z"/>`;
  // forest on slopes
  for (const [x, y, k] of [[178, 112, 'c'], [190, 124, 'c'], [214, 150, 'c'], [228, 164, 'd'], [250, 180, 'd'], [266, 192, 'd'], [284, 204, 'd'], [300, 212, 'd'], [318, 222, 'd']]) {
    s += k === 'c' ? `<path class="f-moss" d="M${x} ${y - 16} L${x + 7} ${y} L${x - 7} ${y} Z"/>` : `<circle class="f-moss" cx="${x}" cy="${y - 8}" r="8"/><line x1="${x}" y1="${y}" x2="${x}" y2="${y - 3}" class="ln moss"/>`;
  }
  // river channel + label
  s += `<path class="f-water" d="M388 262 C392 268 398 268 402 262 Z"/>`;
  s += `<path class="f-water" d="M380 259 L410 259 L404 266 L386 266 Z"/>`;
  // bridge
  s += `<path class="ln ochre thick" d="M370 252 Q395 244 418 252"/>`;
  // farm + fields
  s += `<rect x="470" y="226" width="22" height="16" class="f-town-soft" style="stroke:var(--brick)"/><path d="M466 226 L481 214 L496 226 Z" class="f-town"/>`;
  for (let i = 0; i < 5; i++) s += `<line x1="${502 + i * 8}" y1="241" x2="${506 + i * 8}" y2="239" class="ln moss"/>`;
  // road pads
  for (const [a, b, y] of [[430, 462, 247], [540, 566, 240], [790, 830, 240]]) s += `<line x1="${a}" y1="${y}" x2="${b}" y2="${y}" class="ln ochre thick"/>`;
  // town: wall, houses, tower
  const base = 237;
  s += `<rect x="586" y="${base - 34}" width="8" height="34" class="f-ink2"/><rect x="583" y="${base - 40}" width="14" height="8" class="f-ink2"/>`;
  s += `<rect x="770" y="${base - 34}" width="8" height="34" class="f-ink2"/><rect x="767" y="${base - 40}" width="14" height="8" class="f-ink2"/>`;
  const houses = [[600, 20, 18], [622, 16, 26], [640, 20, 22], [662, 18, 30], [702, 16, 24], [720, 22, 20], [744, 18, 26]];
  for (const [x, w, h] of houses) s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" class="f-town-soft" style="stroke:var(--brick)"/><path d="M${x - 2} ${base - h} L${x + w / 2} ${base - h - w * .55} L${x + w + 2} ${base - h} Z" class="f-town"/>`;
  s += `<rect x="682" y="${base - 74}" width="16" height="74" class="f-town-soft" style="stroke:var(--brick)"/><path d="M680 ${base - 74} L690 ${base - 104} L700 ${base - 74} Z" class="f-town"/>`;
  // beach
  s += `<path d="M920 268 L962 296 L985 304" class="ln ochre" style="stroke-width:4;opacity:.6"/>`;
  // labels with leaders
  const tags = [
    [1, 120, 34, 92, 70, ['Relief', 'Relief'], ['noise, erosion, neural', 'bruit, érosion, neuronal']],
    [2, 168, 372, 160, 300, ['Underdark', 'Monde souterrain'], ['optional world layer', 'couche de monde optionnelle']],
    [3, 296, 112, 250, 172, ['Natural cover', 'Couverture naturelle'], ['forest from climate', 'forêt selon le climat']],
    [4, 430, 34, 395, 256, ['Water', 'Eau'], ['drainage, lakes, rivers', 'drainage, lacs, rivières']],
    [5, 520, 112, 482, 214, ['Countryside', 'Campagne'], ['places, farms, roads', 'lieux, fermes, routes']],
    [6, 640, 34, 590, 196, ['Town plan', 'Plan de ville'], ['streets, walls, parcels', 'rues, remparts, parcelles']],
    [7, 790, 112, 690, 160, ['Buildings', 'Bâtiments'], ['massing and roof forms', 'volumes et toitures']],
    [8, 960, 112, 950, 282, ['Coast', 'Côte'], ['coastal erosion, mouths', 'érosion côtière, embouchures']],
  ];
  for (const [n, x, y, px, py, head, sub] of tags) {
    const up = y < py;
 s += `<line x1="${x}" y1="${up ? y + 28 : y - 14}" x2="${px}" y2="${py}" class="ln thin"/>${dot(px, py, 2.5, 'f-ink2')}`;
    const half = Math.max(t(head).length * 4.6, t(sub).length * 3.1);
    s += num(x - half - 14, y, n);
    s += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" class="t-head" style="font-size:16px">${t(head)}</text><text x="${x}" y="${y + 18}" text-anchor="middle" class="t-small" style="font-size:12.5px">${t(sub)}</text>`;
  }
  s += `<text x="1188" y="34" text-anchor="end" class="t-head" style="font-size:16px">${t(['Map', 'Carte'])}</text><text x="1188" y="52" text-anchor="end" class="t-small" style="font-size:12.5px">${t(['seven styles, seasons, 2D and 3D', 'sept styles, saisons, 2D et 3D'])}</text>`;
  s += `<text x="1080" y="340" class="t-water" font-size="15">${t(['sea', 'mer'])}</text>`;
  return svg(1200, 420, ['A landscape section through every generation layer', 'Coupe d’un paysage à travers toutes les couches de génération'], s);
};

/** The four stage families and what each one retains. */
D.families = () => {
  let s = '';
  const cols = [
    { x: 10, cls: 'relief', head: ['Region', 'Région'], chips: [['Relief source', 'Source du relief'], ['Climate', 'Climat'], ['Procedural chain, 14 stages', 'Chaîne procédurale, 14 étapes'], ['or neural, 3 stages', 'ou neuronal, 3 étapes'], ['or imported heightmap', 'ou carte d’altitude'], ['Refine, condition, wind, coasts', 'Affinage, conditionnement, vent, côtes'], ['Water', 'Eau'], ['Natural cover', 'Couverture naturelle']], keep: ['heights, water, forest', 'altitudes, eau, forêt'] },
    { x: 262, cls: 'moss', head: ['Settlements', 'Établissements'], chips: [['Sites', 'Sites'], ['Hierarchy', 'Hiérarchie'], ['Countryside, remote places', 'Campagne, lieux isolés'], ['Regional roads', 'Routes régionales']], keep: ['places, farms, road graph', 'lieux, fermes, graphe routier'] },
    { x: 514, cls: 'town', head: ['Cities', 'Villes'], chips: [['Composition', 'Composition'], ['Streets', 'Rues'], ['Quarters', 'Quartiers'], ['Trim', 'Élagage'], ['Parcels', 'Parcelles'], ['Programme', 'Programme'], ['Buildings', 'Bâtiments'], ['Houses', 'Maisons']], keep: ['plan, parcels, volumes', 'plan, parcelles, volumes'] },
    { x: 766, cls: 'ochre', head: ['Map', 'Carte'], chips: [['Ground and relief', 'Sol et relief'], ['Vegetation, land use', 'Végétation, occupation du sol'], ['Water, roads, buildings', 'Eau, routes, bâtiments'], ['Ambience and seasons', 'Ambiance et saisons'], ['Text and legend', 'Texte et légende'], ['Names, export', 'Noms, export']], keep: ['image, 3D view, files', 'image, vue 3D, fichiers'] },
  ];
  for (const c of cols) {
    s += `<rect x="${c.x}" y="10" width="224" height="360" rx="10" class="bx ${c.cls}" style="fill-opacity:.35"/>`;
    s += `<text x="${c.x + 16}" y="38" class="t-big">${t(c.head)}</text>`;
    c.chips.forEach((ch, i) => { s += `<rect x="${c.x + 14}" y="${54 + i * 30}" width="196" height="24" rx="12" class="bx"/><text x="${c.x + 28}" y="${66 + i * 30}" dominant-baseline="middle" class="t-small" style="fill:var(--ink)">${t(ch)}</text>`; });
    s += `<rect x="${c.x + 14}" y="316" width="196" height="40" rx="6" class="bx ${c.cls}"/>`;
    s += `<text x="${c.x + 112}" y="331" text-anchor="middle" class="t-small">${t(['retained', 'conservé'])}</text><text x="${c.x + 112}" y="347" text-anchor="middle" class="t-head" style="font-size:12.5px">${t(c.keep)}</text>`;
  }
  for (const x of [234, 486, 738]) s += arrow(x + 2, 190, x + 26, 190, 'thick');
  s += text(10, 398, ['A stage reruns only from the first changed setting. The map reads retained products and never reruns generation.', 'Une étape ne se relance qu’à partir du premier réglage modifié. La carte lit les produits conservés et ne relance jamais la génération.']);
  return svg(1000, 410, ['The four stage families of the V2 and what each retains', 'Les quatre familles d’étapes de la V2 et ce que chacune conserve'], s);
};

/** Three relief sources, one finishing chain, one retained surface. */
D.relief = () => {
  let s = '';
  s += text(10, 24, ['Procedural', 'Procédural'], 't-head t-relief');
  const row = [[['Zones,', 'Zones,'], ['noise', 'bruit']], [['Coast', 'Découpe'], ['cut', 'côtière']], null, [['Recon-', 'Recons-'], ['struct', 'truction']], [['Calibrate', 'Calibration']], [['Ridged,', 'Détail ridgé,'], ['phasor detail', 'phasor']], [['Surface', 'Érosion de'], ['erosion', 'surface']]];
  let x = 10;
  const xs = [];
  for (const r of row) {
    if (r) { s += box(x, 40, 92, 50, r, 'relief', { head: false, lh: 15 }); xs.push(x); x += 104; }
    else { // regional loop
      s += `<rect x="${x}" y="34" width="150" height="62" rx="31" class="bx relief"/>`;
      s += `<text x="${x + 75}" y="54" text-anchor="middle" class="t-head">${t(['Regional evolution', 'Évolution régionale'])}</text>`;
      s += `<text x="${x + 75}" y="72" text-anchor="middle" class="t-small">${t(['uplift, incision,', 'surrection, incision,'])}</text><text x="${x + 75}" y="85" text-anchor="middle" class="t-small">${t(['thermal, diffusion', 'thermique, diffusion'])}</text>`;
      xs.push(x); x += 162;
    }
  }
  for (let i = 0; i < xs.length - 1; i++) { const w = i === 2 ? 150 : 92; s += arrow(xs[i] + w, 65, xs[i + 1] - 2, 65, 'thin'); }
  // grids
  s += `<rect x="10" y="104" width="${xs[3] - 22}" height="18" rx="4" class="band"/><text x="18" y="117" class="t-small">${t(['coarse regional grid', 'grille régionale grossière'])}</text>`;
  s += `<rect x="${xs[3]}" y="104" width="${xs[6] + 92 - xs[3]}" height="18" rx="4" class="band"/><text x="${xs[3] + 8}" y="117" class="t-small">${t(['fine surface grid, erosion scaled to the cell size', 'grille fine de surface, érosion adaptée à la taille de cellule'])}</text>`;
  // neural
  s += text(10, 162, ['Neural', 'Neuronal'], 't-head');
  s += box(10, 176, 150, 50, [['Coarse', 'Grossier'], ['7.68 km cells, climate, sketch', 'cellules de 7,68 km, climat, esquisse']], 'ochre');
  s += box(186, 176, 140, 50, [['Base', 'Base'], ['240 m', '240 m']], 'ochre');
  s += box(352, 176, 160, 50, [['Decoder', 'Décodeur'], ['30 m, amplification', '30 m, amplification']], 'ochre');
  s += arrow(160, 201, 184, 201, 'thin') + arrow(326, 201, 350, 201, 'thin');
  s += text(10, 262, ['Imported or library heightmap', 'Carte d’altitude importée ou de bibliothèque'], 't-head');
  s += box(10, 274, 200, 40, [['Fit: resample, scale, datum', 'Ajustement : rééchantillon, échelle, datum']], 'bx', { head: false });
  // finishing
  const fx = 830;
  s += `<rect x="${fx - 14}" y="20" width="184" height="300" rx="10" class="bx" style="fill:var(--paper-2)"/>`;
  s += text(fx, 44, ['Shared finishing', 'Finition commune'], 't-head');
  [['Fractal refine', 'Affinage fractal'], ['Fluvial conditioning', 'Conditionnement fluvial'], ['Wind transport', 'Transport éolien'], ['Coastal erosion', 'Érosion côtière']].forEach((r, i) => { s += box(fx, 58 + i * 50, 156, 36, [r], 'relief', { head: false }); if (i) s += arrow(fx + 78, 58 + i * 50 - 14, fx + 78, 58 + i * 50 - 2, 'thin'); });
  s += box(fx, 268, 156, 40, [['Retained surface', 'Surface conservée']], 'ochre');
  s += arrow(fx + 78, 252, fx + 78, 266, 'thin');
  // joins
  s += path(`M${xs[6] + 92} 65 C ${fx - 40} 65, ${fx - 40} 76, ${fx - 2} 76`, 'ochre');
  s += path(`M512 201 C 700 201, 720 90, ${fx - 2} 82`, 'ochre');
  s += path(`M210 294 C 600 294, 700 100, ${fx - 2} 88`, 'ochre');
  s += text(10, 340, ['Exactly one source runs. Underdark, when chosen, carves the finished surface before hydrology.', 'Une seule source s’exécute. Le monde souterrain, s’il est choisi, creuse la surface finie avant l’hydrologie.']);
  return svg(1000, 352, ['Three relief sources converge on one retained surface', 'Trois sources de relief convergent vers une seule surface conservée'], s);
};

/** Water chain, conditioning to mouths. */
D.water = () => {
  let s = '';
  const top = [[['Conditioning', 'Conditionnement'], ['breach ≤ 8 m, valley or step banks', 'brèche ≤ 8 m, berges en vallée ou en marche']],
    [['Drainage', 'Drainage'], ['Priority-Flood, D8 directions', 'Priority-Flood, directions D8']],
    [['Water budget', 'Bilan hydrique'], ['runoff per basin from climate', 'écoulement par bassin selon le climat']]];
  top.forEach((b, i) => { s += box(10 + i * 230, 30, 200, 60, b, 'water'); if (i) s += arrow(10 + i * 230 - 28, 60, 10 + i * 230 - 2, 60, 'water', 'water'); });
  // decision
  s += `<path d="M770 30 L840 60 L770 90 L700 60 Z" class="bx ochre"/>` + label(770, 60, [['spill or', 'déversoir'], ['closed?', 'ou fermé ?']], { lh: 13 });
  s += arrow(670, 60, 698, 60, 'water', 'water');
  s += box(870, 14, 120, 40, [['Lake kept', 'Lac conservé']], 'water');
  s += box(870, 66, 120, 40, [['Breach or fill', 'Brèche ou comblement']], '', { head: false });
  s += arrow(820, 51, 868, 36, 'water thin', 'water') + arrow(820, 69, 868, 84, 'thin');
  s += text(990, 124, ['tests: depth, area, coverage', 'tests : profondeur, surface, couverture'], 't-small', 'end');
  // second row
  const bot = [[['Lake capture', 'Capture lacustre'], ['rivers beside a lake drain into it', 'les rivières voisines s’y jettent']],
    [['River network', 'Réseau fluvial'], ['headwaters, spurs < 150 m dropped', 'sources, tronçons < 150 m retirés']],
    [['Mouths', 'Embouchures'], ['widen to the water, bed open to sea', 's’évasent vers l’eau, lit ouvert sur la mer']],
    [['Beds and lake shores', 'Lits et rives'], ['incision, shore on depth contour', 'incision, rive sur l’isobathe']]];
  bot.forEach((b, i) => { s += box(10 + i * 248, 170, 220, 64, b, 'water'); if (i) s += arrow(10 + i * 248 - 26, 202, 10 + i * 248 - 2, 202, 'water', 'water'); });
  s += path('M930 132 C 930 160, 120 140, 120 168', 'water', 'water');
  // formula
  s += `<rect x="10" y="256" width="980" height="62" rx="6" class="band"/>`;
  s += `<text x="24" y="280" class="t-mono">Tz = T − 0.0065·z     L = max(60, 300 + 25·Tz + 0.05·Tz³)     ET = P / √(0.9 + P²/L²)     r = max(P − ET, 0.02·P, 0.5)</text>`;
  s += text(24, 304, ['Turc-type evapotranspiration at altitude z (T in °C, P and r in mm/yr). Closed basins keep a lake only where the budget can sustain it.', 'Évapotranspiration de type Turc à l’altitude z (T en °C, P et r en mm/an). Un bassin fermé ne garde un lac que si le bilan peut l’entretenir.'], 't-small');
  return svg(1000, 330, ['Water chain: conditioning, drainage, budget, lakes, rivers and mouths', 'Chaîne de l’eau : conditionnement, drainage, bilan, lacs, rivières et embouchures'], s);
};

/** River mouth in plan, with its constraints. */
D.mouth = () => {
  let s = '';
  s += `<path class="f-land" d="M0 0 H700 V260 H0 Z"/><path class="f-sea" d="M700 0 C 690 80, 720 180, 700 260 H1000 V0 Z"/>`;
  // flaring river: half-width h(x) = w * exp(k x) near the mouth
  const pts = [], w = 9, x0 = 40, x1 = 704, cy = 130;
  for (let x = x0; x <= x1; x += 8) { const u = Math.max(0, (x - 430) / (x1 - 430)); pts.push([x, w * Math.exp(2.0 * u * u * 1.3)]); }
  const upper = pts.map(([x, h]) => `${x} ${cy - h}`).join(' L'), lower = pts.slice().reverse().map(([x, h]) => `${x} ${cy + h}`).join(' L');
  s += `<path class="f-water" style="opacity:.85" d="M${upper} L${lower} Z"/>`;
  s += `<text x="120" y="${cy - 18}" class="t-water" font-size="15">${t(['river', 'rivière'])}</text><text x="860" y="60" class="t-water" font-size="15">${t(['sea', 'mer'])}</text>`;
  // annotations
  s += `<line x1="200" y1="${cy - w}" x2="200" y2="${cy + w}" class="ln ochre"/>` + text(206, cy + 30, ['channel width w', 'largeur du chenal w'], 't-small');
  const hEnd = pts[pts.length - 1][1];
  s += `<line x1="${x1 + 14}" y1="${cy - hEnd}" x2="${x1 + 14}" y2="${cy + hEnd}" class="ln ochre"/>` + text(x1 + 22, cy + 4, ['1 to full × w, by discharge', '1 à full × w, selon le débit'], 't-small');
  s += path(`M430 ${cy + 56} L700 ${cy + 56}`, 'ochre thin', 'ochre') + text(440, cy + 74, ['monotone exponential widening over several widths', 'évasement exponentiel monotone sur plusieurs largeurs'], 't-small');
  s += path(`M720 ${cy + 100} L950 ${cy + 100}`, 'dash thin', '') + text(730, cy + 118, ['≤ half the distance to the next mouth', '≤ moitié de la distance à l’embouchure voisine'], 't-small');
  // three forms
  s += text(20, 24, ['Forms', 'Formes'], 't-head');
  s += text(20, 42, ['brook < 15 m: simple flare. River ≥ 40 m on a gentle coast (slope < 0.03, last gradient < 0.09): funnel or tidal.', 'ruisseau < 15 m : simple évasement. Rivière ≥ 40 m sur côte douce (pente < 0,03, dernier gradient < 0,09) : entonnoir ou estuaire à marée.'], 't-small');
  s += text(20, 246, ['Water surface ends at 0 m and never rises seaward; the bed is opened to the sea.', 'La surface de l’eau finit à 0 m et ne remonte jamais vers la mer ; le lit est ouvert sur la mer.'], 't-small');
  return svg(1000, 260, ['River mouth widening in plan', 'Évasement d’une embouchure en plan'], s);
};

/** Underdark carving, seven steps. */
D.underdark = () => {
  let s = '';
  const steps = [
    [['Floor', 'Sol'], ['relief lifted above 0, compressed above 600 m', 'relief relevé au-dessus de 0, comprimé au-delà de 600 m'], 'M10 70 L40 50 L70 60 L100 40 L110 70 Z'],
    [['Tunnels', 'Tunnels'], ['drainage becomes corridors', 'le drainage devient couloirs'], 'M10 60 C40 40 60 70 110 40'],
    [['Caverns', 'Cavernes'], ['low basins, about 20 %, with pillars', 'bassins bas, environ 20 %, avec piliers'], 'M14 60 C20 30 90 30 104 58 C90 76 24 76 14 60 Z'],
    [['Galleries', 'Galeries'], ['zero crossings of warped noise', 'zéros d’un bruit déformé'], 'M10 40 C30 70 50 20 70 50 S100 60 110 30'],
    [['Clean-up', 'Nettoyage'], ['every chamber joined by Dijkstra', 'chaque salle reliée par Dijkstra'], 'M20 60 L50 40 L90 60 M50 40 L60 70'],
    [['Walls', 'Parois'], ['smoothed distance field gives rock height', 'champ de distance lissé, hauteur de roche'], 'M10 70 L10 40 Q30 30 40 50 L80 50 Q96 30 110 40 L110 70'],
    [['Lakes and silt', 'Lacs et limon'], ['0.04–2 % of map and ≥ 4 m deep stay lakes', '0,04 à 2 % de la carte et ≥ 4 m : lacs'], 'M14 56 Q60 80 106 56 Z'],
  ];
  steps.forEach(([h, sub, d], i) => {
    const x = 6 + i * 141;
    s += `<rect x="${x}" y="8" width="132" height="190" rx="8" class="bx relief" style="fill-opacity:.5"/>`;
    s += `<g transform="translate(${x + 6},18)"><rect width="120" height="86" rx="4" class="f-paper3"/><path d="${d}" class="${i === 6 ? 'f-water' : i === 2 ? 'f-paper' : 'nofill'} ln relief" style="${i === 6 ? 'stroke:var(--water)' : ''}"/></g>`;
    s += num(x + 18, 126, i + 1);
    s += `<text x="${x + 34}" y="130" class="t-head" style="font-size:13px">${t(h)}</text>`;
    const words = t(sub).split(' '); let line = '', ly = 150;
    for (const wd of words) { if ((line + ' ' + wd).length > 21) { s += `<text x="${x + 10}" y="${ly}" class="t-small">${line}</text>`; ly += 14; line = wd; } else line = line ? line + ' ' + wd : wd; }
    s += `<text x="${x + 10}" y="${ly}" class="t-small">${line}</text>`;
  });
  return svg(1000, 206, ['Underdark carving in seven steps', 'Creusement du monde souterrain en sept étapes'], s);
};

/** Settlement hierarchy and the countryside around one place. */
D.settlements = () => {
  let s = '';
  // rank-size
  s += text(10, 22, ['Rank-size law: rank r holds main / r^q', 'Loi rang-taille : le rang r porte principal / r^q'], 't-head');
  const q = 1.05, main = 150;
  for (let r = 1; r <= 14; r++) { const h = main / Math.pow(r, q); s += `<rect x="${14 + (r - 1) * 28}" y="${200 - h}" width="20" height="${h}" rx="2" class="${r === 1 ? 'f-town' : r < 4 ? 'f-town-soft' : 'f-paper3'}" style="stroke:var(--brick);stroke-width:.8"/>`; }
  s += `<line x1="10" y1="200" x2="410" y2="200" class="ln thin"/>`;
  s += text(14, 220, ['city', 'ville'], 't-small') + text(84, 220, ['towns', 'bourgs'], 't-small') + text(220, 220, ['villages and hamlets, down to a minimum', 'villages et hameaux, jusqu’à un minimum'], 't-small');
  // countryside
  const cx = 690, cy = 130;
  s += text(470, 22, ['Around one place', 'Autour d’un lieu'], 't-head');
  s += `<circle cx="${cx}" cy="${cy}" r="98" class="f-moss-soft" style="stroke:var(--moss);stroke-dasharray:5 4"/>`;
  s += `<path d="M${cx - 26} ${cy - 16} C${cx - 6} ${cy - 32} ${cx + 30} ${cy - 22} ${cx + 30} ${cy + 4} C${cx + 26} ${cy + 30} ${cx - 10} ${cy + 30} ${cx - 28} ${cy + 12} Z" class="f-town-soft" style="stroke:var(--brick)"/>`;
  s += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" class="t-town">${t(['town', 'ville'])}</text>`;
  // roads
  s += path(`M470 ${cy + 40} C ${cx - 80} ${cy + 30}, ${cx - 40} ${cy + 10}, ${cx - 28} ${cy + 6}`, 'ochre thick', null);
  s += path(`M${cx + 30} ${cy} C ${cx + 120} ${cy - 10}, ${cx + 160} ${cy - 60}, 980 ${cy - 90}`, 'ochre thick', null);
  s += path(`M${cx} ${cy + 26} C ${cx + 10} ${cy + 80}, ${cx + 40} ${cy + 110}, ${cx + 50} 250`, 'ochre', null);
  // farms
  for (const [x, y] of [[cx - 70, cy - 50], [cx + 60, cy - 60], [cx + 70, cy + 50], [cx - 60, cy + 60], [cx - 85, cy + 10], [cx + 20, cy + 80], [cx + 150, cy + 70], [cx - 160, cy - 70]]) s += `<rect x="${x - 5}" y="${y - 4}" width="10" height="8" class="f-town"/>`;
  s += text(cx - 150, cy - 82, ['isolated farm', 'ferme isolée'], 't-small');
  s += text(cx + 102, cy + 106, ['farmland reach', 'rayon des cultures'], 't-small');
  // chapel and shrine
  s += `<path d="M${cx + 106} ${cy - 22} l6 -10 l6 10 z" class="f-ink2"/>` + text(cx + 122, cy - 24, ['wayside shrine at a junction', 'calvaire à un carrefour'], 't-small');
  // remote place on crag
  s += `<path d="M900 250 L930 160 L960 250 Z" class="f-land" style="stroke:var(--relief)"/><rect x="924" y="150" width="12" height="12" class="f-town"/>`;
  s += path('M928 165 L918 190 L934 210 L920 236 L912 250', 'ochre dash thin', null);
  s += text(820, 150, ['remote place: crag,', 'lieu isolé : piton,'], 't-small') + text(820, 164, ['cliff stair to the road', 'escalier jusqu’à la route'], 't-small');
  return svg(1000, 256, ['Settlement hierarchy and the countryside around a place', 'Hiérarchie des établissements et campagne autour d’un lieu'], s);
};

/** Regional roads in four panels. */
D.roads = () => {
  let s = '';
  const P = [[40, 60], [150, 40], [110, 140], [30, 170], [190, 160], [210, 80]];
  const tri = [[0, 1], [0, 2], [1, 2], [0, 3], [2, 3], [2, 4], [3, 4], [1, 5], [2, 5], [4, 5]];
  const mst = [[0, 1], [0, 2], [2, 3], [2, 4], [4, 5]];
  const panel = (i, title, body) => { const x = 8 + i * 248; return `<g transform="translate(${x},34)"><rect width="236" height="210" rx="8" class="bx" style="fill:var(--paper-2)"/>${body}</g>` + num(x + 14, 18, i + 1) + `<text x="${x + 30}" y="22" class="t-head" style="font-size:13px">${t(title)}</text>`; };
  const places = sz => P.map(([x, y], i) => dot(x, y, i === 2 ? 8 : sz, i === 2 ? 'f-town' : 'f-town-soft') + (i === 2 ? '' : `<circle cx="${x}" cy="${y}" r="${sz}" class="nofill ln town thin"/>`)).join('');
  s += panel(0, ['Delaunay graph', 'Graphe de Delaunay'], tri.map(([a, b]) => `<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}" class="ln thin"/>`).join('') + places(5));
  s += panel(1, ['Tree and shortcuts', 'Arbre et raccourcis'], mst.map(([a, b]) => `<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}" class="ln ochre thick"/>`).join('') + `<line x1="${P[1][0]}" y1="${P[1][1]}" x2="${P[5][0]}" y2="${P[5][1]}" class="ln ochre dash"/>` + places(5) + `<text x="12" y="200" class="t-small">${t(['dashed: shortcut where the tree detours', 'tirets : raccourci où l’arbre fait un détour'])}</text>`);
  // move stencil
  let st = ''; const c = 118, cy = 104, g = 22;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) st += `<rect x="${c + i * g - g / 2}" y="${cy + j * g - g / 2}" width="${g}" height="${g}" class="nofill ln thin" style="stroke:var(--rule)"/>`;
  const moves = [];
  for (const [a, b] of [[1, 0], [1, 1], [2, 1], [3, 1]]) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const sw of [false, true]) { const [u, v] = sw ? [b, a] : [a, b]; const k = `${u * sx},${v * sy}`; if (!moves.includes(k)) moves.push(k); }
  for (const k of moves) { const [u, v] = k.split(',').map(Number); st += `<line x1="${c}" y1="${cy}" x2="${c + u * g}" y2="${cy + v * g}" class="ln ochre thin"/>${dot(c + u * g, cy + v * g, 2.4, 'f-ochre')}`; }
  st += dot(c, cy, 5, 'f-ink') + `<text x="12" y="200" class="t-small">${t([`${moves.length} moves, state = cell + heading`, `${moves.length} mouvements, état = cellule + cap`])}</text>`;
  s += panel(2, ['Least-cost search', 'Recherche à moindre coût'], st);
  // merged graph
  let mg = '';
  mg += path(`M${P[0][0]} ${P[0][1]} Q 70 100 ${P[2][0]} ${P[2][1]}`, 'ochre thick', null) + path(`M${P[3][0]} ${P[3][1]} Q 80 150 ${P[2][0]} ${P[2][1]}`, 'ochre', null);
  mg += path(`M${P[2][0]} ${P[2][1]} Q 160 130 ${P[4][0]} ${P[4][1]}`, 'ochre', null) + path(`M${P[1][0]} ${P[1][1]} Q 120 80 ${P[2][0]} ${P[2][1]}`, 'ochre thick', null);
  mg += path(`M${P[1][0]} ${P[1][1]} Q 190 50 ${P[5][0]} ${P[5][1]}`, 'ochre thin', null) + path(`M${P[5][0]} ${P[5][1]} L 232 70`, 'ochre thin dash', null);
  mg += places(5) + dot(96, 104, 3.5, 'f-ink') + `<text x="12" y="186" class="t-small">${t(['one graph, junctions, shared trunks;', 'un seul graphe, carrefours, troncs partagés ;'])}</text><text x="12" y="200" class="t-small">${t(['class = most important trip', 'classe = trajet le plus important'])}</text>`;
  s += panel(3, ['One merged network', 'Un réseau fusionné'], mg);
  return svg(1000, 252, ['Regional roads: graph, tree, least-cost search, merged network', 'Routes régionales : graphe, arbre, recherche à moindre coût, réseau fusionné'], s);
};

/** The town chain with its feedback loops and time shares. */
D.town = () => {
  let s = '';
  const steps = [[['Kind and', 'Type et'], ['footprint', 'emprise']], [['Macroplan', 'Macroplan']], [['Streets and', 'Rues et'], ['quarters', 'quartiers']], [['Trim', 'Élagage']], [['Parcels', 'Parcelles']], [['Programme', 'Programme']], [['Building', 'Sites de'], ['sites', 'bâtiments']], [['Massing', 'Volumétrie']], [['Forms', 'Formes']]];
  const W = 100, G = 10;
  steps.forEach((st, i) => { const x = 8 + i * (W + G); s += box(x, 90, W, 56, st, i < 4 ? 'town' : i < 6 ? 'ochre' : 'moss', { head: false, lh: 15 }); if (i) s += arrow(x - G, 118, x - 1, 118, 'thin'); });
  // inputs
  s += box(8, 8, 210, 46, [['Neighbour claims', 'Emprises voisines'], ['land and edge streets of earlier towns', 'terrain et rues de lisière des villes antérieures']], 'bx ghost', { lh: 14 });
  s += arrow(60, 54, 60, 88, 'dash thin');
  s += box(360, 8, 380, 46, [['Culture sheet, or a hybrid style sheet', 'Fiche de culture, ou feuille de style hybride'], ['streets, plots, houses, monuments, countryside', 'rues, parcelles, maisons, monuments, campagne']], 'bx ghost', { lh: 14 });
  for (const i of [1, 2, 4, 5, 8]) s += path(`M${550} 54 Q ${8 + i * (W + G) + W / 2} 64 ${8 + i * (W + G) + W / 2} 88`, 'dash thin');
  // loops
  const xt = 8 + 3 * (W + G) + W / 2, xq = 8 + 2 * (W + G) + W / 2, xp = 8 + 5 * (W + G) + W / 2, xf = 8 + W / 2;
  s += path(`M${xt} 146 C ${xt} 180, ${xq} 180, ${xq} 148`, 'town', 'town') + text(xq - 10, 194, ['unbuilt blocks to fields, fixed point ≤ 8 passes', 'îlots vides en champs, point fixe ≤ 8 passes'], 't-small');
  s += path(`M${xp} 146 C ${xp} 232, ${xf} 232, ${xf} 148`, 'ochre', 'ochre') + text(xf + 20, 226, ['capacity and slope replan', 'replanification capacité et pente'], 't-small');
  // time share bar (1M town, after optimisation)
  const total = 110 + 12.7 + 4.2 + 11.5, bw = 980;
  let x = 10; s += text(10, 258, ['Where the time goes, one 1M-inhabitant town (138 s, 8 threads)', 'Où va le temps, une ville d’un million d’habitants (138 s, 8 fils)'], 't-head');
  for (const [v, cls, lab] of [[110, 'f-town', ['streets, quarters, trim 110 s', 'rues, quartiers, élagage 110 s']], [12.7, 'f-ochre', ['parcels 13 s', 'parcelles 13 s']], [4.2, 'f-ochre-soft', ['', '']], [11.5, 'f-moss', ['sites 12 s', 'sites 12 s']]]) {
    const w = v / total * bw; s += `<rect x="${x}" y="268" width="${w}" height="20" class="${cls}"/>`; if (t(lab)) s += `<text x="${x + 6}" y="282" class="t-small" style="fill:var(--paper);font-weight:600">${t(lab)}</text>`; x += w;
  }
  s += text(10, 306, ['Programme 4 s (thin band). Numbers from the 2026-11-14 scaling review.', 'Programme 4 s (bande fine). Chiffres de la revue de passage à l’échelle du 14/11/2026.'], 't-small');
  return svg(1000, 314, ['Town chain, feedback loops and time shares', 'Chaîne de ville, boucles de rétroaction et répartition du temps'], s);
};

/** Neighbouring towns and the density gradient. */
D.neighbours = () => {
  let s = '';
  s += text(10, 20, ['Towns in canonical order', 'Villes dans l’ordre canonique'], 't-head');
  s += `<rect x="10" y="32" width="480" height="210" rx="8" class="f-paper2"/>`;
  // town A claim
  s += `<path d="M60 70 C120 40 230 50 250 110 C260 170 190 220 110 205 C50 195 30 120 60 70 Z" fill="url(#HATCH)" class="ln town thin"/>`;
  s += `<path d="M90 90 C130 70 200 80 215 120 C220 160 170 190 120 180 C80 172 70 120 90 90 Z" class="f-town-soft" style="stroke:var(--brick)"/>`;
  s += `<text x="150" y="132" text-anchor="middle" class="t-town">A</text><text x="150" y="148" text-anchor="middle" class="t-small">${t(['earlier, larger', 'antérieure, plus grande'])}</text>`;
  // town B
  s += `<path d="M300 90 C350 70 420 90 430 140 C436 190 380 220 330 205 C290 195 262 150 300 90 Z" class="f-town-soft" style="stroke:var(--brick)"/>`;
  s += `<text x="360" y="150" text-anchor="middle" class="t-town">B</text>`;
  s += dot(300, 150, 4, 'f-ink2') + dot(352, 140, 4, 'f-ink') + path('M302 149 L346 141', 'dash thin', '') + text(270, 188, ['centre moved', 'centre déplacé'], 't-small');
  // streets joining
  s += path('M250 110 L300 112', 'ochre thick', null) + path('M245 160 L292 168', 'ochre thick', null) + text(232, 92, ['edge streets joined', 'rues de lisière raccordées'], 't-small');
  s += text(20, 234, ['hatched: land claimed by A, kept free by B', 'hachures : terrain revendiqué par A, laissé libre par B'], 't-small');
  // gradient
  s += text(530, 20, ['Density gradient between phases', 'Gradient de densité entre phases'], 't-head');
  const gx = 560, gy = 200, gw = 400, gh = 150;
  s += `<line x1="${gx}" y1="${gy}" x2="${gx + gw}" y2="${gy}" class="ln thin"/><line x1="${gx}" y1="${gy}" x2="${gx}" y2="${gy - gh}" class="ln thin"/>`;
  s += `<line x1="${gx + gw / 2}" y1="${gy}" x2="${gx + gw / 2}" y2="${gy - gh}" class="ln dash thin"/>`;
  s += path(`M${gx} ${gy - gh * .95} C ${gx + 120} ${gy - gh * .95}, ${gx + 160} ${gy - gh * .55}, ${gx + gw / 2} ${gy - gh * .5} C ${gx + 240} ${gy - gh * .45}, ${gx + 280} ${gy - gh * .05}, ${gx + gw} ${gy - gh * .05}`, 'town thick', null);
  s += text(gx + gw / 2 + 6, gy - gh * .5 - 8, ['0.5 at the boundary', '0,5 à la limite'], 't-small');
  s += text(gx + 4, gy + 18, ['core', 'cœur'], 't-small') + text(gx + gw - 4, gy + 18, ['faubourg, 0 beyond the band', 'faubourg, 0 au-delà de la bande'], 't-small', 'end');
  s += text(gx, gy + 40, ['Option zoneDensity = gradient. No blending across a town wall.', 'Option zoneDensity = gradient. Aucun mélange à travers un rempart.'], 't-small');
  return svg(1000, 250, ['Neighbouring towns and the density gradient', 'Villes voisines et gradient de densité'], s);
};

/** From a block to a raised silhouette. */
D.lot = () => {
  let s = '';
  const panel = (i, title) => { const x = 8 + i * 248; return [`<rect x="${x}" y="34" width="236" height="200" rx="8" class="f-paper2"/>` + num(x + 14, 18, i + 1) + `<text x="${x + 30}" y="22" class="t-head" style="font-size:13px">${t(title)}</text>`, x]; };
  // 1 parcels
  let [p, x] = panel(0, ['Parcels on the street', 'Parcelles sur rue']);
  s += p + `<rect x="${x + 10}" y="200" width="216" height="18" class="f-ochre-soft"/><text x="${x + 118}" y="213" text-anchor="middle" class="t-small">${t(['street', 'rue'])}</text>`;
  const fr = [30, 22, 34, 26, 40, 30, 24];
  let px = x + 12; for (const f of fr) { s += `<rect x="${px}" y="70" width="${f}" height="128" class="nofill ln town thin"/>`; px += f; }
  s += text(x + 12, 62, ['frontage × depth, four operators', 'façade × profondeur, quatre opérateurs'], 't-small');
  // 2 programme
  [p, x] = panel(1, ['Programme', 'Programme']); s += p;
  const roles = ['f-town-soft', 'f-ochre', 'f-town-soft', 'f-moss-soft', 'f-town', 'f-town-soft', 'f-ochre'];
  px = x + 12; fr.forEach((f, i) => { s += `<rect x="${px}" y="70" width="${f}" height="128" class="${roles[i]}" style="stroke:var(--brick);stroke-width:.6"/>`; px += f; });
  s += `<rect x="${x + 10}" y="200" width="216" height="18" class="f-ochre-soft"/>`;
  s += text(x + 12, 62, ['landmark, shops, housing, yard', 'monument, boutiques, logements, cour'], 't-small');
  // 3 occupation pieces
  [p, x] = panel(2, ['Occupation preview', 'Prévisualisation d’occupation']); s += p;
  s += `<rect x="${x + 60}" y="70" width="110" height="128" class="nofill ln town thin"/>`;
  s += `<rect x="${x + 60}" y="160" width="110" height="38" class="f-town-soft" style="stroke:var(--brick)"/><text x="${x + 115}" y="183" text-anchor="middle" class="t-small">${t(['street body', 'corps sur rue'])}</text>`;
  s += `<rect x="${x + 60}" y="96" width="30" height="64" class="f-town-soft" style="stroke:var(--brick)"/><text x="${x + 96}" y="120" class="t-small">${t(['rear wing', 'aile arrière'])}</text>`;
  s += `<rect x="${x + 140}" y="84" width="30" height="40" class="f-town-soft" style="stroke:var(--brick)"/><text x="${x + 96}" y="80" class="t-small">${t(['court range', 'bâtiment de cour'])}</text>`;
  s += `<rect x="${x + 10}" y="200" width="216" height="18" class="f-ochre-soft"/>`;
  // 4 massing axonometric
  [p, x] = panel(3, ['Raised by massing', 'Élevé par la volumétrie']); s += p;
  const iso = (bx, by, w, d, h, roof) => {
    const ax = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const P2 = (u, v, z) => [x + bx + (u - v) * ax[0], by + (u + v) * ax[1] - z];
    const q = (pts, cls, st = 'stroke:var(--brick);stroke-width:.8') => `<path d="M${pts.map(p2 => p2.map(n => n.toFixed(1)).join(' ')).join(' L')} Z" class="${cls}" style="${st}"/>`;
    let o = q([P2(0, d, 0), P2(w, d, 0), P2(w, d, h), P2(0, d, h)], 'f-town-soft') + q([P2(w, 0, 0), P2(w, d, 0), P2(w, d, h), P2(w, 0, h)], 'f-paper3');
    const r = roof; o += q([P2(0, d, h), P2(w, d, h), P2(w, d / 2, h + r), P2(0, d / 2, h + r)], 'f-town') + q([P2(0, 0, h), P2(w, 0, h), P2(w, d / 2, h + r), P2(0, d / 2, h + r)], 'f-town');
    o += q([P2(w, 0, h), P2(w, d, h), P2(w, d / 2, h + r)], 'f-town-soft');
    return o;
  };
  s += iso(100, 96, 40, 26, 22, 14) + iso(70, 130, 70, 30, 34, 16) + iso(150, 140, 30, 22, 26, 12);
  s += text(x + 12, 226, ['each piece: own floors, eave and roof', 'chaque pièce : étages, corniche et toit propres'], 't-small');
  return svg(1000, 242, ['From parcels to a raised silhouette', 'Des parcelles à la silhouette élevée'], s);
};

/** Forms engine vocabulary: home plans and roof kinds. */
D.forms = () => {
  let s = '';
  s += text(10, 22, ['Home plans', 'Plans de maison'], 't-head');
  const plans = { bar: 'M0 10 H60 V34 H0 Z', ell: 'M0 10 H60 V34 H24 V60 H0 Z', tee: 'M0 10 H60 V32 H40 V60 H20 V32 H0 Z', court: 'M0 0 H60 V60 H0 Z M16 16 V44 H44 V16 Z', cross: 'M20 0 H40 V20 H60 V40 H40 V60 H20 V40 H0 V20 H20 Z', aitch: 'M0 0 H18 V24 H42 V0 H60 V60 H42 V38 H18 V60 H0 Z' };
  const names = { bar: ['bar', 'barre'], ell: ['ell', 'L'], tee: ['tee', 'T'], court: ['court', 'cour'], cross: ['cross', 'croix'], aitch: ['aitch', 'H'] };
  Object.entries(plans).forEach(([k, d], i) => { const x = 14 + i * 78; s += `<g transform="translate(${x},40)"><path d="${d}" fill-rule="evenodd" class="f-town-soft" style="stroke:var(--brick);stroke-width:1.2"/></g><text x="${x + 30}" y="122" text-anchor="middle" class="t-small">${t(names[k])}</text>`; });
  s += text(14, 146, ['extras: outshot, porch, bay, turret, chimney, dormer', 'ajouts : appentis, porche, oriel, tourelle, cheminée, lucarne'], 't-small');
  // roofs
  s += text(500, 22, ['Roof kinds, in section', 'Types de toit, en coupe'], 't-head');
  const roofs = [
    ['gable', 'pignon', 'M0 50 L25 20 L50 50'], ['hip', 'croupe', 'M0 50 L16 24 L34 24 L50 50'], ['half-hip', 'demi-croupe', 'M0 50 L0 38 L10 30 L25 18 L40 30 L50 38 L50 50'],
    ['gambrel', 'à la Mansart', 'M0 50 L8 32 L25 20 L42 32 L50 50'], ['mansard', 'mansarde', 'M0 50 L6 28 L44 28 L50 50'], ['shed', 'appentis', 'M0 50 L0 26 L50 38 L50 50'],
    ['flat', 'plat', 'M0 50 L0 42 L50 42 L50 50'], ['dome', 'dôme', 'M0 50 A25 25 0 0 1 50 50'], ['cone', 'cône', 'M0 50 L25 10 L50 50'],
  ];
  roofs.forEach(([en, fr, d], i) => { const x = 500 + (i % 5) * 98, y = 40 + Math.floor(i / 5) * 80; s += `<g transform="translate(${x},${y})"><rect x="0" y="50" width="50" height="16" class="f-paper3" style="stroke:var(--brick);stroke-width:.8"/><path d="${d} Z" class="f-town" style="stroke:var(--brick)"/></g><text x="${x + 25}" y="${y + 80}" text-anchor="middle" class="t-small">${t([en, fr])}</text>`; });
  return svg(1000, 210, ['Forms engine: home plans and roof kinds', 'Moteur de formes : plans de maison et types de toit'], s);
};

/** Render pipeline. */
D.render = () => {
  let s = '';
  s += box(8, 20, 180, 230, [['Retained world', 'Monde conservé']], 'bx', {});
  [['heights, water, forest', 'altitudes, eau, forêt'], ['land use, roads', 'occupation du sol, routes'], ['towns, buildings', 'villes, bâtiments'], ['names', 'noms']].forEach((l, i) => { s += `<rect x="22" y="${150 - 70 + i * 34 + 30}" width="152" height="26" rx="13" class="bx relief" style="fill-opacity:.6"/><text x="98" y="${150 - 70 + i * 34 + 43}" text-anchor="middle" dominant-baseline="middle" class="t-small" style="fill:var(--ink)">${t(l)}</text>`; });
  s += box(220, 20, 230, 230, [['Appearance recipe', 'Recette d’apparence']], 'ochre');
  s += text(236, 70, ['style preset, then per pass:', 'préréglage de style, puis par passe :'], 't-small');
  [['ground, relief', 'sol, relief'], ['vegetation, land use', 'végétation, occupation du sol'], ['water, roads, buildings', 'eau, routes, bâtiments'], ['ambience, season calendar', 'ambiance, calendrier des saisons'], ['text, legend', 'texte, légende']].forEach((l, i) => { s += `<rect x="236" y="${84 + i * 32}" width="198" height="24" rx="12" class="bx"/><text x="250" y="${96 + i * 32}" dominant-baseline="middle" class="t-small" style="fill:var(--ink)">${t(l)}</text>`; });
  s += arrow(188, 135, 218, 135, 'thick');
  // engines
  s += box(486, 20, 240, 62, [['Ground', 'Sol'], ['WebGL2 or WebGPU terrain renderer', 'rendu de terrain WebGL2 ou WebGPU']], 'relief');
  s += box(486, 98, 240, 74, [['Vector overlay', 'Surcouche vectorielle'], ['CPU: Canvas 2D', 'CPU : Canvas 2D'], ['GPU: recorded display list', 'GPU : liste d’affichage enregistrée']], 'water', { lh: 15 });
  s += box(486, 188, 240, 62, [['3D view', 'Vue 3D'], ['WebGPU, WebGL2 fallback', 'WebGPU, repli WebGL2']], 'moss');
  for (const y of [51, 135, 219]) s += arrow(450, 135, 484, y, 'thin');
  s += box(760, 20, 230, 62, [['2D map', 'Carte 2D'], ['live replay with the view matrix', 'rejouée en direct avec la matrice de vue']], 'bx');
  s += box(760, 98, 230, 74, [['Exports', 'Exports'], ['PNG, SVG, heightmap,', 'PNG, SVG, carte d’altitude,'], ['project, recipe, battlemap', 'projet, recette, battlemap']], 'bx', { lh: 15 });
  s += box(760, 188, 230, 62, [['3D scene', 'Scène 3D'], ['draped map, volumes, trees', 'carte drapée, volumes, arbres']], 'bx');
  s += arrow(726, 51, 758, 51, 'thin') + arrow(726, 135, 758, 51, 'thin') + arrow(726, 135, 758, 135, 'thin') + arrow(726, 219, 758, 219, 'thin');
  s += text(8, 278, ['Changing the appearance never reruns generation. The GPU engine falls back to the CPU on software GL, a lost context or slow frames.', 'Changer l’apparence ne relance jamais la génération. Le moteur GPU se replie sur le CPU en cas de GL logiciel, de contexte perdu ou d’images lentes.'], 't-small');
  return svg(1000, 290, ['Render pipeline: retained world, recipe, engines, outputs', 'Chaîne de rendu : monde conservé, recette, moteurs, sorties'], s);
};

/** Runtime: who computes what, where. */
D.runtime = () => {
  let s = '';
  s += `<rect x="8" y="8" width="560" height="290" rx="12" class="bx" style="fill:var(--paper-2)"/>` + text(24, 34, ['Browser or desktop window', 'Navigateur ou fenêtre de l’application'], 't-head');
  s += box(24, 50, 240, 74, [['Main thread', 'Fil principal'], ['interface, drawing, 3D', 'interface, dessin, 3D']], 'ochre');
  s += box(24, 140, 240, 140, [['Workers', 'Workers'], ['engine: generation queue', 'moteur : file de génération'], ['render, compose, export', 'rendu, composition, export'], ['occupation, road routes', 'occupation, tracés de routes']], 'bx', { lh: 18 });
  s += box(300, 140, 250, 140, [['WebAssembly', 'WebAssembly'], ['Rust core, threads when', 'cœur Rust, fils si la page'], ['cross-origin isolated,', 'est isolée (cross-origin),'], ['else single thread or pool', 'sinon fil unique ou pool']], 'relief', { lh: 18 });
  s += box(300, 50, 250, 74, [['GPU', 'GPU'], ['WebGPU, WebGL2; neural in browser', 'WebGPU, WebGL2 ; neuronal en navigateur']], 'moss');
  s += arrow(144, 124, 144, 138, 'thin') + arrow(264, 210, 298, 210, 'thin');
  s += `<rect x="600" y="8" width="392" height="290" rx="12" class="bx" style="fill:var(--paper-2)"/>` + text(616, 34, ['Same machine, loopback only', 'Même machine, boucle locale uniquement'], 't-head');
  s += box(616, 50, 360, 110, [['Native Rust engine :8791', 'Moteur Rust natif :8791'], ['relief, water, coast, land use, forest,', 'relief, eau, côte, occupation du sol, forêt,'], ['sites, roads, towns; one session per city lane;', 'sites, routes, villes ; une session par voie de ville ;'], ['binary replies (parcel pack)', 'réponses binaires (paquet de parcelles)']], 'town', { lh: 18 });
  s += box(616, 176, 360, 56, [['Python neural service :8793', 'Service neuronal Python :8793'], ['optional, CUDA', 'optionnel, CUDA']], 'bx ghost', { lh: 16 });
  s += text(616, 262, ['The desktop app (Tauri) starts the native engine', 'L’application de bureau (Tauri) lance le moteur natif'], 't-small') + text(616, 278, ['on a free port and optional modules.', 'sur un port libre, et les modules optionnels.'], 't-small');
  s += path('M264 170 C 420 100, 520 100, 614 104', 'town', 'town') + text(380, 102, ['HTTP, binary', 'HTTP, binaire'], 't-small');
  s += path('M550 260 C 580 250, 590 210, 614 204', 'dash thin', '');
  return svg(1000, 306, ['Runtime: what computes where', 'Exécution : qui calcule quoi, et où'], s);
};

export function diagram(name, lang) { L = lang; uid = name.length * 100 + (lang === 'fr' ? 50 : 0) + Object.keys(D).indexOf(name) * 1000; return D[name](); }
export const DIAGRAMS = Object.keys(D);
