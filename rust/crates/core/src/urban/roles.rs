//! District roles and the data-driven service catalogue (`services.json`).
//! Roles are scored from facts the pipeline already computed (distance to the
//! nucleus, gates, waterfront, height, growth phase, mixed culture), never drawn
//! at random, so the same town always reads the same way. Building roles are
//! counted per culture family from population thresholds; `function` stays one
//! of the six houses functions and the rich id travels as `role`.
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
    states: BTreeMap<String, StateRule>,
    #[serde(default)]
    isolated: BTreeMap<String, IsolatedRule>,
    #[serde(default)]
    rural: Vec<ServiceEntry>,
    #[serde(default)]
    labels: BTreeMap<String, String>,
    #[serde(default)]
    family_labels: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    district_labels: BTreeMap<String, String>,
    #[serde(default)]
    family_district_labels: BTreeMap<String, BTreeMap<String, String>>,
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
        .get(culture)
        .map_or("fantasy", String::as_str)
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
/// Houses function of a catalogue role (any family), for user overrides.
pub fn role_function(role: &str) -> Option<&'static str> {
    let cat = catalogue();
    cat.families
        .values()
        .flatten()
        .chain(&cat.rural)
        .find(|e| e.role == role)
        .map(|e| e.function.as_str())
        .or_else(|| {
            cat.isolated
                .values()
                .find(|i| i.role == role)
                .map(|i| i.function.as_str())
        })
}
pub fn is_landmark(role: &str) -> bool {
    let cat = catalogue();
    cat.families
        .values()
        .flatten()
        .any(|e| e.role == role && e.landmark)
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
/// French label of a district role (`Quartier des tanneurs`).
pub fn district_label(role: &str, culture: &str) -> String {
    let cat = catalogue();
    let fam = cat.family_district_labels.get(family(culture));
    lookup(role, fam, &cat.district_labels).unwrap_or_else(|| "Quartier".into())
}
pub fn occupancy(culture: &str) -> Occupancy {
    catalogue()
        .occupancy
        .get(family(culture))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or(Occupancy {
            household_size: 4.5,
            floor_per_household: 60.0,
            max_per_plot: 4.0,
        })
}

/// One building role to place: `sites` distinct buildings of `area` useful m² each.
#[derive(Clone, Debug)]
pub struct ServiceNeed {
    pub entry: ServiceEntry,
    pub sites: usize,
    pub area: f64,
}
/// Large, open or landmark programmes keep a whole block before cadastral cuts;
/// small trades take an ordinary plot after them.
pub fn reserves_block(e: &ServiceEntry) -> bool {
    e.landmark || e.area[1] >= 1500.0 || matches!(e.function.as_str(), "market" | "common")
}

/// Services for a settlement, with the cultural nucleus promoted to the central
/// landmark (`catalogue.json` cultures[c].nucleus.kind / area).
pub fn services(culture: &str, population: u32, context_role: &str) -> Vec<ServiceNeed> {
    let pop = f64::from(population);
    let cat = catalogue();
    let mut entries = cat
        .families
        .get(family(culture))
        .cloned()
        .unwrap_or_default();
    entries.extend(cat.rural.iter().cloned());
    entries.retain(|e| e.max_pop <= 0.0 || pop <= e.max_pop);
    let nucleus = &super::catalogue()["cultures"][culture]["nucleus"];
    if let Some(role) = nucleus["kind"].as_str().and_then(|k| cat.nucleus.get(k)) {
        let area = nucleus["area"]
            .as_array()
            .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
            .filter(|a| a[1] > 0.0);
        if let Some(e) = entries.iter_mut().find(|e| &e.role == role) {
            e.landmark = true;
            e.site = "nucleus".into();
            e.min_pop = e.min_pop.min(200.0);
            if let Some(a) = area
                && e.per_capita == 0.0
            {
                e.area = a;
            }
        } else if let Some(a) = area {
            let open = matches!(
                role.as_str(),
                "commerce.market" | "commerce.maidan" | "civic.forum"
            );
            entries.insert(
                0,
                ServiceEntry {
                    role: role.clone(),
                    function: if open { "market" } else { "collective" }.into(),
                    per: 0.0,
                    min_pop: 200.0,
                    max: 1,
                    site: "nucleus".into(),
                    area: a,
                    per_capita: 0.0,
                    landmark: true,
                    district: if open { "market" } else { "religious" }.into(),
                    requires: String::new(),
                    max_pop: 0.0,
                },
            );
        }
    }
    entries
        .into_iter()
        .filter_map(|mut e| {
            let mut mult = 1.0;
            match context_role {
                "crossroads" if e.role.starts_with("commerce.") && e.function == "collective" => {
                    mult = 2.0
                }
                "crossroads" if e.function == "market" => e.per_capita *= 3.0,
                "capital"
                    if ["elite.", "civic.", "defence."]
                        .iter()
                        .any(|p| e.role.starts_with(p)) =>
                {
                    e.min_pop *= 0.25
                }
                "riverine" if e.role == "craft.mill" => mult = 2.0,
                "artisan" if e.role.starts_with("craft.") => mult = 2.0,
                "agricultural" if e.role.starts_with("storage.") => mult = 2.0,
                _ => {}
            }
            if pop < e.min_pop {
                return None;
            }
            let base = if e.per > 0.0 {
                (pop / e.per).floor().max(1.0)
            } else {
                1.0
            };
            let sites = ((base * mult) as usize).clamp(1, e.max.max(1) * mult as usize);
            let area = if e.per_capita > 0.0 {
                (pop * e.per_capita / sites as f64).clamp(e.area[0], e.area[1])
            } else {
                let t = ((pop / e.min_pop.max(1.0)).log10() / 2.0).clamp(0.0, 1.0);
                e.area[0] + (e.area[1] - e.area[0]) * t
            };
            Some(ServiceNeed {
                entry: e,
                sites,
                area,
            })
        })
        .collect()
}

/// Normalised siting facts of one block (or of a plot, through its block).
#[derive(Clone, Copy, Debug, Default)]
pub struct SiteFacts {
    /// Distance to the nucleus over the city radius, 0 at the centre.
    pub core: f64,
    /// Distance to the nearest gate over the city radius.
    pub gate: f64,
    pub water: bool,
    /// Height between the lowest (0) and highest (1) block of the city.
    pub high: f64,
    /// Road pressure, 0..1 over the city.
    pub pressure: f64,
    /// The block fronts a river (running water: mills, tanneries, dyers).
    pub river: bool,
    /// The block fronts a sea or lake shore (harbour, quays).
    pub shore: bool,
    /// Position along the city's river reach from its lowest (0, downstream)
    /// to its highest (1, upstream) bank; 0.5 off the river or on a flat reach.
    pub downstream: f64,
    /// The block fronts a quay street over at least `QUAY_FRONT`.
    pub quay: bool,
    /// The town has quay streets: `quay` services then need `quay`.
    pub harbour: bool,
}
/// Lower is better. The district bonus is added by the caller. Water trades
/// read the kind of water the block touches and the river's flow (its bed
/// height), so tanneries and dyers sit on the lowest reach, below the town.
pub fn site_cost(site: &str, f: &SiteFacts) -> f64 {
    let dry = if f.water { 0.0 } else { 1.0 };
    match site {
        "nucleus" => f.core * 4.0 - f.pressure * 0.5,
        "gate" => f.gate * 5.0 + (1.0 - f.core) * 0.3,
        "waterfront" => dry * 4.0 + f.core * 0.5,
        "river" if f.river => (1.0 - f.core.min(1.0)) * 0.4,
        "river" => dry * 4.0 + 1.5 + f.core * 0.5,
        "quay" if f.harbour => {
            if f.quay {
                f.core * 0.6
            } else {
                QUAY_MISS + f.core
            }
        }
        "quay" if f.shore => f.core * 0.6,
        "quay" if f.river => 0.8 + f.core * 0.6,
        "quay" => 5.0 + f.core,
        "downstream" if f.river => f.downstream * 2.5 + (1.0 - f.core.min(1.0)) * 0.8,
        "downstream" if f.water => 1.5 + (1.0 - f.core.min(1.0)) * 0.8,
        "downstream" => 3.0 + f.high * 2.0 + (1.0 - f.core) * 1.5,
        "hill" => (1.0 - f.high) * 3.0 + f.core * 0.8,
        "edge" => (1.0 - f.core) * 3.0,
        _ => f.core * 0.4 - f.pressure * 0.3,
    }
}

/// City frame shared by district scoring and service siting.
pub struct Frame {
    pub center: Point,
    pub radius: f64,
    pub low: f64,
    pub high: f64,
    pub max_pressure: f64,
    pub gates: Vec<Point>,
    /// Lowest and highest river bed height along the city's banks.
    pub river: (f64, f64),
    /// Secondary centres of a metropolis (its wards): local cores that read
    /// as at least a quarter of the radius out, so the main nucleus keeps the
    /// cathedral and the town hall while each ward gets its market and parish.
    pub wards: Vec<Point>,
    /// Quay frontage per block (m), from `quay_contacts`.
    pub quay: Vec<f64>,
    pub harbour: bool,
}
impl Frame {
    pub fn new(layout: &Layout, env: &[BlockEnvironment]) -> Self {
        let center = layout.center;
        let radius = layout
            .blocks
            .iter()
            .map(|b| dist(g::centroid(&b.shape), center))
            .fold(50.0, f64::max);
        let (low, high) = env
            .iter()
            .filter(|e| !e.wet)
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), e| {
                (lo.min(e.height), hi.max(e.height))
            });
        let max_pressure = env.iter().map(|e| e.pressure).fold(1e-9, f64::max);
        let river = env
            .iter()
            .filter(|e| e.water == "river")
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), e| {
                (lo.min(e.water_height), hi.max(e.water_height))
            });
        let quay = quay_contacts(layout);
        let harbour = quay
            .iter()
            .enumerate()
            .any(|(i, &c)| c >= QUAY_FRONT && !env.get(i).is_some_and(|e| e.wet));
        Self {
            quay,
            harbour,
            river,
            center,
            radius,
            low: if low.is_finite() { low } else { 0.0 },
            high: if high.is_finite() { high } else { 0.0 },
            max_pressure,
            gates: gates(layout, center, radius),
            wards: if layout.archetype == "metropolis" {
                layout.structure.as_ref().map_or_else(Vec::new, |s| {
                    s.centers
                        .iter()
                        .map(|c| c.point)
                        .filter(|&p| dist(p, center) > radius * 0.2)
                        .collect()
                })
            } else {
                vec![]
            },
        }
    }
    /// Distance to the nearest core over the city radius (0 at the nucleus).
    pub fn core(&self, p: Point) -> f64 {
        self.wards
            .iter()
            .map(|&w| dist(p, w) / self.radius + 0.25)
            .fold(dist(p, self.center) / self.radius, f64::min)
            .min(1.5)
    }
    pub fn gate_distance(&self, p: Point) -> f64 {
        self.gates
            .iter()
            .map(|&q| dist(p, q))
            .fold(f64::INFINITY, f64::min)
    }
    pub fn facts(&self, p: Point, e: Option<&BlockEnvironment>) -> SiteFacts {
        let gate = self.gate_distance(p);
        SiteFacts {
            core: self.core(p),
            gate: if gate.is_finite() {
                (gate / self.radius).min(1.5)
            } else {
                1.5
            },
            water: e.is_some_and(|e| e.waterfront),
            high: e.map_or(0.5, |e| {
                if self.high - self.low > 0.5 {
                    ((e.height - self.low) / (self.high - self.low)).clamp(0.0, 1.0)
                } else {
                    0.5
                }
            }),
            pressure: e.map_or(0.0, |e| (e.pressure / self.max_pressure).clamp(0.0, 1.0)),
            river: e.is_some_and(|e| e.water == "river"),
            shore: e.is_some_and(|e| matches!(e.water.as_str(), "sea" | "lake")),
            downstream: e.filter(|e| e.water == "river").map_or(0.5, |e| {
                let (lo, hi) = self.river;
                if hi - lo > 0.5 {
                    ((e.water_height - lo) / (hi - lo)).clamp(0.0, 1.0)
                } else {
                    0.5
                }
            }),
            quay: e.is_some_and(|e| {
                !e.wet && self.quay.get(e.block).copied().unwrap_or(0.0) >= QUAY_FRONT
            }),
            harbour: self.harbour,
        }
    }
}
fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

