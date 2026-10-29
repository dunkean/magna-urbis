/** French names of the city roles (district roles, building roles, functions).
 * Rust may send its own `label`; it always wins. Otherwise the full role id is
 * looked up, then its shorter prefixes, so `worship.mosque.friday` reads
 * « Mosquée du vendredi » and never « friday ». */
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
};
export const FUNCTION_LABELS: Record<string, string> = { domestic: 'habitat', mixed: 'mixte (boutique et habitat)', workshop: 'atelier', warehouse: 'entrepôt',
  collective: 'équipement collectif', open_space: 'espace ouvert', market: 'marché', common: 'commun' };

/** French label of a role id; `label` (from Rust) wins when present. */
export function roleLabel(role?: string | null, label?: string | null): string {
  if (label) return label;
  if (!role) return 'Sans rôle';
  for (let id = role; id; id = id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : '') if (ROLE_LABELS[id]) {
    // A prefix match names the family; keep the unknown tail readable.
    return id === role ? ROLE_LABELS[id] : `${ROLE_LABELS[id]} · ${role.slice(id.length + 1).replace(/[-_.]/g, ' ')}`;
  }
  return role.replace(/[-_.]/g, ' ');
}
/** Street roles of the plan (network.rs) in French. */
export const STREET_LABELS: Record<string, string> = { street: 'rue', lane: 'ruelle', main: 'grand-rue', regional: 'route régionale', market: 'rue du marché', processional: 'voie processionnelle',
  ring: 'boulevard de ceinture', 'gate-street': 'rue de la porte', quay: 'quai', 'wall-lane': 'chemin de ronde', collective: 'passage collectif', private: 'passage privé', stairs: 'escalier', 'port-stairs': 'escalier du port', 'port-street': 'rue du port', bridge: 'pont', ford: 'gué', causeway: 'chaussée' };
export const streetLabel = (role: string): string => STREET_LABELS[role] ?? role.replace(/[-_]/g, ' ');
export const functionLabel = (fn?: string | null): string => FUNCTION_LABELS[fn ?? ''] ?? (fn ?? '');

// ---------------------------------------------------------------- choices
interface ServiceEntry { role: string; function: string }
const catalogue = services as unknown as { cultures: Record<string, string>; families: Record<string, ServiceEntry[]> };
export interface RoleChoice { role: string; function: string; label: string }
const HOUSING: RoleChoice[] = ['dwelling.row', 'dwelling.house', 'dwelling.courtyard', 'dwelling.compound', 'dwelling.townhouse', 'dwelling.tenement', 'dwelling.mansion', 'dwelling.farm']
  .map(role => ({ role, function: 'domestic', label: ROLE_LABELS[role] }));
const OPEN: RoleChoice[] = [{ role: 'open.garden', function: 'common', label: 'Jardin' }, { role: 'open.common', function: 'common', label: 'Commun' }];
/** Roles a lot may take in a culture: housing, the culture family's service
 * catalogue (B2 `services.json`) and open land, each with its native function. */
export function lotRoleChoices(culture?: string): RoleChoice[] {
  const family = catalogue.cultures[culture ?? ''] ?? 'european';
  const seen = new Set<string>(), out: RoleChoice[] = [];
  const add = (c: RoleChoice): void => { if (!seen.has(c.role)) { seen.add(c.role); out.push(c); } };
  HOUSING.forEach(add); add({ role: 'dwelling.shop', function: 'mixed', label: ROLE_LABELS['dwelling.shop'] });
  for (const e of catalogue.families[family] ?? []) add({ role: e.role, function: e.function, label: roleLabel(e.role) });
  OPEN.forEach(add);
  return out;
}
