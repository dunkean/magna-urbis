// Architectural styles catalogue: render(lang) returns { title, description, rail, body } for src/build.mjs.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cultures, summary, REGION_ORDER } from './catalogue-data.mjs';
import { esc } from './shell.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fr = JSON.parse(readFileSync(resolve(here, 'catalogue.fr.json'), 'utf8'));

const UI = {
  en: {
    title: 'Architectural styles · Magna Urbis',
    h1: 'Architectural styles',
    description: 'The 115 cultures of Magna Urbis: street plans, plots, houses and roofs, with a working render of a town or village for each.',
    lead: 'In Magna Urbis a culture is a data sheet. It tells the generator how streets are laid out, how plots are cut, which houses stand on them, which monuments the town builds and what the countryside around it looks like. There are 115 of them, from medieval organic towns to cyberpunk megacities.',
    facts: { total: 'cultures', historical: 'historical', fantasy: 'fantasy and camps', modern: 'modern', future: 'futuristic and alien', farms: 'farm types' },
    howTitle: 'How a style becomes a town',
    detailTitle: 'Reading a house at close range',
    detailIntro: 'Choose Detailed architecture in the roofs menu and zoom in. First follow the building’s outline. Its wings, court, floor heights and main roof come from the generated plan. Then look at an opening or a roof edge. The 3D renderer fits joinery, coverings and selected additions to the surfaces available to that profile.',
    detailExample: 'On a Mongolian ger, follow the felt from the eaves to the timber crown and the ties around the wall. On a Haudenosaunee longhouse, the cover follows a much longer arch with smoke openings and fastening poles. On a myconid dwelling, follow the wavy rims of overlapping caps. Oyster-like fans carry ridges underneath, while a shelf-shaped form has a pale pore surface. A town-scale view retains the larger forms as fine details fade. The culture sheets below give the architectural choices and ranges used across many lots.',
    detailAtlas: 'How geometry, material coordinates and viewing distance interact',
    frontTitle: 'Entrances across the 115 cultures',
    variationTitle: 'Three houses from each of two towns',
    variationPlan: 'All three houses in a row belong to the same generated town. Each parcel supplies its frontage, depth and room for additional volumes. The seed and the site determine the house that fits there. Read the roofline first to see the height of the main body and where a lower wing or a separate roof joins it.',
    variationDetail: 'At the threshold, the Sahel profile sets tapering earthen piers against the two sides of the door. The Venetian profile fits projecting sills to the bottoms of existing windows and stone jambs to their sides. Where there is room above a bay, an arch can rise from its lintel. The seed varies the thickness of the trim. The model measures each opening before fitting the stonework.',
    variationDownload: 'Download the six-house comparison (WebP)',
    variationAlt: 'The Sahel row shows an open roof terrace, a terrace with a raised volume and a flat-roofed dwelling beside three round huts. The Venetian row shows a two-storey house with framed windows, a long low house and a gabled house with a separate annex.',
    variationCaption: 'The Sahel town is above and the Venetian lagoon town below. Both use the town seed “city-river-plain-s”. Each panel shows a different parcel in Detailed architecture, framed to fit the building. These examples illustrate the range of forms in this seed. The camera scale varies between parcels.',
    frontFit: 'In the optional Detailed architecture view, 89 cultures received a dedicated entrance design. The earlier set covers four South Asian profiles, ten dormer profiles and twelve rooftop-room profiles. Seven of those 26 also have a design in the new entrance collection, bringing it to 96 profiles. Examples include the solar canopy and the gnomish mechanical porch. These counts describe design coverage. An individual house needs a suitable opening, façade or roof, clearance from its own other volumes and a close enough camera.',
    frontTraditions: 'Compare how each builder spans the approach. In the Japanese castle town a straight eave shades projecting kōshi latticework. A Haudenosaunee longhouse carries a low bark vestibule on poles. A Māori wharepuni extends its gable and side walls to shelter a porch. These are artistic interpretations of documented building traditions. The museum reconstruction and the Northland painting provide evidence for particular places and periods.',
    frontExamples: 'The Inca profile narrows its stone door jambs toward a single lintel. The Hausa profile builds up a pointed entry in earthen relief. On a contemporary Latin American street, a projecting screen shades the approach. For fantasy dwellings the designers extend the same geometric vocabulary to invented materials and forms, including an elven leaf canopy and a myconid hood with folds running from the stem to its underside.',
    farmDetail: 'At a fungal farm the shaded bay has stacked beds, a layer of dark growing medium and clusters of caps beside a harvesting aisle. The racks refer to indoor mushroom growing. Shelf shapes and wavy cap clusters also draw on fungi observed on wood. The myconid doorway scales those shapes to the size of a building as a fantasy design.',
    frontAlt: 'Top row, a spotted mushroom roof and a cluster of overlapping caps. Bottom row, a timber house and a version with a sheltered entrance at its gable end.',
    frontCaption: 'V2 captures from 25 November 2026. Standard view on the left and Detailed architecture on the right. Above, compare the outline of the single mushroom cap with the rims of the overlapping growths. Below, the ridge and timber side walls extend forward to shelter the recessed entrance of the Māori-profile house.',
    compareAlt: 'Two views of a one-storey stone house with a flat roof. On the right a terracotta canopy on posts shelters the front steps and two masonry seats.',
    compareCaption: 'The same Dravidian-profile house in the standard V2 view (left) and with Detailed architecture (right). The upper volume and parapet appear in both. In the detailed view a tiled thinnai shelters the entrance, and the roof terrace shows a lime finish. The house is isolated with the same camera, lighting and scale in both views.',
    compareSample: 'This village was generated with a target population of 500 and the seed “cabane”. Of its 189 buildings, 40 dwellings received a projecting addition in the detailed view.',
    indiaTitle: 'Four Indian and South Asian profiles',
    indiaHouses: [
      'A tiled entrance porch on timber posts shelters the step into the house.',
      'A deeper thinnai, a raised covered space at the entrance, can carry masonry seats on both sides of the passage.',
      'A jharokha projects an existing upper window on sandstone brackets. A sheltered stone entrance is another possible treatment.',
      'A concrete loggia with a side screen can project from an upper opening. A slab porch is an alternative at ground level.',
    ],
    indiaFit: 'Each eligible main dwelling can receive one projecting frontage feature. A Rajput or metropolitan house may also have a small stair enclosure on a clear flat terrace. Courtyard openings, other masses of the same building and existing rooftop equipment limit where these parts fit. These tests cover the building itself. Checking clearance to a neighbouring parcel requires its boundary.',
    indiaCover: 'The declared cover, roof pitch and building role determine the surface. A stone terrace can show jointed slabs, a plaster terrace a trowelled lime finish. A steep stone roof over a temple or shrine can show dressed courses. Fired clay on a terrace reads as laid tiles, while a pitched roof can carry overlapping potter-made tiles or, in the metropolitan profile, interlocking manufactured tiles. On stone façades the southern profiles use subdued coursing, and the Rajput profile can show sandstone. These choices apply to the individual volume, so a sacred building and a neighbouring house can read differently.',
    indiaSources: 'Priya Joseph’s field examples distinguish the stone slabs at Guluru, lime terrace at Devanahalli and potter-made roof tiles at Sural. They provide regional examples of construction. The renderer assigns them using its own material rules.',
    how1: 'The sheet of a culture is read facet by facet. The street plan and the plots come from its urban recipes, the houses and roofs from its building tradition, the monuments from its programme, the farms and hamlets from its countryside entry. Each facet is consumed by one stage of the town pipeline.',
    how2: 'A hybrid style is a sheet whose facets name different cultures, with weights: an old core, a planned extension, then suburbs can each speak another style.',
    figCap: 'The five facets of a culture sheet and the stages that read them. Hybrid sheets feed the same stages from several cultures.',
    diagram: {
      sheet: 'Culture sheet', facets: [['Streets and plan', 'pattern, walls, gates'], ['Plots', 'frontage, depth, fill'], ['Monuments', 'nucleus, services'], ['Houses and roofs', 'plans, roofs, storeys, palette'], ['Countryside', 'farms, hamlets']],
      stages: [['plan', 'streets, quarters'], ['parcels', 'plots'], ['programme', 'roles per plot'], ['massing', 'volumes'], ['forms', 'house shapes']],
      farms: 'farms and hamlets', farmsSub: 'settlements stage', hybrid: 'Hybrid style sheet', hybridSub: 'each facet takes its own weighted mix of cultures',
    },
    filterLabel: 'Filter styles', filterPlaceholder: 'Name, region, roof, plan', status: '{n} styles', eras: 'Era', routeLabel: 'Regions',
    chips: { all: 'All', historical: 'Historical', fantasy: 'Fantasy and camps', modern: 'Modern', futuristic: 'Futuristic', alien: 'Alien' },
    eraName: { historical: 'Historical', fantasy: 'Fantasy', camp: 'Camp', modern: 'Modern', futuristic: 'Futuristic', alien: 'Alien' },
    group: { europe: 'Europe', africa: 'Africa', mesa: 'Middle East and South Asia', eastasia: 'East and South-East Asia', americas: 'Americas', oceania: 'Oceania', steppe: 'Steppe and North', fantasy: 'Fantasy peoples', modern: 'Modern cities', future: 'Futuristic and alien cities' },
    view2d: '2D', view3d: '3D', viewLabel: 'View', noCapture: 'No capture yet',
    alt2d: n => `${n}: top view of a generated town`,
    alt3d: n => `${n}: three-dimensional view of a generated town`,
    plan: 'Plan', enclosure: 'Enclosure', storeys: 'Storeys', roof: 'Roof',
    details: 'Numbers and details', zone: 'Zone', density: 'People per ha', frontage: 'Frontage (m)', depth: 'Plot depth (m)', coverage: 'Coverage',
    homePlans: 'Home plans', homePlansNote: 'Relative weight of each house plan.', farmTypes: 'Farm types', nucleus: 'Nucleus', fortification: 'Fortification',
    wall: 'Wall material', cover: 'Roof cover', ladder: 'Height ladder', typology: 'Typology', pitch: 'Pitch',
    plateLot: 'core lot', plateNote: id => `Lot, roof and palette of ${id}`,
    scale: 'm', storeysWord: n => `${n} storeys`, noPlan: 'none',
    closeTitle: 'About the captures',
    close: `The captures are working renders generated on 14 November 2026: a town of 10,000 inhabitants by a river for most cultures, a village for the cultures that only build villages (halflings, myconids and a few others). Render styles and seasons vary from one culture to the next. They are not curated art.`,
    zones: { core: 'Core', middle: 'Middle ring', faubourg: 'Suburb', village: 'Village' },
    pattern: { organic: 'organic', grid: 'grid', radial: 'radial', linear: 'linear', terraces: 'terraced', dispersed: 'dispersed' },
    enc: { organic: 'irregular', rect: 'rectangular', circle: 'circular', square: 'square', oval: 'oval', 'rounded-rect': 'rounded rectangle', terraces: 'terraced', none: 'none' },
    fort: { none: 'none', wall: 'wall', palisade: 'palisade', hedge: 'hedge', auto: 'chosen by town size' },
    roofs: { gable: 'gable', hip: 'hip', shed: 'single slope', pyramid: 'pyramid', cone: 'cone', tent: 'tent', dome: 'dome', barrel: 'barrel vault', flat: 'flat' },
    nuc: { market: 'market', precinct: 'sacred precinct', mosque: 'mosque', castle: 'castle', temple: 'temple', clocktower: 'clock tower', 'drum-tower': 'drum tower', forum: 'forum', grove: 'sacred grove', mortuary: 'mortuary temple', ushnu: 'ushnu platform', maidan: 'maidan', 'mud-mosque': 'mud-brick mosque', 'wizard-tower': 'wizard’s tower', 'royal-enclosure': 'royal enclosure', none: 'none' },
    plans: { bar: 'bar', ell: 'L-shape', tee: 'T-shape', court: 'courtyard', cross: 'cross', aitch: 'H-shape' },
    fixedFootnote: '',
  },
  fr: {
    title: 'Styles architecturaux · Magna Urbis',
    h1: 'Styles architecturaux',
    description: 'Les 115 cultures de Magna Urbis : plans de rues, parcelles, maisons et toits, avec une capture de travail d’une ville ou d’un village pour chacune.',
    lead: 'Dans Magna Urbis, une culture est une fiche de données. Elle dit au générateur comment les rues s’organisent, comment les parcelles sont découpées, quelles maisons s’y dressent, quels monuments la ville construit et à quoi ressemble la campagne autour. Il y en a 115, des villes médiévales organiques aux mégapoles cyberpunk.',
    facts: { total: 'cultures', historical: 'historiques', fantasy: 'fantasy et camps', modern: 'modernes', future: 'futuristes et aliens', farms: 'types de fermes' },
    howTitle: 'Comment un style devient une ville',
    detailTitle: 'Observer une maison de près',
    detailIntro: 'Choisissez Architecture détaillée dans le menu des toits et rapprochez la caméra. Suivez d’abord le contour du bâtiment. Ses ailes, sa cour, les hauteurs des niveaux et le toit principal viennent du plan généré. Observez ensuite une ouverture ou un bord de toit. Le rendu 3D ajuste les menuiseries, les couvertures et certains ouvrages aux surfaces disponibles pour ce profil.',
    detailExample: 'Sur une yourte mongole, suivez le feutre de l’égout à la couronne de bois, puis les liens autour de la paroi. Sur une maison longue haudenosaunee, la couverture épouse une voûte allongée, percée pour la fumée et maintenue par des perches. Sur une habitation myconide, suivez le bord ondulé des chapeaux superposés. La forme en éventail inspirée du pleurote présente des lamelles sous le chapeau, la forme en console une surface poreuse claire. À l’échelle de la ville, les grandes formes restent lisibles quand ces détails disparaissent. Les fiches ci-dessous donnent les choix architecturaux et les fourchettes employés sur l’ensemble des lots.',
    detailAtlas: 'Géométrie, coordonnées de texture et distance de vue',
    frontTitle: 'Le seuil dans les 115 cultures',
    variationTitle: 'Trois maisons par ville',
    variationPlan: 'Les trois maisons d’une rangée appartiennent à la même ville générée. Chaque parcelle fournit une largeur sur rue, une profondeur et de la place pour d’éventuels volumes annexes. La graine et le terrain déterminent la maison qui s’y loge. Suivez d’abord la ligne des toits pour repérer la hauteur du corps principal et la jonction avec une aile plus basse ou un toit indépendant.',
    variationDetail: 'Au seuil, le profil sahélien adosse des piédroits de terre effilés aux deux côtés de la porte. La modénature vénitienne se lit dans les appuis saillants au bas des fenêtres et les montants en pierre le long des baies existantes. Si le dégagement le permet, un arc s’élève au-dessus du linteau. La graine fait varier l’épaisseur des encadrements. Le modèle mesure chaque ouverture avant d’y ajuster la pierre.',
    variationDownload: 'Télécharger la planche des six maisons (WebP)',
    variationAlt: 'En haut, une terrasse dégagée, une terrasse avec édicule et une maison à toit plat accompagnée de trois cases rondes. En bas, une maison à étage et baies encadrées, un long bâtiment bas et une maison à pignon et annexe séparée.',
    variationCaption: 'La ville sahélienne figure en haut, la ville de lagune vénitienne en bas. Toutes deux utilisent la graine de génération « city-river-plain-s ». Chaque vue montre une parcelle différente en mode Architecture détaillée, avec un cadrage adapté au bâtiment. Ces exemples illustrent la diversité des formes obtenues avec cette graine. L’échelle de la caméra varie d’une parcelle à l’autre.',
    frontFit: 'Dans le mode facultatif Architecture détaillée, 89 cultures ont reçu un modèle d’entrée propre à leurs habitations. Les systèmes précédents couvrent quatre profils sud-asiatiques, dix à lucarne et douze à édicule de toiture. Sept de ces 26 profils comptent également un modèle dans le nouveau répertoire des entrées, qui couvre ainsi 96 profils. L’auvent solaire et le porche mécanique gnome en sont deux exemples. Ces nombres décrivent le répertoire disponible. Sur une maison donnée, il faut une baie, une façade ou un toit adapté, un dégagement entre les volumes du bâtiment et une vue assez rapprochée.',
    frontTraditions: 'Observez comment chaque charpente abrite le passage. Dans la ville-château japonaise, un avant-toit droit ombrage les treillis kōshi en saillie. Une maison longue haudenosaunee porte un vestibule bas en écorce sur des perches. Le wharepuni māori prolonge son toit à deux pans et ses murs latéraux pour abriter un porche. Ces interprétations artistiques s’appuient sur des traditions documentées. La reconstitution du musée et le tableau du Northland témoignent de lieux et d’époques précis.',
    frontExamples: 'Dans le profil inca, les jambages en pierre se resserrent sous un linteau monolithe. Le profil haoussa modèle un arc brisé et des reliefs dans la terre. Sur une rue latino-américaine contemporaine, un brise-soleil en saillie ombrage le passage. Pour les habitations imaginaires, les dessinateurs emploient aussi des formes inventées, comme un auvent de feuilles elfique ou un porche myconide dont les plis remontent du pied vers la face inférieure du chapeau.',
    farmDetail: 'Dans une ferme à champignons, la travée ombragée abrite des lits de culture superposés, une couche de substrat sombre et des bouquets de champignons au bord de l’allée de récolte. Les étagères s’inspirent des champignonnières. Les consoles et les bouquets de chapeaux ondulés rappellent aussi des champignons observés sur le bois. La porte myconide transpose ces formes à l’échelle d’un édifice imaginaire.',
    frontAlt: 'En haut, un toit en forme de champignon tacheté puis un bouquet de chapeaux superposés. En bas, une maison en bois puis une version dont l’entrée est abritée en pignon.',
    frontCaption: 'Captures V2 du 25 novembre 2026. Vue standard à gauche, Architecture détaillée à droite. En haut, comparez le contour du chapeau unique aux rebords des chapeaux superposés. En bas, le faîtage et les parois latérales en bois se prolongent pour abriter l’entrée en retrait de la maison du profil māori.',
    compareAlt: 'Deux vues d’une maison en pierre de plain-pied à toit plat. À droite, un auvent de tuiles sur poteaux abrite les marches d’entrée et deux banquettes maçonnées.',
    compareCaption: 'La même maison du profil dravidien en vue V2 standard (à gauche) et avec Architecture détaillée (à droite). Le volume supérieur et l’acrotère apparaissent dans les deux vues. En mode détaillé, un thinnai couvert de tuiles abrite l’entrée et la terrasse présente un enduit à la chaux. La maison est isolée avec la même caméra, le même éclairage et la même échelle.',
    compareSample: 'Ce village a été généré avec une population cible de 500 et la graine « cabane ». Sur ses 189 bâtiments, 40 habitations ont reçu une avancée en mode détaillé.',
    indiaTitle: 'Quatre profils indiens et sud-asiatiques',
    indiaHouses: [
      'Un porche couvert de tuiles, sur des poteaux en bois, abrite le perron de la maison.',
      'Un thinnai plus profond, espace surélevé et couvert à l’entrée, peut accueillir des sièges maçonnés de part et d’autre du passage.',
      'Un jharokha prolonge en saillie une fenêtre d’étage, sur des consoles en grès. Un perron abrité en pierre est une autre possibilité.',
      'Une loggia en béton à écran latéral peut prolonger une baie à l’étage. Une dalle abritant le porche est une variante au rez-de-chaussée.',
    ],
    indiaFit: 'Sur un corps de logis qui s’y prête, le rendu peut ajouter une avancée en façade. Une maison rajpoute ou métropolitaine peut aussi recevoir un petit édicule d’escalier sur une terrasse plate dégagée. Les vides de cour, les autres volumes du bâtiment et les équipements déjà présents en toiture limitent les emplacements possibles. Ces tests portent sur le bâtiment lui-même. Vérifier le recul par rapport à une parcelle voisine demanderait sa limite.',
    indiaCover: 'La couverture déclarée, la pente et la fonction de l’édifice déterminent la finition. Une terrasse en pierre peut montrer des dalles jointives, une terrasse enduite une chaux talochée. Sur un sanctuaire ou un temple, un pan raide en pierre peut recevoir des assises taillées. La terre cuite se présente en carreaux sur une terrasse, en tuiles canal de potier sur certains versants historiques et en tuiles industrielles à emboîtement dans le profil métropolitain. Sur les façades de pierre, les profils du sud présentent des assises discrètes et le profil rajput peut montrer du grès. Le choix se fait volume par volume, jusque sur deux édifices voisins.',
    indiaSources: 'Les exemples de terrain de Priya Joseph distinguent les dalles de Guluru, la terrasse à la chaux de Devanahalli et les tuiles de potier de Sural. Ils documentent des constructions régionales. Le rendu emploie ses propres règles pour les attribuer.',
    how1: 'La fiche d’une culture se lit facette par facette. Le plan des rues et les parcelles viennent de ses recettes urbaines, les maisons et les toits de sa tradition de bâti, les monuments de son programme, les fermes et les hameaux de son entrée campagne. Chaque facette est consommée par une étape du pipeline de la ville.',
    how2: 'Un style hybride est une fiche dont les facettes désignent des cultures différentes, avec des poids : un vieux cœur, une extension planifiée, puis des faubourgs peuvent chacun parler un autre style.',
    figCap: 'Les cinq facettes d’une fiche de culture et les étapes qui les lisent. Les fiches hybrides alimentent les mêmes étapes depuis plusieurs cultures.',
    diagram: {
      sheet: 'Fiche de culture', facets: [['Rues et plan', 'trame, enceinte'], ['Parcelles', 'façade, profondeur'], ['Monuments', 'noyau, services'], ['Maisons et toits', 'plans, toits, niveaux, palette'], ['Campagne', 'fermes, hameaux']],
      stages: [['plan', 'rues, quartiers'], ['parcelles', 'lots'], ['programme', 'rôles par lot'], ['volumes', 'masses bâties'], ['formes', 'formes des maisons']],
      farms: 'fermes et hameaux', farmsSub: 'étape établissements', hybrid: 'Fiche de style hybride', hybridSub: 'chaque facette prend son propre mélange pondéré de cultures',
    },
    filterLabel: 'Filtrer les styles', filterPlaceholder: 'Nom, région, toit, plan', status: '{n} styles', eras: 'Époque', routeLabel: 'Régions',
    chips: { all: 'Tous', historical: 'Historiques', fantasy: 'Fantasy et camps', modern: 'Modernes', futuristic: 'Futuristes', alien: 'Aliens' },
    eraName: { historical: 'Historique', fantasy: 'Fantasy', camp: 'Campement', modern: 'Moderne', futuristic: 'Futuriste', alien: 'Alien' },
    group: { europe: 'Europe', africa: 'Afrique', mesa: 'Moyen-Orient et Asie du Sud', eastasia: 'Asie de l’Est et du Sud-Est', americas: 'Amériques', oceania: 'Océanie', steppe: 'Steppe et Nord', fantasy: 'Peuples fantasy', modern: 'Villes modernes', future: 'Villes futuristes et aliens' },
    view2d: '2D', view3d: '3D', viewLabel: 'Vue', noCapture: 'Pas encore de capture',
    alt2d: n => `${n} : vue de dessus d’une ville générée`,
    alt3d: n => `${n} : vue en trois dimensions d’une ville générée`,
    plan: 'Plan', enclosure: 'Enceinte', storeys: 'Niveaux', roof: 'Toit',
    details: 'Chiffres et détails', zone: 'Zone', density: 'Hab. par ha', frontage: 'Façade (m)', depth: 'Profondeur (m)', coverage: 'Emprise',
    homePlans: 'Plans de maison', homePlansNote: 'Poids relatif de chaque plan de maison.', farmTypes: 'Types de fermes', nucleus: 'Noyau', fortification: 'Fortification',
    wall: 'Matériau des murs', cover: 'Couverture', ladder: 'Échelle de hauteur', typology: 'Typologie', pitch: 'Pente',
    plateLot: 'lot du centre', plateNote: id => `Lot, toit et palette de ${id}`,
    scale: 'm', storeysWord: n => `${n} niveaux`, noPlan: 'aucune',
    closeTitle: 'À propos des captures',
    close: `Les captures sont des rendus de travail générés le 14 novembre 2026 : une ville de 10 000 habitants au bord d’un fleuve pour la plupart des cultures, un village pour celles qui ne bâtissent que des villages (halfelins, myconides et quelques autres). Le style de rendu et la saison varient d’une culture à l’autre. Ce ne sont pas des images retouchées.`,
    zones: { core: 'Centre', middle: 'Couronne', faubourg: 'Faubourg', village: 'Village' },
    pattern: { organic: 'organique', grid: 'damier', radial: 'radial', linear: 'linéaire', terraces: 'en terrasses', dispersed: 'dispersé' },
    enc: { organic: 'irrégulière', rect: 'rectangulaire', circle: 'circulaire', square: 'carrée', oval: 'ovale', 'rounded-rect': 'rectangle arrondi', terraces: 'en terrasses', none: 'aucune' },
    fort: { none: 'aucune', wall: 'mur', palisade: 'palissade', hedge: 'haie', auto: 'selon la taille de la ville' },
    roofs: { gable: 'à pignon', hip: 'en croupe', shed: 'à une pente', pyramid: 'pyramidal', cone: 'conique', tent: 'en tente', dome: 'en dôme', barrel: 'en berceau', flat: 'plat' },
    nuc: { market: 'marché', precinct: 'enceinte sacrée', mosque: 'mosquée', castle: 'château', temple: 'temple', clocktower: 'tour d’horloge', 'drum-tower': 'tour du tambour', forum: 'forum', grove: 'bois sacré', mortuary: 'temple funéraire', ushnu: 'plate-forme ushnu', maidan: 'maïdan', 'mud-mosque': 'mosquée de terre', 'wizard-tower': 'tour de mage', 'royal-enclosure': 'enceinte royale', none: 'aucun' },
    plans: { bar: 'barre', ell: 'en L', tee: 'en T', court: 'à cour', cross: 'en croix', aitch: 'en H' },
  },
};

