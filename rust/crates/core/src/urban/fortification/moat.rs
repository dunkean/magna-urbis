//! Choose the ditch and its ravelins, dig its line (`moat_line`), and keep the records derived from the
//! line (crossings, dams, sluices, ditch pieces) in step with the final streets and gates.

use crate::rng::Rng;
use crate::urban::types::MoatRun;
use crate::urban::{Enclosure, MoatSpec, Point, Shape, Street, Surface, Work, geometry as g};
use super::build::{BuildContext, Works};
use super::gate_works::GateInfo;
use super::geometry::{Box2, Cut, TILE, add, area, buffer, buffer_all, dir, dist, quad, segment_relief, tiles, wet_outward};
use super::moat_line::{self, DEFAULT_LIFT, MoatLineInput, Outline, WETNESS_LIFT};
use super::shore::WallWalk;
use super::water::{MOAT_SHORT, near_water};
use super::style::{data, num};

#[derive(Clone, Copy)]
pub(super) struct Moat {
    pub(super) berm: f64,
    pub(super) dw: f64,
    /// Whether the circuit digs, and its nominal kind (`wet`, `pool`, `dry`): the line decides the water
    /// of each reach.
    pub(super) ditch_kind: Option<&'static str>,
    pub(super) depth: f64,
    /// Id of its row in the `moats` table.
    pub(super) form: &'static str,
    /// Head (m) above a source the ditch may be fed to; `-inf`: it never holds fed water.
    pub(super) lift: f64,
    /// The culture keeps wet moats: a run without a source holds a pool.
    pub(super) culture_wet: bool,
    /// A canal moat (`water: fed`): fed everywhere.
    pub(super) canal: bool,
}

/// Relief of a hill circuit (`fortification::terrain`): a culture's rock-cut ditch needs it (`needs: steep`). The
/// threshold of a hill town (`style::resolve`).
pub(super) const HILL_RELIEF: f64 = 0.07;
/// Mean relief under which a circuit beside water lies level enough to be flooded.
const LEVEL_RELIEF: f64 = 0.05;

