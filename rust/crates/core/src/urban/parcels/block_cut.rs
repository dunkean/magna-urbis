//! Order of the cutting, qualification and repair passes for an individual block.

use super::{camp, contacts, families, organic, tidy};
use super::block_preparation::{Preparation, PreparedBlock};
use super::cadastre::{BlockCut, ProbeInputs, cut_with_memo};
use super::consolidation::merge_lots;
use super::contacts::{Front, FrontageIndex, frontage, frontages, network_contacts};
use super::court_pairs::{COURT_PAIR_SHARE, pair_courts};
use super::cut_geometry::{dot, length, sub, unit};
use super::depth::{bound_frontage_depth, lot_depth, maximum_plot_depth};
use super::fields::{GARDEN_FLOOR, keep_gardens};
use super::identity::{block_identity, disambiguate, identity, parcel, resolve_identity};
use super::oriented::{courtyards, frontage_territories};
use super::qualification::{answers_tier, qualify, rule_of, seat};
use super::strip_layout::strips;
use super::wall_lots::wall_contact;
use crate::rng::Rng;
use crate::urban::{Block, Parcel, Point, Shape, warnings};
use crate::urban::geometry::area;

pub(super) fn cut_block(
    seed: &str,
    preparation: &Preparation<'_>,
    index: &FrontageIndex,
    root: &Rng,
    bi: usize,
    block: &Block,
    covered: bool,
) -> BlockCut {
    let Preparation { layout, cfg, culture, plan, .. } = *preparation;
    let mut out = BlockCut::default();
    // A block the user deleted (`edits/blocks.rs`) is open ground.
    if block.kind == crate::urban::edits::blocks::DELETED {
        return out;
    }
    let block_id = block_identity(layout, &block.shape);
    let prepared = preparation.block(bi, block);
    let PreparedBlock {
        block_edit, block_culture, operator, period, route_op, zone, dense_souk, occupation,
        morph, faces, borrowed, ..
    } = &prepared;
    if block.kind != "block" {
        out.diagnostics.covered_area += area(&block.shape);
        out.parcels.push(Parcel {
            pressure: *occupation,
            envelope: None,
            id: identity(&block.shape, bi),
            parent_ids: vec![format!("block-{bi}")],
            provenance: vec!["preserved-reserve".into()],
            family: "reserve".into(),
            reason: block.kind.clone(),
            contacts: network_contacts(&block.shape, layout, index),
            shape: block.shape.clone(),
            block: bi,
            axis: block.axis,
            use_kind: block.kind.split(':').next().unwrap_or("place").to_owned(),
            front: None,
            rank: 99,
            access: Some(crate::urban::ParcelAccess {
                kind: "reserved".into(),
                street: None,
                front_length: 0.0,
            }),
        });
        resolve_identity(out.parcels.last_mut().unwrap(), bi, &block_id);
        return out;
    }
    let mut fork_label = crate::urban::edits::block_fork(&block_id, layout, block.quarter);
    if let Some(salt) = block_edit.and_then(|e| e.salt).filter(|s| *s > 0) { fork_label.push_str(&format!("/block-salt:{salt}")); }
    // Probe memo (`probe_cache`): the cut below reads exactly the inputs
    // keyed here. Camps read the whole layout and are never memoised.
    let block_fronts = frontages(&block.shape, layout, index);
    let memoise = crate::urban::probe_cache::enabled() && !(operator.as_str() == "culture" && camp::enabled(morph));
    let inputs = ProbeInputs {
        seed, cfg, layout, fronts: &block_fronts, bi, block, block_id: &block_id,
        fork_label: &fork_label, culture, block_culture, period, route_op,
        operator, zone, dense_souk: *dense_souk, occupation: *occupation,
        morph, faces, plan, borrowed: *borrowed,
    };
    cut_with_memo(inputs, memoise, covered, || {
        cut_regular(preparation, &prepared, index, block, bi, &block_id, root, &fork_label, &block_fronts)
    })
}

