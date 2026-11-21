//! A small set of cadastral operations; streets and structural block boundaries
//! are immutable inputs. Shared courts are parcel land, never hidden new roads.
use super::contacts::{Front, frontage};
use super::cut_geometry::{add, distance, dot, length, normal, scale, sub, unit};
use super::depth::maximum_plot_depth;
use super::identity::parcel;
use super::lot_envelopes::{rect, rect_within};
use super::oriented::{courtyards, frontage_territories};
use super::seams::{joined, shared};
use super::strip_layout::{ray_limit, strips};
use crate::rng::Rng;
use crate::urban::{Morph, Parcel, Point, Shape};
use crate::urban::geometry::{area, difference, intersection};

pub(super) fn family(op: &str) -> &'static str {
    match op {
        "compact" => "compact",
        "courtyard" | "compound" | "siheyuan" | "wholeBlock" => "courtyard",
        "inherited" => "inherited",
        _ => "frontage",
    }
}

/// Retain a connected court/passage and cut compact properties around it. Its
/// internal boundary supplies collective contacts all tied to the real street.
pub(super) fn courts(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    if morph.range("houseArea", zone)[0] > area(shape) * 0.5 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let Some(f) = fronts
        .iter()
        .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))))
        .copied()
    else {
        return Vec::new();
    };
    let width = morph.range("frontage", zone)[0].clamp(2.4, 4.0);
    let u = unit(sub(f.b, f.a));
    let v = normal(u);
    let mid = scale(add(f.a, f.b), 0.5);
    let cap = ray_limit(
        shape,
        add(mid, scale(v, 0.05)),
        v,
        fronts,
        f.rank,
        f64::INFINITY,
        0.0,
    );
    let depth = morph.range("plotDepth", zone)[0].max(8.0).min(cap * 0.6);
    let court_size = (morph.range("houseArea", zone)[0].sqrt().clamp(6.0, 16.0)
        * morph.value["sharedCourtScale"].as_f64().unwrap_or(1.0).clamp(0.0, 1.0)).max(width);
    // Small domains remain one enclos rather than being hollowed into slivers.
    if !depth.is_finite() || depth < court_size || length(sub(f.b, f.a)) < court_size * 2.0 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let rect = |lo: f64, hi: f64, near: f64, far: f64| Shape {
        outer: vec![
            add(add(mid, scale(u, lo)), scale(v, near)),
            add(add(mid, scale(u, hi)), scale(v, near)),
            add(add(mid, scale(u, hi)), scale(v, far)),
            add(add(mid, scale(u, lo)), scale(v, far)),
        ],
        holes: Vec::new(),
    };
    // The complete minimum-width access spine must fit, including every hole.
    // Connected clipped area alone could otherwise conceal a narrow pinch.
    {
        use geo::{Area, BooleanOps};
        let spine = rect(-width * 0.5, width * 0.5, 0.0, depth);
        // i_overlay can panic on a degenerate block: the spine is then taken not to fit.
        let outside = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            super::super::geometry::polygon(&spine)
                .difference(&super::super::geometry::polygon(shape))
                .unsigned_area()
        }))
        .unwrap_or(f64::INFINITY);
        if outside > 1e-5 {
            return courtyards(shape, block, axis, fronts, morph, zone, rng);
        }
    }
    let passage = rect(-width * 0.5, width * 0.5, -0.05, depth + court_size * 0.5);
    let square = rect(
        -court_size * 0.5,
        court_size * 0.5,
        depth - court_size * 0.5,
        depth + court_size * 0.5,
    );
    let shared = super::super::geometry::union(&[passage, square]);
    let shared: Vec<_> = shared.iter().flat_map(|s| intersection(s, shape)).collect();
    if shared.len() != 1 || frontage(&shared[0], fronts).0 < width * 0.9 {
        return courtyards(shape, block, axis, fronts, morph, zone, rng);
    }
    let court = &shared[0];
    // A clipped/disconnected branch cannot acquire fictional access.
    for ring in std::iter::once(&court.outer).chain(court.holes.iter()) {
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            fronts.push(Front {
                a: b,
                b: a,
                street: f.street,
                rank: f.rank,
                shared: true,
                gate: true,
            });
        }
    }
    let mut result = Vec::new();
    for (i, cell) in difference(shape, court).into_iter().enumerate() {
        result.extend(courtyards(
            &cell,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork(&format!("court-domain:{i}")),
        ));
    }
    let mut parcel = parcel(court.clone(), block, axis, fronts, "court");
    let passage_only = court_size <= width + 1e-6;
    parcel.use_kind = if passage_only { "path" } else { "court" }.into();
    parcel.reason = if passage_only { "shared-passage" } else { "shared-court-and-passage" }.into();
    parcel.provenance = vec!["shared-access-reservation".into()];
    result.push(parcel);
    result
}

