//! City-side building occupation of one parcel: the footprint(s) a house of
//! this culture, zone and programme actually covers, in metres. This is a
//! preview for the city plan (silhouettes, density, later 3D massing) and a
//! hint for the houses crate; the admission witness stays `Parcel.envelope`.
//!
//! Correct by construction: bodies and wings are whole rectangles composed in
//! the frame of the main frontage and fitted (slid, narrowed, shortened) inside
//! the lot by an exact slice test, or the lot band itself when its sides are
//! within 15 degrees of square (street walls then keep the cadastral party
//! walls). A mass that does not fit one wing width is dropped, never clipped
//! into a sliver; a court keeps at least the culture's wing width on every
//! side. Every piece is a valid simple polygon at least `wing` thick.
use super::contacts::{Front, parcel_fronts, runs};
use super::cut_geometry::{Plane, add, clip, distance, dot, length, normal, ring_area, scale, sub, unit};
use crate::rng::Rng;
use crate::urban::{Morph, Parcel, Point, Shape};
use std::borrow::Cow;
use crate::urban::geometry::{area, difference, intersection};

/// What the parcel builds, chosen from the cultural recipe (buildingOp,
/// plotOp, arch.typology), the zone, the function and the programme role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Kind {
    Open,
    Row,
    Detached,
    Farm,
    Court,
    /// Collective block-front body (insula, tenement): a deep street range
    /// with shops below, built around a court only where the lot holds one.
    Insula,
    Pavilions,
    Hanok,
    Yashiki,
    Round,
    Long,
    Hall,
    Warehouse,
}

/// Resolved tissue numbers for one (block, culture), with pressure applied.
pub(in super::super) struct Occupancy<'a> {
    pub morph: &'a Morph,
    pub zone: &'a str,
    /// Allocation function before the houses mapping (domestic, mixed, workshop,
    /// warehouse, collective, market, common).
    pub function: &'a str,
    pub role: &'a str,
    pub landmark: bool,
    pub party_walls: bool,
    pub wealth: f64,
    pub seed: &'a str,
    /// Architecture pack (EUR-MED, AF-MAG, AS-CHI...): flavours landmark massing.
    pub pack: &'a str,
    /// The lot holds the envelope of one of the pack's native court recipes
    /// (resolved by the caller from the houses admission export): only then
    /// is a collective body's (insula's) court reported as a court form, so
    /// the programme never asks the houses side for a court the lot cannot
    /// hold; elsewhere it stays the light court of a row building.
    pub court_lot: bool,
    /// Whether a home's court wish stays a court in the composition
    /// `building_sites` finally asks (feasibility.rs), when it knows; `None`
    /// falls back to `courts::court_kept`, its approximation from the pack.
    pub court_kept: Option<bool>,
}

pub(in super::super) fn kind(o: &Occupancy) -> Kind {
    let m = o.morph;
    let op = m.text("buildingOp");
    let plot = m.text("plotOp");
    let typology = m.value["arch"]["typology"].as_str().unwrap_or("");
    if matches!(o.function, "open_space" | "market" | "common") {
        return Kind::Open;
    }
    let court = matches!(op, "courtyardHouse" | "kancha" | "sahelCompound")
        || typology.contains("courtyard")
        || matches!(typology, "domus" | "calli" | "kancha-house")
        || plot == "courtyard";
    let pavilions = op == "pavilionCompound" || plot == "siheyuan";
    // A camp builds every lot in its own way: the byre, the granary and the
    // council lodge are huts, tents or long houses like the dwellings.
    if !m.text("campLayout").is_empty() {
        match typology {
            "roundhouse" | "ger" | "tipi" | "beehive-hut" | "orc-hut" | "igloo" => {
                return Kind::Round;
            }
            "longhouse" | "maloca" | "plank-house" => return Kind::Long,
            _ => {}
        }
    }
    // A farm is a house, a barn and a yard wherever it stands.
    if o.role.starts_with("dwelling.farm") {
        return Kind::Farm;
    }
    // Programme roles first: inns and cloisters wrap a yard, a town or guild
    // hall keeps the street wall of its square, an elite house gets a court.
    match o.role {
        r if r.starts_with("commerce.inn") || r == "worship.monastery" => return Kind::Court,
        r if r.starts_with("civic.townhall") || r.starts_with("civic.guild") => return Kind::Row,
        // A basilica or a pillared hall is a roofed hall, never a court house.
        r if r.starts_with("civic.basilica") || r.starts_with("civic.hall") => return Kind::Hall,
        r if r.starts_with("dwelling.mansion") && (court || o.party_walls) => return Kind::Court,
        _ => {}
    }
    if o.function == "collective"
        || o.landmark
        || o.role.starts_with("worship")
        || o.role.starts_with("civic")
        || o.role.starts_with("defence")
    {
        return if court || pavilions {
            Kind::Court
        } else {
            Kind::Hall
        };
    }
    if o.function == "warehouse" {
        return Kind::Warehouse;
    }
    if matches!(
        typology,
        "roundhouse"
            | "ger"
            | "tipi"
            | "beehive-hut"
            | "orc-hut"
            | "smial"
            | "tree-house"
            | "igloo"
    ) {
        return Kind::Round;
    }
    if matches!(
        typology,
        "longhouse" | "byre-house" | "stone-hall" | "duergar-hall" | "maloca" | "plank-house"
    ) || matches!(op, "hall" | "duergarHall")
    {
        return Kind::Long;
    }
    // The role chooses before the tissue's form: a court or compound tissue
    // (domus, dar, siheyuan) sets its ordinary court house, not every dwelling.
    if (court || pavilions)
        && let Some(form) = role_form(o)
    {
        return form;
    }
    if pavilions {
        return Kind::Pavilions;
    }
    match op {
        "hanok" => return Kind::Hanok,
        "yashiki" => return Kind::Yashiki,
        _ => {}
    }
    if court {
        return Kind::Court;
    }
    // A village house that is not a farm (artisan, labourer, priest's house)
    // is a detached cottage: farmsteads come from the programme's farm role.
    if o.zone == "village" {
        return Kind::Detached;
    }
    Kind::Row
}

/// Labels of a mosque's covered prayer space (the part its lot must hold): the
/// plain hall and the halls, bays and domed chambers of the cultural forms.
pub(in crate::urban) fn prayer_space(label: &str) -> bool {
    matches!(
        label,
        "prayer-hall" | "prayer-bay" | "prayer-nave" | "mihrab-dome" | "dome-chamber" | "shabestan" | "dome-hall" | "half-dome" | "mud-hall"
    )
}

/// Residential form of an ordinary dwelling role inside a court or compound
/// tissue (CODEX_ROMAN_COURTYARD_REVIEW.md: a Pompeian shop, a simple house
/// and an Ostian insula are not all domus). A shop fronts its street; a
/// tenement is a deep block-front body, around a court only where the lot
/// holds one with whole wings; a house the programme admitted as a simple
/// recipe (`dwelling.house`, not `dwelling.courtyard`) is a simple body. Court
/// roles (`dwelling.courtyard`, mansions, inns, compounds) keep the tissue's
/// form. No quota: the role and the lot decide, the seed only varies details.
fn role_form(o: &Occupancy) -> Option<Kind> {
    let is = |p: &str| {
        o.role == p
            || o.role
                .strip_prefix(p)
                .is_some_and(|rest| rest.starts_with('.'))
    };
    if is("dwelling.tenement") || is("dwelling.insula") {
        Some(Kind::Insula)
    } else if is("dwelling.shop")
        || is("commerce.shop")
        || is("dwelling.house")
        || is("dwelling.row")
        || is("dwelling.townhouse")
        || (o.function == "mixed" && !is("dwelling.courtyard") && !is("dwelling.compound"))
    {
        Some(Kind::Row)
    } else {
        None
    }
}

fn mix(r: [f64; 2], t: f64) -> f64 {
    r[0] + (r[1] - r[0]) * t.clamp(0.0, 1.0)
}
/// A zoned catalogue range, or the fallback when the tissue does not define it
/// (a defined `[0, 0]`, such as a zero side gap, is a real value).
fn zoned(m: &Morph, key: &str, zone: &str, fallback: [f64; 2]) -> [f64; 2] {
    if m.value[key][zone].is_array() {
        m.range(key, zone)
    } else {
        fallback
    }
}

mod frontage;
pub(super) use frontage::{Frame, circle, clip_parts};
use frontage::{frame_of, convex, base, behind_fronts, largest, fit, fit_any, square_enough, front_range, LEAN, square_backed, street_strip, front_range_why};
mod ring_geometry;
use ring_geometry::{smoothed, offset, opened, blunted, blunted_at, clip_inside, inset};
mod legibility;
use legibility::{polygonal, side_wing, lot_frame, inscribed, inscribed_by, open_corners, open_corners_at, legible, frame_along, best_rectangle, natural, squared_bodies, merged, legible_pieces, odd_corners, corners, sharpest, simple};
#[cfg(test)]
use legibility::{rectangular, skew};
pub(super) use legibility::thickness;
mod backs;
use backs::{Piece, Lay, Fill, fill_back};
/// Building footprints of one parcel; empty for open space. Every returned
/// shape lies inside the parcel, is counter-clockwise, and is at least 4 m².
#[cfg(test)]
pub(in super::super) fn preview(p: &Parcel, o: &Occupancy) -> Vec<Shape> {
    preview_parts(p, o).0.into_iter().map(|(s, _)| s).collect()
}

