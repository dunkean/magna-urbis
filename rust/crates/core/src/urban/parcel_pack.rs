//! Lossless binary pack of whole partitions, `magna-city-parcels` v1: the
//! parcels and programme of a town without the JSON text (a 1M town is too
//! large for one browser string). Coordinates and every other f64 are stored
//! bit for bit, ids become indices, strings go into u32 code tables.
//! `unpack(pack(p))` serialises with serde to exactly the text of `p`.
//!
//! Blob (little endian): `u32 header_len | header JSON (space-padded so that
//! 4 + header_len is a multiple of 8) | sections`, each section padded to 8
//! bytes; `header.sections[name] = {offset, type, length}` with `offset` in
//! bytes from the end of the header (a multiple of 8), `type` one of
//! `u8|u32|f64`, `length` in elements. n = parcels, r = rings, c = contacts,
//! a = allocations, j = adjacency records, e = environment records, all
//! global across the pack (partitions are consecutive ranges).
//!
//! Header members: `format`, `version`, the envelope members (`id`, `ms`,
//! `urbanSource`…), `groups` (present groups, in `GROUPS` order, `core` first),
//! `counts` {`partitions`, `parcels`, `allocations`, `adjacency`, `environment`}
//! (real counts even when a group is left out), `tables` {name: [strings]}
//! (every table always present, code 0 = "", codes by first appearance):
//! `use family reason provenance accessKind contactKind demand function culture
//! pack unit role label districtRole allocReason water floorNeed`, `sections`,
//! and `partitions`: one shell per partition, in order, with
//! `config?`, `programme?`, `key`, `warnings`, `diagnostics?`, `enclosure?`
//! (the exact serde JSON of those `Partition` fields, absent when `None`),
//! and the ranges `parcels`, `allocations`, `adjacency`, `environment` as
//! `[start, end)` into the global columns (empty when there is no programme).
//! `programme` (absent = `None`) holds the `UrbanProgramme` fields in serde
//! order without the three columnar lists: `version`, `population`, `context`,
//! `cultures`, `demands`, `reservations`, `reconciliationPasses`, `warnings`,
//! `housingCapacity`, `navigableFrontage`, `counts?`; `allocations`, `adjacency` and
//! `environment` go back between `reservations` and `reconciliationPasses`.
//!
//! Sections (MAX = u32::MAX; "codes" index the named table; "Strings" =
//! `<name>.offsets` u32[k+1] UTF-16 offsets into `<name>.text` u8 UTF-8):
//!
//! group `core` (always written)
//! - `parcels.polys` u32[n+1]: first ring of each parcel shape (into `parcels.rings`)
//! - `parcels.rings` u32[r+1]: first point of each ring; outer ring then holes
//! - `parcels.coords` f64[2*points]: absolute x, y
//! - `parcels.block` u32[n]; `parcels.rank` u32[n]
//! - `parcels.use` u32[n] codes `use`; `parcels.family` u32[n] codes `family`; `parcels.reason` u32[n] codes `reason`
//! - `parcels.pressure` f64[n]; `parcels.axis` f64[2n] (x, y)
//! - `parcels.front` f64[4n] (a.x, a.y, b.x, b.y; zeros when null); `parcels.hasFront` u8[n] (0 = `front: null`)
//! - `parcels.provenance.start` u32[n+1] into `parcels.provenance.codes` u32 codes `provenance`
//! - `parcels.access.present` u8[n] (0 = no `access` key); `parcels.access.kind` u32[n] codes `accessKind`;
//!   `parcels.access.street` u32[n] (MAX = null); `parcels.access.frontLength` f64[n]
//! - `parcels.id` Strings, n entries
//! - `shells.f64` f64[k]: every float of the `partitions` shells, depth-first with
//!   object members in sorted key order; the Rust reader restores them bit for bit
//!   (serde_json's parser may miss the last bit). JS `JSON.parse` is already exact: ignore it.
//!
//! group `envelope`
//! - `envelopes.polys` u32[n+1], `envelopes.rings` u32, `envelopes.coords` f64: as the
//!   parcel shapes; a parcel with 0 rings has no `envelope` key
//!
//! group `contacts`
//! - `contacts.start` u32[n+1]: first contact of each parcel
//! - `contacts.ab` f64[4c] (a.x, a.y, b.x, b.y); `contacts.street` u32[c]; `contacts.rank` u32[c];
//!   `contacts.length` f64[c]; `contacts.kind` u32[c] codes `contactKind`
//!
//! group `lineage`
//! - `parentIds.start` u32[n+1]: first parent id of each parcel; `parentIds` Strings (one per parent id)
//!
//! group `allocations`
//! - `allocations.parcel` u32[a]: global parcel index of `parcelId` (first parcel of the
//!   same partition with that id); MAX = orphan, its id is the next `allocations.orphan` string
//! - `allocations.orphan` Strings, one per orphan allocation in order
//! - codes u32[a]: `allocations.demand` (`demandId`, table `demand`), `allocations.function`,
//!   `allocations.culture`, `allocations.pack` (`architecturePack`, table `pack`), `allocations.unit`,
//!   `allocations.role`, `allocations.label`, `allocations.districtRole`
//! - `allocations.landmark` u8[a]
//! - f64[a]: `allocations.capacity`, `allocations.score`, `allocations.households`, `allocations.wealth`
//! - `allocations.reasons.start` u32[a+1] into `allocations.reasons.codes` u32 codes `allocReason`
//!
//! group `floorNeed` (the allocation's `housingFloorNeed`)
//! - `floorNeed.present` u8[a] (0 = no `housingFloorNeed` key)
//! - `floorNeed.codes` u32[7a] codes `floorNeed`: version, unit, scope, basis,
//!   model.family, model.profile_provenance, model.calibration (zeros when absent)
//! - `floorNeed.values` f64[7a]: requested_m2, allocated_households, model.floor_m2_per_household,
//!   model.wealth, model.wealth_factor, model.effective_floor_m2_per_household,
//!   model.persons_per_household (zeros when absent)
//!
//! group `adjacency`
//! - `adjacency.a` u32[j], `adjacency.b` u32[j]: global parcel indices (as allocations), MAX = orphan
//! - `adjacency.orphan` Strings: orphan ids in record order, `a` before `b`
//! - `adjacency.sharedLength` f64[j]
//!
//! group `environment`
//! - `environment.block` u32[e]; `environment.district` u32[e] (MAX = no `district` key)
//! - f64[e]: `environment.pressure`, `environment.slope`, `environment.height`, `environment.waterHeight`
//! - `environment.wet` u8[e]; `environment.waterfront` u8[e]
//! - `environment.water` u32[e] codes `water` ("" = no `water` key)
//!
//! A pack without some groups decodes with those fields empty (`envelope` and
//! `housingFloorNeed` absent, no contacts, parent ids, allocations, adjacency
//! or environment); only a full pack is an exact inverse.
use super::enclosure::Resolved;
use super::pack::{Codes, Strings, Writer};
use super::programme::{Adjacency, Allocation, BlockEnvironment, CountOutcome, Demand, ProgrammeContext, Reservation, UrbanProgramme};
use super::roles::{HousingFloorModel, HousingFloorNeed};
use super::{CultureMapping, Parcel, ParcelAccess, ParcelConfig, ParcelContact, Partition, PartitionDiagnostics, Point, Shape};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value, json};
use std::collections::HashMap;
use std::ops::Range;

pub const FORMAT: &str = "magna-city-parcels";
pub const VERSION: u32 = 1;
/// All groups: "core", "envelope", "contacts", "lineage", "allocations", "floorNeed", "adjacency", "environment".
pub const GROUPS: [&str; 8] = ["core", "envelope", "contacts", "lineage", "allocations", "floorNeed", "adjacency", "environment"];

/// u32 marker of an absent index (`None`, orphan id).
const NONE: u32 = u32::MAX;

fn count(v: usize, what: &str) -> Result<u32, String> {
    u32::try_from(v).map_err(|_| format!("parcel pack: {what} {v} exceeds u32"))
}
/// A present index: below the `NONE` marker.
fn index(v: usize, what: &str) -> Result<u32, String> {
    match u32::try_from(v) {
        Ok(c) if c != NONE => Ok(c),
        _ => Err(format!("parcel pack: {what} {v} exceeds u32")),
    }
}
fn opt(v: u32) -> Option<usize> {
    (v != NONE).then_some(v as usize)
}

