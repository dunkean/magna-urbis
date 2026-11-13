/** Names of the city roles (building roles, functions) in English and French.
 * `roleLabel` looks up the full role id, then its longest known prefix (as Rust
 * `roles::label` does), so `worship.mosque.friday` reads "Friday mosque" and
 * never "friday". The French names follow the engine's `services.json` labels. */
import services from '../../../rust/crates/core/src/urban/services.json';

export const ROLE_LABELS: Record<string, string> = {
  // Housing.
  'dwelling': 'Habitation', 'dwelling.row': 'Maison en bande', 'dwelling.house': 'Maison', 'dwelling.courtyard': 'Maison à cour',
  'dwelling.compound': 'Enclos familial', 'dwelling.platform': 'Maison sur plateforme', 'dwelling.tenement': 'Immeuble de rapport',
  'dwelling.townhouse': 'Maison de ville', 'dwelling.mansion': 'Hôtel particulier', 'dwelling.shop': 'Maison-boutique', 'dwelling.farm': 'Ferme',
  // Worship.
  'worship': 'Culte', 'worship.parish': 'Église', 'worship.cathedral': 'Cathédrale', 'worship.monastery': 'Monastère',
  'worship.mosque': 'Mosquée', 'worship.mosque.friday': 'Mosquée du vendredi', 'worship.masjid': 'Mosquée de quartier', 'worship.temple': 'Temple',
  'worship.temple.major': 'Grand temple', 'worship.shrine': 'Sanctuaire', 'worship.wayside': 'Oratoire', 'worship.precinct': 'Enceinte sacrée',
  'worship.pyramid-precinct': 'Enceinte de la pyramide', 'worship.mortuary-temple': 'Temple funéraire', 'worship.city-god-temple': 'Temple du dieu de la ville',
  'worship.confucian-temple': 'Temple de Confucius', 'worship.grove': 'Bois sacré', 'worship.hof': 'Hof (salle de culte)', 'worship.huaca': 'Huaca',
  'worship.kiva': 'Kiva', 'worship.church': 'Église', 'worship.parish.ruin': 'Église en ruine', 'worship.ushnu': 'Ushnu', 'worship.capitolium': 'Capitole',
  // Trade.
  'commerce': 'Commerce', 'commerce.market': 'Marché', 'commerce.market.gate': 'Marché de la porte', 'commerce.market.ward': 'Marché de quartier',
  'commerce.inn': 'Auberge', 'commerce.caravanserai': 'Caravansérail', 'commerce.bazaar': 'Bazar', 'commerce.souk': 'Souk', 'commerce.funduq': 'Fondouk',
  'commerce.macellum': 'Macellum', 'commerce.maidan': 'Maïdan', 'commerce.taberna': 'Taverne', 'commerce.tianguis': 'Tianguis (marché)',
  'commerce.dharamshala': 'Dharamshala (gîte)', 'commerce.warehouse': 'Entrepôt', 'commerce.fishmarket': 'Marché aux poissons',
  'commerce.emporium': 'Comptoir', 'commerce.market.hall': 'Halle du marché', 'commerce.shop': 'Boutique',
  // Crafts.
  'craft': 'Artisanat', 'craft.workshop': 'Atelier', 'craft.mill': 'Moulin', 'craft.smithy': 'Forge', 'craft.tannery': 'Tannerie', 'craft.dyer': 'Teinturerie',
  'craft.potter': 'Poterie', 'craft.weaver': 'Tissage', 'craft.bakery': 'Boulangerie', 'craft.brewery': 'Brasserie', 'craft.boatshed': 'Hangar à bateaux',
  'craft.fullonica': 'Foulerie', 'craft.obsidian': 'Taille d’obsidienne', 'craft.alchemist': 'Officine d’alchimiste',
  // Civic and institutions.
  'civic': 'Équipement civique', 'civic.townhall': 'Hôtel de ville', 'civic.hall': 'Halle', 'civic.forum': 'Forum', 'civic.palace': 'Palais',
  'civic.basilica': 'Basilique', 'civic.thermae': 'Thermes', 'civic.bathhouse': 'Bains', 'civic.hammam': 'Hammam', 'civic.amphitheatre': 'Amphithéâtre',
  'civic.theatre': 'Théâtre', 'civic.guildhall': 'Maison des guildes', 'civic.council-house': 'Maison du conseil', 'civic.drum-tower': 'Tour du tambour',
  'civic.clocktower': 'Beffroi', 'civic.hospital': 'Hôpital', 'civic.maristan': 'Maristan', 'civic.madrasa': 'Madrasa', 'civic.university': 'Université',
  'civic.academy': 'Académie', 'civic.yamen': 'Yamen', 'civic.stepwell': 'Puits à degrés', 'civic.tank': 'Bassin', 'civic.wizard-tower': 'Tour du mage',
  'civic.longhall': 'Longue halle', 'civic.ballcourt': 'Jeu de balle', 'civic.calmecac': 'Calmecac (école)', 'civic.kallanka': 'Kallanka (grande halle)',
  'civic.khan-tent': 'Tente du khan', 'civic.ghat': 'Ghat (escaliers du fleuve)', 'civic.guild': 'Maison de guilde',
  // Defence, elite, storage, open land.
  'defence': 'Défense', 'defence.keep': 'Donjon', 'defence.castle': 'Château', 'defence.fort': 'Fort', 'defence.fortress': 'Forteresse',
  'defence.kasbah': 'Kasbah', 'defence.barracks': 'Caserne', 'defence.gate': 'Porte', 'defence.tower': 'Tour',
  'elite': 'Résidence noble', 'elite.palace': 'Palais', 'elite.kancha-palace': 'Palais (kancha)',
  'storage': 'Stockage', 'storage.granary': 'Grenier', 'storage.horreum': 'Horreum (grenier)', 'storage.qollqa': 'Qollqa (entrepôt)', 'storage.barn': 'Grange',
  'open': 'Espace ouvert', 'open.garden': 'Jardin', 'open.common': 'Commun', 'open.cemetery': 'Cimetière', 'open.necropolis': 'Nécropole',
  'open.plaza': 'Place', 'open.corral': 'Corral', 'open.kraal': 'Kraal', 'open.thing': 'Lieu d’assemblée (thing)', 'open.fallow': 'Friche',
  'funerary': 'Monument funéraire', 'funerary.mausoleum': 'Mausolée', 'funerary.mausoleum.ruin': 'Mausolée en ruine',
  'worship.mortuary-temple.ruin': 'Temple funéraire en ruine',
  // Singular and utility buildings shared by several families.
  'civic.library': 'Bibliothèque', 'civic.arena': 'Arène', 'civic.hippodrome': 'Hippodrome', 'civic.lighthouse': 'Phare', 'civic.observatory': 'Observatoire',
  'civic.prison': 'Prison', 'civic.customs': 'Douane', 'civic.arch': 'Arc monumental', 'commerce.exchange': 'Bourse des marchands', 'commerce.tavern': 'Taverne',
  'commerce.stable': 'Écuries', 'commerce.warehouse.market': 'Entrepôt marchand', 'craft.shipyard': 'Chantier naval', 'craft.ropewalk': 'Corderie',
  'craft.sawmill': 'Scierie', 'craft.kiln': 'Four de potier et tuilerie', 'defence.arsenal': 'Arsenal', 'worship.baptistery': 'Baptistère', 'worship.stupa': 'Stupa',
  'worship.pagoda': 'Pagode', 'worship.ziggurat': 'Ziggourat', 'elite.villa': 'Villa', 'elite.manor': 'Manoir',
  // Fantasy cultures' own buildings.
  'civic.great-forge': 'Grande forge', 'civic.vault': 'Chambre forte', 'civic.moot-tree': 'Arbre du conseil', 'civic.war-pit': 'Fosse de guerre',
  'civic.spore-hall': 'Salle des spores', 'civic.web-spire': 'Flèche de toile', 'civic.tide-hall': 'Salle des marées', 'civic.giant-hall': 'Halle des géants',
  'civic.clockwork': 'Atelier d’horlogerie',
};
/** Burial grounds have mineral soil; their low tombs come from programme geometry. */
export function funeraryLandFill(role?: string): string | undefined {
  return role === 'open.cemetery' || role === 'open.necropolis' ? '#b6b2a0' : undefined;
}
export const FUNCTION_LABELS: Record<string, string> = { domestic: 'habitat', mixed: 'mixte (boutique et habitat)', workshop: 'atelier', warehouse: 'entrepôt',
  collective: 'équipement collectif', open_space: 'espace ouvert', market: 'marché', common: 'commun' };

