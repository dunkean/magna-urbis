//! District roles and the data-driven service catalogue (`services.json`).
//! Roles are scored from facts the pipeline already computed (distance to the
//! nucleus, gates, waterfront, height, growth phase, mixed culture), never drawn
//! at random, so the same town always reads the same way. Building roles are
//! counted per culture family from population thresholds; `function` stays one
//! of the six houses functions and the rich id travels as `role`.
use crate::urban::warnings;
use super::geometry as g;
use super::programme::BlockEnvironment;
use super::{Layout, Point, QuarterOverride, UrbanDistrict};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEntry {
    pub role: String,
    pub function: String,
    pub per: f64,
    pub min_pop: f64,
    pub max: usize,
    pub site: String,
    pub area: [f64; 2],
    #[serde(default)]
    pub per_capita: f64,
    #[serde(default)]
    pub landmark: bool,
    #[serde(default)]
    pub district: String,
    #[serde(default)]
    pub requires: String,
    /// Entry dropped above this population (0 = no ceiling): hamlet outbuildings.
    #[serde(default)]
    pub max_pop: f64,
    /// Below `minPop`, a few landmark buildings from this population on (0 =
    /// none): one at `townPop`, one more each time the population triples, at
    /// most `EARLY_SITES` (a cyberpunk town keeps a tower or two, a city its
    /// skyline). The culture's verticality, as data.
    #[serde(default)]
    pub town_pop: f64,
    /// Culture that builds this entry when it is not the place's own (the
    /// `monuments` facet of the style sheet); never read from the catalogue.
    #[serde(default, skip)]
    pub culture: String,
}
/// Settlement condition (`thriving`, `declining`, `abandoned`, `ruined`).
#[derive(Clone, Debug, Deserialize)]
pub struct StateRule {
    /// Share of built allocations that stand empty.
    pub decay: f64,
    /// Role suffix of an empty building (`.abandoned`, `.ruin`).
    pub suffix: String,
    /// French label suffix (` à l’abandon`, ` en ruine`).
    pub label: String,
}
/// A single structure without a town (`isolated-farm`, `isolated-mill`…).
#[derive(Clone, Debug, Deserialize)]
pub struct IsolatedRule {
    pub role: String,
    pub function: String,
    #[serde(default)]
    pub landmark: bool,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occupancy {
    pub household_size: f64,
    pub floor_per_household: f64,
    pub max_per_plot: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalogue {
    nucleus: BTreeMap<String, String>,
    cultures: BTreeMap<String, String>,
    occupancy: BTreeMap<String, serde_json::Value>,
    families: BTreeMap<String, Vec<ServiceEntry>>,
    #[serde(default)]
    culture_services: BTreeMap<String, Vec<ServiceEntry>>,
    #[serde(default)]
    states: BTreeMap<String, StateRule>,
    #[serde(default)]
    isolated: BTreeMap<String, IsolatedRule>,
    #[serde(default)]
    rural: Vec<ServiceEntry>,
    #[serde(default)]
    harbour: Vec<ServiceEntry>,
    #[serde(default)]
    labels: BTreeMap<String, String>,
    #[serde(default)]
    family_labels: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    district_labels: BTreeMap<String, String>,
    #[serde(default)]
    family_district_labels: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    ruin_share: BTreeMap<String, serde_json::Value>,
}
fn catalogue() -> &'static Catalogue {
    static CATALOGUE: OnceLock<Catalogue> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!("services.json")).expect("versioned service catalogue")
    })
}
/// Culture family of the service catalogue; unknown cultures read as fantasy.
pub fn family(culture: &str) -> &'static str {
    catalogue()
        .cultures
        .get(super::contributor_cultures::base(culture))
        .map_or("fantasy", String::as_str)
}
/// Share of a culture's buildings standing in ruins at a demographic class
/// (`services.json` ruinShare), whatever the settlement state.
pub fn ruin_share(culture: &str, class: &str) -> f64 {
    catalogue().ruin_share.get(super::contributor_cultures::base(culture)).and_then(|c| c[class].as_f64()).unwrap_or(0.0).clamp(0.0, 1.0)
}
pub fn state(name: &str) -> Option<&'static StateRule> {
    catalogue().states.get(name)
}
pub fn isolated(role: &str) -> Option<&'static IsolatedRule> {
    catalogue().isolated.get(role)
}
pub fn is_isolated(role: &str) -> bool {
    isolated(role).is_some()
}
/// Per-role lookups over the whole catalogue, built once: the houses function
/// of the first entry naming a role (families, culture services, rural,
/// harbour, then isolated rules) and the roles some family or culture entry
/// marks as a landmark.
struct RoleIndex {
    function: std::collections::HashMap<&'static str, &'static str>,
    landmark: std::collections::HashSet<&'static str>,
}
fn role_index() -> &'static RoleIndex {
    static INDEX: OnceLock<RoleIndex> = OnceLock::new();
    INDEX.get_or_init(|| {
        let cat = catalogue();
        let mut function = std::collections::HashMap::new();
        let mut landmark = std::collections::HashSet::new();
        for e in cat.families.values().flatten().chain(cat.culture_services.values().flatten()) {
            if e.landmark {
                landmark.insert(e.role.as_str());
            }
        }
        for e in cat
            .families
            .values()
            .flatten()
            .chain(cat.culture_services.values().flatten())
            .chain(&cat.rural)
            .chain(&cat.harbour)
        {
            function.entry(e.role.as_str()).or_insert(e.function.as_str());
        }
        for i in cat.isolated.values() {
            function.entry(i.role.as_str()).or_insert(i.function.as_str());
        }
        RoleIndex { function, landmark }
    })
}
/// Houses function of a catalogue role (any family), for user overrides.
pub fn role_function(role: &str) -> Option<&'static str> {
    role_index().function.get(role).copied()
}
pub fn is_landmark(role: &str) -> bool {
    role_index().landmark.contains(role)
}
/// Longest known dotted (or `craft:`) prefix of `id` in `table`, family table first.
fn lookup(
    id: &str,
    family: Option<&BTreeMap<String, String>>,
    table: &BTreeMap<String, String>,
) -> Option<String> {
    let mut key = id;
    loop {
        if let Some(l) = family.and_then(|f| f.get(key)).or_else(|| table.get(key)) {
            return Some(l.clone());
        }
        key = &key[..key.rfind(['.', ':'])?];
    }
}
/// French label of a building role, with the state suffix (`.ruin`, `.abandoned`).
/// Never the raw id: an unknown role reads as its category.
pub fn label(role: &str, culture: &str) -> String {
    let cat = catalogue();
    let (base, tail) = cat
        .states
        .values()
        .filter(|s| !s.suffix.is_empty())
        .find_map(|s| {
            role.strip_suffix(s.suffix.as_str())
                .map(|b| (b, s.label.as_str()))
        })
        .unwrap_or((role, ""));
    let fam = cat.family_labels.get(family(culture));
    let text = lookup(base, fam, &cat.labels).unwrap_or_else(|| "Bâtiment".into());
    format!("{text}{tail}")
}
/// District role in the culture's toponym language, French unless configured.
pub fn district_label(role: &str, culture: &str) -> String {
    if let Some(label) = super::access::districts::role_label(culture, role) {
        return label.into();
    }
    let cat = catalogue();
    let fam = cat.family_district_labels.get(family(culture));
    lookup(role, fam, &cat.district_labels).unwrap_or_else(|| "Quartier".into())
}
mod occupancy_profiles;
use occupancy_profiles::{EARLY_SITES, occupancy_table};
pub use occupancy_profiles::{occupancy, urban_household_share, town_house_share, dense_core_share, housing_margin, homes_per_household, tower_home_share, settlement_occupancy};
mod service_needs;
pub use service_needs::{ServiceNeed, reserves_block, services, services_with_functions, services_scaled, MAX_ROLE_COUNT, countable_role, site_counts, resolve_counts, services_for_layout};
mod quays;
pub(super) use quays::{face_quays, quay_water_fronts, clear_probe_cache};
pub use quays::{QUAY_FRONT, QUAY_MISS, quay_contacts};
use quays::{served_quay_frontage, port_quarters, carve_port};
mod siting;
pub use siting::{SiteFacts, site_cost, Frame, site_admissible, gates};
use siting::dist;
/// Target district count: one for a hamlet, 3-5 for a 5k town, ~20 at 100k.
pub fn district_target(population: u32) -> usize {
    ((1.5 * (f64::from(population) / 1000.0).powf(0.55)).round() as usize).clamp(1, 40)
}