fn cut_regular(
    preparation: &Preparation<'_>,
    prepared: &PreparedBlock<'_>,
    index: &FrontageIndex,
    block: &Block,
    bi: usize,
    block_id: &str,
    root: &Rng,
    fork_label: &str,
    block_fronts: &[Front],
) -> BlockCut {
    let Preparation { layout, cfg, plan, .. } = *preparation;
    let PreparedBlock {
        block_culture, operator, zone, dense_souk, occupation,
        morph, faces, admission, fallback, pack, borrowed, ..
    } = prepared;
    let (block_culture, operator) = (*block_culture, *operator);
    let (dense_souk, occupation, borrowed) = (*dense_souk, *occupation, *borrowed);
    let backed = |p: &Parcel| wall_contact(&p.shape, faces) >= 2.0;
    let mut out = BlockCut::default();
    let mut rng = root.fork(fork_label);
    let mut axis = unit(block.axis);
    if length(axis) < 0.5 {
        axis = Point { x: 1.0, y: 0.0 };
    }
    if morph.text("streetOp") != "grid" {
        let tilt = morph.number("plotTilt").clamp(0.0, 12.0);
        let angle = rng.fork("parcel-frame").range(-tilt, tilt).to_radians();
        axis = Point {
            x: axis.x * angle.cos() - axis.y * angle.sin(),
            y: axis.x * angle.sin() + axis.y * angle.cos(),
        };
    }
    let mut fronts = block_fronts.to_vec();
    if admission.is_none() && crate::urban::culture::mapping(block_culture).is_some() {
        let mut retained = parcel(block.shape.clone(), bi, axis, &fronts, "residual");
        retained.reason = "unsupported-period-profile".into();
        retained.family = families::family(morph.text("plotOp")).into();
        retained.pressure = occupation;
        retained.contacts = network_contacts(&block.shape, layout, index);
        retained
            .provenance
            .push("period-admission-unavailable".into());
        resolve_identity(&mut retained, bi, block_id);
        out.parcels.push(retained);
        out.diagnostics.covered_area += area(&block.shape);
        return out;
    }
    if fronts.is_empty() && morph.text("plotOp") != "garden" {
        // A removed or impracticable road cannot confer residential access:
        // the land returns to open, non-urban ground (a strip between a
        // wall and the water, a block whose street was dropped), never a
        // residual lot.
        let mut unserved = parcel(block.shape.clone(), bi, axis, &[], "garden");
        unserved.pressure = occupation;
        unserved.use_kind = "reserve".into();
        unserved.reason = "no-street-contact".into();
        unserved.family = "reserve".into();
        unserved.rank = 99;
        // Counted in `unserved_area`: its access says so too.
        unserved.access = Some(crate::urban::ParcelAccess {
            kind: "unserved".into(),
            street: None,
            front_length: 0.0,
        });
        out.warnings.push(warnings::open_block(bi));
        resolve_identity(&mut unserved, bi, block_id);
        out.parcels.push(unserved);
        out.diagnostics.covered_area += area(&block.shape);
        out.diagnostics.unserved_area += area(&block.shape);
        return out;
    }
    let shared_courts = matches!(operator.as_str(), "courtyard" | "compound")
        || crate::urban::culture::mapping(block_culture)
            .is_some_and(|m| m.admissibility.shared_access);
    // Organic tissue (catalogue `parcellation: organic`, elven groves): a
    // relaxed Voronoi cut with footpaths, no frontage strips or depth bound.
    // Camps (catalogue `campLayout`: kraal, tipi circle, ordu, longhouse
    // rows) lay out the whole settlement's rings or rows; they share the
    // organic tissue's passes (no frontage depth bound, footpath access).
    let camp = operator == "culture" && camp::enabled(morph);
    let organic = camp || operator == "culture" && organic::enabled(morph);
    let mut parcels = match morph.text("plotOp") {
        _ if camp => camp::lots(&block.shape, bi, axis, &mut fronts, morph, layout),
        _ if organic => {
            organic::lots(&block.shape, bi, axis, &mut fronts, morph, zone, &mut rng, camp::organic_budget(layout, bi))
        }
        "garden" => {
            let mut p = parcel(block.shape.clone(), bi, axis, &fronts, "garden");
            p.reason = "intentional-garden".into();
            vec![p]
        }
        "compact" => courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng),
        "courtyard" if shared_courts => {
            families::derbs(&block.shape, bi, axis, &mut fronts, morph, zone, &mut rng)
        }
        "courtyard" | "compound" => {
            if shared_courts {
                families::courts(&block.shape, bi, axis, &mut fronts, morph, zone, &mut rng)
            } else {
                courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
            }
        }
        "inherited" => {
            families::inherited(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
        }
        "wholeBlock" => vec![parcel(block.shape.clone(), bi, axis, &fronts, "plot")],
        "frontage" => {
            frontage_territories(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
        }
        _ => {
            let house = morph.range("houseArea", zone)[1].max(60.0);
            let block_area = area(&block.shape);
            if block_area < 1.6 * house || (dense_souk && block_area < 3.0 * house) {
                // A block of one or two houses is split by area into
                // compact lots, never into a comb of slivers.
                let mut lots =
                    courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng);
                for p in &mut lots {
                    p.provenance.push("compact-small-block".into());
                }
                lots
            } else if dense_souk {
                // Souk shops line only the main streets; behind them the
                // block holds courtyard houses on its lanes and derbs.
                let main: Vec<Front> = fronts.iter().filter(|f| f.rank <= 1).copied().collect();
                let shops = if main.is_empty() {
                    vec![parcel(block.shape.clone(), bi, axis, &[], "garden")]
                } else {
                    strips(&block.shape, bi, axis, &main, morph, zone, &mut rng)
                };
                let mut lots = vec![];
                for (i, p) in shops.into_iter().enumerate() {
                    if p.use_kind != "garden"
                        || area(&p.shape) < morph.range("houseArea", zone)[0]
                    {
                        lots.push(p);
                        continue;
                    }
                    let mut rr = rng.fork(&format!("souk-court:{i}"));
                    for mut q in courtyards(&p.shape, bi, axis, &fronts, morph, zone, &mut rr) {
                        if frontage(&q.shape, &fronts).0 < 3.0 {
                            q.use_kind = "garden".into();
                            q.reason = "retained-backland".into();
                        }
                        q.provenance.push("souk-courtyard-house".into());
                        lots.push(q);
                    }
                }
                lots
            } else {
                strips(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
            }
        }
    };
    if morph.text("plotOp") == "siheyuan" {
        let threshold = (morph.range("houseArea", zone)[1] * 1.8).max(1600.0);
        let mut refined = Vec::new();
        for (pi, p) in parcels.into_iter().enumerate() {
            if p.front.is_none() || area(&p.shape) <= threshold {
                refined.push(p);
                continue;
            }
            let parts = courtyards(
                &p.shape,
                bi,
                axis,
                &fronts,
                morph,
                zone,
                &mut rng.fork(&format!("siheyuan:{pi}")),
            );
            let accessed = parts.iter().filter(|p| p.front.is_some()).count();
            if accessed >= 2 || accessed == 1 && parts.iter().any(|p| p.use_kind == "garden") {
                refined.extend(parts);
            } else {
                refined.push(p);
            }
        }
        parcels = refined;
    }
    if !organic && !matches!(morph.text("plotOp"), "compound" | "wholeBlock") {
        let depth = maximum_plot_depth(morph, zone);
        parcels = parcels
            .into_iter()
            .flat_map(|p| {
                let d = if backed(&p) { 1.25 * depth } else { depth };
                bound_frontage_depth(p, d)
            })
            .collect();
    }
    let mut admission = admission
        .clone()
        .unwrap_or(crate::urban::culture::UrbanAdmissibility {
            recipe_id: "explicit-fixture-envelope".into(),
            native_layout: "unknown".into(),
            floors: [1, 1],
            eras: Vec::new(),
            min_access_width: 0.8,
            min_frontage: morph.range("frontage", zone)[0].clamp(3.0, 5.0),
            min_area: 35.0,
            min_depth: morph.range("plotDepth", zone)[0].clamp(4.0, 8.0),
            max_slope: 0.15,
            shared_access: true,
            party_walls: true,
        });
    if organic || (matches!(morph.text("plotOp"), "courtyard" | "compound") && shared_courts) {
        admission.shared_access = true;
    }
    let family = families::family(morph.text("plotOp"));
    // Organic tissue and camps have no solidity rule, in the cut as in the
    // plan's score (`camp::admitted_form` passes the same 0).
    let floor = if organic { 0.0 } else { tidy::floor_of(morph) };
    // Dense zones leave no empty land: leftovers are joined (`absorb`).
    let dense = matches!(zone.as_str(), "core" | "middle");
    let depth_limit = (!organic && !matches!(morph.text("plotOp"), "compound" | "wholeBlock"))
        .then(|| maximum_plot_depth(morph, zone));
    qualify(
        &mut parcels,
        &fronts,
        layout,
        &admission,
        fallback.as_ref(),
        family == "courtyard",
        family,
        depth_limit,
        dense,
        floor,
    );
    // Enforce the cultural lot depth from the best access and keep the
    // land behind as its garden.
    if let Some(limit) = depth_limit {
        // A lot against the town wall may reach 1.25x: the curtain is its
        // rear party wall, not back land.
        let reach = |p: &Parcel| if backed(p) { 1.25 * limit } else { limit };
        let (deep, kept): (Vec<_>, Vec<_>) = parcels.into_iter().partition(|p| {
            p.use_kind == "plot" && lot_depth(&p.shape, &fronts) > reach(p) + 0.5
        });
        parcels = kept;
        let mut bounded: Vec<_> = deep
            .into_iter()
            .flat_map(|p| {
                let d = reach(&p);
                bound_frontage_depth(p, d)
            })
            .collect();
        qualify(
            &mut bounded,
            &fronts,
            layout,
            &admission,
            fallback.as_ref(),
            family == "courtyard",
            family,
            depth_limit,
            dense,
            floor,
        );
        parcels.extend(bounded);
    }
    pair_courts(
        &mut parcels,
        &fronts,
        layout,
        &admission,
        fallback.as_ref(),
        family,
        depth_limit,
        pack.as_deref(),
        morph.number_or("courtPairShare", COURT_PAIR_SHARE),
        &mut rng.fork("court-pairs"),
    );
    if let Some(c) =
        plan.filter(|c| !organic && (c.densify > 0.0 || borrowed || c.vacancy < 0.999))
    {
        // The culture's own open land: its lot gardens as drawn, and off
        // the core the fringe fields the plan gave up (`vacancy` < 1).
        let fields = if zone == "core" {
            0.0
        } else {
            (1.0 - c.vacancy).clamp(0.0, 1.0)
                * crate::urban::footprint::capacity::fringe_fields(0.0, 1.0)
        };
        keep_gardens(
            &mut parcels,
            &fronts,
            layout,
            GARDEN_FLOOR * (c.garden_share + fields),
            morph.range("plotDepth", zone)[0],
        );
    }
    if dense_souk {
        let mut refined = Vec::new();
        for mut parent in parcels {
            if parent.use_kind != "plot"
                || parent.reason != "admissibility-repaired"
                || area(&parent.shape) < 2.0 * admission.min_area
            {
                refined.push(parent);
                continue;
            }
            // One bounded attempt with the existing oriented-cut operator.
            // The module is the native admission domain, not a smaller
            // invented house or a requirement to consume a rear garden.
            resolve_identity(&mut parent, bi, block_id);
            let mut module = morph.clone();
            module.value["houseArea"][zone] =
                serde_json::json!([admission.min_area, admission.min_area]);
            module.value["frontage"][zone] =
                serde_json::json!([admission.min_frontage, admission.min_frontage]);
            let mut children = courtyards(
                &parent.shape,
                bi,
                parent.axis,
                &fronts,
                &module,
                zone,
                &mut rng.fork(&format!("native-domain-repartition:{}", parent.id)),
            );
            if children.len() < 2 || children.len() > 8 {
                refined.push(parent);
                continue;
            }
            qualify(
                &mut children,
                &fronts,
                layout,
                &admission,
                fallback.as_ref(),
                family == "courtyard",
                family,
                depth_limit,
                dense,
                floor,
            );
            let admitted = children.len() >= 2
                && children.iter().all(|p| {
                    p.use_kind == "plot"
                        && p.envelope.is_some()
                        && p.access.as_ref().is_some_and(|a| {
                            matches!(a.kind.as_str(), "public" | "private" | "collective")
                        })
                });
            use geo::{Area, BooleanOps};
            let tolerance = 1e-5_f64.max(area(&parent.shape) * 1e-8);
            // i_overlay can panic on degenerate pieces: the split is then not admitted.
            let (difference, overlap) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let merged = geo::algorithm::bool_ops::unary_union(
                    children
                        .iter()
                        .map(|p| crate::urban::geometry::polygon(&p.shape))
                        .collect::<Vec<_>>()
                        .iter(),
                );
                let original = crate::urban::geometry::polygon(&parent.shape);
                let difference = original.difference(&merged).unsigned_area()
                    + merged.difference(&original).unsigned_area();
                let overlap = (children.iter().map(|p| area(&p.shape)).sum::<f64>()
                    - merged.unsigned_area())
                .max(0.0);
                (difference, overlap)
            }))
            .unwrap_or((f64::INFINITY, 0.0));
            if admitted && difference + overlap <= tolerance {
                for p in &mut children {
                    p.parent_ids = vec![parent.id.clone()];
                    p.provenance.extend(parent.provenance.clone());
                    p.provenance.push("native-domain-repartition".into());
                    p.reason = "admissibility-repartitioned".into();
                }
                refined.extend(children);
            } else {
                refined.push(parent);
            }
        }
        parcels = refined;
    }
    {
        let weight = match zone.as_str() {
            "core" => 1.0,
            "middle" => 0.7,
            "edge" | "ring" => 0.4,
            "faubourg" => 0.25,
            _ => 0.15,
        };
        let chance = morph.number("lotMergeChance").clamp(0.0, 1.0)
            * weight
            * (0.4 + 0.6 * occupation.clamp(0.0, 1.0));
        if chance > 0.0
            && !organic
            && !camp
            && !matches!(morph.text("plotOp"), "compound" | "wholeBlock" | "garden")
        {
            merge_lots(
                &mut parcels,
                &fronts,
                chance,
                depth_limit,
                &|probe: &mut Vec<Parcel>| {
                    qualify(
                        probe,
                        &fronts,
                        layout,
                        &admission,
                        fallback.as_ref(),
                        family == "courtyard",
                        family,
                        depth_limit,
                        false,
                        floor,
                    )
                },
                &mut rng.fork("lot-merge"),
            );
        }
    }
    {
        let inward = family == "courtyard";
        let admits = |p: &Parcel, s: &Shape| {
            answers_tier(p, s, &fronts, &admission, fallback.as_ref(), inward)
        };
        let reseat = |p: &mut Parcel| {
            let contacts = contacts::boundary_contacts(&p.shape, &fronts);
            let spans = contacts::support_spans(&contacts);
            let (rule, gated) = rule_of(p, &spans, &admission, fallback.as_ref(), inward);
            // Attached land keeps its owner's access: only its front moves.
            let owned = (p.use_kind != "plot").then(|| p.access.clone());
            seat(p, &contacts, &spans, rule, gated, layout);
            if let Some(access) = owned {
                p.access = access;
            }
            let turns = |a: &Front, b: &Front| {
                length(sub(a.b, a.a)) >= 3.0
                    && length(sub(b.b, b.a)) >= 3.0
                    && dot(unit(sub(a.b, a.a)), unit(sub(b.b, b.a))).abs()
                        < 45.0_f64.to_radians().cos()
            };
            if !contacts.iter().any(|a| contacts.iter().any(|b| turns(a, b))) {
                p.provenance.retain(|x| x != "corner-lot");
            }
        };
        let rules = tidy::Rules {
            floor,
            admits: &admits,
            reseat: &reseat,
        };
        tidy::tidy(&mut parcels, &fronts, depth_limit, organic, dense, &rules);
    }
    // A failed cut cannot turn a served block wholly into gardens when
    // the unsplit frontage still admits a native house. Keep its rear land.
    if morph.text("plotOp") != "garden" && !camp
        && !parcels.iter().any(|p| matches!(p.use_kind.as_str(), "plot" | "compound"))
    {
        let whole = parcel(block.shape.clone(), bi, axis, &fronts, "plot");
        let mut retry = match depth_limit {
            Some(limit) => bound_frontage_depth(whole, limit),
            None => vec![whole],
        };
        qualify(&mut retry, &fronts, layout, &admission, fallback.as_ref(), family == "courtyard", family, depth_limit, dense, floor);
        if retry.iter().any(|p| p.use_kind == "plot" && p.envelope.is_some()) {
            for p in &mut retry { p.provenance.push("served-block-infill".into()); }
            parcels = retry;
        }
    }
    for p in &mut parcels {
        p.pressure = occupation;
        if p.use_kind == "plot" && backed(p) {
            p.provenance.push("curtain-backed".into());
        }
    }
    // A camp's block of open ground (fields inside its fence) is no
    // failed cut, and a clipped cell too small for its hut or tent is
    // open ground, never a residual lot.
    if camp {
        for p in parcels.iter_mut().filter(|p| p.use_kind == "residual") {
            p.use_kind = "garden".into();
            p.reason = "camp-open".into();
        }
    }
    if morph.text("plotOp") != "garden"
        && !camp
        && !parcels.iter().any(|p| p.use_kind == "plot")
        && parcels.iter().all(|p| p.use_kind == "garden")
        && !parcels
            .iter()
            .any(|p| p.provenance.iter().any(|x| x == "dense-leftover"))
    {
        for p in &mut parcels {
            p.use_kind = "residual".into();
            p.reason = "cadastral-operator-failed".into();
        }
    }
    // The coverage accounts (`Coverage`) are added after the cut, by the
    // published cadastre only; their warning goes here.
    let actual: f64 = parcels.iter().map(|p| area(&p.shape)).sum();
    let expected = area(&block.shape);
    out.diagnostics.unserved_area += parcels
        .iter()
        .filter(|p| p.access.as_ref().is_some_and(|a| a.kind == "unserved"))
        .map(|p| area(&p.shape))
        .sum::<f64>();
    out.uncovered = Some(out.warnings.len());
    if (actual - expected).abs() > expected.max(1.0) * 1e-5 {
        out.warnings.push(warnings::parcel_area_residual(bi, actual - expected));
    }
    disambiguate(&mut parcels, bi);
    for p in &mut parcels {
        resolve_identity(p, bi, block_id);
        if cfg.street_aligned_homes && !camp && p.use_kind == "plot" {
            p.provenance.push("street-aligned-home".into());
        }
    }
    out.parcels.extend(parcels);
    out
}
