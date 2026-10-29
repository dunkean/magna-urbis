// Renders the "etapes" chapter (stage-by-stage atlas) in both languages.
//   node docs/scientific/stages.mjs          writes stages-fr.html and stages-en.html
//   node docs/scientific/stages.mjs --check  fails when the written files are stale
// localize.mjs injects these files between the STAGES markers of fr.html / index.html.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docs, labels, groups } from './stages-data.mjs';
const dir = dirname(fileURLToPath(import.meta.url));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The prose is authored with raw & and < only inside intentional markup; escape bare ampersands.
const html = s => s.replace(/&(?![a-z]+;|#\d+;)/g, '&amp;');

/* ---------- SVG diagrams (inline, themed by CSS classes of styles.css) ---------- */
const t = (lang, pair) => (typeof pair === 'string' ? pair : pair[lang === 'fr' ? 1 : 0]);
function lines(lang, label, x, y, anchor = 'middle', lh = 14) {
  const parts = t(lang, label).split('|');
  const y0 = y - ((parts.length - 1) * lh) / 2 + 4;
  return parts.map((p, i) => `<text x="${x}" y="${y0 + i * lh}" text-anchor="${anchor}"${i === 0 && parts.length > 1 ? ' class="b"' : ''}>${esc(p)}</text>`).join('');
}
const box = (lang, x, y, w, h, label, cls = '') => `<rect class="box ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>${lines(lang, label, x + w / 2, y + h / 2)}`;
const arrow = (x1, y1, x2, y2, cls = '', m = 'a') => `<line class="ln ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#${m})"/>`;
const path = (d, cls = '', m = 'a') => `<path class="ln ${cls}" d="${d}" fill="none" marker-end="url(#${m})"/>`;
const defs = id => `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="head"/></marker></defs>`;
const svg = (name, vb, title, body, id) => `<svg class="dg" role="img" aria-labelledby="${id}-t" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><title id="${id}-t">${esc(title)}</title>${defs(id + '-a').replace('id="' + id + '-a"', 'id="' + id + '-a"')}${body.replaceAll('url(#a)', `url(#${id}-a)`)}</svg>`;

const diagrams = {
  pipeline(lang) {
    const B = (x, y, w, h, l, c) => box(lang, x, y, w, h, l, c);
    let s = '';
    s += B(10, 14, 262, 74, ['Procedural|mask · grids · noise · regional cycle|reconstruct · detail · surface · datum · Phasor', 'Procédural|masque · grilles · bruit · cycle régional|reconstruction · détail · surface · niveau · Phasor'], 'proc');
    s += B(10, 104, 262, 62, ['Neural|coarse · base · decoder / amplification', 'Neuronal|grossier · base · décodeur / amplification'], 'neu');
    s += B(10, 182, 262, 52, ['Heightmap / library|fit: resample · scale · datum · crop', 'Carte d’altitude / bibliothèque|ajustement : rééchantillon · échelle · niveau · recadrage'], 'hm');
    s += B(300, 74, 130, 90, ['Retained relief|conditioning · aeolian|coasts', 'Relief conservé|conditionnement · éolien|côtes'], 'core');
    s += path('M272 51 C286 51 286 100 300 108', 'br') + path('M272 135 L300 124', 'br') + path('M272 208 C286 208 286 140 300 134', 'br');
    s += B(458, 74, 118, 90, ['Water & cover|hydrology|climate · forest', 'Eau & couverture|hydrologie|climat · forêt'], 'w');
    s += B(604, 74, 118, 90, ['Settlements|sites · hierarchy|regional roads', 'Établissements|sites · hiérarchie|routes régionales'], 's');
    s += B(750, 74, 120, 90, ['City (per place)|composition · quarters|trim · parcels · programme|buildings · houses', 'Ville (par lieu)|composition · quartiers|élagage · parcelles · programme|bâtiments · maisons'], 'c');
    s += arrow(430, 119, 458, 119) + arrow(576, 119, 604, 119) + arrow(722, 119, 750, 119);
    s += B(300, 250, 570, 44, ['Display (terrain · water · vegetation · roads · buildings · labels) reads every stage, writes none', 'Affichage (terrain · eau · végétation · routes · bâtiments · étiquettes) lit chaque étape, n’en écrit aucune'], 'd');
    for (const x of [365, 517, 663, 810]) s += `<line class="ln dash" x1="${x}" y1="${x === 365 ? 164 : 164}" x2="${x}" y2="250"/>`;
    s += `<text x="10" y="262" class="note">${esc(t(lang, ['Solid arrows: data flow. Dashed: read-only use. Only one source branch runs per map.', 'Flèches pleines : flux de données. Pointillés : lecture seule. Une seule branche de source s’exécute par carte.']))}</text>`;
    s += `<text x="10" y="282" class="note">${esc(t(lang, ['Regional road routing and city stages also read the water obstacle mask.', 'Le routage routier et les étapes de ville lisent aussi le masque d’obstacle d’eau.']))}</text>`;
    return svg('pipeline', '0 0 880 310', t(lang, ['Generation pipeline: relief sources, water and cover, settlements, city, display', 'Chaîne de génération : sources de relief, eau et couverture, établissements, ville, affichage']), s, 'dg1');
  },
  'erosion-cycle'(lang) {
    const B = (x, y, l, c) => box(lang, x, y, 200, 56, l, c);
    let s = '';
    s += B(20, 20, ['1 Uplift|U added to heights', '1 Surrection|U ajoutée aux altitudes']);
    s += B(250, 20, ['2 Basin drainage|Priority-Flood · sills · fill', '2 Drainage des bassins|Priority-Flood · seuils · remplissage']);
    s += B(480, 20, ['3 Accumulation|D-infinity two-way split', '3 Accumulation|répartition D∞ sur deux voisins']);
    s += B(480, 130, ['4 Implicit incision|dh/dt = U − K Aᵐ Sⁿ', '4 Incision implicite|dh/dt = U − K Aᵐ Sⁿ'], 'core');
    s += B(250, 130, ['5 Thermal relaxation|slide beyond talus angle', '5 Relaxation thermique|glissement au-delà du talus']);
    s += B(20, 130, ['6 Diffusion|hillslope smoothing', '6 Diffusion|lissage des versants']);
    s += arrow(220, 48, 250, 48) + arrow(450, 48, 480, 48) + arrow(580, 76, 580, 130) + arrow(480, 158, 450, 158) + arrow(250, 158, 220, 158);
    s += path('M120 130 L120 76', 'loop');
    s += `<text x="132" y="108" class="note">${esc(t(lang, ['× N cycles', '× N cycles']))}</text>`;
    s += B(720, 76, ['Final relaxation|then reconstruction', 'Relaxation finale|puis reconstruction'], 'out').replace('width="200"', 'width="160"');
    s += path('M680 48 C700 48 700 104 720 104', 'br');
    s += `<text x="20" y="226" class="note">${esc(t(lang, ['Steps 2–4 form one dependency chain: incision reads the flow data, so drainage cannot be removed alone. Thermal and diffusion can be switched off separately.', 'Les étapes 2 à 4 forment une chaîne de dépendances : l’incision lit les données d’écoulement, on ne retire donc pas le drainage seul. Thermique et diffusion se désactivent séparément.']))}</text>`;
    return svg('erosion', '0 0 900 240', t(lang, ['Regional erosion cycle: uplift, drainage, accumulation, incision, thermal relaxation, diffusion, repeated N times', 'Cycle d’érosion régional : surrection, drainage, accumulation, incision, relaxation thermique, diffusion, répétés N fois']), s, 'dg2');
  },
  hydrology(lang) {
    const B = (x, y, w, l, c) => box(lang, x, y, w, 70, l, c);
    let s = '';
    s += B(10, 20, 130, ['Retained heights|sea level · climate', 'Altitudes conservées|niveau marin · climat']);
    s += B(160, 20, 150, ['Drainage + flats|Priority-Flood rank|equal-level flats drain', 'Drainage + zones plates|rang Priority-Flood|plats : drainage convergent']);
    s += B(330, 20, 150, ['Depressions|whole spill basins|kept or breached', 'Dépressions|bassins entiers|conservés ou percés']);
    s += B(500, 20, 170, ['Lake budget|r = max(P−ET, 0.02P, 0.5)|spill vs closed', 'Bilan des lacs|r = max(P−ET, 0,02P, 0,5)|débordement ou fermé']);
    s += arrow(140, 55, 160, 55) + arrow(310, 55, 330, 55) + arrow(480, 55, 500, 55);
    s += B(160, 130, 180, ['Drainage graph|nodes · reaches · confluences', 'Graphe de drainage|nœuds · tronçons · confluences'], 'core');
    s += B(370, 130, 170, ['Rivers|width · bed · meanders', 'Rivières|largeur · lit · méandres']);
    s += B(570, 130, 170, ['Riverbed cuts|budgeted carve into terrain', 'Lits creusés|entaille budgétée du terrain'], 'out');
    s += path('M585 90 C585 110 250 110 250 130', 'br') + arrow(340, 165, 370, 165) + arrow(540, 165, 570, 165);
    // small tree sketch
    s += '<g class="tree"><circle cx="800" cy="40" r="5"/><circle cx="780" cy="80" r="4"/><circle cx="830" cy="76" r="4"/><circle cx="800" cy="125" r="5"/><ellipse cx="800" cy="170" rx="34" ry="14" class="lake"/><line x1="800" y1="40" x2="780" y2="80"/><line x1="800" y1="40" x2="830" y2="76"/><line x1="780" y1="80" x2="800" y2="125"/><line x1="830" y1="76" x2="800" y2="125"/><line x1="800" y1="125" x2="800" y2="156"/></g>';
    s += `<text x="800" y="205" text-anchor="middle" class="note">${esc(t(lang, ['sources → confluences → lake → outlet', 'sources → confluences → lac → sortie']))}</text>`;
    s += `<text x="10" y="222" class="note">${esc(t(lang, ['Three distinct quantities: drainage level, physical ground, water surface. The routing obstacle mask is wider than the drawn bank.', 'Trois grandeurs distinctes : niveau de drainage, sol physique, surface d’eau. Le masque d’obstacle de routage est plus large que la berge dessinée.']))}</text>`;
    return svg('hydrology', '0 0 880 235', t(lang, ['Hydrology graph: drainage, depressions, lake budget, river graph and riverbed cuts', 'Graphe hydrologique : drainage, dépressions, bilan des lacs, graphe de rivières et lits creusés']), s, 'dg3');
  },
  roads(lang) {
    let s = '';
    // left: demand graph
    const P = [[40, 150], [120, 60], [210, 130], [290, 50], [320, 160], [180, 200]];
    const E = [[0, 1], [1, 2], [2, 3], [2, 4], [0, 5], [5, 2], [1, 3], [3, 4], [5, 4], [0, 2]];
    const T = new Set(['0-1', '1-2', '2-3', '2-4', '0-5']);
    for (const [a, b] of E) s += `<line class="ln ${T.has(a + '-' + b) ? 'mst' : 'thin'}" x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}"/>`;
    P.forEach(([x, y], i) => { s += `<circle class="pt" cx="${x}" cy="${y}" r="${i === 2 ? 8 : 5}"/>`; });
    s += `<text x="180" y="20" text-anchor="middle" class="b">${esc(t(lang, ['1 Demand graph', '1 Graphe de demande']))}</text>`;
    s += `<text x="180" y="232" text-anchor="middle" class="note">${esc(t(lang, ['Delaunay · bold: spanning tree', 'Delaunay · gras : arbre couvrant']))}</text>`;
    s += `<text x="180" y="246" text-anchor="middle" class="note">${esc(t(lang, ['+ shortcuts where the tree detours', '+ raccourcis si le détour est grand']))}</text>`;
    // middle: 24 moves
    const cx = 540, cy = 130, u = 22;
    const dirs = [];
    for (const [a, b] of [[1, 0], [1, 1], [2, 1], [1, 2], [1, 3], [3, 1]]) for (const sa of [1, -1]) for (const sb of [1, -1]) dirs.push([a * sa, b * sb]);
    const seen = new Set(); const uniq = [];
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], ...dirs]) { const k = d.join(','); if (!seen.has(k)) { seen.add(k); uniq.push(d); } }
    for (const [dx, dy] of uniq) s += `<line class="ln mv${Math.abs(dx) + Math.abs(dy) > 2 ? ' far' : ''}" x1="${cx}" y1="${cy}" x2="${cx + dx * u}" y2="${cy + dy * u}"/>`;
    s += `<circle class="pt" cx="${cx}" cy="${cy}" r="5"/>`;
    s += `<text x="${cx}" y="20" text-anchor="middle" class="b">${esc(t(lang, ['2 Least-cost search', '2 Recherche de moindre coût']))}</text>`;
    s += `<text x="${cx}" y="232" text-anchor="middle" class="note">${esc(t(lang, ['24 moves: 8 neighbours + knight + (1,3)', '24 mouvements : 8 voisins + cavalier + (1,3)']))}</text>`;
    s += `<text x="${cx}" y="246" text-anchor="middle" class="note">${esc(t(lang, ['state = cell + arrival heading (8 sectors)', 'état = cellule + cap d’arrivée (8 secteurs)']))}</text>`;
    // right: cost + merge
    s += box(lang, 700, 36, 180, 64, ['Cost per move|ground + slope + turn²|+ obstacles − road reuse', 'Coût par mouvement|sol + pente + virage²|+ obstacles − réutilisation'], 'core');
    s += box(lang, 700, 120, 180, 50, ['Routed most important first|lesser roads join trunks', 'Routées par importance|les petites rejoignent les grandes']);
    s += box(lang, 700, 190, 180, 50, ['Merged planar network|classes · bridges', 'Réseau planaire fusionné|classes · ponts'], 'out');
    s += arrow(790, 100, 790, 120) + arrow(790, 170, 790, 190);
    s += arrow(360, 130, 495, 130, 'br');
    s += arrow(590, 130, 700, 130, 'br');
    s += `<text x="700" y="20" class="b">${esc(t(lang, ['3 Routing and merge', '3 Routage et fusion']))}</text>`;
    return svg('roads', '0 0 900 260', t(lang, ['Regional roads: Delaunay demand graph, 24-move least-cost search with heading state, merged road network', 'Routes régionales : graphe de demande de Delaunay, recherche de moindre coût à 24 mouvements avec état de cap, réseau routier fusionné']), s, 'dg4');
  },
  city(lang) {
    const B = (x, y, w, l, c) => box(lang, x, y, w, 62, l, c);
    let s = '';
    s += B(10, 14, 150, ['Footprint|land budget · growth', 'Emprise|budget de terre · croissance']);
    s += B(190, 14, 150, ['Macroplan|corridors · harbour · walls', 'Macroplan|couloirs · port · remparts']);
    s += B(370, 14, 150, ['Quarters|street cuts · ribbons', 'Quartiers|coupes de rues · rubans'], 'core');
    s += B(550, 14, 150, ['Blocks|faces between streets', 'Îlots|faces entre les rues']);
    s += B(730, 14, 150, ['Trim|drop unbuilt blocks', 'Élagage|retrait des îlots vides']);
    s += arrow(160, 45, 190, 45) + arrow(340, 45, 370, 45) + arrow(520, 45, 550, 45) + arrow(700, 45, 730, 45);
    s += B(10, 124, 170, ['Parcels|four operators · contacts', 'Parcelles|quatre opérateurs · contacts'], 'core');
    s += B(210, 124, 170, ['Programme|demand · reserve · allocate', 'Programme|demande · réserve · alloue']);
    s += B(410, 124, 170, ['Building sites|neutral intents', 'Sites de bâtiments|intentions neutres']);
    s += B(610, 124, 120, ['Massing|storeys · roofs', 'Volumétrie|étages · toits']);
    s += B(750, 124, 130, ['Houses|native plan · admission', 'Maisons|plan natif · admission'], 'out');
    s += path('M805 76 C805 100 95 96 95 124', 'br');
    s += arrow(180, 155, 210, 155) + arrow(380, 155, 410, 155) + arrow(580, 155, 610, 155) + arrow(730, 155, 750, 155);
    s += path('M295 186 C295 214 805 214 805 188', 'loop');
    s += `<text x="550" y="226" text-anchor="middle" class="note">${esc(t(lang, ['refusals and counted capacity return to the programme', 'refus et capacité comptée reviennent au programme']))}</text>`;
    s += path('M295 124 C295 100 805 100 805 78', 'dash2');
    s += `<text x="10" y="248" class="note">${esc(t(lang, ['Trim runs the programme and cadastre on a copy until a fixed point; a content-addressed memo avoids recomputing identical blocks.', 'L’élagage rejoue programme et cadastre sur une copie jusqu’à un point fixe ; une mémoïsation par contenu évite de recalculer des îlots identiques.']))}</text>`;
    return svg('city', '0 0 890 260', t(lang, ['City generation: footprint, macroplan, quarters, blocks, trim, parcels, programme, building sites, massing, houses', 'Génération de la ville : emprise, macroplan, quartiers, îlots, élagage, parcelles, programme, sites de bâtiments, volumétrie, maisons']), s, 'dg5');
  },
  neural(lang) {
    let s = '';
    s += box(lang, 10, 20, 150, 56, ['Coarse|continental layout', 'Grossier|disposition continentale'], 'neu');
    s += box(lang, 200, 20, 150, 56, ['Base|valleys · ridges', 'Base|vallées · crêtes'], 'neu');
    s += box(lang, 390, 20, 150, 56, ['Decoder|metre-scale heights', 'Décodeur|altitudes au mètre'], 'neu');
    s += box(lang, 580, 20, 150, 56, ['Amplification|Classic · Phasor|Hybrid · MSE', 'Amplification|Classique · Phasor|Hybride · MSE'], 'core');
    s += arrow(160, 48, 200, 48) + arrow(350, 48, 390, 48) + arrow(540, 48, 580, 48);
    s += `<text x="10" y="108" class="note">${esc(t(lang, ['Each stage is conditioned on the previous one and sampled in global tile coordinates with a halo (no seams).', 'Chaque étage est conditionné par le précédent et échantillonné en coordonnées globales de tuiles avec halo (sans couture).']))}</text>`;
    s += `<text x="10" y="126" class="note">${esc(t(lang, ['Amplification adds only a residual to the retained Magna spline; level 0 returns the spline unchanged.', 'L’amplification n’ajoute qu’un résidu à la spline Magna conservée ; le niveau 0 la renvoie inchangée.']))}</text>`;
    return svg('neural', '0 0 760 140', t(lang, ['Neural relief chain: coarse, base, decoder, amplification', 'Chaîne de relief neuronal : grossier, base, décodeur, amplification']), s, 'dg6');
  },
};