/// Footprints with their part label: `building` for ordinary occupation, the
/// programme part (`nave`, `tower`, `minaret`, `prayer-hall`...) for landmarks,
/// `ruin` for the broken walls of a ruined building; and the form actually
/// built, when there is one. The realized form is what the programme wishes
/// (`programme.composition`): a court or insula whose court does not fit
/// falls back to its street body (`Row`, or `Detached` with side gaps), a
/// compound too small for its pavilions to a row, so the houses side is never
/// asked for a court the lot cannot hold.
pub(in super::super) fn preview_parts(
    p: &Parcel,
    o: &Occupancy,
) -> (Vec<(Shape, &'static str)>, Option<Kind>) {
    preview_parts_resolved(p,o,None)
}

/// Regenerate with the final programme form; never fill or erase preview holes.
pub(in super::super) fn preview_parts_resolved(p:&Parcel,o:&Occupancy,resolved:Option<Kind>)
    -> (Vec<(Shape,&'static str)>,Option<Kind>) {
    let (mut parts, mut form) = preview_form(p, o, resolved);
    let mosque = o.role.starts_with("worship.mosque") || o.role.starts_with("worship.masjid");
    if kind(o) != Kind::Open && (parts.is_empty() || mosque && !parts.iter().any(|(_,label)| prayer_space(label))) {
        // Admission already proved a house fits. Decorative setbacks and wings
        // cannot turn that occupied property (or a reserved monument) vacant.
        let domain = p.envelope.as_ref().unwrap_or(&p.shape);
        let aligned = p.provenance.iter().any(|s| s == "street-aligned-home") && p.front.is_some()
            && !o.landmark && matches!(kind(o), Kind::Row | Kind::Detached | Kind::Farm | Kind::Long);
        let u = unit(if aligned { let [a,b] = p.front.unwrap(); sub(b,a) } else { p.axis });
        let u = if length(u) > 0.5 { u } else { Point { x:1., y:0. } };
        let frames = std::iter::once(u).chain(domain.outer.iter().zip(domain.outer.iter().cycle().skip(1))
            .take(if aligned { 0 } else { domain.outer.len() }).map(|(&a,&b)| unit(sub(b,a))));
        let best = frames.filter(|u| length(*u) > 0.5).filter_map(|u| {
            let f = Frame { u, n:normal(u), t0:0. };
            let r = inscribed(&domain.outer, &f)?;
            Some((f,r,(r[1]-r[0])*(r[3]-r[2])))
        }).max_by(|a,b|a.2.total_cmp(&b.2));
        if let Some((f,[s0,s1,t0,t1],_)) = best {
            let at = |s,t| add(scale(f.u,s),scale(f.n,t));
            let ring = if kind(o) == Kind::Round && !mosque {
                let c = at((s0+s1)*0.5,(t0+t1)*0.5);
                let r = (s1-s0).min(t1-t0)*0.5;
                (0..16).map(|i| { let a = i as f64*std::f64::consts::TAU/16.;
                    Point { x:c.x+r*a.cos(), y:c.y+r*a.sin() } }).collect()
            } else { vec![at(s0,t0),at(s1,t0),at(s1,t1),at(s0,t1)] };
            let label = if mosque { "prayer-hall" } else { "building" };
            let fallback = finish(&p.shape, vec![(ring,None,label)], super::lot_envelopes::MIN_BODY_SIDE);
            if !fallback.is_empty() {
                parts = fallback;
                form = match kind(o) {
                    Kind::Court | Kind::Insula | Kind::Pavilions | Kind::Hanok | Kind::Yashiki => Kind::Row,
                    k => k,
                };
            }
        }
    }
    // `campHouseEnds` (0..1): a camp's long house has rounded gable ends (the
    // Iroquoian barrel-roofed longhouse): the corners become arcs of that
    // fraction of the half-width.
    let ends = if kind(o) == Kind::Long && !o.morph.text("campLayout").is_empty() { o.morph.number("campHouseEnds").clamp(0.0, 1.0) } else { 0.0 };
    if ends > 0.0 { for (shape, label) in parts.iter_mut() { if *label == "building" { if let Some(r) = rounded_ends(&shape.outer, ends) { shape.outer = r; } } } }
    // An empty building reads its settlement's decay (ruins.rs).
    let parts = super::ruins::decayed(p, o, parts);
    let form = (!parts.is_empty()).then_some(form);
    (parts, form)
}

/// Why a lot whose preview came back empty holds no building, for the caller
/// to report with it; `None` for open space, which is empty by programme.
/// Read from the lot alone, without laying its form again:
/// - `too-small`: the lot is under one body (a wing by a wing);
/// - `no-rectangle`: no rectangle a wing wide and deep fits it, along its
///   front, its axis or its longest side;
/// - `court-only`: the rectangle it holds stands on its reserved court
///   (the lot's holes), which stays unbuilt;
/// - `no-fit`: it holds a body, but no piece of its form fits the ground
///   its setback and side gaps leave.
pub(in super::super) fn empty_reason(p: &Parcel, o: &Occupancy) -> Option<&'static str> {
    if kind(o) == Kind::Open {
        return None;
    }
    let wing = o.morph.number_or("minWing", 3.0).max(3.0);
    if p.shape.outer.len() < 3 {
        return Some("too-small");
    }
    let shape = super::super::geometry::normalized(p.shape.clone());
    let ring = &shape.outer;
    if ring_area(ring).abs() < wing * wing {
        return Some("too-small");
    }
    let n = ring.len();
    let longest = (0..n)
        .map(|i| sub(ring[(i + 1) % n], ring[i]))
        .max_by(|a, b| length(*a).total_cmp(&length(*b)));
    let body = p
        .front
        .map(|[a, b]| sub(b, a))
        .into_iter()
        .chain([p.axis])
        .chain(longest)
        .filter(|d| length(*d) > 0.5)
        .map(frame_along)
        .find_map(|f| {
            let whole = |w: f64, d: f64| if w.min(d) >= wing - 1e-6 { w * d } else { 0.0 };
            let r = inscribed_by(ring, &f, &whole)?;
            (whole(r[1] - r[0], r[3] - r[2]) > 0.0).then(|| {
                let at = |s: f64, t: f64| add(scale(f.u, s), scale(f.n, t));
                Shape {
                    outer: vec![at(r[0], r[2]), at(r[1], r[2]), at(r[1], r[3]), at(r[0], r[3])],
                    holes: vec![],
                }
            })
        });
    let Some(body) = body else {
        return Some("no-rectangle");
    };
    let reserved: f64 = shape
        .holes
        .iter()
        .filter(|h| h.len() >= 3 && ring_area(h).abs() >= 0.5)
        .flat_map(|h| {
            intersection(
                &Shape {
                    outer: h.clone(),
                    holes: vec![],
                },
                &body,
            )
        })
        .map(|s| area(&s))
        .sum();
    Some(if reserved > 0.5 * area(&body) {
        "court-only"
    } else {
        "no-fit"
    })
}

/// A rectangle (4 corners, aspect >= 2.5) with its corners rounded to `frac`
/// of the half-width: the plan of a long house with rounded ends.
fn rounded_ends(ring: &[Point], frac: f64) -> Option<Vec<Point>> {
    if ring.len() != 4 { return None; }
    let (e0, e1) = (sub(ring[1], ring[0]), sub(ring[2], ring[1]));
    let (l0, l1) = (length(e0), length(e1));
    let (long, short, u) = if l0 >= l1 { (l0, l1, unit(e0)) } else { (l1, l0, unit(e1)) };
    if short < 2.0 || long < 2.5 * short { return None; }
    let n = normal(u);
    let c = scale(add(add(ring[0], ring[1]), add(ring[2], ring[3])), 0.25);
    let (hl, hw) = (long * 0.5, short * 0.5);
    let r = (frac * hw).min(hw).max(0.3);
    let mut out = vec![];
    // Counter-clockwise corners of the local frame, each an arc of 6 steps.
    for (cs, ct, a0) in [(hl - r, -(hw - r), -90.0_f64), (hl - r, hw - r, 0.0), (-(hl - r), hw - r, 90.0), (-(hl - r), -(hw - r), 180.0)] {
        for k in 0..=6 {
            let a = (a0 + 90.0 * k as f64 / 6.0).to_radians();
            let (ls, lt) = (cs + r * a.cos(), ct + r * a.sin());
            out.push(add(c, add(scale(u, ls), scale(n, lt))));
        }
    }
    let signed = |q: &[Point]| (0..q.len()).map(|i| { let (a, b) = (q[i], q[(i + 1) % q.len()]); a.x * b.y - b.x * a.y }).sum::<f64>();
    if signed(&out) * signed(ring) < 0.0 { out.reverse(); }
    Some(out)
}

fn round_samples(bounds: (f64, f64, f64, f64), step: f64) -> Vec<Point> {
    // Ordinary lots keep their original ~600-point lattice, including its
    // addition order. Clipped diagonal slivers must not scan millions of cells.
    super::super::generation_limits::samples(bounds, step, 1024)
}

/// The occupation of one lot: the lot read once (`Site`), a monument whole in
/// its precinct, else the domain its form composes on and the form itself,
/// then the legibility passes, the back fill and the polygonal fallback. Each
/// step reads explicit inputs and returns its pieces; each draws from its own
/// stream forked from the lot's seed by a stable label, so adding, removing or
/// reordering a form never shifts another's draws.
fn preview_form(p: &Parcel, o: &Occupancy, resolved: Option<Kind>) -> (Vec<(Shape, &'static str)>, Kind) {
    let lot = match Site::new(p, o, resolved) {
        Ok(lot) => lot,
        Err(kind) => return (vec![], kind),
    };
    if let Some(done) = landmark(&lot, o) {
        return (done, lot.kind);
    }
    let Some(d) = Domain::new(&lot, o) else {
        return (vec![], lot.kind);
    };
    // The form reported to the programme: the wished one unless the lot
    // forces a fallback (a court or compound that does not fit).
    let (pieces, form) = match lot.kind {
        Kind::Open => (vec![], lot.wish),
        Kind::Row => (row(&lot, &d, o, lot.depth, o.function == "workshop"), lot.wish),
        Kind::Warehouse => (warehouse(&lot, &d), lot.wish),
        Kind::Detached | Kind::Farm | Kind::Long => (home(&lot, &d, o), lot.wish),
        Kind::Round => (round(&lot, &d), lot.wish),
        Kind::Court | Kind::Insula => court(&lot, &d, o),
        Kind::Hall => (hall(&lot, &d, o), lot.wish),
        Kind::Pavilions => pavilions(&lot, &d, o),
        Kind::Hanok => (hanok(&lot, &d), lot.wish),
        Kind::Yashiki => (yashiki(&lot, &d), lot.wish),
    };
    let (kind, main, lf, wing, attached) = (lot.kind, lot.main, d.lf, lot.wing, lot.attached);
    let absorb = attached && matches!(kind, Kind::Row | Kind::Insula | Kind::Court | Kind::Warehouse);
    let pieces = if kind == Kind::Round {
        pieces
    } else {
        legible_pieces(pieces, &d.b, &[main, lf], wing, absorb, attached, &lot.fronts)
    };
    // Ordinary bodies only: round and long houses, sheds and camp pieces keep
    // their own shapes (landmark parts never come here).
    let pieces = if matches!(kind, Kind::Round | Kind::Long | Kind::Warehouse) || !o.morph.text("campLayout").is_empty() {
        pieces
    } else {
        squared_bodies(pieces, &[main, lf], wing, attached)
    };
    let pieces = back_filled(&lot, &d, o, form, pieces);
    let built = finish(&lot.shape, ruined(o, pieces, &lot.seed), wing);
    if !built.is_empty() || kind == Kind::Round {
        return (built, form);
    }
    // Invariant (« un lot attribué porte un bâtiment »): where no square body,
    // legible range or court fits, an odd-shaped lot still builds its
    // polygonal body: its street strip (the whole lot without a street) opened
    // by the body width, so a lot that holds a body never stays empty.
    // Such a body stays where its corners are open and it reads as a building
    // (`natural`); any other gives way to the largest rectangle it holds,
    // and stays only where it holds none.
    let to = (lot.ta - main.t0) + lot.depth.max(wing);
    let parts: Vec<Piece> = polygonal(&d.b, lot.street_runs.first().map(Vec::as_slice), main.n, to, wing)
        .into_iter()
        .map(|r| {
            if open_corners_at(&r, &lot.fronts) && natural(&r) {
                r
            } else {
                best_rectangle(&r, &[main, lf], wing).unwrap_or(r)
            }
        })
        .map(|r| (r, None, "building"))
        .collect();
    let form = match form {
        Kind::Court | Kind::Insula | Kind::Pavilions | Kind::Hanok | Kind::Yashiki => Kind::Row,
        f => f,
    };
    (finish(&lot.shape, ruined(o, parts, &lot.seed), wing), form)
}

/// The lot as every form reads it, decided once and never mutated: its shape,
/// street fronts and frames, its buildable ground, and the tissue numbers
/// drawn for it. Those come from the lot's `occupation` stream in a fixed
/// order whatever the form; the forms fork their own streams from `seed`.
struct Site {
    /// The lot's seed stream (`Rng::new(lot id)`): only ever forked.
    seed: Rng,
    /// The form laid: the wish, a spaced row laid as detached houses.
    kind: Kind,
    /// The form reported to the programme unless the lot forces a fallback.
    wish: Kind,
    /// A court home previewed as its street house keeps a closed back court.
    court_wish: bool,
    resolved: Option<Kind>,
    shape: Shape,
    total: f64,
    fronts: Vec<Front>,
    /// Street runs, the lot's long sides first.
    street_runs: Vec<Vec<Front>>,
    frames: Vec<Frame>,
    main: Frame,
    /// Opposite (through-lot) or angled (corner) second frontage.
    second_i: Option<usize>,
    second: Option<Frame>,
    /// The whole buildable ground of the lot (setback and side gaps left
    /// out), and its `s0, s1, t1` in the main frame.
    ground: Vec<Point>,
    extent: (f64, f64, f64),
    /// The street wall level behind the setback, and behind a bowed front.
    ta: f64,
    tf: f64,
    /// Mid-frontage station: the anchor every body is fitted around.
    anchor: f64,
    walled: bool,
    aligned: bool,
    collective: bool,
    bounded: bool,
    attached: bool,
    pressure: f64,
    coverage: f64,
    setback: f64,
    depth: f64,
    build_depth: [f64; 2],
    rooms: [f64; 2],
    room: f64,
    wing: f64,
    court_wing: f64,
}

impl Site {
    /// The lot read for its form; `Err` with the form when it builds nothing.
    fn new(p: &Parcel, o: &Occupancy, resolved: Option<Kind>) -> Result<Self, Kind> {
        let seed = Rng::new(o.seed);
        let mut rng = seed.fork("occupation");
        let kind = resolved.unwrap_or_else(|| kind(o));
        // Invariant (preview = asked composition): a home's court is previewed
        // only on a lot that holds one of the pack's native court sources; else
        // `building_sites` (feasibility.rs) asks another composition, so the lot
        // previews its street house, the simple form that request keeps.
        // It keeps its court as a row's closed back court (Hof, cortile) where
        // the wings fit: the light court of a row building, as an insula's.
        let court_wish = kind == Kind::Court;
        let kind = if court_wish
            && matches!(o.function, "domestic" | "mixed")
            && !o.landmark
            && !o
                .court_kept
                .unwrap_or_else(|| super::courts::court_kept(p, o.pack, o.role, o.function))
        {
            Kind::Row
        } else {
            kind
        };
        if kind == Kind::Open || p.shape.outer.len() < 3 {
            return Err(kind);
        }
        let shape = super::super::geometry::normalized(p.shape.clone());
        let ring = &shape.outer;
        let total = area(&shape);
        let m = o.morph;
        let zone = o.zone;
        let pressure = p.pressure.clamp(0.0, 1.0);
        let fronts: Vec<Front> = parcel_fronts(p)
            .into_iter()
            .filter(|f| length(sub(f.b, f.a)) > 0.3)
            .collect();
        let mut street_runs: Vec<Vec<Front>> = runs(&fronts)
            .into_iter()
            .filter(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
            .collect();
        // Invariant (« le grand côté, pas le petit »): the house fronts its
        // lot's long side. A run under `LONG_SIDE` of the longest one is a short
        // end of the lot, whatever its street's rank: it never sets the main
        // frame (review series 2 P10 42, P19 24; series 3 P04 longhouses). The
        // cadastral order (`runs`) is kept among the long sides.
        {
            const LONG_SIDE: f64 = 0.6;
            let span = |r: &Vec<Front>| r.iter().map(|f| length(sub(f.b, f.a))).sum::<f64>();
            let longest = street_runs.iter().map(span).fold(0.0, f64::max);
            street_runs.sort_by_key(|r| span(r) < LONG_SIDE * longest);
        }
        let mut frames: Vec<Frame> = street_runs.iter().map(|r| frame_of(r, &shape)).collect();
        if frames.is_empty() {
            let u = unit(p.axis);
            let u = if length(u) < 0.5 { Point { x: 1.0, y: 0.0 } } else { u };
            let mut f = Frame { u, n: normal(u), t0: 0.0 };
            f.t0 = f.range(ring).2;
            frames.push(f);
        }
        let disorder = m.number("disorder").clamp(0.0, 1.0);
        if disorder > 0.0 && !o.landmark {
            let a = rng.fork("disorder-angle").range(-0.38, 0.38) * disorder;
            for f in &mut frames {
                f.u = Point { x: f.u.x * a.cos() - f.u.y * a.sin(), y: f.u.x * a.sin() + f.u.y * a.cos() };
                f.n = normal(f.u);
                f.t0 = f.range(ring).2;
            }
        }
        let main = frames[0];
        let walled = p.provenance.iter().any(|x| x == "curtain-backed");
        let second_i = (1..frames.len()).find(|&i| dot(frames[i].n, main.n) < 0.82);
        let second = second_i.map(|i| frames[i]);
        let planned = m.text("streetOp") == "grid";
        // Setbacks, side gaps and range depths follow the same access gradient
        // as lot sizes and coverage: attached rows thin out into detached houses
        // with growing gaps and yards, never by zone steps.
        let zoned = |m: &Morph, key: &str, zone: &str, fallback: [f64; 2]| {
            super::pressure::graded(m, key, zone, pressure, planned).unwrap_or_else(|| zoned(m, key, zone, fallback))
        };
        let coverage = {
            let r = super::pressure::adjusted(m, "coverage", zone, pressure, planned, 0.62, 1.03);
            let r = if m.value["coverage"][zone].is_array() { r } else { [0.5, 0.7] };
            let coverage = mix(r, rng.float()).clamp(0.08, 0.97);
            if disorder > 0.0 && !o.landmark {
                (coverage * rng.fork("disorder-size").range(1.0 - 0.7 * disorder, 1.0 + 0.3 * disorder)).clamp(0.08, 0.97)
            } else {
                coverage
            }
        };
        let setback = match kind {
            Kind::Row | Kind::Warehouse | Kind::Court | Kind::Insula | Kind::Pavilions => mix(zoned(m, "setback", zone, [0.0, 0.5]), rng.float() * 0.5),
            _ => mix(zoned(m, "setback", zone, [0.5, 3.0]), rng.float()).max(0.5),
        };
        let gaps = zoned(m, "sideGap", zone, [0.0, 1.0]);
        let side_gap = mix(gaps, rng.float());
        // Party walls: zero gap where the recipe or the tissue builds them (a zero
        // minimum side gap: souks, medina dars, burgage cores) and the drawn gap is
        // small; otherwise a real side passage (at least 0.8 m).
        let party = o.party_walls || gaps[0] <= 0.0;
        // Side gaps only space a row: the wish stays `Row`, as the houses side
        // reads street continuity separately.
        let wish = kind;
        let kind = if kind == Kind::Row && (!party || side_gap >= 0.6) { Kind::Detached } else { kind };
        let attached = matches!(kind, Kind::Row | Kind::Warehouse | Kind::Court | Kind::Insula | Kind::Pavilions) && party;
        let gap = if attached { 0.0 } else { side_gap.max(0.8) };
        // One street-range depth per block, each lot varying a little around it:
        // the rear walls of a block face line up instead of zigzagging lot by lot.
        let block_draw = o.seed.rsplit_once("/parcel-").map(|(block, _)| Rng::new(block).fork("street-range-depth").float());
        let own = rng.float();
        let build_depth = zoned(m, "buildDepth", zone, [8.0, 12.0]);
        let depth = mix(build_depth, block_draw.map_or(own, |b| 0.8 * b + 0.2 * own)) * (0.9 + 0.15 * pressure + 0.1 * o.wealth);
        // Minimum body/wing width (culture value, at least 3 m) and court wing.
        let rooms = if m.value["roomDepth"].is_array() { m.pair("roomDepth") } else { [4.5, 6.0] };
        let room = mix(rooms, rng.float());
        let wing = m.number_or("minWing", 3.0).max(3.0);
        let court_wing = (rooms[0] * 0.8).clamp(3.5, 6.0).max(wing);
        let used: Vec<Frame> = std::iter::once(main).chain(second).collect();
        let b = largest(base(ring, &fronts, &used, setback, gap));
        // A concave lot whose frame half-planes cut most of it away keeps its own
        // shape behind a setback strip along each front instead.
        let b = if ring_area(&b).abs() < 0.6 * total {
            let own = behind_fronts(ring, &fronts, setback);
            if ring_area(&own).abs() > ring_area(&b).abs() { own } else { b }
        } else {
            b
        };
        if b.len() < 3 || ring_area(&b) < 4.0 {
            return Err(kind);
        }
        let (s0, s1, _, t1) = main.range(&b);
        let ta = main.t0 + setback;
        let anchor = fronts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), main.u).abs() > 0.7)
            .max_by(|x, y| length(sub(x.b, x.a)).total_cmp(&length(sub(y.b, y.a))))
            .map_or((s0 + s1) * 0.5, |f| main.s(scale(add(f.a, f.b), 0.5)))
            .clamp(s0, s1);
        // The street wall stands where the frontage is fully inside the lot: on a
        // bowed or oblique front a square body starts behind its deepest point.
        let sag = fronts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), main.u).abs() > 0.9 && main.t(f.a) - main.t0 < 6.0)
            .flat_map(|f| [main.t(f.a), main.t(f.b)])
            .fold(main.t0, f64::max)
            - main.t0;
        let tf = ta + sag.min(3.0);
        // A house never spreads over an oversized lot: courtyard houses, hanok and
        // yashiki keep a bounded domain at the street and leave the rest as garden.
        let collective = o.function == "collective" || o.landmark || o.role.starts_with("dwelling.mansion") || o.role.starts_with("commerce.inn");
        // A paired court lot is cut to its court house (`pair_courts`): it is
        // the house's own domain, not an oversized lot to leave as garden.
        let paired = p.provenance.iter().any(|x| x == "court-pair");
        let bounded = matches!(kind, Kind::Hanok | Kind::Yashiki) || (kind == Kind::Court && !collective && !paired);
        let aligned = p.provenance.iter().any(|s| s == "street-aligned-home");
        Ok(Site {
            seed,
            kind,
            wish,
            court_wish,
            resolved,
            total,
            fronts,
            street_runs,
            frames,
            main,
            second_i,
            second,
            ground: b,
            extent: (s0, s1, t1),
            ta,
            tf,
            anchor,
            walled,
            aligned,
            collective,
            bounded,
            attached,
            pressure,
            coverage,
            setback,
            depth,
            build_depth,
            rooms,
            room,
            wing,
            court_wing,
            shape,
        })
    }

    /// An empty layout of pieces on `d` in the main frame.
    fn lay<'a>(&'a self, d: &'a Domain) -> Lay<'a> {
        Lay { b: &d.b, fronts: &self.fronts, f: self.main, wing: self.wing, pieces: vec![] }
    }
}