#[cfg(test)]
mod compound_access_tests {
    use super::*;
    #[test]
    fn passage_only_compounds_do_not_grow_a_square_head() {
        let shape = super::super::super::geometry::rectangle(0.,0.,100.,100.);
        let morph = Morph {value:serde_json::json!({"plotOp":"compound","sharedCourtScale":0.,
            "houseArea":{"core":[900.,1800.]},"frontage":{"core":[28.,38.]},"plotDepth":{"core":[30.,42.]}})};
        let mut fronts = vec![Front {a:Point {x:0.,y:0.},b:Point {x:100.,y:0.},rank:1,street:0,shared:false,gate:false}];
        let parcels = courts(&shape,0,Point {x:1.,y:0.},&mut fronts,&morph,"core",&mut Rng::new("compound-access"));
        let path = parcels.iter().find(|p|p.reason=="shared-passage").expect("shared access retained");
        assert_eq!(path.use_kind,"path");
        let (x0,_,x1,_) = super::super::super::geometry::bbox(&path.shape);
        assert!((x1-x0-4.).abs()<1e-6,"the passage keeps its 4 m width");
        assert!((parcels.iter().map(|p|area(&p.shape)).sum::<f64>()-area(&shape)).abs()<0.01);
    }
}

/// Older frontage domains survive as explicit ancestors. Only bounded local
/// subdivision/fusion occurs; a structural street or block edge is never moved.
pub(super) fn inherited(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let mut ancestral = morph.clone();
    if let Some(ranges) = ancestral.value["frontage"].as_object_mut() {
        for range in ranges.values_mut() {
            if let Some(values) = range.as_array_mut() {
                for value in values {
                    *value = serde_json::json!(value.as_f64().unwrap_or(8.0) * 1.8);
                }
            }
        }
    }
    let parents = frontage_territories(
        shape,
        block,
        axis,
        fronts,
        &ancestral,
        zone,
        &mut rng.fork("ancestral-domains"),
    );
    let mut result = Vec::new();
    for (i, parent) in parents.into_iter().enumerate() {
        let pressure = morph.value["_occupationPressure"].as_f64().unwrap_or(0.55);
        let divide = rng
            .fork(&format!(
                "inheritance-pressure:{}",
                parent
                    .id
                    .split_once('/')
                    .map_or(parent.id.as_str(), |(_, hash)| hash)
            ))
            .float()
            < 0.2 + 0.75 * pressure;
        if parent.use_kind != "plot" || !divide {
            let mut parent = parent;
            parent.provenance.push("inherited-domain-retained".into());
            result.push(parent);
            continue;
        }
        let mut children = strips(
            &parent.shape,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork(&format!("inheritance:{i}")),
        );
        if children.iter().filter(|p| p.use_kind == "plot").count() < 2 {
            result.push(parent);
            continue;
        }
        // Every fourth divided domain consolidates its nearest pair, preserving
        // their former IDs instead of adding noisy boundary vertices.
        if i % 4 == 0 && children.len() > 2 {
            let candidate = (1..children.len())
                .find(|&j| shared(&children[0].shape, &children[j].shape) > 0.05);
            if let Some(j) = candidate
                && let Some(shape) = joined(&children[0].shape, &children[j].shape)
            {
                let mut merged = parcel(shape, block, axis, fronts, "plot");
                merged.parent_ids = vec![children[0].id.clone(), children[j].id.clone()];
                merged.provenance = vec!["inheritance-consolidation".into()];
                children[0] = merged;
                children.remove(j);
            }
        }
        for child in &mut children {
            if child
                .parent_ids
                .iter()
                .all(|id| id.starts_with("block-") && !id.contains('/'))
            {
                child.parent_ids = vec![parent.id.clone()];
            }
            child.provenance.insert(0, "inherited-subdivision".into());
        }
        result.extend(children);
    }
    result
}