const num = v => (Math.round(v * 10) / 10).toString();
const range = r => (r == null ? '–' : Array.isArray(r) ? (r[0] === r[1] ? num(r[0]) : `${num(r[0])}–${num(r[1])}`) : num(r));
const mid = r => (Array.isArray(r) ? (r[0] + r[1]) / 2 : r);
const pct = (r, lang) => (r == null ? '–' : (Array.isArray(r) ? `${Math.round(r[0] * 100)}–${Math.round(r[1] * 100)}` : `${Math.round(r * 100)}`) + (lang === 'fr' ? ' %' : '%'));

/* ---------- the "how a style becomes a town" diagram ---------- */
function diagram(t) {
  const d = t.diagram;
  const cols = [20, 184, 348, 512, 676]; // stage x, width 140
  const W = 140;
  let s = `<svg class="dg" viewBox="0 0 1000 300" role="img" aria-labelledby="dg-how-t"><title id="dg-how-t">${esc(t.figCap)}</title>
<defs><marker id="dg-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9z" class="head"/></marker></defs>
<text x="20" y="18" class="t-note">${esc(d.sheet)}</text>`;
  // facets row: streets over plan, plots over parcels, monuments over programme, houses spanning massing and forms, countryside over farms box
  const fx = [[20, 140], [184, 140], [348, 140], [512, 304], [840, 140]];
  d.facets.forEach(([head, sub], i) => {
    const [x, w] = fx[i], cls = ['relief', 'town', 'ochre', 'moss', 'water'][i];
    s += `<rect class="bx ${cls}" x="${x}" y="28" width="${w}" height="50" rx="6"/><text class="t-head" x="${x + 10}" y="49">${esc(head)}</text><text class="t-small" x="${x + 10}" y="66">${esc(sub)}</text>`;
  });
  // arrows facets -> stages
  const arrow = (x, y1, y2) => `<path class="ln" d="M${x} ${y1}V${y2}" marker-end="url(#dg-ah)"/>`;
  [90, 254, 418, 582, 746].forEach((x, i) => { s += arrow(x, 78, 118); });
  s += arrow(910, 78, 118);
  // stage row
  d.stages.forEach(([head, sub], i) => {
    s += `<rect class="bx" x="${cols[i]}" y="120" width="${W}" height="58" rx="6"/><text class="t-head" x="${cols[i] + 10}" y="145">${esc(head)}</text><text class="t-small" x="${cols[i] + 10}" y="163">${esc(sub)}</text>`;
    if (i < 4) s += `<path class="ln thick" d="M${cols[i] + W + 2} 149H${cols[i + 1] - 4}" marker-end="url(#dg-ah)"/>`;
  });
  s += `<rect class="bx water ghost" x="840" y="120" width="140" height="58" rx="6"/><text class="t-head" x="850" y="145">${esc(d.farms)}</text><text class="t-small" x="850" y="163">${esc(d.farmsSub)}</text>`;
  // hybrid bar
  s += `<rect class="bx ochre ghost" x="20" y="226" width="960" height="52" rx="6"/><text class="t-head" x="34" y="248">${esc(d.hybrid)}</text><text class="t-small" x="34" y="266">${esc(d.hybridSub)}</text>`;
  [90, 254, 418, 582, 746, 910].forEach(x => { s += `<path class="ln ochre dash" d="M${x} 226V182" marker-end="url(#dg-ah)"/>`; });
  return s + '</svg>';
}

