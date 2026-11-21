//! Resolve the growth engine's specs with classic's culture and recipe readers.

use magna_urbis_town::spec::{
    CharterSpec, CircumstanceModifiers, CrossingSpec, DefensiveShares, ExtensionHabit, FossilRule,
    FoundingFocusKind, HarbourEnclosure, HarbourSpec, HarbourThresholds, HarbourWorksSpec,
    PhaseSpec, PrecinctSpec, ProgrammeThresholds, RoadFate, SurveySpec, TissueParameter,
    TissueSpec, TownSpecs, WallKind, WallSpec, WallStyleSpec,
};
use magna_urbis_town::tissue::organic::{FieldOrientation, OrganicParams};
use serde_json::Value;

use super::super::{
    LayoutConfig, Morph, Point, Site, catalogue, composition, culture as culture_map, footprint,
    fortification, harbour_furniture, kinds, macroplan::harbour, profiles, roles, with_tissue,
};
use crate::settlements::{demographics, extent_radius};

const VILLAGE_TISSUE: &str = "village-open";
const PLANNED_TISSUE: &str = "planned-frame";

/// Build a culture's regimes at fixed population samples. Phase births can
/// then freeze recipes and densities regardless of the generation target.
pub(in crate::urban) fn build(culture: &str, cfg: &LayoutConfig) -> Result<TownSpecs, String> {
    let data = &catalogue()["cultures"][culture];
    let profile = profiles::profile(culture);
    let market = demographics::floor("town");
    let town = kinds::WALLED_TOWN_MINIMUM;
    let city_floor = demographics::floor("city");
    // Use the first late composition boundary, when the culture declares one.
    let city = data["phaseCount"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| u32::try_from(entry[0].as_u64()?).ok())
        .find(|&population| population >= city_floor)
        .unwrap_or(city_floor); // default, to tune on sheets
    let harbour = harbour_spec(culture, cfg, profile);
    let mut tissues = Vec::new();
    let mut phases = Vec::new();
    let samples = [
        ("hamlet", 0, demographics::floor("hamlet"), 0),
        (
            "village",
            demographics::floor("village"),
            profiles::HAMLET_PROFILE_LIMIT,
            0,
        ),
        ("market-town", market, profiles::VILLAGE_PROFILE_LIMIT, 0),
        ("town", town, town, 1),
        ("city", city, city, 2),
    ]; // default, to tune on sheets
    let mut open = cfg.clone();
    open.culture = culture.into();
    open.fortification = "none".into();
    open.footprint.epochs = 3;
    for (name, threshold, sample, epoch) in samples {
        let site = Site {
            key: String::new(),
            name: String::new(),
            culture: culture.into(),
            population: sample,
            center: Point::default(),
            radius: extent_radius(sample),
            neighbours: Vec::new(),
        };
        // The founding phases lay the town's oldest quarters. Classic densifies a village's own
        // farm tissue until it houses its households (`footprint::capacity`); growth has no such
        // forecast, so they take the tissue of a town's middle ring, which holds about what
        // classic's densified village holds (lots of 400 to 600 m²).
        let (zone, recipe_name) = if matches!(name, "hamlet" | "village") {
            ("middle", "ring")
        } else {
            footprint::epoch_zone(&open, culture, sample, epoch)
        };
        let recipe = phase_recipe(culture, sample, recipe_name, &open);
        let morph = phase_morph(culture, &recipe, zone, &open)?;
        let compact = LayoutConfig {
            zone: "core".into(),
            recipe: phase_recipe(culture, sample, "core", &open),
            ..open.clone()
        };
        let core_morph = phase_morph(culture, &compact.recipe, "core", &compact)?;
        let density = footprint::epoch_densities(&site, &open, &morph)[epoch];
        let compact_density = footprint::epoch_densities(&site, &compact, &core_morph)[epoch]
            .max(footprint::ENCLOSED_DENSITY);

        let phase_profile = profiles::settlement_profile(culture, sample, epoch + 1);
        let tissue_id = format!("{name}-open");
        let compact_tissue_id = format!("{name}-compact");
        tissues.push(tissue_spec(
            &tissue_id,
            &recipe,
            zone,
            phase_profile,
            &morph,
            &open,
        ));
        tissues.push(tissue_spec(
            &compact_tissue_id,
            &compact.recipe,
            "core",
            profile,
            &core_morph,
            &compact,
        ));
        if name == "market-town" {
            let mut frame_cfg = compact.clone();
            frame_cfg.tissue = "grid".into();
            let frame_morph = with_tissue(core_morph, "grid");
            tissues.push(tissue_spec(
                PLANNED_TISSUE,
                &compact.recipe,
                "core",
                profile,
                &frame_morph,
                &frame_cfg,
            ));
        }

        phases.push(phase_spec(
            culture,
            cfg,
            &harbour.thresholds,
            name,
            threshold,
            sample,
            market,
            phase_profile,
            tissue_id,
            compact_tissue_id,
            density,
            compact_density,
        ));
    }

    let charter = charter_spec(culture, cfg, data, profile, market, &phases);
    let wall = WallSpec {
        stiffness: fortification::culture_stiffness(cfg, culture),
        terrain_adherence: fortification::adherence(cfg),
        crest_limit: fortification::crest_limit(cfg).min(f64::MAX),
        style: phases
            .iter()
            .filter(|phase| phase.walls_when_grown)
            .chain(phases.iter())
            .find_map(|phase| phase.wall_styles.first())
            .map_or_else(String::new, |style| style.id.clone()),
        enclosure_shape: profile.enclosure.into(),
        keeps_citadel: fortification::keeps_citadel(culture),
    };
    let stairs = profiles::stairs_allowed(cfg, culture);
    let survey = SurveySpec {
        terrace_limit: if stairs {
            profiles::TERRACE_SLOPE
        } else {
            cfg.max_stair_grade
        },
        harbour_reach: harbour::HARBOUR_REACH_MIN,
        navigable_width: harbour::NAVIGABLE,
        harbour_bank_grade: if stairs {
            cfg.max_stair_grade
        } else {
            cfg.max_street_grade
        },
        lane_grade: cfg.max_lane_grade,
        strong_point_top_grade: cfg.max_lane_grade,
        // The culture's house admissibility, widened to the terrace limit where it terraces.
        house_grade: culture_map::mapping_for(culture, &cfg.programme.period).map_or(
            SurveySpec::default().house_grade,
            |m| profiles::house_slope(culture, m.admissibility.max_slope, 0.0),
        ),
        ..SurveySpec::default()
    };
    let (_, ford_span) = footprint::crossings::spans(culture, 0);
    let crossing = CrossingSpec {
        builders: footprint::crossings::builders(culture),
        ford_span,
        ..CrossingSpec::default()
    };
    Ok(TownSpecs {
        charter,
        phases,
        tissues,
        wall,
        survey,
        harbour,
        growth: Default::default(),
        precinct: PrecinctSpec::default(),
        crossing,
    })
}