/// The u32 code tables of the format, in header order.
struct Tables<'a> {
    use_kind: Codes<'a>,
    family: Codes<'a>,
    reason: Codes<'a>,
    provenance: Codes<'a>,
    access_kind: Codes<'a>,
    contact_kind: Codes<'a>,
    demand: Codes<'a>,
    function: Codes<'a>,
    culture: Codes<'a>,
    pack: Codes<'a>,
    unit: Codes<'a>,
    role: Codes<'a>,
    label: Codes<'a>,
    district_role: Codes<'a>,
    alloc_reason: Codes<'a>,
    water: Codes<'a>,
    floor_need: Codes<'a>,
}
impl<'a> Tables<'a> {
    fn new() -> Self {
        Self {
            use_kind: Codes::new(),
            family: Codes::new(),
            reason: Codes::new(),
            provenance: Codes::new(),
            access_kind: Codes::new(),
            contact_kind: Codes::new(),
            demand: Codes::new(),
            function: Codes::new(),
            culture: Codes::new(),
            pack: Codes::new(),
            unit: Codes::new(),
            role: Codes::new(),
            label: Codes::new(),
            district_role: Codes::new(),
            alloc_reason: Codes::new(),
            water: Codes::new(),
            floor_need: Codes::new(),
        }
    }
    fn into_json(self) -> Value {
        let mut out = Map::new();
        for (name, t) in [
            ("use", self.use_kind),
            ("family", self.family),
            ("reason", self.reason),
            ("provenance", self.provenance),
            ("accessKind", self.access_kind),
            ("contactKind", self.contact_kind),
            ("demand", self.demand),
            ("function", self.function),
            ("culture", self.culture),
            ("pack", self.pack),
            ("unit", self.unit),
            ("role", self.role),
            ("label", self.label),
            ("districtRole", self.district_role),
            ("allocReason", self.alloc_reason),
            ("water", self.water),
            ("floorNeed", self.floor_need),
        ] {
            out.insert(name.into(), json!(t.names));
        }
        Value::Object(out)
    }
}

/// f64 polygons: `polys` (n+1 ring starts), `rings` (r+1 point starts), `coords`.
struct Rings {
    polys: Vec<u32>,
    rings: Vec<u32>,
    coords: Vec<f64>,
}
impl Rings {
    fn new() -> Self {
        Self { polys: vec![0], rings: vec![0], coords: vec![] }
    }
    /// `None` writes no ring.
    fn push(&mut self, shape: Option<&Shape>) -> Result<(), String> {
        if let Some(shape) = shape {
            for ring in std::iter::once(&shape.outer).chain(&shape.holes) {
                for p in ring {
                    self.coords.extend([p.x, p.y]);
                }
                self.rings.push(count(self.coords.len() / 2, "points")?);
            }
        }
        self.polys.push(count(self.rings.len() - 1, "rings")?);
        Ok(())
    }
    fn write(self, w: &mut Writer, layer: &str) {
        w.u32s(&format!("{layer}.polys"), &self.polys);
        w.u32s(&format!("{layer}.rings"), &self.rings);
        w.f64s(&format!("{layer}.coords"), &self.coords);
    }
}