/// Inward courtyard tissue (medina derbs, hutong branches, Byzantine closes).
/// Lots are sized from the culture's house areas and cut along streets; every
/// part of the block farther than one lot band from any access receives a
/// cul-de-sac passage (1.4-2.4 m) ending in a small square. Each passage starts
/// from the nearest street or earlier passage, so they form trees that always
/// reach a street; lots along them are entered through a gate. Passages are
/// shared parcel land (`court`), never new public streets.
pub(super) fn derbs(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    use super::super::geometry::{ContainmentIndex, bbox, union};
    let [amin, amax] = morph.range("houseArea", zone);
    let (amin, amax) = (amin.max(40.0), amax.max(amin.max(40.0)));
    let [f0, f1] = morph.range("frontage", zone);
    let [d0, d1] = morph.range("plotDepth", zone);
    let width = [f0.max(0.75 * amin.sqrt()).max(4.0), 0.0];
    let width = [width[0], f1.max(0.9 * amax.sqrt()).max(width[0])];
    let cap = maximum_plot_depth(morph, zone);
    let depth = [
        d0.max(amin.sqrt()).min(cap),
        d1.max(1.2 * amax.sqrt()).min(cap),
    ];
    let mut lots = morph.clone();
    lots.value["frontage"][zone] = serde_json::json!(width);
    lots.value["plotDepth"][zone] = serde_json::json!(depth);
    lots.value["deepFill"] = serde_json::json!(true);
    let reach = depth[1];
    let total = area(shape);
    // Far samples of the block (a coarse grid, at most ~600 points).
    let (x0, y0, x1, y1) = bbox(shape);
    let step = (reach / 3.0).max((total / 600.0).sqrt()).max(2.0);
    let inside = ContainmentIndex::new(shape);
    let mut samples = Vec::new();
    if total > 1.5 * reach * reach {
        for p in super::super::generation_limits::samples((x0, y0, x1, y1), step, 600) {
            if inside.contains(p) {
                samples.push(p);
            }
        }
    }
    let near = |p: Point, a: Point, b: Point| distance(p, a, b);
    let mut far: Vec<f64> = samples
        .iter()
        .map(|&p| {
            fronts
                .iter()
                .filter(|f| !f.shared)
                .map(|f| near(p, f.a, f.b))
                .fold(f64::INFINITY, f64::min)
        })
        .collect();
    // Access lines: streets first, then each carved passage centre line.
    let mut lines: Vec<(Point, Point, Front)> = fronts
        .iter()
        .filter(|f| !f.shared)
        .map(|f| (f.a, f.b, *f))
        .collect();
    let lane = {
        let pair = morph.pair("derbWidth");
        if pair[1] > 0.0 { pair } else { [1.4, 2.4] }
    };
    let mut pieces: Vec<(Shape, Front)> = Vec::new();
    for _ in 0..24 {
        if pieces.len() >= 10 || lines.is_empty() {
            break;
        }
        let Some((i, &d)) = far
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(&a.0)))
        else {
            break;
        };
        if d <= reach * 1.15 {
            break;
        }
        let p = samples[i];
        let (q, f) = lines
            .iter()
            .map(|&(a, b, f)| {
                let e = sub(b, a);
                let t = (dot(sub(p, a), e) / dot(e, e).max(1e-12)).clamp(0.0, 1.0);
                (add(a, scale(e, t)), f)
            })
            .min_by(|a, b| length(sub(p, a.0)).total_cmp(&length(sub(p, b.0))))
            .unwrap();
        // Stop one lot band short of the far side: that band is served too.
        let len = (length(sub(p, q)) - 0.5 * reach).max(0.0);
        let dir = unit(sub(p, q));
        let n = normal(dir);
        let w = rng.range(lane[0], lane[1]);
        let end = add(q, scale(dir, len));
        let square = (2.5 * w).clamp(4.0, 7.0);
        let fits = len > 6.0
            && rect_within(
                shape,
                add(add(q, scale(dir, 0.6)), scale(n, -0.5 * w)),
                dir,
                n,
                len - 0.6,
                w,
            )
            && rect_within(
                shape,
                add(add(end, scale(dir, -0.5 * square)), scale(n, -0.5 * square)),
                dir,
                n,
                square,
                square,
            );
        if !fits {
            far[i] = 0.0;
            continue;
        }
        let start = add(q, scale(dir, -0.5));
        pieces.push((
            rect(add(start, scale(n, -0.5 * w)), dir, n, len + 0.5, w),
            f,
        ));
        pieces.push((
            rect(
                add(add(end, scale(dir, -0.5 * square)), scale(n, -0.5 * square)),
                dir,
                n,
                square,
                square,
            ),
            f,
        ));
        lines.push((q, end, f));
        for (k, s) in samples.iter().enumerate() {
            far[k] = far[k].min(near(*s, q, end) - 0.5 * w);
        }
    }
    if pieces.is_empty() {
        return strips(shape, block, axis, fronts, &lots, zone, rng);
    }
    let courts: Vec<(Shape, Front)> =
        union(&pieces.iter().map(|p| p.0.clone()).collect::<Vec<_>>())
            .iter()
            .flat_map(|s| intersection(s, shape))
            .map(|c| {
                let f = pieces
                    .iter()
                    .find(|(p, _)| !intersection(p, &c).is_empty())
                    .map_or(pieces[0].1, |p| p.1);
                (c, f)
            })
            .collect();
    let mut cells = vec![shape.clone()];
    for (court, f) in &courts {
        cells = cells.iter().flat_map(|c| difference(c, court)).collect();
        // Reversed court rings: their left side faces the lots around them.
        for ring in std::iter::once(&court.outer).chain(court.holes.iter()) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                fronts.push(Front {
                    a: b,
                    b: a,
                    street: f.street,
                    rank: f.rank + 1,
                    shared: true,
                    gate: true,
                });
            }
        }
    }
    let mut result = Vec::new();
    for (i, cell) in cells.iter().enumerate() {
        result.extend(strips(
            cell,
            block,
            axis,
            fronts,
            &lots,
            zone,
            &mut rng.fork(&format!("derb-domain:{i}")),
        ));
    }
    for (court, _) in courts {
        let mut p = parcel(court, block, axis, fronts, "court");
        p.use_kind = "court".into();
        p.reason = "shared-court-and-passage".into();
        p.provenance = vec!["derb-passage".into()];
        result.push(p);
    }
    result
}