fn charter_spec(
    culture: &str,
    cfg: &LayoutConfig,
    data: &Value,
    profile: profiles::UrbanProfile,
    market: u32,
    phases: &[PhaseSpec],
) -> CharterSpec {
    use FoundingFocusKind::*;

    // Plan the first precinct for the middle of the classic village range.
    let founding_cohort = (profiles::HAMLET_PROFILE_LIMIT + market) / 2; // default, to tune on sheets
    let planned_founding_cohort = profiles::VILLAGE_PROFILE_LIMIT; // default, to tune on sheets
    let rectangular_grid = profile.pattern == "grid"
        && matches!(profile.enclosure, "square" | "rect" | "rounded-rect");
    // Square and rectangular grids usually begin with their frame.
    let planned_share = if rectangular_grid { 0.75 } else { 0.0 }; // default, to tune on sheets
    let strong_point_share = match cfg.heights_castle.as_str() {
        "none" => 0.0,
        "force" => 1.0,
        _ => fortification::heights_castle_share(culture),
    };
    let mut founding_rule = Vec::new();
    if profile.waterfront || data["plan"]["harbour"].is_object() {
        founding_rule.push(HarbourFront);
    }
    founding_rule.extend([RoadCrossing, Ford, Bridge, StrongPoint, Site]);

    let selected = kinds::requested_enclosure(cfg);
    let village = profiles::settlement_profile(culture, founding_cohort, 1);
    let village_kind = wall_kind(profiles::fortification(village, selected, founding_cohort));
    let can_wall = phases.iter().any(|phase| phase.walls_when_grown);
    let enclosed = village_kind.is_some()
        && (kinds::FORTIFIED_VILLAGES.contains(&culture)
            || data["village"]["form"] == "walled"
            || selected != "culture");
    let shares = |defensive: bool| {
        // Use classic's per-site village wall chance at the founding cohort.
        let grown = f64::from(founding_cohort - profiles::HAMLET_PROFILE_LIMIT)
            / f64::from(profiles::VILLAGE_PROFILE_LIMIT - profiles::HAMLET_PROFILE_LIMIT);
        let from_founding = if enclosed {
            1.0
        } else if can_wall || village_kind.is_some() {
            let base = if defensive { 0.30 } else { 0.08 };
            base + 0.15 * grown
        } else {
            0.0
        };
        // Some automatic enclosures stay open past market growth.
        let when_grown = if profile.fortification == "auto" {
            0.75
        } else {
            1.0
        }; // default, to tune on sheets
        DefensiveShares {
            enclosed_from_founding: from_founding,
            walled_when_grown: if can_wall {
                (1.0 - from_founding) * when_grown
            } else {
                0.0
            },
        }
    };
    let (_, ford_max_span) = footprint::crossings::spans(culture, market);
    // A regional road can already carry a bridge larger than a village could build.
    let (bridge_max_span, _) = footprint::crossings::spans(culture, demographics::floor("city")); // default, to tune on sheets
    CharterSpec {
        founding_rule,
        founding_cohort,
        planned_founding_cohort,
        planned_share,
        village_tissue_id: VILLAGE_TISSUE.into(),
        planned_tissue_id: PLANNED_TISSUE.into(),
        defensive_shares: shares(false),
        defensive_by_archetype: kinds::DEFENSIVE
            .into_iter()
            .chain(["meander"])
            .map(|name| (name.into(), shares(true)))
            .collect(),
        strong_point_share,
        regional_road_reach: extent_radius(founding_cohort).max(80.0), // default, to tune on sheets
        ford_max_span,
        bridge_max_span,
        steep_grade: cfg.max_lane_grade,
    }
}

