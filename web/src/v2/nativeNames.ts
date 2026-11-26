import type { World, Vec2 } from '../gen/types';
import type { NameEntry, NameParts, NamingSettings } from '../gen/names/types';
import { generateToponymRecord } from '../gen/names/toponyms';
import { resolveToponymProfile } from '../gen/names/profiles';
import { CULTURAL_TERMS, formatToponym, culturalBuildingName } from '../gen/names/syntax';
import { roleNoun } from '../gen/names/meanings';
import { namingPolicy, namePolicyKey } from '../gen/names/policy';
import { polygonCentroid, polygonArea, polygonContains } from '../gen/core/geom';
import { nativeCityRecords } from './nativeProducts';

const center = (points: Vec2[]): Vec2 | undefined => (points.length >= 3 ? polygonCentroid(points) : points[0]);
const nativeNameInputs = new WeakMap<NameEntry, readonly unknown[]>();
const districtPoints = new WeakMap<object, WeakMap<object, Vec2[]>>();
const spans = new WeakMap<Vec2[], number>();
function spanOf(points: Vec2[]): number {
  let span = spans.get(points);
  if (span === undefined) spans.set(points, (span = Math.sqrt(points.length ? Math.abs(polygonArea(points)) : 0)));
  return span;
}
/** Native geometry carries roles, not authored names. Its French diagnostic labels are never used as toponyms. */
export function appendNativeNames(world: World, naming?: NamingSettings, seed = world.seed, local?: { key: string; entries: ReadonlyMap<string, NameEntry> }): void {
  if (!world.names) return;
  const records = nativeCityRecords(world);
  if (!records || !Object.keys(records).length) return;
  world.names.nativeManaged = true;
  // Native districts/quarters replace the synthetic quarter labels from the compatibility projection.
  const mainKey = world.settlements?.find(place => place.main)?.key ?? 'main';
  if (records[mainKey]) world.names.entries = world.names.entries.filter(e => e.kind !== 'quarter');
  for (const [cityKey, city] of local ? (records[local.key] ? [[local.key, records[local.key]] as const] : []) : Object.entries(records)) {
    const place = world.settlements?.find(s => s.key === cityKey);
    const cityCulture = place?.culture ?? world.options.culture;
    const prefix = `urban:${encodeURIComponent(cityKey)}`;
    const add = (id: string, kind: NameEntry['kind'], geometry: Vec2[] | Vec2 | undefined, culture: string, detail: number, role?: string, span?: number, quarterKey?: string, path?: Vec2[]) => {
      const old = local?.entries.get(id),
        held = old && nativeNameInputs.get(old);
      const savedPolicy = old && namingPolicy(naming, cityKey, id, old.parentKey);
      const inputs = [
        seed,
        geometry,
        kind,
        culture,
        detail,
        role,
        span,
        quarterKey,
        path,
        place?.options?.language,
        place?.options?.nameSource,
        world.options.language,
        world.options.nameSource,
        ...(!quarterKey && kind !== 'quarter' ? city.layouts.map(layout => layout.quarters) : []),
      ];
      if (held?.length === inputs.length + 2 && inputs.every((input, i) => input === held[i]) && savedPolicy?.profile === held.at(-2) && savedPolicy?.source === held.at(-1)) {
        world.names!.entries.push(old!);
        return;
      }
      const anchor = Array.isArray(geometry) ? center(geometry) : geometry;
      if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
      let parentKey = quarterKey;
      if (!parentKey && kind !== 'quarter')
        for (const layout of city.layouts ?? []) {
          const index = layout.quarters.findIndex(q => polygonContains(q.shape.outer, anchor));
          if (index >= 0) {
            parentKey = `${prefix}:quarter:${encodeURIComponent(layout.key)}:${index}`;
            break;
          }
        }
      const policy = namingPolicy(naming, cityKey, id, parentKey);
      const language = policy.profile ?? place?.options?.language ?? world.options.language;
      const profile = resolveToponymProfile(culture, language, world.seed),
        terms = CULTURAL_TERMS[profile.id];
      const frozen = local && world.names?.bank?.[id];
      const policyKey = frozen && namePolicyKey(naming, { id, kind, parentKey, parts: { profile: profile.id } } as NameEntry, cityKey, place?.options?.nameSource ?? world.options.nameSource);
      const frozenParts = frozen && frozen.policyKey === policyKey ? frozen.parts : undefined;
      const record = frozenParts ?? generateToponymRecord({ seed, key: id, kind: 'place', culture, language, source: policy.source ?? place?.options?.nameSource ?? world.options.nameSource });
      const noun = roleNoun(role ?? '');
      let cultural: string;
      if (kind === 'gate' || kind === 'castle') cultural = formatToponym(profile, kind, record.proper);
      else if (kind === 'building' && noun === 'house') cultural = culturalBuildingName(profile, record.proper);
      else if (kind === 'building' && (noun === 'building' || noun === 'hall')) cultural = record.proper;
      else {
        const term = kind === 'quarter' ? terms.ward : kind === 'street' ? terms.street : kind === 'church' ? terms.worship : noun === 'market' ? terms.square : noun === 'palace' || noun === 'keep' || noun === 'kasbah' ? terms.castle : noun === 'workshop' ? terms.craft : '';
        cultural = !term ? record.proper : terms.order === 'suffix' ? `${record.proper} ${term}` : `${term} ${record.proper}`;
      }
      const parts: NameParts = { kind, proper: record.proper, cultural, opaque: false, profile: profile.id, sourceMode: record.sourceMode, diagnostic: record.diagnostic, ...(role ? { role } : {}) };
      const entry: NameEntry = {
        id,
        entityKey: id,
        cityKey,
        parentKey,
        kind,
        parts,
        text: cultural,
        canonicalText: cultural,
        rank: Math.round(detail * 6),
        detail,
        anchor,
        span,
        ...(path ? { path } : {}),
        generated: true,
        ...(kind === 'quarter' || kind === 'castle' || kind === 'church' || detail < 0.45 ? { replacedAnchor: anchor } : {}),
      };
      nativeNameInputs.set(entry, [...inputs, policy.profile, policy.source]);
      world.names!.entries.push(entry);
    };
    const parcelRoles = new Map<string, { role?: string; culture?: string }>();
    for (const layout of city.layouts ?? []) {
      const layoutKey = encodeURIComponent(layout.key);
      const cultureAt = (index: number) => layout.config?.overrides?.quarters?.[String(index)]?.culture ?? layout.phases?.[layout.quarters[index]?.phase ?? 0]?.culture ?? layout.culture ?? cityCulture;
      for (const district of layout.structure?.districts ?? []) {
        let byQuarter = districtPoints.get(layout.blocks);
        if (!byQuarter) districtPoints.set(layout.blocks, (byQuarter = new WeakMap()));
        let points = byQuarter.get(district.quarters);
        if (!points) byQuarter.set(district.quarters, (points = layout.blocks.filter(b => district.quarters.includes(b.quarter) && !b.kind.startsWith('reserve') && b.kind !== 'deleted').flatMap(b => b.shape.outer)));
        const id = `${prefix}:district:${layoutKey}:${district.id}`;
        add(id, 'quarter', points, cultureAt(district.quarters[0] ?? 0), 0.2, undefined, spanOf(points));
      }
      for (const [index, quarter] of layout.quarters.entries()) {
        const id = `${prefix}:quarter:${layoutKey}:${index}`;
        add(id, 'quarter', quarter.shape.outer, cultureAt(index), 0.75, undefined, spanOf(quarter.shape.outer), id);
      }
      for (const [ei, enclosure] of (layout.enclosures ?? []).entries()) for (const [gi, gate] of enclosure.gates.entries()) add(`${prefix}:gate:${layoutKey}:${ei}:${gi}`, 'gate', gate, layout.culture ?? cityCulture, 0.4);
      // Secondary towns also get street names; their compatibility projection is not the main map's urban layer.
      if (cityKey !== 'main' && !place?.main)
        for (const [index, street] of layout.streets.entries()) {
          const mid = street.path[Math.floor(street.path.length / 2)];
          const qi = mid ? layout.quarters.findIndex(q => polygonContains(q.shape.outer, mid)) : -1;
          add(`${prefix}:street:${layoutKey}:${index}`, 'street', mid, cultureAt(Math.max(0, qi)), Math.min(0.95, 0.15 + street.rank * 0.16), undefined, undefined, qi >= 0 ? `${prefix}:quarter:${layoutKey}:${qi}` : undefined, street.path);
        }
    }
    for (const partition of city.partitions ?? []) {
      const allocations = new Map((partition.programme?.allocations ?? []).map(a => [a.parcelId, a]));
      for (const [index, parcel] of partition.parcels.entries()) {
        const allocation = parcel.id ? allocations.get(parcel.id) : undefined;
        const role = allocation?.role ?? (parcel.use === 'market' ? 'commerce.market' : undefined);
        if (parcel.id) parcelRoles.set(parcel.id, { role, culture: allocation?.culture });
        if (!role || !/^(worship|defence|elite|civic|commerce|craft|storage)\./.test(role)) continue;
        const kind = /^(defence|elite)\./.test(role) ? 'castle' : /^worship\./.test(role) ? 'church' : 'building';
        add(`${prefix}:parcel:${encodeURIComponent(partition.key)}:${encodeURIComponent(parcel.id ?? String(index))}`, kind, parcel.shape.outer, allocation?.culture ?? cityCulture, kind === 'building' ? 0.45 : 0.12, role);
      }
    }
    const buildings = city.scene?.buildings ?? [];
    const principalIds = new Set((city.sites ?? city.requests ?? []).filter(site => site.programme?.landmark).map(site => site.id));
    const principal =
      buildings.find(building => principalIds.has(building.id)) ??
      buildings.find(building => /^(civic|defence|elite|worship)\./.test(parcelRoles.get(building.parcel_id)?.role ?? '')) ??
      buildings.reduce<(typeof buildings)[number] | undefined>((largest, building) => (!largest || Math.abs(polygonArea(building.footprint?.[0]?.outer ?? [])) > Math.abs(polygonArea(largest.footprint?.[0]?.outer ?? [])) ? building : largest), undefined);
    for (const building of buildings) {
      const id = `${prefix}:building:${encodeURIComponent(building.id)}`,
        role = parcelRoles.get(building.parcel_id);
      const anchor = building.footprint?.[0]?.outer ?? building.transform?.origin;
      add(id, 'building', anchor, building.culture?.culture ?? role?.culture ?? cityCulture, building === principal ? 0.05 : 0.9, role?.role ?? (building.function === 'domestic' ? 'dwelling.house' : building.function));
    }
  }
}