/* ---------- card plate: lot strip, roof profile, palette ---------- */
function plate(c, t) {
  const core = c.zones.find(z => z.zone === 'core') || c.zones[0] || {};
  const f = mid(core.frontage) || 8, dep = mid(core.plotDepth) || 24, cov = mid(core.coverage) || 0.7;
  const s = Math.min(86 / dep, 138 / (3 * f));
  const lw = f * s, lh = dep * s, x0 = 8, y0 = 16;
  let z = `<svg class="dg culture-plate" viewBox="0 0 320 124" role="img" aria-label="${esc(t.plateNote(c.label))}">`;
  z += `<rect class="band" x="${x0}" y="8" width="${(3 * lw).toFixed(1)}" height="5"/>`;
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * lw, k = Math.sqrt(Math.min(cov, 1));
    const bw = lw * k, bh = lh * k;
    z += `<rect class="bx" x="${x.toFixed(1)}" y="${y0}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}"/>`;
    z += `<rect class="f-town-soft s-ink" style="stroke-width:.8" x="${(x + (lw - bw) / 2).toFixed(1)}" y="${y0 + 1}" width="${bw.toFixed(1)}" height="${Math.max(1, bh - 1).toFixed(1)}"/>`;
  }
  // scale bar
  const L = [5, 10, 20, 50, 100].find(v => v * s >= 22) || 100;
  z += `<path class="ln" d="M${x0} 114h${(L * s).toFixed(1)}M${x0} 111v6M${(x0 + L * s).toFixed(1)} 111v6"/><text class="t-mono" x="${(x0 + L * s + 5).toFixed(1)}" y="117">${L} ${t.scale} · ${range(core.frontage)}×${range(core.plotDepth)}</text>`;
  // roof profile
  const tr = c.tradition, hi = tr.storeys[1], lo = tr.storeys[0];
  const kind = tr.roof, round = ['cone', 'tent', 'dome'].includes(kind) || tr.form;
  const W = kind === 'barrel' ? 14 : round ? 7 : 10;
  const storeyH = 3;
  const rise = (() => {
    if (kind === 'flat') return 0.5;
    if (kind === 'dome') return W / 2;
    if (kind === 'barrel') return W / 4;
    if (kind === 'shed') return Math.min(W * 0.35, W * Math.tan(Math.min(tr.pitch, 35) * Math.PI / 180));
    return Math.min(W * 0.9, (W / 2) * Math.tan(Math.min(tr.pitch || 30, 70) * Math.PI / 180) * (kind === 'hip' ? 1 : 1));
  })();
  const sc = Math.min(5, 84 / (hi * storeyH + rise));
  const cx = 205, gy = 104, bw = W * sc, bh = hi * storeyH * sc, top = gy - bh, rh = rise * sc;
  z += `<path class="ln thin" d="M168 ${gy}H258"/>`;
  z += `<rect class="bx${lo < hi ? '' : ''}" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"/>`;
  if (lo < hi) z += `<rect class="bx ghost" x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${((hi - lo) * storeyH * sc).toFixed(1)}"/>`;
  if (storeyH * sc >= 4) for (let k = 1; k < hi; k++) z += `<path class="ln thin" d="M${(cx - bw / 2).toFixed(1)} ${(gy - k * storeyH * sc).toFixed(1)}h${bw.toFixed(1)}"/>`;
  const l = cx - bw / 2, r = cx + bw / 2, yb = top;
  let roof;
  if (kind === 'flat') roof = `<rect x="${l.toFixed(1)}" y="${(yb - rh).toFixed(1)}" width="${bw.toFixed(1)}" height="${rh.toFixed(1)}"/>`;
  else if (kind === 'dome') roof = `<path d="M${l.toFixed(1)} ${yb.toFixed(1)}A${(bw / 2).toFixed(1)} ${rh.toFixed(1)} 0 0 1 ${r.toFixed(1)} ${yb.toFixed(1)}z"/>`;
  else if (kind === 'barrel') roof = `<path d="M${l.toFixed(1)} ${yb.toFixed(1)}Q${cx} ${(yb - rh * 2).toFixed(1)} ${r.toFixed(1)} ${yb.toFixed(1)}z"/>`;
  else if (kind === 'shed') roof = `<path d="M${l.toFixed(1)} ${yb.toFixed(1)}L${r.toFixed(1)} ${(yb - rh).toFixed(1)}V${yb.toFixed(1)}z"/>`;
  else if (kind === 'hip') roof = `<path d="M${(l - 1).toFixed(1)} ${yb.toFixed(1)}L${(cx - bw * 0.22).toFixed(1)} ${(yb - rh).toFixed(1)}H${(cx + bw * 0.22).toFixed(1)}L${(r + 1).toFixed(1)} ${yb.toFixed(1)}z"/>`;
  else roof = `<path d="M${(l - 1).toFixed(1)} ${yb.toFixed(1)}L${cx} ${(yb - rh).toFixed(1)}L${(r + 1).toFixed(1)} ${yb.toFixed(1)}z"/>`;
  z += `<g class="f-relief" style="fill-opacity:.85">${roof}</g>`;
  z += `<text class="t-mono" x="${cx}" y="117" text-anchor="middle">${lo === hi ? lo : lo + '–' + hi} ×</text>`;
  // palette swatches
  c.palette.forEach((hex, i) => { z += `<rect x="${274 + (i % 2) * 20}" y="${22 + Math.floor(i / 2) * 20}" width="16" height="16" rx="2" fill="${esc(hex)}" stroke="currentColor" stroke-opacity=".25"/>`; });
  return z + '</svg>';
}

