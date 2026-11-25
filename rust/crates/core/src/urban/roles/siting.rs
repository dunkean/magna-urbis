//! Block siting facts and service placement costs.

use super::*;

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
    /// The block stands in the castle's bailey (`purpose: castle`).
    pub castle: bool,
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
        // A lighthouse marks the sea or lake shore, the farther from the core the better.
        "shore" if f.shore => (1.0 - f.core.min(1.0)) * 0.6,
        "shore" => QUAY_MISS + f.core,
        "downstream" if f.river => f.downstream * 2.5 + (1.0 - f.core.min(1.0)) * 0.8,
        "downstream" if f.water => 1.5 + (1.0 - f.core.min(1.0)) * 0.8,
        "downstream" => 3.0 + f.high * 2.0 + (1.0 - f.core) * 1.5,
        // A castle or keep stands in the bailey the town built for it.
        "hill" if f.castle => -10.0 + f.core * 0.1,
        "hill" => (1.0 - f.high) * 3.0 + f.core * 0.8,
        "summit" => (1.0 - f.high) * 100.0 + f.core * 0.3,
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
    /// Castle baileys on the heights (`fortification::heights_castle`).
    pub castles: Vec<super::super::Shape>,
}
impl Frame {
    pub fn new(layout: &Layout, env: &[BlockEnvironment]) -> Self {
        Self::with_quay(layout, env, quay_contacts(layout))
    }
    /// Frame over already measured quay contacts (`quay_contacts(layout)`).
    pub(super) fn with_quay(layout: &Layout, env: &[BlockEnvironment], quay: Vec<f64>) -> Self {
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
        let harbour = quay
            .iter()
            .enumerate()
            .any(|(i, &c)| c >= QUAY_FRONT && !env.get(i).is_some_and(|e| e.wet));
        Self {
            quay,
            harbour,
            castles: layout.enclosures.iter().filter(|e| e.purpose == "castle")
                .map(|e| super::super::Shape { outer: e.path.clone(), holes: vec![] }).collect(),
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
            castle: self.castles.iter().any(|c| g::contains(c, p)),
        }
    }
}
pub(super) fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
/// `shore` service (lighthouse) needs a sea or lake front, never a river.
pub fn site_admissible(site: &str, f: &SiteFacts) -> bool {
    match site {
        "quay" => f.quay,
        "shore" => f.shore,
        _ => true,
    }
}
/// Enclosure gates; an open town uses the points where its regional roads leave
/// the built area (vertex of each regional road closest to 0.9 R).
pub fn gates(layout: &Layout, center: Point, radius: f64) -> Vec<Point> {
    let mut out: Vec<Point> = layout
        .enclosures
        .iter()
        .flat_map(|e| e.gates.iter().enumerate().filter(|(i, _)| !e.inner_gates.contains(i)).map(|(_, &g)| g))
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