/// Quay frontage a block needs to count as served by a quay: one warehouse
/// door or market stall row, not a corner graze.
pub const QUAY_FRONT: f64 = 4.0;
/// Cost of a `quay` service off the quays of a harbour town. Finite so the
/// programme's sums stay numbers; `site_admissible` is the actual rule.
pub const QUAY_MISS: f64 = 1000.0;

/// Length of each block's outline that lies along a quay street (its carved
/// edge sits half a quay width from the quay axis). Sampled at three points
/// per edge; quays are few, so a bounding-box test keeps this linear in the
/// blocks' vertices.
pub fn quay_contacts(layout: &Layout) -> Vec<f64> {
    const SLACK: f64 = 1.5;
    let quays: Vec<(&super::Street, (f64, f64, f64, f64), f64)> = layout
        .streets
        .iter()
        .filter(|s| s.role == "quay" && s.path.len() >= 2)
        .map(|s| {
            let reach = s.widths.iter().copied().fold(0.0, f64::max) * 0.5 + SLACK;
            let b = s.path.iter().fold(
                (
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                ),
                |(x0, x1, y0, y1), p| (x0.min(p.x), x1.max(p.x), y0.min(p.y), y1.max(p.y)),
            );
            (
                s,
                (b.0 - reach, b.1 + reach, b.2 - reach, b.3 + reach),
                reach,
            )
        })
        .collect();
    if quays.is_empty() {
        return vec![0.0; layout.blocks.len()];
    }
    let near = |p: Point| {
        quays.iter().any(|(s, b, reach)| {
            p.x >= b.0
                && p.x <= b.1
                && p.y >= b.2
                && p.y <= b.3
                && s.path
                    .windows(2)
                    .any(|w| g::distance(p, w[0], w[1]).0 <= *reach)
        })
    };
    layout
        .blocks
        .iter()
        .map(|block| {
            let (x0, y0, x1, y1) = g::bbox(&block.shape);
            if !quays
                .iter()
                .any(|(_, b, _)| x1 >= b.0 && x0 <= b.1 && y1 >= b.2 && y0 <= b.3)
            {
                return 0.0;
            }
            let ring = &block.shape.outer;
            (0..ring.len())
                .map(|i| {
                    let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
                    let hits = [0.2, 0.5, 0.8]
                        .iter()
                        .filter(|&&t| {
                            near(Point {
                                x: a.x + (b.x - a.x) * t,
                                y: a.y + (b.y - a.y) * t,
                            })
                        })
                        .count();
                    dist(a, b) * hits as f64 / 3.0
                })
                .sum()
        })
        .collect()
}