/// The ground a form composes on: the lot's buildable ground, or the box a
/// bounded house keeps of it at the street (the rest stays garden for the back
/// fill), with its range in the main frame and the lot's own frame.
struct Domain<'a> {
    b: Cow<'a, [Point]>,
    s0: f64,
    s1: f64,
    t1: f64,
    width: f64,
    plot_depth: f64,
    anchor: f64,
    /// The lot's own frame (depth along its side walls), the street's where
    /// they stand square to it within 2 degrees.
    lf: Frame,
}

impl<'a> Domain<'a> {
    fn new(lot: &'a Site, o: &Occupancy) -> Option<Self> {
        let (s0, s1, t1) = lot.extent;
        let (main, ta) = (lot.main, lot.ta);
        let mut b = Cow::Borrowed(lot.ground.as_slice());
        if lot.bounded {
            // Its own stream: the box never shifts the form's draws.
            let mut rng = lot.seed.fork("occupation-box");
            let (w, d) = (rng.range(16.0, 28.0) * (0.85 + 0.3 * o.wealth), rng.range(18.0, 32.0) * (0.85 + 0.3 * o.wealth));
            if s1 - s0 > w * 1.2 || t1 - ta > d * 1.2 {
                let x = s0 + (s1 - s0 - w).max(0.0) * rng.float();
                b = Cow::Owned(largest(clip_parts(&lot.ground, &main.rect(x, x + w, ta - 1.0, ta + d))));
            }
        }
        if b.len() < 3 || ring_area(&b) < 4.0 {
            return None;
        }
        let (s0, s1, _, t1) = main.range(&b);
        let lf = {
            let f = lot_frame(&b, &main, &lot.fronts);
            if dot(f.n, main.n) < LEAN { f } else { main }
        };
        Some(Domain { s0, s1, t1, width: s1 - s0, plot_depth: t1 - ta, anchor: lot.anchor.clamp(s0, s1), lf, b })
    }
}

