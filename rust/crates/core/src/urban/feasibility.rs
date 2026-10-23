//! Native feasibility of a real lot, before any request reaches houses
//! (TODO « bâtiments faisables par construction », REVIEW #23).
//!
//! The houses admission export (`urban-admission.json`, `feasibility.profiles`)
//! holds one frozen native witness per recipe × variant: its minimum envelope,
//! entrance width, principal floors, layout and morphology. The city tests the
//! real lot against these witnesses (same filters as houses' automatic style
//! query: pack, palette tradition, period, strict ⇒ no inspired-only source,
//! no late-only source) and composes its programme from what actually fits:
//! the wished composition and floors are kept only when an admissible witness
//! that fits the lot ranks first for them in houses' shortlist. Houses stays
//! the judge of the final plan; this only removes requests the city already
//! knows to be infeasible, instead of letting houses draw and refuse them.
use super::super::geometry;
use super::super::{Parcel, Point, Shape, Surface};

/// Same 0.3 m clearance on each side as the cadastral admission witness.
pub(super) const CLEARANCE: f64 = 0.6;
/// Houses' foundation limit sent with every request (`max_foundation_step_m`).
pub(super) const MAX_FOUNDATION_STEP: f64 = 0.75;

/// One supported native recipe/variant witness.
pub(super) struct Witness {
    pub style_id: String,
    pub recipe_id: String,
    pub pack: String,
    pub layout: String,
    pub morphology: String,
    /// Houses source role (dwelling, communal_dwelling…).
    pub role: String,
    pub floors: [u32; 2],
    /// Frozen native minimum envelope (bodies, courts, roof, entrance), metres.
    pub envelope: [f64; 2],
    pub access: f64,
    /// Source minima (width along the front, depth) of the whole house.
    pub nominal: Option<[f64; 2]>,
    /// What those minima bound: one rectangular body, a closed court ring
    /// (bodies on every side), or only the overall extent.
    pub bearing: Bearing,
    /// Ground-bearing source (no posts or piers): the foundation step applies.
    pub ground: bool,
    /// The frozen native minimum was built by the export (`supported`).
    pub supported: bool,
    eras: Vec<String>,
    tradition: Option<String>,
    inspired_only: bool,
}
/// The part of a source's minimum extent its foundation is known to cover.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Bearing {
    /// A single rectangular body of at least the nominal minima.
    Body,
    /// Wings closing a court: the four corners of the nominal minima.
    Ring,
    /// Only the overall extent is known.
    Extent,
}
impl Witness {
    /// Margined envelope tested on the lot (width along the front, depth).
    pub fn margined(&self) -> [f64; 2] {
        [self.envelope[0] + CLEARANCE, self.envelope[1] + CLEARANCE]
    }
    /// The smallest footprint houses founds for this source (width along
    /// the front, depth): its nominal minima, raised for a certified source
    /// to its frozen native minimum less 0.75 m of eaves and entrance on each
    /// side (the single-body witnesses keep 0.25–0.35 m; a built MED-ANT-B02
    /// atrium is 26.1 m for a 27.5 m envelope), since houses never draws it
    /// below that minimum. `None` when the minima are unknown.
    pub fn footing(&self) -> Option<[f64; 2]> {
        let [w, d] = self.nominal?;
        if !super::round7() || !self.supported || !self.envelope.iter().all(|e| e.is_finite()) {
            return Some([w, d]);
        }
        let (lo, hi) = (
            self.envelope[0].min(self.envelope[1]) - 1.5,
            self.envelope[0].max(self.envelope[1]) - 1.5,
        );
        Some(if w <= d {
            [w.max(lo), d.max(hi)]
        } else {
            [w.max(hi), d.max(lo)]
        })
    }
    fn key(&self) -> [u64; 3] {
        [
            self.envelope[0].to_bits(),
            self.envelope[1].to_bits(),
            self.access.to_bits(),
        ]
    }
}

/// (source_sha256, generator_version) of the houses admission export.
static EXPORT_IDENTITY: std::sync::OnceLock<(String, String)> = std::sync::OnceLock::new();

