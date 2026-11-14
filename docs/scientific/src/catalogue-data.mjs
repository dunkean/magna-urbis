// Reads the Rust data sheets and exports a clean model of the 115 cultures for the styles catalogue.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const urban = resolve(root, 'rust/crates/core/src/urban');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const cat = readJson(resolve(urban, 'catalogue.json'));
const forms = readJson(resolve(urban, 'forms/styles.json'));
const modern = readJson(resolve(urban, 'forms/styles_modern.json'));
const wording = readJson(resolve(here, 'catalogue.en.json')); // clean English label and description per id
const rust = readFileSync(resolve(urban, 'culture.rs'), 'utf8');

// culture.rs: (id, land family, pack, borrowed, profile, architecture layout family)
const mappings = {};
const rows = rust.split('const MAPPINGS:')[1].split('];')[0]
  .matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(true|false)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/g);
for (const m of rows) mappings[m[1]] = { family: m[2], pack: m[3], borrowed: m[4] === 'true', layout: m[6] };

/**
 * Era rule.
 * - modern | futuristic | alien: the `era` trait of forms/styles_modern.json.
 * - camp: ids ending in "-camp" (nomad-camp, inuit-camp, siberian-camp).
 * - fantasy: the culture borrows a real-world house pack in MAPPINGS (borrowed = true) and is not modern or a camp
 *   (elven, dwarven, drow-enclave, ... plus the necropolis, stilt town and barbarian profiles).
 * - historical: everything else.
 */
function eraOf(id) {
  const e = modern.cultures[id]?.traits?.era;
  if (e) return e;
  if (id.endsWith('-camp')) return 'camp';
  if (mappings[id]?.borrowed) return 'fantasy';
  return 'historical';
}

/** Region family from the house pack prefix; fantasy peoples and modern styles are grouped by era instead. */
const PACK_REGION = {
  'EUR-MED': 'europe', 'EUR-EAST': 'europe', 'EUR-NOR': 'europe', 'ATL-CEL': 'europe', 'MED-ANT': 'europe',
  'AF-MAG': 'africa', 'AF-NILE': 'africa', 'AF-SAHEL': 'africa', 'AF-SOUTH': 'africa', 'AF-EAST': 'africa', 'AF-WEST': 'africa',
  'AS-MIDE': 'mesa', 'AS-IND': 'mesa', 'AS-HIM': 'mesa',
  'AS-CHI': 'eastasia', 'AS-JAP': 'eastasia', 'AS-KOR': 'eastasia', 'AS-SEA': 'eastasia', 'AS-ISL': 'eastasia',
  'AS-STEP': 'steppe', 'AS-SIB': 'steppe', 'AM-ARC': 'steppe',
  'AM-MESO': 'americas', 'AM-WOODS': 'americas', 'AM-TROP': 'americas', 'AM-AND': 'americas', 'AM-PUEB': 'americas',
  'AM-MISS': 'americas', 'AM-PNW': 'americas', 'AM-SOUTH': 'americas',
  'OC-PAC': 'oceania', 'OC-AUS': 'oceania',
};
function regionOf(id, era) {
  if (era === 'fantasy') return 'fantasy';
  if (era === 'modern') return 'modern';
  if (era === 'futuristic' || era === 'alien') return 'future';
  return PACK_REGION[mappings[id]?.pack] || 'europe';
}
export const REGION_ORDER = ['europe', 'africa', 'mesa', 'eastasia', 'americas', 'oceania', 'steppe', 'fantasy', 'modern', 'future'];

/** Roof names used by the presets (`arch.roof`) folded to the roof kinds of the forms registry. */
const ROOF_KIND = {
  gable: 'gable', hip: 'hip', 'tiled-hip': 'hip', halfhip: 'hip', shed: 'shed', pyramid: 'pyramid', pyramidal: 'pyramid',
  cone: 'cone', conical: 'cone', 'thatch-round': 'cone', tent: 'tent', dome: 'dome', barrel: 'barrel', flat: 'flat', terraced: 'flat',
};
const DEFAULT_PITCH = { gable: 38, hip: 30, shed: 15, pyramid: 45, cone: 55, tent: 60, dome: 90, barrel: 40, flat: 0 };

const zoneOrder = ['core', 'middle', 'faubourg', 'village'];