/// A monument stands whole in its precinct (« sens de l'implantation »):
/// the largest rectangle of the lot facing one of its streets or along
/// its sides (the main street and the lot's own frame unless another holds
/// a tenth more), its parts composed inside, so the lot never cuts a room
/// or a range obliquely. A programme scaled to its lot (a Friday mosque,
/// a cloister) that the precinct would shrink below three fifths keeps its
/// massing in the lot itself: odd-shaped precincts are common in towns.
/// A fortress is a closed circuit and never does: cut by the lot it keeps a
/// few stretches of wall around nothing. Its precinct is the squarest one
/// (a long strip would hold only a lone keep), at most half as long again.
/// `None` where the role has no massing or nothing of it stands: the lot
/// then takes its ordinary occupation.
fn landmark(lot: &Site, o: &Occupancy) -> Option<Vec<(Shape, &'static str)>> {
    let (main, b, wing) = (lot.main, lot.ground.as_slice(), lot.wing);
    let (s0, s1, t1) = lot.extent;
    let circuit = o.role.starts_with("defence.");
    // Its own stream, the same for the lot and the precinct massing.
    const STREAM: &str = "occupation-landmark";
    let in_lot = super::landmark::massing(o, b, main, (s0, s1, lot.ta, t1), &mut lot.seed.fork(STREAM))?;
    let mosque = o.role.starts_with("worship.mosque") || o.role.starts_with("worship.masjid");
    let built = |parts: &[Piece]| parts.iter().filter(|(_, _, label)| !mosque || prayer_space(label)).map(|(r, _, _)| ring_area(r).abs()).sum::<f64>();
    let own = lot_frame(b, &main, &lot.fronts);
    let precinct = std::iter::once(own)
        .chain(lot.frames.iter().copied())
        .enumerate()
        .filter_map(|(i, f)| {
            let squarest = |w: f64, d: f64| w.min(d) * w.max(d).min(1.5 * w.min(d));
            let r = if circuit { inscribed_by(b, &f, squarest)? } else { inscribed(b, &f)? };
            let v = if circuit { squarest(r[1] - r[0], r[3] - r[2]) } else { (r[1] - r[0]) * (r[3] - r[2]) } * if i <= 1 { 1.1 } else { 1.0 };
            Some((f, r, v))
        })
        .max_by(|x, y| x.2.total_cmp(&y.2));
    let parts = precinct.and_then(|(f, r, _)| {
        let at = |s: f64, t: f64| add(scale(f.u, s), scale(f.n, t));
        let rect = vec![at(r[0], r[2]), at(r[1], r[2]), at(r[1], r[3]), at(r[0], r[3])];
        super::landmark::massing(o, &rect, f, (r[0], r[1], r[2], r[3]), &mut lot.seed.fork(STREAM))
    });
    // The precinct holds no such monument: the massing in the lot itself.
    let parts = match parts {
        Some(parts) if built(&parts) >= 4.0 && (circuit || built(&parts) >= 0.6 * built(&in_lot)) => parts,
        Some(parts) if built(&in_lot) < 4.0 => parts,
        _ => in_lot,
    };
    let done = finish(&lot.shape, ruined(o, parts, &lot.seed), wing);
    (!done.is_empty() && (!mosque || done.iter().any(|(_, label)| prayer_space(label)))).then_some(done)
}