/** English names of the role ids of `ROLE_LABELS` and of `services.json` `labels`. */
export const ROLE_LABELS_EN: Record<string, string> = {
  'civic.station': 'Railway station', 'civic.courthouse': 'Courthouse', 'civic.school': 'School', 'civic.fire-station': 'Fire station',
  'civic.power-house': 'Power house', 'civic.water-tower': 'Water tower',
  'commerce.office-block': 'Office block', 'commerce.skyscraper': 'Skyscraper', 'commerce.department-store': 'Department store',
  'commerce.bank': 'Bank', 'commerce.hotel': 'Hotel', 'craft.factory': 'Factory', 'storage.elevator': 'Grain elevator',
  'worship.chapel': 'Chapel', 'worship.synagogue': 'Synagogue',
  'dwelling': 'Dwelling', 'dwelling.row': 'Row house', 'dwelling.house': 'House', 'dwelling.courtyard': 'Courtyard house',
  'dwelling.compound': 'Family compound', 'dwelling.platform': 'Platform house', 'dwelling.tenement': 'Tenement',
  'dwelling.townhouse': 'Townhouse', 'dwelling.mansion': 'Mansion', 'dwelling.shop': 'Shop house', 'dwelling.farm': 'Farm',
  'worship': 'Place of worship', 'worship.parish': 'Parish church', 'worship.cathedral': 'Cathedral', 'worship.monastery': 'Monastery',
  'worship.mosque': 'Mosque', 'worship.mosque.friday': 'Friday mosque', 'worship.masjid': 'Neighbourhood mosque', 'worship.temple': 'Temple',
  'worship.temple.major': 'Great temple', 'worship.shrine': 'Shrine', 'worship.wayside': 'Wayside shrine', 'worship.precinct': 'Sacred precinct',
  'worship.pyramid-precinct': 'Pyramid precinct', 'worship.mortuary-temple': 'Mortuary temple', 'worship.city-god-temple': 'City god temple',
  'worship.confucian-temple': 'Confucian temple', 'worship.grove': 'Sacred grove', 'worship.hof': 'Hof (temple hall)', 'worship.huaca': 'Huaca (sacred place)',
  'worship.kiva': 'Kiva', 'worship.church': 'Church', 'worship.parish.ruin': 'Ruined church', 'worship.ushnu': 'Ushnu (ceremonial platform)', 'worship.capitolium': 'Capitolium',
  'commerce': 'Trade', 'commerce.market': 'Market square', 'commerce.market.gate': 'Gate market', 'commerce.market.ward': 'Neighbourhood market',
  'commerce.inn': 'Inn', 'commerce.caravanserai': 'Caravanserai', 'commerce.bazaar': 'Bazaar', 'commerce.souk': 'Souk', 'commerce.funduq': 'Funduq',
  'commerce.macellum': 'Macellum (covered market)', 'commerce.maidan': 'Maidan', 'commerce.taberna': 'Taberna', 'commerce.tianguis': 'Tianguis (market)',
  'commerce.dharamshala': 'Dharamshala (pilgrims’ rest house)', 'commerce.warehouse': 'Harbour warehouse', 'commerce.fishmarket': 'Fish market',
  'commerce.emporium': 'Emporium (harbour market)', 'commerce.market.hall': 'Market hall', 'commerce.shop': 'Shop',
  'craft': 'Workshop', 'craft.workshop': 'Workshop', 'craft.mill': 'Water mill', 'craft.smithy': 'Smithy', 'craft.tannery': 'Tannery', 'craft.dyer': 'Dye works',
  'craft.potter': 'Pottery', 'craft.weaver': 'Weaving workshop', 'craft.bakery': 'Bakery', 'craft.brewery': 'Brewery', 'craft.boatshed': 'Boat shed',
  'craft.fullonica': 'Fullery', 'craft.obsidian': 'Obsidian workshop', 'craft.alchemist': 'Alchemist’s laboratory', 'craft.activity': 'Activity site',
  'civic': 'Public building', 'civic.townhall': 'Town hall', 'civic.hall': 'Common hall', 'civic.forum': 'Forum', 'civic.palace': 'Palace',
  'civic.basilica': 'Basilica', 'civic.thermae': 'Thermae', 'civic.bathhouse': 'Bathhouse', 'civic.hammam': 'Hammam', 'civic.amphitheatre': 'Amphitheatre',
  'civic.theatre': 'Theatre', 'civic.guildhall': 'Guildhall', 'civic.council-house': 'Council house', 'civic.drum-tower': 'Drum tower',
  'civic.clocktower': 'Belfry', 'civic.hospital': 'Hospital', 'civic.maristan': 'Maristan (hospital)', 'civic.madrasa': 'Madrasa', 'civic.university': 'University',
  'civic.academy': 'Academy', 'civic.yamen': 'Yamen (magistrate’s seat)', 'civic.stepwell': 'Stepwell', 'civic.tank': 'Sacred tank', 'civic.wizard-tower': 'Wizard’s tower',
  'civic.longhall': 'Long hall', 'civic.ballcourt': 'Ball court', 'civic.calmecac': 'Calmecac (school)', 'civic.kallanka': 'Kallanka (great hall)',
  'civic.khan-tent': 'Khan’s tent', 'civic.ghat': 'Ghats (river steps)', 'civic.guild': 'Guild house', 'civic.harbour': 'Harbour master and customs',
  'defence': 'Fortification', 'defence.keep': 'Keep', 'defence.castle': 'Castle', 'defence.fort': 'Fort', 'defence.fortress': 'Fortress',
  'defence.kasbah': 'Kasbah', 'defence.barracks': 'Barracks', 'defence.gate': 'Gate', 'defence.tower': 'Watchtower',
  'elite': 'Noble residence', 'elite.palace': 'Palace', 'elite.kancha-palace': 'Palace (kancha)',
  'storage': 'Storehouse', 'storage.granary': 'Granary', 'storage.horreum': 'Horreum (storehouse)', 'storage.qollqa': 'Qollqa (state granary)', 'storage.barn': 'Common barn',
  'open': 'Open space', 'open.garden': 'Garden', 'open.common': 'Common', 'open.cemetery': 'Cemetery', 'open.necropolis': 'Necropolis',
  'open.plaza': 'Square', 'open.corral': 'Livestock pen', 'open.kraal': 'Kraal', 'open.thing': 'Thing (assembly ground)', 'open.fallow': 'Fallow land',
  'funerary': 'Funerary monument', 'funerary.mausoleum': 'Mausoleum', 'funerary.mausoleum.ruin': 'Ruined mausoleum',
  'worship.mortuary-temple.ruin': 'Ruined mortuary temple',
  'civic.library': 'Library', 'civic.arena': 'Arena', 'civic.hippodrome': 'Hippodrome', 'civic.lighthouse': 'Lighthouse', 'civic.observatory': 'Observatory',
  'civic.prison': 'Prison', 'civic.customs': 'Customs house', 'civic.arch': 'Monumental arch', 'commerce.exchange': 'Merchants’ exchange', 'commerce.tavern': 'Tavern',
  'commerce.stable': 'Stables', 'commerce.warehouse.market': 'Merchant warehouse', 'craft.shipyard': 'Shipyard', 'craft.ropewalk': 'Ropewalk',
  'craft.sawmill': 'Sawmill', 'craft.kiln': 'Pottery and tile kiln', 'defence.arsenal': 'Arsenal', 'worship.baptistery': 'Baptistery', 'worship.stupa': 'Stupa',
  'worship.pagoda': 'Pagoda', 'worship.ziggurat': 'Ziggurat', 'elite.villa': 'Villa', 'elite.manor': 'Manor',
  'civic.great-forge': 'Great forge', 'civic.vault': 'Vault', 'civic.moot-tree': 'Moot tree', 'civic.war-pit': 'War pit',
  'civic.spore-hall': 'Spore hall', 'civic.web-spire': 'Web spire', 'civic.tide-hall': 'Tide hall', 'civic.giant-hall': 'Giants’ hall',
  'civic.clockwork': 'Clockwork workshop',
  'lore': 'Legendary site', 'lore.temple': 'Legendary temple', 'lore.palace': 'Legendary palace', 'lore.necropolis': 'Legendary necropolis', 'lore.magic': 'Place of magic',
};
/** English names of `services.json` `familyLabels`: the family's own buildings keep their names (a funduq stays a funduq). */
export const FAMILY_ROLE_LABELS_EN: Record<string, Record<string, string>> = {
  industrial: { 'dwelling.row': 'Row house', 'dwelling.tenement': 'Tenement', 'dwelling.shop': 'Shop building', 'commerce.market': 'City hall square', 'civic.townhall': 'City hall', 'worship.parish': 'Church', 'commerce.tavern': 'Saloon', 'commerce.warehouse': 'Warehouse', 'craft.workshop': 'Workshop and small factory', 'open.garden': 'Public park', 'civic.theatre': 'Theatre', 'civic.library': 'Public library' },
  islamic: { 'dwelling.courtyard': 'Courtyard house (dar)', 'dwelling.shop': 'Souk shop', 'open.cemetery': 'Muslim cemetery', 'storage.granary': 'Agadir (granary)', 'commerce.tavern': 'Coffee house (qahwa)', 'funerary.mausoleum': 'Qubba (saint’s tomb)', 'civic.library': 'Dar al-ʿilm (library)' },
  chinese: { 'dwelling.courtyard': 'Siheyuan', 'dwelling.shop': 'Street shop', 'commerce.warehouse': 'River warehouse', 'commerce.tavern': 'Teahouse', 'commerce.stable': 'Post relay (yi)', 'civic.arch': 'Paifang (memorial arch)', 'civic.academy': 'Shuyuan (academy)' },
  japanese: { 'dwelling.row': 'Machiya', 'dwelling.shop': 'Machiya shop', 'commerce.inn': 'Ryokan', 'worship.temple': 'Buddhist temple', 'worship.shrine': 'Shinto shrine', 'storage.granary': 'Kura (storehouse)', 'craft.brewery': 'Sake brewery', 'commerce.tavern': 'Chaya (teahouse)', 'civic.bathhouse': 'Sentō (public bath)', 'elite.manor': 'Yashiki (samurai residence)', 'civic.theatre': 'Kabuki theatre' },
  classical: { 'dwelling.courtyard': 'Domus', 'dwelling.tenement': 'Insula', 'dwelling.shop': 'Street taberna', 'commerce.stable': 'Stabulum (stables)', 'civic.hippodrome': 'Circus', 'civic.prison': 'Carcer (prison)', 'civic.arch': 'Triumphal arch', 'civic.lighthouse': 'Pharos (lighthouse)' },
  norse: { 'dwelling.house': 'Longhouse', 'dwelling.row': 'Longhouse', 'commerce.tavern': 'Mead hall' },
  indian: { 'dwelling.courtyard': 'Haveli', 'worship.shrine': 'Neighbourhood shrine', 'civic.observatory': 'Jantar Mantar (observatory)', 'worship.temple.major': 'Great gopuram temple' },
  steppe: { 'dwelling.house': 'Yurt', 'dwelling.compound': 'Family camp', 'commerce.stable': 'Post relay (örtöö)' },
  andean: { 'commerce.inn': 'Tambo (way station)', 'worship.temple.major': 'Temple of the Sun' },
  native: { 'worship.temple.major': 'Platform mound' },
  ancient: { 'commerce.tavern': 'Beer house' },
  clan: { 'dwelling.house': 'Family house', 'dwelling.compound': 'Clan household', 'civic.council-house': 'Clan meeting house', 'storage.granary': 'Cache or granary on posts', 'craft.workshop': 'Drying rack and workshop', 'open.plaza': 'Gathering ground' },
  insular: { 'elite.palace': 'Kraton (palace)', 'commerce.market': 'Pasar (market)', 'worship.temple.major': 'Candi (great temple)', 'worship.shrine': 'Neighbourhood pura', 'civic.hall': 'Pendopo (assembly pavilion)', 'commerce.inn': 'Pesanggrahan (rest house)', 'civic.bathhouse': 'Petirtaan (sacred pool)', 'storage.granary': 'Lumbung (granary)', 'dwelling.compound': 'Pekarangan (family compound)', 'craft.dyer': 'Batik workshop', 'commerce.tavern': 'Warung' },
};
export type RoleLocale = 'en' | 'fr';
const servicesLabels = services as unknown as { labels: Record<string, string>; familyLabels: Record<string, Record<string, string>>; cultures: Record<string, string>; states: Record<string, { suffix: string; label: string }> };
/** French names: the engine's labels, completed by the web table for roles the engine does not name. */
const ROLE_LABELS_FR: Record<string, string> = { ...ROLE_LABELS, ...servicesLabels.labels };
const STATE_SUFFIX_EN: Record<string, string> = { '.ruin': ' in ruins', '.abandoned': ' (abandoned)' };
/** Locale of role labels: the page's UI language (V2 and benches set `<html lang>`); French or English, English by default. */
export function uiRoleLocale(): RoleLocale {
  return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
/** Service family (`services.json` `cultures`) of a culture id; a family id passes through. */
export function roleFamily(culture?: string | null): string | undefined {
  if (!culture) return undefined;
  return servicesLabels.cultures[culture] ?? (servicesLabels.familyLabels[culture] || FAMILY_ROLE_LABELS_EN[culture] ? culture : undefined);
}
/** Name of a building role in `locale` (default: the UI language). `family` is a service family or a culture id; its own
 * names come first. An unknown role takes its longest known prefix (dot or `craft:` separated), as Rust `roles::label`;
 * a state suffix (`.ruin`, `.abandoned`) is kept as words. */
export function roleLabel(role?: string | null, locale: RoleLocale = uiRoleLocale(), family?: string | null): string {
  if (!role) return locale === 'fr' ? 'Sans rôle' : 'No role';
  const table = locale === 'fr' ? ROLE_LABELS_FR : ROLE_LABELS_EN, fam = roleFamily(family);
  const own = fam ? (locale === 'fr' ? servicesLabels.familyLabels[fam] : FAMILY_ROLE_LABELS_EN[fam]) : undefined;
  const lookup = (id: string): string | undefined => {
    for (let key = id; key;) {
      const found = own?.[key] ?? table[key]; if (found) return found;
      const cut = Math.max(key.lastIndexOf('.'), key.lastIndexOf(':')); key = cut > 0 ? key.slice(0, cut) : '';
    }
    return undefined;
  };
  const exact = own?.[role] ?? table[role]; if (exact) return exact;
  const state = Object.values(servicesLabels.states).find(s => s.suffix && role.endsWith(s.suffix));
  const base = state ? role.slice(0, -state.suffix.length) : role;
  const text = lookup(base) ?? (locale === 'fr' ? 'Bâtiment' : 'Building');
  return state ? text + (locale === 'fr' ? state.label : STATE_SUFFIX_EN[state.suffix] ?? '') : text;
}
/** Street roles of the plan (network.rs) in French. */
export const STREET_LABELS: Record<string, string> = { street: 'rue', lane: 'ruelle', main: 'grand-rue', regional: 'route régionale', market: 'rue du marché', processional: 'voie processionnelle',
  ring: 'boulevard de ceinture', 'gate-street': 'rue de la porte', quay: 'quai', 'wall-lane': 'chemin de ronde', collective: 'passage collectif', private: 'passage privé', stairs: 'escalier', 'port-stairs': 'escalier du port', 'port-street': 'rue du port', bridge: 'pont', ford: 'gué', causeway: 'chaussée' };
export const streetLabel = (role: string): string => STREET_LABELS[role] ?? role.replace(/[-_]/g, ' ');
export const functionLabel = (fn?: string | null): string => FUNCTION_LABELS[fn ?? ''] ?? (fn ?? '');

// ---------------------------------------------------------------- choices
interface ServiceEntry { role: string; function: string }
const catalogue = services as unknown as { cultures: Record<string, string>; families: Record<string, ServiceEntry[]>; cultureServices?: Record<string, ServiceEntry[]> };
export interface RoleChoice { role: string; function: string; label: string }
const HOUSING = ['dwelling.row', 'dwelling.house', 'dwelling.courtyard', 'dwelling.compound', 'dwelling.townhouse', 'dwelling.tenement', 'dwelling.mansion', 'dwelling.farm'];
/** Roles a lot may take in a culture: housing, the culture's own services and
 * its family's service catalogue (B2 `services.json`) and open land, each with
 * its native function (the culture's entry first when both name a role), named in `locale`. */
export function lotRoleChoices(culture?: string, locale: RoleLocale = uiRoleLocale()): RoleChoice[] {
  const family = catalogue.cultures[culture ?? ''] ?? 'european';
  const seen = new Set<string>(), out: RoleChoice[] = [];
  const add = (role: string, fn: string): void => { if (!seen.has(role)) { seen.add(role); out.push({ role, function: fn, label: roleLabel(role, locale, family) }); } };
  HOUSING.forEach(role => add(role, 'domestic')); add('dwelling.shop', 'mixed');
  for (const e of [...(catalogue.cultureServices?.[culture ?? ''] ?? []), ...(catalogue.families[family] ?? [])]) add(e.role, e.function);
  add('open.garden', 'common'); add('open.common', 'common');
  return out;
}