/// Regroup quarters into districts sized to the population, then give each a
/// role and a wealth. Called by the programme stage, which knows the blocks'
/// waterfront, height and pressure. Districts stay sets of whole quarters.
pub fn assign(
    layout: &mut Layout,
    population: u32,
    navigable: bool,
    env: &[BlockEnvironment],
) -> Vec<Option<usize>> {
    let sheltered = layout.config.as_ref().is_some_and(super::macroplan::harbour::parameterized);
    // Port refinement moves blocks between quarters but never reshapes a
    // block or a street, so one measure of the quay contacts serves it all.
    let contact = quay_contacts(layout);
    if population >= 800 && navigable { port_quarters(layout, env, &contact); }
    let frame = Frame::with_quay(layout, env, contact);
    let Some(structure) = layout.structure.as_ref() else {
        return vec![None; layout.blocks.len()];
    };
    let quarter_points: Vec<Point> = layout
        .quarters
        .iter()
        .map(|q| g::interior_point(&q.shape))
        .collect();
    let quarter_area: Vec<f64> = layout.quarters.iter().map(|q| g::area(&q.shape)).collect();
    let mut groups: Vec<UrbanDistrict> = structure.districts.clone();
    let target = district_target(population);
    // A hamlet reads as one place: merge same-tissue groups.
    if target == 1 && groups.len() > 1 && groups.iter().all(|d| d.tissue == groups[0].tissue) {
        let mut one = groups[0].clone();
        one.phase = groups.iter().map(|d| d.phase).min().unwrap_or(0);
        one.quarters = groups.iter().flat_map(|d| d.quarters.clone()).collect();
        one.quarters.sort_unstable();
        groups = vec![one];
    }
    // Split the largest multi-quarter group along its long axis at half area.
    while groups.len() < target {
        let Some(gi) = (0..groups.len())
            .filter(|&i| groups[i].quarters.len() > 1)
            .max_by(|&a, &b| {
                let area = |i: usize| {
                    groups[i]
                        .quarters
                        .iter()
                        .map(|&q| quarter_area[q])
                        .sum::<f64>()
                };
                area(a).total_cmp(&area(b)).then(b.cmp(&a))
            })
        else {
            break;
        };
        let mut qs = groups[gi].quarters.clone();
        let (x0, x1, y0, y1) = qs.iter().fold(
            (
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ),
            |(a, b, c, d), &q| {
                let p = quarter_points[q];
                (a.min(p.x), b.max(p.x), c.min(p.y), d.max(p.y))
            },
        );
        let along_x = x1 - x0 >= y1 - y0;
        qs.sort_by(|&a, &b| {
            let k = |q: usize| {
                if along_x {
                    quarter_points[q].x
                } else {
                    quarter_points[q].y
                }
            };
            k(a).total_cmp(&k(b)).then(a.cmp(&b))
        });
        let total: f64 = qs.iter().map(|&q| quarter_area[q]).sum();
        let mut acc = 0.0;
        let mut cut = 1;
        for (i, &q) in qs.iter().enumerate() {
            acc += quarter_area[q];
            if acc >= total * 0.5 {
                cut = (i + 1).clamp(1, qs.len() - 1);
                break;
            }
        }
        let mut second = groups[gi].clone();
        second.quarters = qs.split_off(cut);
        groups[gi].quarters = qs;
        groups.insert(gi + 1, second);
    }
    // User edits: an overridden quarter becomes its own district, so its role
    // and wealth never leak to the quarters it was grouped with.
    let mut warnings = vec![];
    let overrides: Vec<(usize, QuarterOverride)> =
        layout.config.as_ref().map_or_else(Vec::new, |c| {
            c.overrides
                .quarters
                .iter()
                .filter(|(_, o)| o.role.is_some() || o.wealth.is_some())
                .filter_map(|(k, o)| match k.parse::<usize>() {
                    Ok(q) if q < layout.quarters.len() => Some((q, o.clone())),
                    _ => {
                        warnings.push(warnings::quarter_role_missing(k));
                        None
                    }
                })
                .collect()
        });
    let mut fixed: Vec<Option<&QuarterOverride>> = vec![None; groups.len()];
    for (q, o) in &overrides {
        let Some(gi) = groups.iter().position(|d| d.quarters.contains(q)) else {
            continue;
        };
        if groups[gi].quarters.len() > 1 {
            let mut own = groups[gi].clone();
            own.quarters = vec![*q];
            groups[gi].quarters.retain(|x| x != q);
            groups.push(own);
            fixed.push(Some(o));
        } else {
            fixed[gi] = Some(o);
        }
    }
    let fixed_roles: Vec<Option<String>> = fixed
        .iter()
        .map(|o| {
            o.and_then(|o| o.role.clone()).filter(|r| {
                (1..=40).contains(&r.len())
                    && r.chars()
                        .all(|c| c.is_ascii_alphanumeric() || ":-_".contains(c))
            })
        })
        .collect();
    let mut fixed_roles = fixed_roles;
    // A harbour's port district is the land its quays actually serve.
    let quay_front = served_quay_frontage(layout, &frame, env);
    if population >= 800 && navigable && (!sheltered || quay_front.iter().sum::<f64>() >= QUAY_FRONT) {
        // Without quays, the port is still the land along navigable water:
        // the quarters whose blocks front the sea, a lake or the river (side
        // length of those blocks), never a whole district reaching inland.
        let quays: f64 = quay_front.iter().sum();
        let shore_front: Vec<f64> = if quays < QUAY_FRONT {
            // (front, waterfront area, total area) per quarter; a quarter is
            // riverside when a quarter of its land at least lies on the water.
            let mut f = vec![(0.0, 0.0, 0.0); layout.quarters.len()];
            for (bi, b) in layout.blocks.iter().enumerate() {
                if b.quarter >= f.len() {
                    continue;
                }
                let a = g::area(&b.shape);
                f[b.quarter].2 += a;
                if env.get(bi).is_some_and(|e| !e.wet && matches!(e.water.as_str(), "sea" | "lake" | "river")) {
                    f[b.quarter].0 += a.sqrt();
                    f[b.quarter].1 += a;
                }
            }
            f.iter().map(|&(front, wet, all)| if wet >= 0.25 * all { front } else { 0.0 }).collect()
        } else {
            vec![]
        };
        let before = warnings.len();
        carve_port(
            layout,
            &frame,
            if quays < QUAY_FRONT { &shore_front } else { &quay_front },
            &mut groups,
            &mut fixed,
            &mut fixed_roles,
            &mut warnings,
        );
        // The quay warning speaks of quays only.
        if quays < QUAY_FRONT {
            warnings.truncate(before);
        }
    }
    for (id, d) in groups.iter_mut().enumerate() {
        d.id = id;
    }
    // Facts per district, area-weighted over its blocks.
    let mut quarter_district = vec![None; layout.quarters.len()];
    for (di, d) in groups.iter().enumerate() {
        for &q in &d.quarters {
            if q < quarter_district.len() {
                quarter_district[q] = Some(di);
            }
        }
    }
    let block_district: Vec<Option<usize>> = layout
        .blocks
        .iter()
        .map(|b| quarter_district.get(b.quarter).copied().flatten())
        .collect();
    let n = groups.len();
    let mut facts = vec![(0.0, SiteFacts::default(), 0.0); n]; // (weight, sums, water share)
    for (bi, b) in layout.blocks.iter().enumerate() {
        let Some(di) = block_district[bi] else {
            continue;
        };
        let w = g::area(&b.shape).max(1.0);
        let f = frame.facts(g::centroid(&b.shape), env.get(bi));
        let acc = &mut facts[di];
        acc.0 += w;
        acc.1.core += f.core * w;
        acc.1.gate += f.gate * w;
        acc.1.high += f.high * w;
        acc.1.pressure += f.pressure * w;
        acc.1.downstream += f.downstream * w;
        acc.2 += if f.water { w } else { 0.0 };
    }
    let max_phase = groups.iter().map(|d| d.phase).max().unwrap_or(0).max(1) as f64;
    let feats: Vec<(SiteFacts, f64, f64, bool)> = (0..n)
        .map(|di| {
            let (w, s, water) = facts[di];
            let w = w.max(1e-9);
            let f = if facts[di].0 > 0.0 {
                SiteFacts {
                    core: s.core / w,
                    gate: s.gate / w,
                    water: water / w > 0.25,
                    high: s.high / w,
                    pressure: s.pressure / w,
                    downstream: s.downstream / w,
                    ..SiteFacts::default()
                }
            } else {
                // Districts without blocks keep their quarter centroid.
                let p = groups[di]
                    .quarters
                    .first()
                    .map_or(frame.center, |&q| quarter_points[q]);
                frame.facts(p, None)
            };
            let culture = layout
                .phases
                .get(groups[di].phase)
                .map_or("", |p| p.culture.as_str());
            let foreign = !culture.is_empty() && culture != layout.culture;
            (f, water / w, groups[di].phase as f64 / max_phase, foreign)
        })
        .collect();
    // The port reads the quay frontage a district serves (all of it in a
    // harbour town); a town without quays keeps its natural shore share.
    let landing: Vec<f64> = if frame.harbour {
        let total: f64 = quay_front.iter().sum::<f64>().max(1e-9);
        groups
            .iter()
            .map(|d| {
                d.quarters
                    .iter()
                    .filter_map(|&q| quay_front.get(q))
                    .sum::<f64>()
                    / total
            })
            .collect()
    } else {
        // Without quays, a port reads its land along navigable water (sea,
        // lake, river), never a brook: share of the district's block area.
        let mut wet = vec![(0.0_f64, 0.0_f64); n];
        for (bi, b) in layout.blocks.iter().enumerate() {
            let Some(di) = block_district[bi] else { continue };
            let w = g::area(&b.shape).max(1.0);
            wet[di].1 += w;
            if env.get(bi).is_some_and(|e| matches!(e.water.as_str(), "sea" | "lake" | "river")) {
                wet[di].0 += w;
            }
        }
        wet.iter().map(|&(a, t)| a / t.max(1e-9)).collect()
    };
    let total_area: f64 = facts.iter().map(|f| f.0).sum::<f64>().max(1e-9);
    let share: Vec<f64> = facts.iter().map(|f| f.0 / total_area).collect();
    let attached = attached_districts(layout, &groups, frame.center);
    let roles = district_roles(
        layout,
        population,
        navigable,
        &feats,
        &landing,
        &share,
        &attached,
        &fixed_roles,
    );
    for (di, d) in groups.iter_mut().enumerate() {
        let (f, _, phase, _) = feats[di];
        d.role = roles[di].clone();
        let culture = layout
            .phases
            .get(d.phase)
            .map(|p| p.culture.as_str())
            .filter(|c| !c.is_empty())
            .unwrap_or(layout.culture.as_str());
        d.label = super::access::districts::label(
            culture, &d.role, &district_label(&d.role, culture), di,
        );
        let base = 0.75 - f.core.min(1.0) * 0.35 - phase * 0.2 + (f.high - 0.5) * 0.25;
        let bonus = match d.role.as_str() {
            "elite" => 0.3,
            "civic" => 0.15,
            "religious" | "market" => 0.08,
            "foreign" | "port" => 0.0,
            "garrison" | "commoner" => -0.05,
            "gardens" => -0.15,
            "poor" => -0.35,
            r if r.starts_with("craft:") => {
                if r == "craft:tanners" || r == "craft:dyers" {
                    -0.25
                } else {
                    -0.1
                }
            }
            _ => 0.0,
        };
        d.wealth = ((base + bonus) * 100.0).round().clamp(0.0, 100.0) / 100.0;
        if let Some(w) = fixed[di].and_then(|o| o.wealth).filter(|w| w.is_finite()) {
            d.wealth = w.clamp(0.0, 1.0);
        }
    }
    if let Some(s) = layout.structure.as_mut() {
        // Each district leans on its nearest centre (a ward of a metropolis).
        for d in &mut groups {
            let p = d.quarters.first().map_or(frame.center, |&q| {
                let (sx, sy, n) = d
                    .quarters
                    .iter()
                    .filter_map(|&q| quarter_points.get(q))
                    .fold((0.0, 0.0, 0.0), |(x, y, n), p| (x + p.x, y + p.y, n + 1.0));
                if n > 0.0 {
                    Point {
                        x: sx / n,
                        y: sy / n,
                    }
                } else {
                    quarter_points.get(q).copied().unwrap_or(frame.center)
                }
            });
            if let Some(c) = s
                .centers
                .iter()
                .min_by(|a, b| dist(a.point, p).total_cmp(&dist(b.point, p)))
            {
                d.center = c.id;
            }
        }
        s.port_districts = groups.iter().filter(|d|d.role=="port").map(|d|super::PortDistrict {
            district:d.id,role:d.role.clone(),quarters:d.quarters.clone(),
            shapes:d.quarters.iter().filter_map(|&q|layout.quarters.get(q).map(|q|q.shape.clone())).collect(),
        }).collect();
        s.districts = groups;
    }
    layout.warnings.extend(warnings);
    block_district
}

mod districts;
use districts::{attached_districts, district_roles};
#[cfg(test)]
mod tests;
#[cfg(test)]
#[path = "roles_occupancy_tests.rs"]
mod occupancy_profile_tests;

#[cfg(test)]
#[path = "roles_port5_tests.rs"]
mod port5_tests;

#[path = "housing_floor_need.rs"]
mod housing_floor_need;
pub(crate) use housing_floor_need::indicative_housing_floor_need;
pub use housing_floor_need::{HousingFloorModel, HousingFloorNeed};