/// A row's street range along its frontage, then the back of its lot (wings,
/// back house, back-lot workshop), or one piece around a closed back court;
/// also the fallback of courts and compounds the lot cannot hold. `depth` is
/// the street range's depth.
fn row(lot: &Site, d: &Domain, o: &Occupancy, depth: f64, workshop: bool) -> Vec<Piece> {
    let mut rng = lot.seed.fork("form-row");
    let mut lay = lot.lay(d);
    let (main, lf, second, second_i, street_runs) = (lot.main, d.lf, lot.second, lot.second_i, &lot.street_runs);
    let (s0, s1, t1, width, plot_depth, anchor) = (d.s0, d.s1, d.t1, d.width, d.plot_depth, d.anchor);
    let (ta, tf, wing, court_wing, rooms, room) = (lot.ta, lot.tf, lot.wing, lot.court_wing, lot.rooms, lot.room);
    let (coverage, setback, pressure, attached, walled, court_wish) = (lot.coverage, lot.setback, lot.pressure, lot.attached, lot.walled, lot.court_wish);
    let zone = o.zone;
    let front_end = ta + depth.min(plot_depth);
    let target = coverage * lot.total;
    // Dense cores also build the closed back court (Hof, cortile): street
    // range, two side wings on the party walls and a rear range around a
    // light court, wherever every wing keeps the culture's width and the
    // court is at least 3 m wide and 12 m². One piece with its court as a
    // hole.
    if !matches!(lot.resolved, Some(Kind::Row | Kind::Detached))
        && second.is_none()
        && (court_wish || (coverage >= 0.6 && (zone == "core" || pressure >= 0.6) && rng.chance(0.35 + 0.3 * coverage.min(1.0))))
    {
        // A former court house keeps a one-room rear range.
        let rear = if court_wish { court_wing.max(depth * 0.4) } else { wing.max(depth * 0.6) }.min(depth);
        let court_w = width - 2.0 * wing;
        // The court shortens to the lot's depth, never below 3.5 m.
        let court_d = (court_w * rng.range(0.8, 1.4)).clamp(3.5, 14.0).min(t1 - 0.5 - front_end - rear);
        let end = front_end + court_d + rear;
        if court_w >= 3.0 && court_d >= 3.5 && court_w * court_d >= 12.0 && end <= t1 - 0.5 + 1e-9 {
            let outer = lay.rect([s0, s1, tf, end]);
            let outer_shape = Shape { outer: outer.clone(), holes: vec![] };
            let corner = add(scale(main.u, s0), scale(main.n, tf));
            let court = [s0 + wing, s1 - wing, front_end, front_end + court_d];
            let fits = super::lot_envelopes::rect_within(&Shape { outer: lay.b.to_vec(), holes: vec![] }, corner, main.u, main.n, s1 - s0, end - tf)
                && super::lot_envelopes::rect_within(
                    &outer_shape,
                    add(scale(main.u, court[0] - wing), scale(main.n, court[2] - wing)),
                    main.u,
                    main.n,
                    court[1] - court[0] + 2.0 * wing,
                    court[3] - court[2] + 2.0 * wing,
                );
            if fits && front_end - tf >= wing {
                lay.pieces.push((outer, Some(lay.rect(court)), "building"));
                return lay.pieces;
            }
            // Attached rows on oblique lots: the outer mass is the lot's
            // street range down to the rear range (party walls kept), the
            // court that range inset by the wing width between the street
            // and rear ranges: its walls run along the party walls and
            // the street (« même orientation que la maison »).
            let ranged = attached.then(|| street_runs.first()).flatten().and_then(|run| front_range(lay.b, run, main.n, end - main.t0, wing, lay.fronts));
            if let Some(outer) = ranged
                && front_end - tf >= court_wing
                && rear >= court_wing
                && let Some(inner) = inset(&outer, court_wing)
            {
                let court = dedup(clip(&inner, &[main.above(front_end), main.below(front_end + court_d)]));
                if court.len() >= 3 && ring_area(&court).abs() >= 12.0 && thickness(&court, None) >= 3.0 {
                    lay.pieces.push((outer, Some(court), "building"));
                    return lay.pieces;
                }
            }
        }
    }
    // Invariant (« mitoyenneté continue »): an attached row builds its
    // street range along the whole frontage, party wall to party wall.
    // Its back wall is square to the lot's own side walls (« tu suis la
    // rue et tu prends la perpendiculaire à la parcelle pour le mur de
    // derrière », P22): the line the rear pieces then align on.
    let to = front_end - main.t0;
    let range = attached
        .then(|| street_runs.first())
        .flatten()
        .and_then(|run| square_backed(lay.b, run, &main, &lf, to, wing, lay.fronts).or_else(|| front_range(lay.b, run, main.n, to, wing, lay.fronts)));
    let mut rear_from = front_end;
    let mut range_i = None;
    let mut covered = match range.or_else(|| lay.band(ta, front_end)) {
        Some(part) => {
            let a = ring_area(&part).abs();
            rear_from = part.iter().map(|&q| main.t(q)).fold(front_end, f64::max);
            range_i = Some(lay.pieces.len());
            lay.pieces.push((part, None, "building"));
            a
        }
        // A street body square to the street or to the lot's sides,
        // whichever holds more (P10 8: « coller au bloc »).
        None => {
            let t = front_end.max(tf + wing);
            let along = lay.place(s0, s1, tf, t, anchor).map(|r| lay.rect(r));
            let across = (dot(lf.n, main.n) < LEAN).then(|| {
                let saved = std::mem::replace(&mut lay.f, lf);
                let (ls0, ls1, lt0, _) = lf.range(lay.b);
                let mid = lf.s(add(scale(main.u, anchor), scale(main.n, tf)));
                let r = lay.place(ls0, ls1, lt0, lt0 + (t - ta), mid).map(|r| lay.rect(r));
                lay.f = saved;
                r
            });
            let size = |r: &Option<Vec<Point>>| r.as_ref().map_or(0.0, |r| ring_area(r).abs());
            let best = match across.flatten() {
                Some(r) if ring_area(&r).abs() > 1.1 * size(&along) => Some(r),
                _ => along,
            };
            // An odd lot whose street strip holds a body once its thin
            // arms are opened away, where the square body would be a
            // sliver of a house (P04 55); a decent square body stays.
            let sliver = best.as_ref().is_none_or(|r| thickness(r, None) < 2.0 * wing);
            let odd = street_runs.first().filter(|_| sliver).map(|run| largest(polygonal(lay.b, Some(run.as_slice()), main.n, to, wing)));
            let best = match odd {
                Some(r) if r.len() >= 3 && ring_area(&r).abs() > 1.4 * size(&best) && open_corners_at(&r, lay.fronts) => Some(r),
                _ => best,
            };
            best.map_or(0.0, |r| {
                let a = ring_area(&r).abs();
                range_i = Some(lay.pieces.len());
                lay.pieces.push((r, None, "building"));
                a
            })
        }
    };
    if let Some(f) = second {
        let opposite = dot(f.n, main.n) < -0.8;
        if opposite {
            // Through-lot: a rear house on the back street, a full room
            // deep behind a 2.5 m yard; on a shorter tail the house runs
            // through to the back street (no strip of a house).
            let start = (t1 - depth * 0.8).max(rear_from + 2.5);
            let start = if t1 - start >= rooms[1] {
                start
            } else if t1 - rear_from >= rooms[1] + 2.5 {
                t1 - rooms[1]
            } else {
                rear_from
            };
            // A yard under 4 m between the two houses is no yard (P28
            // 8): the back-street house becomes the street house's
            // return wing along one party wall, one pseudo-L whose yard
            // opens beside the wing.
            let (_, _, _, lt1) = lf.range(lay.b);
            let rear_l = range_i.map_or(f64::INFINITY, |i| lay.pieces[i].0.iter().map(|&q| lf.t(q)).fold(f64::NEG_INFINITY, f64::max));
            let left = lot.seed.fork("occupation-through").chance(0.5);
            let w = (0.45 * width).max(wing).min((width - 4.0).max(wing));
            let l = (start > rear_from + 1e-6 && start - rear_from < 4.0)
                .then(|| side_wing(lay.b, &lf, lay.fronts, left, w, rear_l, lt1 + 1.0, wing))
                .flatten()
                .zip(range_i)
                .and_then(|(r, i)| merged(&lay.pieces[i], &r).map(|m| (i, m)));
            match l {
                Some((i, m)) => {
                    covered += ring_area(&m).abs() - ring_area(&lay.pieces[i].0).abs();
                    lay.pieces[i].0 = m;
                }
                // The rear house fronts its own street: its range there,
                // else a body square to that street (P05: never a house
                // askew in the back arm of an odd lot).
                None => {
                    let d = t1 - start;
                    let clear = |pieces: &[Piece], r: &[Point]| {
                        let r = Shape { outer: r.to_vec(), holes: vec![] };
                        pieces.iter().all(|(q, _, _)| {
                            let q = Shape { outer: q.clone(), holes: vec![] };
                            intersection(&q, &r).iter().map(area).sum::<f64>() < 0.5
                        })
                    };
                    let back = second_i
                        .and_then(|i| street_runs.get(i))
                        .and_then(|run| front_range(lay.b, run, f.n, setback + d, wing, lay.fronts).filter(|r| clear(&lay.pieces, r)));
                    covered += match back {
                        Some(r) => {
                            let a = ring_area(&r).abs();
                            lay.pieces.push((r, None, "building"));
                            a
                        }
                        None => {
                            let saved = std::mem::replace(&mut lay.f, f);
                            let (fs0, fs1, ft0, _) = f.range(lay.b);
                            let mid = f.s(add(scale(main.u, anchor), scale(main.n, t1)));
                            let n = lay.pieces.len();
                            let mut a = lay.body(fs0, fs1, ft0 + setback, ft0 + setback + d, mid);
                            lay.f = saved;
                            if a > 0.0 && !clear(&lay.pieces[..n], &lay.pieces[n].0) {
                                lay.pieces.truncate(n);
                                a = 0.0;
                            }
                            if a > 0.0 { a } else { lay.body(s0, s1, start, t1, anchor) }
                        }
                    };
                }
            }
        } else {
            // Corner: the side street builds its own street range behind
            // the main one, both following their streets and meeting on
            // the main range's back wall (an L), else an L square in the
            // main frame.
            // Beside it no strip thinner than a yard (P01 9): on a lot
            // under 10 m wide the side range takes the whole width.
            let d2 = if width * 0.4 < 4.0 { width + 1.0 } else { depth.min(width * 0.6) };
            let end = (rear_from + 2.0 * depth).min(t1);
            // The side range starts on the main range's own back wall
            // (square to the lot's sides, or along the street), not on
            // the frame level through its deepest corner: no wedge of
            // yard is left between the two ranges (P25 7).
            let behind = range_i.map(|i| {
                let r = &lay.pieces[i].0;
                let near = r.iter().map(|&q| main.t(q)).fold(f64::INFINITY, f64::min);
                let range = Shape { outer: r.clone(), holes: vec![] };
                clip_parts(lay.b, &[main.above(near), main.below(end)])
                    .into_iter()
                    .flat_map(|g| difference(&Shape { outer: g, holes: vec![] }, &range))
                    .filter(|s| s.holes.is_empty())
                    .map(|s| dedup(s.outer))
                    .collect::<Vec<_>>()
            });
            let plain = largest(clip_parts(lay.b, &[main.above(rear_from), main.below(end)]));
            let back = behind.map(largest).filter(|r| r.len() >= 3 && simple(r));
            let side_of = |back: &[Point]| {
                second_i
                    .and_then(|i| street_runs.get(i))
                    .filter(|_| attached && back.len() >= 3)
                    .and_then(|run| front_range_why(back, run, f.n, setback + d2, wing, false, lay.fronts).ok())
            };
            // Started on the back wall only where the side range keeps
            // as few corners, none further from square, as started on
            // the frame level: never a polygon chasing the lot's bends.
            let plain_side = side_of(&plain);
            let side = match back.as_deref().and_then(side_of) {
                Some(r)
                    if match &plain_side {
                        Some(p) => corners(&r) <= corners(p) && odd_corners(&r) <= odd_corners(p),
                        None => odd_corners(&r) == 0,
                    } =>
                {
                    Some(r)
                }
                _ => plain_side,
            };
            let (lo, hi) = if dot(f.n, main.u) < 0.0 { (s1 - d2, s1) } else { (s0, s0 + d2) };
            let square = lay.place(lo, hi, rear_from, end, (lo + hi) * 0.5).map(|r| lay.rect(r));
            // A side street touching only part of the lot's side keeps
            // the longer L square in the main frame.
            let part = match (side, square) {
                (Some(a), Some(b)) if ring_area(&a).abs() < 0.6 * ring_area(&b).abs() => Some(b),
                (a, b) => a.or(b),
            };
            // The lot band itself where it holds more: a narrow corner
            // lot built from wall to wall (« un peu en angle ouvert »).
            let size = |r: &Option<Vec<Point>>| r.as_ref().map_or(0.0, |r| ring_area(r).abs());
            let part = match lay.band(rear_from, end) {
                Some(r) if ring_area(&r).abs() > 1.1 * size(&part) => Some(r),
                _ => part,
            };
            if let Some(part) = part {
                covered += ring_area(&part).abs();
                lay.pieces.push((part, None, "building"));
            }
        }
        rear_from = f64::INFINITY;
    }
    // Behind the street range every piece is composed in the lot's own
    // frame: cross walls square to the side walls, parallel to the
    // range's back wall (« ça devient l'alignement pour la maison du
    // fond », P22 12, 16, 46; P09 40-42), so a back house between
    // parallel party walls is a rectangle, a trapezoid at most.
    let street = lay.f;
    if rear_from.is_finite() {
        rear_from = lay.pieces.iter().flat_map(|p| p.0.iter()).map(|&q| lf.t(q)).fold(f64::NEG_INFINITY, f64::max);
        if !rear_from.is_finite() {
            rear_from = lf.t(add(scale(street.u, anchor), scale(street.n, front_end)));
        }
    }
    let anchor = lf.s(add(scale(street.u, anchor), scale(street.n, ta)));
    let main = lf;
    lay.f = lf;
    let (s0, s1, _, t1) = lf.range(lay.b);
    let width = s1 - s0;
    let avail = t1 - rear_from;
    let rear_min = if coverage > 0.85 { 1.5 } else { 3.0 };
    // The back of the lot varies lot by lot within the culture's rooms
    // (« réguliers, jamais identiques »), drawn from the lot's own seed: a
    // long wing on one party wall (the burgage back range), a short wing
    // of one or two rooms with a back house beyond its yard, or a back
    // house alone. Every piece stands against the party walls, so the
    // wings of neighbours share them; leftover land stays yard or garden.
    let mut vary = lot.seed.fork("occupation-back");
    let (back_form, left) = (vary.float(), vary.chance(0.5));
    let back_rooms = vary.range(rooms[0], 2.0 * rooms[0]).max(wing);
    let yard = vary.range(3.0, 7.0);
    let back_house = |lay: &mut Lay, from: f64, covered: &mut f64| -> Option<f64> {
        let (a, z) = (from + yard, from + yard + back_rooms);
        if z > t1 - rear_min + 1e-9 {
            return None;
        }
        let part = lay.band(a, z).or_else(|| side_wing(lay.b, &main, lay.fronts, left, width, a, z, wing))?;
        *covered += ring_area(&part).abs();
        let end = part.iter().map(|&q| main.t(q)).fold(z, f64::max);
        lay.pieces.push((part, None, "building"));
        Some(end)
    };
    if covered < target - 1.0 && avail > rear_min + wing {
        let w = (width * vary.range(0.35, 0.7)).clamp(wing, (width * 0.7).max(wing));
        // A dense lot's wing is as wide as its target needs, and the
        // whole width where the strip beside it would hold no yard
        // (« toute la largeur de la parcelle », P01 1).
        let w = w.max(((target - covered) / (avail - rear_min)).min(width));
        let w = if width - w < 4.0 || w > 0.75 * width { width } else { w };
        let need = (target - covered) / w;
        let len = if back_form < 0.45 { (vary.range(1.0, 2.0) * room).min(need) } else { need * vary.range(0.5, 1.05) }.min(avail - rear_min);
        if back_form >= 0.2 && len >= wing {
            let (lo, hi) = if left { (s0, s0 + w) } else { (s1 - w, s1) };
            let part = (w >= width - 1e-9)
                .then(|| lay.band(rear_from, rear_from + len))
                .flatten()
                .or_else(|| side_wing(lay.b, &main, lay.fronts, left, w, rear_from, rear_from + len, wing))
                .or_else(|| lay.place(lo, hi, rear_from, rear_from + len, (lo + hi) * 0.5).map(|r| lay.rect(r)));
            if let Some(part) = part {
                covered += ring_area(&part).abs();
                rear_from = part.iter().map(|&q| main.t(q)).fold(rear_from, f64::max);
                lay.pieces.push((part, None, "building"));
            }
        }
        // A lot backing onto the town wall builds its back house on it.
        if back_form < 0.45
            && !walled
            && let Some(end) = back_house(&mut lay, rear_from, &mut covered)
        {
            rear_from = end;
        }
    }
    let tail = t1 - rear_from;
    if walled && tail >= wing + 1.5 {
        // Invariant (houses against the wall): a lot backing onto the town
        // wall builds its rear range on the curtain, its party wall, with
        // no strip between them (« maison adossée au rempart »).
        let dd = rng.range(4.0, 7.0).max(wing).min(tail - 1.5);
        lay.body(s0, s1, t1 - dd, t1, anchor);
    } else if tail >= 9.0 && (workshop || covered < target - 10.0 || rng.chance(0.35)) {
        // Back-lot workshop, stable or store at the end of a long tail,
        // against a party wall.
        // In proportion to the garden it closes (P22 12, 16: « trop petit »).
        let dd = rng.range(4.0, 7.0).max(0.25 * tail.min(30.0)).min(tail - 4.0);
        let back = rng.range(0.0, 2.0);
        let w = width * if workshop { 1.0 } else { rng.range(0.55, 1.0) };
        let (a, z) = (t1 - back - dd, t1 - back);
        match side_wing(lay.b, &main, lay.fronts, left, w, a, z, wing) {
            Some(part) => lay.pieces.push((part, None, "building")),
            None => {
                let lo = if left { s0 } else { s1 - w };
                lay.put(lo, lo + w, a, z, lo + w * 0.5);
            }
        }
    }
    lay.pieces
}

