//! Work bounds for placement on clipped or otherwise constrained land.
use super::{Point, programme::UrbanProgramme};

/// Cadastre/frontage feedback is a refinement, never a convergence requirement.
pub(super) const REFINEMENT_PASSES: usize = 4;

/// Sample a bounding rectangle with a hard attempt budget, including thin sites
/// whose polygon area is much smaller than its bounding rectangle.
pub(super) fn samples(bounds: (f64, f64, f64, f64), step: f64, cap: usize) -> Vec<Point> {
    let (x0, y0, x1, y1) = bounds;
    let (w, h) = (x1 - x0, y1 - y0);
    if cap == 0 || ![x0, y0, x1, y1, step].iter().all(|x| x.is_finite())
        || w <= 0.0 || h <= 0.0 || step <= 0.0 { return vec![]; }
    let mut nx = (w / step).ceil().max(1.0).min(cap as f64) as usize;
    let mut ny = (h / step).ceil().max(1.0).min(cap as f64) as usize;
    if nx.saturating_mul(ny) > cap {
        nx = ((cap as f64 * w / h).sqrt().ceil() as usize).clamp(1, cap);
        ny = (cap / nx).max(1);
    }
    let (dx, dy) = (step.max(w / nx as f64), step.max(h / ny as f64));
    // Keep the original lattice's repeated additions: multiplying an index by
    // the step changes rounding even below the cap, which can select different
    // passage endpoints and change the resulting cadastre on ordinary sites.
    let mut points = Vec::new();
    let mut y = y0 + dy * 0.5;
    for _ in 0..ny {
        if y >= y1 { break; }
        let mut x = x0 + dx * 0.5;
        for _ in 0..nx {
            if x >= x1 { break; }
            points.push(Point { x, y });
            x += dx;
        }
        y += dy;
    }
    points
}

pub(super) fn population_warning(achieved: u32, target: u32) -> Option<String> {
    (achieved < target).then(|| format!("Population target not reached: {achieved}/{target} inhabitants."))
}

/// Replace the estimate when built outcomes arrive; never credit an open lot.
pub(super) fn report_population(pr: &mut UrbanProgramme, built: bool) {
    pr.warnings.retain(|w| !w.starts_with("Population target not reached:"));
    if super::roles::is_isolated(&pr.context.intent) || pr.context.intent == "activity" { return; }
    let (wanted, held) = pr.demands.iter().filter(|d| d.unit == "domesticUnits")
        .fold((0.0, 0.0), |(wanted, held), d| (wanted + d.requested,
            held + if built { d.built_capacity } else { d.parcel_capacity }));
    let achieved = if wanted > 0.0 {
        (pr.population as f64 * (held / wanted).clamp(0.0, 1.0) + 1e-6).floor() as u32
    } else { 0 };
    if let Some(warning) = population_warning(achieved, pr.population) { pr.warnings.push(warning); }
}

#[cfg(test)]
#[path = "generation_limits_tests.rs"]
mod tests;