/// A `quay` service in a town with quays may only stand on a block that a
/// quay serves; elsewhere (no quay planned) it keeps the natural shore.
pub fn site_admissible(site: &str, f: &SiteFacts) -> bool {
    site != "quay" || !f.harbour || f.quay
}
/// Enclosure gates; an open town uses the points where its regional roads leave
/// the built area (vertex of each regional road closest to 0.9 R).
pub fn gates(layout: &Layout, center: Point, radius: f64) -> Vec<Point> {
    let mut out: Vec<Point> = layout
        .enclosures
        .iter()
        .flat_map(|e| e.gates.iter().copied())
        .collect();
    if out.is_empty() {
        for s in layout
            .streets
            .iter()
            .filter(|s| s.role == "regional" || s.rank == 0)
        {
            if let Some(p) = s
                .path
                .iter()
                .filter(|p| dist(**p, center) > 0.4 * radius)
                .min_by(|a, b| {
                    (dist(**a, center) - 0.9 * radius)
                        .abs()
                        .total_cmp(&(dist(**b, center) - 0.9 * radius).abs())
                })
            {
                out.push(*p);
            }
        }
    }
    out
}

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
    let frame = Frame::new(layout, env);
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
                        warnings.push(format!(
                            "Quartier « {k} » introuvable : surcharge de rôle ignorée"
                        ));
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
    if population >= 800 && navigable {
        let count = 1 + population as usize / 60_000;
        carve_port(
            layout,
            &frame,
            &quay_front,
            count,
            &mut groups,
            &mut fixed,
            &mut fixed_roles,
            &mut warnings,
        );
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
        feats.iter().map(|f| f.1).collect()
    };
    let roles = district_roles(
        layout,
        population,
        navigable,
        &feats,
        &landing,
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
        d.label = district_label(&d.role, culture);
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
        s.districts = groups;
    }
    layout.warnings.extend(warnings);
    block_district
}

/// Quay frontage per quarter (m): dry blocks served by a quay.
fn served_quay_frontage(layout: &Layout, frame: &Frame, env: &[BlockEnvironment]) -> Vec<f64> {
    let mut out = vec![0.0; layout.quarters.len()];
    for (bi, b) in layout.blocks.iter().enumerate() {
        let c = frame.quay.get(bi).copied().unwrap_or(0.0);
        if c >= QUAY_FRONT && !env.get(bi).is_some_and(|e| e.wet) && b.quarter < out.len() {
            out[b.quarter] += c;
        }
    }
    out
}

