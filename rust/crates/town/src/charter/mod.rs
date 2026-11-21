//! Founding decisions and dated promotions for a surveyed site.

mod roads;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use magna_urbis_geom::{Point, distance};
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};

use crate::{
    TownRequest, TownSite,
    spec::{
        CharterSpec, DefensiveIntent, DefensiveShares, FoundingFocusKind, PhaseDraw, PhaseSpec,
        TownDraws, TownForm,
    },
    survey::{BankId, Survey},
};

use self::roads::{RoadFacts, nearer};

/// The request's choice of how to lay a planned frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PlannedSetting {
    /// Draw from the culture's planned share.
    #[default]
    Auto,
    /// Lay a frame, sized for the request if no capacity is given.
    On { capacity: Option<u32> },
}

/// Feature and map-local position placed by the founding event.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct FoundingFocus {
    pub kind: FoundingFocusKind,
    pub position: Point,
}

/// The chosen surveyed front, including the start of the harbour approach.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct HarbourSite {
    pub bank_id: BankId,
    pub station: f64,
    pub position: Point,
}

/// Decisions the founding event freezes for the life of the town.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Charter {
    pub culture: String,
    pub site_archetype: Option<String>,
    pub center: Point,
    pub pinned: bool,
    pub radius: Option<f64>,
    pub focus: FoundingFocus,
    pub harbour_front: Option<HarbourSite>,
    pub form: TownForm,
    pub founding_cohort: u32,
    pub founding_tissue_id: String,
    pub defensive_intent: DefensiveIntent,
    pub draws: TownDraws,
}

/// A phase with its promotion threshold after site effects and ordering.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlannedPhase {
    pub threshold: u32,
    pub spec: PhaseSpec,
}

/// The initial regime and the subsequent promotions, in order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhasePlan {
    /// Phases in promotion order, with nondecreasing thresholds.
    pub phases: Vec<PlannedPhase>,
}

impl PhasePlan {
    /// Return the next promotion due at this housed-population clock value.
    pub fn promotion_after(&self, current: usize, housed: u32) -> Option<&PlannedPhase> {
        self.phases
            .get(current.checked_add(1)?)
            .filter(|phase| housed >= phase.threshold)
    }
}

/// Resolve the frame draw and the planned-cohort exception. The requested
/// population also supplies the frame capacity when a planned town omits it.
pub fn effective_form(requested: &TownRequest<'_>, spec: &CharterSpec) -> TownForm {
    resolve_form(
        &requested.site,
        requested.planned,
        spec,
        &Rng::new(requested.seed),
    )
}

fn resolve_form(
    site: &TownSite,
    setting: PlannedSetting,
    spec: &CharterSpec,
    rng: &Rng,
) -> TownForm {
    if site.population < spec.planned_founding_cohort {
        return TownForm::Grown;
    }
    let capacity = match setting {
        PlannedSetting::On { capacity } => capacity,
        PlannedSetting::Auto if rng.fork("charter:planned-form").chance(spec.planned_share) => None,
        PlannedSetting::Auto => return TownForm::Grown,
    };
    TownForm::Planned {
        capacity: capacity.unwrap_or(site.population).max(1),
    }
}

/// Resolve the charter and phase plan once, using the survey of this request.
pub fn found(request: &TownRequest<'_>, survey: &Survey) -> Result<(Charter, PhasePlan), String> {
    let specs = request.specs;
    let spec = &specs.charter;
    let first = specs
        .phases
        .first()
        .ok_or("A town needs a founding phase")?;
    if first.threshold != 0
        || specs
            .phases
            .windows(2)
            .any(|w| w[0].threshold >= w[1].threshold)
    {
        return Err("Phase thresholds must increase from zero".into());
    }

    let rng = Rng::new(request.seed);
    let site = &request.site;
    let archetype = site.archetype.as_deref().unwrap_or("");
    let form = resolve_form(site, request.planned, spec, &rng);
    let roads = RoadFacts::inspect(request.regional_roads, survey, site.radius, spec);
    let front = harbour_site(survey, specs.survey.harbour_reach);
    let focus = founding_focus(form, archetype, spec, survey, &roads, front, &rng);
    let shares = spec
        .defensive_by_archetype
        .get(archetype)
        .unwrap_or(&spec.defensive_shares);
    let defensive_intent = defensive_intent(*shares, &rng);
    let founding_tissue_id = if matches!(form, TownForm::Planned { .. }) {
        &spec.planned_tissue_id
    } else if site.population < spec.planned_founding_cohort {
        &spec.village_tissue_id
    } else if defensive_intent == DefensiveIntent::EnclosedFromFounding {
        &first.compact_tissue_id
    } else {
        &first.tissue_id
    };
    let steep = survey
        .cell_at(survey.center())
        .is_some_and(|cell| !cell.wet && cell.slope > spec.steep_grade);
    let (draws, plan) = plan_phases(&specs.phases, &rng, &roads, front.is_some(), steep)?;
    let charter = Charter {
        culture: site.culture.clone(),
        site_archetype: site.archetype.clone(),
        center: site.center,
        pinned: site.pinned,
        radius: site.radius,
        focus,
        harbour_front: front,
        form,
        founding_cohort: spec.founding_cohort,
        founding_tissue_id: founding_tissue_id.clone(),
        defensive_intent,
        draws: TownDraws {
            phases: draws,
            harbour_enclosure: specs.harbour.enclosure_habit,
        },
    };
    Ok((charter, plan))
}

