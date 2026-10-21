//! Bounded contextual demand and allocation. Metres, square metres and indicative
//! domestic units are distinct; estimated land capacity never means built housing.
use super::culture::{CultureMapping, mapping};
use super::geometry::{area, centroid, difference};
use super::{Layout, Parcel, Partition, Point, Shape, Surface};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammeContext {
    pub role: String,
    pub resources: Vec<String>,
    pub period: String,
    pub mode: String,
    pub navigable_access: bool,
    pub lore: Vec<String>,
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
pub fn prepare(
    layout: &mut Layout,
    population: u32,
    context: &ProgrammeContext,
    surface: Surface<'_>,
) -> Result<(), String> {
    if ![
        "auto",
        "agricultural",
        "crossroads",
        "artisan",
        "riverine",
        "port",
        "capital",
        "isolated-farm",
        "roadside-temple",
    ]
    .contains(&context.role.as_str())
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
    let mixed_share = if matches!(role, "crossroads" | "port" | "capital") {
        0.25
    } else {
        0.08
    };
    let domestic = n / 4.5; // Explicit prototype household assumption, not a census.
    let mut demands = vec![
        demand(
            &layout.key,
            "domestic",
            domestic * (1.0 - mixed_share),
            true,
            format!(
                "population:{population}; profile:4.5 persons/domesticUnit; culture:{}; period:{}",
                layout.culture, context.period
            ),
        ),
        demand(
            &layout.key,
            "mixed",
            domestic * mixed_share,
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
    if (population >= 300 && cultural_functions != "communal")
        || matches!(role, "crossroads" | "capital" | "port")
    {
        demands.push(demand(
            &layout.key,
            "market",
            (n * if role == "crossroads" { 1.2 } else { 0.4 }).clamp(80.0, 4000.0),
            false,
            format!("role:{role}; population:{population}"),
        ));
    }
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
    if role == "capital"
        || (cultural_functions == "institutional" && population >= 300)
        || context
            .lore
            .iter()
            .any(|s| ["temple", "palace", "necropolis", "magic"].contains(&s.as_str()))
    {
        demands.push(demand(
            &layout.key,
            "collective",
            (n * 0.8).max(250.0),
            false,
            format!(
                "role:{role}; culture profile:{cultural_functions}; explicit lore:{}",
                context.lore.join(",")
            ),
        ));
    }
    let isolated = matches!(context.role.as_str(), "isolated-farm" | "roadside-temple");
    if isolated {
        // A named site is an intention for one native structure, not a town
        // whose household demand is inferred from its visitor/population field.
        let farm = context.role == "isolated-farm";
        let minimum_area = cultures.first().map_or(0.0, |c| c.admissibility.min_area);
        let function = if farm { "domestic" } else { "collective" };
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
        demands = vec![d];
    }
    let road_pressures = super::parcels::occupation_pressures(layout);
    let front_index = super::parcels::FrontageIndex::new(layout);
    let block_contacts = layout
        .blocks
        .iter()
        .map(|b| super::parcels::block_contacts_indexed(&b.shape, layout, &front_index))
        .collect::<Vec<_>>();
    let environment = layout
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
            let waterfront = [20.0, 40.0, 80.0].iter().any(|r| {
                (0..8).any(|i| {
                    let angle = i as f64 * std::f64::consts::TAU / 8.0;
                    let p = Point {
                        x: c.x + r * angle.cos(),
                        y: c.y + r * angle.sin(),
                    };
                    p.x >= 0.0
                        && p.y >= 0.0
                        && p.x < surface.width
                        && p.y < surface.width
                        && surface.wet(p)
                })
            });
            BlockEnvironment {
                pressure: if surface.wet(c) {
                    0.0
                } else {
                    road_pressures.get(block).copied().unwrap_or(0.0) / (1.0 + 3.0 * slope)
                },
                block,
                slope,
                wet: surface.wet(c) || b.shape.outer.iter().any(|p| surface.wet(*p)),
                waterfront,
            }
        })
        .collect::<Vec<_>>();
    let mut reservations = vec![];
    let mut used = BTreeSet::new();
    let mut reservation_order = demands
        .iter()
        .enumerate()
        .filter(|(_, d)| {
            isolated
                || matches!(
                    d.function.as_str(),
                    "market" | "collective" | "warehouse" | "common"
                )
                || (d.function == "workshop"
                    && d.requires.iter().any(|r| r.starts_with("knownResource:")))
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    // Existing markets and constrained built functions retain first choice;
    // open commons then use remaining public land, never private rear gardens.
    reservation_order.sort_by_key(|&i| match demands[i].function.as_str() {
        "market" => 0,
        "warehouse" => 1,
        "collective" => 2,
        "workshop" => 3,
        "common" => 4,
        _ => 5,
    });
    for di in reservation_order {
        let d = &mut demands[di];
        if d.function == "warehouse" && !context.navigable_access {
            d.reasons
                .push("No explicit navigable access; water proximity is insufficient".into());
            continue;
        }
        let mut options = layout
            .blocks
            .iter()
            .enumerate()
            .filter_map(|(bi, b)| {
                if d.function == "warehouse" && !environment[bi].waterfront {
                    return None;
                }
                let existing_open = match d.function.as_str() {
                    "market" => matches!(b.kind.as_str(), "place" | "market" | "reserve:market"),
                    "common" => matches!(b.kind.as_str(), "place" | "common" | "reserve:common"),
                    _ => false,
                };
                if (!existing_open && b.kind != "block")
                    || used.contains(&bi)
                    || environment[bi].wet
                {
                    return None;
                }
                let profile = if isolated {
                    super::culture::isolated_mapping(
                        block_culture(layout, bi),
                        &context.period,
                        &context.role,
                    )?
                } else {
                    super::culture::block_mapping(
                        layout,
                        block_culture(layout, bi),
                        bi,
                        &d.function,
                        &context.period,
                    )?
                }
                .admissibility;
                if environment[bi].slope > profile.max_slope {
                    return None;
                }
                let public_contacts = block_contacts[bi]
                    .iter()
                    .filter(|c| {
                        d.function != "common" || matches!(c.kind.as_str(), "public" | "collective")
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                let contact = public_contacts.iter().max_by(|a, b| {
                    a.length
                        .total_cmp(&b.length)
                        .then_with(|| b.street.cmp(&a.street))
                })?;
                let (street, front) = (
                    contact.street,
                    super::parcels::continuous_frontage(&public_contacts),
                );
                let a = area(&b.shape);
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
                if (isolated
                    || matches!(d.function.as_str(), "warehouse" | "collective" | "workshop"))
                    && super::parcels::contact_envelope(
                        &b.shape,
                        &block_contacts[bi],
                        profile.min_frontage,
                        profile.min_depth,
                        profile.min_access_width,
                    )
                    .is_none()
                {
                    return None;
                }
                // One facility follows the tissue's existing block module;
                // total metropolitan demand is served by several real sites.
                let module = super::culture::block_morph(layout, block_culture(layout, bi), bi)
                    .map(|(zone, m)| {
                        let r = m.range("blockSize", zone);
                        (r[0] + r[1]) * 0.5
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
                let score = if existing_open { -1_000_000.0 } else { 0.0 }
                    + (a / target).ln().abs()
                    + dist(centroid(&b.shape), layout.center) / 1000.0
                    + (d.target_frontage - front).max(0.0) / d.target_frontage.max(1.0);
                Some((bi, street, front, score))
            })
            .collect::<Vec<_>>();
        options.sort_by(|a, b| a.3.total_cmp(&b.3).then(a.0.cmp(&b.0)));
        let mut reserved_capacity = 0.0;
        let mut sites = 0;
        for &(bi, street, front, _) in &options {
            if sites > 0 && (isolated || reserved_capacity + 0.01 >= d.requested) {
                break;
            }
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
            reserved_capacity += capacity(area(&layout.blocks[bi].shape), d);
            sites += 1;
        }
        if sites == 0 {
            d.reasons.push(
                "No suitably sized accessible block for reservation before subdivision".into(),
            );
        } else if !isolated && reserved_capacity + 0.01 < d.requested {
            d.reasons.push("Accessible reserved sites do not cover the indicative land capacity; built capacity remains unverified".into());
        }
    }
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
    });
    Ok(())
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
fn public_open_access(p: &Parcel, minimum: f64) -> bool {
    if p.access
        .as_ref()
        .is_some_and(|a| matches!(a.kind.as_str(), "attached" | "unserved" | "private"))
    {
        return false;
    }
    let contacts = p
        .contacts
        .iter()
        .filter(|c| matches!(c.kind.as_str(), "public" | "collective"))
        .cloned()
        .collect::<Vec<_>>();
    super::parcels::continuous_frontage(&contacts) >= minimum
        || (p.contacts.is_empty()
            && p.access.as_ref().is_some_and(|a| {
                matches!(a.kind.as_str(), "public" | "collective") && a.front_length >= minimum
            }))
}
fn eligible(layout: &Layout, p: &Parcel, d: &Demand, pr: &UrbanProgramme) -> bool {
    let Some(c) = super::culture::parcel_mapping(layout, p, parcel_culture(layout, p), &d.function)
    else {
        return false;
    };
    if pr.context.mode == "strict" && !c.borrowing.is_empty() {
        return false;
    }
    if pr
        .environment
        .get(p.block)
        .is_some_and(|e| e.wet || e.slope > c.admissibility.max_slope)
    {
        return false;
    }
    if d.function == "warehouse"
        && (!pr.context.navigable_access
            || !pr.environment.get(p.block).is_some_and(|e| e.waterfront))
    {
        return false;
    }
    if let Some(res) = pr.reservations.iter().find(|r| r.block == p.block) {
        if res.demand_id != d.id {
            return false;
        }
        if matches!(d.function.as_str(), "market" | "common") {
            return public_open_access(p, c.admissibility.min_access_width);
        }
        return has_envelope(p, c.admissibility.min_frontage, c.admissibility.min_depth)
            || block_witness(
                layout,
                &p.shape,
                c.admissibility.min_frontage,
                c.admissibility.min_depth,
            );
    }
    if matches!(
        pr.context.role.as_str(),
        "isolated-farm" | "roadside-temple"
    ) {
        return false;
    }
    if matches!(d.function.as_str(), "market" | "common") {
        let accessible = public_open_access(p, c.admissibility.min_access_width);
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
        c.admissibility.min_access_width
    } else {
        c.admissibility.min_frontage.max(d.target_frontage)
    };
    let frontage = if p.contacts.is_empty() {
        access.front_length
    } else {
        super::parcels::continuous_frontage(&p.contacts)
    };
    if matches!(access.kind.as_str(), "unserved" | "attached") || frontage < minimum {
        return false;
    }
    area(&p.shape) >= c.admissibility.min_area
        && has_envelope(p, c.admissibility.min_frontage, c.admissibility.min_depth)
}
fn capacity(a: f64, d: &Demand) -> f64 {
    if d.unit == "domesticUnits" {
        // The current recipe-volumes path produces one domestic unit per parcel,
        // including compound envelopes. Floor area must not imply extra households.
        1.0
    } else if matches!(d.function.as_str(), "market" | "common") {
        a
    } else {
        a * 0.55
    }
}
/// Reassign only uses. Streets, reservations and parcel shapes are immutable.
/// Two scarcity-ordered passes are the complete reconciliation budget.
pub fn allocate(layout: &Layout, partition: &mut Partition) {
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
    for d in &mut pr.demands {
        d.parcel_capacity = 0.0;
        d.built_capacity = 0.0;
        d.open_capacity = 0.0;
        d.deficit = d.requested;
    }
    let (edges, neighbours) = graph(partition);
    pr.adjacency = edges;
    let mut assignments: Vec<Option<usize>> = vec![None; partition.parcels.len()];
    let reserved_for = pr
        .reservations
        .iter()
        .map(|r| (r.block, r.demand_id.as_str()))
        .collect::<BTreeMap<_, _>>();
    let land_areas = partition
        .parcels
        .iter()
        .map(|p| area(&p.shape))
        .collect::<Vec<_>>();
    let center_distances = partition
        .parcels
        .iter()
        .map(|p| dist(centroid(&p.shape), layout.center))
        .collect::<Vec<_>>();
    // Most constrained demand first, with ID tie breaks and no RNG/order drift.
    let admission = pr
        .demands
        .iter()
        .map(|d| {
            partition
                .parcels
                .iter()
                .map(|p| eligible(layout, p, d, &pr))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let mut order = (0..pr.demands.len()).collect::<Vec<_>>();
    order.sort_by_key(|&di| {
        let d = &pr.demands[di];
        let count = admission[di].iter().filter(|&&ok| ok).count();
        (
            count,
            if d.function == "domestic" { 1 } else { 0 },
            d.id.clone(),
        )
    });
    for pass in 0..2 {
        for &di in &order {
            // Domestic parcels all contribute exactly one unit. Their overflow
            // penalty is identical, so maintain the exact same score in a heap
            // and update only true edge neighbours after each assignment.
            if pass == 0 && pr.demands[di].unit == "domesticUnits" {
                let commercial = pr.demands[di].function == "mixed";
                let base = partition
                    .parcels
                    .iter()
                    .enumerate()
                    .map(|(pi, p)| {
                        let front = p.access.as_ref().map_or(0.0, |a| a.front_length);
                        p.pressure * if commercial { 3.0 } else { 0.5 }
                            + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                            - center_distances[pi] / if commercial { 250.0 } else { 1500.0 }
                    })
                    .collect::<Vec<_>>();
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
                for (pi, p) in partition.parcels.iter().enumerate() {
                    if admission[di][pi] && assignments[pi].is_none() {
                        heap.push((score_key(base[pi]), Reverse(p.id.as_str()), pi, 0usize));
                    }
                }
                while pr.demands[di].parcel_capacity + 0.01 < pr.demands[di].requested {
                    let Some((_, _, pi, version)) = heap.pop() else {
                        break;
                    };
                    if assignments[pi].is_some() || cohesion[pi] != version {
                        continue;
                    }
                    assignments[pi] = Some(di);
                    pr.demands[di].parcel_capacity += 1.0;
                    for &j in &neighbours[pi] {
                        if admission[di][j] && assignments[j].is_none() {
                            cohesion[j] += 1;
                            heap.push((
                                score_key(base[j] + 2.0 * cohesion[j] as f64),
                                Reverse(partition.parcels[j].id.as_str()),
                                j,
                                cohesion[j],
                            ));
                        }
                    }
                }
                continue;
            }
            while pr.demands[di].parcel_capacity + 0.01 < pr.demands[di].requested {
                let d = &pr.demands[di];
                let options = partition
                    .parcels
                    .iter()
                    .enumerate()
                    .filter_map(|(pi, p)| {
                        if !admission[di][pi] {
                            return None;
                        }
                        let prior = assignments[pi];
                        // The bounded second pass can relocate a flexible, oversupplied
                        // domestic/mixed allocation. Never displace a constraint/reserve.
                        if let Some(old) = prior
                            && (pass == 0
                                || old == di
                                || !matches!(
                                    pr.demands[old].function.as_str(),
                                    "domestic" | "mixed"
                                )
                                || pr.demands[old].parcel_capacity
                                    - capacity(land_areas[pi], &pr.demands[old])
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
                        let commercial =
                            matches!(d.function.as_str(), "mixed" | "market" | "warehouse");
                        let score = coh * 2.0
                            + p.pressure * if commercial { 3.0 } else { 0.5 }
                            + front.min(30.0) * if commercial { 0.15 } else { 0.02 }
                            - center / if commercial { 250.0 } else { 1500.0 }
                            - (cap - (d.requested - d.parcel_capacity)).max(0.0)
                                / d.requested.max(1.0);
                        // Retained reservations satisfy their own demand first.
                        // Their access is carried by exact contacts, while the
                        // cadastral access field intentionally remains reserved.
                        let reserved = reserved_for
                            .get(&p.block)
                            .is_some_and(|id| *id == d.id.as_str());
                        Some((pi, score, reserved))
                    })
                    .collect::<Vec<_>>();
                let chosen = options.into_iter().max_by(|a, b| {
                    a.2.cmp(&b.2)
                        .then_with(|| a.1.total_cmp(&b.1))
                        .then_with(|| partition.parcels[b.0].id.cmp(&partition.parcels[a.0].id))
                });
                let Some((pi, _, _)) = chosen else {
                    break;
                };
                if let Some(old) = assignments[pi] {
                    pr.demands[old].parcel_capacity -= capacity(land_areas[pi], &pr.demands[old]);
                }
                assignments[pi] = Some(di);
                pr.demands[di].parcel_capacity += capacity(land_areas[pi], &pr.demands[di]);
            }
        }
        pr.reconciliation_passes = pass + 1;
    }
    for (pi, &assignment) in assignments.iter().enumerate() {
        if let Some(di) = assignment {
            let p = &partition.parcels[pi];
            let d = &pr.demands[di];
            let c =
                super::culture::parcel_mapping(layout, p, parcel_culture(layout, p), &d.function)
                    .expect("admitted contextual culture");
            let same = neighbours[pi]
                .iter()
                .filter(|&&j| assignments[j] == Some(di))
                .count();
            pr.allocations.push(Allocation {
                parcel_id: p.id.clone(),
                demand_id: d.id.clone(),
                function: d.function.clone(),
                culture: c.culture,
                architecture_pack: c.architecture_pack,
                capacity: capacity(land_areas[pi], d),
                unit: d.unit.clone(),
                score: same as f64,
                reasons: vec![
                    "Admissible access and envelope".into(),
                    format!("Native tissue recipe:{}", c.admissibility.recipe_id),
                    format!("{} true edge neighbours", neighbours[pi].len()),
                ],
            });
        }
    }
    for d in &mut pr.demands {
        // Deficit here is the actual unbuilt demand. A separate land deficit is
        // displayed via requested - parcelCapacity until placements reconcile it.
        d.deficit = (d.requested - d.built_capacity).max(0.0);
        if d.parcel_capacity + 0.01 < d.requested {
            d.reasons
                .push("Insufficient admissible parcel capacity after two allocation passes".into());
        }
    }
    if pr.context.mode == "strict" && pr.cultures.iter().any(|c| !c.borrowing.is_empty()) {
        pr.warnings
            .push("Strict mode refuses declared cultural borrowing".into());
    }
    partition.programme = Some(pr);
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
        let collective = pr
            .demands
            .iter()
            .find(|d| d.function == "collective")
            .unwrap();
        assert!(
            pr.reservations
                .iter()
                .filter(|r| r.demand_id == collective.id)
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
}