/// Supported witnesses, smallest margined envelope first (parsed once).
pub(super) fn witnesses() -> &'static [Witness] {
    #[derive(serde::Deserialize)]
    struct Minimum {
        status: String,
        #[serde(default)]
        envelope_m: Option<[f64; 2]>,
        #[serde(default)]
        access_width_m: Option<f64>,
    }
    #[derive(serde::Deserialize, Default)]
    struct Temporal {
        #[serde(default)]
        eras: Vec<String>,
        /// Late-only sources need `allow_late`, which city requests never set.
        #[serde(default)]
        late_only: bool,
    }
    #[derive(serde::Deserialize)]
    struct Row {
        style_id: String,
        recipe_id: String,
        pack: String,
        layout: String,
        #[serde(default)]
        morphology: String,
        #[serde(default)]
        role: String,
        primary_floors: [u32; 2],
        minimum_native: Minimum,
        #[serde(default)]
        nominal_width_m: Option<[f64; 2]>,
        #[serde(default)]
        nominal_depth_m: Option<[f64; 2]>,
        #[serde(default)]
        support_kind: String,
        #[serde(default)]
        footprint_family: String,
        #[serde(default)]
        source_constraints: Constraints,
        #[serde(default)]
        tradition_id: Option<String>,
        #[serde(default)]
        inspired_only: bool,
        #[serde(default)]
        temporal: Temporal,
    }
    #[derive(serde::Deserialize, Default)]
    struct Component {
        #[serde(default)]
        width_ratio: [f64; 2],
        #[serde(default)]
        depth_ratio: [f64; 2],
    }
    #[derive(serde::Deserialize, Default)]
    struct Constraints {
        #[serde(default)]
        bodies: [u32; 2],
        #[serde(default)]
        components: Vec<Component>,
    }
    #[derive(serde::Deserialize)]
    struct Feasibility {
        profiles: Vec<Row>,
    }
    #[derive(serde::Deserialize)]
    struct Export {
        feasibility: Feasibility,
        #[serde(default)]
        source_sha256: String,
        #[serde(default)]
        generator_version: String,
    }
    static ALL: std::sync::OnceLock<Vec<Witness>> = std::sync::OnceLock::new();
    ALL.get_or_init(|| {
        let export: Export =
            serde_json::from_str(include_str!("../../../houses/data/urban-admission.json"))
                .expect("versioned houses admission catalogue");
        let _ = EXPORT_IDENTITY.set((
            export.source_sha256.clone(),
            export.generator_version.clone(),
        ));
        let mut all: Vec<_> = export
            .feasibility
            .profiles
            .into_iter()
            .filter(|w| !w.temporal.late_only)
            .map(|w| {
                let supported = w.minimum_native.status == "supported";
                let envelope = w
                    .minimum_native
                    .envelope_m
                    .filter(|_| supported)
                    .unwrap_or([f64::INFINITY; 2]);
                let nominal = w
                    .nominal_width_m
                    .zip(w.nominal_depth_m)
                    .map(|(a, b)| [a[0], b[0]])
                    .filter(|n| n[0] > 0.0 && n[1] > 0.0);
                let c = &w.source_constraints;
                let bearing = if w.footprint_family == "FP-RECT"
                    && c.bodies == [1, 1]
                    && c.components.len() == 1
                    && c.components[0].width_ratio == [1.0, 1.0]
                    && c.components[0].depth_ratio == [1.0, 1.0]
                {
                    Bearing::Body
                } else if w.footprint_family == "FP-COURT"
                    && matches!(
                        w.layout.as_str(),
                        "courtyard" | "atrium" | "peristyle" | "siheyuan"
                    )
                {
                    Bearing::Ring
                } else {
                    Bearing::Extent
                };
                Witness {
                    supported,
                    envelope,
                    access: w.minimum_native.access_width_m.unwrap_or(0.0),
                    nominal,
                    bearing,
                    ground: w.support_kind.is_empty() || w.support_kind == "ground",
                    style_id: w.style_id,
                    recipe_id: w.recipe_id,
                    pack: w.pack,
                    layout: w.layout,
                    morphology: w.morphology,
                    role: w.role,
                    floors: w.primary_floors,
                    eras: w.temporal.eras,
                    tradition: w.tradition_id,
                    inspired_only: w.inspired_only,
                }
            })
            .collect();
        let area = |w: &Witness| w.margined()[0] * w.margined()[1];
        all.sort_by(|a, b| {
            area(a)
                .total_cmp(&area(b))
                .then(a.recipe_id.cmp(&b.recipe_id))
                .then(a.floors.cmp(&b.floors))
                .then(a.style_id.cmp(&b.style_id))
        });
        all
    })
}

