//! Bounded contextual demand and allocation. Metres, square metres and indicative
//! domestic units are distinct; estimated land capacity never means built housing.
//! Building roles come from the service catalogue (`roles`, `services.json`):
//! landmarks and large programmes reserve whole blocks before the cadastre,
//! small trades take plots after it, then shops, then housing, and every
//! buildable plot left over becomes an explicit garden or yard.
use super::culture::{CultureMapping, mapping};
use super::geometry::{area, centroid, difference};
use super::roles::{self, Frame, SiteFacts};
use super::{Layout, Parcel, ParcelOverride, Partition, Point, Shape, Surface};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammeContext {
    pub role: String,
    pub resources: Vec<String>,
    pub period: String,
    pub mode: String,
    pub navigable_access: bool,
    pub lore: Vec<String>,
    /// Settlement condition (`services.json` states): `thriving`, `declining`,
    /// `abandoned`, `ruined`. Empty buildings get a role suffix and no household.
    pub state: String,
    /// Share of empty buildings; `None` uses the state's default.
    pub decay: Option<f64>,
}
impl Default for ProgrammeContext {
    fn default() -> Self {
        Self {
            role: "auto".into(),
            resources: vec![],
            period: String::new(),
            mode: "inspired".into(),
            navigable_access: false,
            lore: vec![],
            state: "thriving".into(),
            decay: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Demand {
    pub id: String,
    pub function: String,
    pub unit: String,
    pub requested: f64,
    pub target_area: f64,
    pub target_frontage: f64,
    pub provenance: Vec<String>,
    pub requires: Vec<String>,
    pub parcel_capacity: f64,
    pub built_capacity: f64,
    #[serde(default)]
    pub open_capacity: f64,
    pub deficit: f64,
    pub reasons: Vec<String>,
    /// Rich building role (`worship.parish`, `commerce.inn`, `dwelling`…).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub role: String,
    /// Number of distinct buildings wanted; 0 = legacy area-driven demand.
    #[serde(default)]
    pub sites: usize,
    /// Preferred siting rule (`nucleus`, `gate`, `waterfront`, `downstream`, `hill`, `edge`, `spread`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub site: String,
    #[serde(default)]
    pub landmark: bool,
    /// Preferred district role prefix.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub district: String,
    /// `block` = whole block reserved before cuts; `parcel` = plot chosen after cuts.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub placement: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub id: String,
    pub demand_id: String,
    pub block: usize,
    pub shape: Shape,
    pub street: usize,
    pub frontage: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub parcel_id: String,
    pub demand_id: String,
    pub function: String,
    pub culture: String,
    pub architecture_pack: String,
    pub capacity: f64,
    pub unit: String,
    pub score: f64,
    pub reasons: Vec<String>,
    /// Rich building role; `function` stays one of the six houses functions.
    #[serde(default)]
    pub role: String,
    /// French label of `role` for the UI (`Église paroissiale`, `Tannerie en ruine`).
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub landmark: bool,
    /// Households housed on this plot (0 for non-domestic uses).
    #[serde(default)]
    pub households: f64,
    #[serde(default)]
    pub district_role: String,
    #[serde(default)]
    pub wealth: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjacency {
    pub a: String,
    pub b: String,
    pub shared_length: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockEnvironment {
    #[serde(default)]
    pub pressure: f64,
    pub block: usize,
    pub slope: f64,
    pub wet: bool,
    pub waterfront: bool,
    /// Ground height at the block centroid (m).
    #[serde(default)]
    pub height: f64,
    /// Index into `structure.districts`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub district: Option<usize>,
    /// Water the block fronts: `river`, `sea` or `lake` (empty when dry).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub water: String,
    /// Ground height under that water next to the block; along a river it
    /// falls downstream, which orders the banks by flow.
    #[serde(default)]
    pub water_height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrbanProgramme {
    pub version: u32,
    pub population: u32,
    pub context: ProgrammeContext,
    pub cultures: Vec<CultureMapping>,
    pub demands: Vec<Demand>,
    pub reservations: Vec<Reservation>,
    pub allocations: Vec<Allocation>,
    pub adjacency: Vec<Adjacency>,
    pub environment: Vec<BlockEnvironment>,
    pub reconciliation_passes: usize,
    pub warnings: Vec<String>,
    /// Households all the domestic-admissible plots could hold (household
    /// caps summed before allocation): the capacity the plan predicted.
    #[serde(default)]
    pub housing_capacity: f64,
}
fn demand(key: &str, function: &str, amount: f64, domestic: bool, why: String) -> Demand {
    Demand {
        id: format!("{key}/demand/{function}"),
        function: function.into(),
        unit: if domestic {
            "domesticUnits"
        } else {
            "usefulAreaM2"
        }
        .into(),
        requested: amount,
        target_area: if domestic { amount * 70.0 } else { amount },
        target_frontage: match function {
            "warehouse" => 9.0,
            "collective" => 8.0,
            "market" => 8.0,
            _ => 4.0,
        },
        provenance: vec![why],
        requires: if function == "warehouse" {
            vec!["navigableAccess".into()]
        } else {
            vec![]
        },
        parcel_capacity: 0.0,
        built_capacity: 0.0,
        open_capacity: 0.0,
        deficit: amount,
        reasons: vec![],
        role: String::new(),
        sites: 0,
        site: String::new(),
        landmark: false,
        district: String::new(),
        placement: String::new(),
    }
}
/// Role id of demands created before the service catalogue.
fn default_role(function: &str) -> &'static str {
    match function {
        "domestic" => "dwelling",
        "mixed" => "dwelling.shop",
        "market" => "commerce.market",
        "common" => "open.common",
        "workshop" => "craft.workshop",
        "warehouse" => "commerce.warehouse",
        _ => "civic.hall",
    }
}
fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
/// Uses the same continuous metric contacts as cadastral qualification.
#[cfg(test)]
fn block_front(layout: &Layout, shape: &Shape) -> Option<(usize, f64)> {
    super::parcels::block_contacts(shape, layout)
        .into_iter()
        .max_by(|a, b| {
            a.length
                .total_cmp(&b.length)
                .then_with(|| b.street.cmp(&a.street))
        })
        .map(|c| (c.street, c.length))
}
fn block_witness(layout: &Layout, shape: &Shape, width: f64, depth: f64) -> bool {
    super::parcels::contact_envelope(
        shape,
        &super::parcels::block_contacts(shape, layout),
        width,
        depth,
        0.8,
    )
    .is_some()
}
/// `contextual_mapping` only distinguishes these function classes.
fn function_class(function: &str) -> &'static str {
    match function {
        "domestic" => "domestic",
        "mixed" => "mixed",
        _ => "other",
    }
}
pub fn prepare(
    layout: &mut Layout,
    population: u32,
    context: &ProgrammeContext,
    surface: Surface<'_>,
) -> Result<(), String> {
    if !([
        "auto",
        "agricultural",
        "crossroads",
        "artisan",
        "riverine",
        "port",
        "capital",
    ]
    .contains(&context.role.as_str())
        || roles::is_isolated(&context.role))
        || roles::state(&context.state).is_none()
        || context
            .decay
            .is_some_and(|d| !d.is_finite() || !(0.0..=1.0).contains(&d))
        || !["strict", "inspired", "fantasy"].contains(&context.mode.as_str())
        || context.resources.len() > 64
        || context.lore.len() > 32
        || context.period.len() > 64
    {
        return Err("Invalid urban programme context".into());
    }
    let base = mapping(&layout.culture).ok_or("Unknown urban cultural mapping")?;
    let cultural_functions = base.functional_profile.as_str();
    let mut ids = vec![layout.culture.clone()];
    for phase in &layout.phases {
        if !phase.culture.is_empty() && !ids.contains(&phase.culture) {
            mapping(&phase.culture).ok_or("Unknown phase cultural mapping")?;
            ids.push(phase.culture.clone());
        }
    }
    let mut warnings = vec![];
    let cultures = ids
        .iter()
        .filter_map(|id| {
            let selected = super::culture::isolated_mapping(id, &context.period, &context.role);
            if selected.is_none() {
                warnings.push(format!(
                    "No supported native recipe for culture:{id}; period:{}",
                    context.period
                ));
            }
            selected
        })
        .collect::<Vec<_>>();
    let n = f64::from(population);
    let role = if context.role == "auto" {
        if population < 500 || cultural_functions == "communal" {
            "agricultural"
        } else {
            "auto"
        }
    } else {
        &context.role
    };
    // A hamlet has no shop: its few households farm.
    let mixed_share = if population < 150 {
        0.0
    } else if matches!(role, "crossroads" | "port" | "capital") {
        0.25
    } else {
        0.08
    };
    let occupancy = roles::occupancy(&layout.culture);
    // Households of the cultural size (extended families in courtyard cultures).
    let households = n / occupancy.household_size;
    let mut demands = vec![
        demand(
            &layout.key,
            "domestic",
            households * (1.0 - mixed_share),
            true,
            format!(
                "population:{population}; profile:{} persons/domesticUnit; culture:{}; period:{}",
                occupancy.household_size, layout.culture, context.period
            ),
        ),
        demand(
            &layout.key,
            "mixed",
            households * mixed_share,
            true,
            format!("role:{role}; mixed household share:{mixed_share}"),
        ),
    ];
    demands.push(demand(
        &layout.key,
        "common",
        (n * if role == "agricultural" || cultural_functions == "communal" {
            2.0
        } else {
            0.5
        })
        .max(30.0),
        false,
        format!("role:{role}; culture profile:{cultural_functions}; open common, no building"),
    ));
    let known_work = context
        .resources
        .iter()
        .filter(|r| ["timber", "stone", "ore", "clay"].contains(&r.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if role == "artisan" || !known_work.is_empty() {
        let mut d = demand(
            &layout.key,
            "workshop",
            (n * if role == "artisan" { 3.5 } else { 1.0 }).max(80.0),
            false,
            format!("role:{role}; known resources:{}", known_work.join(",")),
        );
        if !known_work.is_empty() {
            d.requires
                .push(format!("knownResource:{}", known_work.join("|")));
        }
        demands.push(d);
    }
    // A river or sea pixel never creates this demand or its access evidence.
    if role == "port" || context.navigable_access {
        demands.push(demand(
            &layout.key,
            "warehouse",
            (n * 2.0).max(180.0),
            false,
            format!(
                "explicit navigableAccess:{}; role:{role}",
                context.navigable_access
            ),
        ));
    }
    if let Some(token) = context
        .lore
        .iter()
        .find(|s| ["temple", "palace", "necropolis", "magic"].contains(&s.as_str()))
    {
        let mut d = demand(
            &layout.key,
            "collective",
            (n * 0.8).max(250.0),
            false,
            format!("explicit lore:{}", context.lore.join(",")),
        );
        d.role = format!("lore.{token}");
        d.landmark = true;
        demands.push(d);
    }
    let isolated_rule = roles::isolated(&context.role);
    let isolated = isolated_rule.is_some();
    if !isolated {
        // Data-driven building roles, landmarks first so they win central land.
        let mut needs = roles::services(&layout.culture, population, role);
        needs.sort_by_key(|s| !s.entry.landmark);
        for need in needs {
            let e = &need.entry;
            let mut d = demand(
                &layout.key,
                &e.function,
                need.area * need.sites as f64,
                false,
                format!(
                    "services:{}; population:{population}; {} site(s) of {:.0} m²; site:{}",
                    roles::family(&layout.culture),
                    need.sites,
                    need.area,
                    e.site
                ),
            );
            let main_market = e.function == "market" && e.per == 0.0;
            d.id = if main_market && !demands.iter().any(|x| x.id.ends_with("/demand/market")) {
                format!("{}/demand/market", layout.key)
            } else {
                format!("{}/demand/{}", layout.key, e.role)
            };
            if demands.iter().any(|x| x.id == d.id) {
                continue;
            }
            d.target_area = need.area;
            if e.function == "warehouse" {
                d.requires.clear();
            }
            if e.requires == "water" {
                d.requires.push("waterfront".into());
            }
            if e.function == "collective" && !roles::reserves_block(e) {
                d.target_frontage = 5.0;
            }
            d.role = e.role.clone();
            d.sites = need.sites;
            d.site = e.site.clone();
            d.landmark = e.landmark;
            d.district = e.district.clone();
            d.placement = if roles::reserves_block(e) {
                "block"
            } else {
                "parcel"
            }
            .into();
            demands.push(d);
        }
    }
    if let Some(rule) = isolated_rule {
        // A named site is an intention for one native structure, not a town
        // whose household demand is inferred from its visitor/population field.
        let farm = rule.function == "domestic";
        let minimum_area = cultures.first().map_or(0.0, |c| c.admissibility.min_area);
        let function = rule.function.as_str();
        let mut d = demand(
            &layout.key,
            function,
            if farm {
                1.0
            } else {
                (n * 0.8).max(minimum_area * 0.55)
            },
            farm,
            format!(
                "Explicit isolated site:{}; one structure; population:{population} is not a housing target",
                context.role
            ),
        );
        d.target_area = if farm {
            minimum_area
        } else {
            d.requested / 0.55
        };
        d.role = rule.role.clone();
        d.landmark = rule.landmark;
        demands = vec![d];
    }
    // A declining town keeps more homes than households: the surplus stands
    // empty (role suffix, no household) once allocated.
    let decay = context
        .decay
        .or_else(|| roles::state(&context.state).map(|s| s.decay))
        .unwrap_or(0.0);
    if decay > 0.0 && decay < 0.95 {
        for d in demands.iter_mut().filter(|d| d.unit == "domesticUnits") {
            d.requested /= 1.0 - decay;
            d.deficit = d.requested;
            d.target_area /= 1.0 - decay;
            d.provenance
                .push(format!("state:{}; empty share:{decay:.2}", context.state));
        }
    }
    for d in &mut demands {
        if d.role.is_empty() {
            d.role = default_role(&d.function).into();
        }
    }
    let tick = std::time::Instant::now();
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "  programme.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    let road_pressures = super::parcels::occupation_pressures(layout);
    lap("pressures");
    let front_index = super::parcels::FrontageIndex::new(layout);
    let block_contacts = super::par::map(&layout.blocks, |_, b| {
        super::parcels::block_contacts_indexed(&b.shape, layout, &front_index)
    });
    lap("contacts");
    let mut environment = layout
        .blocks
        .iter()
        .enumerate()
        .map(|(block, b)| {
            let c = centroid(&b.shape);
            let h = surface.height_at(c);
            let slope = b
                .shape
                .outer
                .iter()
                .map(|p| (surface.height_at(*p) - h).abs() / dist(*p, c).max(1.0))
                .fold(0.0, f64::max);
            let front = water_front(&surface, &b.shape);
            BlockEnvironment {
                pressure: if surface.wet(c) {
                    0.0
                } else {
                    road_pressures.get(block).copied().unwrap_or(0.0) / (1.0 + 3.0 * slope)
                },
                block,
                slope,
                wet: block_is_wet(surface, &b.shape, c),
                waterfront: front.is_some(),
                height: h,
                district: None,
                water: front.map_or_else(String::new, |f| f.0.into()),
                water_height: front.map_or(0.0, |f| f.1),
            }
        })
        .collect::<Vec<_>>();
    // District roles read the same environment the services are sited with.
    // A sea or lake shore is a harbour; a river carries boats past a town.
    let navigable = context.navigable_access
        || environment
            .iter()
            .any(|e| matches!(e.water.as_str(), "sea" | "lake"))
        || (population >= 3000 && environment.iter().any(|e| e.water == "river"));
    lap("environment");
    let block_district = roles::assign(layout, population, navigable, &environment);
    lap("districts");
    for (e, d) in environment.iter_mut().zip(block_district) {
        e.district = d;
    }
    // Water-bound trades (mills, boat sheds) only exist where there is water.
    if !environment.iter().any(|e| e.waterfront) {
        demands.retain(|d| !d.requires.iter().any(|r| r == "waterfront"));
    }
    let district_roles: Vec<String> = layout.structure.as_ref().map_or_else(Vec::new, |s| {
        s.districts.iter().map(|d| d.role.clone()).collect()
    });
    let frame = Frame::new(layout, &environment);
    let mut reservations = vec![];
    let mut used = BTreeSet::new();
    let mut reservation_order = demands
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            isolated
                || d.placement == "block"
                || (d.sites == 0
                    && matches!(
                        d.function.as_str(),
                        "market" | "collective" | "warehouse" | "common"
                    ))
                || (d.function == "workshop"
                    && d.requires.iter().any(|r| r.starts_with("knownResource:")))
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    // Existing markets and constrained built functions retain first choice;
    // open commons then use remaining public land, never private rear gardens.
    reservation_order.sort_by_key(|&i| {
        (
            match demands[i].function.as_str() {
                "market" => 0,
                "warehouse" => 1,
                "collective" => 2,
                "workshop" => 3,
                "common" => 4,
                _ => 5,
            },
            !demands[i].landmark,
        )
    });
    // Block module, admission and contact envelope are pure per (block,
    // function class): memoised once, shared by the per-block parallel scan.
    use std::sync::OnceLock;
    let class_index = |c: &str| match c {
        "domestic" => 0,
        "mixed" => 1,
        _ => 2,
    };
    let modules: Vec<OnceLock<Option<f64>>> =
        layout.blocks.iter().map(|_| OnceLock::new()).collect();
    type Admission = OnceLock<Option<super::UrbanAdmissibility>>;
    let admissions: Vec<[Admission; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let envelopes: Vec<[OnceLock<bool>; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let foundable: Vec<[OnceLock<bool>; 3]> = layout
        .blocks
        .iter()
        .map(|_| std::array::from_fn(|_| OnceLock::new()))
        .collect();
    let centroids: Vec<Point> = super::par::map(&layout.blocks, |_, b| centroid(&b.shape));
    let areas: Vec<f64> = super::par::map(&layout.blocks, |_, b| area(&b.shape));
    for di in reservation_order {
        let d = &mut demands[di];
        if d.requires.iter().any(|r| r == "navigableAccess") && !context.navigable_access {
            d.reasons
                .push("No explicit navigable access; water proximity is insufficient".into());
            continue;
        }
        let needs_water = d
            .requires
            .iter()
            .any(|r| r == "navigableAccess" || r == "waterfront");
        let class = function_class(&d.function);
        let (layout_ref, used_ref, demand) = (&*layout, &used, &*d);
        let mut options = super::par::map(&layout_ref.blocks, |bi, b| {
            let (layout, used, d) = (layout_ref, used_ref, demand);
            if needs_water && !environment[bi].waterfront {
                return None;
            }
            let existing_open = match d.function.as_str() {
                "market" => matches!(b.kind.as_str(), "place" | "market" | "reserve:market"),
                "common" => matches!(b.kind.as_str(), "place" | "common" | "reserve:common"),
                _ => false,
            };
            if (!existing_open && b.kind != "block") || used.contains(&bi) || environment[bi].wet {
                return None;
            }
            let isolated_profile;
            let profile = if isolated {
                isolated_profile = super::culture::isolated_mapping(
                    block_culture(layout, bi),
                    &context.period,
                    &context.role,
                )?
                .admissibility;
                &isolated_profile
            } else {
                admissions[bi][class_index(class)]
                    .get_or_init(|| {
                        super::culture::block_mapping(
                            layout,
                            block_culture(layout, bi),
                            bi,
                            &d.function,
                            &context.period,
                        )
                        .map(|c| c.admissibility)
                    })
                    .as_ref()?
            };
            if environment[bi].slope > profile.max_slope {
                return None;
            }
            let filtered;
            let public_contacts: &[_] = if d.function == "common" {
                filtered = block_contacts[bi]
                    .iter()
                    .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
                    .cloned()
                    .collect::<Vec<_>>();
                &filtered
            } else {
                &block_contacts[bi]
            };
            let contact = public_contacts.iter().max_by(|a, b| {
                a.length
                    .total_cmp(&b.length)
                    .then_with(|| b.street.cmp(&a.street))
            })?;
            let (street, front) = (
                contact.street,
                super::parcels::continuous_frontage(public_contacts),
            );
            let a = areas[bi];
            let minimum = if d.function == "common"
                || matches!(contact.kind.as_str(), "private" | "collective")
            {
                profile.min_access_width
            } else {
                d.target_frontage
            };
            if front < minimum {
                return None;
            }
            let envelope = || {
                super::parcels::contact_envelope(
                    &b.shape,
                    &block_contacts[bi],
                    profile.min_frontage,
                    profile.min_depth,
                    profile.min_access_width,
                )
                .is_some()
            };
            if (isolated || matches!(d.function.as_str(), "warehouse" | "collective" | "workshop"))
                && !if isolated {
                    envelope()
                } else {
                    *envelopes[bi][class_index(class)].get_or_init(envelope)
                }
            {
                return None;
            }
            // A facility pins its block's native admission recipe: the block
            // must found it (houses' foundation step at a pose along one of its
            // streets), else the reservation only yields a refused building
            // and keeps the block from the tissue. Roles houses resolves from
            // its own functional registry pin nothing and are not tested here.
            if !isolated
                && super::building_sites::round7()
                && matches!(d.function.as_str(), "warehouse" | "collective" | "workshop")
                && !super::culture::functional_role_resolved(
                    block_culture(layout, bi),
                    &profile_pack(layout, bi, &d.function, &context.period),
                    &d.role,
                    &d.function,
                )
                && !*foundable[bi][class_index(class)].get_or_init(|| {
                    let dirs: Vec<Point> = block_contacts[bi]
                        .iter()
                        .filter(|c| c.length > 1.0)
                        .map(|c| Point {
                            x: (c.b.x - c.a.x) / c.length.max(1e-9),
                            y: (c.b.y - c.a.y) / c.length.max(1e-9),
                        })
                        .collect();
                    super::building_sites::recipe_foundable(
                        surface,
                        &b.shape,
                        &dirs,
                        &profile.recipe_id,
                    )
                })
            {
                return None;
            }
            // One facility follows the tissue's existing block module;
            // total metropolitan demand is served by several real sites.
            let module = modules[bi]
                .get_or_init(|| {
                    super::culture::block_morph(layout, block_culture(layout, bi), bi).map(
                        |(zone, m)| {
                            let r = m.range("blockSize", zone);
                            (r[0] + r[1]) * 0.5
                        },
                    )
                })
                .unwrap_or(profile.min_area)
                .max(profile.min_area);
            let target = if isolated {
                d.target_area.max(profile.min_area)
            } else {
                module.min(d.target_area.max(profile.min_area))
            };
            // Do not consume an oversized housing block for a tiny market
            // or workshop. Existing places and explicit isolated estates
            // retain their real geometry independently of this heuristic.
            if !isolated && !existing_open && a > target * 4.0 {
                return None;
            }
            let c = centroids[bi];
            let score = if d.sites > 0 {
                let facts = frame.facts(c, environment.get(bi));
                // A harbour's port roles stand only on quay-served blocks.
                if !roles::site_admissible(&d.site, &facts) {
                    return None;
                }
                let district = environment[bi]
                    .district
                    .and_then(|i| district_roles.get(i))
                    .is_some_and(|r| !d.district.is_empty() && r.starts_with(&d.district));
                (if existing_open { -3.0 } else { 0.0 })
                    + (a / target).ln().abs() * 0.7
                    + roles::site_cost(&d.site, &facts)
                    - if district { 1.0 } else { 0.0 }
            } else {
                (if existing_open { -1_000_000.0 } else { 0.0 })
                    + (a / target).ln().abs()
                    + dist(c, layout.center) / 1000.0
            };
            Some((
                bi,
                street,
                front,
                score + (d.target_frontage - front).max(0.0) / d.target_frontage.max(1.0),
            ))
        })
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        options.sort_by(|a, b| a.3.total_cmp(&b.3).then(a.0.cmp(&b.0)));
        // Site demands pick distinct, spread blocks; legacy demands fill area.
        let picks: Vec<(usize, usize, f64)> = if d.sites > 0 {
            let spacing = frame.radius * 1.6 / (d.sites as f64).sqrt();
            // Crowding of each option by the sites already chosen, summed in
            // choice order as they are picked (one pass per pick, not per
            // option and pick). Started from an empty `sum` (-0.0), as the
            // former per-option sum, so the scores stay bit-identical.
            let mut crowd = vec![std::iter::empty::<f64>().sum::<f64>(); options.len()];
            let mut taken = vec![false; options.len()];
            let mut chosen: Vec<(usize, usize, f64)> = vec![];
            while chosen.len() < d.sites {
                let best = options
                    .iter()
                    .enumerate()
                    .filter(|(k, _)| !taken[*k])
                    .map(|(k, o)| (k, o, o.3 + 3.0 * crowd[k]))
                    .min_by(|a, b| a.2.total_cmp(&b.2).then(a.1.0.cmp(&b.1.0)));
                let Some((k, o, _)) = best else { break };
                taken[k] = true;
                chosen.push((o.0, o.1, o.2));
                let c = centroids[o.0];
                for (j, q) in options.iter().enumerate() {
                    crowd[j] += (1.0 - dist(centroids[q.0], c) / spacing).max(0.0);
                }
            }
            chosen
        } else {
            let mut reserved_capacity = 0.0;
            let mut out = vec![];
            for &(bi, street, front, _) in &options {
                if !out.is_empty() && (isolated || reserved_capacity + 0.01 >= d.requested) {
                    break;
                }
                reserved_capacity += capacity(areas[bi], d);
                out.push((bi, street, front));
            }
            out
        };
        let mut reserved_capacity = 0.0;
        for &(bi, street, front) in &picks {
            used.insert(bi);
            if layout.blocks[bi].kind == "block" {
                layout.blocks[bi].kind = "reserve:programme".into();
            }
            reservations.push(Reservation {
                id: format!("{}/reserve/{}/{}", layout.key, d.function, bi),
                demand_id: d.id.clone(),
                block: bi,
                shape: layout.blocks[bi].shape.clone(),
                street,
                frontage: front,
            });
            reserved_capacity += capacity(areas[bi], d);
        }
        if picks.is_empty() {
            d.reasons.push(
                "No suitably sized accessible block for reservation before subdivision".into(),
            );
        } else if d.sites > 0 && picks.len() < d.sites {
            d.reasons.push(format!(
                "Only {} of {} sites reserved before subdivision",
                picks.len(),
                d.sites
            ));
        } else if !isolated && d.sites == 0 && reserved_capacity + 0.01 < d.requested {
            d.reasons.push("Accessible reserved sites do not cover the indicative land capacity; built capacity remains unverified".into());
        }
    }
    lap("reservations");
    if let Some(structure) = &mut layout.structure {
        structure.metrics.reserved_area = layout
            .blocks
            .iter()
            .filter(|b| b.kind != "block")
            .map(|b| area(&b.shape))
            .sum();
    }
    layout.programme = Some(UrbanProgramme {
        version: 1,
        population,
        context: context.clone(),
        cultures,
        demands,
        reservations,
        allocations: vec![],
        adjacency: vec![],
        environment,
        reconciliation_passes: 0,
        warnings,
        housing_capacity: 0.0,
    });
    Ok(())
}
/// A coastal contour can lie a few micrometres outside the exact land after
/// clipping. A wet boundary vertex alone must not disqualify an otherwise dry
/// block. Only these suspicious blocks need a boolean clip; interiors retain
/// the cheap point test. This is programme eligibility, not building clearance.
fn block_is_wet(surface: Surface<'_>, shape: &Shape, center: Point) -> bool {
    if surface.wet(center) {
        return true;
    }
    if !shape.outer.iter().any(|&p| surface.wet(p)) {
        return false;
    }
    let perimeter: f64 = std::iter::once(&shape.outer)
        .chain(shape.holes.iter())
        .map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| dist(a, b))
                .sum::<f64>()
        })
        .sum();
    let dry = super::geometry::dry_clip(&surface, shape);
    if area(shape) - dry.iter().map(area).sum::<f64>() > (perimeter * 1e-4).max(1e-4) {
        return true;
    }
    // Area alone would permit a very narrow but deep spike into the water.
    // Every suspicious vertex must also be within 0.1 mm of a dry boundary.
    // The later native footprint/access checks remain authoritative.
    shape.outer.iter().filter(|&&p| surface.wet(p)).any(|&p| {
        dry.iter()
            .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
            .flat_map(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
            })
            .map(|(&a, &b)| super::geometry::distance(p, a, b).0)
            .fold(f64::INFINITY, f64::min)
            > 1e-4
    })
}

/// Water a block fronts within a street and a quay of its outline: its kind
/// (`river`, `sea`, `lake`) and the ground height there. Samples outline
/// vertices and edge midpoints along both normals (the inner one only hits
/// water when the block itself is partly wet), nearest distance first.
fn water_front(surface: &Surface<'_>, shape: &Shape) -> Option<(&'static str, f64)> {
    let ring = &shape.outer;
    let n = ring.len();
    let stride = n.div_ceil(48).max(1);
    for d in [6.0, 15.0, 30.0] {
        for i in (0..n).step_by(stride) {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let len = dx.hypot(dy);
            if len < 1e-6 {
                continue;
            }
            for t in [0.0, 0.5] {
                for side in [d, -d] {
                    let q = Point {
                        x: a.x + dx * t - dy / len * side,
                        y: a.y + dy * t + dx / len * side,
                    };
                    if q.x >= 0.0
                        && q.y >= 0.0
                        && q.x < surface.width
                        && q.y < surface.width
                        && surface.wet(q)
                    {
                        return Some((water_kind(surface, q), surface.height_at(q)));
                    }
                }
            }
        }
    }
    None
}
/// Terrain raster water code at `p` (1 sea, 2 lake, 3 river), its own cell
/// first then its neighbours; vector water the raster misses is a stream.
fn water_kind(surface: &Surface<'_>, p: Point) -> &'static str {
    let n = surface.n as i64;
    let x = (p.x / surface.width * n as f64) as i64;
    let y = (p.y / surface.width * n as f64) as i64;
    let code = [
        (0, 0),
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
    ]
    .iter()
    .map(|(dx, dy)| ((x + dx).clamp(0, n - 1), (y + dy).clamp(0, n - 1)))
    .map(|(x, y)| surface.water[(y * n + x) as usize])
    .find(|&c| c != 0)
    .unwrap_or(3);
    match code {
        1 => "sea",
        2 => "lake",
        _ => "river",
    }
}
/// Architecture pack of a block's contextual mapping for a function.
fn profile_pack(layout: &Layout, block: usize, function: &str, period: &str) -> String {
    super::culture::block_mapping(
        layout,
        block_culture(layout, block),
        block,
        function,
        period,
    )
    .map(|c| c.architecture_pack)
    .unwrap_or_default()
}
fn block_culture(layout: &Layout, index: usize) -> &str {
    layout
        .blocks
        .get(index)
        .and_then(|b| {
            b.phase
                .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        })
        .and_then(|phase| layout.phases.get(phase))
        .map(|phase| phase.culture.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&layout.culture)
}
fn parcel_culture<'a>(layout: &'a Layout, p: &Parcel) -> &'a str {
    block_culture(layout, p.block)
}
/// Positive collinear overlap gives real edge adjacency, never centroid proximity.
fn shared(a: &Shape, b: &Shape) -> f64 {
    let mut sum = 0.0;
    for (&u, &v) in std::iter::once(&a.outer)
        .chain(a.holes.iter())
        .flat_map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
        })
    {
        let len = dist(u, v);
        if len < 0.01 {
            continue;
        }
        for (&p, &q) in std::iter::once(&b.outer)
            .chain(b.holes.iter())
            .flat_map(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
            })
        {
            let cross =
                |x: Point| ((x.x - u.x) * (v.y - u.y) - (x.y - u.y) * (v.x - u.x)).abs() / len;
            if cross(p) > 0.02 || cross(q) > 0.02 {
                continue;
            }
            let t = |x: Point| ((x.x - u.x) * (v.x - u.x) + (x.y - u.y) * (v.y - u.y)) / len;
            let (lo, hi) = (t(p).min(t(q)), t(p).max(t(q)));
            sum += (hi.min(len) - lo.max(0.0)).max(0.0);
        }
    }
    sum
}
fn graph(partition: &Partition) -> (Vec<Adjacency>, Vec<Vec<usize>>) {
    let mut bins: BTreeMap<(i32, i32), Vec<usize>> = BTreeMap::new();
    let mut boxes = Vec::with_capacity(partition.parcels.len());
    for (i, p) in partition.parcels.iter().enumerate() {
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &p.shape.outer {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        boxes.push((x0, y0, x1, y1));
        for x in ((x0 - 0.03) / 64.0).floor() as i32..=((x1 + 0.03) / 64.0).floor() as i32 {
            for y in ((y0 - 0.03) / 64.0).floor() as i32..=((y1 + 0.03) / 64.0).floor() as i32 {
                bins.entry((x, y)).or_default().push(i);
            }
        }
    }
    let mut tested = BTreeSet::new();
    let mut edges = vec![];
    let mut neighbours = vec![vec![]; partition.parcels.len()];
    for ids in bins.values() {
        for (at, &a) in ids.iter().enumerate() {
            for &b in &ids[at + 1..] {
                // Disjoint boxes cannot share an edge: skip the exact test.
                let (p, q) = (boxes[a], boxes[b]);
                if p.0 > q.2 + 0.05 || q.0 > p.2 + 0.05 || p.1 > q.3 + 0.05 || q.1 > p.3 + 0.05 {
                    continue;
                }
                if !tested.insert((a.min(b), a.max(b))) {
                    continue;
                }
                let length = shared(&partition.parcels[a].shape, &partition.parcels[b].shape);
                if length > 0.1 {
                    neighbours[a].push(b);
                    neighbours[b].push(a);
                    edges.push(Adjacency {
                        a: partition.parcels[a].id.clone(),
                        b: partition.parcels[b].id.clone(),
                        shared_length: length,
                    });
                }
            }
        }
    }
    (edges, neighbours)
}
/// Witness rectangle, checked against all holes and edges. Several deterministic
/// stations prevent a concave centre from being mistaken for buildable width.
pub fn has_envelope(p: &Parcel, width: f64, depth: f64) -> bool {
    super::parcels::parcel_envelope(p, width, depth, 0.8).is_some()
}
#[cfg(test)]
fn public_open_access(p: &Parcel, minimum: f64) -> bool {
    let contacts = p
        .contacts
        .iter()
        .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
        .cloned()
        .collect::<Vec<_>>();
    open_access_with(p, minimum, super::parcels::continuous_frontage(&contacts))
}
fn open_access_with(p: &Parcel, minimum: f64, public_frontage: f64) -> bool {
    if p.access
        .as_ref()
        .is_some_and(|a| matches!(a.kind.as_str(), "attached" | "unserved" | "private"))
    {
        return false;
    }
    public_frontage >= minimum
        || (p.contacts.is_empty()
            && p.access.as_ref().is_some_and(|a| {
                matches!(a.kind.as_str(), "public" | "collective") && a.front_length >= minimum
            }))
}
/// Allocation memo: contextual mappings per (block, plot family, function class)
/// and envelope witnesses per (parcel, width, depth). Both are pure, and they
/// were recomputed for every demand x parcel.
#[derive(Default)]
struct Memo {
    mappings: HashMap<(usize, String, &'static str), Option<CultureMapping>>,
    envelopes: HashMap<(usize, u64, u64), bool>,
    /// Continuous frontage per parcel: (all contacts, public contacts only).
    frontages: HashMap<usize, (f64, f64)>,
    /// Reserved-block witnesses per (parcel, width, depth), on one street index.
    witnesses: HashMap<(usize, u64, u64), bool>,
    index: Option<super::parcels::FrontageIndex>,
}
impl Memo {
    fn block_witness(&mut self, layout: &Layout, pi: usize, p: &Parcel, w: f64, d: f64) -> bool {
        if pi == usize::MAX {
            return block_witness(layout, &p.shape, w, d);
        }
        if let Some(&hit) = self.witnesses.get(&(pi, w.to_bits(), d.to_bits())) {
            return hit;
        }
        let index = self
            .index
            .get_or_insert_with(|| super::parcels::FrontageIndex::new(layout));
        let contacts = super::parcels::block_contacts_indexed(&p.shape, layout, index);
        let ok = super::parcels::contact_envelope(&p.shape, &contacts, w, d, 0.8).is_some();
        self.witnesses.insert((pi, w.to_bits(), d.to_bits()), ok);
        ok
    }
    fn frontage(&mut self, pi: usize, p: &Parcel) -> (f64, f64) {
        let compute = || {
            let public = p
                .contacts
                .iter()
                .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
                .cloned()
                .collect::<Vec<_>>();
            (
                super::parcels::continuous_frontage(&p.contacts),
                super::parcels::continuous_frontage(&public),
            )
        };
        if pi == usize::MAX {
            return compute();
        }
        *self.frontages.entry(pi).or_insert_with(compute)
    }
    fn mapping(&mut self, layout: &Layout, p: &Parcel, function: &str) -> Option<&CultureMapping> {
        // Court and compound lots choose their profile per lot (full court
        // house or the pack's compact house), so they are memoised per lot.
        let family = match p.family.as_str() {
            "reserve" => "reserve".to_string(),
            "courtyard" | "compound" => format!("{}\u{1}{}", p.family, p.id),
            _ => p.family.clone(),
        };
        self.mappings
            .entry((p.block, family, function_class(function)))
            .or_insert_with(|| {
                super::culture::parcel_mapping(layout, p, parcel_culture(layout, p), function)
            })
            .as_ref()
    }
    fn envelope(&mut self, pi: usize, p: &Parcel, width: f64, depth: f64) -> bool {
        *self
            .envelopes
            .entry((pi, width.to_bits(), depth.to_bits()))
            .or_insert_with(|| stored_witness(p, width, depth) || has_envelope(p, width, depth))
    }
}
/// The cadastral witness is a frontage-anchored rectangle inside the plot, first
/// edge along the front. When it is at least `width` x `depth`, a smaller
/// rectangle at the same corner is a valid witness too; no geometry rerun.
fn stored_witness(p: &Parcel, width: f64, depth: f64) -> bool {
    let (Some(e), Some([fa, fb])) = (&p.envelope, p.front) else {
        return false;
    };
    let [a, b, c, ..] = e.outer[..] else {
        return false;
    };
    let (u, f) = ((b.x - a.x, b.y - a.y), (fb.x - fa.x, fb.y - fa.y));
    let (lu, lf) = (u.0.hypot(u.1), f.0.hypot(f.1));
    lu + 1e-6 >= width
        && dist(b, c) + 1e-6 >= depth
        && lf > 1e-6
        && (u.0 * f.1 - u.1 * f.0).abs() <= 0.02 * lu * lf
}
/// Copyable admission summary, so eligibility never clones a mapping.
#[derive(Clone, Copy)]
struct Admit {
    min_frontage: f64,
    min_depth: f64,
    min_access_width: f64,
    min_area: f64,
    max_slope: f64,
    borrowed: bool,
}
impl Admit {
    fn of(c: &CultureMapping) -> Self {
        let a = &c.admissibility;
        Self {
            min_frontage: a.min_frontage,
            min_depth: a.min_depth,
            min_access_width: a.min_access_width,
            min_area: a.min_area,
            max_slope: a.max_slope,
            borrowed: !c.borrowing.is_empty(),
        }
    }
}
#[cfg(test)]
fn eligible(layout: &Layout, p: &Parcel, d: &Demand, pr: &UrbanProgramme) -> bool {
    eligible_memo(layout, usize::MAX, p, d, pr, &mut Memo::default())
}
fn eligible_memo(
    layout: &Layout,
    pi: usize,
    p: &Parcel,
    d: &Demand,
    pr: &UrbanProgramme,
    memo: &mut Memo,
) -> bool {
    let Some(c) = memo.mapping(layout, p, &d.function).map(Admit::of) else {
        return false;
    };
    if pr.context.mode == "strict" && c.borrowed {
        return false;
    }
    if pr
        .environment
        .get(p.block)
        .is_some_and(|e| e.wet || e.slope > c.max_slope)
    {
        return false;
    }
    if d.requires.iter().any(|r| r == "navigableAccess")
        && (!pr.context.navigable_access
            || !pr.environment.get(p.block).is_some_and(|e| e.waterfront))
    {
        return false;
    }
    if d.requires.iter().any(|r| r == "waterfront")
        && !pr.environment.get(p.block).is_some_and(|e| e.waterfront)
    {
        return false;
    }
    let envelope = |memo: &mut Memo| {
        if pi == usize::MAX {
            has_envelope(p, c.min_frontage, c.min_depth)
        } else {
            memo.envelope(pi, p, c.min_frontage, c.min_depth)
        }
    };
    if let Some(res) = pr.reservations.iter().find(|r| r.block == p.block) {
        if res.demand_id != d.id {
            return false;
        }
        if matches!(d.function.as_str(), "market" | "common") {
            return open_access_with(p, c.min_access_width, memo.frontage(pi, p).1);
        }
        return envelope(memo) || memo.block_witness(layout, pi, p, c.min_frontage, c.min_depth);
    }
    if roles::is_isolated(&pr.context.role) {
        return false;
    }
    if matches!(d.function.as_str(), "market" | "common") {
        let accessible = open_access_with(p, c.min_access_width, memo.frontage(pi, p).1);
        let open_kind = matches!(p.use_kind.as_str(), "place" | "market" | "common")
            || (p.use_kind == "reserve"
                && matches!(p.reason.as_str(), "reserve:market" | "reserve:common"));
        if open_kind || d.function == "common" {
            return accessible && (open_kind || p.use_kind == "garden");
        }
    }
    if matches!(p.use_kind.as_str(), "reserve" | "place" | "market") {
        return false;
    }
    if !matches!(p.use_kind.as_str(), "plot" | "compound") {
        return false;
    }
    let Some(access) = &p.access else {
        return false;
    };
    let gate = matches!(access.kind.as_str(), "private" | "collective");
    let minimum = if gate {
        c.min_access_width
    } else {
        c.min_frontage.max(d.target_frontage)
    };
    let frontage = if p.contacts.is_empty() {
        access.front_length
    } else {
        memo.frontage(pi, p).0
    };
    if matches!(access.kind.as_str(), "unserved" | "attached") || frontage < minimum {
        return false;
    }
    area(&p.shape) >= c.min_area && envelope(memo)
}
fn capacity(a: f64, d: &Demand) -> f64 {
    if d.unit == "domesticUnits" {
        // Village and legacy fallback: one household per plot. Allocation uses
        // the per-plot household capacity computed from floor area instead.
        1.0
    } else if matches!(d.function.as_str(), "market" | "common") {
        a
    } else {
        a * 0.55
    }
}
/// Households a plot can hold: useful floor area over the cultural floor area per
/// household (scaled by district wealth), capped by the cultural tenement size.
/// Villages and communal cultures keep one household per plot.
fn household_capacity(
    a: f64,
    coverage: f64,
    floors: f64,
    occupancy: &roles::Occupancy,
    wealth: f64,
    village: bool,
) -> f64 {
    if village {
        return 1.0;
    }
    let per = occupancy.floor_per_household * (0.7 + 0.8 * wealth.clamp(0.0, 1.0));
    (a * coverage * floors / per)
        .floor()
        .clamp(1.0, occupancy.max_per_plot.max(1.0))
}
/// Reassign only uses. Streets, reservations and parcel shapes are immutable.
/// Priority bands: reserved institutions, then sited trades, then shops scaled to
/// the land actually left, then housing, then explicit gardens on the remainder.
pub fn allocate(layout: &Layout, partition: &mut Partition) {
    let tick = std::time::Instant::now();
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "  allocate.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    // The parcel stage can deliberately override cultural/default morphology.
    // Resolve allocation against those applied inputs without editing its parent.
    let mut applied = std::borrow::Cow::Borrowed(layout);
    if let Some(cfg) = &partition.config {
        let local = applied.to_mut();
        let config = local
            .config
            .get_or_insert_with(super::LayoutConfig::default);
        config.preset = cfg.preset.clone();
        config.recipe = cfg.recipe.clone();
        config.zone = cfg.zone.clone();
        config.density = cfg.density;
        config.params = cfg.params.clone();
        if cfg.culture != "site" {
            local.culture = cfg.culture.clone();
            for phase in &mut local.phases {
                phase.culture = cfg.culture.clone();
            }
        }
        if cfg.zone != "auto" {
            for block in &mut local.blocks {
                block.zone = cfg.zone.clone();
            }
        }
    }
    let layout = applied.as_ref();
    let Some(mut pr) = layout.programme.clone() else {
        return;
    };
    // Explicit reallocation rechecks the current native admission source, including
    // imported programmes whose old envelope/recipe may no longer match it.
    pr.cultures = pr
        .cultures
        .iter()
        .filter_map(|c| {
            super::culture::isolated_mapping(&c.culture, &pr.context.period, &pr.context.role)
        })
        .collect();
    if let Some(cfg) = &partition.config
        && cfg.culture != "site"
    {
        pr.cultures = super::culture::mapping_for(&cfg.culture, &pr.context.period)
            .into_iter()
            .collect();
    }
    pr.allocations.clear();
    pr.reconciliation_passes = 0;
    // Gardens are the remainder of each allocation, never an input.
    pr.demands.retain(|d| d.role != "open.garden");
    for d in &mut pr.demands {
        d.parcel_capacity = 0.0;
        d.built_capacity = 0.0;
        d.open_capacity = 0.0;
        d.deficit = d.requested;
        d.reasons
            .retain(|r| !r.starts_with("Insufficient admissible") && !r.starts_with("Placed "));
    }
    let part: &Partition = partition;
    let parcels = &part.parcels;
    let (edges, neighbours) = graph(part);
    pr.adjacency = edges;
    lap("graph");
    let mut assignments: Vec<Option<usize>> = vec![None; parcels.len()];
    let reserved_for = pr
        .reservations
        .iter()
        .map(|r| (r.block, r.demand_id.clone()))
        .collect::<BTreeMap<_, _>>();
    let land_areas = parcels.iter().map(|p| area(&p.shape)).collect::<Vec<_>>();
    let centres = parcels
        .iter()
        .map(|p| centroid(&p.shape))
        .collect::<Vec<_>>();
    let center_distances = centres
        .iter()
        .map(|&c| dist(c, layout.center))
        .collect::<Vec<_>>();
    let prime = parcels.iter().map(prime_frontage).collect::<Vec<_>>();
    let frame = Frame::new(layout, &pr.environment);
    let facts: Vec<SiteFacts> = parcels
        .iter()
        .zip(&centres)
        .map(|(p, &c)| frame.facts(c, pr.environment.get(p.block)))
        .collect();
    let districts = layout
        .structure
        .as_ref()
        .map_or(&[][..], |s| s.districts.as_slice());
    let block_district: Vec<Option<usize>> = pr.environment.iter().map(|e| e.district).collect();
    let district_of = |p: &Parcel| {
        block_district
            .get(p.block)
            .copied()
            .flatten()
            .and_then(|i| districts.get(i))
    };
    lap("facts");
    let mut memo = Memo::default();
    // Eligibility is shared by demands of one class outside reserved blocks.
    let mut classes: HashMap<(String, String, u64), Vec<bool>> = HashMap::new();
    let mut admission = pr
        .demands
        .iter()
        .map(|d| {
            // Sited roles only need their own reserved plots up front; any
            // other plot is tested lazily, best sites first (band 2).
            // Shops are a small share: their plots are tested lazily from the
            // best commercial frontages down (band 3).
            if d.function == "mixed" && d.unit == "domesticUnits" {
                return vec![false; parcels.len()];
            }
            if d.sites > 0 {
                return parcels
                    .iter()
                    .enumerate()
                    .map(|(pi, p)| {
                        reserved_for.get(&p.block) == Some(&d.id)
                            && eligible_memo(layout, pi, p, d, &pr, &mut memo)
                    })
                    .collect();
            }
            let key = (
                d.function.clone(),
                d.requires.join("|"),
                d.target_frontage.to_bits(),
            );
            if !classes.contains_key(&key) {
                let base = parcels
                    .iter()
                    .enumerate()
                    .map(|(pi, p)| {
                        !reserved_for.contains_key(&p.block)
                            && eligible_memo(layout, pi, p, d, &pr, &mut memo)
                    })
                    .collect::<Vec<_>>();
                classes.insert(key.clone(), base);
            }
            let mut row = classes[&key].clone();
            for (pi, p) in parcels.iter().enumerate() {
                if reserved_for.get(&p.block) == Some(&d.id) {
                    row[pi] = eligible_memo(layout, pi, p, d, &pr, &mut memo);
                }
            }
            row
        })
        .collect::<Vec<_>>();
    let take = |pr: &mut UrbanProgramme,
                assignments: &mut Vec<Option<usize>>,
                pi: usize,
                di: usize,
                cap: f64| {
        assignments[pi] = Some(di);
        pr.demands[di].parcel_capacity += cap;
    };
    lap("admission");
    // Band 0: user overrides (« éditer une parcelle ») take their lots first,
    // whatever their admission; every later band re-balances around them.
    // Dwelling capacity is counted once the plot household capacity is known.
    let mut forced: Vec<Option<(String, Option<f64>)>> = vec![None; parcels.len()];
    if let Some(cfg) = &part.config
        && !cfg.overrides.parcels.is_empty()
    {
        let index: HashMap<&str, usize> = parcels
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.as_str(), i))
            .collect();
        for (id, ov) in &cfg.overrides.parcels {
            // edits hook (urban/edits.rs): shape-only and deletion edits force no use.
            if !super::edits::sets_use(ov) {
                continue;
            }
            let Some(&pi) = index.get(id.as_str()) else {
                pr.warnings
                    .push(format!("Parcelle « {id} » introuvable : surcharge ignorée"));
                continue;
            };
            // edits hook (urban/edits.rs): a lot salt draws its use among the admissible ones.
            let drawn = super::edits::forced_use(ov, id, &pr.demands, |di| {
                eligible_memo(layout, pi, &parcels[pi], &pr.demands[di], &pr, &mut memo)
            });
            let Ok(drawn) = drawn.map_err(|w| pr.warnings.push(w)) else {
                continue;
            };
            let ov = &*drawn;
            let Some((di, role)) = override_demand(&mut pr, &part.key, ov) else {
                pr.warnings
                    .push(format!("Surcharge invalide pour la parcelle « {id} »"));
                continue;
            };
            admission.resize(pr.demands.len(), vec![false; parcels.len()]);
            assignments[pi] = Some(di);
            forced[pi] = Some((role, ov.households.map(|h| h.min(500.0))));
            if pr.demands[di].unit != "domesticUnits" {
                let cap = capacity(land_areas[pi], &pr.demands[di]);
                pr.demands[di].parcel_capacity += cap;
                if pr.demands[di].id.contains("/demand/override/") {
                    pr.demands[di].requested += cap;
                }
            }
        }
    }
    let locked: Vec<bool> = forced.iter().map(Option::is_some).collect();
    // Band 1: reserved institutions take their own blocks; legacy area demands
    // (commons, markets without a catalogue) keep the bounded scan.
    let mut order = (0..pr.demands.len()).collect::<Vec<_>>();
    order.sort_by_key(|&di| {
        let d = &pr.demands[di];
        let count = admission[di].iter().filter(|&&ok| ok).count();
        (!d.landmark, count, d.id.clone())
    });
    for &di in &order {
        let d = &pr.demands[di];
        if d.unit == "domesticUnits" || d.placement == "parcel" {
            continue;
        }
        if d.sites > 0 {
            let id = d.id.clone();
            for pi in 0..parcels.len() {
                if admission[di][pi]
                    && assignments[pi].is_none()
                    && reserved_for.get(&parcels[pi].block) == Some(&id)
                {
                    let cap = capacity(land_areas[pi], &pr.demands[di]);
                    take(&mut pr, &mut assignments, pi, di, cap);
                }
            }
            continue;
        }
        legacy_fill(
            &mut pr,
            di,
            0,
            parcels,
            &admission,
            &mut assignments,
            &neighbours,
            &land_areas,
            &center_distances,
            &reserved_for,
            &[],
            &locked,
        );
    }
    // Band 2: sited trades and small institutions, distinct and spread plots.
    // A block demand whose reservation failed falls back to the same rule.
    // Trades never take more than a fifth of the plots fit for housing.
    let housing_plots = (0..parcels.len())
        .filter(|&pi| {
            assignments[pi].is_none()
                && pr
                    .demands
                    .iter()
                    .enumerate()
                    .any(|(di, d)| d.unit == "domesticUnits" && admission[di][pi])
        })
        .count();
    let mut trade_budget = (housing_plots / 5).max(1);
    for &di in &order {
        let d = &pr.demands[di];
        if d.sites == 0 || d.unit == "domesticUnits" {
            continue;
        }
        let placed = assignments.iter().filter(|a| **a == Some(di)).count();
        if d.placement == "block" && placed > 0 {
            continue;
        }
        let spacing = frame.radius * 1.6 / (d.sites as f64).sqrt();
        let target = d.target_area.max(1.0);
        let mut candidates: Vec<(usize, f64)> = (0..parcels.len())
            .filter(|&pi| {
                assignments[pi].is_none()
                    && matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                    && !reserved_for.contains_key(&parcels[pi].block)
                    && roles::site_admissible(&d.site, &facts[pi])
            })
            .map(|pi| {
                let district = district_of(&parcels[pi])
                    .is_some_and(|x| !d.district.is_empty() && x.role.starts_with(&d.district));
                let size = (capacity(land_areas[pi], d) / target).ln().abs().min(3.0);
                // Open uses (cemeteries, commons, orchards) sit behind the
                // street wall, never on a main-street lot a house could take.
                let open_front = d.role.starts_with("open.") && prime[pi];
                (
                    pi,
                    roles::site_cost(&d.site, &facts[pi]) + size * 0.5
                        - if district { 1.0 } else { 0.0 }
                        + if open_front { 2.0 } else { 0.0 },
                )
            })
            .collect();
        candidates.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        // Only the best few hundred admissible candidates compete for the
        // spread penalty; eligibility is tested in cost order until then.
        let pool = 400 + d.sites * 40;
        let mut kept = Vec::with_capacity(pool);
        for c in candidates {
            if kept.len() >= pool {
                break;
            }
            if eligible_memo(layout, c.0, &parcels[c.0], d, &pr, &mut memo) {
                kept.push(c);
            }
        }
        // Crowding by already chosen sites, updated once per pick.
        let mut crowd = vec![0.0; kept.len()];
        let mut taken = vec![false; kept.len()];
        let mut chosen: Vec<usize> = vec![];
        while placed + chosen.len() < d.sites && trade_budget > 0 {
            let best = (0..kept.len())
                .filter(|&k| !taken[k])
                .map(|k| (k, kept[k].1 + 3.0 * crowd[k]))
                .min_by(|a, b| a.1.total_cmp(&b.1).then(kept[a.0].0.cmp(&kept[b.0].0)));
            let Some((k, _)) = best else { break };
            taken[k] = true;
            let q = centres[kept[k].0];
            for (j, c) in kept.iter().enumerate() {
                crowd[j] += (1.0 - dist(centres[c.0], q) / spacing).max(0.0);
            }
            chosen.push(kept[k].0);
            trade_budget -= 1;
        }
        for &pi in &chosen {
            let cap = capacity(land_areas[pi], &pr.demands[di]);
            take(&mut pr, &mut assignments, pi, di, cap);
        }
        if placed + chosen.len() < pr.demands[di].sites {
            let sites = pr.demands[di].sites;
            pr.demands[di].reasons.push(format!(
                "Placed {} of {sites} sites on admissible plots",
                placed + chosen.len()
            ));
        }
    }
    lap("bands");
    // Households per plot from floor area, floors and the cultural occupancy.
    let occupancy = roles::occupancy(&layout.culture);
    let village = pr.population < 500
        || mapping(&layout.culture).is_some_and(|m| m.functional_profile == "communal");
    let mut morphs: HashMap<(usize, String), Option<(f64, [f64; 2])>> = HashMap::new();
    let dwelling = pr
        .demands
        .iter()
        .enumerate()
        .filter(|(_, d)| d.unit == "domesticUnits")
        .map(|(di, _)| di)
        .collect::<Vec<_>>();
    let densify = super::footprint::capacity::of(layout)
        .filter(|_| {
            part.config
                .as_ref()
                .is_none_or(super::footprint::capacity::parcels_enabled)
        })
        .map_or(0.0, |c| c.densify);
    let household_caps = parcels
        .iter()
        .enumerate()
        .map(|(pi, p)| {
            if !dwelling.iter().any(|&di| admission[di][pi]) {
                return 0.0;
            }
            let culture = parcel_culture(layout, p).to_string();
            let tissue = morphs
                .entry((p.block, culture.clone()))
                .or_insert_with(|| {
                    super::culture::parcel_morph(layout, part, &culture, p.block).map(
                        |(zone, m)| {
                            let c = m.range("coverage", zone);
                            let s = &m.value["arch"]["storeys"];
                            (
                                ((c[0] + c[1]) * 0.5).clamp(0.2, 0.95),
                                [s[0].as_f64().unwrap_or(1.0), s[1].as_f64().unwrap_or(1.0)],
                            )
                        },
                    )
                })
                .unwrap_or((0.5, [1.0, 1.0]));
            let zone_village = layout
                .blocks
                .get(p.block)
                .is_some_and(|b| b.zone == "village");
            let limits = memo
                .mapping(layout, p, "domestic")
                .map_or([1, 1], |c| c.admissibility.floors);
            // A densified tissue (adaptive capacity) raises the floors toward
            // the upper bound its houses admit, never past it.
            let drawn = tissue.1[0] + (tissue.1[1] - tissue.1[0]) * p.pressure.clamp(0.0, 1.0);
            let top = f64::from(limits[1].max(limits[0]));
            let floors = (drawn + (top - drawn).max(0.0) * densify)
                .round()
                .clamp(f64::from(limits[0]), top);
            household_capacity(
                land_areas[pi],
                tissue.0,
                floors,
                &occupancy,
                district_of(p).map_or(0.5, |d| d.wealth),
                village || zone_village,
            )
        })
        .collect::<Vec<_>>();
    // Forced dwellings hold their stated households (else the plot capacity).
    for pi in 0..parcels.len() {
        if let (Some(di), Some(f)) = (assignments[pi], forced[pi].as_mut())
            && pr.demands[di].unit == "domesticUnits"
        {
            let held = *f.1.get_or_insert(household_caps[pi].max(1.0));
            pr.demands[di].parcel_capacity += held;
        }
    }
    pr.housing_capacity = household_caps.iter().sum();
    lap("capacity");
    // Spread the households over the land actually left: dense where land is
    // short, one household per plot (and gardens for the rest) where it abounds.
    let wanted: f64 = dwelling
        .iter()
        .map(|&di| (pr.demands[di].requested - pr.demands[di].parcel_capacity).max(0.0))
        .sum();
    let supply: f64 = (0..parcels.len())
        .filter(|&pi| assignments[pi].is_none())
        .map(|pi| household_caps[pi])
        .sum();
    let free = assignments.iter().map(Option::is_none).collect::<Vec<_>>();
    let pressures = parcels.iter().map(|p| p.pressure).collect::<Vec<_>>();
    let mut households = spread_households(&household_caps, &pressures, &free, wanted.ceil());
    // Band 3 and 4: shops first but only for their share of the land actually
    // left, then housing; shops can no longer starve households.
    let short = if wanted > 0.0 {
        (supply / wanted).min(1.0)
    } else {
        1.0
    };
    let mut extra_households = vec![false; parcels.len()];
    let mut dwelling_order = dwelling.clone();
    dwelling_order.sort_by_key(|&di| {
        (
            pr.demands[di].function != "mixed",
            pr.demands[di].id.clone(),
        )
    });
    for &di in &dwelling_order {
        let commercial = pr.demands[di].function == "mixed";
        let goal = if commercial {
            pr.demands[di].requested * short
        } else {
            pr.demands[di].requested
        };
        let base = parcels
            .iter()
            .enumerate()
            .map(|(pi, p)| {
                let front = p.access.as_ref().map_or(0.0, |a| a.front_length);
                let quarter = district_of(p).map_or(0.0, |d| {
                    if commercial && (d.role == "market" || d.role.starts_with("craft:")) {
                        1.0
                    } else {
                        0.0
                    }
                });
                // Street wall first: houses take every main-street lot before
                // any lane or back lot, so surplus land ends up behind them.
                let street = match (prime[pi], public_street(p)) {
                    (true, _) if commercial => 1.5,
                    (true, _) => PRIME_TIER,
                    (false, true) => 1.0,
                    _ => 0.0,
                };
                p.pressure * if commercial { 3.0 } else { 0.5 }
                    + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                    - center_distances[pi] / if commercial { 250.0 } else { 1500.0 }
                    + quarter
                    + street
            })
            .collect::<Vec<_>>();
        let mut row = admission[di].clone();
        if commercial {
            let mut ranked: Vec<usize> = (0..parcels.len())
                .filter(|&pi| {
                    assignments[pi].is_none()
                        && matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                })
                .collect();
            ranked.sort_by(|&a, &b| base[b].total_cmp(&base[a]).then(a.cmp(&b)));
            let wanted_plots = 3 * goal.ceil() as usize + 50;
            let mut found = 0;
            for pi in ranked {
                if found >= wanted_plots {
                    break;
                }
                let d = &pr.demands[di];
                if eligible_memo(layout, pi, &parcels[pi], d, &pr, &mut memo) {
                    row[pi] = true;
                    found += 1;
                }
            }
        }
        let mut cohesion = vec![0usize; assignments.len()];
        let mut heap = BinaryHeap::new();
        let score_key = |score: f64| {
            let bits = score.to_bits();
            if bits >> 63 == 0 {
                bits ^ (1 << 63)
            } else {
                !bits
            }
        };
        for (pi, p) in parcels.iter().enumerate() {
            if row[pi] && assignments[pi].is_none() {
                heap.push((score_key(base[pi]), Reverse(p.id.as_str()), pi, 0usize));
            }
        }
        while pr.demands[di].parcel_capacity + 0.01 < goal {
            let Some((_, _, pi, version)) = heap.pop() else {
                break;
            };
            if assignments[pi].is_some() || cohesion[pi] != version {
                continue;
            }
            take(&mut pr, &mut assignments, pi, di, households[pi].max(1.0));
            for &j in &neighbours[pi] {
                if row[j] && assignments[j].is_none() {
                    cohesion[j] += 1;
                    heap.push((
                        score_key(base[j] + 2.0 * cohesion[j] as f64),
                        Reverse(parcels[j].id.as_str()),
                        j,
                        cohesion[j],
                    ));
                }
            }
        }
        // Shops may overshoot their share by a few households on their last
        // plot; housing tops up its own plots, busiest first, within capacity.
        if !commercial && pr.demands[di].parcel_capacity + 0.01 < goal {
            let mut own: Vec<usize> = (0..parcels.len())
                .filter(|&pi| assignments[pi] == Some(di) && households[pi] < household_caps[pi])
                .collect();
            own.sort_by(|&a, &b| pressures[b].total_cmp(&pressures[a]).then(a.cmp(&b)));
            let mut grown = true;
            while grown && pr.demands[di].parcel_capacity + 0.01 < goal {
                grown = false;
                for &pi in &own {
                    if pr.demands[di].parcel_capacity + 0.01 >= goal {
                        break;
                    }
                    if households[pi] < household_caps[pi] {
                        households[pi] += 1.0;
                        pr.demands[di].parcel_capacity += 1.0;
                        grown = true;
                    }
                }
            }
        }
        if commercial {
            continue;
        }
        // A main-street lot never stays an empty garden while a house can
        // stand there: surplus frontage gets one household past the demand.
        let mut extra = 0usize;
        while let Some((_, _, pi, version)) = heap.pop() {
            if assignments[pi].is_some() || cohesion[pi] != version {
                continue;
            }
            if !prime[pi] {
                break;
            }
            take(&mut pr, &mut assignments, pi, di, 1.0);
            extra_households[pi] = true;
            extra += 1;
        }
        if extra > 0 {
            pr.demands[di].reasons.push(format!(
                "{extra} maison(s) ajoutée(s) au-delà de la demande pour fermer les façades sur rue principale"
            ));
        }
    }
    lap("dwellings");
    // Lots kept by the second pass: user edits and the main-street wall.
    let keep: Vec<bool> = (0..parcels.len())
        .map(|pi| locked[pi] || (prime[pi] && assignments[pi].is_some()))
        .collect();
    // Bounded second pass: constrained legacy demands may still relocate an
    // oversupplied dwelling. Never displace a reservation or a sited role.
    for &di in &order {
        let d = &pr.demands[di];
        if d.sites > 0 || d.unit == "domesticUnits" {
            continue;
        }
        legacy_fill(
            &mut pr,
            di,
            1,
            parcels,
            &admission,
            &mut assignments,
            &neighbours,
            &land_areas,
            &center_distances,
            &reserved_for,
            &households,
            &keep,
        );
    }
    pr.reconciliation_passes = 2;
    // Band 5: every plot left over is an explicit garden, orchard or yard.
    // An isolated site is one intention: its other land stays as it is.
    let isolated = roles::is_isolated(&pr.context.role);
    let gardens: Vec<usize> = (0..parcels.len())
        .filter(|&pi| {
            !isolated
                && assignments[pi].is_none()
                && matches!(parcels[pi].use_kind.as_str(), "plot" | "compound")
                && !reserved_for.contains_key(&parcels[pi].block)
                && pr.environment.get(parcels[pi].block).is_none_or(|e| !e.wet)
        })
        .collect();
    if !gardens.is_empty() {
        let total: f64 = gardens.iter().map(|&pi| land_areas[pi]).sum();
        let mut g = demand(
            &part.key,
            "common",
            total,
            false,
            "Remainder of buildable plots after housing: private gardens and yards".into(),
        );
        g.id = format!("{}/demand/garden", part.key);
        g.role = "open.garden".into();
        let gi = pr.demands.len();
        pr.demands.push(g);
        for &pi in &gardens {
            take(&mut pr, &mut assignments, pi, gi, land_areas[pi]);
        }
    }
    for (pi, &assignment) in assignments.iter().enumerate() {
        let Some(di) = assignment else { continue };
        let p = &parcels[pi];
        let d = &pr.demands[di];
        // Gardens need no building recipe; they keep the parcel's cultural route.
        let user = forced[pi].as_ref();
        let c = match memo.mapping(layout, p, &d.function).cloned() {
            Some(c) => c,
            None if d.role == "open.garden" || user.is_some() => {
                match memo.mapping(layout, p, "domestic").cloned().or_else(|| {
                    super::culture::mapping_for(parcel_culture(layout, p), &pr.context.period)
                }) {
                    Some(c) => c,
                    None => continue,
                }
            }
            None => continue,
        };
        let same = neighbours[pi]
            .iter()
            .filter(|&&j| assignments[j] == Some(di))
            .count();
        let district = district_of(p);
        let dwelling = d.unit == "domesticUnits";
        let held = match user.and_then(|u| u.1) {
            Some(h) => h,
            None if dwelling && extra_households[pi] => 1.0,
            None if dwelling => households[pi].max(1.0),
            None => 0.0,
        };
        let role = if let Some((r, _)) = user {
            r.clone()
        } else if dwelling && d.function == "domestic" {
            dwelling_role(
                &c,
                held,
                land_areas[pi],
                district.map(|x| (x.role.as_str(), x.wealth)),
                pr.population < 500,
            )
        } else {
            d.role.clone()
        };
        let mut reasons = vec![
            "Admissible access and envelope".into(),
            format!("Native tissue recipe:{}", c.admissibility.recipe_id),
            format!("{} true edge neighbours", neighbours[pi].len()),
        ];
        if user.is_some() {
            reasons.insert(0, "Surcharge utilisateur".into());
        }
        pr.allocations.push(Allocation {
            parcel_id: p.id.clone(),
            demand_id: d.id.clone(),
            function: d.function.clone(),
            culture: c.culture.clone(),
            architecture_pack: c.architecture_pack.clone(),
            capacity: if dwelling {
                held
            } else {
                capacity(land_areas[pi], d)
            },
            unit: d.unit.clone(),
            score: same as f64,
            reasons,
            landmark: d.landmark || (user.is_some() && roles::is_landmark(&role)),
            label: String::new(),
            role,
            households: held,
            district_role: district.map_or_else(String::new, |x| x.role.clone()),
            wealth: district.map_or(0.5, |x| x.wealth),
        });
    }
    lap("gardens");
    decay(&mut pr, parcels, &facts, &locked);
    for a in &mut pr.allocations {
        a.label = roles::label(&a.role, &a.culture);
    }
    for d in &mut pr.demands {
        // Deficit here is the actual unbuilt demand. A separate land deficit is
        // displayed via requested - parcelCapacity until placements reconcile it.
        d.deficit = (d.requested - d.built_capacity).max(0.0);
        if d.sites == 0 && d.parcel_capacity + 0.01 < d.requested {
            d.reasons
                .push("Insufficient admissible parcel capacity after two allocation passes".into());
        }
    }
    if pr.context.mode == "strict" && pr.cultures.iter().any(|c| !c.borrowing.is_empty()) {
        pr.warnings
            .push("Strict mode refuses declared cultural borrowing".into());
    }
    // Adaptive capacity (`footprint::capacity`): every threshold crossed is
    // stated with its numbers, and so is a deficit the terrain or the
    // culture's bounds left; capacity is never invented.
    if let Some(plan) = super::footprint::capacity::of(layout) {
        let (wanted, housed) = pr
            .demands
            .iter()
            .filter(|d| d.unit == "domesticUnits")
            .fold((0.0, 0.0), |(w, h), d| {
                (w + d.requested, h + d.parcel_capacity.min(d.requested))
            });
        let mut steps = super::footprint::capacity::describe(&layout.culture, plan);
        let share = if wanted > 0.0 { housed / wanted } else { 1.0 };
        if std::env::var("URBAN_CAPACITY_DEBUG").is_ok() {
            // Prediction error of the shared estimator: footprint forecast and
            // block measure against the parcels' real household capacity.
            eprintln!(
                "{}",
                serde_json::json!({
                    "capacity": layout.culture,
                    "population": pr.population,
                    "required": plan.required.round(),
                    "forecast": plan.forecast.round(),
                    "measured": plan.predicted.round(),
                    "real": pr.housing_capacity.round(),
                    "densify": plan.densify,
                    "extension": plan.extension,
                    "donor": plan.donor,
                    "borrowed": plan.borrowed_share,
                    "vacancy": plan.vacancy,
                })
            );
        }
        if share < 0.95 {
            // Bounds reached (densified, widest land, borrowed everywhere a
            // donor exists) or terrain; else the tissue measured below its
            // probed forecast and the plan stopped short of its bounds.
            let bounded = plan.densify >= 0.999
                && (plan.borrowed_share >= 0.999
                    || (plan.donor.is_empty()
                        && plan.extension >= super::footprint::capacity::EXTENSION - 0.01));
            steps.push(format!(
                "déficit de {:.0} ménages : {}",
                wanted - housed,
                if bounded {
                    "le terrain ou les bornes de la culture limitent la capacité"
                } else {
                    "les îlots réels logent moins que la prévision du tissu"
                }
            ));
        }
        if !steps.is_empty() {
            partition.warnings.push(format!(
                "Capacité : {} — {} % des ménages logés.",
                steps.join(", "),
                (share * 100.0).floor()
            ));
        }
    }
    partition.programme = Some(pr);
    lap("done");
}
/// Heap tier of a main-street lot for housing: above any cohesion bonus.
const PRIME_TIER: f64 = 100.0;
/// Public frontage on a main street (rank 0 or 1): the street wall.
/// Main-street lots, and the faubourg lean-tos at the gates: built first
/// (shops ahead of houses) and never left as empty gardens while a house fits.
fn prime_frontage(p: &Parcel) -> bool {
    public_street(p) && (p.rank <= 1 || p.family == "faubourg")
}
fn public_street(p: &Parcel) -> bool {
    matches!(p.use_kind.as_str(), "plot" | "compound")
        && p.access.as_ref().is_some_and(|a| a.kind == "public")
}
/// Households per plot. Every free plot fit for housing holds one; the rest
/// of the wanted households fill the spare capacity of the busiest plots
/// first (weight grows with road pressure), so the core rises in tenements
/// and the edge stays one house per lot. The total equals `wanted` exactly
/// when the land allows it: the share is continuous in the fill factor and
/// rounded by largest remainders, with no rounding cliff. With more plots
/// than households every plot holds one and the allocation order decides
/// which ones become gardens. Plots already taken hold at most one.
fn spread_households(caps: &[f64], pressure: &[f64], free: &[bool], wanted: f64) -> Vec<f64> {
    let open: Vec<usize> = (0..caps.len())
        .filter(|&i| free[i] && caps[i] > 0.0)
        .collect();
    let mut out: Vec<f64> = caps
        .iter()
        .zip(free)
        .map(|(&c, &f)| {
            if c <= 0.0 {
                0.0
            } else if f {
                1.0
            } else {
                c.min(1.0)
            }
        })
        .collect();
    let extra = (wanted.round() - open.len() as f64).max(0.0);
    let spare = |i: usize| (caps[i] - 1.0).max(0.0);
    // Squared so the busy core clearly outgrows the quiet edge.
    let weight = |i: usize| spare(i) * (0.15 + pressure[i].clamp(0.0, 1.0)).powi(2);
    let total: f64 = open.iter().map(|&i| spare(i)).sum();
    if extra <= 0.0 {
        return out;
    }
    if extra >= total {
        for &i in &open {
            out[i] = caps[i];
        }
        return out;
    }
    let share = |i: usize, f: f64| spare(i).min(weight(i) * f);
    let (mut lo, mut hi) = (0.0, 50.0);
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if open.iter().map(|&i| share(i, mid)).sum::<f64>() < extra {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let mut rest = extra;
    let mut remainders = Vec::with_capacity(open.len());
    for &i in &open {
        let x = share(i, hi);
        let whole = x.floor();
        out[i] += whole;
        rest -= whole;
        if whole < spare(i) {
            remainders.push((x - whole, i));
        }
    }
    remainders.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    for &(_, i) in remainders.iter().take(rest.round().max(0.0) as usize) {
        out[i] += 1.0;
    }
    out
}
/// Dwelling type from the native layout, its households and the district.
fn dwelling_role(
    c: &CultureMapping,
    households: f64,
    area: f64,
    district: Option<(&str, f64)>,
    village: bool,
) -> String {
    if let Some((role, wealth)) = district
        && role == "elite"
    {
        return if wealth >= 0.65 && area >= 350.0 {
            "dwelling.mansion"
        } else {
            "dwelling.townhouse"
        }
        .into();
    }
    if households >= 3.0 {
        return "dwelling.tenement".into();
    }
    let layout = c.admissibility.native_layout.as_str();
    // A village house on a large plot is a farm: dwelling, barn and yard.
    if village && area >= 500.0 && !matches!(layout, "hut_compound" | "kraal" | "platform") {
        return "dwelling.farm".into();
    }
    match layout {
        "strip" => "dwelling.row",
        "courtyard" | "siheyuan" | "atrium" => "dwelling.courtyard",
        "hut_compound" | "kraal" | "kancha" | "multiyard" => "dwelling.compound",
        "platform" => "dwelling.platform",
        _ => "dwelling.house",
    }
    .into()
}
/// Demand absorbing a user-forced lot: the existing demand of that role (or the
/// town's housing for a dwelling type), else a new `override` demand sized by
/// the lots it receives. `None` when the override is malformed.
fn override_demand(
    pr: &mut UrbanProgramme,
    key: &str,
    ov: &ParcelOverride,
) -> Option<(usize, String)> {
    const FUNCTIONS: [&str; 7] = [
        "domestic",
        "mixed",
        "workshop",
        "warehouse",
        "collective",
        "market",
        "common",
    ];
    let valid = |r: &String| {
        (1..=64).contains(&r.len())
            && r.chars()
                .all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c))
    };
    if ov.role.as_ref().is_some_and(|r| !valid(r))
        || ov
            .function
            .as_ref()
            .is_some_and(|f| !FUNCTIONS.contains(&f.as_str()))
        || ov.households.is_some_and(|h| !h.is_finite() || h < 0.0)
    {
        return None;
    }
    let role = ov.role.clone();
    let function = ov
        .function
        .clone()
        .or_else(|| {
            let r = role.as_deref()?;
            pr.demands
                .iter()
                .find(|d| d.role == r)
                .map(|d| d.function.clone())
                .or_else(|| roles::role_function(r).map(str::to_owned))
        })
        .unwrap_or_else(|| {
            match role.as_deref().unwrap_or("dwelling") {
                r if r.starts_with("dwelling.shop") => "mixed",
                r if r.starts_with("dwelling") => "domestic",
                r if r.starts_with("open.") => "common",
                r if r.starts_with("craft.") => "workshop",
                r if r.starts_with("storage.") => "warehouse",
                _ => "collective",
            }
            .into()
        });
    let role = role.unwrap_or_else(|| default_role(&function).into());
    let dwelling = matches!(function.as_str(), "domestic" | "mixed");
    if let Some(di) = pr
        .demands
        .iter()
        .position(|d| d.role == role && d.function == function)
        .or_else(|| {
            dwelling
                .then(|| {
                    pr.demands
                        .iter()
                        .position(|d| d.unit == "domesticUnits" && d.function == function)
                })
                .flatten()
        })
    {
        return Some((di, role));
    }
    let id = format!("{key}/demand/override/{role}");
    if let Some(di) = pr.demands.iter().position(|d| d.id == id) {
        return Some((di, role));
    }
    let mut d = demand(
        key,
        &function,
        0.0,
        dwelling,
        "Surcharge utilisateur".into(),
    );
    d.id = id;
    d.role = role.clone();
    d.placement = "parcel".into();
    d.landmark = roles::is_landmark(&role);
    pr.demands.push(d);
    Some((pr.demands.len() - 1, role))
}
/// Settlement state (`services.json` states): a share of the built lots
/// stands empty or ruined, peripheral and low-traffic lots first; a fully
/// abandoned place leaves its gardens fallow. Empty buildings keep their lot,
/// function and form so houses and the UI can draw them as such.
fn decay(pr: &mut UrbanProgramme, parcels: &[Parcel], facts: &[SiteFacts], locked: &[bool]) {
    let Some(rule) = roles::state(&pr.context.state).filter(|r| !r.suffix.is_empty()) else {
        return;
    };
    let ratio = pr.context.decay.unwrap_or(rule.decay).clamp(0.0, 1.0);
    let index: HashMap<&str, usize> = parcels
        .iter()
        .enumerate()
        .map(|(i, p)| (p.id.as_str(), i))
        .collect();
    let all = ratio >= 0.999;
    let mut built: Vec<(usize, f64)> = pr
        .allocations
        .iter()
        .enumerate()
        .filter_map(|(ai, a)| {
            let pi = *index.get(a.parcel_id.as_str())?;
            let keep = a.role == "open.garden" || (!all && (a.landmark || locked[pi]));
            (!keep).then(|| (ai, facts[pi].core - facts[pi].pressure))
        })
        .collect();
    built.sort_by(|a, b| {
        b.1.total_cmp(&a.1).then_with(|| {
            pr.allocations[a.0]
                .parcel_id
                .cmp(&pr.allocations[b.0].parcel_id)
        })
    });
    let count = (ratio * built.len() as f64).round() as usize;
    for &(ai, _) in built.iter().take(count) {
        let a = &mut pr.allocations[ai];
        a.role.push_str(&rule.suffix);
        a.households = 0.0;
        if a.unit == "domesticUnits" {
            a.capacity = 0.0;
        }
    }
    if all {
        for a in pr
            .allocations
            .iter_mut()
            .filter(|a| a.role == "open.garden")
        {
            a.role = "open.fallow".into();
        }
    }
}
/// Area-driven fill for legacy demands (commons, warehouses, resource workshops):
/// most-cohesive admissible plot first, reserved plots of the demand before all.
#[allow(clippy::too_many_arguments)]
fn legacy_fill(
    pr: &mut UrbanProgramme,
    di: usize,
    pass: usize,
    parcels: &[Parcel],
    admission: &[Vec<bool>],
    assignments: &mut [Option<usize>],
    neighbours: &[Vec<usize>],
    land_areas: &[f64],
    center_distances: &[f64],
    reserved_for: &BTreeMap<usize, String>,
    units: &[f64],
    locked: &[bool],
) {
    while pr.demands[di].parcel_capacity + 0.01 < pr.demands[di].requested {
        let d = &pr.demands[di];
        let options = parcels
            .iter()
            .enumerate()
            .filter_map(|(pi, p)| {
                if !admission[di][pi] {
                    return None;
                }
                let prior = assignments[pi];
                if prior.is_some() && locked.get(pi) == Some(&true) {
                    return None;
                }
                // The bounded second pass can relocate a flexible, oversupplied
                // domestic/mixed allocation. Never displace a constraint/reserve.
                if let Some(old) = prior
                    && (pass == 0
                        || old == di
                        || !matches!(pr.demands[old].function.as_str(), "domestic" | "mixed")
                        || pr.demands[old].parcel_capacity - units.get(pi).copied().unwrap_or(1.0)
                            + 0.01
                            < pr.demands[old].requested)
                {
                    return None;
                }
                let cap = capacity(land_areas[pi], d);
                if cap <= 0.0 {
                    return None;
                }
                let coh = neighbours[pi]
                    .iter()
                    .filter(|&&j| assignments[j] == Some(di))
                    .count() as f64;
                let center = center_distances[pi];
                let front = p.access.as_ref().map_or(0.0, |a| a.front_length);
                let commercial = matches!(d.function.as_str(), "mixed" | "market" | "warehouse");
                let score = coh * 2.0
                    + p.pressure * if commercial { 3.0 } else { 0.5 }
                    + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                    - center / if commercial { 250.0 } else { 1500.0 }
                    - (cap - (d.requested - d.parcel_capacity)).max(0.0) / d.requested.max(1.0);
                // Retained reservations satisfy their own demand first.
                // Their access is carried by exact contacts, while the
                // cadastral access field intentionally remains reserved.
                let reserved = reserved_for.get(&p.block).is_some_and(|id| *id == d.id);
                Some((pi, score, reserved))
            })
            .collect::<Vec<_>>();
        let chosen = options.into_iter().max_by(|a, b| {
            a.2.cmp(&b.2)
                .then_with(|| a.1.total_cmp(&b.1))
                .then_with(|| parcels[b.0].id.cmp(&parcels[a.0].id))
        });
        let Some((pi, _, _)) = chosen else {
            break;
        };
        if let Some(old) = assignments[pi] {
            pr.demands[old].parcel_capacity -= units.get(pi).copied().unwrap_or(1.0);
        }
        assignments[pi] = Some(di);
        pr.demands[di].parcel_capacity += capacity(land_areas[pi], &pr.demands[di]);
    }
}