/// Header shell of one partition: its non-columnar fields as their own serde JSON.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    config: Option<&'a ParcelConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    programme: Option<ProgrammeOut<'a>>,
    key: &'a str,
    warnings: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostics: Option<&'a PartitionDiagnostics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enclosure: Option<&'a Resolved>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prepared: Option<&'a super::PreparedBlocks>,
    parcels: [usize; 2],
    allocations: [usize; 2],
    adjacency: [usize; 2],
    environment: [usize; 2],
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgrammeOut<'a> {
    version: u32,
    population: u32,
    context: &'a ProgrammeContext,
    cultures: &'a [CultureMapping],
    demands: &'a [Demand],
    reservations: &'a [Reservation],
    reconciliation_passes: usize,
    warnings: &'a [String],
    housing_capacity: f64,
    navigable_frontage: bool,
    #[serde(skip_serializing_if = "no_counts")]
    counts: &'a [CountOutcome],
}
fn no_counts(counts: &&[CountOutcome]) -> bool { counts.is_empty() }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellIn {
    #[serde(default)]
    config: Option<ParcelConfig>,
    #[serde(default)]
    programme: Option<ProgrammeIn>,
    key: String,
    warnings: Vec<String>,
    #[serde(default)]
    diagnostics: Option<PartitionDiagnostics>,
    #[serde(default)]
    enclosure: Option<Resolved>,
    #[serde(default)]
    prepared: Option<super::PreparedBlocks>,
    parcels: [usize; 2],
    allocations: [usize; 2],
    adjacency: [usize; 2],
    environment: [usize; 2],
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgrammeIn {
    version: u32,
    population: u32,
    context: ProgrammeContext,
    cultures: Vec<CultureMapping>,
    demands: Vec<Demand>,
    reservations: Vec<Reservation>,
    reconciliation_passes: usize,
    warnings: Vec<String>,
    housing_capacity: f64,
    navigable_frontage: bool,
    #[serde(default)]
    counts: Vec<CountOutcome>,
}

/// Floats of a JSON value, depth first, object members in map order.
fn floats(v: &Value, out: &mut Vec<f64>) {
    match v {
        Value::Number(x) => {
            if x.is_f64() {
                out.extend(x.as_f64());
            }
        }
        Value::Array(items) => {
            for item in items {
                floats(item, out);
            }
        }
        Value::Object(members) => {
            for item in members.values() {
                floats(item, out);
            }
        }
        _ => {}
    }
}
/// Replaces the floats of a parsed JSON value by their exact values, in `floats` order.
fn patch(v: &mut Value, exact: &[f64], at: &mut usize) -> Result<(), String> {
    match v {
        Value::Number(x) => {
            if x.is_f64() {
                let bits = *exact.get(*at).ok_or("parcel pack: shells.f64 is too short")?;
                *at += 1;
                *x = Number::from_f64(bits).ok_or("parcel pack: non-finite shell float")?;
            }
        }
        Value::Array(items) => {
            for item in items {
                patch(item, exact, at)?;
            }
        }
        Value::Object(members) => {
            for item in members.values_mut() {
                patch(item, exact, at)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Packs whole partitions. `groups`: None = every group; "core" is always written.
/// `envelope`: a JSON object whose members are copied into the header (the reply's `id`, `ms`, `urbanSource`); pass `&serde_json::Value::Null` for none.
pub fn pack(partitions: &[Partition], groups: Option<&[&str]>, envelope: &Value) -> Result<Vec<u8>, String> {
    let mut on = [true; 8];
    if let Some(list) = groups {
        if let Some(g) = list.iter().find(|g| !GROUPS.contains(*g)) {
            return Err(format!("parcel pack: unknown group `{g}`"));
        }
        for (i, g) in GROUPS.iter().enumerate() {
            on[i] = i == 0 || list.contains(g);
        }
    }
    let [_, envelopes_on, contacts_on, lineage_on, allocations_on, floor_on, adjacency_on, environment_on] = on;
    let mut t = Tables::new();
    // core
    let mut shapes = Rings::new();
    let (mut p_block, mut p_use, mut p_rank, mut p_family, mut p_reason) = (vec![], vec![], vec![], vec![], vec![]);
    let (mut p_pressure, mut p_axis, mut p_front, mut p_has_front) = (vec![], vec![], vec![], vec![]);
    let (mut p_provenance_start, mut p_provenance_codes) = (vec![0u32], vec![]);
    let (mut p_access_present, mut p_access_kind, mut p_access_street, mut p_access_front) = (vec![], vec![], vec![], vec![]);
    let mut p_ids = Strings::default();
    // envelope, contacts, lineage
    let mut envelopes = Rings::new();
    let (mut c_start, mut c_ab, mut c_street, mut c_rank, mut c_length, mut c_kind) = (vec![0u32], vec![], vec![], vec![], vec![], vec![]);
    let (mut l_start, mut l_ids, mut l_count) = (vec![0u32], Strings::default(), 0usize);
    // allocations, floorNeed
    let (mut a_parcel, mut a_orphans) = (vec![], Strings::default());
    let (mut a_demand, mut a_function, mut a_culture, mut a_pack) = (vec![], vec![], vec![], vec![]);
    let (mut a_unit, mut a_role, mut a_label, mut a_district) = (vec![], vec![], vec![], vec![]);
    let (mut a_landmark, mut a_capacity, mut a_score, mut a_households, mut a_wealth) = (vec![], vec![], vec![], vec![], vec![]);
    let mut a_residents = vec![];
    let (mut a_reasons_start, mut a_reasons_codes) = (vec![0u32], vec![]);
    let (mut f_present, mut f_codes, mut f_values) = (vec![], vec![], vec![]);
    // adjacency, environment
    let (mut j_a, mut j_b, mut j_orphans, mut j_length) = (vec![], vec![], Strings::default(), vec![]);
    let (mut e_block, mut e_district, mut e_pressure, mut e_slope, mut e_height) = (vec![], vec![], vec![], vec![], vec![]);
    let (mut e_water_height, mut e_wet, mut e_waterfront, mut e_water) = (vec![], vec![], vec![], vec![]);
    let (mut n, mut na, mut nj, mut ne) = (0usize, 0usize, 0usize, 0usize);
    let mut shells = Vec::with_capacity(partitions.len());
    for partition in partitions {
        let Partition { config, programme, key, parcels, warnings, diagnostics, enclosure, prepared } = partition;
        let first = n;
        // Ids resolve to the first parcel of this partition that bears them.
        let mut by_id: HashMap<&str, u32> = HashMap::with_capacity(parcels.len());
        for parcel in parcels {
            let Parcel {
                pressure, envelope, id, parent_ids, provenance, family, reason, contacts, shape, block, use_kind, front, axis,
                rank, access,
            } = parcel;
            by_id.entry(id.as_str()).or_insert(index(n, "parcel")?);
            shapes.push(Some(shape))?;
            p_block.push(count(*block, "block")?);
            p_use.push(t.use_kind.code(use_kind)?);
            p_rank.push(count(*rank, "rank")?);
            p_family.push(t.family.code(family)?);
            p_reason.push(t.reason.code(reason)?);
            p_pressure.push(*pressure);
            p_axis.extend([axis.x, axis.y]);
            match front {
                Some([a, b]) => {
                    p_front.extend([a.x, a.y, b.x, b.y]);
                    p_has_front.push(1u8);
                }
                None => {
                    p_front.extend([0.0; 4]);
                    p_has_front.push(0);
                }
            }
            for p in provenance {
                p_provenance_codes.push(t.provenance.code(p)?);
            }
            p_provenance_start.push(count(p_provenance_codes.len(), "provenance entries")?);
            match access {
                Some(ParcelAccess { kind, street, front_length }) => {
                    p_access_present.push(1u8);
                    p_access_kind.push(t.access_kind.code(kind)?);
                    p_access_street.push(match street {
                        Some(s) => index(*s, "access street")?,
                        None => NONE,
                    });
                    p_access_front.push(*front_length);
                }
                None => {
                    p_access_present.push(0);
                    p_access_kind.push(0);
                    p_access_street.push(NONE);
                    p_access_front.push(0.0);
                }
            }
            p_ids.try_push(id)?;
            if envelopes_on {
                envelopes.push(envelope.as_ref())?;
            }
            if contacts_on {
                for ParcelContact { a, b, street, rank, length, kind } in contacts {
                    c_ab.extend([a.x, a.y, b.x, b.y]);
                    c_street.push(count(*street, "contact street")?);
                    c_rank.push(count(*rank, "contact rank")?);
                    c_length.push(*length);
                    c_kind.push(t.contact_kind.code(kind)?);
                }
                c_start.push(count(c_street.len(), "contacts")?);
            }
            if lineage_on {
                for parent in parent_ids {
                    l_ids.try_push(parent)?;
                }
                l_count += parent_ids.len();
                l_start.push(count(l_count, "parent ids")?);
            }
            n += 1;
        }
        let (a0, j0, e0) = (na, nj, ne);
        let programme_out = match programme {
            None => None,
            Some(programme) => {
                let UrbanProgramme {
                    version, population, context, cultures, demands, reservations, allocations, adjacency, environment,
                    reconciliation_passes, warnings: programme_warnings, housing_capacity, navigable_frontage, counts,
                } = programme;
                na += allocations.len();
                nj += adjacency.len();
                ne += environment.len();
                for allocation in allocations {
                    let Allocation {
                        parcel_id, demand_id, function, culture, architecture_pack, capacity, unit, score, reasons, role, label,
                        landmark, households, residents, housing_floor_need, district_role, wealth,
                    } = allocation;
                    if allocations_on {
                        a_parcel.push(match by_id.get(parcel_id.as_str()) {
                            Some(&i) => i,
                            None => {
                                a_orphans.try_push(parcel_id)?;
                                NONE
                            }
                        });
                        a_demand.push(t.demand.code(demand_id)?);
                        a_function.push(t.function.code(function)?);
                        a_culture.push(t.culture.code(culture)?);
                        a_pack.push(t.pack.code(architecture_pack)?);
                        a_unit.push(t.unit.code(unit)?);
                        a_role.push(t.role.code(role)?);
                        a_label.push(t.label.code(label)?);
                        a_district.push(t.district_role.code(district_role)?);
                        a_landmark.push(u8::from(*landmark));
                        a_capacity.push(*capacity);
                        a_score.push(*score);
                        a_households.push(*households);
                        a_residents.push(residents.unwrap_or(-1.));
                        a_wealth.push(*wealth);
                        for r in reasons {
                            a_reasons_codes.push(t.alloc_reason.code(r)?);
                        }
                        a_reasons_start.push(count(a_reasons_codes.len(), "allocation reasons")?);
                    }
                    if floor_on {
                        match housing_floor_need {
                            Some(HousingFloorNeed {
                                version, unit, scope, requested_m2, allocated_households, basis,
                                model: HousingFloorModel {
                                    family, profile_provenance, calibration, floor_m2_per_household, wealth, wealth_factor,
                                    effective_floor_m2_per_household, persons_per_household,
                                },
                            }) => {
                                f_present.push(1u8);
                                for s in [version, unit, scope, basis, family, profile_provenance, calibration] {
                                    f_codes.push(t.floor_need.code(s)?);
                                }
                                f_values.extend([
                                    *requested_m2, *allocated_households, *floor_m2_per_household, *wealth, *wealth_factor,
                                    *effective_floor_m2_per_household, *persons_per_household,
                                ]);
                            }
                            None => {
                                f_present.push(0);
                                f_codes.extend([0u32; 7]);
                                f_values.extend([0.0; 7]);
                            }
                        }
                    }
                }
                if adjacency_on {
                    for Adjacency { a, b, shared_length } in adjacency {
                        // Orphan ids follow in record order, `a` before `b`.
                        for (id, column) in [(a, &mut j_a), (b, &mut j_b)] {
                            column.push(match by_id.get(id.as_str()) {
                                Some(&i) => i,
                                None => {
                                    j_orphans.try_push(id)?;
                                    NONE
                                }
                            });
                        }
                        j_length.push(*shared_length);
                    }
                }
                if environment_on {
                    for BlockEnvironment { pressure, block, slope, wet, waterfront, height, district, water, water_height } in environment {
                        e_block.push(count(*block, "environment block")?);
                        e_district.push(match district {
                            Some(d) => index(*d, "district")?,
                            None => NONE,
                        });
                        e_pressure.push(*pressure);
                        e_slope.push(*slope);
                        e_height.push(*height);
                        e_water_height.push(*water_height);
                        e_wet.push(u8::from(*wet));
                        e_waterfront.push(u8::from(*waterfront));
                        e_water.push(t.water.code(water)?);
                    }
                }
                Some(ProgrammeOut {
                    version: *version,
                    population: *population,
                    context,
                    cultures,
                    demands,
                    reservations,
                    reconciliation_passes: *reconciliation_passes,
                    warnings: programme_warnings,
                    housing_capacity: *housing_capacity,
                    navigable_frontage: *navigable_frontage,
                    counts,
                })
            }
        };
        shells.push(ShellOut {
            config: config.as_ref(),
            programme: programme_out,
            key,
            warnings,
            diagnostics: diagnostics.as_ref(),
            enclosure: enclosure.as_ref(),
            prepared: prepared.as_ref(),
            parcels: [first, n],
            allocations: [a0, na],
            adjacency: [j0, nj],
            environment: [e0, ne],
        });
    }
    // The Rust reader parses the header with serde_json, which may miss the
    // last bit of a float: the shells' floats also travel exactly.
    let mut shell_floats = vec![];
    floats(&serde_json::to_value(&shells).map_err(|e| format!("parcel pack shells: {e}"))?, &mut shell_floats);
    let shells_text = serde_json::to_vec(&shells).map_err(|e| format!("parcel pack shells: {e}"))?;

    let mut w = Writer::aligned8();
    shapes.write(&mut w, "parcels");
    w.u32s("parcels.block", &p_block);
    w.u32s("parcels.rank", &p_rank);
    w.u32s("parcels.use", &p_use);
    w.u32s("parcels.family", &p_family);
    w.u32s("parcels.reason", &p_reason);
    w.f64s("parcels.pressure", &p_pressure);
    w.f64s("parcels.axis", &p_axis);
    w.f64s("parcels.front", &p_front);
    w.u8s("parcels.hasFront", &p_has_front);
    w.u32s("parcels.provenance.start", &p_provenance_start);
    w.u32s("parcels.provenance.codes", &p_provenance_codes);
    w.u8s("parcels.access.present", &p_access_present);
    w.u32s("parcels.access.kind", &p_access_kind);
    w.u32s("parcels.access.street", &p_access_street);
    w.f64s("parcels.access.frontLength", &p_access_front);
    p_ids.write(&mut w, "parcels.id");
    w.f64s("shells.f64", &shell_floats);
    if envelopes_on {
        envelopes.write(&mut w, "envelopes");
    }
    if contacts_on {
        w.u32s("contacts.start", &c_start);
        w.f64s("contacts.ab", &c_ab);
        w.u32s("contacts.street", &c_street);
        w.u32s("contacts.rank", &c_rank);
        w.f64s("contacts.length", &c_length);
        w.u32s("contacts.kind", &c_kind);
    }
    if lineage_on {
        w.u32s("parentIds.start", &l_start);
        l_ids.write(&mut w, "parentIds");
    }
    if allocations_on {
        w.u32s("allocations.parcel", &a_parcel);
        a_orphans.write(&mut w, "allocations.orphan");
        w.u32s("allocations.demand", &a_demand);
        w.u32s("allocations.function", &a_function);
        w.u32s("allocations.culture", &a_culture);
        w.u32s("allocations.pack", &a_pack);
        w.u32s("allocations.unit", &a_unit);
        w.u32s("allocations.role", &a_role);
        w.u32s("allocations.label", &a_label);
        w.u32s("allocations.districtRole", &a_district);
        w.u8s("allocations.landmark", &a_landmark);
        w.f64s("allocations.capacity", &a_capacity);
        w.f64s("allocations.score", &a_score);
        w.f64s("allocations.households", &a_households);
        if a_residents.iter().any(|&n| n >= 0.) { w.f64s("allocations.residents", &a_residents); }
        w.f64s("allocations.wealth", &a_wealth);
        w.u32s("allocations.reasons.start", &a_reasons_start);
        w.u32s("allocations.reasons.codes", &a_reasons_codes);
    }
    if floor_on {
        w.u8s("floorNeed.present", &f_present);
        w.u32s("floorNeed.codes", &f_codes);
        w.f64s("floorNeed.values", &f_values);
    }
    if adjacency_on {
        w.u32s("adjacency.a", &j_a);
        w.u32s("adjacency.b", &j_b);
        j_orphans.write(&mut w, "adjacency.orphan");
        w.f64s("adjacency.sharedLength", &j_length);
    }
    if environment_on {
        w.u32s("environment.block", &e_block);
        w.u32s("environment.district", &e_district);
        w.f64s("environment.pressure", &e_pressure);
        w.f64s("environment.slope", &e_slope);
        w.f64s("environment.height", &e_height);
        w.f64s("environment.waterHeight", &e_water_height);
        w.u8s("environment.wet", &e_wet);
        w.u8s("environment.waterfront", &e_waterfront);
        w.u32s("environment.water", &e_water);
    }

    let mut header = match envelope {
        Value::Null => Map::new(),
        Value::Object(members) => members.clone(),
        _ => return Err("parcel pack: the envelope must be a JSON object or null".into()),
    };
    header.remove("partitions");
    header.insert("format".into(), json!(FORMAT));
    header.insert("version".into(), json!(VERSION));
    let present: Vec<&str> = GROUPS.iter().zip(on).filter(|(_, kept)| *kept).map(|(g, _)| *g).collect();
    header.insert("groups".into(), json!(present));
    header.insert(
        "counts".into(),
        json!({"partitions": partitions.len(), "parcels": n, "allocations": na, "adjacency": nj, "environment": ne}),
    );
    header.insert("tables".into(), t.into_json());
    w.try_finish(Value::Object(header), Some(("partitions", shells_text.as_slice())))
}

/// Header and body of a pack, after the format checks.
fn open(bytes: &[u8]) -> Result<(Value, &[u8]), String> {
    let len = bytes.get(..4).ok_or("parcel pack: truncated header length")?;
    let head_len = u32::from_le_bytes([len[0], len[1], len[2], len[3]]) as usize;
    let start = head_len.checked_add(4).ok_or("parcel pack: header length overflows")?;
    let head = bytes.get(4..start).ok_or("parcel pack: truncated header")?;
    let header: Value = serde_json::from_slice(head).map_err(|e| format!("parcel pack header: {e}"))?;
    if header["format"].as_str() != Some(FORMAT) {
        return Err(format!("parcel pack: format {} is not {FORMAT}", header["format"]));
    }
    if header["version"].as_u64() != Some(u64::from(VERSION)) {
        return Err(format!("parcel pack: version {} is not {VERSION}", header["version"]));
    }
    if start % 8 != 0 {
        return Err("parcel pack: sections are not 8-byte aligned".into());
    }
    Ok((header, &bytes[start..]))
}

/// Takes the partition shells out of the header and restores their exact floats.
fn take_shells(header: &mut Value, body: &[u8]) -> Result<Value, String> {
    let mut shells = header.get_mut("partitions").map(Value::take).ok_or("parcel pack: no partitions in the header")?;
    let exact = Sections::new(header, body)?.f64r("shells.f64", None)?;
    let mut at = 0;
    patch(&mut shells, &exact, &mut at)?;
    if at != exact.len() {
        return Err("parcel pack: shells.f64 does not match the shells".into());
    }
    Ok(shells)
}

/// Section reader over the body of a pack.
struct Sections<'a> {
    map: &'a Map<String, Value>,
    body: &'a [u8],
}
impl<'a> Sections<'a> {
    fn new(header: &'a Value, body: &'a [u8]) -> Result<Self, String> {
        let map = header["sections"].as_object().ok_or("parcel pack: no sections in the header")?;
        Ok(Self { map, body })
    }
    /// Bytes of a section (None when absent), checked against its type,
    /// expected length, alignment and the body size.
    fn raw(&self, name: &str, kind: &str, size: usize, len: Option<usize>) -> Result<Option<&'a [u8]>, String> {
        let Some(s) = self.map.get(name) else { return Ok(None) };
        if s["type"].as_str() != Some(kind) {
            return Err(format!("parcel pack: section {name} is not {kind}"));
        }
        let number = |key: &str| {
            s[key].as_u64().and_then(|v| usize::try_from(v).ok()).ok_or_else(|| format!("parcel pack: section {name} has no {key}"))
        };
        let (offset, length) = (number("offset")?, number("length")?);
        if let Some(len) = len {
            if length != len {
                return Err(format!("parcel pack: section {name} holds {length} values, {len} expected"));
            }
        }
        if offset % size != 0 {
            return Err(format!("parcel pack: section {name} is misaligned"));
        }
        let end = length
            .checked_mul(size)
            .and_then(|bytes| bytes.checked_add(offset))
            .ok_or_else(|| format!("parcel pack: section {name} overflows"))?;
        let body: &'a [u8] = self.body;
        body.get(offset..end).map(Some).ok_or_else(|| format!("parcel pack: section {name} is truncated"))
    }
    fn u8s(&self, name: &str, len: Option<usize>) -> Result<Option<&'a [u8]>, String> {
        self.raw(name, "u8", 1, len)
    }
    fn u32s(&self, name: &str, len: Option<usize>) -> Result<Option<Vec<u32>>, String> {
        Ok(self
            .raw(name, "u32", 4, len)?
            .map(|b| b.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()))
    }
    fn f64s(&self, name: &str, len: Option<usize>) -> Result<Option<Vec<f64>>, String> {
        Ok(self.raw(name, "f64", 8, len)?.map(|b| {
            b.chunks_exact(8)
                .map(|c| {
                    let mut a = [0u8; 8];
                    a.copy_from_slice(c);
                    f64::from_le_bytes(a)
                })
                .collect()
        }))
    }
    fn strings(&self, name: &str, len: Option<usize>) -> Result<Option<Vec<&'a str>>, String> {
        let offsets = self.u32s(&format!("{name}.offsets"), len.map(|n| n + 1))?;
        let text = self.u8s(&format!("{name}.text"), None)?;
        match (offsets, text) {
            (Some(offsets), Some(text)) => utf16_slices(&offsets, text, name).map(Some),
            (None, None) => Ok(None),
            _ => Err(format!("parcel pack: strings {name} are incomplete")),
        }
    }
    fn u8r(&self, name: &str, len: Option<usize>) -> Result<&'a [u8], String> {
        need(self.u8s(name, len)?, name)
    }
    fn u32r(&self, name: &str, len: Option<usize>) -> Result<Vec<u32>, String> {
        need(self.u32s(name, len)?, name)
    }
    fn f64r(&self, name: &str, len: Option<usize>) -> Result<Vec<f64>, String> {
        need(self.f64s(name, len)?, name)
    }
    fn strings_r(&self, name: &str, len: Option<usize>) -> Result<Vec<&'a str>, String> {
        need(self.strings(name, len)?, name)
    }
}
fn need<T>(v: Option<T>, name: &str) -> Result<T, String> {
    v.ok_or_else(|| format!("parcel pack: missing section {name}"))
}

