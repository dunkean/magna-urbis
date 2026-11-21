//! Frontage territories and oriented courtyard lot cuts.

use super::tidy;
use super::bisect::bisect;
use super::consolidation::merge_slivers;
use super::contacts::{Front, frontage, street_runs};
use super::cut_geometry::{dot, half, length, normal, scale, sub, unit};
use super::depth::{maximum_plot_depth, plot_depth};
use super::identity::parcel;
use super::strip_layout::strips;
use crate::rng::Rng;
use crate::urban::{Morph, Parcel, Point, Shape};
use crate::urban::geometry::{area, difference};

/// Competing inward frontage planes. Unlike first-front wins, opposite fronts
/// meet at their equal-distance seam; non-convex results retain separate components.
pub(super) fn frontage_territories(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let rs = street_runs(fronts);
    let planes: Vec<_> = rs
        .iter()
        .filter_map(|run| {
            let a = run.first()?.a;
            let b = run.last()?.b;
            (length(sub(b, a)) > 3.0).then(|| (normal(unit(sub(b, a))), a, run))
        })
        .collect();
    let mut available = vec![shape.clone()];
    let mut plots = vec![];
    for (i, &(n, a, run)) in planes.iter().enumerate().take(64) {
        let mut territories = available.clone();
        for &(other, b, _) in &planes {
            let delta = sub(n, other);
            let len = length(delta);
            if len < 1e-8 {
                continue;
            }
            // n·(p-a) <= other·(p-b).
            let at = (dot(n, a) - dot(other, b)) / len;
            let d = scale(delta, 1.0 / len);
            territories = territories
                .into_iter()
                .flat_map(|s| half(&s, d, at, true))
                .collect();
        }
        territories.retain(|s| frontage(s, run).0 >= 3.0);
        for territory in territories {
            available = available
                .into_iter()
                .flat_map(|s| difference(&s, &territory))
                .collect();
            plots.extend(strips(
                &territory,
                block,
                axis,
                run,
                morph,
                zone,
                &mut rng.fork(&format!("territory:{i}")),
            ));
        }
    }
    // Global competing planes can eliminate every territory around a concave
    // access tree. Fall back once to local front bands instead of silently
    // returning the entire accessible block as one garden.
    if !plots.iter().any(|p| p.use_kind == "plot") && !fronts.is_empty() {
        let mut fallback = strips(
            shape,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork("territory-fallback"),
        );
        for p in &mut fallback {
            p.provenance
                .push("concave-territory-frontage-fallback".into());
        }
        return fallback;
    }
    plots.extend(
        available
            .into_iter()
            .map(|s| parcel(s, block, axis, &[], "garden")),
    );
    merge_slivers(
        &mut plots,
        fronts,
        Some(maximum_plot_depth(morph, zone)),
        tidy::floor_of(morph),
    );
    plots
}

pub(super) fn courtyards(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let amax = morph.range("houseArea", zone)[1].max(morph.range("houseArea", zone)[0].max(20.0));
    let done = bisect(shape, axis, fronts, morph, zone, rng);
    let mut result: Vec<Parcel> = done
        .into_iter()
        .enumerate()
        .flat_map(|(i, s)| {
            if area(&s) > 3.0 * amax
                || (morph.text("plotOp") != "compound"
                    && plot_depth(&s, axis, fronts)
                        .is_some_and(|depth| depth > maximum_plot_depth(morph, zone) + 0.01))
            {
                // A courtyard cut can fail because its rear child has no street
                // access. Keep real frontages, and reserve the unserved interior
                // instead of returning a single enormous residential compound.
                strips(
                    &s,
                    block,
                    axis,
                    fronts,
                    morph,
                    zone,
                    &mut rng.fork(&format!("courtyard-frontage:{i}")),
                )
            } else {
                vec![parcel(s, block, axis, fronts, "plot")]
            }
        })
        .collect();
    merge_slivers(
        &mut result,
        fronts,
        (morph.text("plotOp") != "compound").then(|| maximum_plot_depth(morph, zone)),
        tidy::floor_of(morph),
    );
    result
}
