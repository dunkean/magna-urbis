//! Reconcile fortifications, streets and buildable land after the layout is drawn.

use crate::rng::Rng;
use crate::urban::{Layout, Point, Shape, Street, Surface, Work, composition, geometry as g};
use crate::urban::profile::Lap;
use super::build::build;
use super::crossings::{close_crossings, stop_at_curtains};
use super::gate_budget::{self, Circuit};
use super::geometry::{Box2, Cut, closed, dist, pt, terrain};
use super::moat::{continuous_moat, embedded};
use super::reconcile::{guard_main_gates, reconcile_gates};
use super::reserve::{fronted, gate_masses, release_gate_reserve, trim_blocks};
use super::street_clearance::{Near, Predicted, near_ribbons};
use super::style::{Inputs, resolve};

/// Last word on the gates, once every later stage has moved streets
/// (bridges, walkways, trims): `settle`'s rule against the final network.
/// A gatehouse whose gate closed goes with it.
pub(in super::super) fn sync_gates(layout: &mut Layout, surface: Surface<'_>) {
    let mut laps = Lap::new("sync_gates");
    let old_masses = gate_masses(layout);
    // Late streets (bridgeheads, bank links) obey the same crossing rule.
    close_crossings(&mut layout.streets, &layout.enclosures, false, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
    laps.lap("close_minor_crossings");
    let streets = std::mem::take(&mut layout.streets);
    for e in layout.enclosures.iter_mut().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let remap = reconcile_gates(e, &streets, surface);
        e.gatehouses = std::mem::take(&mut e.gatehouses)
            .into_iter()
            .filter_map(|mut gh| {
                gh.gate = remap.get(gh.gate).copied().flatten()?;
                Some(gh)
            })
            .collect();
    }
    layout.streets = streets;
    laps.lap("reconcile");
    release_gate_reserve(layout, old_masses);
    laps.lap("release");
}