/// Slices one UTF-8 text at UTF-16 offsets (the JS reader's units).
fn utf16_slices<'t>(offsets: &[u32], text: &'t [u8], name: &str) -> Result<Vec<&'t str>, String> {
    let bad = || format!("parcel pack: malformed strings {name}");
    let text = std::str::from_utf8(text).map_err(|_| bad())?;
    if offsets.first() != Some(&0) {
        return Err(bad());
    }
    let mut chars = text.chars();
    let (mut unit, mut byte, mut start) = (0u64, 0usize, 0usize);
    let mut out = Vec::with_capacity(offsets.len() - 1);
    for &end in &offsets[1..] {
        let end = u64::from(end);
        while unit < end {
            let c = chars.next().ok_or_else(bad)?;
            unit += c.len_utf16() as u64;
            byte += c.len_utf8();
        }
        if unit != end {
            return Err(bad());
        }
        out.push(&text[start..byte]);
        start = byte;
    }
    if byte != text.len() {
        return Err(bad());
    }
    Ok(out)
}

fn span(starts: &[u32], i: usize, total: usize) -> Result<Range<usize>, String> {
    match (starts.get(i), starts.get(i + 1)) {
        (Some(&a), Some(&b)) if a <= b && b as usize <= total => Ok(a as usize..b as usize),
        _ => Err(format!("parcel pack: malformed span {i}")),
    }
}
fn range([start, end]: [usize; 2], total: usize, what: &str) -> Result<Range<usize>, String> {
    if start <= end && end <= total {
        Ok(start..end)
    } else {
        Err(format!("parcel pack: {what} range {start}..{end} out of {total}"))
    }
}
fn table<'h>(header: &'h Value, name: &str) -> Result<Vec<&'h str>, String> {
    header["tables"][name]
        .as_array()
        .ok_or_else(|| format!("parcel pack: no table {name}"))?
        .iter()
        .map(|v| v.as_str().ok_or_else(|| format!("parcel pack: table {name} holds a non-string")))
        .collect()
}
fn named(table: &[&str], code: u32, name: &str) -> Result<String, String> {
    table
        .get(code as usize)
        .map(|s| (*s).to_owned())
        .ok_or_else(|| format!("parcel pack: code {code} out of table {name}"))
}