/// Supported witnesses houses may draw for this culture: the pack, the
/// culture's palette tradition, the period; strict mode never takes an
/// inspired-only source (as houses' StyleQuery::permits). Smallest first.
pub(super) fn admissible(
    pack: &str,
    culture: &str,
    period: &str,
    strict: bool,
) -> Vec<&'static Witness> {
    drawable(pack, culture, period, strict)
        .filter(|p| p.supported)
        .collect()
}
/// Every source of the culture's automatic houses query, certified or not.
pub(super) fn drawable<'a>(
    pack: &'a str,
    culture: &str,
    period: &'a str,
    strict: bool,
) -> impl Iterator<Item = &'static Witness> + 'a {
    let tradition = super::super::culture::palette_tradition(culture, pack);
    witnesses().iter().filter(move |p| {
        p.pack == pack
                // Houses' automatic query draws residential roles only.
                && matches!(
                    p.role.as_str(),
                    "dwelling" | "residential_ensemble" | "communal_dwelling" | "mixed_residential"
                )
                && !(strict && p.inspired_only)
                && (tradition.is_none() || p.tradition.as_deref() == tradition)
                && (period.is_empty()
                    || period == "any"
                    || p.eras.iter().any(|e| e == period)
                    || (!strict && p.inspired_only && p.eras.is_empty()))
    })
}

/// Every source of a pinned recipe (any variant, certified or not, late-only
/// excluded as for every city request): what houses may draw for it.
pub(super) fn recipe_sources(recipe: &str) -> Vec<&'static Witness> {
    witnesses()
        .iter()
        .filter(|w| w.recipe_id == recipe)
        .collect()
}
/// The sources of these exact style ids (a functional choice's declared ones).
pub(super) fn style_sources(styles: &[&str]) -> Vec<&'static Witness> {
    witnesses()
        .iter()
        .filter(|w| styles.contains(&w.style_id.as_str()))
        .collect()
}