/// A warehouse: one deep body on its street.
fn warehouse(lot: &Site, d: &Domain) -> Vec<Piece> {
    let mut lay = lot.lay(d);
    let end = lot.ta + d.plot_depth.min((lot.depth * 1.5).max(15.0));
    lay.body(d.s0, d.s1, lot.tf, end, d.anchor);
    lay.pieces
}

/// A detached house, a farmstead or a long house: the house square to its
/// street or to its lot's sides, its plan's parts in a complex tissue, and
/// its barn, byre or shed.
fn home(lot: &Site, d: &Domain, o: &Occupancy) -> Vec<Piece> {
    let mut lay = lot.lay(d);
    let (kind, main, lf, b, ring) = (lot.kind, lot.main, d.lf, &*d.b, &lot.shape.outer);
    let (s0, s1, tf, t1) = (d.s0, d.s1, lot.tf, d.t1);
    let (total, depth, wing, coverage, pressure, zone) = (lot.total, lot.depth, lot.wing, lot.coverage, lot.pressure, o.zone);
    let urban = if zone == "village" { 0.4 * pressure } else { super::pressure::local(o.morph, zone, pressure) };
    // Its own stream: the size class never shifts the lot's other draws.
    let mut sized = lot.seed.fork("home-size");
    let large = if kind == Kind::Farm { 0.12 + 0.25 * ((total - 1500.0) / 3000.0).clamp(0.0, 1.0) } else { 0.06 + 0.14 * o.wealth };
    let big = if sized.chance(large) { sized.range(1.2, 1.45) } else { 1.0 };
    let culture = o.morph.value["id"].as_str().unwrap_or("").split('/').next().unwrap_or("");
    // On a lot leaning off its street the house and its outbuildings
    // stand square to the lot's sides (« alignées sur la parcelle »,
    // P03 21), the house's front corner at the street; unless the
    // house holds there under four fifths of what it holds square to
    // its street (a long lot whose ends lean, a wedge-shaped lot):
    // its long side then follows the lot's long side, never a
    // shrunken house askew (review series 3 P04, series 2 P21 101).
    let site = |lay: &Lay, f: Frame, rng: &mut Rng| {
        let (s0, s1, tf, t1) = if f.n == main.n { (s0, s1, tf, t1) } else { f.range(b) };
        let (width, plot_depth) = (s1 - s0, t1 - tf);
        // Invariant (« petites maisons individuelles »): a home's size
        // follows the access gradient, small cottages at the fringe and
        // in villages, town houses near the core; a few larger houses
        // (well-off households) stand anywhere.
        let (house_w, house_d) = match kind {
            Kind::Long => (rng.range(14.0, 28.0), rng.range(5.0, 7.5)),
            // A farmhouse has the size of its culture's farm type.
            Kind::Farm => {
                let (w, d) = super::super::farmsteads::house_size(culture, o.seed);
                (w * big, d * big)
            }
            _ => (
                rng.range(5.5 + 1.5 * urban, 8.5 + 3.5 * urban) * (0.9 + 0.2 * o.wealth) * big,
                depth.min(rng.range(5.5 + 2.5 * urban, 8.0 + 3.0 * urban) * big),
            ),
        };
        let (house_scale, _) = super::super::culture::house_parameters(culture);
        let (house_w, house_d) = (house_w * house_scale, house_d * house_scale);
        // A camp's long house (Iroquoian longhouse, maloca, plank
        // house) fills its lot's length at the culture's width
        // (`campHouse`: [width, longest]), its long side along the
        // lot's longer side.
        let (house_w, house_d) = match o.morph.pair("campHouse") {
            [w, longest] if kind == Kind::Long && w > 0.0 && !o.morph.text("campLayout").is_empty() => {
                let along = (width.max(plot_depth) - 3.0).min(longest).max(w);
                let across = w.min(width.min(plot_depth) - 2.0).max(4.0);
                if width >= plot_depth { (along, across) } else { (across, along) }
            }
            _ => (house_w, house_d),
        };
        // A long house turns its gable to a narrow street frontage.
        let (house_w, house_d) = if kind == Kind::Long && house_w > width * 1.05 { (house_d, house_w) } else { (house_w, house_d) };
        let hw = house_w.min(width);
        let slack = (width - hw).max(0.0);
        let at = s0 + slack * rng.range(0.2, 0.8);
        // On a narrow lot the house keeps to one side, the passage on
        // the other (« coller les bords »), and keeps its width by
        // stepping back from an oblique street rather than narrowing.
        let at = if slack < 4.0 && rng.chance(0.5) {
            s0
        } else if slack < 4.0 {
            s0 + slack
        } else {
            at
        };
        let hd = house_d.min(plot_depth);
        let house = (0..=8)
            .find_map(|j| {
                let start = tf + 0.5 * j as f64;
                let (l, r) = fit_any(b, &f, start, start + hd, at + hw * 0.5)?;
                (r - l >= 0.9 * hw && hd >= wing).then(|| {
                    let w = hw.min(r - l);
                    let a = at.min(r - w).max(l);
                    [a, a + w, start, start + hd]
                })
            })
            .or_else(|| lay.place(at, at + hw, tf, tf + hd, at + hw * 0.5));
        ((s0, s1, tf, t1), (house_w, house_d, hw, at), house)
    };
    let size = |h: &Option<[f64; 4]>| h.map_or(0.0, |r| (r[1] - r[0]) * (r[3] - r[2]));
    // Both frames try the same draws of the form's own stream.
    let stream = lot.seed.fork("form-home");
    let mut square = stream.clone();
    let street_site = site(&lay, main, &mut square);
    let chosen = (!lot.aligned && dot(lf.n, main.n) < LEAN)
        .then(|| {
            let mut leaning = stream;
            lay.f = lf;
            let s = site(&lay, lf, &mut leaning);
            lay.f = main;
            (s, leaning)
        })
        .filter(|(s, _)| size(&s.2) >= 0.8 * size(&street_site.2));
    let (((s0, s1, tf, t1), (_, house_d, hw, at), house), frame, mut rng) = match chosen {
        Some((s, leaning)) => (s, lf, leaning),
        None => (street_site, main, square),
    };
    lay.f = frame;
    let (width, plot_depth) = (s1 - s0, t1 - tf);
    let farm = kind == Kind::Farm;
    // In a complex tissue the home is the plan its kit composes
    // around that body (forms/plan.rs): the body first, then wings,
    // cross-wings and extras, each a whole frame rectangle keeping
    // its own label.
    let parts = match house {
        Some(r) if kind != Kind::Long && super::super::forms::is_complex(o.morph) => {
            use super::super::forms::plan;
            // The lot's street line in the chosen frame.
            let street = if frame.n == main.n { main.t0 } else { frame.range(ring).2 };
            plan::house(&plan::PlanInput {
                body: r,
                free: [s0, s1, street.min(r[2]), t1],
                arch: &o.morph.value["arch"],
                culture,
                wealth: o.wealth,
                rural: matches!(zone, "village" | "hamlet") || farm,
                farm,
                seed: o.seed,
            })
        }
        _ => vec![],
    };
    // A plan part in its lot: whole where the ground holds it, else
    // narrowed to the span the ground leaves along its depth, then
    // drawn back towards the body, never under `least` on a side.
    // What stands ahead of the body's front wall (a porch, a bay,
    // the head of a cross-wing) stands in the street setback, inside
    // the lot; the rest inside the buildable ground.
    let fit_part = |f: &Frame, [a, z, t0, t1]: [f64; 4], body: [f64; 4], least: f64| -> Option<[f64; 4]> {
        let (mid, d) = (0.5 * (a + z), t1 - t0);
        let cuts = [1.0, 0.75, 0.5, least / d.max(1e-9)];
        let tries: Vec<(f64, f64)> = if t1 <= body[2] + 1e-9 {
            cuts.iter().filter(|k| **k <= 1.0).map(|k| (t1 - d * k, t1)).collect()
        } else if t0 >= body[3] - 1e-9 {
            cuts.iter().filter(|k| **k <= 1.0).map(|k| (t0, t0 + d * k)).collect()
        } else {
            // Across the body: its head, then its back, drawn onto the body's walls.
            vec![(t0, t1), (t0.max(body[2]), t1), (t0.max(body[2]), t1.min(body[3]))]
        };
        tries.into_iter().find_map(|(t0, t1)| {
            if t1 - t0 < least - 1e-9 {
                return None;
            }
            let front = body[2].clamp(t0, t1);
            let (mut l, mut r) = (a, z);
            for (ground, lo, hi) in [(ring.as_slice(), t0, front), (b, front, t1)] {
                if hi - lo > 1e-6 {
                    let (gl, gr) = fit(ground, f, lo, hi, mid)?;
                    (l, r) = (l.max(gl), r.min(gr));
                }
            }
            (r - l >= least - 1e-9).then_some([l, r, t0, t1])
        })
    };
    // The house as laid, wings included: the outbuildings keep clear of it.
    let mut extent = house;
    if let Some(r) = house {
        let n = lay.pieces.len();
        // A cross-wing takes one end of the body, which stays a full body.
        let body = parts.first().map(|p| p.rect).filter(|q| q[1] - q[0] >= wing - 1e-9 && q[3] - q[2] >= wing - 1e-9);
        let extras: &[super::super::forms::plan::PlanPart] = match body {
            Some(_) => parts.get(1..).unwrap_or(&[]),
            None => &[],
        };
        lay.add(body.unwrap_or(r), "building");
        let mut whole = true;
        for part in extras {
            let least = super::super::forms::plan::min_side(part.label);
            let fitted = fit_part(&frame, part.rect, r, least).filter(|&c| lay.clear(&lay.rect(c)));
            match fitted {
                Some(c) => {
                    lay.add(c, part.label);
                    extent = extent.map(|e| [e[0].min(c[0]), e[1].max(c[1]), e[2].min(c[2]), e[3].max(c[3])]);
                }
                None if part.label == "crosswing" => {
                    whole = false;
                    break;
                }
                None => {}
            }
        }
        // The end a cross-wing left empty goes back to the body.
        if !whole {
            lay.pieces.truncate(n);
            lay.add(r, "building");
            extent = house;
        }
    }
    let house_end = extent.map_or(tf + house_d.min(plot_depth), |r| r[3]);
    let (hx0, hx1) = extent.map_or((at, at + hw), |r| (r[0], r[1]));
    let tail = t1 - house_end;
    if farm {
        // Farmstead: house, barn and a yard. The barn closes the yard
        // at the back (three-sided court) or runs along one side; on a
        // shallow lot it stands beside the house across the yard.
        // Barns as varied as their farms: mostly a modest barn or byre,
        // the large grange only on a large farm.
        let bw = rng.range(5.0, 7.5) * big.sqrt();
        let bl = rng.range(7.0, 12.0) * big;
        let mut barn = 0.0;
        if tail > 8.0 && width > 9.0 {
            if rng.chance(0.5) {
                let yard = rng.range(6.0, 12.0).min(tail - 6.0).max(2.0);
                let start = house_end + yard;
                let len = (rng.range(8.0, 14.0) * big).min(width);
                let x = s0 + (width - len) * rng.float();
                barn = lay.put(x, x + len, start, start + bw.min(tail - yard), x + len * 0.5);
            } else {
                let start = house_end + 1.5;
                let w = bw.min(width * 0.45);
                let (lo, hi) = if hx0 - s0 > s1 - hx1 { (s0, s0 + w) } else { (s1 - w, s1) };
                barn = lay.put(lo, hi, start, start + bl.min(tail - 2.0), (lo + hi) * 0.5);
            }
        }
        if barn <= 0.0 {
            // Beside the house, a yard between them.
            let gapx = rng.range(4.0, 8.0);
            // As long as the room beside the house allows: never
            // slid back onto the house.
            let bl = bl.min((s1 - hx1).max(hx0 - s0) - gapx).max(wing);
            let (lo, hi) = if s1 - hx1 >= hx0 - s0 { (hx1 + gapx, hx1 + gapx + bl) } else { (hx0 - gapx - bl, hx0 - gapx) };
            lay.put(lo, hi, tf, tf + bw, (lo + hi) * 0.5);
        }
        if total > 1500.0 && rng.chance(0.6) {
            let start = house_end + 2.0;
            let x = if rng.chance(0.5) { s0 } else { s1 - 4.5 };
            lay.put(x, x + 4.5, start, start + 6.0, x + 2.25);
        }
    } else if tail > 8.0 && (o.function == "workshop" || rng.chance(0.3 + 0.4 * coverage)) {
        // Garden shed, workshop or byre at the rear.
        let (w, d) = if o.function == "workshop" { (rng.range(6.0, 9.0), rng.range(6.0, 9.0)) } else { (rng.range(3.0, 5.0), rng.range(3.0, 5.0)) };
        let back = rng.range(0.5, 3.0);
        let x = if rng.chance(0.5) { s0 } else { s1 - w };
        lay.put(x, x + w, t1 - back - d, t1 - back, x + w * 0.5);
    }
    lay.pieces
}