/// f64 polygons read back.
struct ShapesIn {
    polys: Vec<u32>,
    rings: Vec<u32>,
    coords: Vec<f64>,
}
impl ShapesIn {
    fn read(s: &Sections<'_>, layer: &str, n: usize) -> Result<Self, String> {
        let polys = s.u32r(&format!("{layer}.polys"), Some(n + 1))?;
        let rings = s.u32r(&format!("{layer}.rings"), None)?;
        let coords = s.f64r(&format!("{layer}.coords"), None)?;
        if rings.is_empty() || coords.len() % 2 != 0 {
            return Err(format!("parcel pack: malformed {layer}"));
        }
        Ok(Self { polys, rings, coords })
    }
    /// Shape `i`; None when it has no ring.
    fn shape(&self, i: usize) -> Result<Option<Shape>, String> {
        let mut rings = vec![];
        for r in span(&self.polys, i, self.rings.len() - 1)? {
            let points = span(&self.rings, r, self.coords.len() / 2)?;
            rings.push(points.map(|p| Point { x: self.coords[2 * p], y: self.coords[2 * p + 1] }).collect::<Vec<_>>());
        }
        let mut rings = rings.into_iter();
        let outer = rings.next();
        Ok(outer.map(|outer| Shape { outer, holes: rings.collect() }))
    }
}
struct ContactsIn {
    start: Vec<u32>,
    ab: Vec<f64>,
    street: Vec<u32>,
    rank: Vec<u32>,
    length: Vec<f64>,
    kind: Vec<u32>,
}
struct AllocationsIn<'a> {
    /// `parcelId` of each allocation (parcel id or orphan id).
    ids: Vec<&'a str>,
    demand: Vec<u32>,
    function: Vec<u32>,
    culture: Vec<u32>,
    pack: Vec<u32>,
    unit: Vec<u32>,
    role: Vec<u32>,
    label: Vec<u32>,
    district: Vec<u32>,
    landmark: &'a [u8],
    capacity: Vec<f64>,
    score: Vec<f64>,
    households: Vec<f64>,
    residents: Option<Vec<f64>>,
    wealth: Vec<f64>,
    reasons_start: Vec<u32>,
    reasons_codes: Vec<u32>,
}
struct FloorIn<'a> {
    present: &'a [u8],
    codes: Vec<u32>,
    values: Vec<f64>,
}
struct AdjacencyIn<'a> {
    a: Vec<&'a str>,
    b: Vec<&'a str>,
    length: Vec<f64>,
}
struct EnvironmentIn<'a> {
    block: Vec<u32>,
    district: Vec<u32>,
    pressure: Vec<f64>,
    slope: Vec<f64>,
    height: Vec<f64>,
    water_height: Vec<f64>,
    wet: &'a [u8],
    waterfront: &'a [u8],
    water: Vec<u32>,
}