const figCaption = {
  pipeline: ['Original diagram, not to scale. The three relief sources converge on one retained surface; every later stage reads it.', 'Schéma original, hors échelle. Les trois sources de relief convergent vers une seule surface conservée ; toutes les étapes suivantes la lisent.'],
  'erosion-cycle': ['Original diagram of one regional evolution cycle (stage relief-regional).', 'Schéma original d’un cycle d’évolution régional (étape relief-regional).'],
  hydrology: ['Original diagram of the hydrology stage; the equations are in the text.', 'Schéma original de l’étape d’hydrologie ; les équations sont dans le texte.'],
  roads: ['Original diagram of regional road construction; cell and move geometry is illustrative.', 'Schéma original de la construction des routes régionales ; la géométrie des cellules et mouvements est illustrative.'],
  city: ['Original diagram of the city chain, quarters to houses.', 'Schéma original de la chaîne de ville, des quartiers aux maisons.'],
  neural: ['Original diagram of the three learned stages and the amplification step.', 'Schéma original des trois étages appris et de l’étape d’amplification.'],
};

/* ---------- HTML ---------- */
function figure(lang, name) {
  return `<figure class="diagram sdiag" id="fig-${name}">${diagrams[name](lang)}<figcaption>${esc(t(lang, figCaption[name]))}</figcaption></figure>`;
}
const text = {
  en: {
    chapter: '19 / Stage by stage', title: 'One section per generation stage.', dataTitle: 'Generation stages',
    intro: 'Each stage listed in the V2 interface has a section here, opened by the “?” beside its row. A section says what the stage computes, the method used in the code, its inputs and outputs, the controls and their effect, when it is available, what it costs, and where to read more. Stage identifiers are stable and listed in the stage registry contract.',
    overview: 'The pipeline',
    overviewP: 'Relief comes from exactly one of three sources, then flows through the shared posterior operators. Water and natural cover, settlements, and the city read the retained surface. Display stages only consume. Optional stages can be switched off in the interface; a required stage has a locked checkbox.',
    index: 'Stage index', repo: 'Code and notes',
    docsLabel: 'Method notes',
  },
  fr: {
    chapter: '19 / Étape par étape', title: 'Une section par étape de génération.', dataTitle: 'Étapes de génération',
    intro: 'Chaque étape listée dans l’interface V2 a ici une section, ouverte par le « ? » à côté de sa ligne. Une section dit ce que l’étape calcule, la méthode utilisée dans le code, ses entrées et sorties, ses réglages et leur effet, quand elle est disponible, ce qu’elle coûte et où lire plus. Les identifiants d’étape sont stables et listés dans le contrat de registre des étapes.',
    overview: 'La chaîne',
    overviewP: 'Le relief provient d’exactement une des trois sources, puis traverse les opérateurs postérieurs communs. Eau et couverture naturelle, établissements et ville lisent la surface conservée. Les étapes d’affichage ne font que consommer. Les étapes facultatives se désactivent dans l’interface ; une étape obligatoire a une case verrouillée.',
    index: 'Index des étapes', repo: 'Code et notes',
    docsLabel: 'Notes de méthode',
  },
};