/* ---------- card ---------- */
function card(c, t, lang) {
  const name = lang === 'fr' ? fr[c.id].label : c.label;
  const desc = lang === 'fr' ? fr[c.id].description : c.description;
  const eraData = c.era === 'camp' ? 'fantasy' : c.era;
  const roofName = t.roofs[c.tradition.roof] || c.tradition.roof;
  const st = c.tradition.storeys, storeys = st[0] === st[1] ? st[0] : `${st[0]}–${st[1]}`;
  const search = [name, c.id, t.group[c.region], t.eraName[c.era], t.pattern[c.pattern], roofName, c.tradition.roof, t.enc[c.enclosure], c.pattern].join(' ');
  const media = c.image
    ? `<div class="culture-media"><img class="img-2d" src="assets/cultures/${c.id}-2d.webp" width="720" height="514" loading="lazy" alt="${esc(t.alt2d(name))}"><img class="img-3d" src="assets/cultures/${c.id}-3d.webp" width="720" height="514" loading="lazy" alt="${esc(t.alt3d(name))}"><div class="view-toggle" role="group" aria-label="${t.viewLabel}"><button type="button" data-view="2d" aria-pressed="true">${t.view2d}</button><button type="button" data-view="3d" aria-pressed="false">${t.view3d}</button></div></div>`
    : '';
  const zoneRows = c.zones.map(z => `<tr><th scope="row">${t.zones[z.zone]}</th><td class="num">${z.density ?? '–'}</td><td class="num">${range(z.frontage)}</td><td class="num">${range(z.plotDepth)}</td><td class="num">${pct(z.coverage, lang)}</td></tr>`).join('');
  const maxW = Math.max(...c.homePlans.map(p => p.weight), 1);
  const plans = c.homePlans.map(p => `<li><span>${t.plans[p.plan] || p.plan}</span><i style="--w:${Math.round(p.weight / maxW * 100)}%"></i></li>`).join('');
  const tr = c.tradition;
  const extra = [
    [t.nucleus, t.nuc[c.nucleus] || c.nucleus], [t.fortification, t.fort[c.fortification] || c.fortification],
    [t.pitch, tr.pitch ? tr.pitch + '°' : null], [t.wall, tr.wall], [t.cover, tr.cover], [t.ladder, c.heightLadder],
  ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  return `<article class="culture" id="${c.id}" data-era="${eraData}" data-search="${esc(search)}">
${media}<div class="culture-body">
<h3>${esc(name)}</h3>
<p class="culture-meta"><code>${c.id}</code><span class="chip era-${c.era}">${t.eraName[c.era]}</span>${c.image ? '' : `<span class="chip">${t.noCapture}</span>`}</p>
<p class="culture-desc">${esc(desc)}</p>
<dl class="culture-facts"><div><dt>${t.plan}</dt><dd>${t.pattern[c.pattern] || c.pattern}</dd></div><div><dt>${t.enclosure}</dt><dd>${t.enc[c.enclosure] || c.enclosure}</dd></div><div><dt>${t.storeys}</dt><dd>${storeys}</dd></div><div><dt>${t.roof}</dt><dd>${roofName}</dd></div></dl>
${plate(c, t)}
<details class="culture-more"><summary>${t.details}</summary>
<div class="table-wrap"><table><thead><tr><th>${t.zone}</th><th class="num">${t.density}</th><th class="num">${t.frontage}</th><th class="num">${t.depth}</th><th class="num">${t.coverage}</th></tr></thead><tbody>${zoneRows}</tbody></table></div>
<h4>${t.homePlans}</h4><ul class="plan-bars" aria-label="${esc(t.homePlansNote)}">${plans}</ul>
<dl class="culture-extra">${extra}<div><dt>${t.farmTypes}</dt><dd>${c.farmTypes.map(f => `<code>${f}</code>`).join(' ')}</dd></div></dl>
</details>
</div></article>`;
}

export async function render(lang) {
  const t = UI[lang];
  const groups = REGION_ORDER.map(key => ({ key, items: cultures.filter(c => c.region === key) })).filter(g => g.items.length);
  const sections = groups.map(g => `<section class="chapter culture-group" id="g-${g.key}" data-group aria-labelledby="h-${g.key}">
<div class="group-head"><h2 id="h-${g.key}">${t.group[g.key]}</h2><span class="group-count">${g.items.length}</span></div>
<div class="culture-grid">
${g.items.map(c => card(c, t, lang)).join('\n')}
</div></section>`).join('\n');
  const f = t.facts;
  const body = `<header class="hero">
<h1>${t.h1}</h1>
<p class="lead">${t.lead}</p>
<div class="facts facts-six"><div><b>${summary.total}</b><span>${f.total}</span></div><div><b>${summary.historical}</b><span>${f.historical}</span></div><div><b>${summary.fantasyAndCamps}</b><span>${f.fantasy}</span></div><div><b>${summary.modern}</b><span>${f.modern}</span></div><div><b>${summary.futuristicAndAlien}</b><span>${f.future}</span></div><div><b>${summary.farmTypes}</b><span>${f.farms}</span></div></div>
</header>
<section class="chapter cat-how" id="how" aria-labelledby="h-how">
<h2 id="h-how">${t.howTitle}</h2>
<div class="prose"><p>${t.how1}</p><p>${t.how2}</p></div>
<figure class="section-figure wide"><div class="plate">${diagram(t)}</div><figcaption>${t.figCap}</figcaption></figure>
</section>
<section class="chapter" id="architecture-detail" aria-labelledby="h-detail">
<h2 id="h-detail">${t.detailTitle}</h2>
<div class="prose"><p>${t.detailIntro}</p><p>${t.detailExample}</p></div>
<div class="prose"><h3 id="culture-frontages">${t.frontTitle}</h3><p>${t.frontFit}</p><p>${t.frontTraditions} <a href="https://plus.kyoto.travel/entry/kyomachiya">Kyoto City Tourism Association</a> · <a href="https://nysm.nysed.gov/mohawk-haudenosaunee-iroquois-longhouse">New York State Museum</a> · <a href="https://teara.govt.nz/en/artwork/45733/wharepuni-northland">Te Ara, Wharepuni, Northland</a></p><p>${t.frontExamples}</p><p>${t.farmDetail} <a href="https://www.americanmushroom.org/press-room/more-about-mushroom-sustainability/">American Mushroom Institute</a> · <a href="https://www.nps.gov/muwo/learn/nature/decomposing-fungi.htm">Muir Woods National Monument</a></p></div>
<figure class="section-figure wide"><img src="assets/atlas/culture-frontages.webp" width="1448" height="908" loading="lazy" alt="${esc(t.frontAlt)}"><figcaption>${t.frontCaption}</figcaption></figure>
<div class="prose"><h3 id="house-variants">${t.variationTitle}</h3><p>${t.variationPlan}</p><p>${t.variationDetail}</p></div>
<figure class="section-figure wide"><img src="assets/atlas/house-variants.webp" width="2320" height="968" loading="lazy" alt="${esc(t.variationAlt)}"><figcaption>${t.variationCaption} <a href="assets/atlas/house-variants.webp" download>${t.variationDownload}</a></figcaption></figure>
<figure class="section-figure wide" id="architecture-compare"><img src="assets/atlas/architecture-detail.webp" width="1132" height="397" loading="lazy" alt="${esc(t.compareAlt)}"><figcaption>${t.compareCaption} ${t.compareSample}</figcaption></figure>
<div class="prose"><h3>${t.indiaTitle}</h3>
<dl class="glossary">${['indian-temple','dravidian-temple','rajput-fort','south-asian-metropolis'].map((id, i) => `<dt><a href="#${id}">${esc(lang === 'fr' ? fr[id].label : cultures.find(c => c.id === id).label)}</a></dt><dd>${t.indiaHouses[i]}</dd>`).join('')}</dl>
<p>${t.indiaFit}</p><p>${t.indiaCover}</p>
<p>${t.indiaSources} <a href="https://www.sahapedia.org/native-roofing-systems-of-south-india-processes-and-material-heritage" lang="en">Native Roofing Systems of South India</a></p>
<p><a href="${lang === 'fr' ? 'fr.html' : 'index.html'}#architecture-detail">${t.detailAtlas}</a></p></div>
</section>
${sections}
<section class="chapter cat-close" id="captures"><h2>${t.closeTitle}</h2><div class="prose"><p>${t.close}</p></div></section>`;
  const chip = (k, pressed) => `<button type="button" class="chip" data-era-chip="${k}" aria-pressed="${pressed}">${t.chips[k]}</button>`;
  const rail = `<div class="filter">
<label for="culture-filter">${t.filterLabel}</label>
<input id="culture-filter" type="search" data-filter=".culture" placeholder="${esc(t.filterPlaceholder)}" autocomplete="off">
<p class="filter-status" id="filter-status" data-template="${t.status}" aria-live="polite"></p>
<div class="chips era-chips" role="group" aria-label="${t.eras}">${['all', 'historical', 'fantasy', 'modern', 'futuristic', 'alien'].map((k, i) => chip(k, i === 0)).join('')}</div>
</div>
<nav aria-label="${t.routeLabel}" class="cat-route"><ol class="route">
<li><a href="#how">${t.howTitle}</a></li>
<li><a href="#architecture-detail">${t.detailTitle}</a></li>
${groups.map(g => `<li><a href="#g-${g.key}">${t.group[g.key]}</a></li>`).join('\n')}
<li><a href="#captures">${t.closeTitle}</a></li>
</ol></nav>`;
  return { title: t.title, description: t.description, rail, body };
}