/// Allocation-only call for retained cadastral inputs, with no geometry mutation.
pub fn reallocate(layouts: &[Layout], partitions: &[Partition]) -> Result<Vec<Partition>, String> {
    let mut out = partitions.to_vec();
    for p in &mut out {
        let layout = layouts
            .iter()
            .find(|l| l.key == p.key)
            .ok_or("Partition has no retained layout")?;
        allocate(layout, p);
    }
    Ok(out)
}

/// Only accepted architectural results contribute to completed capacity. This
/// coarse boundary deliberately does not depend on the houses crate or renderer.
#[derive(Clone, Debug, Deserialize)]
pub struct BuiltCapacity {
    pub parcel_id: String,
    pub function: String,
    pub useful_area_m2: f64,
    pub domestic_units: f64,
}
#[derive(Clone, Debug, Deserialize)]
pub struct BuiltRefusal {
    pub parcel_id: String,
    pub message: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct BuiltOpenSpace {
    pub parcel_id: String,
    pub surface: Vec<Shape>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct BuiltScene {
    pub buildings: Vec<BuiltCapacity>,
    pub refusals: Vec<BuiltRefusal>,
    pub open_spaces: Vec<BuiltOpenSpace>,
}

pub fn reconcile_built(
    partitions: &[Partition],
    scene: &BuiltScene,
) -> Result<Vec<Partition>, String> {
    let mut applied = BTreeMap::new();
    for partition in partitions {
        if let Some(programme) = &partition.programme {
            let parcels = partition
                .parcels
                .iter()
                .map(|p| (p.id.as_str(), p))
                .collect::<BTreeMap<_, _>>();
            for allocation in &programme.allocations {
                let parcel = *parcels
                    .get(allocation.parcel_id.as_str())
                    .ok_or("Applied allocation has no cadastral parcel")?;
                if applied
                    .insert(allocation.parcel_id.as_str(), (allocation, parcel))
                    .is_some()
                {
                    return Err("Applied allocations must be unique per parcel".into());
                }
            }
        }
    }
    let buildings = scene
        .buildings
        .iter()
        .map(|b| (b.parcel_id.as_str(), b))
        .collect::<BTreeMap<_, _>>();
    let refusals = scene
        .refusals
        .iter()
        .map(|r| (r.parcel_id.as_str(), r))
        .collect::<BTreeMap<_, _>>();
    let mut identities = BTreeSet::new();
    for building in &scene.buildings {
        if !identities.insert(building.parcel_id.as_str())
            || !building.useful_area_m2.is_finite()
            || building.useful_area_m2 < 0.0
            || !building.domestic_units.is_finite()
            || building.domestic_units < 0.0
        {
            return Err(
                "Accepted building capacities must be finite, nonnegative and unique per parcel"
                    .into(),
            );
        }
        let (allocation, _) = applied
            .get(building.parcel_id.as_str())
            .ok_or("Accepted building has no applied allocation")?;
        if building.function != allocation.function
            || matches!(allocation.function.as_str(), "market" | "common")
        {
            return Err("Built function differs from applied allocation".into());
        }
    }
    for refusal in &scene.refusals {
        if !identities.insert(refusal.parcel_id.as_str())
            || !applied.contains_key(refusal.parcel_id.as_str())
        {
            return Err("Building/refusal outcomes must be unique and allocated".into());
        }
    }
    let mut open_areas = BTreeMap::new();
    for space in &scene.open_spaces {
        if !identities.insert(space.parcel_id.as_str()) {
            return Err("Open outcomes must be unique per parcel".into());
        }
        let (allocation, parcel) = applied
            .get(space.parcel_id.as_str())
            .ok_or("Open space has no applied allocation")?;
        if !matches!(allocation.function.as_str(), "market" | "common") {
            return Err("Open space does not match an applied open function".into());
        }
        if space.surface.is_empty()
            || space.surface.iter().any(|shape| {
                shape.outer.len() < 3
                    || shape.holes.iter().any(|h| h.len() < 3)
                    || shape
                        .outer
                        .iter()
                        .chain(shape.holes.iter().flatten())
                        .any(|p| !p.x.is_finite() || !p.y.is_finite())
            })
        {
            return Err("Invalid open capacity surface".into());
        }
        let total = space.surface.iter().map(area).sum::<f64>();
        let merged = super::geometry::union(&space.surface)
            .iter()
            .map(area)
            .sum::<f64>();
        let outside = space
            .surface
            .iter()
            .flat_map(|shape| difference(shape, &parcel.shape))
            .map(|shape| area(&shape))
            .sum::<f64>();
        let tolerance = 1e-4_f64.max(total * 1e-8);
        if !total.is_finite() || total - merged > tolerance || outside > tolerance {
            return Err(
                "Open capacity must be disjoint and remain inside its applied parcel".into(),
            );
        }
        open_areas.insert(space.parcel_id.as_str(), merged);
    }
    let mut result = partitions.to_vec();
    for partition in &mut result {
        let Some(programme) = &mut partition.programme else {
            continue;
        };
        for demand in &mut programme.demands {
            demand.built_capacity = 0.0;
            demand.open_capacity = 0.0;
            demand
                .reasons
                .retain(|reason| !reason.starts_with("Building refusal: "));
        }
        for allocation in &programme.allocations {
            let Some(demand) = programme
                .demands
                .iter_mut()
                .find(|d| d.id == allocation.demand_id)
            else {
                continue;
            };
            if let Some(building) = buildings.get(allocation.parcel_id.as_str()) {
                if building.function != allocation.function {
                    return Err("Built function differs from applied allocation".into());
                }
                demand.built_capacity += if demand.unit == "domesticUnits" {
                    building.domestic_units
                } else {
                    building.useful_area_m2
                };
            }
            if matches!(allocation.function.as_str(), "market" | "common")
                && let Some(open_area) = open_areas.get(allocation.parcel_id.as_str())
            {
                demand.open_capacity += open_area;
            }
            if let Some(refusal) = refusals.get(allocation.parcel_id.as_str()) {
                demand
                    .reasons
                    .push(format!("Building refusal: {}", refusal.message));
            }
        }
        for demand in &mut programme.demands {
            demand.deficit =
                (demand.requested - demand.built_capacity - demand.open_capacity).max(0.0);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::super::geometry::rectangle;
    use super::*;
    use serde_json::json;

    #[test]
    fn shoreline_roundoff_is_not_an_inundated_service_block() {
        let geography = super::super::Geography::new(
            super::super::VectorGeography {
                land: vec![rectangle(0., 0., 100., 100.).outer],
                water: vec![],
            },
            256.,
        )
        .unwrap();
        let height = vec![0.; 64 * 64];
        let water = vec![0; 64 * 64];
        let surface = Surface {
            geometry: Some(&geography),
            width: 256.,
            n: 64,
            height: &height,
            water: &water,
        };
        let coastal = rectangle(90., 20., 100.0000032, 60.);
        assert!(coastal.outer.iter().any(|&p| surface.wet(p)));
        assert!(!block_is_wet(surface, &coastal, centroid(&coastal)));
        // A real 2 cm intrusion is larger than numerical boundary tolerance.
        let submerged_edge = rectangle(90., 20., 100.02, 60.);
        assert!(block_is_wet(
            surface,
            &submerged_edge,
            centroid(&submerged_edge)
        ));
        let spike = Shape {
            outer: vec![
                Point { x: 90., y: 20. },
                Point { x: 100., y: 20. },
                Point { x: 100., y: 39.999 },
                Point { x: 100.02, y: 40. },
                Point { x: 100., y: 40.001 },
                Point { x: 100., y: 60. },
                Point { x: 90., y: 60. },
            ],
            holes: vec![],
        };
        assert!(block_is_wet(surface, &spike, centroid(&spike)));
        let submerged = rectangle(101., 20., 110., 60.);
        assert!(block_is_wet(surface, &submerged, centroid(&submerged)));
    }

    /// Invariant (Round 7 J): a facility block is reserved only where its
    /// pinned native recipe can be founded at a street pose.
    #[test]
    fn facilities_reserve_only_blocks_that_found_their_recipe() {
        let run = |grade: f32| {
            let blocks: Vec<_> = (0..4)
                .map(|i| {
                    let x = 20.0 + 110.0 * f64::from(i);
                    json!({"shape":rectangle(x,110.0,x+100.0,190.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}})
                })
                .collect();
            let mut l: Layout = serde_json::from_value(json!({"key":"forum","culture":"roman-core",
                "center":{"x":240.0,"y":150.0},"quarters":[],"blocks":blocks,
                "streets":[{"path":[{"x":10.0,"y":105.0},{"x":470.0,"y":105.0}],"widths":[10.0,10.0],"rank":1,"role":"street"},
                    {"path":[{"x":10.0,"y":195.0},{"x":470.0,"y":195.0}],"widths":[10.0,10.0],"rank":2,"role":"street"}],
                "warnings":[]}))
            .unwrap();
            // A plane rising away from the street: `grade` m per m.
            let height: Vec<f32> = (0..128 * 128)
                .map(|i| grade * ((i / 128) as f32 + 0.5) * 4.0)
                .collect();
            let water = vec![0; 128 * 128];
            prepare(
                &mut l,
                5000,
                &ProgrammeContext::default(),
                Surface {
                    geometry: None,
                    width: 512.0,
                    n: 128,
                    height: &height,
                    water: &water,
                },
            )
            .unwrap();
            l
        };
        let built = |l: &Layout| {
            let pr = l.programme.as_ref().unwrap();
            pr.reservations
                .iter()
                .filter(|r| {
                    pr.demands.iter().any(|d| {
                        d.id == r.demand_id
                            && matches!(d.function.as_str(), "collective" | "warehouse")
                    })
                })
                .map(|r| (r.block, area(&r.shape)))
                .collect::<Vec<_>>()
        };
        let level = run(0.0);
        assert!(!built(&level).is_empty());
        // 6 % everywhere: no Roman court building (26 m) founds within 0.75 m.
        let steep = run(0.06);
        assert!(built(&steep).is_empty(), "{:?}", built(&steep));
    }

    fn layout(culture: &str) -> Layout {
        serde_json::from_value(json!({"key":"programme-case","culture":culture,"center":{"x":150.0,"y":130.0},
            "quarters":[],"blocks":[{"shape":rectangle(110.0,110.0,130.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}},
            {"shape":rectangle(130.0,110.0,150.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}},
            {"shape":rectangle(150.0,110.0,170.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}}],
            "streets":[{"path":[{"x":100.0,"y":105.0},{"x":200.0,"y":105.0}],"widths":[10.0,10.0],"rank":1,"role":"street"}],"warnings":[]})).unwrap()
    }
    fn prepare_case(role: &str, navigable: bool, culture: &str) -> Layout {
        let mut l = layout(culture);
        let height = vec![0.0; 32 * 32];
        let water = vec![0; 32 * 32];
        prepare(
            &mut l,
            600,
            &ProgrammeContext {
                role: role.into(),
                navigable_access: navigable,
                resources: if role == "artisan" {
                    vec!["ore".into()]
                } else {
                    vec![]
                },
                ..Default::default()
            },
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        l
    }
    #[test]
    fn existing_market_place_precedes_reserving_an_ordinary_housing_block() {
        let mut l = layout("bastide");
        l.blocks[1].kind = "place".into();
        let height = vec![0.0; 1024];
        let water = vec![0; 1024];
        prepare(
            &mut l,
            600,
            &ProgrammeContext::default(),
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        let market = l
            .programme
            .as_ref()
            .unwrap()
            .demands
            .iter()
            .find(|d| d.function == "market")
            .unwrap();
        let reservation = l
            .programme
            .as_ref()
            .unwrap()
            .reservations
            .iter()
            .find(|r| r.demand_id == market.id)
            .unwrap();
        assert_eq!(reservation.block, 1);
        assert_eq!(l.blocks[1].kind, "place");
        assert_eq!(l.blocks.iter().filter(|b| b.kind == "block").count(), 1);
        let p = partition(&l).parcels.remove(1);
        assert!(eligible(&l, &p, market, l.programme.as_ref().unwrap()));
    }
    #[test]
    fn reserved_market_precedes_an_admissible_housing_frontage_at_allocation() {
        let mut l = layout("bastide");
        l.blocks[1].kind = "market".into();
        let height = vec![0.0; 1024];
        let water = vec![0; 1024];
        prepare(
            &mut l,
            600,
            &ProgrammeContext::default(),
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        let result = super::super::generate_parcels(
            "market-reservation-priority",
            &[l],
            &Default::default(),
        )
        .unwrap();
        let p = &result[0];
        let pr = p.programme.as_ref().unwrap();
        let market = pr
            .allocations
            .iter()
            .filter(|a| a.function == "market")
            .collect::<Vec<_>>();
        assert_eq!(market.len(), 1);
        let reserved = p
            .parcels
            .iter()
            .find(|p| p.id == market[0].parcel_id)
            .unwrap();
        assert_eq!(reserved.block, 1);
        assert_eq!(reserved.access.as_ref().unwrap().kind, "reserved");
        assert!(public_open_access(reserved, 0.8));
        assert!(
            pr.allocations
                .iter()
                .filter(|a| a.function == "domestic" || a.function == "mixed")
                .any(|a| {
                    p.parcels
                        .iter()
                        .any(|p| p.id == a.parcel_id && p.block != 1)
                })
        );
    }
    #[test]
    fn an_isolated_site_has_one_intent_and_one_unsubdivided_accessible_domain() {
        for (role, function) in [
            ("isolated-farm", "domestic"),
            ("roadside-temple", "collective"),
        ] {
            let mut l = layout("european-organic");
            let height = vec![0.0; 1024];
            let water = vec![0; 1024];
            prepare(
                &mut l,
                50_000,
                &ProgrammeContext {
                    role: role.into(),
                    resources: vec!["timber".into()],
                    lore: vec!["temple".into()],
                    ..Default::default()
                },
                Surface {
                    geometry: None,
                    width: 1000.0,
                    n: 32,
                    height: &height,
                    water: &water,
                },
            )
            .unwrap();
            let pr = l.programme.as_ref().unwrap();
            assert_eq!(pr.population, 50_000);
            assert_eq!(pr.demands.len(), 1);
            assert_eq!(pr.demands[0].function, function);
            assert_eq!(pr.reservations.len(), 1);
            if role == "isolated-farm" {
                assert_eq!(pr.demands[0].requested, 1.0);
            }
            let mut p = partition(&l);
            allocate(&l, &mut p);
            let pr = p.programme.unwrap();
            assert_eq!(pr.allocations.len(), 1);
            assert_eq!(pr.allocations[0].function, function);
            assert_eq!(
                pr.allocations[0].parcel_id,
                format!("lot/{}", pr.reservations[0].block)
            );
            assert_eq!(pr.demands[0].built_capacity, 0.0);
        }
    }
    #[test]
    fn metropolitan_collective_reservations_use_several_real_blocks_not_a_population_sized_sliver_test()
     {
        let mut l = layout("european-organic");
        let height = vec![0.0; 1024];
        let water = vec![0; 1024];
        // Every block is smaller than 35% of the collective demand. Enough
        // ordinary accessible land nevertheless exists for several real sites.
        let original = l.blocks[0].clone();
        l.blocks = (0..20)
            .map(|i| {
                let mut b = original.clone();
                b.kind = "block".into();
                b.shape = rectangle(
                    110.0 + i as f64 * 20.0,
                    110.0,
                    130.0 + i as f64 * 20.0,
                    140.0,
                );
                b
            })
            .collect();
        l.streets[0].path[1].x = 520.0;
        prepare(
            &mut l,
            5000,
            &ProgrammeContext {
                role: "capital".into(),
                ..Default::default()
            },
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        let pr = l.programme.as_ref().unwrap();
        // Catalogue institutions (town hall, keep, ...) each keep a real block.
        let collective = pr
            .demands
            .iter()
            .filter(|d| d.function == "collective")
            .map(|d| d.id.as_str())
            .collect::<BTreeSet<_>>();
        assert!(
            pr.reservations
                .iter()
                .filter(|r| collective.contains(r.demand_id.as_str()))
                .count()
                > 1
        );
        let ids = pr
            .reservations
            .iter()
            .map(|r| &r.id)
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), pr.reservations.len());
    }
    #[test]
    fn reserved_medina_collective_keeps_the_profile_used_before_subdivision() {
        let l = prepare_case("capital", false, "medina");
        let pr = l.programme.as_ref().unwrap();
        let demand = pr
            .demands
            .iter()
            .find(|d| d.function == "collective")
            .unwrap();
        let reserve = pr
            .reservations
            .iter()
            .find(|r| r.demand_id == demand.id)
            .unwrap();
        let mut p = partition(&l).parcels.remove(reserve.block);
        p.family = "reserve".into();
        let before = super::super::culture::block_mapping(
            &l,
            "medina",
            reserve.block,
            "collective",
            &pr.context.period,
        )
        .unwrap();
        let after = super::super::culture::parcel_mapping(&l, &p, "medina", "collective").unwrap();
        assert_eq!(before.admissibility.recipe_id, "AF-MAG-B01");
        assert_eq!(
            after.admissibility.recipe_id,
            before.admissibility.recipe_id
        );
        assert!(eligible(&l, &p, demand, pr));
    }
    #[test]
    fn private_attached_or_unserved_gardens_are_never_public_commons() {
        let l = prepare_case("agricultural", false, "european-organic");
        let mut pr = l.programme.clone().unwrap();
        pr.reservations.clear();
        let d = pr.demands.iter().find(|d| d.function == "common").unwrap();
        let mut p = partition(&l).parcels.remove(0);
        p.use_kind = "garden".into();
        assert!(eligible(&l, &p, d, &pr));
        for kind in ["attached", "unserved", "private"] {
            p.access.as_mut().unwrap().kind = kind.into();
            assert!(!eligible(&l, &p, d, &pr), "{kind}");
        }
    }
    #[test]
    fn metropolitan_commons_reserve_open_land_without_taking_markets_or_private_gardens() {
        let mut l = layout("european-organic");
        let original = l.blocks[0].clone();
        l.blocks = (0..200)
            .map(|i| {
                let mut b = original.clone();
                b.shape = rectangle(
                    110.0 + i as f64 * 20.0,
                    110.0,
                    130.0 + i as f64 * 20.0,
                    140.0,
                );
                b
            })
            .collect();
        l.blocks[0].kind = "market".into();
        // A disconnected pre-existing common cannot be promised as accessible.
        l.blocks[199].kind = "reserve:common".into();
        l.blocks[199].shape = rectangle(300.0, 300.0, 320.0, 330.0);
        l.streets[0].path[1].x = 4100.0;
        let height = vec![0.0; 1024];
        let water = vec![0; 1024];
        let surface = Surface {
            geometry: None,
            width: 5000.0,
            n: 32,
            height: &height,
            water: &water,
        };
        prepare(&mut l, 50_000, &ProgrammeContext::default(), surface).unwrap();
        let pr = l.programme.as_ref().unwrap();
        let d = pr.demands.iter().find(|d| d.function == "common").unwrap();
        assert_eq!(d.requested, 25_000.0);
        let reservations = pr
            .reservations
            .iter()
            .filter(|r| r.demand_id == d.id)
            .collect::<Vec<_>>();
        assert!(reservations.len() > 1);
        assert!(reservations.iter().all(|r| r.block != 0 && r.block != 199));
        assert_eq!(l.blocks[0].kind, "market");
        assert!(
            pr.reservations
                .iter()
                .any(|r| r.block == 0 && r.demand_id.ends_with("/market"))
        );
        let mut parts =
            super::super::generate_parcels("common-50000", &[l.clone()], &Default::default())
                .unwrap();
        let p = &mut parts[0];
        // An existing private garden is retained beside, but outside, the
        // reserved domains. Public street contact does not make it public.
        let used = pr
            .reservations
            .iter()
            .map(|r| r.block)
            .collect::<BTreeSet<_>>();
        let private = p
            .parcels
            .iter_mut()
            .find(|p| p.block != 199 && !used.contains(&p.block))
            .unwrap();
        private.use_kind = "garden".into();
        private.access.as_mut().unwrap().kind = "private".into();
        let private_id = private.id.clone();
        let private_shape = serde_json::to_value(&private.shape).unwrap();
        allocate(&l, p);
        let report = p.programme.as_ref().unwrap();
        let allocated = report
            .allocations
            .iter()
            .filter(|a| a.function == "common")
            .collect::<Vec<_>>();
        assert!(allocated.len() > 1);
        assert!(allocated.iter().all(|a| a.parcel_id != private_id));
        let private = p.parcels.iter().find(|p| p.id == private_id).unwrap();
        assert_eq!(private.use_kind, "garden");
        assert_eq!(serde_json::to_value(&private.shape).unwrap(), private_shape);
        let scene = BuiltScene {
            buildings: vec![],
            refusals: vec![],
            open_spaces: allocated
                .iter()
                .map(|a| {
                    let parcel = p.parcels.iter().find(|p| p.id == a.parcel_id).unwrap();
                    assert_eq!(parcel.use_kind, "reserve");
                    assert!(public_open_access(parcel, 0.8));
                    BuiltOpenSpace {
                        parcel_id: a.parcel_id.clone(),
                        surface: vec![parcel.shape.clone()],
                    }
                })
                .collect(),
        };
        let realised = reconcile_built(&parts, &scene).unwrap();
        let common = realised[0]
            .programme
            .as_ref()
            .unwrap()
            .demands
            .iter()
            .find(|d| d.function == "common")
            .unwrap();
        assert!(common.open_capacity >= 25_000.0);
        assert_eq!(common.built_capacity, 0.0);
        assert_eq!(common.deficit, 0.0);
    }
    fn partition(l: &Layout) -> Partition {
        serde_json::from_value(json!({"key":l.key,"warnings":[],"parcels":l.blocks.iter().enumerate().map(|(i,b)|json!({
            "id":format!("lot/{i}"),"shape":b.shape,"block":i,"use":if b.kind.starts_with("reserve"){"reserve"}else{"plot"},
            "front":[{"x":b.shape.outer[0].x,"y":110.0},{"x":b.shape.outer[1].x,"y":110.0}],"axis":{"x":1.0,"y":0.0},"rank":1,
            "access":{"kind":"public","street":0,"frontLength":20.0}
        })).collect::<Vec<_>>()})).unwrap()
    }
    #[test]
    fn realized_capacity_keeps_land_built_refusals_and_open_surfaces_separate() {
        let l = prepare_case("crossroads", false, "european-organic");
        let mut p = partition(&l);
        let key = p.key.clone();
        let mut pr = l.programme.clone().unwrap();
        let domestic = pr
            .demands
            .iter()
            .find(|d| d.function == "domestic")
            .unwrap()
            .id
            .clone();
        let market = pr
            .demands
            .iter()
            .find(|d| d.function == "market")
            .unwrap()
            .id
            .clone();
        pr.allocations = vec![
            Allocation {
                parcel_id: "lot/0".into(),
                demand_id: domestic.clone(),
                function: "domestic".into(),
                culture: l.culture.clone(),
                architecture_pack: "EUR-MED".into(),
                capacity: 99.0,
                unit: "domesticUnits".into(),
                score: 1.0,
                reasons: vec![],
                role: String::new(),
                label: String::new(),
                landmark: false,
                households: 0.0,
                district_role: String::new(),
                wealth: 0.5,
            },
            Allocation {
                parcel_id: "lot/1".into(),
                demand_id: domestic.clone(),
                function: "domestic".into(),
                culture: l.culture.clone(),
                architecture_pack: "EUR-MED".into(),
                capacity: 99.0,
                unit: "domesticUnits".into(),
                score: 1.0,
                reasons: vec![],
                role: String::new(),
                label: String::new(),
                landmark: false,
                households: 0.0,
                district_role: String::new(),
                wealth: 0.5,
            },
            Allocation {
                parcel_id: "lot/2".into(),
                demand_id: market.clone(),
                function: "market".into(),
                culture: l.culture.clone(),
                architecture_pack: "EUR-MED".into(),
                capacity: 600.0,
                unit: "usefulAreaM2".into(),
                score: 1.0,
                reasons: vec![],
                role: String::new(),
                label: String::new(),
                landmark: false,
                households: 0.0,
                district_role: String::new(),
                wealth: 0.5,
            },
        ];
        for d in &mut pr.demands {
            d.parcel_capacity = 500.0;
        }
        p.programme = Some(pr);
        let scene = BuiltScene {
            buildings: vec![BuiltCapacity {
                parcel_id: "lot/0".into(),
                function: "domestic".into(),
                useful_area_m2: 400.0,
                domestic_units: 1.0,
            }],
            refusals: vec![BuiltRefusal {
                parcel_id: "lot/1".into(),
                message: "no compatible foundation".into(),
            }],
            open_spaces: vec![BuiltOpenSpace {
                parcel_id: "lot/2".into(),
                surface: vec![p.parcels[2].shape.clone()],
            }],
        };
        let result = reconcile_built(std::slice::from_ref(&p), &scene).unwrap();
        assert_eq!(result[0].key, key);
        let report = result[0].programme.as_ref().unwrap();
        let housing = report.demands.iter().find(|d| d.id == domestic).unwrap();
        assert_eq!(housing.parcel_capacity, 500.0);
        assert_eq!(housing.built_capacity, 1.0);
        assert_eq!(housing.open_capacity, 0.0);
        assert_eq!(housing.deficit, housing.requested - 1.0);
        assert!(
            housing
                .reasons
                .iter()
                .any(|s| s.contains("no compatible foundation"))
        );
        let open = report.demands.iter().find(|d| d.id == market).unwrap();
        assert_eq!(open.built_capacity, 0.0);
        assert_eq!(open.open_capacity, 600.0);
        assert_eq!(open.deficit, (open.requested - 600.0).max(0.0));
        assert_eq!(
            serde_json::to_value(reconcile_built(&result, &scene).unwrap()).unwrap(),
            serde_json::to_value(&result).unwrap()
        );
        let mut invalid = scene.clone();
        invalid.buildings.push(invalid.buildings[0].clone());
        assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
        invalid = scene.clone();
        invalid.buildings[0].function = "warehouse".into();
        assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
        invalid = scene.clone();
        invalid.open_spaces.push(invalid.open_spaces[0].clone());
        assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
        invalid = scene.clone();
        let duplicate = invalid.open_spaces[0].surface[0].clone();
        invalid.open_spaces[0].surface.push(duplicate);
        assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
        invalid = scene.clone();
        invalid.open_spaces[0].surface = vec![rectangle(0.0, 0.0, 10.0, 10.0)];
        assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
    }

    #[test]
    fn domestic_land_budget_uses_the_same_units_as_the_current_building_path() {
        let mut l = layout("european-organic");
        let height = vec![0.0; 32 * 32];
        let water = vec![0; 32 * 32];
        prepare(
            &mut l,
            14,
            &ProgrammeContext {
                role: "agricultural".into(),
                ..Default::default()
            },
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        let mut p = partition(&l);
        allocate(&l, &mut p);
        let report = p.programme.unwrap();
        assert_eq!(
            report
                .allocations
                .iter()
                .filter(|a| a.unit == "domesticUnits")
                .count(),
            3,
            "Large parcel area cannot make two generated houses count as the three requested units"
        );
        assert!(
            report
                .allocations
                .iter()
                .filter(|a| a.unit == "domesticUnits")
                .all(|a| a.capacity == 1.0)
        );
    }

    #[test]
    fn a_private_gate_does_not_limit_the_width_of_the_domestic_body() {
        let mut l = prepare_case("agricultural", false, "medina");
        l.programme.as_mut().unwrap().reservations.clear();
        let mut p = partition(&l).parcels.remove(0);
        p.shape = rectangle(110.0, 110.0, 150.0, 150.0);
        p.use_kind = "compound".into();
        p.front = Some([Point { x: 129.0, y: 110.0 }, Point { x: 131.0, y: 110.0 }]);
        p.access.as_mut().unwrap().kind = "private".into();
        p.access.as_mut().unwrap().front_length = 2.0;
        let pr = l.programme.as_ref().unwrap();
        let d = pr
            .demands
            .iter()
            .find(|d| d.function == "domestic")
            .unwrap();
        assert!(mapping("medina").unwrap().admissibility.min_frontage > 2.0);
        assert!(eligible(&l, &p, d, pr));
        p.access.as_mut().unwrap().front_length = 0.5;
        assert!(!eligible(&l, &p, d, pr));
    }

    #[test]
    fn stale_cadastral_witness_cannot_bypass_the_current_cultural_profile() {
        let mut l = prepare_case("agricultural", false, "medina");
        let mut p = partition(&l).parcels.remove(0);
        p.shape = rectangle(110.0, 110.0, 116.0, 120.0);
        p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 116.0, y: 110.0 }]);
        p.envelope = Some(rectangle(110.1, 110.1, 114.1, 116.1));
        l.programme.as_mut().unwrap().reservations.clear();
        p.use_kind = "plot".into();
        let pr = l.programme.as_ref().unwrap();
        let d = pr
            .demands
            .iter()
            .find(|d| d.function == "domestic")
            .unwrap();
        assert!(!eligible(&l, &p, d, pr));
    }

    #[test]
    fn contextual_scenarios_keep_unknown_navigation_and_resource_provenance() {
        let ag = prepare_case("agricultural", false, "european-organic");
        let trade = prepare_case("crossroads", false, "european-organic");
        let river = prepare_case("riverine", false, "european-organic");
        let artisan = prepare_case("artisan", false, "european-organic");
        let find = |l: &Layout, f: &str| {
            l.programme
                .as_ref()
                .unwrap()
                .demands
                .iter()
                .find(|d| d.function == f)
                .map(|d| d.requested)
        };
        assert!(find(&trade, "market") > find(&ag, "market"));
        assert!(find(&river, "warehouse").is_none());
        let work = artisan
            .programme
            .unwrap()
            .demands
            .into_iter()
            .find(|d| d.function == "workshop")
            .unwrap();
        assert!(work.provenance.join(" ").contains("ore"));
        let port = prepare_case("port", false, "european-organic");
        assert!(
            port.programme
                .unwrap()
                .demands
                .iter()
                .find(|d| d.function == "warehouse")
                .unwrap()
                .reasons[0]
                .contains("No explicit navigable")
        );
    }
    #[test]
    fn known_resource_workshop_retains_a_domain_before_cadastral_cuts() {
        let mut source = layout("european-organic");
        source.blocks.truncate(1);
        source.blocks[0].shape = rectangle(110.0, 110.0, 140.0, 150.0);
        let height = vec![0.0; 32 * 32];
        let water = vec![0; 32 * 32];
        let surface = Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
        };
        let mut diffuse = source.clone();
        let mut context = ProgrammeContext {
            role: "artisan".into(),
            ..Default::default()
        };
        prepare(&mut diffuse, 600, &context, surface).unwrap();
        assert!(
            diffuse
                .programme
                .as_ref()
                .unwrap()
                .reservations
                .iter()
                .all(|r| !r.demand_id.ends_with("/workshop"))
        );
        context.resources = vec!["ore".into()];
        prepare(&mut source, 600, &context, surface).unwrap();
        let programme = source.programme.as_ref().unwrap();
        assert_eq!(programme.reservations.len(), 1);
        assert!(programme.reservations[0].demand_id.ends_with("/workshop"));
        assert_eq!(source.blocks[0].kind, "reserve:programme");
        let parts = super::super::generate_parcels(
            "resource-workshop",
            &[source.clone()],
            &Default::default(),
        )
        .unwrap();
        assert_eq!(parts[0].parcels.len(), 1);
        assert!((area(&parts[0].parcels[0].shape) - 1200.0).abs() < 0.01);
        assert!(
            parts[0]
                .programme
                .as_ref()
                .unwrap()
                .allocations
                .iter()
                .any(|a| a.function == "workshop")
        );
    }

    #[test]
    fn reserves_precede_cuts_and_estimated_land_is_not_built_capacity() {
        let l = prepare_case("crossroads", false, "european-organic");
        assert!(!l.programme.as_ref().unwrap().reservations.is_empty());
        let mut p = partition(&l);
        let geometry = serde_json::to_value(&p.parcels).unwrap();
        allocate(&l, &mut p);
        assert_eq!(geometry, serde_json::to_value(&p.parcels).unwrap());
        let pr = p.programme.as_ref().unwrap();
        assert!(pr.demands.iter().any(|d| d.parcel_capacity > 0.0));
        assert!(
            pr.demands
                .iter()
                .all(|d| d.built_capacity == 0.0 && d.deficit == d.requested)
        );
        assert!(pr.allocations.iter().all(|a| !a.parcel_id.is_empty()));
        let again = reallocate(&[l], &[p.clone()]).unwrap();
        assert_eq!(
            serde_json::to_value(p).unwrap(),
            serde_json::to_value(&again[0]).unwrap()
        );
    }
    #[test]
    fn reservation_contacts_and_interior_holes_use_exact_geometry() {
        let mut l = layout("european-organic");
        let mut shape = rectangle(100.0, 110.0, 200.0, 140.0);
        l.streets[0].path = vec![Point { x: 149.5, y: 105.0 }, Point { x: 150.5, y: 105.0 }];
        let original = block_front(&l, &shape).unwrap().1;
        assert!(
            original < 5.0,
            "A one metre street cannot grant a hundred metre frontage: {original}"
        );
        shape.outer.insert(1, Point { x: 150.0, y: 110.0 });
        assert!((block_front(&l, &shape).unwrap().1 - original).abs() < 0.01);
        let l = prepare_case("agricultural", false, "european-organic");
        let mut p = partition(&l).parcels.remove(0);
        p.shape = rectangle(110.0, 110.0, 114.0, 116.0);
        p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 114.0, y: 110.0 }]);
        p.contacts.clear();
        assert!(
            has_envelope(&p, 4.0, 6.0),
            "Exact frame fits before perforation"
        );
        p.shape
            .holes
            .push(rectangle(111.8, 112.0, 112.2, 112.4).outer);
        assert!(
            !has_envelope(&p, 4.0, 6.0),
            "A wholly interior hole blocks the only geometrically possible frame"
        );
    }