/// Round houses: whole huts on the buildable ground, the main one near the
/// front middle.
fn round(lot: &Site, d: &Domain) -> Vec<Piece> {
    let mut rng = lot.seed.fork("form-round");
    let (main, b, ta) = (lot.main, &*d.b, lot.ta);
    let (s0, s1, t1) = (d.s0, d.s1, d.t1);
    // Invariant (a round house is never cut): every hut is a whole
    // 12-gon inside the buildable ground (lot holes kept clear), its
    // radius bounded by the clearance there, never clipped by a lot
    // line. Bound the attempted spots, not just the polygon area:
    // a thin diagonal lot can have an arbitrarily larger frame box.
    let ground = Shape { outer: b.to_vec(), holes: lot.shape.holes.clone() };
    let clearance = |c: Point| {
        if !super::super::geometry::contains(&ground, c) {
            return 0.0;
        }
        std::iter::once(&ground.outer)
            .chain(ground.holes.iter())
            .flat_map(|r| (0..r.len()).map(move |k| (r[k], r[(k + 1) % r.len()])))
            .map(|(a, q)| distance(c, a, q))
            .fold(f64::INFINITY, f64::min)
    };
    // The 12-gon's corners stand 1.035 r from its centre.
    const CORNER: f64 = 1.04;
    const MIN_HUT: f64 = 2.0;
    let step = (ring_area(b).abs() / 600.0).sqrt().max(0.6);
    let mut spots: Vec<(Point, f64, f64, f64)> = vec![];
    for Point { x: s, y: t } in round_samples((s0, ta, s1, t1), step) {
        let c = add(scale(main.u, s), scale(main.n, t));
        let room = clearance(c) / CORNER;
        if room.is_finite() && room >= MIN_HUT {
            spots.push((c, room, s, t));
        }
    }
    let total = lot.total;
    let count = 1 + usize::from(total > 300.0) + usize::from(total > 700.0) + usize::from(rng.chance(0.3));
    let mut pieces = vec![];
    let mut huts: Vec<(Point, f64)> = vec![];
    for i in 0..count {
        let want = rng.range(2.5, 4.5) * if i == 0 { 1.15 } else { 0.9 };
        let free = |&(c, room, _, _): &(Point, f64, f64, f64)| {
            let r = want.min(room);
            huts.iter().all(|(q, rq)| length(sub(*q, c)) >= r + rq + 1.5)
        };
        let pick = if i == 0 {
            // The main house near the front middle, at full size where
            // the lot allows it, else on its roomiest spot.
            let mid = 0.5 * (s0 + s1);
            let near = |&(_, _, s, t): &(Point, f64, f64, f64)| (t - (ta + want + 1.0)).abs() + 0.5 * (s - mid).abs();
            spots
                .iter()
                .filter(|x| x.1 >= want)
                .min_by(|a, b| near(a).total_cmp(&near(b)))
                .or_else(|| spots.iter().max_by(|a, b| a.1.total_cmp(&b.1)))
                .copied()
        } else {
            let open: Vec<_> = spots.iter().filter(|x| x.1 >= want && free(x)).collect();
            (!open.is_empty()).then(|| *open[rng.int(0, open.len() as u32 - 1) as usize])
        };
        let Some((c, room, _, _)) = pick.filter(|x| free(x)) else {
            continue;
        };
        let r = want.min(room);
        let hut = largest(clip_parts(b, &circle(c, r)));
        if hut.len() >= 3 && ring_area(&hut).abs() >= 4.0 {
            pieces.push((hut, None, "building"));
            huts.push((c, r));
        }
    }
    pieces
}

/// A court house or an insula: one mass around its court (closed, or opened
/// to the rear or a side), with the form it realizes; a lot that holds no
/// court with whole wings falls back to its street row.
fn court(lot: &Site, d: &Domain, o: &Occupancy) -> (Vec<Piece>, Kind) {
    let mut rng = lot.seed.fork("form-court");
    let mut lay = lot.lay(d);
    let (main, b, m) = (lot.main, &*d.b, o.morph);
    let (s0, s1, tf, t1, width, plot_depth, anchor) = (d.s0, d.s1, lot.tf, d.t1, d.width, d.plot_depth, d.anchor);
    let (collective, coverage, court_wing) = (lot.collective, lot.coverage, lot.court_wing);
    // Public and elite courts (cloister, inn yard, hotel court) are
    // wide; an ordinary house keeps the light court its coverage allows.
    // An insula wraps one-room ranges (shops below) around an open
    // court (Ostia, Casa di Diana) where the lot holds whole wings.
    let insula = lot.kind == Kind::Insula;
    let mut ring_depth = if collective {
        (0.12 * width.min(plot_depth)).clamp(4.0, 9.0)
    } else if insula {
        lot.room.clamp(4.0, 7.0)
    } else {
        lot.room.clamp(3.5, 7.0)
    };
    if rng.chance(m.number_or("bigCourtChance", 0.12) + 0.2 * o.wealth) {
        ring_depth *= 0.8;
    }
    let ring_depth = ring_depth.max(court_wing);
    // Outer mass: the square domain itself, else the widest fitted
    // rectangle. The court lies inside it inset by the wing width on
    // every side, so no wing ever thins below `court_wing`.
    // The lot itself where its walls lean 25 degrees at most (P10
    // 46: a fitted rectangle left the street front empty), else the
    // larger of the fitted and the largest inscribed rectangle.
    let lot_outer = square_enough(b, &main, &lot.fronts, 15.0) || legible(b, court_wing);
    let holds = |r: &[f64; 4]| r[1] - r[0] >= 2.0 * court_wing + 3.0 && r[3] - r[2] >= 2.0 * court_wing + 3.0;
    let outer = if lot_outer {
        Some(b.to_vec())
    } else {
        let fitted = [1.0, 0.8, 0.6].into_iter().find_map(|k| {
            let r = lay.place(s0, s1, tf, tf + (t1 - tf) * k, anchor)?;
            holds(&r).then_some(r)
        });
        let size = |r: &Option<[f64; 4]>| r.map_or(0.0, |r| (r[1] - r[0]) * (r[3] - r[2]));
        let largest = inscribed(b, &main).filter(holds);
        if size(&largest) > 1.1 * size(&fitted) { largest } else { fitted }.map(|r| lay.rect(r))
    };
    // A collective court is a real open court, not a light well.
    let least = if insula { m.number_or("courtyardMin", 9.0).max(16.0) } else { m.number_or("courtyardMin", 9.0).min(9.0) };
    // Invariant (« la cour a l'orientation de la maison »): a court in
    // the lot's own mass is that mass inset, deeper until its area
    // meets the target, so each court wall is parallel to the house
    // wall facing it; a court in a frame rectangle is a frame
    // rectangle.
    let inset_court = |outer: &[Point]| -> Option<Vec<Point>> {
        let area_outer = ring_area(outer).abs();
        let target = if collective || insula { 0.0 } else { m.number_or("courtyardMin", 9.0).max((1.0 - coverage) * area_outer) };
        let mut pick = None;
        for k in [1.0, 1.2, 1.45, 1.75, 2.1, 2.5] {
            let Some(c) = inset(outer, ring_depth * k) else {
                break;
            };
            let a = ring_area(&c).abs();
            if a < least || thickness(&c, None) < 3.0 {
                break;
            }
            pick = Some(c);
            if a <= target || target == 0.0 {
                break;
            }
        }
        pick
    };
    let court = outer.as_ref().and_then(|outer| {
        if lot_outer {
            return inset_court(outer);
        }
        let (cs0, cs1, ct0, ct1) = main.range(outer);
        let (cs0, cs1, ct0, ct1) = (cs0 + ring_depth, cs1 - ring_depth, ct0 + ring_depth, ct1 - ring_depth);
        let (cw, ch) = (cs1 - cs0, ct1 - ct0);
        if cw < 3.0 || ch < 3.0 {
            return None;
        }
        let area_outer = ring_area(outer).abs();
        let target = if collective || insula { cw * ch } else { m.number_or("courtyardMin", 9.0).max((1.0 - coverage) * area_outer) };
        let k = (target / (cw * ch)).sqrt().min(1.0);
        let outer_shape = Shape { outer: outer.clone(), holes: vec![] };
        [k, k * 0.75, k * 0.55, 1.0].into_iter().find_map(|k| {
            let (w, h) = (cw * k, ch * k);
            if w < 3.0 || h < 3.0 || w * h < least {
                return None;
            }
            let (x0, y0) = ((cs0 + cs1 - w) * 0.5, (ct0 + ct1 - h) * 0.5);
            // The court grown by the wing width must stay inside the mass.
            let grown = add(scale(main.u, x0 - court_wing), scale(main.n, y0 - court_wing));
            super::lot_envelopes::rect_within(&outer_shape, grown, main.u, main.n, w + 2.0 * court_wing, h + 2.0 * court_wing).then(|| lay.rect([x0, x0 + w, y0, y0 + h]))
        })
    });
    let (Some(outer), Some(court)) = (outer, court) else {
        // Documented fallback: the street body (an insula's deep
        // block-front range), never a court thinner than its wings.
        let deep = if insula { (lot.build_depth[1] * (1.0 + 0.2 * lot.pressure)).max(lot.depth) } else { lot.depth };
        return (row(lot, d, o, deep, false), Kind::Row);
    };
    // An insula court on a lot that holds no native court recipe is the
    // light court (cortile) of a row building, as the dense rows' back
    // courts: the programme asks a row, never a court house the lot cannot
    // hold.
    let form = if insula && !o.court_lot { Kind::Row } else { Kind::Court };
    // Court types vary within a block: besides the closed ring, a house
    // opens its court to the rear garden (U: street range and two side
    // wings) or to one side as well (L: street range and one wing). The
    // wings keep the ring's width; the opening runs to the mass's edge, so
    // no sliver is left behind it.
    let variant = rng.float();
    let open_share = m.number_or("openCourtChance", 0.35);
    if form == Kind::Court && !collective && !insula && variant < open_share && convex(&court) {
        // The opening is the court swept to the rear (U) and to one side as
        // well (L), between the court's own walls: the wings left keep the
        // court's orientation.
        let mut c = court.clone();
        if ring_area(&c) < 0.0 {
            c.reverse();
        }
        let k = c.len();
        // Outward (right) normal of each CCW court wall.
        let outward: Vec<Point> = (0..k).map(|i| scale(normal(unit(sub(c[(i + 1) % k], c[i]))), -1.0)).collect();
        let pick = |d: Point| (0..k).max_by(|&i, &j| dot(outward[i], d).total_cmp(&dot(outward[j], d))).unwrap_or(0);
        let rear_wall = pick(main.n);
        let side_wall = if variant < open_share * 0.6 {
            None
        } else if rng.chance(0.5) {
            Some(pick(main.u))
        } else {
            Some(pick(scale(main.u, -1.0)))
        };
        let planes: Vec<Plane> = (0..k).filter(|&i| i != rear_wall && Some(i) != side_wall).map(|i| (outward[i], dot(outward[i], c[i]))).collect();
        let mut opened = vec![Shape { outer: outer.clone(), holes: vec![] }];
        for cut in clip_parts(&outer, &planes) {
            let cut = Shape { outer: cut, holes: vec![] };
            opened = opened.iter().flat_map(|s| difference(s, &cut)).collect();
        }
        if !opened.is_empty() && opened.iter().all(|s| s.holes.is_empty()) {
            for s in opened {
                lay.pieces.push((s.outer, None, "building"));
            }
            return (lay.pieces, form);
        }
    }
    lay.pieces.push((outer, Some(court), "building"));
    (lay.pieces, form)
}