function stage(lang, g, st) {
  const L = labels[lang], d = st[lang];
  const doc = docs[st.doc];
  const extra = (st.extraDocs ?? []).filter(k => k !== st.doc).map(k => docs[k]);
  const tags = `<span class="tag">${esc(L.whenText[st.when])}</span> <span class="tag ${st.opt ? 'compare' : 'own'}">${esc(st.opt ? L.optional : L.req)}</span>`;
  const links = [doc, ...extra].map(([href, name]) => `<a href="${href}">${name}</a>`).join(' · ');
  const img = st.image ? `<figure class="diagram"><img src="${st.image.src}" width="1200" height="800" loading="lazy" alt="${esc(t(lang, [st.image.alt.en, st.image.alt.fr]))}"><figcaption>${esc(st.image.cap[lang])}</figcaption></figure>` : '';
  return `<section class="stage" id="stage-${st.id}" data-stage="${st.id}">
<h4>${esc(st.name[lang])} <code class="stage-id">${st.id}</code> ${tags}</h4>
${st.diagram ? figure(lang, st.diagram) : ''}
<p><b>${esc(L.what)}.</b> ${html(d.what)}</p>
<p><b>${esc(L.algo)}.</b> ${html(d.algo)}</p>
<p><b>${esc(L.io)}.</b> ${html(d.io)}</p>
<p><b>${esc(L.ctl)}.</b> ${html(d.ctl)}</p>
<p><b>${esc(L.perf)}.</b> ${html(d.perf)}</p>
${d.ref ? `<p><b>${esc(L.ref)}.</b> ${html(d.ref)}</p>` : ''}
${img}<p class="sources">${esc(L.methods)} : ${links}</p>
</section>`;
}