    #[test]
    fn a_reserved_sliver_cannot_satisfy_a_built_institution() {
        let mut l = prepare_case("capital", false, "european-organic");
        l.blocks[0].shape = rectangle(110.0, 110.0, 610.0, 111.0);
        let mut p = partition(&l).parcels.remove(0);
        p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 610.0, y: 110.0 }]);
        let pr = l.programme.as_mut().unwrap();
        let institutional = pr
            .demands
            .iter()
            .find(|d| d.function == "collective")
            .unwrap()
            .clone();
        pr.reservations = vec![Reservation {
            id: "sliver".into(),
            demand_id: institutional.id.clone(),
            block: 0,
            shape: l.blocks[0].shape.clone(),
            street: 0,
            frontage: 500.0,
        }];
        assert!(!eligible(
            &l,
            &p,
            &institutional,
            l.programme.as_ref().unwrap()
        ));
    }

    #[test]
    fn real_neighbours_require_shared_boundary_and_envelopes_respect_holes() {
        let a = rectangle(0.0, 0.0, 20.0, 30.0);
        assert!((shared(&a, &rectangle(20.0, 0.0, 40.0, 30.0)) - 30.0).abs() < 0.001);
        assert_eq!(shared(&a, &rectangle(20.1, 0.0, 40.0, 30.0)), 0.0);
        let mut l = prepare_case("agricultural", false, "european-organic");
        let mut p = partition(&l);
        assert!(has_envelope(&p.parcels[0], 4.0, 6.0));
        p.parcels[0]
            .shape
            .holes
            .push(rectangle(110.1, 110.1, 129.9, 139.9).outer);
        assert!(!has_envelope(&p.parcels[0], 4.0, 6.0));
        l.programme.as_mut().unwrap().context.mode = "strict".into();
        l.culture = "elven".into();
        allocate(&l, &mut p);
        assert!(p.programme.unwrap().allocations.is_empty());
    }

    /// Review #17: with more lots than households, gardens go to the lane
    /// lots and every main-street lot holds a house, even when the lane lots
    /// are nearer the centre; households sum to the demand without a rounding
    /// cliff.
    #[test]
    fn main_street_lots_are_housed_before_any_garden() {
        let blocks = (0..8)
            .map(|i| {
                let x = 20.0 * i as f64;
                json!({"shape":rectangle(x,110.0,x+20.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}})
            })
            .collect::<Vec<_>>();
        let mut l: Layout = serde_json::from_value(json!({"key":"street-wall","culture":"european-organic",
            "center":{"x":150.0,"y":130.0},"quarters":[],"blocks":blocks,
            "streets":[{"path":[{"x":-10.0,"y":105.0},{"x":170.0,"y":105.0}],"widths":[8.0,8.0],"rank":1,"role":"street"}],
            "warnings":[]})).unwrap();
        let (height, water) = (vec![0.0; 32 * 32], vec![0; 32 * 32]);
        prepare(
            &mut l,
            27,
            &ProgrammeContext::default(),
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
            },
        )
        .unwrap();
        let mut p = partition(&l);
        // Lots 4..8 open on a lane (rank 3) and sit nearest the centre.
        for lot in &mut p.parcels[4..] {
            lot.rank = 3;
        }
        allocate(&l, &mut p);
        let pr = p.programme.unwrap();
        let wanted: f64 = pr
            .demands
            .iter()
            .filter(|d| d.unit == "domesticUnits")
            .map(|d| d.requested)
            .sum();
        assert!(
            wanted < 8.0,
            "the case needs surplus land, {wanted} households"
        );
        let role = |i: usize| {
            pr.allocations
                .iter()
                .find(|a| a.parcel_id == format!("lot/{i}"))
                .map_or("", |a| a.role.as_str())
        };
        for i in 0..4 {
            assert!(
                role(i).starts_with("dwelling"),
                "main-street lot {i} is {}",
                role(i)
            );
        }
        assert!(
            (4..8).any(|i| role(i) == "open.garden"),
            "surplus land becomes lane gardens"
        );
        let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
        assert!(
            (housed - wanted.round()).abs() < 0.5,
            "{housed} households for {wanted}"
        );
        // Spread: exact total, busiest plots first, no rounding cliff.
        let caps = [6.0, 6.0, 6.0, 6.0, 1.0];
        let spread = spread_households(&caps, &[0.9, 0.1, 0.1, 0.1, 0.5], &[true; 5], 11.0);
        assert_eq!(spread.iter().sum::<f64>(), 11.0);
        assert!(spread[0] > spread[1] && spread[4] == 1.0, "{spread:?}");
    }
}