/// The id of a row of the `moats` table as the table holds it; `earth` for an unknown id.
pub(super) fn form_id(id: &str) -> &'static str {
    data()["moats"].as_object().and_then(|m| m.get_key_value(id)).map_or("earth", |(k, _)| k.as_str())
}
/// Whether a form may be dug on a site (its `needs`: `steep`, a hill circuit; `canals`, a canal town).
pub(super) fn suits(row: &serde_json::Value, steep: bool, canals: bool) -> bool {
    match row["needs"].as_str() {
        Some("steep") => steep,
        Some("canals") => canals,
        _ => true,
    }
}
/// The supply of a ditch of a culture whose moat is wet: fed (`wet`) by a river, the sea or canals, else a `pool` of
/// rain water. A form's `water` overrides the site: `never` (a rock-cut ditch on its hill) is dry, `fed` (a canal moat)
/// is wet.
pub(super) fn supply(kind: Option<&'static str>, culture_wet: bool, fed: bool, row: &serde_json::Value) -> Option<&'static str> {
    let kind = if culture_wet { kind.map(|_| if fed { "wet" } else { "pool" }) } else { kind };
    match row["water"].as_str() {
        Some("never") => kind.map(|_| "dry"),
        Some("fed") => kind.map(|_| "wet"),
        _ => kind,
    }
}

pub(super) fn choose_moat(ctx: &BuildContext<'_>, dr: &mut Rng, size: f64, dw: f64) -> Moat {
    let &BuildContext { style, path, n_seg, surface, face, ns, wet, .. } = ctx;
    // --- ditch: decided once per circuit; a wet ditch where water is near
    // and the ground is level, otherwise dry with the style's probability.
    // Decided before the faubourg fronts: a moated circuit keeps its moat
    // whole and has no lean-to outside (rule: the moat wins over the houses).
    let berm = style.berm * size;
    // Each is read at most once (the level test of an `auto` ditch, the source of a culture's wet one).
    let relief = || {
        (0..n_seg).map(|i| dist(path[i], path[i + 1]) * segment_relief(path[i], path[i + 1], ns[i], surface)).sum::<f64>()
            / (0..n_seg).map(|i| dist(path[i], path[i + 1])).sum::<f64>().max(1.0)
    };
    let near_water = || wet.iter().any(|&w| w) || (0..n_seg).any(|i| wet_outward(path[i], path[i + 1], ns[i], surface, face + berm + dw) > 0.0);
    // The form was drawn with the style (`Style::draw_form`), which sized the ditch for it.
    let id = form_id(&style.moat_form);
    let row = form(id);
    let ditch_kind = match style.ditch.as_str() {
        "none" => None,
        _ if style.ditch_wetness.is_some() => Some("dry"),
        "wet" => Some("wet"),
        "dry" => dr.chance(style.ditch_p).then_some("dry"),
        _ if style.dry_ditches => Some("dry"),
        _ if near_water() && relief() < LEVEL_RELIEF => Some("wet"),
        _ => dr.chance(style.ditch_p).then_some("dry"),
    };
    let ditch_kind = supply(ditch_kind, style.ditch == "wet" && style.ditch_wetness.is_none(), style.ditch == "wet" && near_water(), row);
    // Underdark: no water moat in a cave (a culture's dry ditch stays, across the passages).
    let ditch_kind = if style.cave && matches!(ditch_kind, Some("wet" | "pool")) { None } else { ditch_kind };
    // The water the line may let in: the wetness parameter is the head allowed above a source, a dry
    // style or option never floods, a culture's wet moat pools where no source feeds it.
    let water = row["water"].as_str();
    let (lift, culture_wet) = match style.ditch_wetness {
        _ if water == Some("never") || style.cave => (f64::NEG_INFINITY, false),
        Some(w) if w > 0.0 => (w * WETNESS_LIFT, true),
        Some(_) => (f64::NEG_INFINITY, false),
        None if style.ditch == "wet" => (DEFAULT_LIFT, true),
        None if style.ditch == "dry" || style.dry_ditches => (f64::NEG_INFINITY, false),
        None => (DEFAULT_LIFT, false),
    };
    // Depth of the ditch, lip to bottom: the style's, else drawn in its form's range, else from its width.
    let lo = num(row, "depthM", (dw * 0.35).clamp(1.5, 4.0));
    let hi = num(row, "depthMaxM", lo);
    let depth = if style.ditch_depth > 0.0 { style.ditch_depth } else if hi > lo { dr.fork("moat-depth").range(lo, hi) } else { lo };
    Moat { berm, dw, ditch_kind, depth, form: id, lift, culture_wet, canal: water == Some("fed") && !style.cave }
}

/// Lip regularity of a form.
fn outline(form: &str) -> Outline {
    match form {
        "revetted" | "timbered" | "canal" | "rockcut" => Outline::Regular,
        "bastioned" | "ceremonial" => Outline::Traced,
        _ => Outline::Rough,
    }
}

/// The ravelins, then the moat line of the circuit, the land it reserves (berm, ditch, outer bank) and
/// the glacis. Returns the runs and the detached ditches (ravelin trenches, kind `dry`).
#[allow(clippy::too_many_arguments)]
pub(super) fn dig_moat(
    ctx: &BuildContext<'_>,
    walk: &WallWalk<'_>,
    e: &Enclosure,
    infos: &[GateInfo],
    major_land: &[usize],
    works: &mut Works,
    moat: Moat,
    hull: Vec<Shape>,
    shore_gaps: &[(f64, f64)],
    neighbour: Option<&Shape>,
) -> (Vec<MoatRun>, Vec<Work>) {
    let &BuildContext { path, poly, face, ns, inner_core, height, clear, surface, .. } = ctx;
    let Moat { berm, dw, depth, .. } = moat;
    if moat.ditch_kind.is_none() {
        return (vec![], vec![]);
    }
    let Works { towers, gatehouses, bastions, bastion_union, outworks, extra_reserve, .. } = works;
    let mut ravelin_cut: Vec<Shape> = vec![];
    let mut ravelin_ditch: Vec<Shape> = vec![];
    if ctx.has("ravelin") {
        for &gi in major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let base = add(q, info.n, face + berm + dw * 0.5);
            let tri = g::normalized(Shape {
                outer: vec![
                    add(base, info.t, -30.0),
                    add(base, info.n, 35.0),
                    add(base, info.t, 30.0),
                ],
                holes: vec![],
            });
            // Rule 4: one ravelin per front; a gate close to a built one
            // shares it.
            if ctx.dry_share(std::slice::from_ref(&tri)) < 0.9
                || !ctx.dry_points(&tri)
                || ravelin_cut
                    .iter()
                    .any(|r| area(&g::intersection(r, &tri)) > 1.0)
            {
                continue;
            }
            let pieces = clear.from(inner_core.from(
                bastion_union.iter().fold(vec![tri.clone()], |acc, b| {
                    acc.iter().flat_map(|p| g::difference(p, b)).collect()
                }),
            ));
            let pieces: Vec<Shape> = Cut::new(
                towers
                    .iter()
                    .map(|t| t.footprint.clone())
                    .chain(gatehouses.iter().flat_map(|gh| gh.masses.clone()))
                    .collect(),
            )
            .from(pieces);
            if area(&pieces) < 0.6 * g::area(&tri) {
                continue;
            }
            ravelin_cut.push(tri.clone());
            ravelin_ditch.extend(
                buffer(&tri, 8.0)
                    .iter()
                    .flat_map(|b| g::difference(b, &tri)),
            );
            for p in pieces.into_iter().filter(|p| g::area(p) >= 30.0) {
                outworks.push(Work {
                    kind: "ravelin".into(),
                    shape: p,
                    height_m: height * 0.8,
                    passage: Some([add(base, info.s, -dw * 0.5), add(base, info.s, 40.0)]),
                });
            }
        }
    }
    // No ditch is dug along a shore passage: its open rock keeps no moat. A ravelin is an island in
    // the ditch: the run passes between it and the curtain, its outer lip round it.
    let mut blocked: Vec<Shape> = neighbour.cloned().into_iter().collect();
    blocked.extend(ctx.streets.iter()
        .filter(|s| matches!(s.role.as_str(), "quay" | "pier" | "landing" | "boardwalk" | "mole"))
        .flat_map(|s| g::ribbon(&s.path, &s.widths)));
    blocked.extend(crate::urban::macroplan::harbour::seaward(ctx.streets, surface)
        .iter().flat_map(|(path, widths)| g::ribbon(path, widths)));
    blocked.extend(
        shore_gaps
            .iter()
            .flat_map(|&(a, l)| {
                let n = (l / 8.0).ceil().max(1.0) as usize;
                (0..n).map(move |i| (a + l * i as f64 / n as f64, a + l * (i + 1) as f64 / n as f64)).collect::<Vec<_>>()
            })
            .map(|(s0, s1)| {
                let (p0, k) = walk.along(s0);
                let (p1, _) = walk.along(s1);
                let wd = face + berm + dw + 30.0;
                quad(p0, dir(p0, p1), ns[k], [0.0, dist(p0, p1)], [-wd, wd])
            }),
    );
    let clearance: Vec<Shape> = towers
        .iter()
        .map(|t| t.footprint.clone())
        .chain(gatehouses.iter().flat_map(|gh| gh.masses.iter().cloned()))
        .chain(bastions.iter().map(|b| b.shape.clone()))
        .chain(outworks.iter().filter(|w| w.kind != "ravelin").map(|w| w.shape.clone()))
        .collect();
    let line = moat_line::moat_line(&MoatLineInput {
        path,
        hull: &hull,
        face,
        berm,
        width: dw,
        depth,
        works: &clearance,
        blocked: &blocked,
        islands: &ravelin_cut,
        surface,
        outline: outline(moat.form),
        seed: moat_line::path_seed(path),
        lift: moat.lift,
        culture_wet: moat.culture_wet,
        canal: moat.canal,
    });
    let runs = moat_line::export(&line);
    if runs.is_empty() {
        return (vec![], vec![]);
    }
    // The land of the fortification: the berm between the curtain (or its works) and the ditch along
    // each run, the ditch, the outer bank of the form. No quarter keeps a sliver there; the predicted
    // streets keep their way through it.
    let strips: Vec<Shape> = runs.iter().map(moat_line::run_outline).collect();
    let inner_fill = g::union(&[g::normalized(Shape { outer: line.ring.iter().map(|s| s.inner).collect(), holes: vec![] })]);
    let back = runs
        .iter()
        .flat_map(|r| r.inner.iter())
        .map(|&p| path.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min))
        .fold(0.0, f64::max)
        + 2.0;
    let near_runs = buffer_all(&strips, back);
    let berm_land: Vec<Shape> = inner_fill
        .iter()
        .flat_map(|f| near_runs.iter().flat_map(move |r| g::intersection(f, r)))
        .flat_map(|s| g::difference(&s, poly))
        .collect();
    extra_reserve.extend(clear.from(tiles(berm_land, TILE)));
    extra_reserve.extend(clear.from(tiles(strips.clone(), TILE)));
    let fills: Vec<Shape> = runs.iter().map(moat_line::outer_fill).collect();
    let held = Cut::new(fills.iter().chain(&inner_fill).cloned().collect());
    let beyond = |d: f64| held.from(tiles(buffer_all(&fills, d), TILE));
    // The outer bank of the form (the spoil thrown up beyond the counterscarp) stands on reserved land.
    let bank = form(moat.form)["bankM"][0].as_f64().unwrap_or(0.0);
    if bank > 0.0 {
        extra_reserve.extend(clear.from(beyond(bank)));
    }
    if ctx.has("glacis") {
        let band = Cut::new(ravelin_cut.iter().chain(&ravelin_ditch).cloned().collect()).from(beyond(20.0));
        for p in g::union(&clear.from(band)) {
            for shape in g::dry_clip(&surface, &p).into_iter().filter(|d| g::area(d) > 20.0) {
                outworks.push(Work { kind: "glacis".into(), shape, height_m: 0.0, passage: None });
            }
        }
    }
    // The trench round each ravelin: a detached dry ditch, short of natural water.
    let mut taken = strips;
    taken.extend(ravelin_cut);
    let trench = Cut::new(taken).from(clear.from(inner_core.from(tiles(g::union(&ravelin_ditch), TILE))));
    let detached = trench
        .iter()
        .flat_map(|p| g::dry_clip(&surface, p))
        .filter(|d| g::area(d) > 20.0 && !d.outer.iter().any(|&q| near_water(q, MOAT_SHORT, surface)))
        .map(|shape| Work { kind: "dry".into(), shape, height_m: depth, passage: None })
        .collect();
    (runs, detached)
}