export function render(lang) {
  const x = text[lang];
  const idx = groups.map(g => `<li><a href="#${g.id}">${esc(g.title[lang])}</a><ul class="stage-index">${g.stages.map(s => `<li><a href="#stage-${s.id}">${esc(s.name[lang])}</a></li>`).join('')}</ul></li>`).join('');
  return `<!--STAGES:BEGIN-->
<section class="chapter" id="etapes" data-title="${esc(x.dataTitle)}">
<div class="chapter-number">${esc(x.chapter)}</div><h2>${esc(x.title)}</h2>
<p>${esc(x.intro)}</p>
<h3 id="stages-overview">${esc(x.overview)}</h3>
<p>${esc(x.overviewP)}</p>
${figure(lang, 'pipeline')}
<details class="stage-toc"><summary>${esc(x.index)}</summary><ul>${idx}</ul></details>
${groups.map(g => `<div class="stage-group" id="${g.id}">
<h3>${esc(g.title[lang])}</h3>
<p>${html(g.intro[lang])}</p>
${g.stages.map(s => stage(lang, g, s)).join('\n')}
</div>`).join('\n')}
</section>
<!--STAGES:END-->`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checking = process.argv.includes('--check');
  for (const lang of ['fr', 'en']) {
    const file = resolve(dir, `stages-${lang}.html`), out = render(lang) + '\n';
    if (checking) { if ((await readFile(file, 'utf8').catch(() => '')).split('\r').join('') !== out) throw new Error('Stale ' + file + ': run node docs/scientific/stages.mjs'); }
    else await writeFile(file, out);
  }
  console.log(`Stage chapter ${checking ? 'verified' : 'written'} (${groups.reduce((n, g) => n + g.stages.length, 0)} stages).`);
}