/// The witnesses whose envelope the real lot holds (`parcel_envelope` on its
/// actual contour, fronts and access), smallest first, with the exploitable
/// frontage and the largest witnessed rectangle (the lot's buildable domain
/// for a native house). Identical envelopes are tested once.
pub(super) struct LotFit {
    pub fits: Vec<&'static Witness>,
    /// Largest margined witness rectangle the lot holds, if any.
    pub domain: Option<([f64; 2], Shape)>,
    /// Longest street contact usable as a front, metres.
    pub frontage_m: f64,
    /// Number of admissible witnesses tested (for diagnostics).
    pub admissible: usize,
}
pub(super) fn lot_fit(parcel: &Parcel, admissible: &[&'static Witness]) -> LotFit {
    let lot = geometry::area(&parcel.shape);
    let mut tested: Vec<([u64; 3], Option<Shape>)> = Vec::new();
    let mut fits = Vec::new();
    let mut domain: Option<([f64; 2], Shape)> = None;
    for &w in admissible {
        let [width, depth] = w.margined();
        if width * depth > lot {
            break;
        }
        let key = w.key();
        let rect = match tested.iter().find(|(k, _)| *k == key) {
            Some((_, r)) => r.clone(),
            None => {
                let r =
                    super::super::parcels::parcel_envelope(parcel, width, depth, w.access.max(0.8));
                tested.push((key, r.clone()));
                r
            }
        };
        if let Some(rect) = rect {
            if domain
                .as_ref()
                .is_none_or(|(d, _)| d[0] * d[1] < width * depth)
            {
                domain = Some(([width, depth], rect));
            }
            fits.push(w);
        }
    }
    let frontage_m = super::super::parcels::continuous_frontage(&parcel.contacts)
        .max(parcel.access.as_ref().map_or(0.0, |a| a.front_length));
    LotFit {
        fits,
        domain,
        frontage_m,
        admissible: admissible.len(),
    }
}

/// Mirror of houses' `ProgrammeComposition::rank`: 0 when the witness is in
/// the first shortlist group of this wished composition.
pub(super) fn composition_rank(composition: &str, w: &Witness) -> u8 {
    let m = w.morphology.as_str();
    match composition {
        "row" => u8::from(w.layout != "strip"),
        "detached" => u8::from(m != "single"),
        "courtyard" => u8::from(m != "courtyard"),
        "compound" => match m {
            "compound" => 0,
            "courtyard" => 1,
            _ => 2,
        },
        "farm" => u8::from(!matches!(m, "courtyard" | "compound")),
        _ => 0,
    }
}
/// Residential compositions houses ranks; others (hall, civic…) are functional.
pub(super) fn residential(composition: &str) -> bool {
    matches!(
        composition,
        "row" | "detached" | "courtyard" | "compound" | "farm"
    )
}

/// Mirror of houses' floors rank of a source for a floors wish.
fn floors_rank(wish: Option<[u32; 2]>, w: &Witness) -> u32 {
    wish.map_or(0, |[lo, hi]| {
        w.floors[0]
            .saturating_sub(hi)
            .max(lo.saturating_sub(w.floors[1]))
    })
}

/// How many distinct recipes houses' four-source shortlist is certain to draw
/// among witnesses the lot holds, for this composition and floors wish.
/// Houses ranks every drawable source by (composition rank, floors rank) and
/// draws each group completely, one variant per recipe, before the next: the
/// count stops at the first group holding a source the lot cannot hold (or
/// an uncertified one), since that source may then be drawn.
pub(super) fn shortlist_score(
    composition: &str,
    floors: Option<[u32; 2]>,
    drawable: &[&'static Witness],
    fits: &[&'static Witness],
) -> usize {
    let fitting = |w: &Witness| fits.iter().any(|f| std::ptr::eq(*f, w));
    let mut groups: std::collections::BTreeMap<(u8, u32), Vec<&Witness>> = Default::default();
    for &w in drawable {
        groups
            .entry((composition_rank(composition, w), floors_rank(floors, w)))
            .or_default()
            .push(w);
    }
    let mut used: Vec<&str> = Vec::new();
    for group in groups.values() {
        let fresh: Vec<_> = group
            .iter()
            .filter(|w| !used.contains(&w.recipe_id.as_str()))
            .collect();
        if fresh.iter().any(|w| !fitting(w)) {
            break;
        }
        for w in fresh {
            if !used.contains(&w.recipe_id.as_str()) {
                used.push(&w.recipe_id);
            }
        }
        if used.len() >= 4 {
            break;
        }
    }
    used.len().min(4)
}

/// The wished residential composition when the real lot holds one of its
/// sources; otherwise the composition of the culture whose houses shortlist
/// is certain to draw the most sources the lot holds (the nearest in the
/// culture's order on a tie). `None` when no witness fits at all.
pub(super) fn feasible_composition(
    wished: &'static str,
    floors: Option<[u32; 2]>,
    drawable: &[&'static Witness],
    fits: &[&'static Witness],
    party_walls: bool,
) -> Option<&'static str> {
    if fits.is_empty() {
        return None;
    }
    // Simple forms (row, detached) keep their wish: their sources are the
    // pack's smallest, and houses' Row recovery draws one more simple source.
    if !residential(wished) || matches!(wished, "row" | "detached") {
        return Some(wished);
    }
    let order: &[&'static str] = match (wished, party_walls) {
        ("row", _) => &["row", "detached", "compound", "courtyard"],
        ("courtyard", true) => &["courtyard", "row", "detached", "compound"],
        ("courtyard", false) => &["courtyard", "detached", "row", "compound"],
        ("compound", _) => &["compound", "detached", "row", "courtyard"],
        ("farm", _) => &["farm", "compound", "detached", "row"],
        _ => &["detached", "row", "compound", "courtyard"],
    };
    // The lot holds a source of the wished form: houses draws among them.
    if fits.iter().any(|w| composition_rank(wished, w) == 0) {
        return Some(wished);
    }
    let mut best = (shortlist_score(wished, floors, drawable, fits), wished);
    for &c in &order[1..] {
        let score = shortlist_score(c, floors, drawable, fits);
        if score > best.0 {
            best = (score, c);
        }
    }
    Some(best.1)
}

/// Houses source role a residential programme stands for: a tenement is a
/// collective dwelling, a shop (or any mixed lot) a dwelling over a shop,
/// every other home a dwelling. Read from the recipe declarations only.
pub(super) fn programme_source_role(role: &str, function: &str) -> &'static str {
    let is = |r: &str| role == r || role.starts_with(&format!("{r}."));
    if is("dwelling.tenement") {
        "communal_dwelling"
    } else if function == "mixed" || is("dwelling.shop") {
        "mixed_residential"
    } else {
        "dwelling"
    }
}
/// Whether houses' first shortlist group for this composition and floors,
/// among the sources the lot holds, contains a source of this role.
fn first_group_serves(
    composition: &str,
    floors: Option<[u32; 2]>,
    source_role: &str,
    fits: &[&Witness],
) -> bool {
    let key = |w: &Witness| (composition_rank(composition, w), floors_rank(floors, w));
    fits.iter()
        .map(|w| key(w))
        .min()
        .is_some_and(|k| fits.iter().any(|w| key(w) == k && w.role == source_role))
}
/// The residential composition whose first shortlist group draws a source of
/// the programme's own role (shop → dwelling over a shop, house → dwelling,
/// tenement → collective dwelling) among those the lot holds: the wish when
/// it does, else the first composition that does, in a fixed order. No
/// quota: when the lot holds no source of that role the wish is unchanged.
pub(super) fn programme_composition(
    composition: &'static str,
    floors: Option<[u32; 2]>,
    source_role: &str,
    fits: &[&Witness],
) -> &'static str {
    if !residential(composition)
        || !fits.iter().any(|w| w.role == source_role)
        || first_group_serves(composition, floors, source_role, fits)
    {
        return composition;
    }
    ["detached", "row", "courtyard", "compound"]
        .into_iter()
        .find(|c| first_group_serves(c, floors, source_role, fits))
        .unwrap_or(composition)
}

/// The floors wish kept when a fitting witness of the first composition group
/// offers one of its levels; otherwise the nearest level such a witness has.
pub(super) fn feasible_floors(wish: [u32; 2], composition: &str, fits: &[&Witness]) -> [u32; 2] {
    let group: Vec<_> = fits
        .iter()
        .filter(|w| composition_rank(composition, w) == 0)
        .collect();
    let group = if group.is_empty() {
        fits.iter().collect()
    } else {
        group
    };
    if group.is_empty()
        || group
            .iter()
            .any(|w| w.floors[0] <= wish[1] && wish[0] <= w.floors[1])
    {
        return wish;
    }
    let distance = |l: u32| l.abs_diff(wish[0]).min(l.abs_diff(wish[1]));
    let level = group
        .iter()
        .flat_map(|w| w.floors[0]..=w.floors[1])
        .min_by_key(|&l| (distance(l), l))
        .unwrap_or(wish[0]);
    [level, level]
}

/// A lower bound on the foundation step of every pose houses gives this
/// source on the lot. Houses' poses keep the source's width along a declared
/// access or the placement hint (`dirs`, at 0° or 180°; the street-facing
/// poses of the contract — houses' quarter turns around its hint, door to
/// the side, are not covered), at any offset, and the house is at least its
/// footing (`Witness::footing`). For each direction, positions are
/// sampled every metre; a position is kept when its rectangle shrunk by half
/// a step lies in the lot, so every real pose contains a kept shrunk one, and
/// the sampled height range over that shrunk rectangle (all of it for a
/// single body, its outline for a court ring) bounds the
/// real step from below. `INFINITY` when no pose fits the lot at all; `0`
/// when only the extent is known and some pose fits. Stops as soon as the
/// bound falls to `stop_below`.
pub(super) fn pose_lower_bound(
    surface: Surface<'_>,
    lot: &Shape,
    dirs: &[Point],
    w: &Witness,
    stop_below: f64,
) -> f64 {
    pose_lower_bound_step(surface, lot, dirs, w, stop_below, 1.0)
}
/// The bound on a `step`-metre position grid (rectangles shrunk by half a step).
fn pose_lower_bound_step(
    surface: Surface<'_>,
    lot: &Shape,
    dirs: &[Point],
    w: &Witness,
    stop_below: f64,
    step: f64,
) -> f64 {
    let Some([width, depth]) = w.footing() else {
        return 0.0;
    };
    let half = step * 0.5;
    // Round 6 sampled a court ring 1 m inside its nominal extent; its footing
    // is now the bodies' outer face, so the outline itself is sampled.
    let inset = half
        + if w.bearing == Bearing::Ring && !super::round7() {
            1.0
        } else {
            0.0
        };
    // A court ring's bodies run along its whole outline: sample that outline
    // (corners and edge points), never the open court.
    let ring = w.bearing == Bearing::Ring;
    let (n, corners) = (if ring && !super::round7() { 1 } else { 4 }, ring);
    let mut best = f64::INFINITY;
    for &u in dirs {
        let v = Point { x: -u.y, y: u.x };
        let (mut u0, mut u1, mut v0, mut v1) = (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &lot.outer {
            let (a, b) = (p.x * u.x + p.y * u.y, p.x * v.x + p.y * v.y);
            (u0, u1, v0, v1) = (u0.min(a), u1.max(a), v0.min(b), v1.max(b));
        }
        if u1 - u0 < width || v1 - v0 < depth {
            continue;
        }
        let at = |a: f64, b: f64| Point {
            x: u.x * a + v.x * b,
            y: u.y * a + v.y * b,
        };
        let (sw, sd) = (width - 2.0 * half, depth - 2.0 * half);
        let (iw, id) = (
            (width - 2.0 * inset).max(0.0),
            (depth - 2.0 * inset).max(0.0),
        );
        let mut a = u0 - half;
        while a + width <= u1 + half + 1e-9 {
            let mut b = v0 - half;
            while b + depth <= v1 + half + 1e-9 {
                if rect_within(lot, at(a + half, b + half), u, v, sw, sd) {
                    if w.bearing == Bearing::Extent {
                        return 0.0;
                    }
                    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
                    for i in 0..=n {
                        for j in 0..=n {
                            if corners && i != 0 && i != n && j != 0 && j != n {
                                continue;
                            }
                            let h = surface.height_at(at(
                                a + inset + iw * i as f64 / n as f64,
                                b + inset + id * j as f64 / n as f64,
                            ));
                            lo = lo.min(h);
                            hi = hi.max(h);
                        }
                    }
                    best = best.min(hi - lo);
                    if best <= stop_below {
                        return best;
                    }
                }
                b += step;
            }
            a += step;
        }
    }
    best
}

/// Frozen native minimum of a single rectangular body, from Codex's witness
/// descriptors (`houses --example admission_witnesses`), distilled into
/// `native_witnesses.json`: identity, body rectangle and site bounds in the
/// unshifted native frame, body-door midpoint on the `y = body.y1` face.
pub(super) struct PoseWitness {
    pub style_id: String,
    identity: serde_json::Value,
    body: [f64; 4],
    bounds: [f64; 4],
    entry: [f64; 2],
    access: f64,
    pub body_area: f64,
    pub primary_floors: Option<u32>,
}
/// The pose table, only while it belongs to the same houses source as the
/// admission export compiled here (else every identity would be stale and
/// houses would refuse the contract).
pub(super) fn pose_witness(style_id: &str) -> Option<&'static PoseWitness> {
    #[derive(serde::Deserialize)]
    struct Row {
        identity: serde_json::Value,
        body: [f64; 4],
        bounds: [f64; 4],
        entry: [f64; 2],
        access_width_m: f64,
        body_area_m2: f64,
        #[serde(default)]
        primary_floors: Option<u32>,
    }
    #[derive(serde::Deserialize)]
    struct Table {
        source_sha256: String,
        generator_version: String,
        witnesses: Vec<Row>,
    }
    static TABLE: std::sync::OnceLock<Vec<PoseWitness>> = std::sync::OnceLock::new();
    TABLE
        .get_or_init(|| {
            witnesses();
            let table: Table = serde_json::from_str(include_str!("native_witnesses.json"))
                .expect("distilled native witness poses");
            let current = EXPORT_IDENTITY.get();
            if current.is_none_or(|(sha, generator)| {
                *sha != table.source_sha256 || *generator != table.generator_version
            }) {
                return Vec::new();
            }
            table
                .witnesses
                .into_iter()
                .map(|r| PoseWitness {
                    style_id: r.identity["style_id"].as_str().unwrap_or("").to_owned(),
                    identity: r.identity,
                    body: r.body,
                    bounds: r.bounds,
                    entry: r.entry,
                    access: r.access_width_m,
                    body_area: r.body_area_m2,
                    primary_floors: r.primary_floors,
                })
                .collect()
        })
        .iter()
        .find(|w| w.style_id == style_id)
}

/// Bilinear foundation step over a rectangle, sampled at most 0.5 m apart.
fn rect_step(surface: Surface<'_>, o: Point, u: Point, v: Point, w: f64, d: f64) -> f64 {
    let (nu, nv) = (
        ((w / 0.5).ceil() as usize).max(1),
        ((d / 0.5).ceil() as usize).max(1),
    );
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for i in 0..=nu {
        for j in 0..=nv {
            let (s, t) = (w * i as f64 / nu as f64, d * j as f64 / nv as f64);
            let h = surface.height_at(Point {
                x: o.x + u.x * s + v.x * t,
                y: o.y + u.y * s + v.y * t,
            });
            lo = lo.min(h);
            hi = hi.max(h);
        }
    }
    hi - lo
}

/// Exact convex-rectangle containment in the lot, holes included (the
/// Liang-Barsky test of the cadastral witness search).
fn rect_within(shape: &Shape, a: Point, u: Point, v: Point, width: f64, depth: f64) -> bool {
    const EPS: f64 = 1e-4;
    let (s0, s1, t0, t1) = (EPS, width - EPS, EPS, depth - EPS);
    let local = |p: Point| {
        let (dx, dy) = (p.x - a.x, p.y - a.y);
        (dx * u.x + dy * u.y, dx * v.x + dy * v.y)
    };
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        for (&p, &q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let ((px, py), (qx, qy)) = (local(p), local(q));
            if px.max(qx) <= s0 || px.min(qx) >= s1 || py.max(qy) <= t0 || py.min(qy) >= t1 {
                continue;
            }
            let (dx, dy) = (qx - px, qy - py);
            let (mut enter, mut exit) = (0.0_f64, 1.0_f64);
            let mut inside = true;
            for (pk, qk) in [(-dx, px - s0), (dx, s1 - px), (-dy, py - t0), (dy, t1 - py)] {
                if pk.abs() < 1e-15 {
                    if qk < 0.0 {
                        inside = false;
                        break;
                    }
                } else if pk < 0.0 {
                    enter = enter.max(qk / pk);
                } else {
                    exit = exit.min(qk / pk);
                }
            }
            if inside && enter <= exit {
                return false;
            }
        }
    }
    geometry::contains(
        shape,
        Point {
            x: a.x + u.x * width * 0.5 + v.x * depth * 0.5,
            y: a.y + u.y * width * 0.5 + v.y * depth * 0.5,
        },
    )
}

/// Up to four direct poses of a frozen native witness on the real lot
/// (Codex's `native_minimum_candidates` contract): the door faces a declared
/// access, the contact is the door's projection on that segment with half
/// the native entrance width free on each side, the whole site bounds (roof
/// included) lie inside the lot, and the body's foundation step on the
/// raster is within the limit. Most level poses first, at least 1 m apart.
/// Houses re-checks every pose exactly; this only proposes poses that can
/// succeed, it never searches on houses' behalf.
pub(super) fn minimum_candidates(
    w: &PoseWitness,
    lot: &Shape,
    accesses: &[serde_json::Value],
    surface: Surface<'_>,
) -> Vec<serde_json::Value> {
    let width = w.access.max(0.8);
    let gap = (w.bounds[3] - w.body[3]).max(0.0) + 0.05;
    let point = |v: &serde_json::Value| {
        Some(Point {
            x: v["x"].as_f64()?,
            y: v["y"].as_f64()?,
        })
    };
    let mut found: Vec<(f64, Point, serde_json::Value)> = Vec::new();
    for (k, access) in accesses.iter().enumerate() {
        // Houses resolves `access_id` to the first access of that id: a lot
        // with several contacts on one street only poses on the first.
        if accesses[..k].iter().any(|a| a["id"] == access["id"]) {
            continue;
        }
        if !matches!(
            access["kind"].as_str(),
            Some("public" | "collective" | "private")
        ) || access["width_m"].as_f64().unwrap_or(0.0) < width
        {
            continue;
        }
        let (Some(a), Some(b)) = (point(&access["segment"][0]), point(&access["segment"][1]))
        else {
            continue;
        };
        let len = (b.x - a.x).hypot(b.y - a.y);
        if len < width {
            continue;
        }
        let t = Point {
            x: (b.x - a.x) / len,
            y: (b.y - a.y) / len,
        };
        // Inward normal: the side of the segment the lot lies on.
        let mid = Point {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
        };
        let left = Point { x: -t.y, y: t.x };
        let n = if geometry::contains(
            lot,
            Point {
                x: mid.x + left.x * 0.3,
                y: mid.y + left.y * 0.3,
            },
        ) {
            left
        } else {
            Point { x: t.y, y: -t.x }
        };
        // Native +y (towards the door) faces the street; +x follows.
        let ny = Point { x: -n.x, y: -n.y };
        let nx = Point { x: ny.y, y: -ny.x };
        let angle = nx.y.atan2(nx.x).to_degrees();
        let steps = ((len - width) / 0.5).floor() as usize;
        for i in 0..=steps {
            let along = width * 0.5 + 0.5 * i as f64;
            let contact = Point {
                x: a.x + t.x * along,
                y: a.y + t.y * along,
            };
            let door = Point {
                x: contact.x + n.x * gap,
                y: contact.y + n.y * gap,
            };
            let origin = Point {
                x: door.x - nx.x * w.entry[0] - ny.x * w.entry[1],
                y: door.y - nx.y * w.entry[0] - ny.y * w.entry[1],
            };
            let at = |x: f64, y: f64| Point {
                x: origin.x + nx.x * x + ny.x * y,
                y: origin.y + nx.y * x + ny.y * y,
            };
            let [bx0, by0, bx1, by1] = w.bounds;
            if !rect_within(lot, at(bx0, by0), nx, ny, bx1 - bx0, by1 - by0) {
                continue;
            }
            let [x0, y0, x1, y1] = w.body;
            let step = rect_step(surface, at(x0, y0), nx, ny, x1 - x0, y1 - y0);
            if step > MAX_FOUNDATION_STEP - 0.02 {
                continue;
            }
            found.push((
                step,
                contact,
                serde_json::json!({"identity":w.identity,
                    "transform":{"origin":{"x":origin.x,"y":origin.y},"orientation_deg":angle},
                    "access_id":access["id"],"contact":{"x":contact.x,"y":contact.y}}),
            ));
        }
    }
    found.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out: Vec<(Point, serde_json::Value)> = Vec::new();
    for (_, contact, candidate) in found {
        if out
            .iter()
            .all(|(c, _)| (c.x - contact.x).hypot(c.y - contact.y) >= 1.0)
        {
            out.push((contact, candidate));
            if out.len() == 4 {
                break;
            }
        }
    }
    out.into_iter().map(|(_, c)| c).collect()
}