/** Kit of a culture: explicit kit, else the first derive rule its tradition matches, else the default. */
function kitOf(id, trad) {
  const kits = { ...forms.kits, ...modern.kits };
  const explicit = forms.cultures[id]?.kit || modern.cultures[id]?.kit;
  if (explicit) return { name: explicit, kit: kits[explicit] };
  for (const rule of [...forms.derive, ...modern.derive]) {
    const ok = (!rule.roof || rule.roof.includes(trad.roof)) && (!rule.cover || rule.cover.includes(trad.cover))
      && (!rule.wall || rule.wall.includes(trad.wall)) && (!rule.pitch || (trad.pitch >= rule.pitch[0] && trad.pitch <= rule.pitch[1]));
    if (ok) return { name: rule.kit, kit: kits[rule.kit] };
  }
  return { name: forms.default, kit: kits[forms.default] };
}

const weights = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
const farm = cat.farmstead;
export const farmTypeCount = Object.keys(farm.types).length;

export const cultures = Object.entries(cat.cultures).map(([id, c]) => {
  const map = mappings[id];
  const era = eraOf(id);
  const recipe = (zone) => c.recipes.find(r => r.zone === zone);
  const params = r => cat.presets[r.preset]?.params || {};
  const core = recipe('core') || c.recipes[0];
  const cp = params(core);
  const arch = cp.arch || {};

  // Tradition: forms registry first (roof, pitch, storeys, cover, wall), else the preset arch of the core recipe.
  const ft = (modern.cultures[id] || forms.cultures[id])?.traits?.tradition;
  let traditionSource = 'forms';
  let tradition;
  if (ft) {
    tradition = { roof: ft.roof, pitch: ft.pitch ?? DEFAULT_PITCH[ft.roof] ?? 30, storeys: ft.storeys || [1, 2], cover: ft.cover || null, wall: ft.wall || null, form: ft.form || null };
  } else {
    traditionSource = 'preset';
    const roof = ROOF_KIND[arch.roof] || 'gable';
    tradition = { roof, pitch: DEFAULT_PITCH[roof], storeys: arch.storeys || [1, 2], cover: null, wall: arch.material || null, form: null, typology: arch.typology || null };
  }
  if (!ft && !arch.roof) traditionSource = 'none';
  const kit = kitOf(id, tradition);
  const homePlans = weights(kit.kit?.house?.plans).filter(([, w]) => w > 0);

  const zones = [];
  for (const z of zoneOrder) {
    const r = recipe(z); if (!r) continue;
    const p = params(r);
    zones.push({ zone: z, recipe: r.id, density: p.density?.[z] ?? null, frontage: p.frontage?.[z] ?? null, plotDepth: p.plotDepth?.[z] ?? null, coverage: p.coverage?.[z] ?? null });
  }

  const traits = modern.cultures[id]?.traits || forms.cultures[id]?.traits || {};
  const pal = modern.palettes?.[traits.palette];
  const palette = pal ? weights(pal.homes).slice(0, 5).map(([hex]) => hex) : [];
  const fc = farm.cultures[id] || farm.cultures[farm.default];
  const farmTypes = weights(Object.fromEntries(fc.types)).slice(0, 3).map(([t]) => t);

  return {
    id,
    label: wording[id].label,
    description: wording[id].description,
    era,
    region: regionOf(id, era),
    pack: map?.pack,
    pattern: c.plan.pattern,
    enclosure: c.plan.enclosure,
    fortification: c.plan.fortification,
    nucleus: c.nucleus?.kind || 'none',
    zones,
    tradition,
    traditionSource,
    kit: kit.name,
    homePlans: homePlans.map(([plan, w]) => ({ plan, weight: w })),
    palette,
    heightLadder: traits.heightLadder || null,
    farmTypes,
    image: ['2d', '3d'].every(v => existsSync(resolve(here, `../assets/cultures/${id}-${v}.webp`))),
  };
});

const count = f => cultures.filter(f).length;
export const summary = {
  total: cultures.length,
  historical: count(c => c.era === 'historical'),
  fantasy: count(c => c.era === 'fantasy'),
  camp: count(c => c.era === 'camp'),
  fantasyAndCamps: count(c => c.era === 'fantasy' || c.era === 'camp'),
  modern: count(c => c.era === 'modern'),
  futuristic: count(c => c.era === 'futuristic'),
  alien: count(c => c.era === 'alien'),
  futuristicAndAlien: count(c => c.era === 'futuristic' || c.era === 'alien'),
  farmTypes: farmTypeCount,
  withImage: count(c => c.image),
  withoutTradition: cultures.filter(c => c.traditionSource === 'none').map(c => c.id),
};