/// Gather the quarters a quay serves into the port district(s), before roles
/// are scored: one district per connected cluster of quay quarters, the
/// longest frontage first. The nucleus quarter and user-pinned quarters stay
/// where they are; frontage left outside the port is reported.
#[allow(clippy::too_many_arguments)]
fn carve_port<'a>(
    layout: &Layout,
    frame: &Frame,
    front: &[f64],
    count: usize,
    groups: &mut Vec<UrbanDistrict>,
    fixed: &mut Vec<Option<&'a QuarterOverride>>,
    fixed_roles: &mut Vec<Option<String>>,
    warnings: &mut Vec<String>,
) {
    let total: f64 = front.iter().sum();
    if total < QUAY_FRONT || fixed_roles.iter().any(|r| r.as_deref() == Some("port")) {
        return;
    }
    let nucleus = layout
        .quarters
        .iter()
        .position(|q| g::contains(&q.shape, frame.center))
        .or_else(|| {
            (0..layout.quarters.len()).min_by(|&a, &b| {
                dist(g::interior_point(&layout.quarters[a].shape), frame.center).total_cmp(&dist(
                    g::interior_point(&layout.quarters[b].shape),
                    frame.center,
                ))
            })
        });
    let pinned = |q: usize| {
        groups
            .iter()
            .position(|d| d.quarters.contains(&q))
            .is_none_or(|gi| fixed[gi].is_some())
    };
    let quay_quarters: Vec<usize> = (0..front.len())
        .filter(|&q| front[q] >= QUAY_FRONT && Some(q) != nucleus && !pinned(q))
        .collect();
    // Clusters of quay quarters that touch (within a street and a quay).
    const TOUCH: f64 = 30.0;
    let rings: Vec<Vec<Point>> = quay_quarters
        .iter()
        .map(|&q| {
            let r = &layout.quarters[q].shape.outer;
            let stride = r.len().div_ceil(240).max(1);
            r.iter().step_by(stride).copied().collect()
        })
        .collect();
    let boxes: Vec<(f64, f64, f64, f64)> = quay_quarters
        .iter()
        .map(|&q| g::bbox(&layout.quarters[q].shape))
        .collect();
    let touch = |a: usize, b: usize| {
        let (p, q) = (boxes[a], boxes[b]);
        if p.2 + TOUCH < q.0 || q.2 + TOUCH < p.0 || p.3 + TOUCH < q.1 || q.3 + TOUCH < p.1 {
            return false;
        }
        let near = |pts: &[Point], other: &[Point]| {
            pts.iter().any(|&v| {
                (0..other.len())
                    .any(|i| g::distance(v, other[i], other[(i + 1) % other.len()]).0 < TOUCH)
            })
        };
        near(&rings[a], &rings[b]) || near(&rings[b], &rings[a])
    };
    fn root(c: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while c[r] != r {
            r = c[r];
        }
        c[i] = r;
        r
    }
    let mut cluster: Vec<usize> = (0..quay_quarters.len()).collect();
    for a in 0..quay_quarters.len() {
        for b in a + 1..quay_quarters.len() {
            if touch(a, b) {
                let (ra, rb) = (root(&mut cluster, a), root(&mut cluster, b));
                cluster[ra.max(rb)] = ra.min(rb);
            }
        }
    }
    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, &q) in quay_quarters.iter().enumerate() {
        let r = root(&mut cluster, i);
        by_root.entry(r).or_default().push(q);
    }
    let mut clusters: Vec<(f64, Vec<usize>)> = by_root
        .into_values()
        .map(|qs| (qs.iter().map(|&q| front[q]).sum(), qs))
        .collect();
    clusters.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    clusters.truncate(count);
    let mut served = 0.0;
    for (length, mut qs) in clusters {
        qs.sort_unstable();
        // The new district keeps the tissue and phase of its largest quarter.
        let Some(template) = qs
            .iter()
            .max_by(|&&a, &&b| {
                g::area(&layout.quarters[a].shape)
                    .total_cmp(&g::area(&layout.quarters[b].shape))
                    .then(b.cmp(&a))
            })
            .and_then(|&q| groups.iter().find(|d| d.quarters.contains(&q)))
            .cloned()
        else {
            continue;
        };
        for d in groups.iter_mut() {
            d.quarters.retain(|q| !qs.contains(q));
        }
        groups.push(UrbanDistrict {
            quarters: qs,
            ..template
        });
        fixed.push(None);
        fixed_roles.push(Some("port".into()));
        served += length;
    }
    let keep: Vec<bool> = groups.iter().map(|d| !d.quarters.is_empty()).collect();
    let mut it = keep.iter();
    groups.retain(|_| *it.next().unwrap());
    let mut it = keep.iter();
    fixed.retain(|_| *it.next().unwrap());
    let mut it = keep.iter();
    fixed_roles.retain(|_| *it.next().unwrap());
    if served + 0.5 < total {
        warnings.push(format!(
            "Quais hors du district portuaire : {:.0} m de façade sur {:.0} m (quartier central ou autre rive).",
            total - served,
            total
        ));
    }
}