/// The row of a ditch form in the `moats` table of fortifications.json.
pub(super) fn form(id: &str) -> &'static serde_json::Value {
    &data()["moats"][id]
}

/// The moat of a built circuit from its `runs` (none: no moat). `e.ditch` holds one piece per reach,
/// then the `detached` ditches.
pub(super) fn assemble(e: &mut Enclosure, moat: Moat, runs: Vec<MoatRun>, detached: Vec<Work>, streets: &[Street], surface: Surface<'_>) {
    e.moat = (!runs.is_empty()).then(|| MoatSpec { form: moat.form.into(), width_m: moat.dw, depth_m: moat.depth, runs, ..Default::default() });
    refresh(e, detached, streets, surface);
}

/// Dry embedded rain pools locally and refresh the works against the final streets and gates.
pub(super) fn resolve(e: &mut Enclosure, streets: &[Street], built: &[(Box2, &Shape)], state: &str, surface: Surface<'_>) {
    let derived = e.moat.as_ref().map_or(0, |m| moat_line::reach_count(&m.runs)).min(e.ditch.len());
    let detached = e.ditch.split_off(derived);
    if let Some(m) = e.moat.as_mut() {
        m.state = state.into();
        for run in &mut m.runs {
            if !built.is_empty() {
                moat_line::dry_pools(run, |inner, outer| embedded(inner, outer, built));
            }
        }
    }
    refresh(e, detached, streets, surface);
}

