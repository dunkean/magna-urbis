import type { Settlement, UrbanLayer, PolyH } from '../gen/types';
import type { RustTownSnapshot } from './rustUrban';
import { areaWithHoles, pointInRing } from '../gen/geo/poly';
import { blockEditKey } from '../../../rust/bridge/urbanBlockEdits';
import { registerMessages, translate, numberLocale } from './i18n';
import { displayUnit, getDistanceUnit, unitFactor } from './units';
import './localFacts.css';

registerMessages(
  Object.fromEntries(
    Object.entries({
      'Local facts': 'Fiche du lieu',
      'Applied generation results': 'Résultats de la génération appliquée',
      Buildings: 'Bâtiments',
      Quarters: 'Quartiers',
      Blocks: 'Îlots',
      Parcels: 'Parcelles',
      Area: 'Surface',
      'Building footprint': 'Emprise des bâtiments',
      'Allocated households': 'Ménages affectés',
      'Population target': 'Population cible',
      'Requested households': 'Ménages demandés',
      'Visible building footprints': 'Empreintes bâties visibles',
      'Site archetype': 'Type de site',
      'Residential buildings': 'Bâtiments résidentiels',
      'Persons per household (model)': 'Personnes par ménage (modèle)',
      'Allocated inhabitants (model)': 'Habitants affectés (modèle)',
      'One-person households': 'Foyers d’une personne',
      'Two-person households': 'Foyers de deux personnes',
      'Building functions': 'Fonctions des bâtiments',
      'Parcel uses': 'Usages des parcelles',
      'Generation stage': 'Étape de génération',
      Engine: 'Moteur',
      Morphology: 'Morphologie',
      Culture: 'Culture',
      Zone: 'Zone',
      Phase: 'Phase',
      Identifier: 'Identifiant',
      'Placement refusals': 'Refus d’implantation',
      'Open spaces': 'Espaces ouverts',
      'Last recomputed requests': 'Dernières demandes recalculées',
      'City-wide engine warnings': 'Avertissements du moteur pour toute la ville',
      'No generation warnings.': 'Aucun avertissement de génération.',
      'Not generated': 'Non généré',
      'Household capacity remains unverified.': 'La capacité de logement reste à vérifier.',
    }).map(([en, fr]) => [en, { en, fr }]),
  ),
);

export interface LocalFactsInput {
  settlement: Settlement;
  urban?: UrbanLayer;
  native?: RustTownSnapshot;
  selection?: { kind: 'quarter' | 'block' | 'parcel'; index: number };
}

/** Read retained products only. Subdivision membership follows cadastral IDs;
 * geometry is used only for the procedural layer without native products. */
