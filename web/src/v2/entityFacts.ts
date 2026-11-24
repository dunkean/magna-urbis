/** The text of the entity sheet: the title, type and key facts of one picked entity, and the names it can be given.
 * Reads retained products only (the same facts as the inspectors' "Local facts"). */
import type { Settlement, Vec2, World } from '../gen/types';
import type { NameEntry, NameKind } from '../gen/names/types';
import { distToPolyline } from '../gen/core/geom';
import { areaWithHoles, pointInRing } from '../gen/geo/poly';
import { sampleGrid } from '../gen/core/grid';
import { populationText } from '../render/cityPopulation';
import type { ReachedPopulation } from '../render/cityPopulation';
import type { V2Settings } from './contracts';
import type { Entity, EntityKind } from './entityPick';
import type { RustRegionSnapshot } from './region';
import { activitySitesOf } from './activitySites';
import { townUrban } from './edits';
import { numberLocale, registerMessages, translate } from './i18n';
import { localFacts } from './localFacts';
import { featureDisplayName, settlementDisplayName } from './mapPresentation';
import { nativeCityRecords } from './nativeProducts';
import { displayUnit, formatDistance, getDistanceUnit, unitFactor } from './units';
import { urbanRoleChoices } from './urbanRoleNames';

registerMessages(
  Object.fromEntries(
    Object.entries({
      Settlement: 'Localité',
      'Special building': 'Bâtiment remarquable',
      Building: 'Bâtiment',
      Block: 'Îlot',
      Quarter: 'Quartier',
      Street: 'Rue',
      Road: 'Route',
      Bridge: 'Pont',
      'City wall': 'Enceinte',
      'Castle wall': 'Enceinte de château',
      Gate: 'Porte',
      River: 'Cours d’eau',
      Lake: 'Lac',
      Sea: 'Mer',
      Farm: 'Ferme',
      'Harbour works': 'Installation portuaire',
      'Isolated building': 'Bâtiment isolé',
      Population: 'Population',
      Culture: 'Culture',
      Role: 'Rôle',
      Period: 'Période',
      Site: 'Site',
      'Growth phases': 'Phases de croissance',
      Phase: 'Phase',
      Zone: 'Zone',
      Quarters: 'Quartiers',
      Blocks: 'Îlots',
      Parcels: 'Parcelles',
      Buildings: 'Bâtiments',
      Households: 'Foyers',
      Use: 'Usage',
      'House type': 'Type de maison',
      Storeys: 'Étages',
      Height: 'Hauteur',
      Roof: 'Toit',
      Material: 'Matériau',
      Class: 'Catégorie',
      Paving: 'Revêtement',
      Width: 'Largeur',
      Length: 'Longueur',
      'Steepest grade': 'Pente maximale',
      'Leads to': 'Dessert',
      Towers: 'Tours',
      Gates: 'Portes',
      Area: 'Surface',
      'Flows into': 'Se jette dans',
      Near: 'Près de',
      Residents: 'Habitants',
      Resource: 'Ressource',
      Altitude: 'Altitude',
      Position: 'Position',
    }).map(([en, fr]) => [en, { en, fr }]),
  ),
);

export interface EntityFacts {
  /** Type of the entity (translated). */
  type: string;
  title: string;
  /** Label and value, translated; empty values are left out. */
  facts: [string, string][];
  /** The map name the sheet can rename. */
  name?: { id: string; town?: string };
}
export interface EntityFactsInput {
  world: World;
  settings: V2Settings;
  reachedPopulation(key: string, target: number): ReachedPopulation | undefined;
}

const TYPES: Record<EntityKind, string> = {
  building: 'Building',
  gate: 'Gate',
  wall: 'City wall',
  bridge: 'Bridge',
  harbour: 'Harbour works',
  farm: 'Farm',
  isolated: 'Isolated building',
  street: 'Street',
  road: 'Road',
  river: 'River',
  lake: 'Lake',
  sea: 'Sea',
  block: 'Block',
  quarter: 'Quarter',
  settlement: 'Settlement',
};
/** Kinds of map names an entity may carry, and how far (metres) its label may stand. */
const NAME_KINDS: Partial<Record<EntityKind, readonly NameKind[]>> = { building: ['building', 'church', 'castle'], gate: ['gate'], bridge: ['bridge'], farm: ['farm'], street: ['street'], road: ['road'], river: ['river'], lake: ['lake'], sea: ['sea'], quarter: ['quarter'] };

const capital = (text: string): string => text.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
/** An engine identifier as text: its registered label, else the identifier itself. */
function humanise(value: string | undefined): string {
  if (!value) return '';
  const label = capital(value),
    translated = translate(label);
  return translated !== label ? translated : capital(translate(value));
}
const number = (value: number, decimals = 0): string => value.toLocaleString(numberLocale(), { maximumFractionDigits: decimals });
const metres = (value: number): string => formatDistance(value, getDistanceUnit(), numberLocale());
const surface = (value: number): string => {
  const unit = displayUnit('m²', getDistanceUnit());
  return `${number(value / unitFactor(unit))} ${unit}`;
};
const lengthOf = (path: readonly Vec2[]): number => path.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
const areaOf = (rings: readonly Vec2[][]): number => (rings.length ? areaWithHoles(rings[0], rings.slice(1)) : 0);