/// Clip the detached ditches to the same neighbour that bounded the runs at excavation.
pub(super) fn keep_off(e: &mut Enclosure, other: &Shape) {
    let derived = e.moat.as_ref().map_or(0, |m| moat_line::reach_count(&m.runs)).min(e.ditch.len());
    let detached: Vec<Work> = e
        .ditch
        .split_off(derived)
        .into_iter()
        .flat_map(|k| g::difference(&k.shape, other).into_iter().filter(|s| g::area(s) > 20.0).map(move |shape| Work { shape, ..k.clone() }))
        .collect();
    e.ditch.extend(detached);
}

/// Crossings, dams, sluices and the ditch pieces of `e.moat`, from its runs; `detached` follow them.
fn refresh(e: &mut Enclosure, detached: Vec<Work>, streets: &[Street], surface: Surface<'_>) {
    let Some(m) = e.moat.as_mut() else {
        e.ditch = detached;
        return;
    };
    let earth = form(&m.form)["revetment"].as_str() == Some("earth");
    m.crossings = moat_line::crossings(&m.runs, &e.gates, &e.gatehouses, streets, earth).0;
    m.dams = moat_line::dams(&m.runs);
    m.sluices = moat_line::sluices(&m.runs, surface);
    e.ditch = moat_line::ditch(&m.runs, m.depth_m);
    e.ditch.extend(detached);
}

/// Depths (m) beyond a moat's outer edge at which the town is looked for.
const EMBED_DEPTHS: [f64; 4] = [10.0, 30.0, 60.0, 100.0];
/// An unfed section is inside the town when at least three depths beyond its bank are built up.
pub(super) fn embedded(inner: Point, outer: Point, built: &[(Box2, &Shape)]) -> bool {
    let normal = dir(inner, outer);
    EMBED_DEPTHS.iter().filter(|&&d| {
        let q = add(outer, normal, d);
        built.iter().any(|(b, s)| q.x >= b.0 && q.x <= b.2 && q.y >= b.1 && q.y <= b.3 && g::contains(s, q))
    }).count() >= 3
}