/// Exact inverse for a pack that holds every group: `serde_json::to_string(&unpack(&pack(p, None, ..)?)?)` equals `serde_json::to_string(p)`.
pub fn unpack(bytes: &[u8]) -> Result<Vec<Partition>, String> {
    let (mut header, body) = open(bytes)?;
    let shells: Vec<ShellIn> =
        serde_json::from_value(take_shells(&mut header, body)?).map_err(|e| format!("parcel pack shells: {e}"))?;
    let s = Sections::new(&header, body)?;
    let groups: Vec<&str> = header["groups"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let has = |g: &str| groups.iter().any(|x| *x == g);
    let t_use = table(&header, "use")?;
    let t_family = table(&header, "family")?;
    let t_reason = table(&header, "reason")?;
    let t_provenance = table(&header, "provenance")?;
    let t_access_kind = table(&header, "accessKind")?;
    let t_contact_kind = table(&header, "contactKind")?;
    let t_demand = table(&header, "demand")?;
    let t_function = table(&header, "function")?;
    let t_culture = table(&header, "culture")?;
    let t_pack = table(&header, "pack")?;
    let t_unit = table(&header, "unit")?;
    let t_role = table(&header, "role")?;
    let t_label = table(&header, "label")?;
    let t_district_role = table(&header, "districtRole")?;
    let t_alloc_reason = table(&header, "allocReason")?;
    let t_water = table(&header, "water")?;
    let t_floor_need = table(&header, "floorNeed")?;

    // core
    let p_block = s.u32r("parcels.block", None)?;
    let n = p_block.len();
    let shapes = ShapesIn::read(&s, "parcels", n)?;
    let p_rank = s.u32r("parcels.rank", Some(n))?;
    let p_use = s.u32r("parcels.use", Some(n))?;
    let p_family = s.u32r("parcels.family", Some(n))?;
    let p_reason = s.u32r("parcels.reason", Some(n))?;
    let p_pressure = s.f64r("parcels.pressure", Some(n))?;
    let p_axis = s.f64r("parcels.axis", Some(2 * n))?;
    let p_front = s.f64r("parcels.front", Some(4 * n))?;
    let p_has_front = s.u8r("parcels.hasFront", Some(n))?;
    let p_provenance_start = s.u32r("parcels.provenance.start", Some(n + 1))?;
    let p_provenance_codes = s.u32r("parcels.provenance.codes", None)?;
    let p_access_present = s.u8r("parcels.access.present", Some(n))?;
    let p_access_kind = s.u32r("parcels.access.kind", Some(n))?;
    let p_access_street = s.u32r("parcels.access.street", Some(n))?;
    let p_access_front = s.f64r("parcels.access.frontLength", Some(n))?;
    let ids = s.strings_r("parcels.id", Some(n))?;
    let parcel_id = |p: u32| ids.get(p as usize).copied().ok_or_else(|| format!("parcel pack: parcel index {p} out of range"));

    let envelopes = if has("envelope") { Some(ShapesIn::read(&s, "envelopes", n)?) } else { None };
    let contact_cols = if has("contacts") {
        let start = s.u32r("contacts.start", Some(n + 1))?;
        let street = s.u32r("contacts.street", None)?;
        let c = street.len();
        Some(ContactsIn {
            start,
            ab: s.f64r("contacts.ab", Some(4 * c))?,
            street,
            rank: s.u32r("contacts.rank", Some(c))?,
            length: s.f64r("contacts.length", Some(c))?,
            kind: s.u32r("contacts.kind", Some(c))?,
        })
    } else {
        None
    };
    let parents = if has("lineage") {
        Some((s.u32r("parentIds.start", Some(n + 1))?, s.strings_r("parentIds", None)?))
    } else {
        None
    };
    let allocs = if has("allocations") {
        let parcel = s.u32r("allocations.parcel", None)?;
        let a = parcel.len();
        let orphans = s.strings_r("allocations.orphan", None)?;
        let mut orphan = orphans.iter().copied();
        let mut alloc_ids = Vec::with_capacity(a);
        for &p in &parcel {
            alloc_ids.push(if p == NONE {
                orphan.next().ok_or("parcel pack: missing orphan allocation id")?
            } else {
                parcel_id(p)?
            });
        }
        if orphan.next().is_some() {
            return Err("parcel pack: unused orphan allocation ids".into());
        }
        Some(AllocationsIn {
            ids: alloc_ids,
            demand: s.u32r("allocations.demand", Some(a))?,
            function: s.u32r("allocations.function", Some(a))?,
            culture: s.u32r("allocations.culture", Some(a))?,
            pack: s.u32r("allocations.pack", Some(a))?,
            unit: s.u32r("allocations.unit", Some(a))?,
            role: s.u32r("allocations.role", Some(a))?,
            label: s.u32r("allocations.label", Some(a))?,
            district: s.u32r("allocations.districtRole", Some(a))?,
            landmark: s.u8r("allocations.landmark", Some(a))?,
            capacity: s.f64r("allocations.capacity", Some(a))?,
            score: s.f64r("allocations.score", Some(a))?,
            households: s.f64r("allocations.households", Some(a))?,
            residents: s.f64s("allocations.residents", Some(a))?,
            wealth: s.f64r("allocations.wealth", Some(a))?,
            reasons_start: s.u32r("allocations.reasons.start", Some(a + 1))?,
            reasons_codes: s.u32r("allocations.reasons.codes", None)?,
        })
    } else {
        None
    };
    // The floor need belongs to the allocations: read only along with them.
    let floor = match &allocs {
        Some(c) if has("floorNeed") => {
            let a = c.ids.len();
            Some(FloorIn {
                present: s.u8r("floorNeed.present", Some(a))?,
                codes: s.u32r("floorNeed.codes", Some(7 * a))?,
                values: s.f64r("floorNeed.values", Some(7 * a))?,
            })
        }
        _ => None,
    };
    let adjacency_cols = if has("adjacency") {
        let ia = s.u32r("adjacency.a", None)?;
        let j = ia.len();
        let ib = s.u32r("adjacency.b", Some(j))?;
        let orphans = s.strings_r("adjacency.orphan", None)?;
        let mut orphan = orphans.iter().copied();
        let (mut a, mut b) = (Vec::with_capacity(j), Vec::with_capacity(j));
        for k in 0..j {
            for (p, column) in [(ia[k], &mut a), (ib[k], &mut b)] {
                column.push(if p == NONE {
                    orphan.next().ok_or("parcel pack: missing orphan adjacency id")?
                } else {
                    parcel_id(p)?
                });
            }
        }
        if orphan.next().is_some() {
            return Err("parcel pack: unused orphan adjacency ids".into());
        }
        Some(AdjacencyIn { a, b, length: s.f64r("adjacency.sharedLength", Some(j))? })
    } else {
        None
    };
    let environment_cols = if has("environment") {
        let block = s.u32r("environment.block", None)?;
        let e = block.len();
        Some(EnvironmentIn {
            block,
            district: s.u32r("environment.district", Some(e))?,
            pressure: s.f64r("environment.pressure", Some(e))?,
            slope: s.f64r("environment.slope", Some(e))?,
            height: s.f64r("environment.height", Some(e))?,
            water_height: s.f64r("environment.waterHeight", Some(e))?,
            wet: s.u8r("environment.wet", Some(e))?,
            waterfront: s.u8r("environment.waterfront", Some(e))?,
            water: s.u32r("environment.water", Some(e))?,
        })
    } else {
        None
    };

    let parcel = |i: usize| -> Result<Parcel, String> {
        let provenance = span(&p_provenance_start, i, p_provenance_codes.len())?
            .map(|k| named(&t_provenance, p_provenance_codes[k], "provenance"))
            .collect::<Result<Vec<_>, _>>()?;
        let contacts = match &contact_cols {
            None => vec![],
            Some(c) => span(&c.start, i, c.street.len())?
                .map(|k| -> Result<ParcelContact, String> {
                    Ok(ParcelContact {
                        a: Point { x: c.ab[4 * k], y: c.ab[4 * k + 1] },
                        b: Point { x: c.ab[4 * k + 2], y: c.ab[4 * k + 3] },
                        street: c.street[k] as usize,
                        rank: c.rank[k] as usize,
                        length: c.length[k],
                        kind: named(&t_contact_kind, c.kind[k], "contactKind")?,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
        };
        let parent_ids: Vec<String> = match &parents {
            None => vec![],
            Some((start, names)) => span(start, i, names.len())?.map(|k| names[k].to_owned()).collect(),
        };
        let front = if p_has_front[i] != 0 {
            Some([
                Point { x: p_front[4 * i], y: p_front[4 * i + 1] },
                Point { x: p_front[4 * i + 2], y: p_front[4 * i + 3] },
            ])
        } else {
            None
        };
        let access = if p_access_present[i] != 0 {
            Some(ParcelAccess {
                kind: named(&t_access_kind, p_access_kind[i], "accessKind")?,
                street: opt(p_access_street[i]),
                front_length: p_access_front[i],
            })
        } else {
            None
        };
        Ok(Parcel {
            pressure: p_pressure[i],
            envelope: match &envelopes {
                Some(e) => e.shape(i)?,
                None => None,
            },
            id: ids[i].to_owned(),
            parent_ids,
            provenance,
            family: named(&t_family, p_family[i], "family")?,
            reason: named(&t_reason, p_reason[i], "reason")?,
            contacts,
            shape: shapes.shape(i)?.ok_or_else(|| format!("parcel pack: parcel {i} has no outer ring"))?,
            block: p_block[i] as usize,
            use_kind: named(&t_use, p_use[i], "use")?,
            front,
            axis: Point { x: p_axis[2 * i], y: p_axis[2 * i + 1] },
            rank: p_rank[i] as usize,
            access,
        })
    };
    let allocation = |c: &AllocationsIn<'_>, k: usize| -> Result<Allocation, String> {
        let housing_floor_need = match &floor {
            Some(f) if f.present[k] != 0 => {
                let code = |j: usize| named(&t_floor_need, f.codes[7 * k + j], "floorNeed");
                let v = &f.values[7 * k..7 * k + 7];
                Some(HousingFloorNeed {
                    version: code(0)?,
                    unit: code(1)?,
                    scope: code(2)?,
                    requested_m2: v[0],
                    allocated_households: v[1],
                    basis: code(3)?,
                    model: HousingFloorModel {
                        family: code(4)?,
                        profile_provenance: code(5)?,
                        calibration: code(6)?,
                        floor_m2_per_household: v[2],
                        wealth: v[3],
                        wealth_factor: v[4],
                        effective_floor_m2_per_household: v[5],
                        persons_per_household: v[6],
                    },
                })
            }
            _ => None,
        };
        Ok(Allocation {
            parcel_id: c.ids[k].to_owned(),
            demand_id: named(&t_demand, c.demand[k], "demand")?,
            function: named(&t_function, c.function[k], "function")?,
            culture: named(&t_culture, c.culture[k], "culture")?,
            architecture_pack: named(&t_pack, c.pack[k], "pack")?,
            capacity: c.capacity[k],
            unit: named(&t_unit, c.unit[k], "unit")?,
            score: c.score[k],
            reasons: span(&c.reasons_start, k, c.reasons_codes.len())?
                .map(|r| named(&t_alloc_reason, c.reasons_codes[r], "allocReason"))
                .collect::<Result<Vec<_>, _>>()?,
            role: named(&t_role, c.role[k], "role")?,
            label: named(&t_label, c.label[k], "label")?,
            landmark: c.landmark[k] != 0,
            households: c.households[k],
            residents: c.residents.as_ref().and_then(|v| (v[k] >= 0.).then_some(v[k])),
            housing_floor_need,
            district_role: named(&t_district_role, c.district[k], "districtRole")?,
            wealth: c.wealth[k],
        })
    };
    let block_environment = |e: &EnvironmentIn<'_>, k: usize| -> Result<BlockEnvironment, String> {
        Ok(BlockEnvironment {
            pressure: e.pressure[k],
            block: e.block[k] as usize,
            slope: e.slope[k],
            wet: e.wet[k] != 0,
            waterfront: e.waterfront[k] != 0,
            height: e.height[k],
            district: opt(e.district[k]),
            water: named(&t_water, e.water[k], "water")?,
            water_height: e.water_height[k],
        })
    };

    let mut out = Vec::with_capacity(shells.len());
    for shell in shells {
        let ShellIn { config, programme, key, warnings, diagnostics, enclosure, prepared, parcels, allocations, adjacency, environment } =
            shell;
        let parcels = range(parcels, n, "parcels")?.map(|i| parcel(i)).collect::<Result<Vec<_>, _>>()?;
        let programme = match programme {
            None => None,
            Some(ProgrammeIn {
                version, population, context, cultures, demands, reservations, reconciliation_passes,
                warnings: programme_warnings, housing_capacity, navigable_frontage, counts,
            }) => Some(UrbanProgramme {
                version,
                population,
                context,
                cultures,
                demands,
                reservations,
                allocations: match &allocs {
                    Some(c) => range(allocations, c.ids.len(), "allocations")?
                        .map(|k| allocation(c, k))
                        .collect::<Result<Vec<_>, _>>()?,
                    None => vec![],
                },
                adjacency: match &adjacency_cols {
                    Some(j) => range(adjacency, j.length.len(), "adjacency")?
                        .map(|k| Adjacency { a: j.a[k].to_owned(), b: j.b[k].to_owned(), shared_length: j.length[k] })
                        .collect(),
                    None => vec![],
                },
                environment: match &environment_cols {
                    Some(e) => range(environment, e.block.len(), "environment")?
                        .map(|k| block_environment(e, k))
                        .collect::<Result<Vec<_>, _>>()?,
                    None => vec![],
                },
                reconciliation_passes,
                warnings: programme_warnings,
                housing_capacity,
                navigable_frontage,
                counts,
            }),
        };
        out.push(Partition { config, programme, key, parcels, warnings, diagnostics, enclosure, prepared });
    }
    Ok(out)
}

/// The header JSON of a pack (format, version, envelope members, groups, counts, tables, partitions shells, sections).
pub fn header(bytes: &[u8]) -> Result<Value, String> {
    let (mut header, body) = open(bytes)?;
    let shells = take_shells(&mut header, body)?;
    header["partitions"] = shells;
    Ok(header)
}

/// One parcel with what refers to it, as the exact serde values of the retained records:
/// `{"parcel": .., "allocations": [..], "adjacency": [..], "environment": ..}` (environment = the entry of the parcel's block, or null).
pub fn record(partition: &Partition, index: usize) -> Result<Value, String> {
    let parcel = partition
        .parcels
        .get(index)
        .ok_or_else(|| format!("parcel record: no parcel {index} in {}", partition.key))?;
    let id = parcel.id.as_str();
    let programme = partition.programme.as_ref();
    let allocations: Vec<&Allocation> =
        programme.map(|p| p.allocations.iter().filter(|a| a.parcel_id == id).collect()).unwrap_or_default();
    let adjacency: Vec<&Adjacency> =
        programme.map(|p| p.adjacency.iter().filter(|j| j.a == id || j.b == id).collect()).unwrap_or_default();
    let environment = programme.and_then(|p| p.environment.iter().find(|e| e.block == parcel.block));
    let value = |v: Result<Value, serde_json::Error>| v.map_err(|e| format!("parcel record: {e}"));
    Ok(json!({
        "parcel": value(serde_json::to_value(parcel))?,
        "allocations": value(serde_json::to_value(&allocations))?,
        "adjacency": value(serde_json::to_value(&adjacency))?,
        "environment": value(serde_json::to_value(environment))?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(x: f64, y: f64) -> Point {
        Point { x, y }
    }
    fn square(x: f64, y: f64, s: f64) -> Shape {
        Shape { outer: vec![pt(x, y), pt(x + s, y), pt(x + s, y + s), pt(x, y + s)], holes: vec![] }
    }
    fn parcel(id: &str, x: f64) -> Parcel {
        Parcel {
            pressure: 0.0,
            envelope: None,
            id: id.into(),
            parent_ids: vec![],
            provenance: vec![],
            family: String::new(),
            reason: String::new(),
            contacts: vec![],
            shape: square(x, 0.0, 10.0),
            block: 0,
            use_kind: "plot".into(),
            front: None,
            axis: pt(1.0, 0.0),
            rank: 0,
            access: None,
        }
    }
    fn allocation(parcel_id: &str, households: f64, need: bool) -> Allocation {
        Allocation {
            parcel_id: parcel_id.into(),
            demand_id: "city/demand/domestic".into(),
            function: "domestic".into(),
            culture: "european-organic".into(),
            architecture_pack: "EUR-MED".into(),
            capacity: 0.1 + 0.2,
            unit: "domesticUnits".into(),
            score: -0.0,
            reasons: vec!["fits".into(), "near".into()],
            role: "dwelling".into(),
            label: "Maison \u{e0} colombages".into(),
            landmark: !need,
            households,
            residents: None,
            housing_floor_need: need.then(|| HousingFloorNeed {
                version: "indicative-housing-floor-1".into(),
                unit: "useful_floor_m2".into(),
                scope: "housing_in_body_levels".into(),
                requested_m2: 162.00000000000003,
                allocated_households: households,
                basis: "allocation_households_times_wealth_scaled_floor_allowance".into(),
                model: HousingFloorModel {
                    family: "frontage".into(),
                    profile_provenance: "generic-fallback".into(),
                    calibration: "not-culture-calibrated".into(),
                    floor_m2_per_household: 54.0,
                    wealth: 0.25,
                    wealth_factor: 0.9,
                    effective_floor_m2_per_household: 48.6,
                    persons_per_household: 4.5,
                },
            }),
            district_role: "residential".into(),
            wealth: 0.7,
        }
    }
    fn programme(allocations: Vec<Allocation>, adjacency: Vec<Adjacency>, environment: Vec<BlockEnvironment>) -> UrbanProgramme {
        UrbanProgramme {
            version: 3,
            population: 1200,
            context: ProgrammeContext::default(),
            cultures: vec![],
            demands: vec![],
            reservations: vec![],
            allocations,
            adjacency,
            environment,
            reconciliation_passes: 0,
            warnings: vec![],
            housing_capacity: 0.0,
            navigable_frontage: false,
            counts: vec![],
        }
    }

    /// Every optional field both ways, holes, an empty envelope, orphans,
    /// non-ASCII ids, an empty programme, no programme and an empty partition.
    fn synthetic() -> Vec<Partition> {
        let smiley = "p2-\u{1F600}";
        let mut p0 = parcel("p0", 1234.5678901234567);
        p0.pressure = 1.0 / 3.0;
        p0.shape.holes.push(vec![pt(1236.1, 2.2), pt(1237.3, 2.2), pt(1237.3, 3.4)]);
        p0.envelope = Some(square(1230.0, -1.0, 14.000000000000002));
        p0.parent_ids = vec!["a".into(), "b\u{e9}\u{1F600}".into()];
        p0.provenance = vec!["split".into(), "cut".into(), "split".into()];
        p0.family = "frontage".into();
        p0.reason = "rest".into();
        p0.contacts = vec![
            ParcelContact { a: pt(1234.5, 0.0), b: pt(1244.5, 0.0), street: 3, rank: 1, length: 10.000000000000002, kind: "street".into() },
            ParcelContact { a: pt(-0.0, 1e-300), b: pt(5e300, -7.25), street: 0, rank: 4, length: 0.1, kind: "lane".into() },
        ];
        p0.block = 1;
        p0.front = Some([pt(1234.5, 0.0), pt(1244.5, 0.0)]);
        p0.axis = pt(0.7071067811865476, -0.7071067811865475);
        p0.rank = 2;
        p0.access = Some(ParcelAccess { kind: "street".into(), street: Some(3), front_length: 9.75 });
        let mut p1 = parcel("p1", 20.0);
        p1.envelope = Some(Shape { outer: vec![], holes: vec![] });
        p1.access = Some(ParcelAccess { kind: "rear".into(), street: None, front_length: 0.0 });
        p1.use_kind = "garden".into();
        let p2 = parcel(smiley, 40.0);
        let mut city = programme(
            vec![allocation("p0", 2.0, true), allocation("ghost", 0.0, false), allocation("p0", 1.5, false), allocation(smiley, 3.0, true)],
            vec![
                Adjacency { a: "p0".into(), b: "p1".into(), shared_length: 7.123456789012345 },
                Adjacency { a: "p1".into(), b: "ghost-a".into(), shared_length: 1.0 },
                Adjacency { a: "ghost-b".into(), b: "ghost-c".into(), shared_length: 0.0 },
            ],
            vec![
                BlockEnvironment {
                    pressure: 0.5,
                    block: 1,
                    slope: 0.07,
                    wet: true,
                    waterfront: false,
                    height: 12.25,
                    district: Some(2),
                    water: "river".into(),
                    water_height: 9.5,
                },
                BlockEnvironment {
                    pressure: 0.0,
                    block: 0,
                    slope: 0.0,
                    wet: false,
                    waterfront: true,
                    height: -3.5,
                    district: None,
                    water: String::new(),
                    water_height: 0.0,
                },
            ],
        );
        city.context = ProgrammeContext { decay: Some(0.25), slope_relax: 0.1, lore: vec!["old".into()], ..ProgrammeContext::default() };
        city.demands = vec![serde_json::from_value(json!({
            "id": "city/demand/domestic", "function": "domestic", "unit": "domesticUnits", "requested": 12.5,
            "targetArea": 875.0000000000001, "targetFrontage": 4.0, "provenance": ["population"], "requires": [],
            "parcelCapacity": 0.1, "builtCapacity": 0.2, "deficit": 0.0, "reasons": [], "role": "dwelling"
        }))
        .unwrap()];
        city.reservations = vec![serde_json::from_value(json!({
            "id": "city/reservation/0", "demandId": "city/demand/market", "block": 1,
            "shape": square(1234.5678901234567, 98.76543210987654, 21.0), "street": 0, "frontage": 12.345678901234567
        }))
        .unwrap()];
        city.reconciliation_passes = 2;
        city.warnings = vec!["short".into()];
        city.housing_capacity = 1.0 / 3.0;
        city.navigable_frontage = true;
        vec![
            Partition {
                config: Some(ParcelConfig {
                    plot_enclosure: Some(0.3),
                    params: json!({"z": 0.1, "a": [1, -2, 2.5e-300, 0.30000000000000004]}),
                    ..ParcelConfig::default()
                }),
                programme: Some(city),
                key: "city".into(),
                parcels: vec![p0, p1, p2],
                warnings: vec!["Population 0/8000 — housing shortfall".into()],
                diagnostics: Some(PartitionDiagnostics { covered_area: 1.0 / 7.0, residual_area: 0.0, overlap_area: 2.5, unserved_area: 1e-9 }),
                enclosure: Some(Resolved { plot: 0.35, front: 1.2345678901234567, material: "wall".into(), ..Resolved::default() }),
                prepared: None,
            },
            Partition {
                config: None,
                programme: Some(programme(vec![], vec![], vec![])),
                key: "empty-programme".into(),
                prepared: None,
                parcels: vec![parcel("p0", 60.0)],
                warnings: vec![],
                diagnostics: None,
                enclosure: None,
            },
            Partition {
                config: None,
                programme: None,
                key: "no-programme".into(),
                prepared: None,
                parcels: vec![parcel("r0", 80.0)],
                warnings: vec!["w".into()],
                diagnostics: None,
                enclosure: None,
            },
            Partition { config: None, programme: None, key: "empty".into(), parcels: vec![], warnings: vec![], diagnostics: None, enclosure: None, prepared: None },
        ]
    }

    #[test]
    fn synthetic_partitions_round_trip_exactly() {
        let input = synthetic();
        let envelope = json!({"id": "t1", "ms": 12.5, "urbanSource": {"session": "s", "revision": 3}});
        let bytes = pack(&input, None, &envelope).unwrap();
        assert_eq!(bytes.len() % 8, 0);
        let back = unpack(&bytes).unwrap();
        assert_eq!(serde_json::to_string(&back).unwrap(), serde_json::to_string(&input).unwrap());
        let head = header(&bytes).unwrap();
        assert_eq!(head["format"], FORMAT);
        assert_eq!(head["id"], "t1");
        assert_eq!(head["urbanSource"]["revision"], 3);
        assert_eq!(head["groups"], json!(GROUPS));
        assert_eq!(head["counts"]["parcels"], 5);
        assert_eq!(head["counts"]["allocations"], 4);
        assert_eq!(head["partitions"][0]["programme"]["housingCapacity"], json!(1.0 / 3.0));
        assert_eq!(head["partitions"][1]["parcels"], json!([3, 4]));
        assert!(head["partitions"][2].get("programme").is_none());
    }

    #[test]
    fn pack_is_deterministic() {
        let input = synthetic();
        assert_eq!(pack(&input, None, &Value::Null).unwrap(), pack(&input, None, &Value::Null).unwrap());
    }

    #[test]
    fn demographic_residents_round_trip_without_inventing_absent_values() {
        let mut input = synthetic();
        let pr = input[0].programme.as_mut().unwrap();
        pr.allocations[0].residents = Some(2.);
        pr.allocations[1].residents = Some(0.);
        let bytes = pack(&input, None, &json!({})).unwrap();
        let back = unpack(&bytes).unwrap();
        assert_eq!(serde_json::to_string(&back).unwrap(), serde_json::to_string(&input).unwrap());
    }

    #[test]
    fn group_subset_writes_only_its_sections() {
        let input = synthetic();
        let bytes = pack(&input, Some(&["contacts", "adjacency"][..]), &Value::Null).unwrap();
        let head = header(&bytes).unwrap();
        assert_eq!(head["groups"], json!(["core", "contacts", "adjacency"]));
        let sections = head["sections"].as_object().unwrap();
        assert!(sections.contains_key("parcels.coords") && sections.contains_key("contacts.ab") && sections.contains_key("adjacency.a"));
        for prefix in ["envelopes.", "parentIds.", "allocations.", "floorNeed.", "environment."] {
            assert!(sections.keys().all(|k| !k.starts_with(prefix)), "{prefix}");
        }
        let back = unpack(&bytes).unwrap();
        assert_eq!(back[0].parcels[0].contacts.len(), 2);
        assert!(back[0].parcels[0].envelope.is_none());
        let programme = back[0].programme.as_ref().unwrap();
        assert!(programme.allocations.is_empty() && programme.environment.is_empty());
        assert_eq!(programme.adjacency[2].b, "ghost-c");
        assert!(pack(&input, Some(&["nope"][..]), &Value::Null).is_err());
    }

    #[test]
    fn record_returns_the_parcel_and_what_refers_to_it() {
        let input = synthetic();
        let r = record(&input[0], 0).unwrap();
        assert_eq!(r["parcel"], serde_json::to_value(&input[0].parcels[0]).unwrap());
        let allocations = &input[0].programme.as_ref().unwrap().allocations;
        let expected = json!([serde_json::to_value(&allocations[0]).unwrap(), serde_json::to_value(&allocations[2]).unwrap()]);
        assert_eq!(r["allocations"], expected);
        assert_eq!(r["adjacency"].as_array().unwrap().len(), 1);
        assert_eq!(r["environment"]["block"], 1);
        assert!(record(&input[2], 0).unwrap()["environment"].is_null());
        assert!(record(&input[0], 99).is_err());
    }

    #[test]
    fn malformed_packs_are_errors() {
        let bytes = pack(&synthetic(), None, &Value::Null).unwrap();
        assert!(unpack(&bytes[..3]).is_err());
        assert!(unpack(&bytes[..bytes.len() - 8]).is_err());
        let mut wrong = bytes.clone();
        let at = wrong.windows(FORMAT.len()).position(|w| w == FORMAT.as_bytes()).unwrap();
        wrong[at] = b'x';
        assert!(unpack(&wrong).is_err());
    }

    /// `MAGNA_URBAN_FIXTURE=<file holding a Partition[]>`: the same round trip on a real town.
    #[test]
    fn real_partitions_round_trip_exactly() {
        let Ok(path) = std::env::var("MAGNA_URBAN_FIXTURE") else { return };
        let input: Vec<Partition> = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let bytes = pack(&input, None, &Value::Null).unwrap();
        assert_eq!(serde_json::to_string(&unpack(&bytes).unwrap()).unwrap(), serde_json::to_string(&input).unwrap());
    }

    /// `MAGNA_WRITE_PACK_FIXTURE=<dir>`: writes the synthetic pack and its serde
    /// text for the TypeScript decoder's test.
    #[test]
    fn write_pack_fixture() {
        let Ok(dir) = std::env::var("MAGNA_WRITE_PACK_FIXTURE") else { return };
        let dir = std::path::Path::new(&dir);
        std::fs::create_dir_all(dir).unwrap();
        let input = synthetic();
        let envelope = json!({"id": "fixture", "ms": 1.5, "urbanSource": {"kind": "test"}});
        std::fs::write(dir.join("parcel-pack.bin"), pack(&input, None, &envelope).unwrap()).unwrap();
        std::fs::write(dir.join("parcel-pack.json"), serde_json::to_string(&input).unwrap()).unwrap();
    }
}