/// A free-standing monument in its precinct: forecourt (parvis) in front,
/// a nave-like hall along the plot depth, a keep or tower a square block.
fn hall(lot: &Site, d: &Domain, o: &Occupancy) -> Vec<Piece> {
    let mut lay = lot.lay(d);
    let (s0, s1, t1, width, plot_depth, ta) = (d.s0, d.s1, d.t1, d.width, d.plot_depth, lot.ta);
    let margin = (0.08 * width).clamp(1.5, 8.0);
    let keep = o.role.starts_with("defence");
    let hall_w = if keep { (0.4 * width.min(plot_depth)).clamp(8.0, 22.0) } else { (0.5 * width).clamp(8.0, 30.0) }.min(width - 2.0 * margin);
    let start = ta + (0.15 * plot_depth).clamp(2.0, 20.0);
    let len = if keep { hall_w } else { (0.7 * plot_depth).clamp(10.0, 70.0) }.min(t1 - start - margin);
    let mid = (s0 + s1) * 0.5;
    lay.put(mid - hall_w * 0.5, mid + hall_w * 0.5, start, start + len, mid);
    lay.pieces
}

/// Siheyuan: a compound of bounded size at the street (larger lots keep
/// gardens), with a gate row, then one to three courtyards in depth, each
/// closed by a hall and two side halls; a lot too small for it builds a row.
fn pavilions(lot: &Site, d: &Domain, o: &Occupancy) -> (Vec<Piece>, Kind) {
    let (s0, tf, t1, width, plot_depth) = (d.s0, lot.tf, d.t1, d.width, d.plot_depth);
    if width < 12.0 || plot_depth < 16.0 {
        return (row(lot, d, o, lot.depth, false), Kind::Row);
    }
    let mut rng = lot.seed.fork("form-pavilions");
    let mut lay = lot.lay(d);
    let cw = width.min(rng.range(18.0, 30.0) * (0.85 + 0.3 * o.wealth));
    let x0 = s0 + (width - cw) * rng.range(0.0, 1.0);
    let (x1, x2) = (x0, x0 + cw);
    let front = rng.range(4.0, 5.5);
    lay.put(x1 + 0.5, x2 - 0.5, tf, tf + front, (x1 + x2) * 0.5);
    let mut at = tf + front;
    let courts = 1 + usize::from(o.wealth > 0.5) + usize::from(o.wealth > 0.8);
    for _ in 0..courts {
        let yard = rng.range(8.0, 14.0);
        let hall = rng.range(6.0, 8.0);
        if at + yard + hall > t1 - 0.5 {
            break;
        }
        let side = rng.range(3.5, 5.0);
        let (lo, hi) = (at + 1.5, at + yard - 1.5);
        if hi - lo >= 4.0 && cw >= 2.0 * side + 5.0 {
            lay.put(x1 + 0.5, x1 + 0.5 + side, lo, hi, x1 + 0.5 + side * 0.5);
            lay.put(x2 - 0.5 - side, x2 - 0.5, lo, hi, x2 - 0.5 - side * 0.5);
        }
        lay.put(x1 + 1.5, x2 - 1.5, at + yard, at + yard + hall, (x1 + x2) * 0.5);
        at += yard + hall;
    }
    (lay.pieces, lot.wish)
}

/// Hanok: the main house (anchae) across the back of the yard, one wing (an
/// L), and on wide lots a guest house (sarangchae) near the gate.
fn hanok(lot: &Site, d: &Domain) -> Vec<Piece> {
    let mut rng = lot.seed.fork("form-hanok");
    let mut lay = lot.lay(d);
    let (s0, s1, t1, width, plot_depth, ta, tf) = (d.s0, d.s1, d.t1, d.width, d.plot_depth, lot.ta, lot.tf);
    let depth = rng.range(5.0, 7.0).min(plot_depth * 0.4);
    let back = rng.range(0.5, 2.0);
    let main_t = t1 - back - depth;
    lay.put(s0 + 1.5, s1 - 1.5, main_t, t1 - back, (s0 + s1) * 0.5);
    let yard = rng.range(3.0, 6.0);
    let w = rng.range(4.0, 5.5);
    let left = rng.chance(0.5);
    let (lo, hi) = if left { (s0 + 1.5, s0 + 1.5 + w) } else { (s1 - 1.5 - w, s1 - 1.5) };
    if main_t - (ta + yard) >= 4.0 {
        lay.put(lo, hi, ta + yard, main_t, (lo + hi) * 0.5);
    }
    if width > 18.0 && main_t - ta > 12.0 {
        let (lo, hi) = if left { (s1 - 1.5 - 8.0, s1 - 1.5) } else { (s0 + 1.5, s0 + 9.5) };
        lay.put(lo, hi, tf + 1.0, tf + 6.0, (lo + hi) * 0.5);
    }
    lay.pieces
}

/// Yashiki: a residence standing in its garden, with a storehouse (kura).
fn yashiki(lot: &Site, d: &Domain) -> Vec<Piece> {
    let mut rng = lot.seed.fork("form-yashiki");
    let mut lay = lot.lay(d);
    let (s0, s1, t1, width, plot_depth, ta) = (d.s0, d.s1, d.t1, d.width, d.plot_depth, lot.ta);
    let hw = width * rng.range(0.45, 0.65);
    let hd = (plot_depth * rng.range(0.3, 0.45)).max(8.0).min(plot_depth);
    let start = ta + (0.2 * plot_depth).min(plot_depth - hd).max(0.0);
    let mid = s0 + (width - hw) * rng.range(0.3, 0.7);
    lay.put(mid, mid + hw, start, start + hd, mid + hw * 0.5);
    if plot_depth - (start - ta + hd) > 8.0 {
        let x = if rng.chance(0.5) { s0 + 1.0 } else { s1 - 5.0 };
        lay.put(x, x + 4.0, t1 - 7.0, t1 - 1.0, x + 2.0);
    }
    lay.pieces
}

/// Invariant (no illogical bare ground in town): a core or middle lot built
/// under half of its tissue's coverage fills its free ground with back
/// buildings (`fill_back`), from its own stream of the lot's seed.
/// Villages, hamlets, faubourgs and rural lots keep their gardens and yards,
/// farms and camps theirs, a monument its precinct. The layout's
/// `backBuildings` is the share of town lots filled, each lot drawing once
/// from its seed, so a lot filled at one share stays filled above it. The
/// box a bounded house was cut to (`d`) stays its own domain.
fn back_filled(lot: &Site, d: &Domain, o: &Occupancy, form: Kind, pieces: Vec<Piece>) -> Vec<Piece> {
    let (m, kind) = (o.morph, lot.kind);
    let back = super::super::forms::back_buildings(m);
    let fills = matches!(o.zone, "core" | "middle")
        && lot.seed.fork("fill-lot").chance(back)
        && matches!(kind, Kind::Row | Kind::Detached | Kind::Court | Kind::Insula | Kind::Pavilions | Kind::Hanok | Kind::Yashiki)
        && !o.landmark
        && !o.role.ends_with(".ruin")
        && m.text("campLayout").is_empty();
    if !fills {
        return pieces;
    }
    let (b, ground, main) = (&*d.b, lot.ground.as_slice(), lot.main);
    let boxed = lot.bounded && ring_area(b).abs() < ring_area(ground).abs() - 1.0;
    let frame = {
        let f = lot_frame(ground, &main, &lot.fronts);
        if dot(f.n, main.n) < LEAN { f } else { main }
    };
    let mut lay = Lay { b: ground, fronts: &lot.fronts, f: frame, wing: lot.wing, pieces };
    fill_back(
        &mut lay,
        &Fill {
            kept: boxed.then_some(b),
            target: lot.coverage * lot.total,
            share: back,
            open: 1.0 - lot.coverage,
            setback: lot.setback,
            rooms: lot.rooms,
            court_wing: lot.court_wing,
            attached: lot.attached,
            detached: kind == Kind::Detached,
            row: form == Kind::Row,
            workshop: o.function == "workshop",
            second: (boxed && ring_area(ground).abs() >= 2.0 * ring_area(b).abs()).then_some(kind),
        },
        &mut lot.seed.fork("fill"),
    );
    lay.pieces
}

mod finalize;
use finalize::{ruined, finish, dedup};
#[cfg(test)]
mod tests;
