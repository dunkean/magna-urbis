//! Size one declared strip programme before its first native construction.
//! Only scalar dimensions are inverted; site placement, roofs and interiors
//! retain their exact admission checks after that single construction.
use crate::catalogue::{EnclosureFamily, Envelope, Layout, Parameters, SupportKind};
use crate::geometry::{GRID_M, snap};
use crate::layouts::{UrbanFrontageInfillDraws, minimum_domain, urban_frontage_infill_enabled};

const PASSAGE_M: f64 = 1.25;
const COURT_FRACTION: f64 = 0.25;
const COURT_CLEARANCE_M: f64 = 1.8;
const MAX_SCALAR_STEPS: usize = 32;

pub(super) struct StripProgrammeBudget {
    pub nominal_m: [f64; 2],
    pub footprint_m2: f64,
    pub target_m2: f64,
    pub target_met: bool,
}

/// Deliberately narrow: this is the native one-range strip, optionally with
/// its seeded infill. Authored compositions, courtyard arcades,
/// jetties, voids, changing floor plates and raised supports need other models.
pub(super) fn supported(p: &Parameters) -> bool {
    p.layout == Layout::Strip
        && matches!(p.footprint_family.as_str(), "FP-RECT" | "FP-LONG")
        && p.envelope == Envelope::Walled
        && p.support.kind == SupportKind::Ground
        && p.bodies == [1, 1]
        && p.cells[1] == 0
        && p.floors[0] > 0
        && p.court_program.is_none()
        && p.structural_spec.is_none()
        && p.shell.is_none()
        && p.roof_spec.shell.is_none()
        && p.roof_spec.corbel.is_none()
        && p.roof_spec.vault.is_none()
        && p.roof_system != "uncovered"
        // A native arcade needs its retained structural covers and real entry
        // before site connection. Keep the existing proven gallery pathway.
        && !p.gallery_cover.enabled
        && p.enclosures.iter().all(|e| e.family == EnclosureFamily::None)
        && (p.components.is_empty()
            || p.components.len() == 1 && p.components[0].id == "main")
        && p.details.iter().all(|d| {
            matches!(d.as_str(), "party_walls" | "rear_yard" | "shopfront"
                | "side_corridor")
        })
}

fn footprint_m2(dimensions: [f64; 2], infill: Option<(&UrbanFrontageInfillDraws, f64)>) -> f64 {
    let [w, d] = dimensions;
    // Match rectangle's snapped endpoints, including the non-grid quarter.
    snap(w - PASSAGE_M) * (snap(d) - snap(d * COURT_FRACTION))
        + infill.map_or(0.0, |(draws, coverage)| draws.added_area_m2(w, d, coverage))
}