#[allow(clippy::too_many_arguments)]
fn phase_spec(
    culture: &str,
    cfg: &LayoutConfig,
    harbour_works: &HarbourThresholds,
    name: &str,
    threshold: u32,
    sample: u32,
    market: u32,
    profile: profiles::UrbanProfile,
    tissue_id: String,
    compact_tissue_id: String,
    density: f64,
    compact_density: f64,
) -> PhaseSpec {
    let selected = kinds::requested_enclosure(cfg);
    let usual_kind = profiles::fortification(profile, selected, sample);
    // A small town can begin with a cheap precinct, before auto allows masonry.
    let kind = if threshold < market && selected == "culture" && profile.fortification == "auto" {
        "palisade" // default, to tune on sheets
    } else {
        usual_kind
    };
    let nominal_kind = wall_kind(kind);
    let wall_styles: Vec<_> = if nominal_kind.is_some() {
        let input = fortification::Inputs {
            culture,
            pop: sample,
            period: &cfg.programme.period,
            state: &cfg.programme.state,
            archetype: &cfg.site_archetype,
            forced: &cfg.fortification_style,
            relief: 0.0,
        };
        fortification::growth_styles(kind, &input, cfg)
            .into_iter()
            .filter_map(|(style, weight)| {
                let kind = if style.id == "bastioned" {
                    WallKind::Bastioned
                } else {
                    wall_kind(&style.kind)?
                };
                Some(WallStyleSpec {
                    id: style.id,
                    kind,
                    weight,
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let base_kind = wall_styles.first().map(|style| style.kind).or(nominal_kind);
    let masonry = matches!(base_kind, Some(WallKind::Wall | WallKind::Bastioned));
    let (step, gain, step_spread, gain_spread) = if masonry {
        (1.5, 0.30, 0.10, 0.05) // default, to tune on sheets
    } else {
        (1.2, 0.10, 0.05, 0.03) // default, to tune on sheets
    };
    let enclosure_key = match name {
        "hamlet" | "village" => name,
        "market-town" => "core",
        _ => "ring",
    };
    let data = composition::culture_data(culture, sample);
    let fossil = data[enclosure_key]["enclosure"]["fossil"]
        .as_str()
        .or_else(|| data["core"]["enclosure"]["fossil"].as_str());
    let fossil_rule = match (masonry, fossil) {
        (true, Some("wall")) => FossilRule::Keep,
        (true, Some("street")) => FossilRule::Boulevard,
        _ => FossilRule::Remove,
    };
    let extension_habit = match fortification::wall_extension(cfg, culture).as_str() {
        "attached" => ExtensionHabit::Lobes,
        "concentric" => ExtensionHabit::Concentric,
        _ if sample < 10_000 => ExtensionHabit::Lobes, // default, to tune on sheets
        _ => ExtensionHabit::Concentric,               // default, to tune on sheets
    };
    let market_phase = name == "market-town";
    // Near a crossing or a navigable bank, trade starts earlier. Without
    // either a nearby regional road or a harbour it starts later. The steep
    // factor uses the local lane grade and compounds with the other factors.
    let circumstance_modifiers = if market_phase {
        CircumstanceModifiers {
            road_crossing: 0.80,
            navigable_harbour: 0.85,
            isolated_site: 1.15,
            steep_site: 1.20,
        } // default, to tune on sheets
    } else {
        CircumstanceModifiers {
            road_crossing: 1.0,
            navigable_harbour: 1.0,
            isolated_site: 1.0,
            steep_site: 1.0,
        }
    };
    let road_fate = match name {
        "city" => RoadFate::Demoted, // default, to tune on sheets
        _ => RoadFate::Kept,         // default, to tune on sheets
    };
    let fill_schedule = match name {
        "hamlet" | "village" => vec![0.65, 0.85, 1.0], // default, to tune on sheets
        "market-town" => vec![0.55, 0.75, 0.90, 1.0],  // default, to tune on sheets
        _ => vec![0.50, 0.70, 0.85, 1.0],              // default, to tune on sheets
    };
    PhaseSpec {
        name: name.into(),
        threshold,
        threshold_spread: 0.30, // default, to tune on sheets
        circumstance_modifiers,
        tissue_id,
        compact_tissue_id,
        density,
        compact_density,
        fill_schedule,
        wall_kind: base_kind,
        wall_styles,
        walls_when_grown: threshold >= market && base_kind.is_some(), // default, to tune on sheets
        precinct_step: step,
        precinct_gain: gain,
        precinct_step_spread: step_spread,
        precinct_gain_spread: gain_spread,
        fossil_rule,
        extension_habit,
        road_fate,
        planned_road_fate: RoadFate::Absorbed, // default, to tune on sheets
        programme: programme_thresholds(culture, sample),
        harbour_works: harbour_works.clone(),
    }
}

fn wall_kind(kind: &str) -> Option<WallKind> {
    match kind {
        "hedge" => Some(WallKind::Hedge),
        "ditch" => Some(WallKind::Ditch),
        "palisade" => Some(WallKind::Palisade),
        "earthwork" => Some(WallKind::Earthwork),
        "wall" => Some(WallKind::Wall),
        "bastioned" => Some(WallKind::Bastioned),
        _ => None,
    }
}

fn programme_thresholds(culture: &str, sample: u32) -> ProgrammeThresholds {
    let (entries, _) = roles::service_entries(culture, f64::from(sample));
    let threshold = |matches: fn(&roles::ServiceEntry) -> bool| {
        entries
            .iter()
            .filter(|entry| matches(entry))
            .map(|entry| {
                let early = entry.town_pop;
                (if early > 0.0 {
                    early.min(entry.min_pop)
                } else {
                    entry.min_pop
                })
                .ceil() as u32
            })
            .min()
    };
    ProgrammeThresholds {
        market: threshold(|entry| entry.function == "market"),
        hall: threshold(|entry| matches!(entry.role.as_str(), "civic.townhall" | "civic.hall")),
        cathedral: threshold(|entry| entry.role == "worship.cathedral"),
    }
}

fn harbour_spec(culture: &str, cfg: &LayoutConfig, profile: profiles::UrbanProfile) -> HarbourSpec {
    let params = harbour::params(culture);
    let family = harbour_furniture::family_of(culture);
    let table = &harbour_furniture::data()["types"];
    let selected = &table[&cfg.port_type];
    let types: Vec<_> = if selected.is_object() {
        vec![selected]
    } else {
        family["types"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, weight)| weight.as_f64().is_some_and(|w| w > 0.0))
            .map(|(id, _)| &table[id])
            .collect()
    };
    let min_pop = |kind: &Value| kind["minPopulation"].as_f64().unwrap_or(0.0).ceil() as u32;
    let landing = types.iter().map(|kind| min_pop(kind)).min().unwrap_or(0);
    let is_simple = family["simple"].as_bool().unwrap_or(false);
    let piers = (!is_simple)
        .then(|| {
            types
                .iter()
                .filter(|kind| {
                    kind["berth"] == "alongside"
                        || kind["jetties"]["spacing"].as_f64().is_some_and(|m| m > 0.0)
                })
                .map(|kind| min_pop(kind).max(harbour_furniture::TOWN_PORT))
                .min()
        })
        .flatten();
    let moles = (!is_simple && (params.basin || !params.fondamenta))
        .then(|| {
            if cfg.port_type == "bare" {
                Some(harbour::MOLE_POPULATION_MIN)
            } else {
                types
                    .iter()
                    .filter(|kind| kind["moles"].as_f64().is_some_and(|p| p > 0.0))
                    .map(|kind| min_pop(kind).max(harbour::MOLE_POPULATION_MIN))
                    .min()
            }
        })
        .flatten();
    let enclosure_habit = match cfg.port_enclosure.as_str() {
        "inside" => HarbourEnclosure::SeaWall,
        "separate" | "outside" => HarbourEnclosure::HarbourOutside,
        _ if matches!(profile.fortification, "wall" | "auto") => HarbourEnclosure::SeaWall, // default, to tune on sheets
        _ => HarbourEnclosure::OpenFront, // default, to tune on sheets
    };
    // Classic's quay budget is half again as long for a harbour site or a port function.
    let port_function = cfg.programme.functions.as_ref().is_some_and(|f| f.port > 0.0);
    let port_factor = if matches!(cfg.site_archetype.as_str(), "harbor" | "harbour") || port_function {
        1.5
    } else {
        1.0
    };
    HarbourSpec {
        enclosure_habit,
        quay_per_sqrt_pop: params.quay_per_sqrt_pop,
        // Classic's pair of moles encloses the basin at the same date.
        thresholds: HarbourThresholds {
            landing,
            piers,
            moles,
            basins: moles,
        },
        works: HarbourWorksSpec {
            port_town: harbour::port_town(cfg),
            quay_width: params.quay_width,
            pier_spacing: params.pier_spacing,
            pier_length: [params.pier_length.0, params.pier_length.1],
            port_factor,
            ..HarbourWorksSpec::default()
        },
    }
}

fn phase_recipe(culture: &str, population: u32, name: &str, cfg: &LayoutConfig) -> String {
    if cfg.recipe == "auto" {
        composition::recipe(culture, population, name)
    } else {
        cfg.recipe.clone()
    }
}

fn phase_morph(
    culture: &str,
    recipe: &str,
    zone: &str,
    cfg: &LayoutConfig,
) -> Result<Morph, String> {
    composition::phase_morph(
        culture,
        recipe,
        zone,
        &cfg.preset,
        &cfg.recipe,
        cfg.density,
        &cfg.params,
        "quarters",
    )
    .map(|morph| with_tissue(morph, &cfg.tissue))
}

fn tissue_spec(
    id: &str,
    recipe: &str,
    zone: &str,
    profile: profiles::UrbanProfile,
    morph: &Morph,
    cfg: &LayoutConfig,
) -> TissueSpec {
    let pattern = match (cfg.tissue.as_str(), morph.text("streetOp"), profile.pattern) {
        ("grid", _, _) => "grid",
        ("culture", _, _) if !morph.text("campLayout").is_empty() => "camp",
        (_, "grid", _) => "grid",
        ("culture", _, "grid") => "organic",
        ("culture", _, "linear") => "string",
        ("culture", _, pattern) | (pattern, _, _) => pattern,
    };
    let parameters = morph
        .value
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| {
            let param = match value.get(zone).unwrap_or(value) {
                Value::Bool(value) => TissueParameter::Flag(*value),
                Value::String(value) => TissueParameter::Text(value.clone()),
                Value::Array(values) => TissueParameter::Numbers(
                    values.iter().map(Value::as_f64).collect::<Option<_>>()?,
                ),
                value => TissueParameter::Number(value.as_f64()?),
            };
            Some((name.clone(), param))
        })
        .collect();
    let organic = (morph.text("streetOp") == "organic" && pattern != "camp")
        .then(|| organic_params(morph, zone, pattern, cfg));
    TissueSpec {
        id: id.into(),
        pattern: pattern.into(),
        recipe: recipe.into(),
        zone: zone.into(),
        parameters,
        organic,
    }
}

fn organic_params(morph: &Morph, zone: &str, pattern: &str, cfg: &LayoutConfig) -> OrganicParams {
    let defaults = OrganicParams::default();
    let width_by_rank = std::array::from_fn(|i| {
        morph.value["widthByRank"][i]
            .as_f64()
            .unwrap_or(defaults.width_by_rank[i])
    });
    let orientation = match morph.text("orientation") {
        "cardinal" => FieldOrientation::Cardinal,
        "terrain" => FieldOrientation::Terrain,
        "water" => FieldOrientation::Water,
        _ => FieldOrientation::Road,
    };
    OrganicParams {
        orientation,
        field_wavelength: morph.number_or("fieldWavelength", defaults.field_wavelength),
        field_noise: morph.number_or("fieldNoise", defaults.field_noise),
        field_twist: morph.number_or("fieldTwist", defaults.field_twist),
        field_random: morph.number_or("fieldRandom", defaults.field_random),
        contour_follow: morph.number_or("contourFollow", defaults.contour_follow),
        contour_blend: morph.number_or("contourBlend", defaults.contour_blend),
        curvature: morph.number_or("curvature", defaults.curvature),
        radial: pattern == "radial",
        align_to_roads: cfg.axis_alignment == "regional",
        site_adaptation: cfg.site_adaptation,
        block_size: morph.block_size(zone),
        min_block: morph.number_or("minBlock", defaults.min_block),
        min_width: morph.number_or("minWidth", defaults.min_width),
        place_threshold: morph.number_or("placeThreshold", defaults.place_threshold),
        long_cut: morph.number_or("longCut", defaults.long_cut),
        max_aspect: if zone == "faubourg" {
            7.0
        } else {
            defaults.max_aspect
        },
        width_by_rank,
        width_scale: morph.number_or("widthScale", defaults.width_scale),
        width_jitter: morph.number_or("widthJitter", defaults.width_jitter),
        max_street_grade: cfg.max_street_grade,
        max_lane_grade: cfg.max_lane_grade,
        max_stair_grade: cfg.max_stair_grade,
        allow_stairs: profiles::stairs_allowed(cfg, &cfg.culture),
        ..defaults
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_tissues_are_resolved_in_their_birth_zones() {
        let specs = build("european-organic", &LayoutConfig::default()).unwrap();
        for phase in &specs.phases {
            let open = specs
                .tissues
                .iter()
                .find(|t| t.id == phase.tissue_id)
                .unwrap();
            let compact = specs
                .tissues
                .iter()
                .find(|t| t.id == phase.compact_tissue_id)
                .unwrap();
            assert_eq!(open.pattern, "organic");
            assert!(open.organic.is_some());
            assert_eq!(compact.zone, "core");
            assert!(phase.compact_density >= footprint::ENCLOSED_DENSITY);
        }
        assert_eq!(specs.phases[2].threshold, demographics::floor("town"));
        assert_eq!(specs.phases[3].threshold, kinds::WALLED_TOWN_MINIMUM);
    }

    #[test]
    fn the_catalogue_supplies_planned_and_waterfront_cultures() {
        let cfg = LayoutConfig::default();
        let chinese = build("chinese", &cfg).unwrap();
        assert!(chinese.charter.planned_share > 0.0);
        assert_eq!(
            chinese.charter.planned_founding_cohort,
            profiles::VILLAGE_PROFILE_LIMIT
        );
        assert!(
            chinese
                .tissues
                .iter()
                .any(|t| t.id == chinese.charter.planned_tissue_id && t.pattern == "grid")
        );

        let hanseatic = build("hanseatic", &cfg).unwrap();
        assert_eq!(
            hanseatic.charter.founding_rule.first(),
            Some(&FoundingFocusKind::HarbourFront)
        );
        assert_eq!(
            hanseatic.harbour.quay_per_sqrt_pop,
            harbour::params("hanseatic").quay_per_sqrt_pop
        );
        assert_eq!(
            hanseatic.harbour.thresholds.piers,
            Some(harbour_furniture::TOWN_PORT)
        );
    }
}