/// Greedy role choice: the core district takes the nucleus role, then each
/// specialised role takes its best-scoring free district while keeping at least
/// half of a town residential; residual peripheral new districts become poor.
/// User-fixed roles are taken as given and count towards each role's quota.
fn district_roles(
    layout: &Layout,
    population: u32,
    navigable: bool,
    feats: &[(SiteFacts, f64, f64, bool)],
    landing: &[f64],
    fixed: &[Option<String>],
) -> Vec<String> {
    let n = feats.len();
    let pop = f64::from(population);
    let mut roles: Vec<String> = (0..n)
        .map(|i| fixed.get(i).cloned().flatten().unwrap_or_default())
        .collect();
    if n == 0 {
        return roles;
    }
    let core = (0..n)
        .min_by(|&a, &b| feats[a].0.core.total_cmp(&feats[b].0.core).then(a.cmp(&b)))
        .unwrap_or(0);
    let kind = super::catalogue()["cultures"][layout.culture.as_str()]["nucleus"]["kind"]
        .as_str()
        .unwrap_or("none");
    let auto_core = if pop < 300.0 {
        "commoner"
    } else {
        match kind {
            "market" | "maidan" => "market",
            "mosque" | "mud-mosque" | "temple" | "precinct" | "grove" | "mortuary" | "ushnu" => {
                "religious"
            }
            "castle" => "garrison",
            "none" => {
                if pop >= 1500.0 {
                    "market"
                } else {
                    "commoner"
                }
            }
            _ => "civic",
        }
    };
    if roles[core].is_empty() {
        roles[core] = auto_core.into();
    }
    if n == 1 {
        return roles;
    }
    for i in 0..n {
        if i != core && feats[i].3 && roles[i].is_empty() {
            roles[i] = "foreign".into();
        }
    }
    let budget = n - n.div_ceil(2);
    let used = |roles: &[String]| roles.iter().filter(|r| !r.is_empty()).count();
    let extra = |per: f64| 1 + (pop / per) as usize;
    // (role, minimum population, count, cost: lower is better, admissible)
    type Cost = fn(&SiteFacts, f64, f64) -> Option<f64>;
    let specs: [(&str, f64, usize, Cost); 9] = [
        // The district with most landing (quay frontage, else shore) is the
        // harbour, however little of the town touches navigable water: a quay
        // needs one frontage, not a third. `water` is `landing` for this role.
        ("port", 800.0, extra(60_000.0), |f, water, _| {
            (water > 0.0).then(|| -water * 3.0 + f.core * 0.3)
        }),
        ("elite", 2500.0, extra(60_000.0), |f, water, _| {
            Some(-f.high * 1.5 + f.core * 1.2 + water * 0.5 - f.pressure * 0.2)
        }),
        // Below the town on its river: the lowest reach, out of the core.
        ("craft:tanners", 2000.0, extra(50_000.0), |f, water, _| {
            (water > 0.05 && f.core > 0.3)
                .then(|| f.downstream * 1.5 + f.high * 0.5 + (1.0 - f.core) - water)
        }),
        ("market", 4000.0, extra(40_000.0), |f, _, _| {
            Some(-f.pressure * 2.0 + f.core * 0.5 + f.gate * 0.5)
        }),
        ("religious", 6000.0, extra(80_000.0), |f, _, _| {
            Some(f.core - f.high * 0.5)
        }),
        ("craft:smiths", 6000.0, extra(60_000.0), |f, _, _| {
            Some(f.gate * 2.0 + (1.0 - f.core) * 0.3)
        }),
        ("civic", 10_000.0, 1, |f, _, _| Some(f.core)),
        ("garrison", 15_000.0, extra(150_000.0), |f, _, _| {
            Some(f.gate * 1.5 - f.high)
        }),
        ("craft:weavers", 20_000.0, extra(80_000.0), |f, _, phase| {
            Some(f.core * 0.5 - f.pressure + phase * 0.3)
        }),
    ];
    for (role, min_pop, count, cost) in specs {
        let mut count = count;
        if pop < min_pop || (role == "port" && !navigable) {
            continue;
        }
        count = count.saturating_sub(roles.iter().filter(|r| *r == role).count());
        for _ in 0..count {
            if used(&roles) >= budget.max(1) + 1 {
                break;
            }
            let best = (0..n)
                .filter(|&i| roles[i].is_empty())
                .filter_map(|i| {
                    let water = if role == "port" {
                        landing[i]
                    } else {
                        feats[i].1
                    };
                    cost(&feats[i].0, water, feats[i].2).map(|c| (i, c))
                })
                .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
            let Some((i, _)) = best else { break };
            roles[i] = role.into();
        }
    }
    // Residential remainder: peripheral, recent quarters house the poor; the
    // outermost low-pressure district of a large town keeps gardens.
    let mut rest: Vec<usize> = (0..n).filter(|&i| roles[i].is_empty()).collect();
    rest.sort_by(|&a, &b| {
        let k = |i: usize| feats[i].0.core + feats[i].2 - feats[i].0.pressure * 0.5;
        k(b).total_cmp(&k(a)).then(a.cmp(&b))
    });
    if pop >= 8000.0 && rest.len() >= 3 {
        let i = rest.remove(0);
        roles[i] = "gardens".into();
    }
    let poor = if pop >= 2000.0 { rest.len() / 3 } else { 0 };
    for (k, &i) in rest.iter().enumerate() {
        roles[i] = if k < poor && (feats[i].2 > 0.0 || feats[i].0.core > 0.6) {
            "poor"
        } else {
            "commoner"
        }
        .into();
    }
    roles
}

#[cfg(test)]
mod tests {
    use super::super::{
        LayoutConfig, ParcelConfig, Site, Street, Surface, UrbanProgramme, generate_parcels,
        generate_quarters,
    };
    use super::*;

    #[test]
    fn service_counts_scale_with_population_and_culture() {
        let small = services("european-organic", 120, "auto");
        assert!(
            small.iter().all(|s| s.entry.role == "storage.barn"),
            "a hamlet below 150 has no parish, only a shared barn"
        );
        let town = services("european-organic", 5000, "auto");
        let count = |s: &[ServiceNeed], r: &str| {
            s.iter()
                .filter(|n| n.entry.role == r)
                .map(|n| n.sites)
                .sum::<usize>()
        };
        assert_eq!(count(&town, "worship.parish"), 2);
        assert_eq!(count(&town, "worship.cathedral"), 0);
        let city = services("european-organic", 100_000, "auto");
        assert_eq!(count(&city, "worship.cathedral"), 1);
        assert!(count(&city, "commerce.market.gate") >= 8);
        let medina = services("medina", 5000, "auto");
        let friday = medina
            .iter()
            .find(|n| n.entry.role == "worship.mosque.friday")
            .unwrap();
        assert!(friday.entry.landmark && friday.entry.site == "nucleus");
        assert!(friday.area >= 3200.0, "nucleus area from catalogue.json");
        assert!(district_target(100_000) >= 10 && district_target(100_000) <= 30);
        assert_eq!(district_target(150), 1);
    }