/// `ranges` have already intersected the source/parcel_fit allowance with the
/// available site spans. They are nominal dimensions, not a placement proof.
/// Unsupported programmes return None unchanged; an impossible physical
/// minimum is refused before constructing geometry.
pub(super) fn solve(
    p: &Parameters,
    mut ranges: [[f64; 2]; 2],
    coverage: Option<f64>,
    seed: &str,
    target_m2: f64,
) -> Result<Option<StripProgrammeBudget>, String> {
    if !supported(p) {
        return Ok(None);
    }
    if !target_m2.is_finite() || target_m2 <= 0.0 {
        return Err("Initial strip programme requires a finite positive built area.".into());
    }
    let mut minimum = minimum_domain(p);
    let gallery_width = if p.gallery_cover.enabled {
        p.gallery_cover.width_m
    } else {
        0.0
    };
    minimum[0] = minimum[0].max(COURT_CLEARANCE_M + 2.0 * gallery_width);
    ranges[0][0] = ranges[0][0].max(minimum[0] + PASSAGE_M);
    ranges[1][0] = ranges[1][0]
        .max(minimum[1] / (1.0 - COURT_FRACTION))
        .max((COURT_CLEARANCE_M + 2.0 * gallery_width) / COURT_FRACTION);
    for (axis, range) in ranges.iter_mut().enumerate() {
        range[0] = libm::ceil(range[0] / GRID_M) * GRID_M;
        range[1] = libm::floor(range[1] / GRID_M) * GRID_M;
        if !range[0].is_finite() || !range[1].is_finite() || range[1] < range[0] {
            return Err(format!(
                "Initial strip programme cannot retain rooms/stairs/court/passage on axis {axis}: minimum {:.3} m exceeds allowance {:.3} m.",
                range[0], range[1]
            ));
        }
    }
    let infill_coverage = coverage.filter(|&coverage| urban_frontage_infill_enabled(p, coverage));
    let draws = infill_coverage.map(|_| UrbanFrontageInfillDraws::new(seed));
    let infill = draws.as_ref().zip(infill_coverage);
    let base = [p.width_m[0], p.depth_m[0]];
    if base.iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return Err("Initial strip programme has invalid retained dimensions.".into());
    }
    // One aspect-preserving dimension curve, clamped on each source/site axis.
    // It spans both physical minima to both maxima without any plan/pose search.
    let dimensions =
        |scale: f64| [0, 1].map(|i| snap(base[i] * scale).clamp(ranges[i][0], ranges[i][1]));
    let lo = (ranges[0][0] / base[0]).min(ranges[1][0] / base[1]);
    let hi = (ranges[0][1] / base[0]).max(ranges[1][1] / base[1]);
    let mut best = [ranges[0][0], ranges[1][0]];
    let mut best_area = footprint_m2(best, infill);
    let mut breaks = vec![lo, hi];
    for i in 0..2 {
        breaks.extend(ranges[i].map(|value| value / base[i]));
    }
    // Evaluate both sides of each native branch threshold, including the RNG
    // branch change when the side wing appears. Never assume global monotonicity.
    for (axis, threshold) in [(0, 5.25), (1, 8.8), (1, 16.0)] {
        breaks.push(((threshold - GRID_M) / base[axis]).clamp(lo, hi));
        breaks.push((threshold / base[axis]).clamp(lo, hi));
    }
    breaks.sort_by(f64::total_cmp);
    breaks.dedup();
    let mut consider = |candidate| {
        let candidate_area = footprint_m2(candidate, infill);
        if (candidate_area - target_m2).abs() < (best_area - target_m2).abs() {
            best = candidate;
            best_area = candidate_area;
        }
        candidate_area
    };
    for interval in breaks.windows(2) {
        let [mut lo, mut hi] = [interval[0], interval[1]];
        let lo_area = consider(dimensions(lo));
        let hi_area = consider(dimensions(hi));
        if target_m2 < lo_area || target_m2 > hi_area {
            continue;
        }
        // At most 32 numeric steps per branch; no polygon, native layout,
        // roof or rigid pose is created inside this bounded scalar inversion.
        for _ in 0..MAX_SCALAR_STEPS {
            let mid = (lo + hi) * 0.5;
            let candidate_area = consider(dimensions(mid));
            if candidate_area < target_m2 {
                lo = mid;
            } else {
                hi = mid;
            }
            if dimensions(lo) == dimensions(hi) {
                break;
            }
        }
    }
    // This is only millimetre-grid matching, not the site's programme tolerance.
    let grid_area_tolerance = GRID_M * (best[0] + best[1]) * 2.0;
    Ok(Some(StripProgrammeBudget {
        nominal_m: best,
        footprint_m2: best_area,
        target_m2,
        target_met: (best_area - target_m2).abs() <= grid_area_tolerance,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{resolve_urban_architecture, resolve_urban_architecture_with_budget};
    use crate::geometry::{area, unite};
    use crate::model::{HistoricalMode, HouseConfig};
    use crate::placement::ArchitectureFunction;

    #[test]
    fn disabled_infill_does_not_budget_undeclared_wings() {
        let data = crate::catalogue::catalogue().unwrap();
        let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B02").unwrap();
        let mut p = recipe.parameters.clone();
        p.width_m = [8.5; 2];
        p.depth_m = [20.; 2];
        p.floors = [1; 2];
        p.rooms_per_body = [1; 2];
        p.urban_frontage_infill = false;
        let plan = crate::layouts::build_layout(recipe, &p, "native-infill").unwrap();
        let body_area = area(&plan.bodies[0].footprint);
        let budget = solve(&p, [p.width_m, p.depth_m], Some(0.93), "native-infill", body_area)
            .unwrap().unwrap();
        assert_eq!(budget.nominal_m, [8.5, 20.]);
        assert!((budget.footprint_m2 - body_area).abs() < GRID_M * GRID_M);
    }

    #[test]
    fn budget_matches_actual_native_strip_and_retains_arcade_pathway() {
        for recipe in ["EUR-MED-B02", "EUR-MED-B09"] {
            let mut config = HouseConfig {
                recipe: Some(recipe.into()),
                seed: "initial-strip-budget".into(),
                mode: HistoricalMode::HistoricalInspired,
                count: 1,
                ..HouseConfig::default()
            };
            config.overrides.floors = Some(2);
            let baseline = resolve_urban_architecture(
                config.clone(),
                ArchitectureFunction::Domestic,
                [20.0, 36.0],
                false,
                Some([10.0, 20.0]),
                Some(0.93),
                true,
            )
            .unwrap();
            let draws = UrbanFrontageInfillDraws::new(&baseline.config.seed);
            let target = footprint_m2([8.5, 17.0], Some((&draws, 0.93)));
            let fitted = resolve_urban_architecture_with_budget(
                config,
                ArchitectureFunction::Domestic,
                [20.0, 36.0],
                false,
                Some([10.0, 20.0]),
                Some(0.93),
                true,
                Some(target),
            )
            .unwrap();
            let mut old_parameters = serde_json::to_value(&baseline.parameters).unwrap();
            let mut new_parameters = serde_json::to_value(&fitted.parameters).unwrap();
            for parameters in [&mut old_parameters, &mut new_parameters] {
                parameters.as_object_mut().unwrap().remove("width_m");
                parameters.as_object_mut().unwrap().remove("depth_m");
            }
            assert_eq!(
                old_parameters, new_parameters,
                "all other draws retained: {recipe}"
            );
            assert_eq!(fitted.config, baseline.config);
            assert_eq!(fitted.recipe_id, baseline.recipe_id);
            assert_eq!(fitted.parameters.floors, [2, 2]);
            if recipe == "EUR-MED-B09" {
                assert_eq!(
                    serde_json::to_value(&fitted.plan).unwrap(),
                    serde_json::to_value(&baseline.plan).unwrap()
                );
                assert!(fitted.parameters.gallery_cover.enabled);
                continue;
            }
            let domains: Vec<_> = fitted
                .plan
                .bodies
                .iter()
                .flat_map(|b| b.levels.iter().cloned())
                .collect();
            let actual = area(&unite(&domains));
            let p = &fitted.parameters;
            let draws = UrbanFrontageInfillDraws::new(&fitted.config.seed);
            let infill = urban_frontage_infill_enabled(p, 0.93).then_some((&draws, 0.93));
            let predicted = footprint_m2([p.width_m[0], p.depth_m[0]], infill);
            assert!(
                (actual - predicted).abs() < 1e-6,
                "{recipe}: {actual} vs {predicted}"
            );
            assert!(
                (actual - target).abs() < 0.1,
                "{recipe}: {actual} vs {target}"
            );
            assert!(area(&fitted.plan.courts) > 0.0 && area(&fitted.plan.paths) > 0.0);
            assert!(fitted.plan.bodies.len() > 1);
        }
    }

    #[test]
    fn budget_retains_source_bounds_and_refuses_unsupported_or_impossible_minimum() {
        let data = crate::catalogue::catalogue().unwrap();
        let mut p = data
            .recipes
            .iter()
            .find(|r| r.id == "EUR-MED-B02")
            .unwrap()
            .parameters
            .clone();
        p.floors = [1, 1];
        p.rooms_per_body = [1, 1];
        let result = solve(&p, [[4.0, 6.0], [10.0, 18.0]], Some(0.93), "0", 1_000.0)
            .unwrap()
            .unwrap();
        assert_eq!(result.nominal_m, [6.0, 18.0]);
        assert!(!result.target_met && result.footprint_m2 < result.target_m2);
        assert!(solve(&p, [[4.0, 4.1], [1.0, 2.0]], Some(0.93), "0", 20.0).is_err());
        p.details.push("jetty".into());
        assert!(
            solve(&p, [[4.0, 6.0], [10.0, 18.0]], Some(0.93), "0", 60.0)
                .unwrap()
                .is_none()
        );
    }
}