/// Final pass, once streets, blocks and access lanes are final
/// (`generate_quarters`): `build`'s rules against the final town, so they
/// hold on the layout that is drawn, whatever later stages added or pruned.
/// - Gates are the real crossings of the final network: a pruned street
///   closes its gate (and its gatehouse), a later street crossing the curtain
///   opens a plain gate; water gates stay.
/// - Rule 2: every structure keeps off the final street ribbons (+1 m);
///   towers, gatehouse masses, bastions and lean-tos keep 60 % of their area
///   in one piece or are dropped, ditch, glacis and outworks are cut
///   (causeways), and a land gatehouse keeps its passage on a street.
/// - The reserve is what the fortification still holds; blocks give it up
///   (pieces under `MIN_BLOCK_PIECE` m² return to open land).
pub(in super::super) fn settle(layout: &mut Layout, surface: Surface<'_>) {
    let old_masses = gate_masses(layout);
    // Ribbons of the diversions laid here, which the blocks give up like the reserve.
    let mut extra_mural: Vec<Shape> = vec![];
    // Forced footprint circuits enter from the macroplan without detailed
    // works. They obey the same water, reserve and gate rules as historical ones.
    if layout.enclosures.iter().any(|e| e.style.is_empty() && e.path.len()>=4) {
        let cfg = layout.config.clone().unwrap_or_default();
        let pop = layout.structure.as_ref().map_or_else(|| layout.phases.iter().map(|p|p.population).sum(),
            |s|s.metrics.planned_population).max(500.0).round() as u32;
        let predicted = Predicted {widths:[9.0,8.0,5.0,3.5,3.0],arterial:1,dwelling:[5.0;2]};
        for (i,e) in layout.enclosures.iter_mut().enumerate().filter(|(_,e)|e.style.is_empty() && e.path.len()>=4) {
            let circuit = g::normalized(Shape {outer:e.path[..e.path.len()-1].to_vec(),holes:vec![]});
            let (relief,_) = terrain(&[circuit],surface);
            let rng = Rng::new(&layout.key).fork(&format!("final-circuit:{i}"));
            let mut style = resolve(&e.kind,&Inputs {culture:&layout.culture,pop,period:&cfg.programme.period,
                state:"",archetype:&layout.archetype,forced:&cfg.fortification_style,relief},&rng,&mut layout.warnings);
            style.options(&cfg);
            // Its land gates are decided like those of a traced circuit, on the streets as they
            // stand: a curtain the fit drew back turns square to the streets it now crosses. A gate
            // point it came with that is no street crossing (a regional road ending on it) stays.
            let crossed = composition::gates(&e.path,&layout.streets);
            let squared = !matches!(style.id.as_str(),"bastioned"|"wengcheng") && e.path.len()>6;
            let (wall,kept,dropped) = gate_budget::decide(&Shape {outer:e.path[..e.path.len()-1].to_vec(),holes:vec![]},&mut layout.streets,
                &Circuit {pop,purpose:&e.purpose,kind:&e.kind,curtain_width:style.curtain_width,moat:style.ditch_width[1],
                    grade:cfg.max_street_grade,squared,key:&layout.key,improvisation:cfg.street_improvisation},surface);
            e.path = closed(&wall.outer);
            e.gates.retain(|&q|crossed.iter().all(|&c|dist(c,q)>=8.0));
            for p in composition::gates(&e.path,&layout.streets) {
                if e.gates.iter().all(|&g|dist(g,p)>=8.0) {e.gates.push(p);}
            }
            let land = e.gates.len();
            let banks = composition::water_gates(&e.path,surface);
            for &(p,_) in &banks { if e.gates.iter().all(|&g|dist(g,p)>=8.0) {e.gates.push(p);} }
            // Access lanes added this late would change the road network.
            style.attached = 0.0;
            build(e,land,&banks,&layout.streets,surface,&style,pop,&predicted,&rng);
            let laid = layout.streets.len();
            gate_budget::divert(e,&kept,&dropped,&mut layout.streets,surface,cfg.max_street_grade);
            // The blocks give up each diversion and the strip between it and the moat (4 m + margin):
            // no unbuildable sliver is left against the reserve; the land beyond fronts the new road.
            extra_mural.extend(layout.streets[laid..].iter().flat_map(|s|g::ribbon(&s.path,&vec![s.widths[0]+10.0;s.path.len()])));
        }
    }
    if layout.enclosures.iter().all(|e| e.style.is_empty()) {
        return;
    }
    // The gates are decided: a street that crosses a curtain elsewhere ends at the wall.
    close_crossings(&mut layout.streets, &layout.enclosures, true, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(not(target_arch = "wasm32"))]
    let blocks_before = layout.blocks.len();
    let streets: Vec<&Street> = layout
        .streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .collect();
    let mut reserve_all: Vec<(Shape, Box2)> = vec![];
    let culture = layout.culture.clone();
    let pop = layout.structure.as_ref().map_or_else(|| layout.phases.iter().map(|p| p.population).sum(),
        |s| s.metrics.planned_population).max(500.0).round() as u32;
    // Built land of the final plan, for moats the town has grown round.
    let built: Vec<(Box2, &Shape)> = layout.blocks.iter()
        .filter(|b| matches!(b.kind.as_str(), "block" | "place"))
        .map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    for e in layout
        .enclosures
        .iter_mut()
        .filter(|e| !e.style.is_empty() && e.path.len() >= 4)
    {
        let poly = g::normalized(Shape {
            outer: e.path[..e.path.len() - 1].to_vec(),
            holes: vec![],
        });
        // Reach of the structures from the curtain (the citadel, the glacis).
        let reach = e
            .towers_detail
            .iter()
            .map(|t| &t.footprint)
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter()))
            .chain(e.bastions.iter().map(|w| &w.shape))
            .chain(e.outworks.iter().map(|w| &w.shape))
            .chain(e.ditch.iter().map(|w| &w.shape))
            .chain(e.attached.iter().map(|w| &w.shape))
            .chain(e.reserve.iter())
            .flat_map(|s| s.outer.iter())
            .map(|&p| {
                e.path
                    .windows(2)
                    .map(|w| g::distance(p, w[0], w[1]).0)
                    .fold(f64::INFINITY, f64::min)
            })
            .fold(0.0, f64::max)
            + 5.0;
        let ribbons = Cut::new(near_ribbons(&e.path, &streets, reach, &poly, |s, i, _| {
            s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0) + 1.0
        }));
        // Final street segments near the curtain, with their half width.
        let near = Near::new(&e.path, reach);
        let segs: Vec<(Point, Point, f64)> = streets
            .iter()
            .flat_map(|s| {
                s.path.windows(2).enumerate().filter_map(|(i, w)| {
                    near.distance(w[0], w[1]).is_finite().then(|| {
                        let wd = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0);
                        (w[0], w[1], wd * 0.5)
                    })
                })
            })
            .collect();
        let on_street = |p: Point, slack: f64| {
            segs.iter()
                .any(|&(a, b, hw)| g::distance(p, a, b).0 < hw + slack)
        };
        // --- gates
        let remap = reconcile_gates(e, &layout.streets, surface);
        // --- structures
        let keep_most = |s: &Shape| -> Option<Shape> {
            let full = g::area(s);
            let best = ribbons
                .from(vec![s.clone()])
                .into_iter()
                .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
            (g::area(&best) >= 0.6 * full).then_some(best)
        };
        let cut = |list: Vec<Work>, min: f64| -> Vec<Work> {
            list.into_iter()
                .flat_map(|w| {
                    ribbons
                        .from(vec![w.shape.clone()])
                        .into_iter()
                        .filter(|p| g::area(p) >= min)
                        .map(|shape| Work { shape, ..w.clone() })
                        .collect::<Vec<_>>()
                })
                .collect()
        };
        e.towers_detail = std::mem::take(&mut e.towers_detail)
            .into_iter()
            .filter_map(|mut t| {
                t.footprint = keep_most(&t.footprint)?;
                Some(t)
            })
            .collect();
        e.towers = e.towers_detail.iter().map(|t| t.anchor).collect();
        e.gatehouses = std::mem::take(&mut e.gatehouses)
            .into_iter()
            .filter_map(|mut gh| {
                gh.gate = remap.get(gh.gate).copied().flatten()?;
                gh.masses = gh
                    .masses
                    .iter()
                    .flat_map(|m| ribbons.from(vec![m.clone()]))
                    .filter(|m| g::area(m) >= 4.0)
                    .collect();
                if matches!(gh.kind.as_str(), "water" | "shore") {
                    return Some(gh);
                }
                let mid = pt(
                    (gh.passage[0].x + gh.passage[1].x) * 0.5,
                    (gh.passage[0].y + gh.passage[1].y) * 0.5,
                );
                (!gh.masses.is_empty() && on_street(mid, 0.5)).then_some(gh)
            })
            .collect();
        guard_main_gates(e, &streets, &ribbons, &culture, pop, surface);
        e.bastions = std::mem::take(&mut e.bastions)
            .into_iter()
            .filter_map(|mut b| {
                b.shape = keep_most(&b.shape)?;
                Some(b)
            })
            .collect();
        e.attached = std::mem::take(&mut e.attached)
            .into_iter()
            .filter_map(|mut a| {
                a.shape = keep_most(&a.shape)?;
                Some(a)
            })
            .collect();
        let (continuous, works): (Vec<_>, Vec<_>) = std::mem::take(&mut e.outworks).into_iter()
            .partition(|w| matches!(w.kind.as_str(), "outer-wall" | "antemural"));
        e.outworks = cut(works, 10.0);
        e.outworks.extend(continuous);
        e.ditch = continuous_moat(cut(std::mem::take(&mut e.ditch), 20.0), &e.path, surface);
        // A moat the town has grown round holds no water. Its wet pieces dry
        // together, when most of their area lies inside the built town.
        let wet_area: f64 = e.ditch.iter().filter(|d| d.kind == "wet").map(|d| g::area(&d.shape)).sum();
        let inside: f64 = e.ditch.iter().filter(|d| d.kind == "wet" && embedded(&d.shape, &e.path, &built)).map(|d| g::area(&d.shape)).sum();
        if wet_area > 0.0 && inside * 2.0 >= wet_area {
            for d in e.ditch.iter_mut().filter(|d| d.kind == "wet") {
                d.kind = "dry".into();
            }
        }
        e.reserve = ribbons
            .from(std::mem::take(&mut e.reserve))
            .into_iter()
            .filter(|s| g::area(s) > 0.5)
            .collect();
        reserve_all.extend(e.reserve.iter().map(|s| (s.clone(), g::bbox(s))));
        // Reserve exception (faubourg against the wall): an outer lean-to
        // with a street edge (an edge of at least 3 m whose middle lies
        // within 2 m of a final street ribbon) leaves the reserve and becomes
        // a lot (`parcels::lean_to_lots`). Blocks still give its land up.
        let served: Vec<Shape> = e
            .attached
            .iter()
            .filter(|a| a.side == "out" && fronted(&a.shape, &segs))
            .map(|a| a.shape.clone())
            .collect();
        if !served.is_empty() {
            let freed = Cut::new(served);
            e.reserve = freed
                .from(std::mem::take(&mut e.reserve))
                .into_iter()
                .filter(|s| g::area(s) > 0.5)
                .collect();
        }
    }
    let freed = release_gate_reserve(layout, old_masses);
    let reserve_all: Vec<_> = Cut::new(freed).from(reserve_all.into_iter().map(|(s, _)| s).collect()).into_iter()
        .map(|s| { let bb = g::bbox(&s); (s, bb) }).collect();
    // Blocks give up the diversions too (their houses would stand on them).
    let mut reserve_all = reserve_all;
    reserve_all.extend(extra_mural.into_iter().map(|s| { let bb = g::bbox(&s); (s, bb) }));
    if reserve_all.is_empty() {
        return;
    }
    trim_blocks(layout, reserve_all);
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  fortification settle: blocks {blocks_before} -> {}, {:.0} ms",
            layout.blocks.len(),
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
}