export function localFacts(input: LocalFactsInput) {
  const { settlement, urban, native, selection } = input;
  const layout = native?.layouts[0];
  const scene = native?.stage === 'buildings' ? native.scene : undefined;
  const quarter = selection?.kind === 'quarter' ? urban?.quarters[selection.index] : undefined;
  const shape: PolyH | undefined = quarter?.poly ?? (selection?.kind === 'block' ? { outer: urban?.blocks[selection.index] ?? [], holes: [] } : selection?.kind === 'parcel' ? { outer: urban?.parcels[selection.index]?.poly ?? [], holes: [] } : undefined);
  const blockIndices = new Set(
    selection?.kind === 'quarter'
      ? layout
        ? layout.blocks.flatMap((block, i) => (block.quarter === selection.index ? [i] : []))
        : urban?.blocks.flatMap((ring, i) => (ring.length && shape && pointInRing(shape.outer, ring[0]) ? [i] : []))
      : selection?.kind === 'block'
        ? [selection.index]
        : selection?.kind === 'parcel'
          ? [urban?.parcels[selection.index]?.block]
          : [],
  );
  const parcelIndices = new Set((urban?.parcels ?? []).flatMap((parcel, i) => (!selection || (selection.kind === 'parcel' ? i === selection.index : blockIndices.has(parcel.block)) ? [i] : [])));
  const projectedParcels = (urban?.parcels ?? []).filter((_, i) => parcelIndices.has(i));
  const parcelIds = new Set(projectedParcels.flatMap(parcel => (parcel.nativeId ? [parcel.nativeId] : [])));
  const partitions = native?.stage === 'layout' ? undefined : native?.stage === 'parcels' ? (native.cadastralPartitions ?? native.partitions) : native?.partitions;
  const programmes = partitions?.flatMap(partition => (partition.programme ? [partition.programme] : []));
  const nativeParcels = partitions?.flatMap(partition => partition.parcels).filter(parcel => !selection || (!!parcel.id && parcelIds.has(parcel.id)));
  const buildings = scene?.buildings.filter(building => !selection || parcelIds.has(building.parcel_id));
  const projectedBuildings = (urban?.buildings ?? []).filter(
    building => !selection || (building.parcel !== undefined ? parcelIndices.has(building.parcel) : !!shape && building.poly.length > 0 && pointInRing(shape.outer, building.poly[0]) && !shape.holes?.some(hole => pointInRing(hole, building.poly[0]))),
  );
  const refusals = scene?.refusals.filter(refusal => !selection || parcelIds.has(refusal.parcel_id));
  const allocations = programmes?.length ? programmes.flatMap(programme => programme.allocations).filter(allocation => !selection || parcelIds.has(allocation.parcelId)) : undefined;
  const domesticDemands = programmes?.flatMap(programme => programme.demands).filter(demand => demand.unit === 'domesticUnits');
  const householdSize = domesticDemands
    ?.flatMap(demand => demand.provenance)
    .map(source => /profile:([0-9.]+) persons\/domesticUnit/.exec(source)?.[1])
    .find(value => value !== undefined);
  const area = (polygon: { outer: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }) => areaWithHoles(polygon.outer, polygon.holes);
  return {
    identifier: selection ? (quarter?.nativeId ?? (selection.kind === 'parcel' ? urban?.parcels[selection.index]?.nativeId : layout?.blocks[selection.index] ? blockEditKey(layout, selection.index) : undefined) ?? String(selection.index)) : settlement.key,
    culture: quarter?.culture ?? (quarter && layout?.phases?.[quarter.phase]?.culture) ?? layout?.culture ?? urban?.culture ?? settlement.culture,
    zone: quarter?.zone ?? (selection?.kind === 'block' ? layout?.blocks[selection.index]?.zone : selection?.kind === 'parcel' ? urban?.parcels[selection.index]?.zone : undefined),
    phase: quarter ? quarter.phase + 1 : undefined,
    area: shape ? area(shape) : urban ? (urban.footprintH?.length ? urban.footprintH : urban.footprint.map(outer => ({ outer }))).reduce((sum, polygon) => sum + area(polygon), 0) : undefined,
    quarters: !selection && urban ? urban.quarters.length : undefined,
    blocks: urban ? (selection ? blockIndices.size : urban.blocks.length) : undefined,
    parcels: urban && (!native || native.stage !== 'layout') ? projectedParcels.length : undefined,
    buildings: native ? buildings?.length : urban ? projectedBuildings.length : undefined,
    residentialBuildings: buildings?.filter(building => building.function === 'domestic' || building.function === 'mixed').length,
    footprintComponents: buildings?.reduce((sum, building) => sum + building.footprint.length, 0),
    householdSize: householdSize === undefined ? undefined : Number(householdSize),
    footprint: buildings
      ? buildings.reduce((sum, building) => sum + building.footprint.reduce((a, polygon) => a + area(polygon), 0), 0)
      : !native && urban
        ? projectedBuildings.reduce((sum, building) => sum + area({ outer: building.poly, holes: building.courtyards }), 0)
        : undefined,
    households: allocations ? allocations.filter(allocation => allocation.unit === 'domesticUnits').reduce((sum, allocation) => sum + (allocation.households ?? allocation.capacity), 0) : undefined,
    residents: allocations?.some(allocation => allocation.residents !== undefined) ? allocations.reduce((sum, allocation) => sum + (allocation.residents ?? 0), 0) : undefined,
    singles: allocations?.filter(allocation => allocation.households === 1 && allocation.residents === 1).length,
    couples: allocations?.filter(allocation => allocation.households === 1 && allocation.residents === 2).length,
    requestedHouseholds: !selection && domesticDemands?.length ? domesticDemands.reduce((sum, demand) => sum + demand.requested, 0) : undefined,
    functions: buildings?.map(building => building.function) ?? projectedBuildings.map(building => building.kind),
    uses: nativeParcels?.length ? nativeParcels.map(parcel => parcel.use) : projectedParcels.map(parcel => parcel.use),
    refusals,
    openSpaces: scene?.open_spaces.filter(space => !selection || parcelIds.has(space.parcel_id)).length,
    warnings: [...new Set([...(native?.warnings ?? []), ...(native?.layouts.flatMap(layout => layout.warnings) ?? []), ...(partitions?.flatMap(partition => [...partition.warnings, ...(partition.programme?.warnings ?? [])]) ?? [])])],
  };
}

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function localFactsHtml(input: LocalFactsInput): string {
  const facts = localFacts(input),
    { native, urban, settlement, selection } = input;
  const n = (value: number) => value.toLocaleString(numberLocale(), { maximumFractionDigits: 1 });
  const surface = (value: number) => {
    const unit = displayUnit('m²', getDistanceUnit());
    return `${n(value / unitFactor(unit))} ${unit}`;
  };
  const row = (label: string, value: unknown) => `<dt>${esc(translate(label))}</dt><dd>${esc(value ?? '—')}</dd>`;
  const count = (label: string, value: number | undefined) => row(label, value === undefined ? translate('Not generated') : n(value));
  const breakdown = (values: string[]) =>
    [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${translate(name)}: ${n(count)}`)
      .join(' · ') || '—';
  const rows = [
    ...(!selection ? [count('Quarters', facts.quarters)] : []),
    count('Buildings', facts.buildings),
    ...(native ? [count('Residential buildings', facts.residentialBuildings)] : []),
    ...(facts.footprintComponents === undefined ? [] : [count('Visible building footprints', facts.footprintComponents)]),
    count('Blocks', facts.blocks),
    count('Parcels', facts.parcels),
    row('Area', facts.area === undefined ? undefined : surface(facts.area)),
    row('Building footprint', facts.footprint === undefined ? undefined : surface(facts.footprint)),
    ...(!selection ? [count('Population target', urban?.population ?? settlement.population)] : []),
    ...(facts.requestedHouseholds === undefined ? [] : [count('Requested households', facts.requestedHouseholds)]),
    count('Allocated households', facts.households),
    ...(facts.residents === undefined ? [] : [count('Allocated inhabitants (model)', facts.residents), count('One-person households', facts.singles), count('Two-person households', facts.couples)]),
    ...(facts.householdSize === undefined ? [] : [count('Persons per household (model)', facts.householdSize)]),
    row('Culture', translate(facts.culture)),
    ...(facts.zone ? [row('Zone', translate(facts.zone))] : []),
    ...(facts.phase === undefined ? [] : [count('Phase', facts.phase)]),
    row('Site archetype', translate(settlement.archetype)),
    row('Morphology', urban?.morphology ? translate(urban.morphology) : undefined),
    row('Identifier', facts.identifier),
    row('Generation stage', native ? translate(native.stage) : urban ? 'TypeScript' : translate('Not generated')),
    ...(native ? [row('Engine', native.backend)] : []),
    row('Building functions', breakdown(facts.functions)),
    row('Parcel uses', breakdown(facts.uses)),
    ...(native ? [count('Placement refusals', facts.refusals?.length), count('Open spaces', facts.openSpaces)] : []),
    ...(native?.stage === 'buildings' && !selection ? [count('Last recomputed requests', native.lastBuildingRequests)] : []),
  ];
  const report = (title: string, items: string[]) => `<details class="local-facts-report"><summary>${esc(translate(title))} · ${n(items.length)}</summary><ul>${items.map(item => `<li>${item}</li>`).join('')}</ul></details>`;
  return `<h3>${esc(translate('Local facts'))}</h3>
    <p class="hint">${esc(translate('Applied generation results'))}</p>
    <dl class="local-facts-grid">${rows.join('')}</dl>
    ${facts.households === undefined ? '' : `<p class="hint">${esc(translate('Household capacity remains unverified.'))}</p>`}
    ${
      facts.refusals?.length
        ? report(
            'Placement refusals',
            facts.refusals.map(refusal => `<strong>${esc(refusal.id)}</strong> · ${esc(refusal.code)}<br>${esc(translate(refusal.message))}`),
          )
        : ''
    }
    ${
      facts.warnings.length
        ? report(
            'City-wide engine warnings',
            facts.warnings.map(warning => esc(translate(warning))),
          )
        : native
          ? `<p class="hint">${esc(translate('No generation warnings.'))}</p>`
          : ''
    }`;
}