/** The map name of an entity: the entry of its kind that runs along it, or stands inside its outline. */
function nameEntry(world: World, entity: Entity): NameEntry | undefined {
  const kinds = NAME_KINDS[entity.kind],
    ring = entity.rings[0];
  if (!kinds) return undefined;
  let best: { entry: NameEntry; distance: number } | undefined;
  for (const entry of world.names?.entries ?? []) {
    if (!kinds.includes(entry.kind)) continue;
    let distance = Infinity;
    if (entry.path?.length) distance = distToPolyline(entity.point, entry.path) <= 25 ? distToPolyline(entity.point, entry.path) : Infinity;
    else if (entity.kind === 'sea' || (ring?.length >= 3 && pointInRing(ring, entry.anchor))) distance = 0;
    else if (Math.hypot(entry.anchor.x - entity.point.x, entry.anchor.y - entity.point.y) <= 25 && ['gate', 'bridge', 'farm', 'building'].includes(entity.kind)) distance = Math.hypot(entry.anchor.x - entity.point.x, entry.anchor.y - entity.point.y);
    if (distance < (best?.distance ?? Infinity)) best = { entry, distance };
  }
  return best?.entry;
}

export function entityFacts(entity: Entity, input: EntityFactsInput): EntityFacts {
  const { world, settings } = input,
    town = world.settlements?.find(s => s.key === entity.town),
    urban = entity.town ? townUrban(world, entity.town) : undefined,
    native = entity.town ? nativeCityRecords(world)?.[entity.town] : undefined,
    layout = native?.layouts?.[0],
    region = world.debug?.v2RustRegion as RustRegionSnapshot | undefined;
  const facts: [string, string][] = [],
    add = (label: string, value: string | number | undefined) => {
      if (value !== undefined && value !== '') facts.push([translate(label), typeof value === 'number' ? number(value) : value]);
    };
  const placeName = (key: string | undefined): string | undefined => (key ? (settlementDisplayName(world, key, settings) ?? key) : undefined);
  const entry = nameEntry(world, entity);
  let type = translate(TYPES[entity.kind]),
    title = (entry && featureDisplayName(world, entry.id, settings)) || '';
  let name: EntityFacts['name'] = entry && { id: entry.id };

  /** The shared facts of a town or one of its quarters and blocks. */
  const local = (place: Settlement, selection?: { kind: 'quarter' | 'block'; index: number }) => localFacts({ settlement: place, urban, native, selection });
  switch (entity.kind) {
    case 'settlement': {
      if (!town) break;
      const own = local(town),
        config = layout?.config?.programme;
      type = humanise(town.cls);
      title = placeName(town.key)!;
      name = { id: `settlement:${town.key}`, town: town.key };
      add('Population', populationText(town.population, input.reachedPopulation(town.key, town.population), { t: translate, locale: numberLocale() }));
      add('Culture', translate(own.culture));
      add('Site', translate(town.archetype));
      if (config && !['auto', 'settlement'].includes(config.intent)) add('Role', humanise(config.intent));
      add('Period', humanise(config?.period));
      if (layout?.phases?.length) add('Growth phases', layout.phases.length);
      add('Quarters', own.quarters);
      add('Buildings', own.buildings);
      add('Area', own.area === undefined ? undefined : surface(own.area));
      break;
    }
    case 'quarter':
    case 'block': {
      if (!town) break;
      const own = local(town, { kind: entity.kind, index: entity.index }),
        quarter = entity.kind === 'quarter' ? entity.index : urban?.blockInfo[entity.index]?.quarter,
        district = layout?.structure?.districts.find(d => quarter !== undefined && d.quarters.includes(quarter));
      title ||= `${type} ${entity.index + 1}`;
      add('Culture', translate(own.culture));
      if (district?.role) add('Role', roleName(district.role, true));
      add('Zone', own.zone && translate(own.zone));
      add('Phase', own.phase);
      if (entity.kind === 'quarter') add('Blocks', own.blocks);
      add('Parcels', own.parcels);
      add('Buildings', own.buildings);
      add('Households', own.households);
      add('Area', own.area === undefined ? undefined : surface(own.area));
      break;
    }
    case 'building': {
      const building = entity.hit!.building as NonNullable<Entity['hit']>['building'] & { nativeParcelId?: string },
        allocation = native?.programmePartitions?.[0]?.programme?.allocations.find(a => a.parcelId === building.nativeParcelId),
        special = !!allocation && !['domestic', 'auto'].includes(allocation.function ?? 'domestic');
      if (special) type = translate('Special building');
      title ||= special && allocation?.role ? roleName(allocation.role) : `${type} ${entity.index + 1}`;
      add('Use', allocation?.role ? roleName(allocation.role) : humanise(building.kind));
      add('House type', humanise(building.arch));
      add('Culture', translate(allocation?.culture ?? urban?.culture ?? town?.culture ?? ''));
      add('Households', allocation?.households);
      add('Storeys', building.storeys);
      add('Height', building.height === undefined ? undefined : metres(building.height));
      add('Roof', humanise(building.roof));
      add('Material', humanise(building.material));
      add('Area', surface(areaOf(entity.rings)));
      break;
    }
    case 'gate':
    case 'wall': {
      const wall = urban?.walls?.[entity.index];
      if (!wall) break;
      if (entity.kind === 'wall') {
        if (wall.role === 'castle') type = translate('Castle wall');
        add('Length', metres(lengthOf(wall.closed && wall.path.length ? [...wall.path, wall.path[0]] : wall.path)));
        add('Towers', wall.towers.length);
        add('Gates', wall.gates.length);
        add('Area', wall.closed ? surface(areaWithHoles(wall.path, [])) : undefined);
      }
      add('Width', metres(wall.thickness));
      break;
    }
    case 'harbour': {
      const quay = layout?.structure?.quays?.[entity.index];
      add('Class', humanise(quay?.kind));
      add('Material', humanise(quay?.material));
      add('Area', surface(areaOf(entity.rings)));
      break;
    }
    case 'street': {
      const street = urban?.streets[entity.index];
      if (!street) break;
      add('Class', humanise(street.role));
      add('Width', metres(street.width));
      add('Length', metres(lengthOf(street.path)));
      break;
    }
    case 'road': {
      const road = world.roads![entity.index],
        segments = region?.roads?.segments,
        segment = segments?.length === world.roads!.length ? segments[entity.index] : undefined,
        ends = segment ? [segment.a, segment.b].map(i => region!.roads!.junctions[i]?.site).filter((key): key is string => !!key && !!world.settlements?.some(s => s.key === key)) : [];
      add('Class', humanise(segment?.class ?? road.kind));
      add('Paving', humanise(segment?.surface));
      add('Width', metres(road.width));
      add('Length', metres(lengthOf(road.path)));
      add('Steepest grade', segment ? `${number(segment.grade * 100, 1)} %` : undefined);
      add('Leads to', ends.map(placeName).join(' – '));
      break;
    }
    case 'bridge': {
      const bridge = world.bridges![entity.index];
      add('Length', metres(Math.hypot(bridge.b.x - bridge.a.x, bridge.b.y - bridge.a.y)));
      add('Width', metres(bridge.width));
      break;
    }
    case 'river': {
      const river = world.terrain.rivers[entity.index],
        at = river.path.reduce((best, p, i) => (Math.hypot(p.x - entity.point.x, p.y - entity.point.y) < Math.hypot(river.path[best].x - entity.point.x, river.path[best].y - entity.point.y) ? i : best), 0);
      add('Class', humanise(river.cls));
      add('Width', metres(river.width[at] ?? 0));
      add('Length', metres(lengthOf(river.path)));
      add('Flows into', humanise(river.mouth));
      break;
    }
    case 'lake':
      add('Area', surface(areaOf(entity.rings)));
      break;
    case 'farm': {
      const farm = world.landuse!.farmsteads[entity.index];
      add('House type', humanise(farm.type));
      add('Class', humanise(farm.size));
      add('Culture', farm.culture && translate(farm.culture));
      add('Buildings', farm.buildings.length);
      add('Area', surface(areaOf(entity.rings)));
      break;
    }
    case 'isolated': {
      const site = activitySitesOf(world)[entity.index];
      if (!site) break;
      title ||= humanise(site.template);
      add('Class', humanise(site.kind));
      add('Resource', humanise(site.resource));
      add('Culture', translate(site.culture));
      add('Buildings', site.buildings.length);
      add('Residents', site.residents || undefined);
      add('Near', placeName(site.parent));
      break;
    }
  }
  add('Altitude', `${number(sampleGrid(world.terrain.height, entity.point.x, entity.point.y), 1)} m`);
  add('Position', `${number(Math.round(entity.point.x))} · ${number(Math.round(entity.point.y))}`);
  return { type, title: title || type, facts, name };
}
function roleName(role: string, district = false): string {
  const label = urbanRoleChoices(district).find(choice => choice.value === role)?.label;
  return label ? translate(label) : humanise(role);
}
/** The short name of a parent in the sheet's breadcrumb. */
export function entityLabel(entity: Entity, input: EntityFactsInput): string {
  if (entity.kind === 'settlement' && entity.town) return settlementDisplayName(input.world, entity.town, input.settings) ?? entity.town;
  const entry = nameEntry(input.world, entity);
  const named = entry && featureDisplayName(input.world, entry.id, input.settings);
  return named || `${translate(TYPES[entity.kind])}${['block', 'quarter', 'building'].includes(entity.kind) ? ` ${entity.index + 1}` : ''}`;
}