    /// A river town: mills or tanneries on the river bank (tanneries on the
    /// lowest reach), French labels everywhere, user overrides of a lot and of
    /// a quarter honoured with stable lot ids, hamlet barns and a ruined state.
    #[test]
    fn river_town_overrides_labels_and_states() {
        let n = 96;
        let width = 2400.0;
        let cell = width / n as f64;
        // River along y ~ 1500 m, flowing east (its bed falls with x).
        let in_river = |i: usize| (1480.0..1530.0).contains(&((i / n) as f64 * cell + cell * 0.5));
        let height: Vec<f32> = (0..n * n)
            .map(|i| {
                let x = (i % n) as f32 * cell as f32;
                (if in_river(i) { 12.0 } else { 20.0 }) - x * 0.004
            })
            .collect();
        let water: Vec<u8> = (0..n * n)
            .map(|i| if in_river(i) { 3 } else { 0 })
            .collect();
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1250.0), (2300.0, 1250.0)),
            road((1200.0, 100.0), (1200.0, 1460.0)),
        ];
        let site = Site {
            key: "river-town".into(),
            name: String::new(),
            population: 5000,
            culture: "european-organic".into(),
            center: Point {
                x: 1200.0,
                y: 1250.0,
            },
            radius: 330.0,
        };
        let run = |config: &LayoutConfig, parcels: &ParcelConfig| {
            let layouts = generate_quarters(
                "river",
                std::slice::from_ref(&site),
                config,
                surface,
                &roads,
            )
            .unwrap();
            let parts = generate_parcels("river", &layouts, parcels).unwrap();
            (layouts, parts)
        };
        let (layouts, parts) = run(&LayoutConfig::default(), &ParcelConfig::default());
        let pr = parts[0].programme.as_ref().unwrap();
        let block = |id: &str| parts[0].parcels.iter().find(|p| p.id == id).unwrap().block;
        // Water trades on the river.
        let on_river: Vec<&str> = pr
            .allocations
            .iter()
            .filter(|a| pr.environment[block(&a.parcel_id)].water == "river")
            .map(|a| a.role.as_str())
            .collect();
        assert!(
            on_river
                .iter()
                .any(|r| matches!(*r, "craft.mill" | "craft.tannery" | "craft.dyer")),
            "no mill/tannery on the river: {on_river:?}"
        );
        // Labels: never a raw id.
        assert!(
            pr.allocations
                .iter()
                .all(|a| !a.label.is_empty() && a.label != a.role)
        );
        let parish = pr
            .allocations
            .iter()
            .find(|a| a.role == "worship.parish")
            .unwrap();
        assert_eq!(parish.label, "Église paroissiale");
        let districts = &layouts[0].structure.as_ref().unwrap().districts;
        assert!(
            districts
                .iter()
                .all(|d| d.label.starts_with("Quartier") || d.label.starts_with("Faubourg"))
        );
        // Lot override: a dwelling becomes a parish, another a mansion of 2 households.
        let count =
            |pr: &UrbanProgramme, r: &str| pr.allocations.iter().filter(|a| a.role == r).count();
        let homes: Vec<&str> = pr
            .allocations
            .iter()
            .filter(|a| a.role.starts_with("dwelling.") && a.role != "dwelling.mansion")
            .map(|a| a.parcel_id.as_str())
            .take(2)
            .collect();
        let mut edited = ParcelConfig::default();
        let forced = |role: &str, households: Option<f64>| super::super::ParcelOverride {
            role: Some(role.into()),
            households,
            ..Default::default()
        };
        edited
            .overrides
            .parcels
            .insert(homes[0].into(), forced("worship.parish", None));
        edited
            .overrides
            .parcels
            .insert(homes[1].into(), forced("dwelling.mansion", Some(2.0)));
        let again = super::super::programme::reallocate(&layouts, &{
            let mut p = parts.clone();
            p[0].config = Some(edited.clone());
            p
        })
        .unwrap();
        let (_, fresh) = run(&LayoutConfig::default(), &edited);
        let ids = |p: &[super::super::Partition]| {
            p[0].parcels
                .iter()
                .map(|p| p.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(&fresh),
            ids(&parts),
            "lot ids stable under lot overrides"
        );
        let edited_pr = fresh[0].programme.as_ref().unwrap();
        assert_eq!(
            serde_json::to_string(&again[0].programme).unwrap(),
            serde_json::to_string(&fresh[0].programme).unwrap(),
            "reallocation replays the edited generation"
        );
        let get = |id: &str| {
            edited_pr
                .allocations
                .iter()
                .find(|a| a.parcel_id == id)
                .unwrap()
        };
        assert_eq!(get(homes[0]).role, "worship.parish");
        assert_eq!(
            (get(homes[1]).role.as_str(), get(homes[1]).households),
            ("dwelling.mansion", 2.0)
        );
        assert_eq!(
            count(edited_pr, "worship.parish"),
            count(pr, "worship.parish"),
            "parishes re-balance"
        );
        // Quarter override: role and wealth on that quarter only.
        let mut config = LayoutConfig::default();
        config.overrides.quarters.insert(
            "0".into(),
            super::super::QuarterOverride {
                role: Some("craft:smiths".into()),
                wealth: Some(0.9),
                ..Default::default()
            },
        );
        let (ql, _) = run(&config, &ParcelConfig::default());
        let d = ql[0]
            .structure
            .as_ref()
            .unwrap()
            .districts
            .iter()
            .find(|d| d.quarters.contains(&0))
            .unwrap();
        assert_eq!(
            (d.role.as_str(), d.wealth, d.quarters.len()),
            ("craft:smiths", 0.9, 1)
        );
        assert_eq!(d.label, "Quartier des forgerons");
        // Ruined: every building empty and labelled as a ruin.
        config = LayoutConfig::default();
        config.programme.state = "ruined".into();
        let (_, ruin) = run(&config, &ParcelConfig::default());
        let rp = ruin[0].programme.as_ref().unwrap();
        assert!(rp.allocations.iter().all(|a| a.households == 0.0));
        let church = rp
            .allocations
            .iter()
            .find(|a| a.role == "worship.parish.ruin")
            .unwrap();
        assert_eq!(church.label, "Église paroissiale en ruine");
        // A hamlet of 30 is only farms; a village of 200 shares a barn.
        assert!(services("european-organic", 30, "auto").is_empty());
        assert!(
            services("european-organic", 200, "auto")
                .iter()
                .any(|s| s.entry.role == "storage.barn")
        );
    }

    /// Scale probe (cargo test --release roles::tests::probe -- --ignored --nocapture).
    #[test]
    #[ignore]
    fn probe_role_scale() {
        for (culture, pop) in [
            ("european-organic", 30_000u32),
            ("medina", 12_000),
            ("european-organic", 100_000),
        ] {
            let n = 128;
            let height = vec![20.0f32; n * n];
            let water = vec![0u8; n * n];
            let width = 12_000.0;
            let surface = Surface {
                geometry: None,
                width,
                n,
                height: &height,
                water: &water,
            };
            let c = width / 2.0;
            let roads = [
                Street {
                    path: vec![
                        Point { x: 200.0, y: c },
                        Point {
                            x: width - 200.0,
                            y: c,
                        },
                    ],
                    widths: vec![6.0; 2],
                    rank: 1,
                    role: "regional".into(),
                },
                Street {
                    path: vec![
                        Point { x: c, y: 200.0 },
                        Point {
                            x: c,
                            y: width - 200.0,
                        },
                    ],
                    widths: vec![6.0; 2],
                    rank: 1,
                    role: "regional".into(),
                },
            ];
            let site = Site {
                key: "probe".into(),
                name: String::new(),
                population: pop,
                culture: culture.into(),
                center: Point { x: c, y: c },
                radius: 30.0 * (pop as f64).sqrt(),
            };
            let t = std::time::Instant::now();
            let layouts = generate_quarters(
                "probe",
                std::slice::from_ref(&site),
                &LayoutConfig::default(),
                surface,
                &roads,
            )
            .unwrap();
            let q = t.elapsed();
            let parts = generate_parcels("probe", &layouts, &ParcelConfig::default()).unwrap();
            let t = std::time::Instant::now();
            let again = super::super::programme::reallocate(&layouts, &parts).unwrap();
            let a = t.elapsed();
            let pr = again[0].programme.as_ref().unwrap();
            let ds = &layouts[0].structure.as_ref().unwrap().districts;
            let mut roles = BTreeMap::<String, usize>::new();
            for d in ds {
                *roles.entry(d.role.clone()).or_default() += 1;
            }
            let dom = pr
                .demands
                .iter()
                .find(|d| d.function == "domestic")
                .unwrap();
            let gardens = pr
                .allocations
                .iter()
                .filter(|a| a.role == "open.garden")
                .count();
            eprintln!(
                "{culture} {pop}: quarters {q:?}; {} parcels, allocate {a:?} ({:.1} us/parcel); {} districts {roles:?}; domestic {:.0}/{:.0}; gardens {gardens}; services {}",
                again[0].parcels.len(),
                a.as_micros() as f64 / again[0].parcels.len().max(1) as f64,
                ds.len(),
                dom.parcel_capacity,
                dom.requested,
                pr.allocations
                    .iter()
                    .filter(|a| !a.role.starts_with("dwelling") && a.role != "open.garden")
                    .count()
            );
        }
    }

    /// A 5k European town: districts with roles, a worship building, a market,
    /// an inn near a gate, housing fully served and almost no vacant plot.
    #[test]
    fn a_european_market_town_houses_everyone_and_places_its_services() {
        let n = 96;
        let height: Vec<f32> = (0..n * n).map(|i| 20.0 + (i % n) as f32 * 0.02).collect();
        let water = vec![0u8; n * n];
        let surface = Surface {
            geometry: None,
            width: 2400.0,
            n,
            height: &height,
            water: &water,
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1200.0), (2300.0, 1200.0)),
            road((1200.0, 100.0), (1200.0, 2300.0)),
        ];
        let site = Site {
            key: "market-town".into(),
            name: String::new(),
            population: 5000,
            culture: "european-organic".into(),
            center: Point {
                x: 1200.0,
                y: 1200.0,
            },
            radius: 330.0,
        };
        let t = std::time::Instant::now();
        let layouts = generate_quarters(
            "roles-town",
            std::slice::from_ref(&site),
            &LayoutConfig::default(),
            surface,
            &roads,
        )
        .unwrap();
        let quarters_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let parts = generate_parcels("roles-town", &layouts, &ParcelConfig::default()).unwrap();
        let parcels_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let again = super::super::programme::reallocate(&layouts, &parts).unwrap();
        let allocate_us = t.elapsed().as_micros() as f64 / parts[0].parcels.len().max(1) as f64;
        assert_eq!(
            serde_json::to_string(&again[0].programme).unwrap(),
            serde_json::to_string(&parts[0].programme).unwrap(),
            "allocation replays exactly"
        );
        let layout = &layouts[0];
        let districts = &layout.structure.as_ref().unwrap().districts;
        assert!(
            (2..=8).contains(&districts.len()),
            "{} districts",
            districts.len()
        );
        assert!(districts.iter().all(|d| !d.role.is_empty()));
        assert!(districts.iter().all(|d| (0.0..=1.0).contains(&d.wealth)));
        let pr = parts[0].programme.as_ref().unwrap();
        let has = |prefix: &str| pr.allocations.iter().any(|a| a.role.starts_with(prefix));
        assert!(has("worship."), "no worship building");
        assert!(has("commerce.market"), "no market");
        let frame = Frame::new(layout, &pr.environment);
        let inn = pr
            .allocations
            .iter()
            .filter(|a| a.role == "commerce.inn")
            .map(|a| {
                let p = parts[0]
                    .parcels
                    .iter()
                    .find(|p| p.id == a.parcel_id)
                    .unwrap();
                frame.gate_distance(g::centroid(&p.shape)) / frame.radius
            })
            .fold(f64::INFINITY, f64::min);
        assert!(inn < 0.45, "inn far from every gate: {inn}");
        let domestic = pr
            .demands
            .iter()
            .find(|d| d.function == "domestic")
            .unwrap();
        let mut by_role = BTreeMap::<&str, (usize, f64)>::new();
        for a in &pr.allocations {
            let e = by_role.entry(a.role.as_str()).or_default();
            e.0 += 1;
            e.1 += a.households;
        }
        eprintln!(
            "districts {:?}
roles {by_role:?}
parcels {} demands {:?}; quarters {quarters_ms} ms, parcels+alloc {parcels_ms} ms, allocate {allocate_us:.1} us/parcel",
            districts.iter().map(|d| (&d.role, d.wealth, d.quarters.len())).collect::<Vec<_>>(),
            parts[0].parcels.len(),
            pr.demands.iter().map(|d| (&d.role, d.requested.round(), d.parcel_capacity.round())).collect::<Vec<_>>()
        );
        assert!(
            domestic.parcel_capacity + 0.01 >= domestic.requested,
            "domestic land deficit {} / {}",
            domestic.parcel_capacity,
            domestic.requested
        );
        assert!(pr.allocations.iter().any(|a| a.households > 1.0) || domestic.requested < 1000.0);
        // Buildable = admissible for housing; vacant = buildable without any use.
        let used: std::collections::BTreeSet<_> = pr
            .allocations
            .iter()
            .map(|a| a.parcel_id.as_str())
            .collect();
        let buildable: Vec<_> = parts[0]
            .parcels
            .iter()
            .filter(|p| matches!(p.use_kind.as_str(), "plot" | "compound"))
            .collect();
        let vacant = buildable
            .iter()
            .filter(|p| !used.contains(p.id.as_str()))
            .count();
        let mut roles = BTreeMap::<&str, usize>::new();
        for a in &pr.allocations {
            *roles.entry(a.role.as_str()).or_default() += 1;
        }
        eprintln!(
            "districts {:?}\nroles {roles:?}\nplots {} vacant {vacant}; quarters {quarters_ms} ms, parcels+alloc {parcels_ms} ms",
            districts
                .iter()
                .map(|d| (&d.role, d.wealth, d.quarters.len()))
                .collect::<Vec<_>>(),
            buildable.len()
        );
        assert!(
            (vacant as f64) < 0.10 * buildable.len() as f64,
            "{vacant} vacant of {} buildable plots",
            buildable.len()
        );
    }

    /// Invariant: in a harbour town every `quay` service stands on a block a
    /// quay serves, and the port district covers that quay frontage (all of
    /// it but the nucleus quarter's). Synthetic sea to the east, Roman town.
    #[test]
    fn port_roles_stand_on_quay_blocks_inside_the_quay_district() {
        let (n, width) = (96, 2400.0);
        let cell = width / n as f64;
        let sea = |i: usize| (i % n) as f64 * cell + cell * 0.5 > 1500.0;
        let height: Vec<f32> = (0..n * n)
            .map(|i| {
                if sea(i) {
                    5.0
                } else {
                    8.0 - (i % n) as f32 * 0.03
                }
            })
            .collect();
        let water: Vec<u8> = (0..n * n).map(|i| u8::from(sea(i))).collect();
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 1200.0), (1480.0, 1200.0)),
            road((1250.0, 100.0), (1250.0, 2300.0)),
        ];
        let site = Site {
            key: "harbour".into(),
            name: String::new(),
            population: 6000,
            culture: "roman-core".into(),
            center: Point {
                x: 1250.0,
                y: 1200.0,
            },
            radius: 420.0,
        };
        // An open harbour (no sea wall between the town and its quays).
        let config = LayoutConfig {
            fortification: "none".into(),
            ..LayoutConfig::default()
        };
        let layouts = generate_quarters(
            "harbour",
            std::slice::from_ref(&site),
            &config,
            surface,
            &roads,
        )
        .unwrap();
        let parts = generate_parcels("harbour", &layouts, &ParcelConfig::default()).unwrap();
        let (layout, part) = (&layouts[0], &parts[0]);
        let contact = quay_contacts(layout);
        assert!(
            contact.iter().any(|&c| c >= QUAY_FRONT),
            "no quay serves a block"
        );
        let pr = part.programme.as_ref().unwrap();
        let quay_roles: Vec<&str> = pr
            .demands
            .iter()
            .filter(|d| d.site == "quay")
            .map(|d| d.role.as_str())
            .collect();
        let placed: Vec<_> = pr
            .allocations
            .iter()
            .filter(|a| quay_roles.contains(&a.role.as_str()))
            .collect();
        assert!(!placed.is_empty(), "no port role placed: {quay_roles:?}");
        for a in &placed {
            let block = part
                .parcels
                .iter()
                .find(|p| p.id == a.parcel_id)
                .unwrap()
                .block;
            assert!(
                contact[block] >= QUAY_FRONT,
                "{} on block {block} off the quays ({:.1} m)",
                a.role,
                contact[block]
            );
        }
        let structure = layout.structure.as_ref().unwrap();
        let port: Vec<usize> = structure
            .districts
            .iter()
            .filter(|d| d.role == "port")
            .flat_map(|d| d.quarters.clone())
            .collect();
        let nucleus = layout
            .quarters
            .iter()
            .position(|q| g::contains(&q.shape, layout.center));
        let env = &pr.environment;
        for (bi, b) in layout.blocks.iter().enumerate() {
            if contact[bi] >= QUAY_FRONT && !env[bi].wet && Some(b.quarter) != nucleus {
                assert!(
                    port.contains(&b.quarter),
                    "quay block {bi} (quarter {}) outside the port {port:?}",
                    b.quarter
                );
            }
        }
    }
}