fn defensive_intent(shares: DefensiveShares, rng: &Rng) -> DefensiveIntent {
    let draw = rng.fork("charter:defensive-intent").float();
    if draw < shares.enclosed_from_founding {
        DefensiveIntent::EnclosedFromFounding
    } else if draw < shares.enclosed_from_founding + shares.walled_when_grown {
        DefensiveIntent::WalledWhenGrown
    } else {
        DefensiveIntent::Never
    }
}

fn founding_focus(
    form: TownForm,
    archetype: &str,
    spec: &CharterSpec,
    survey: &Survey,
    roads: &RoadFacts,
    front: Option<HarbourSite>,
    rng: &Rng,
) -> FoundingFocus {
    use FoundingFocusKind::*;

    if matches!(form, TownForm::Planned { .. }) {
        return FoundingFocus {
            kind: PlannedFrame,
            position: survey.center(),
        };
    }
    let defensive_site = matches!(archetype, "hilltop" | "spur" | "pass");
    let strong_point = spec.strong_point_share > 0.0
        && (defensive_site
            || rng
                .fork("charter:strong-point")
                .chance(spec.strong_point_share));
    let preferred = match archetype {
        "harbor" | "harbour" | "lakeshore" => Some(HarbourFront),
        "bridge" => Some(Bridge),
        "ford" => Some(Ford),
        "crossroads" => Some(RoadCrossing),
        _ if defensive_site => Some(StrongPoint),
        _ => None,
    };
    let position = |kind| match kind {
        Site => Some(survey.center()),
        RoadCrossing => roads.crossing,
        Ford => roads.ford,
        Bridge => roads.bridge,
        HarbourFront => front.map(|f| f.position),
        StrongPoint if strong_point => survey.strong_points().first().map(|p| p.position),
        StrongPoint | PlannedFrame => None,
    };
    preferred
        .into_iter()
        .chain(spec.founding_rule.iter().copied())
        .find_map(|kind| position(kind).map(|position| FoundingFocus { kind, position }))
        .unwrap_or(FoundingFocus {
            kind: Site,
            position: survey.center(),
        })
}

fn harbour_site(survey: &Survey, reach: f64) -> Option<HarbourSite> {
    let center = survey.center();
    survey
        .fronts()
        .iter()
        .filter_map(|front| {
            let position = front
                .shore
                .windows(2)
                .map(|w| distance(center, w[0], w[1]).2)
                .min_by(|&a, &b| nearer(center, a, b))?;
            (center.distance(position) <= reach).then_some((front, position))
        })
        .min_by(|(a, ap), (b, bp)| {
            // Prefer a land approach when one exists, then shelter and proximity.
            b.land_distance
                .is_some()
                .cmp(&a.land_distance.is_some())
                .then_with(|| b.shelter_score.total_cmp(&a.shelter_score))
                .then_with(|| nearer(center, *ap, *bp))
                .then(a.bank_id.cmp(&b.bank_id))
                .then(a.station.total_cmp(&b.station))
        })
        .map(|(front, position)| HarbourSite {
            bank_id: front.bank_id,
            station: front.station,
            position,
        })
}

fn plan_phases(
    specs: &[PhaseSpec],
    rng: &Rng,
    roads: &RoadFacts,
    harbour: bool,
    steep: bool,
) -> Result<(BTreeMap<String, PhaseDraw>, PhasePlan), String> {
    let mut draws = BTreeMap::new();
    let mut phases = Vec::with_capacity(specs.len());
    let mut previous = 0;
    for spec in specs {
        let draw = phase_draw(spec, &rng.fork(&format!("phase:{}", spec.name)));
        let m = &spec.circumstance_modifiers;
        let mut factor = 1.0;
        if roads.crossing.is_some() {
            factor *= m.road_crossing;
        }
        if harbour {
            factor *= m.navigable_harbour;
        }
        if !roads.nearby && !harbour {
            factor *= m.isolated_site;
        }
        if steep {
            factor *= m.steep_site;
        }
        // Overlapping spreads or site effects can make several promotions due
        // at one clock value. They still enter in catalogue order.
        let threshold =
            ((f64::from(draw.promotion_threshold) * factor).round() as u32).max(previous);
        if draws.insert(spec.name.clone(), draw).is_some() {
            return Err(format!("Duplicate phase name: {}", spec.name));
        }
        phases.push(PlannedPhase {
            threshold,
            spec: spec.clone(),
        });
        previous = threshold;
    }
    Ok((draws, PhasePlan { phases }))
}

fn phase_draw(spec: &PhaseSpec, rng: &Rng) -> PhaseDraw {
    let base = f64::from(spec.threshold);
    let spread = spec.threshold_spread.max(0.0);
    let low = (base * (1.0 - spread)).ceil() as u32;
    let high = (base * (1.0 + spread)).floor() as u32;
    let weights: Vec<_> = spec.wall_styles.iter().map(|style| style.weight).collect();
    let style = rng
        .fork("wall-style")
        .weighted_index(&weights)
        .ok()
        .map(|index| &spec.wall_styles[index]);
    let around = |name, value, spread: f64| value + rng.fork(name).range(-spread, spread);
    PhaseDraw {
        promotion_threshold: rng.fork("promotion-threshold").int(low, high),
        wall_kind: style.map(|s| s.kind).or(spec.wall_kind),
        wall_style: style.map(|s| s.id.clone()),
        precinct_step: around(
            "precinct-step",
            spec.precinct_step,
            spec.precinct_step_spread,
        ),
        precinct_gain: around(
            "precinct-gain",
            spec.precinct_gain,
            spec.precinct_gain_spread,
        ),
        fossil_rule: spec.fossil_rule,
        extension_habit: spec.extension_habit,
    }
}
