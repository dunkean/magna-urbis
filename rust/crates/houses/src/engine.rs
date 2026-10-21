//! Pure seeded composition; configuration, geometry and budgets fail atomically.
use crate::access;
use crate::catalogue::{
    Catalogue, Envelope, Layout, Parameters, Placement, Recipe, SupportKind, catalogue,
};
use crate::geometry::*;
use crate::layouts::{BodySpec, build_layout, feature};
use crate::model::*;
use crate::roofs;
use magna_urbis_random::Rng;
use std::collections::BTreeMap;
#[path = "floor_complement.rs"]
mod floor_complement;

pub const MAX_ROOMS: u32 = 2400;
pub const MAX_BODIES: u32 = 600;
pub const MAX_BATCH_FACES: u32 = 20_000;

pub(crate) fn exposed_roof_domain(domain: &Surface, upper: &Surface) -> Surface {
    difference(domain, upper)
}

#[cfg(test)]
fn native_level_footprints(unit: &HouseUnit) -> Vec<(String, u32, Surface)> {
    unit.bodies
        .iter()
        .flat_map(|b| {
            b.levels
                .iter()
                .map(move |l| (b.id.clone(), l.index, l.footprint.clone()))
        })
        .collect()
}

fn amount(range: [f64; 2], variation: f64, wealth: f64, rng: &mut Rng) -> f64 {
    let center = if wealth == 0.5 {
        (range[0] + range[1]) * 0.5
    } else {
        range[0] + (range[1] - range[0]) * wealth
    };
    snap(
        (center + (rng.range(range[0], range[1]) - (range[0] + range[1]) * 0.5) * variation)
            .clamp(range[0], range[1]),
    )
}

fn quantity(range: [u32; 2], wealth: f64, rng: &mut Rng) -> u32 {
    let drawn = rng.int(range[0], range[1]);
    if wealth == 0.5 {
        drawn
    } else {
        (drawn as i64 + libm::round((wealth - 0.5) * (range[1] - range[0]) as f64) as i64)
            .clamp(range[0] as i64, range[1] as i64) as u32
    }
}

fn component_program(p: &Parameters) -> bool {
    !(p.components.len() == 1 && p.components[0].id == "main")
        && p.components
            .iter()
            .any(|c| c.role.residential() && c.placement != Placement::FacingMain)
}

#[derive(Clone, Copy)]
enum UnitSource<'a> {
    Atlas(&'a Recipe),
    Workshop(&'a crate::workshop::WorkshopPreset),
}

impl UnitSource<'_> {
    fn identity(&self) -> (&str, &str, Role) {
        match self {
            Self::Atlas(recipe) => (&recipe.id, &recipe.label, recipe.role),
            Self::Workshop(preset) => (&preset.id, &preset.label, Role::Dwelling),
        }
    }
}

fn resolve_draws(mut p: Parameters, config: &HouseConfig, rng: &Rng) -> Result<Parameters, String> {
    let programme = component_program(&p);
    let component_bounds: Vec<_> = p.components.iter().map(|c| (c.count, c.floors)).collect();
    let mut dimensions = rng.fork("dimensions");
    if config.workshop.is_none() {
        p.width_m =
            [amount(p.width_m, config.variation, config.wealth, &mut dimensions) * config.size; 2];
        p.depth_m =
            [amount(p.depth_m, config.variation, config.wealth, &mut dimensions) * config.size; 2];
    }
    p.wall_thickness_m = [amount(
        p.wall_thickness_m,
        config.variation,
        config.wealth,
        &mut dimensions,
    ); 2];
    p.courtyard_ratio = [amount(
        p.courtyard_ratio,
        config.variation,
        config.wealth,
        &mut dimensions,
    ); 2];
    let mut elevation = rng.fork("elevation");
    p.floors = [quantity(p.floors, config.wealth, &mut elevation); 2];
    p.bodies = [quantity(p.bodies, config.wealth, &mut elevation); 2];
    p.cells = [quantity(p.cells, config.wealth, &mut elevation); 2];
    p.rooms_per_body = [quantity(p.rooms_per_body, config.wealth, &mut elevation); 2];
    p.support.height_m = [amount(
        p.support.height_m,
        config.variation,
        config.wealth,
        &mut elevation,
    ); 2];
    let mut roof = rng.fork("roof");
    p.roof_pitch_deg = [amount(p.roof_pitch_deg, config.variation, config.wealth, &mut roof); 2];
    p.overhang_m = [amount(p.overhang_m, config.variation, config.wealth, &mut roof); 2];
    let mut components = rng.fork("component-parameters");
    for c in &mut p.components {
        c.count = [quantity(c.count, config.wealth, &mut components); 2];
        c.width_ratio = [amount(
            c.width_ratio,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
        c.depth_ratio = [amount(
            c.depth_ratio,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
        c.floors = [quantity(c.floors, config.wealth, &mut components); 2];
        c.rooms_per_body = [quantity(c.rooms_per_body, config.wealth, &mut components); 2];
        c.roof_pitch_deg = [amount(
            c.roof_pitch_deg,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
        c.overhang_m = [amount(
            c.overhang_m,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
        c.wall_thickness_m = [amount(
            c.wall_thickness_m,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
        c.support.height_m = [amount(
            c.support.height_m,
            config.variation,
            config.wealth,
            &mut components,
        ); 2];
    }
    if programme {
        let residents: Vec<_> = p
            .components
            .iter()
            .enumerate()
            .filter(|(_, c)| c.role.residential() && c.placement != Placement::FacingMain)
            .map(|(i, _)| i)
            .collect();
        if let Some(target) = config.overrides.bodies {
            let mut current: i64 = residents
                .iter()
                .map(|&i| p.components[i].count[0] as i64)
                .sum();
            for &i in &residents {
                let old = p.components[i].count[0];
                let bounds = component_bounds[i].0;
                let next = (old as i64 + (target as i64 - current))
                    .clamp(bounds[0] as i64, bounds[1] as i64) as u32;
                p.components[i].count = [next; 2];
                current += next as i64 - old as i64;
            }
            if current != target as i64 {
                return Err(format!(
                    "Programme composé : {target} corps principaux incompatibles avec les quantités de ses composants."
                ));
            }
        }
        let primary = residents
            .iter()
            .copied()
            .find(|&i| p.components[i].placement == Placement::Main)
            .or_else(|| residents.first().copied());
        for (i, c) in p
            .components
            .iter_mut()
            .enumerate()
            .filter(|(i, _)| Some(*i) == primary)
        {
            if let Some(floors) = config.overrides.floors {
                let bounds = component_bounds[i].1;
                if !(bounds[0]..=bounds[1]).contains(&floors) {
                    return Err(format!(
                        "Composant {} : {floors} niveaux hors programme déclaré.",
                        c.id
                    ));
                }
                c.floors = [floors; 2];
            }
            if config.overrides.roof.is_some() {
                c.roof_system = p.roof_system.clone();
            }
            if let Some(value) = config.overrides.roof_pitch_deg {
                c.roof_pitch_deg = [value; 2];
            }
            if let Some(value) = config.overrides.overhang_m {
                c.overhang_m = [value; 2];
            }
            for (target, value) in [
                (&mut c.materials.frame, &config.overrides.frame),
                (&mut c.materials.infill, &config.overrides.infill),
                (&mut c.materials.coating, &config.overrides.coating),
                (&mut c.materials.cladding, &config.overrides.cladding),
            ] {
                if let Some(value) = value {
                    *target = value.clone();
                }
            }
        }
        p.bodies = [residents.iter().map(|&i| p.components[i].count[0]).sum(); 2];
        p.floors = [residents
            .iter()
            .map(|&i| p.components[i].floors[0])
            .max()
            .unwrap_or(1); 2];
    }
    Ok(p)
}

fn recipe_estimate(p: &Parameters) -> ResourceEstimate {
    let components = if p.components.len() == 1 && p.components[0].id == "main" {
        0
    } else {
        p.components.iter().map(|c| c.count[1]).sum()
    };
    let bodies = if component_program(p) {
        components
    } else {
        p.bodies[1] + components
    };
    let cells = p.cells[1].max(p.bodies[1]);
    let rooms = if component_program(p) {
        0
    } else {
        cells * p.floors[1] * p.rooms_per_body[1]
    } + p
        .components
        .iter()
        .filter(|c| c.id != "main")
        .map(|c| c.count[1] * c.floors[1] * c.rooms_per_body[1])
        .sum::<u32>();
    let faces_per = match p.roof_system.as_str() {
        "uncovered" => 0,
        "RF-FLAT" | "RF-STEP" => 4,
        "RF-GABLE" | "RF-SHED" => 8,
        "RF-HIP" | "RF-EAVES" | "RF-REED-HIP" => 12,
        "RF-CONE" | "RF-TENT" => p.roof_spec.round_segments * 2,
        _ => p.roof_spec.round_segments * p.roof_spec.curve_sections * 2,
    };
    ResourceEstimate {
        bodies,
        rooms,
        faces: cells * faces_per + components * 48,
    }
}

pub fn preflight(config: HouseConfig) -> Result<Preflight, String> {
    let data = catalogue()?;
    data.validate_config(&config)?;
    let admissible_ids = if let Some(workshop) = &config.workshop {
        vec![workshop.preset_id.clone()]
    } else {
        data.admissible(&config)?
            .iter()
            .map(|r| r.id.clone())
            .collect()
    };
    let mut estimate = ResourceEstimate {
        bodies: 0,
        rooms: 0,
        faces: 0,
    };
    for (_, p, seed) in selected_draws(data, &config)? {
        let e = if config.workshop.is_some() {
            let plan = crate::layouts::build_workshop_layout(Role::Dwelling, &p, &seed)?;
            let mut e = ResourceEstimate {
                bodies: plan.bodies.len() as u32,
                rooms: 0,
                faces: 0,
            };
            for body in plan.bodies {
                let cells = (body.cells.len() as u32).max(1);
                e.rooms += cells * body.levels.len() as u32 * body.parameters.rooms_per_body[1];
                let mut body_parameters = body.parameters;
                body_parameters.bodies = [1, 1];
                body_parameters.cells = [cells, cells];
                e.faces += recipe_estimate(&body_parameters).faces;
            }
            e
        } else {
            recipe_estimate(&p)
        };
        estimate.bodies = estimate.bodies.max(e.bodies);
        estimate.rooms = estimate.rooms.max(e.rooms);
        estimate.faces = estimate.faces.max(e.faces);
    }
    if estimate.rooms > MAX_ROOMS {
        return Err(format!(
            "Budget de pièces : {} > {MAX_ROOMS} par unité.",
            estimate.rooms
        ));
    }
    if estimate.bodies > MAX_BODIES {
        return Err(format!(
            "Budget de corps : {} > {MAX_BODIES} par unité.",
            estimate.bodies
        ));
    }
    // Large palettes are allowed; the exact selected batch gets a pre-geometry estimate.
    let mut rejected = vec![];
    for r in data
        .recipes
        .iter()
        .filter(|r| config.workshop.is_none() && r.pack_id == config.pack)
    {
        let mut single = config.clone();
        single.recipe = Some(r.id.clone());
        if let Err(reason) = data.admissible(&single) {
            rejected.push(RejectedRecipe {
                id: r.id.clone(),
                reason,
            });
        }
    }
    Ok(Preflight {
        schema_version: crate::SCHEMA_VERSION.into(),
        settings: config,
        admissible_recipes: admissible_ids,
        rejected_recipes: rejected,
        estimate,
        budgets: ResourceEstimate {
            bodies: MAX_BODIES,
            rooms: MAX_ROOMS,
            faces: MAX_BATCH_FACES,
        },
    })
}

fn selected_draws<'a>(
    data: &'a Catalogue,
    config: &HouseConfig,
) -> Result<Vec<(UnitSource<'a>, Parameters, String)>, String> {
    if config.workshop.is_some() {
        let (preset, p) = crate::workshop::resolve(data, config)?;
        let rng = Rng::new(&format!("houses:v2:{}", config.seed));
        return (0..config.count)
            .map(|index| {
                let unit_rng = rng.fork(&format!("unit:{index}"));
                Ok((
                    UnitSource::Workshop(preset),
                    resolve_draws(p.clone(), config, &unit_rng)?,
                    format!("houses:v2:{}:unit:{index}", config.seed),
                ))
            })
            .collect();
    }
    let palette = data.admissible(config)?;
    let rng = Rng::new(&format!("houses:v2:{}", config.seed));
    let weights: Vec<_> = palette
        .iter()
        .map(|r| if config.recipe.is_some() { 1 } else { r.weight })
        .collect();
    let mut selected = vec![];
    for index in 0..config.count {
        let unit_rng = rng.fork(&format!("unit:{index}"));
        let recipe = palette[unit_rng.fork("recipe").weighted_index(&weights)?];
        let mut bundles = vec![data.resolve_parameters(recipe, config)?];
        for v in recipe
            .variants
            .iter()
            .filter(|_| config.overrides.variant.is_none())
        {
            if let Ok(p) = data.resolve_variant_parameters(recipe, config, &v.id) {
                bundles.push(p);
            }
        }
        let variant = if config.variation == 0.0 {
            0
        } else {
            unit_rng.fork("variant").int(0, bundles.len() as u32 - 1) as usize
        };
        let p = resolve_draws(bundles.remove(variant), config, &unit_rng)?;
        selected.push((
            UnitSource::Atlas(recipe),
            p,
            format!("houses:v2:{}:unit:{index}", config.seed),
        ));
    }
    Ok(selected)
}

pub fn generate_batch(config: HouseConfig) -> Result<HouseBatch, String> {
    preflight(config.clone())?;
    let data = catalogue()?;
    let selected = selected_draws(data, &config)?;
    let estimate = selected
        .iter()
        .try_fold(0u32, |n, (_, p, _)| n.checked_add(recipe_estimate(p).faces))
        .ok_or("Budget de faces dépassé.")?;
    // Conservative RF estimates can exceed the exact overlay output; verify before
    // roof construction per unit and on the completed batch, never shrink a draw.
    let mut batch = HouseBatch {
        schema_version: crate::SCHEMA_VERSION.into(),
        catalogue_version: data.catalogue_version.clone(),
        generator_version: crate::GENERATOR_VERSION.into(),
        settings: config.clone(),
        units: vec![],
        diagnostics: vec![
            "Dimensions graphiques heuristiques ; voir confiance et provenance du catalogue."
                .into(),
        ],
    };
    if estimate > MAX_BATCH_FACES {
        batch.diagnostics.push(format!(
            "Estimation conservative {estimate} faces ; plafond réel {MAX_BATCH_FACES}."
        ));
    }
    let mut total_faces = 0usize;
    for (i, (source, p, seed)) in selected.into_iter().enumerate() {
        let mut unit = generate_unit(source, &p, &config, &seed, i as u32)?;
        #[cfg(test)]
        let footprints_before_roofs = native_level_footprints(&unit);
        roofs::build_roofs_with_budget(&mut unit, MAX_BATCH_FACES as usize)?;
        crate::features::add_post_roof_details(&mut unit, &p)?;
        #[cfg(test)]
        assert_eq!(native_level_footprints(&unit), footprints_before_roofs);
        total_faces += unit.roofs.faces.len();
        if total_faces > MAX_BATCH_FACES as usize {
            return Err(format!(
                "Budget réel de faces : {total_faces} > {MAX_BATCH_FACES}."
            ));
        }
        crate::validation::validate_unit(&unit)?;
        batch.units.push(unit);
    }
    Ok(batch)
}

/// The same recipe draws and LayoutPlan used by the detailed generator, retained
/// before rooms, wall booleans, access graphs and roof meshes are constructed.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ResolvedArchitecture {
    pub schema_version: String,
    pub generator_version: String,
    pub config: HouseConfig,
    pub recipe_id: String,
    pub(crate) parameters: Parameters,
    pub(crate) plan: crate::layouts::LayoutPlan,
    #[serde(default)]
    pub(crate) entrance: Option<crate::access::StructuralEntrance>,
}

pub fn resolve_architecture(mut config: HouseConfig) -> Result<ResolvedArchitecture, String> {
    resolve_architecture_for_site(&mut config, None, None, false, None, false)
}

pub(crate) fn resolve_urban_architecture(
    mut config: HouseConfig,
    function: crate::placement::ArchitectureFunction,
    envelope_m: [f64; 2],
    minimum: bool,
    occupation_m: Option<[f64; 2]>,
    coverage: Option<f64>,
    parcel_fit: bool,
) -> Result<ResolvedArchitecture, String> {
    let mut resolved = resolve_architecture_for_site(
        &mut config,
        Some(function),
        Some(envelope_m),
        minimum,
        occupation_m,
        parcel_fit,
    )?;
    if !minimum
        && matches!(
            function,
            crate::placement::ArchitectureFunction::Domestic
                | crate::placement::ArchitectureFunction::Mixed
        )
        && config.mode != HistoricalMode::HistoricalStrict
        && let Some(coverage) = coverage
    {
        crate::layouts::urban_frontage_infill(
            &mut resolved.plan,
            &resolved.parameters,
            coverage,
            &config.seed,
        );
    }
    Ok(resolved)
}

fn resolve_architecture_for_site(
    config: &mut HouseConfig,
    function: Option<crate::placement::ArchitectureFunction>,
    envelope_m: Option<[f64; 2]>,
    minimum: bool,
    occupation_m: Option<[f64; 2]>,
    parcel_fit: bool,
) -> Result<ResolvedArchitecture, String> {
    config.count = 1;
    let data = catalogue()?;
    data.validate_config(config)?;
    let (source, mut parameters, mut seed) = selected_draws(data, config)?
        .into_iter()
        .next()
        .ok_or("No architecture selected.")?;
    if let (UnitSource::Atlas(recipe), Some(envelope)) = (source, envelope_m) {
        let bounds = recipe
            .variants
            .iter()
            .find(|v| v.parameters.variant_id == parameters.variant_id)
            .map(|v| &v.parameters)
            .unwrap_or(&recipe.parameters);
        if minimum {
            seed = format!("urban-admission-v1:{}", recipe.id);
            let coherent =
                data.resolve_variant_parameters(recipe, config, &parameters.variant_id)?;
            let mut compact = coherent.clone();
            crate::admission::minimum(&mut compact);
            // Explicit controls retain the source bounds checked by resolve_draws.
            if config.overrides.floors.is_some() && component_program(&compact) {
                for (c, b) in compact.components.iter_mut().zip(&coherent.components) {
                    c.floors = b.floors;
                }
            }
            if config.overrides.bodies.is_some() && component_program(&compact) {
                for (c, b) in compact.components.iter_mut().zip(&coherent.components) {
                    c.count = b.count;
                }
            }
            if component_program(&compact)
                && (config.overrides.floors.is_some() || config.overrides.bodies.is_some())
            {
                let unit_rng = Rng::new(&format!("houses:v2:{}", config.seed)).fork("unit:0");
                parameters = resolve_draws(compact, config, &unit_rng)?;
            } else {
                // Exactly the source-minimum parameters used by admission,
                // including unsnapped source ratios. Do not redraw/resnap a
                // canonical construction certificate through amount().
                compact.width_m.iter_mut().for_each(|v| *v *= config.size);
                compact.depth_m.iter_mut().for_each(|v| *v *= config.size);
                parameters = compact;
            }
        }
        for (axis, (range, source_range, available)) in [
            (&mut parameters.width_m, bounds.width_m, envelope[0]),
            (&mut parameters.depth_m, bounds.depth_m, envelope[1]),
        ]
        .into_iter()
        .enumerate()
        {
            let min = source_range[0] * config.size;
            let adaptable = parcel_fit
                && !minimum
                && config.mode != HistoricalMode::HistoricalStrict
                && matches!(
                    parameters.layout,
                    Layout::Single | Layout::Strip | Layout::Courtyard | Layout::Siheyuan
                );
            let max = source_range[1] * config.size * if adaptable { 2.0 } else { 1.0 };
            if available < min {
                return Err(format!(
                    "Declared minimum architectural envelope {min:.2} m exceeds available site span {available:.2} m."
                ));
            }
            let requested = if minimum {
                range[0]
            } else {
                occupation_m.map_or(range[0], |v| v[axis])
            };
            let fitted = requested.min(available).clamp(min, max);
            range.fill(fitted);
        }
    }
    let non_domestic = function.is_some_and(|f| {
        matches!(
            f,
            crate::placement::ArchitectureFunction::Workshop
                | crate::placement::ArchitectureFunction::Warehouse
                | crate::placement::ArchitectureFunction::Collective
        )
    });
    if non_domestic {
        // Explicit programme adaptation of the existing recipe/primitive. Keep
        // culture's actual materials/roof/support; no domestic rooms or annexes.
        parameters.bodies = [1; 2];
        parameters.cells = [1; 2];
        parameters.rooms_per_body = [1; 2];
        parameters.components.clear();
        parameters.court_program = None;
        parameters.enclosures.clear();
        parameters
            .details
            .retain(|d| matches!(d.as_str(), "posts" | "piers" | "raft" | "party_walls"));
        if !matches!(
            parameters.layout,
            Layout::Single | Layout::Strip | Layout::Platform
        ) {
            if config.mode == HistoricalMode::HistoricalStrict {
                return Err(
                    "No strict non-domestic adaptation is declared for this compound layout."
                        .into(),
                );
            }
            parameters.layout = Layout::Single;
        }
        match function.unwrap() {
            crate::placement::ArchitectureFunction::Workshop => {
                if config.overrides.floors.is_none() {
                    parameters.floors = [1; 2];
                }
                if config.mode != HistoricalMode::HistoricalStrict {
                    parameters.level_height_m = parameters.level_height_m.max(3.0);
                }
            }
            crate::placement::ArchitectureFunction::Warehouse => {
                if config.overrides.floors.is_none() {
                    parameters.floors = [1; 2];
                }
                if config.mode != HistoricalMode::HistoricalStrict {
                    parameters.level_height_m = (parameters.level_height_m * 1.25).min(4.5);
                }
            }
            crate::placement::ArchitectureFunction::Collective => {
                if let UnitSource::Atlas(recipe) = source
                    && config.overrides.floors.is_none()
                {
                    parameters.floors = [recipe.parameters.floors[1].clamp(1, 3); 2];
                }
            }
            _ => {}
        }
    }
    let mut plan = match source {
        UnitSource::Atlas(recipe) => build_layout(recipe, &parameters, &seed)?,
        UnitSource::Workshop(_) => {
            crate::layouts::build_workshop_layout(Role::Dwelling, &parameters, &seed)?
        }
    };
    if parcel_fit && !minimum && config.mode != HistoricalMode::HistoricalStrict {
        plan.diagnostics.push("Explicit urban lot fitting: eligible simple plans may extend width/depth to twice the source maxima; source minima, native layout, levels, roof and final site admission are retained. Artistic adaptation, not measured historical dimensions.".into());
    }
    if minimum {
        plan.diagnostics.push("Canonical native minimum layout matching the versioned admission witness; accepted plan retained without reroll.".into());
    }
    if non_domestic {
        for body in &mut plan.bodies {
            body.role = Role::NonDomestic;
        }
        plan.diagnostics.push(format!("Explicit {:?} programme: open-span functional envelope, no domestic annexes or household interior.",function.unwrap()));
    }
    Ok(ResolvedArchitecture {
        schema_version: crate::SCHEMA_VERSION.into(),
        generator_version: crate::GENERATOR_VERSION.into(),
        recipe_id: source.identity().0.into(),
        parameters,
        plan,
        config: config.clone(),
        entrance: None,
    })
}

pub fn enrich_architecture(resolved: &ResolvedArchitecture) -> Result<HouseBatch, String> {
    if resolved
        .plan
        .bodies
        .iter()
        .any(|b| b.role == Role::NonDomestic)
    {
        return Err(
            "Retained non-domestic programme has no compatible detailed interior recipe.".into(),
        );
    }
    if resolved.generator_version != crate::GENERATOR_VERSION
        || resolved.schema_version != crate::SCHEMA_VERSION
    {
        return Err(
            "Resolved architecture version is incompatible; retained geometry was not regenerated."
                .into(),
        );
    }
    let data = catalogue()?;
    data.validate_config(&resolved.config)?;
    let source = if resolved.config.workshop.is_some() {
        UnitSource::Workshop(
            data.workshop_presets
                .iter()
                .find(|p| p.id == resolved.recipe_id)
                .ok_or("Unknown retained workshop preset.")?,
        )
    } else {
        UnitSource::Atlas(
            data.recipes
                .iter()
                .find(|r| r.id == resolved.recipe_id)
                .ok_or("Unknown retained recipe.")?,
        )
    };
    let mut unit = generate_unit_from_plan(
        source,
        &resolved.parameters,
        &resolved.config,
        0,
        resolved.plan.clone(),
        resolved.entrance.as_ref(),
    )?;
    roofs::build_roofs_with_budget(&mut unit, MAX_BATCH_FACES as usize)?;
    crate::features::add_post_roof_details(&mut unit, &resolved.parameters)?;
    // Enrichment must be an exact elaboration of the retained plan, not a reroll.
    if unit.bodies.len() != resolved.plan.bodies.len() {
        return Err(
            "Enrichment adds structural bodies absent from the retained volume plan.".into(),
        );
    }
    for (body, spec) in unit.bodies.iter().zip(&resolved.plan.bodies) {
        if body.footprint != spec.footprint
            || body.levels.len() != spec.levels.len()
            || body
                .levels
                .iter()
                .zip(&spec.levels)
                .any(|(level, domain)| level.footprint != *domain)
        {
            return Err("Enrichment changes the retained structural footprint or levels.".into());
        }
    }
    let detailed_roof = structural_roof_signature(&unit);
    let retained_roof = structural_roof_signature(&volume_unit(resolved)?);
    if detailed_roof != retained_roof {
        return Err("Enrichment changes the retained native body roof surfaces; city volumes are preserved.".into());
    }
    crate::validation::validate_unit(&unit)?;
    Ok(HouseBatch {
        schema_version: crate::SCHEMA_VERSION.into(),
        catalogue_version: data.catalogue_version.clone(),
        generator_version: crate::GENERATOR_VERSION.into(),
        settings: resolved.config.clone(),
        units: vec![unit],
        diagnostics: vec![
            "Detailed enrichment of retained resolved architecture; no new draws.".into(),
        ],
    })
}

fn structural_roof_signature(unit: &HouseUnit) -> Vec<(String, String, Vec<[i64; 3]>)> {
    // Structural roof surfaces must stay exact. Native detailed openings may
    // subdivide/cut vertical gables and tympana, as they subdivide facade walls;
    // these infill details do not change the retained roof envelope.
    let mut faces: Vec<_> = unit
        .roofs
        .faces
        .iter()
        .filter(|f| {
            f.feature_id.is_none()
                && matches!(
                    f.kind,
                    RoofFaceKind::Pan
                        | RoofFaceKind::Slab
                        | RoofFaceKind::Skirt
                        | RoofFaceKind::CorbelSoffit
                )
        })
        .map(|f| {
            let mut vertices: Vec<_> = f
                .vertices
                .iter()
                .map(|i| {
                    let v = &unit.roofs.vertices[*i as usize];
                    [
                        libm::round(v.x * 1e6) as i64,
                        libm::round(v.y * 1e6) as i64,
                        libm::round(v.z * 1e6) as i64,
                    ]
                })
                .collect();
            vertices.sort();
            (f.body_id.clone(), f.material.clone(), vertices)
        })
        .collect();
    faces.sort();
    faces
}

pub(crate) fn body_level_height(spec: &BodySpec) -> f64 {
    let p = &spec.parameters;
    if matches!(p.envelope, Envelope::Shell | Envelope::Membrane) {
        let b = bounds(&spec.footprint);
        ((b[2] - b[0]).min(b[3] - b[1]) * 0.4).clamp(1.2, 2.8)
    } else {
        p.level_height_m
    }
}

fn body_intermediate_cover(roof: &str) -> IntermediateCover {
    match roof {
        "RF-FLAT" | "RF-STEP" => IntermediateCover::Terrace,
        "RF-CURVED" | "RF-TIERED" => IntermediateCover::Skirt,
        _ => IntermediateCover::Shed,
    }
}

/// Structural terrace domain shared by the lightweight and detailed paths.
/// RF-FLAT/RF-STEP roofs consume this slab instead of inventing an eave domain.
fn body_roof_slab(
    domain: &Surface,
    upper: &Surface,
    roof_system: &str,
    z_m: f64,
    height_m: f64,
) -> Option<RoofSlab> {
    let exposed = exposed_roof_domain(domain, upper);
    (matches!(roof_system, "RF-FLAT" | "RF-STEP") && !exposed.is_empty()).then_some(RoofSlab {
        surface: exposed,
        z_m: z_m + height_m,
        walkable: true,
        access_node: None,
    })
}

/// Structural bodies and native roof geometry only. This consumes the retained
/// layout and never invokes room subdivision, detail generation or recipe draws.
pub(crate) fn volume_unit(resolved: &ResolvedArchitecture) -> Result<HouseUnit, String> {
    let plan = &resolved.plan;
    let mut unit = HouseUnit {
        id: "unit-0".into(),
        recipe_id: resolved.recipe_id.clone(),
        variant_id: resolved.parameters.variant_id.clone(),
        label: resolved.recipe_id.clone(),
        role: Role::Dwelling,
        transform: Transform {
            origin: point(0., 0.),
            orientation_deg: 0.,
        },
        lot: plan.lot.clone(),
        partition: partition(
            &plan.lot,
            vec![],
            plan.courts.clone(),
            plan.paths.clone(),
            PartitionService::Surface(vec![]),
        ),
        level_partitions: vec![],
        levels: vec![],
        bodies: vec![],
        rooms: vec![],
        features: plan.features.clone(),
        site_context: vec![],
        walls: vec![],
        access: AccessGraph {
            root: String::new(),
            nodes: vec![],
            portals: vec![],
        },
        roofs: RoofMesh::default(),
        diagnostics: plan.diagnostics.clone(),
    };
    for (i, spec) in plan.bodies.iter().enumerate() {
        let p = &spec.parameters;
        let height = body_level_height(spec);
        add_body_supports(
            &mut unit,
            &spec.footprint,
            spec.z,
            p,
            &format!("unit-0:body:{i}"),
            height,
        );
        let levels = spec
            .levels
            .iter()
            .enumerate()
            .map(|(index, footprint)| {
                let z_m = snap(spec.z + index as f64 * height);
                let upper = spec.levels.get(index + 1).cloned().unwrap_or_default();
                Level {
                    index: index as u32,
                    z_m,
                    height_m: height,
                    footprint: footprint.clone(),
                    floor: footprint.clone(),
                    intermediate_cover: body_intermediate_cover(&p.roof_system),
                    roof_slab: body_roof_slab(footprint, &upper, &p.roof_system, z_m, height),
                    materials: p
                        .level_materials
                        .iter()
                        .find(|m| m.from_level <= index as u32 && m.to_level >= index as u32)
                        .map(|m| m.materials.clone())
                        .unwrap_or_else(|| p.materials.clone()),
                }
            })
            .collect();
        unit.bodies.push(Body {
            id: format!("unit-0:body:{i}"),
            footprint: spec.footprint.clone(),
            voids: spec.voids.clone(),
            levels,
            roof_system: p.roof_system.clone(),
            roof_pitch_deg: p.roof_pitch_deg[0],
            overhang_m: p.overhang_m[0],
            details: p.details.clone(),
            role: spec.role,
            envelope: p.envelope,
            vertical_access: p.vertical_access,
            vertical_routes: p.vertical_routes.clone(),
            wall_thickness_m: p.wall_thickness_m[0],
            component_id: spec.component.clone(),
            roof_spec: p.roof_spec.clone(),
            roof_arms: spec.arms.clone(),
            cells: spec.cells.clone(),
        });
    }
    crate::features::add_structural_circulation(&mut unit, &resolved.parameters)?;
    add_site_enclosures(&mut unit);
    roofs::build_roofs_with_budget(&mut unit, MAX_BATCH_FACES as usize)?;
    Ok(unit)
}

enum PartitionService {
    Surface(Surface),
    // Caller guarantees D = footprint_domain union (circulation intersect lot).
    // Thus Fu is included in D and every added part of D is excluded by W.
    FloorComplement {
        floor: Surface,
        footprint_domain: Surface,
    },
}

fn partition(
    domain: &Surface,
    occupied: Surface,
    courts: Surface,
    circulation: Surface,
    service: PartitionService,
) -> Partition {
    // Each category and its remainder use the same raw mask. Re-unioning
    // derived categories creates nearly coincident boundaries on new grids.
    let occupied_part = if matches!(service, PartitionService::FloorComplement { .. }) {
        floor_complement::occupied(domain, &occupied)
    } else {
        intersection(domain, &occupied)
    };
    let remaining = difference(domain, &occupied);
    let courtyards = intersection(&remaining, &courts);
    let remaining = difference(&remaining, &courts);
    let circulation_part = intersection(&remaining, &circulation);
    let (service, residual) = match service {
        PartitionService::Surface(raw) => {
            let remaining = difference(&remaining, &circulation);
            (intersection(&remaining, &raw), difference(&remaining, &raw))
        }
        PartitionService::FloorComplement {
            floor,
            footprint_domain,
        } => floor_complement::parts(&footprint_domain, &occupied, &courts, &circulation, &floor),
    };
    Partition {
        occupied: occupied_part,
        courtyards,
        circulation: circulation_part,
        service,
        residual,
    }
}

fn generate_unit(
    source: UnitSource<'_>,
    p: &Parameters,
    config: &HouseConfig,
    seed: &str,
    index: u32,
) -> Result<HouseUnit, String> {
    let plan = match &source {
        UnitSource::Atlas(recipe) => build_layout(recipe, p, seed)?,
        UnitSource::Workshop(_) => {
            crate::layouts::build_workshop_layout(source.identity().2, p, seed)?
        }
    };
    generate_unit_from_plan(source, p, config, index, plan, None)
}

fn generate_unit_from_plan(
    source: UnitSource<'_>,
    p: &Parameters,
    config: &HouseConfig,
    index: u32,
    plan: crate::layouts::LayoutPlan,
    entrance: Option<&crate::access::StructuralEntrance>,
) -> Result<HouseUnit, String> {
    let (id, label, role) = source.identity();
    let mut unit = HouseUnit {
        id: format!("unit-{index}"),
        recipe_id: id.into(),
        variant_id: p.variant_id.clone(),
        label: label.into(),
        role,
        transform: Transform {
            origin: point(0.0, 0.0),
            orientation_deg: config.orientation_deg,
        },
        lot: plan.lot.clone(),
        partition: partition(
            &plan.lot,
            vec![],
            plan.courts.clone(),
            plan.paths.clone(),
            PartitionService::Surface(vec![]),
        ),
        level_partitions: vec![],
        levels: vec![],
        bodies: vec![],
        rooms: vec![],
        features: plan.features,
        site_context: plan.context,
        walls: vec![],
        access: AccessGraph {
            root: String::new(),
            nodes: vec![],
            portals: vec![],
        },
        roofs: RoofMesh::default(),
        diagnostics: plan.diagnostics,
    };
    let mut circulations = vec![(0.0, plan.paths.clone())];
    if p.layout == Layout::Excavated
        || (config.workshop.is_some() && p.footprint_family == "FP-ROCKCUT")
    {
        circulations.push((-2.4, union(&plan.courts, &plan.paths)));
    }
    for (bi, spec) in plan.bodies.into_iter().enumerate() {
        build_body(&mut unit, spec, bi, &mut circulations)?;
    }
    if matches!(p.layout, Layout::Cliff | Layout::Parallel) {
        for body in &unit.bodies {
            let z = body.levels[0].z_m;
            if z != 0.0 {
                circulations.push((z, plan.paths.clone()));
            }
        }
    }
    build_tunnels(&mut unit, p, &mut circulations)?;
    #[cfg(test)]
    let footprints_before_access = native_level_footprints(&unit);
    if unit.rooms.len() > MAX_ROOMS as usize || unit.bodies.len() > MAX_BODIES as usize {
        return Err("Budget de pièces/corps dépassé avant toitures.".into());
    }
    let mut extents: BTreeMap<u32, (f64, f64)> = BTreeMap::new();
    for body in &unit.bodies {
        for level in &body.levels {
            let extent = extents
                .entry(level.index)
                .or_insert((level.z_m, level.z_m + level.height_m));
            extent.0 = extent.0.min(level.z_m);
            extent.1 = extent.1.max(level.z_m + level.height_m);
        }
    }
    unit.levels = extents
        .into_iter()
        .map(|(index, (z_min, z_max))| UnitLevel {
            index,
            z_min,
            z_max,
        })
        .collect();
    // The dedicated details module is installed after its reviewed catalogue block.
    if let UnitSource::Atlas(recipe) = &source {
        crate::features::add_details(&mut unit, recipe, p, config)?;
    } else {
        crate::features::add_details_for_role(&mut unit, role, p, config)?;
    }
    add_site_enclosures(&mut unit);
    access::build_access_with_entry(&mut unit, &circulations, p, entrance)?;
    crate::features::add_post_access_details(&mut unit, p)?;
    let base = unite(
        &unit
            .bodies
            .iter()
            .map(|b| b.levels[0].footprint.clone())
            .collect::<Vec<_>>(),
    );
    let service = unite(
        &unit
            .features
            .iter()
            .filter(|f| {
                matches!(
                    f.kind,
                    FeatureKind::LivestockPen
                        | FeatureKind::Well
                        | FeatureKind::Impluvium
                        | FeatureKind::RitualCourt
                )
            })
            .map(|f| f.surface.clone())
            .collect::<Vec<_>>(),
    );
    unit.partition = partition(
        &unit.lot,
        base,
        plan.courts,
        plan.paths,
        PartitionService::Surface(service),
    );
    let mut levels: BTreeMap<u32, (f64, f64, Surface, Surface)> = BTreeMap::new();
    for body in &unit.bodies {
        for level in &body.levels {
            let entry = levels.entry(level.index).or_insert((
                level.z_m,
                level.z_m + level.height_m,
                vec![],
                vec![],
            ));
            entry.0 = entry.0.min(level.z_m);
            entry.1 = entry.1.max(level.z_m + level.height_m);
            entry.2 = union(&entry.2, &level.footprint);
            entry.3 = union(&entry.3, &level.floor);
        }
    }
    unit.levels.clear();
    for (index, (min, max, domain, floor)) in levels {
        let walk = unite(
            &unit
                .access
                .nodes
                .iter()
                .filter(|n| {
                    n.kind != AccessKind::Room && n.z_m >= min - 0.001 && n.z_m < max - 0.001
                })
                .map(|n| n.floor.clone())
                .collect::<Vec<_>>(),
        );
        let footprint_domain = domain.clone();
        let domain = union(&domain, &intersection(&walk, &unit.lot));
        let occupied = union(
            &unite(
                &unit
                    .rooms
                    .iter()
                    .filter(|r| r.level == index)
                    .map(|r| r.floor.clone())
                    .collect::<Vec<_>>(),
            ),
            &unite(
                &unit
                    .walls
                    .iter()
                    .filter(|w| {
                        w.level == index && w.z_m <= min + 0.001 && w.z_m + w.height_m > min + 0.001
                    })
                    .map(|w| crate::wall_geometry::wall_section(w, min + 0.001))
                    .collect::<Vec<_>>(),
            ),
        );
        unit.level_partitions.push(LevelPartition {
            level: index,
            z_m: min,
            domain: domain.clone(),
            partition: partition(
                &domain,
                occupied,
                vec![],
                walk,
                PartitionService::FloorComplement {
                    floor,
                    footprint_domain,
                },
            ),
        });
        unit.levels.push(UnitLevel {
            index,
            z_min: min,
            z_max: max,
        });
    }
    if unit.levels.is_empty() {
        unit.levels.push(UnitLevel {
            index: 0,
            z_min: 0.0,
            z_max: 3.0,
        });
    }
    unit.diagnostics
        .extend(p.notes.iter().map(|s| format!("Note de recette : {s}.")));
    #[cfg(test)]
    assert_eq!(native_level_footprints(&unit), footprints_before_access);
    Ok(unit)
}

fn build_tunnels(
    unit: &mut HouseUnit,
    p: &Parameters,
    circulations: &mut Vec<(f64, Surface)>,
) -> Result<(), String> {
    if !p
        .details
        .iter()
        .any(|d| d == "entrance_tunnel" || d == "multiple_entrance_tunnels")
    {
        return Ok(());
    }
    let bodies = unit.bodies.clone();
    for body in bodies {
        let b = bounds(&body.levels[0].footprint);
        let count = if p.details.iter().any(|d| d == "multiple_entrance_tunnels") {
            body.levels[0].footprint.len().max(2)
        } else {
            1
        };
        for entrance in 0..count {
            let width = 1.5;
            let length = 3.0;
            let x = b[0] + (b[2] - b[0]) * (entrance as f64 + 0.5) / count as f64 - width * 0.5;
            let domain = rectangle(x, b[3], width, length);
            let floor = offset(&domain, -0.2);
            let z = body.levels[0].z_m;
            let mut parameters = p.clone();
            parameters.rooms_per_body = [0, 0];
            parameters.floors = [1, 1];
            parameters.bodies = [1, 1];
            parameters.details.clear();
            parameters.components.clear();
            parameters.vertical_routes.clear();
            parameters.vertical_access = crate::catalogue::VerticalAccess::None;
            parameters.envelope = Envelope::Shell;
            parameters.wall_thickness_m = [0.2, 0.2];
            parameters.overhang_m = [0.0, 0.0];
            parameters.roof_spec.parapet_height_m = 0.0;
            parameters.roof_pitch_deg = [0.0, 0.0];
            parameters.roof_system = if body.roof_system == "RF-SNOW" {
                "RF-SNOW"
            } else {
                "RF-THATCH-VAULT"
            }
            .into();
            let index = unit.bodies.len();
            let id = format!("{}:body:{index}", unit.id);
            build_body(
                unit,
                BodySpec {
                    footprint: domain.clone(),
                    voids: vec![],
                    levels: vec![domain.clone()],
                    cells: vec![],
                    parameters,
                    role: Role::SpatialComponent,
                    component: Some(format!("entrance-tunnel:{entrance}")),
                    z,
                    arms: vec![RoofArm {
                        source_component: None,
                        origin: point(x + width, b[3]),
                        axis: [0.0, 1.0],
                        length_m: length,
                        width_m: width,
                        domain: domain.clone(),
                    }],
                },
                index,
                circulations,
            )?;
            if let Some(walk) = circulations.last_mut() {
                walk.1 = floor.clone();
            }
            unit.walls.push(Wall {
                solid: None,
                plan_section: None,
                shell_reference: false,
                id: format!("wall:tunnel:{id}"),
                kind: WallKind::Shell,
                body_id: Some(id.clone()),
                level: 0,
                z_m: z,
                height_m: 1.2,
                footprint: difference(&domain, &floor),
                centerline: domain[0].outer.clone(),
                material: p.materials.infill.clone(),
                party: false,
                opening_ids: vec![],
            });
            let mut tunnel = feature(
                &format!("tunnel:{id}"),
                FeatureKind::ArcticTunnel,
                floor,
                z,
                1.2,
                &p.materials.infill,
            );
            tunnel.vertices3d = tunnel.surface[0]
                .outer
                .iter()
                .map(|p| Vertex3 { x: p.x, y: p.y, z })
                .collect();
            unit.features.push(tunnel);
            unit.lot = union(&unit.lot, &offset(&domain, 1.4));
        }
    }
    Ok(())
}

fn usable_room(cell: &Surface, floor_constraint: Option<(&Surface, f64)>) -> bool {
    if let Some((interior, wall)) = floor_constraint {
        let floor = intersection(&offset(cell, -wall * 0.5), interior);
        floor.len() == 1 && area(&floor) >= 0.45
    } else {
        cell.len() == 1 && area(cell) >= 1.0
    }
}

/// Only failed strict cuts use two matching half-plane intersections.
fn split_room_fallback(
    surface: &Surface,
    axis_x: bool,
    coordinate: f64,
) -> Option<(Surface, Surface)> {
    let b = bounds(surface);
    let coordinate = snap(coordinate);
    let left_clip = if axis_x {
        rectangle(
            b[0] - 1.0,
            b[1] - 1.0,
            coordinate - b[0] + 1.0,
            b[3] - b[1] + 2.0,
        )
    } else {
        rectangle(
            b[0] - 1.0,
            b[1] - 1.0,
            b[2] - b[0] + 2.0,
            coordinate - b[1] + 1.0,
        )
    };
    let right_clip = if axis_x {
        rectangle(
            coordinate,
            b[1] - 1.0,
            b[2] - coordinate + 1.0,
            b[3] - b[1] + 2.0,
        )
    } else {
        rectangle(
            b[0] - 1.0,
            coordinate,
            b[2] - b[0] + 2.0,
            b[3] - coordinate + 1.0,
        )
    };
    let tolerance = area_tolerance(surface).min(1e-5);
    let mut discarded = 0.0;
    let mut clean = |s: Surface| -> Surface {
        s.into_iter()
            .filter(|p| {
                let a = area(&vec![p.clone()]);
                if a <= tolerance {
                    discarded += a;
                    false
                } else {
                    true
                }
            })
            .collect()
    };
    let a = clean(intersection(surface, &left_clip));
    let c = clean(intersection(surface, &right_clip));
    if discarded > tolerance || a.len() != 1 || c.len() != 1 {
        return None;
    }
    let combined = union(&a, &c);
    if (area(&a) + area(&c) - area(surface)).abs() > tolerance
        || area(&intersection(&a, &c)) > tolerance
        || area(&difference(surface, &combined)) + area(&difference(&combined, surface)) > tolerance
    {
        return None;
    }
    Some((a, c))
}

fn rooms(
    raw: &Surface,
    count: u32,
    frontage: Option<(bool, &Surface)>,
    floor_constraint: Option<(&Surface, f64)>,
) -> Result<Vec<Surface>, String> {
    let mut cells: Vec<_> = raw.iter().cloned().map(|p| vec![p]).collect();
    if cells.len() > count as usize {
        return Err(format!(
            "{} composantes de pièce pour {count} pièces demandées.",
            cells.len()
        ));
    }
    while cells.len() < count as usize {
        let mut indices: Vec<_> = (0..cells.len()).collect();
        // Keep the old largest-cell and equal-area tie preference on strict successes.
        indices.sort_by(|&a, &b| area(&cells[b]).total_cmp(&area(&cells[a])).then(b.cmp(&a)));
        let mut selected = None;
        for fallback in [false, true] {
            for &index in &indices {
                let s = &cells[index];
                let b = bounds(s);
                let long_x = b[2] - b[0] >= b[3] - b[1];
                let mut options = vec![];
                for axis in [long_x, !long_x] {
                    for ratio in [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8] {
                        let cut = if axis {
                            b[0] + (b[2] - b[0]) * ratio
                        } else {
                            b[1] + (b[3] - b[1]) * ratio
                        };
                        let halves = if fallback {
                            split_room_fallback(s, axis, cut)
                        } else {
                            Some(split(s, axis, cut))
                        };
                        if let Some((a, c)) = halves
                            && a.len() == 1
                            && c.len() == 1
                            && area(&a) >= 1.0
                            && area(&c) >= 1.0
                            && usable_room(&a, floor_constraint)
                            && usable_room(&c, floor_constraint)
                            && frontage.is_none_or(|(_, corridor)| {
                                let mut other: Vec<_> = cells
                                    .iter()
                                    .enumerate()
                                    .filter(|(i, _)| *i != index)
                                    .map(|(_, s)| s.clone())
                                    .collect();
                                other.push(c.clone());
                                if !crate::access::has_corridor_entry(
                                    &a,
                                    corridor,
                                    floor_constraint,
                                    &other,
                                ) {
                                    return false;
                                }
                                other.pop();
                                other.push(a.clone());
                                crate::access::has_corridor_entry(
                                    &c,
                                    corridor,
                                    floor_constraint,
                                    &other,
                                )
                            })
                        {
                            options.push((
                                u8::from(frontage.map_or(long_x, |(axis, _)| axis) != axis),
                                (area(&a) - area(&c)).abs(),
                                a,
                                c,
                            ));
                        }
                    }
                }
                options.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
                if let Some((_, _, a, c)) = options.into_iter().next() {
                    selected = Some((index, a, c));
                    break;
                }
            }
            if selected.is_some() {
                break;
            }
        }
        let Some((index, a, c)) = selected else {
            let s = indices.first().map(|&i| &cells[i]).unwrap_or(raw);
            let b = bounds(s);
            return Err(format!(
                "{count} pièces demandées : domaine restant de {:.3} m² ({:.3} × {:.3} m) trop étroit pour deux sols connexes après retrait mural et contrôle des fragments{}.",
                area(s),
                b[2] - b[0],
                b[3] - b[1],
                if frontage.is_some() {
                    "; cellule sans façade et porte sur l'allée"
                } else {
                    ""
                }
            ));
        };
        cells.remove(index);
        cells.push(a);
        cells.push(c);
    }
    if cells
        .iter()
        .any(|cell| !usable_room(cell, floor_constraint))
    {
        return Err(format!(
            "{count} pièces demandées : sol non connexe ou trop petit après retrait mural."
        ));
    }
    if let Some((_, corridor)) = frontage {
        for (i, cell) in cells.iter().enumerate() {
            let other: Vec<_> = cells
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, s)| s.clone())
                .collect();
            if !crate::access::has_corridor_entry(cell, corridor, floor_constraint, &other) {
                return Err(format!(
                    "{count} pièces demandées : cellule sans façade et porte sur l'allée."
                ));
            }
        }
    }
    Ok(cells)
}

fn add_site_enclosures(unit: &mut HouseUnit) {
    for f in unit.features.iter().filter(|f| {
        matches!(
            f.kind,
            FeatureKind::Enclosure | FeatureKind::Fence | FeatureKind::LivestockPen
        )
    }) {
        if matches!(f.kind, FeatureKind::LivestockPen)
            && f.surface.iter().all(|p| p.holes.is_empty())
        {
            continue;
        }
        unit.walls.push(Wall {
            solid: None,
            plan_section: None,
            shell_reference: false,
            id: format!("wall:{}", f.id),
            kind: WallKind::Enclosure,
            body_id: None,
            level: 0,
            z_m: f.z_m,
            height_m: f.height_m,
            footprint: f.surface.clone(),
            centerline: f
                .surface
                .first()
                .map(|s| s.outer.clone())
                .unwrap_or_default(),
            material: f.material.clone(),
            party: false,
            opening_ids: vec![],
        });
    }
}

fn add_body_supports(
    unit: &mut HouseUnit,
    footprint: &Surface,
    z: f64,
    p: &Parameters,
    id: &str,
    height: f64,
) {
    if z > 0.0 || p.envelope == Envelope::Open {
        let b = bounds(footprint);
        let support = p.support.material.as_deref().unwrap_or(&p.materials.frame);
        if p.support.kind == SupportKind::Raft {
            unit.features.push(feature(
                &format!("raft:{id}"),
                FeatureKind::Raft,
                footprint.clone(),
                -0.2,
                z + 0.2,
                support,
            ));
        } else {
            let nx = libm::ceil((b[2] - b[0]) / 4.0).max(1.0) as u32;
            let ny = libm::ceil((b[3] - b[1]) / 4.0).max(1.0) as u32;
            for iy in 0..=ny {
                for ix in 0..=nx {
                    let x = b[0] + 0.15 + (b[2] - b[0] - 0.3) * ix as f64 / nx as f64;
                    let y = b[1] + 0.15 + (b[3] - b[1] - 0.3) * iy as f64 / ny as f64;
                    let post = rectangle(x - 0.1, y - 0.1, 0.2, 0.2);
                    if area(&difference(&post, footprint)) < 0.01 {
                        unit.features.push(feature(
                            &format!("support:{id}:{ix}:{iy}"),
                            if p.support.kind == SupportKind::Piers {
                                FeatureKind::Pier
                            } else {
                                FeatureKind::Post
                            },
                            post,
                            0.0,
                            if z > 0.0 { z } else { height },
                            support,
                        ));
                    }
                }
            }
        }
        unit.features.push(feature(
            &format!("floor:{id}"),
            FeatureKind::FloorSlab,
            footprint.clone(),
            z,
            0.18,
            &p.materials.frame,
        ));
    }
}

fn build_body(
    unit: &mut HouseUnit,
    spec: BodySpec,
    bi: usize,
    circulations: &mut Vec<(f64, Surface)>,
) -> Result<(), String> {
    let p = &spec.parameters;
    let id = format!("{}:body:{bi}", unit.id);
    let height = body_level_height(&spec);
    if p.portal_profile.as_ref().is_some_and(|profile| {
        profile
            .entries
            .iter()
            .any(|spec| spec.head_m > height - 0.15 + 1e-9)
    }) {
        return Err(format!(
            "{id} : tête du portail source au-dessus de la hauteur libre du corps ({height:.3} m)."
        ));
    }
    let mut body = Body {
        id: id.clone(),
        footprint: spec.footprint.clone(),
        voids: spec.voids.clone(),
        levels: vec![],
        roof_system: p.roof_system.clone(),
        roof_pitch_deg: p.roof_pitch_deg[0],
        overhang_m: p.overhang_m[0],
        details: p.details.clone(),
        role: spec.role,
        envelope: p.envelope,
        vertical_access: p.vertical_access,
        vertical_routes: p.vertical_routes.clone(),
        wall_thickness_m: p.wall_thickness_m[0],
        component_id: spec.component,
        roof_spec: p.roof_spec.clone(),
        roof_arms: spec.arms,
        cells: spec.cells.clone(),
    };
    for (li, domain) in spec.levels.iter().enumerate() {
        if area(domain) < 1.0 {
            return Err(format!("{id} niveau{li} trop petit."));
        }
        let z = snap(spec.z + li as f64 * height);
        let materials = p
            .level_materials
            .iter()
            .find(|m| m.from_level <= li as u32 && m.to_level >= li as u32)
            .map(|m| m.materials.clone())
            .unwrap_or_else(|| p.materials.clone());
        let upper = spec.levels.get(li + 1).cloned().unwrap_or_default();
        let slab = body_roof_slab(domain, &upper, &p.roof_system, z, height);
        if let Some(s) = &slab {
            unit.features.push(feature(
                &format!("terrace:{id}:{li}"),
                FeatureKind::Terrace,
                s.surface.clone(),
                s.z_m,
                0.15,
                &materials.cladding,
            ));
        }
        let cover = body_intermediate_cover(&p.roof_system);
        body.levels.push(Level {
            index: li as u32,
            z_m: z,
            height_m: height,
            footprint: domain.clone(),
            floor: domain.clone(),
            intermediate_cover: cover,
            roof_slab: slab,
            materials: materials.clone(),
        });
        let wall = p.wall_thickness_m[0];
        let interior = if p.envelope == Envelope::Open {
            domain.clone()
        } else {
            offset(domain, -wall)
        };
        let mut raw_cells = if !spec.cells.is_empty() {
            spec.cells
                .iter()
                .filter(|c| c.floors > li as u32)
                .map(|c| {
                    // An already-contained authored cell retains its shared edges.
                    // Re-clipping coincident boundaries can create numerical slivers.
                    let footprint = if area(&difference(&c.footprint, domain))
                        <= area_tolerance(&c.footprint)
                    {
                        c.footprint.clone()
                    } else {
                        intersection(&c.footprint, domain)
                    };
                    (footprint, c.household_id.clone())
                })
                .collect::<Vec<_>>()
        } else {
            vec![(domain.clone(), Some(format!("{}:household", unit.id)))]
        };
        if p.details
            .iter()
            .any(|d| d == "multiple_households" || d == "central_aisle")
            && spec.cells.is_empty()
            && p.rooms_per_body[0] > 0
        {
            let b = bounds(domain);
            let corridor = if b[2] - b[0] >= b[3] - b[1] {
                rectangle(b[0], (b[1] + b[3]) * 0.5 - 0.6, b[2] - b[0], 1.2)
            } else {
                rectangle((b[0] + b[2]) * 0.5 - 0.6, b[1], 1.2, b[3] - b[1])
            };
            circulations.push((z, intersection(domain, &corridor)));
            let sides = difference(domain, &corridor);
            let requested = p.rooms_per_body[0];
            let count = requested.max(sides.len() as u32);
            if count != requested {
                unit.diagnostics.push(format!("{id} : {requested} pièces graphiques demandées, {count} nécessaires de part et d'autre de l'allée."));
            }
            raw_cells = rooms(
                &sides,
                count,
                Some((b[2] - b[0] >= b[3] - b[1], &intersection(domain, &corridor))),
                Some((&interior, wall)),
            )?
            .into_iter()
            .enumerate()
            .map(|(i, s)| {
                (
                    s,
                    Some(if p.details.iter().any(|d| d == "multiple_households") {
                        format!("{id}:household:{i}")
                    } else {
                        format!("{}:household", unit.id)
                    }),
                )
            })
            .collect();
        }
        let mut floors = vec![];
        if p.rooms_per_body[0] > 0 {
            for (raw, household) in raw_cells {
                let mut room_count = if !spec.cells.is_empty()
                    || p.details
                        .iter()
                        .any(|d| d == "multiple_households" || d == "central_aisle")
                {
                    1
                } else {
                    p.rooms_per_body[0]
                };
                if spec.cells.is_empty() && raw.len() > room_count as usize {
                    unit.diagnostics.push(format!("{id} niveau{li} : {room_count} pièces graphiques demandées, {} nécessaires pour les volumes séparés par le passage.",raw.len()));
                    room_count = raw.len() as u32;
                }
                for cell in rooms(
                    &raw,
                    room_count,
                    None,
                    if p.envelope == Envelope::Open {
                        None
                    } else {
                        Some((&interior, wall))
                    },
                )
                .map_err(|e| format!("{id} niveau{li} : {e}"))?
                {
                    let floor = if p.envelope == Envelope::Open {
                        cell.clone()
                    } else {
                        intersection(&offset(&cell, -wall * 0.5), &interior)
                    };
                    if area(&floor) < 0.45 {
                        return Err(format!(
                            "{id} : pièce trop petite pour ses murs ({:.2} m²).",
                            area(&floor)
                        ));
                    }
                    if floor.len() != 1 {
                        return Err(format!(
                            "{id} niveau{li} : le sol d'une pièce doit être connexe ({} composantes).",
                            floor.len()
                        ));
                    }
                    let room_id = format!("{id}:room:{}", unit.rooms.len());
                    let usage = if spec.role == Role::DomesticAnnex {
                        RoomUsage::Storage
                    } else if spec.role == Role::NonDomestic {
                        RoomUsage::Ritual
                    } else if spec.role == Role::CommunalDwelling {
                        RoomUsage::Communal
                    } else if p.details.iter().any(|d| d == "shopfront")
                        && li == 0
                        && floors.is_empty()
                    {
                        RoomUsage::Shop
                    } else {
                        RoomUsage::Living
                    };
                    unit.rooms.push(Room {
                        id: room_id.clone(),
                        body_id: id.clone(),
                        level: li as u32,
                        z_m: z,
                        floor: floor.clone(),
                        usage,
                        access_node: format!("access:{room_id}"),
                        household_id: household.clone(),
                    });
                    floors.push(floor);
                }
            }
        } else {
            circulations.push((z, domain.clone()));
        }
        if p.envelope != Envelope::Open {
            let exterior = difference(domain, &interior);
            let interior_walls = difference(&interior, &unite(&floors));
            for (kind, surface) in [
                (
                    if p.envelope == Envelope::Rockcut {
                        WallKind::Rock
                    } else if matches!(p.envelope, Envelope::Shell | Envelope::Membrane) {
                        WallKind::Shell
                    } else {
                        WallKind::Exterior
                    },
                    exterior,
                ),
                (WallKind::Interior, interior_walls),
            ] {
                let same_circulation = unite(
                    &circulations
                        .iter()
                        .filter(|(cz, _)| (*cz - z).abs() < 0.001)
                        .map(|(_, s)| s.clone())
                        .collect::<Vec<_>>(),
                );
                let surface = difference(&surface, &same_circulation);
                if area(&surface) > 0.001 {
                    unit.walls.push(Wall {
                        solid: None,
                        plan_section: None,
                        shell_reference: kind == WallKind::Shell
                            && p.roof_spec
                                .shell
                                .as_ref()
                                .is_some_and(|shell| shell.profile == ShellProfile::Ogival),
                        id: format!("wall:{id}:{li}:{}", unit.walls.len()),
                        kind,
                        body_id: Some(id.clone()),
                        level: li as u32,
                        z_m: z,
                        height_m: height,
                        footprint: surface,
                        centerline: domain.first().map(|p| p.outer.clone()).unwrap_or_default(),
                        material: materials.infill.clone(),
                        party: false,
                        opening_ids: vec![],
                    });
                }
            }
        }
    }
    add_body_supports(unit, &spec.footprint, spec.z, p, &id, height);
    // A reserved passage under an upper floor carries its own beam.
    if body.levels.len() > 1 {
        let overpass = difference(&body.levels[1].footprint, &body.levels[0].footprint);
        if !overpass.is_empty() {
            unit.features.push(feature(
                &format!("overpass-beam:{id}"),
                FeatureKind::Beam,
                overpass,
                body.levels[1].z_m - 0.25,
                0.25,
                &p.materials.frame,
            ));
        }
    }
    unit.bodies.push(body);
    Ok(())
}

#[cfg(test)]
mod room_tests {
    use super::*;

    #[test]
    fn room_cuts_conserve_rectangles_curves_aisles_and_holes() {
        let curved = ellipse(5.0, 6.0, 5.0, 6.0, 64);
        let rectangle = rectangle(0.0, 0.0, 6.2, 10.316);
        let hole = difference(&rectangle, &crate::geometry::rectangle(2.5, 4.0, 0.9, 2.6));
        let concave = union(
            &crate::geometry::rectangle(0.0, 0.0, 4.0, 12.0),
            &crate::geometry::rectangle(4.0, 8.0, 8.0, 4.0),
        );
        let aisle = vec![
            crate::geometry::rectangle(0.0, 0.0, 29.299, 2.08)[0].clone(),
            crate::geometry::rectangle(0.0, 3.28, 29.299, 2.08)[0].clone(),
        ];
        for (raw, count, axis) in [
            (rectangle, 3, None),
            (curved, 3, None),
            (hole, 4, None),
            (concave, 5, None),
            (aisle, 7, Some(true)),
        ] {
            let corridor = crate::geometry::rectangle(0.0, 2.08, 29.299, 1.2);
            let cells = rooms(&raw, count, axis.map(|axis| (axis, &corridor)), None).unwrap();
            assert_eq!(cells.len(), count as usize);
            assert!(cells.iter().all(|s| s.len() == 1 && area(s) >= 1.0));
            assert!((cells.iter().map(area).sum::<f64>() - area(&raw)).abs() < 1e-4);
            let combined = unite(&cells);
            assert!(area(&difference(&raw, &combined)) + area(&difference(&combined, &raw)) < 1e-4);
            for (i, a) in cells.iter().enumerate() {
                assert!(
                    cells
                        .iter()
                        .skip(i + 1)
                        .all(|b| area(&intersection(a, b)) < 1e-5)
                );
            }
        }
    }

    #[test]
    fn real_room_constraints_still_reject_without_reducing_the_programme() {
        let raw = rectangle(0.0, 0.0, 4.0, 0.8);
        let interior = offset(&raw, -0.3);
        assert!(rooms(&raw, 3, None, Some((&interior, 0.3))).is_err());
        assert!(rooms(&raw, 6, None, None).is_err());
    }

    #[test]
    fn communal_rooms_cannot_keep_a_landlocked_positive_cell() {
        let raw = vec![
            rectangle(0.0, 0.0, 2.0, 5.0)[0].clone(),
            rectangle(3.0, 0.0, 2.0, 5.0)[0].clone(),
        ];
        let corridor = rectangle(5.0, 0.0, 1.2, 5.0);
        let error = rooms(&raw, 2, Some((false, &corridor)), None).unwrap_err();
        assert!(
            error.contains("sans façade et porte sur l'allée"),
            "{error}"
        );
        assert_eq!(raw.len(), 2);
        assert_eq!(area(&raw), 20.0);
    }
}

#[cfg(test)]
mod partition_tests {
    use super::*;
    use geo::{Area, BooleanOps};

    const MAX_MICRO_COMPONENTS: usize = 128;
    const MAX_MICRO_AREA: f64 = 1e-5;
    // Includes zero-area debris discarded by the existing from_geo threshold.
    // The captured six overlays peak at667 raw /96 retained microcomponents.
    const MAX_RAW_MICRO_COMPONENTS: usize = 1024;

    fn surfaces(p: &Partition) -> [&Surface; 5] {
        [
            &p.occupied,
            &p.courtyards,
            &p.circulation,
            &p.service,
            &p.residual,
        ]
    }

    fn assert_invariants(domain: &Surface, p: &Partition) {
        let tolerance = area_tolerance(domain).clamp(1e-8, 1e-5);
        let parts = surfaces(p);
        let sum: f64 = parts.iter().map(|s| area(s)).sum();
        assert!(
            (sum - area(domain)).abs() <= tolerance,
            "partition area delta {}",
            sum - area(domain)
        );
        for (i, s) in parts.iter().enumerate() {
            assert!(
                area(&difference(s, domain)) <= tolerance,
                "category {i} outside domain"
            );
            for other in parts.iter().skip(i + 1) {
                assert!(
                    area(&intersection(s, other)) <= tolerance,
                    "positive category overlap"
                );
            }
            let mut micro_count = 0;
            let mut micro_area = 0.0;
            for polygon in s.iter() {
                assert!(signed_area(&polygon.outer) > 0.0);
                assert!(polygon.holes.iter().all(|h| signed_area(h) < 0.0));
                assert!(
                    std::iter::once(&polygon.outer)
                        .chain(polygon.holes.iter())
                        .flatten()
                        .all(|p| p.x.is_finite() && p.y.is_finite())
                );
                let a = area(&vec![polygon.clone()]);
                if a < 1e-4 {
                    micro_count += 1;
                    micro_area += a;
                }
            }
            assert!(
                micro_count <= MAX_MICRO_COMPONENTS,
                "category {i}: {micro_count} microfragments"
            );
            assert!(
                micro_area <= MAX_MICRO_AREA,
                "category {i}: micro area {micro_area}"
            );
        }
    }

    #[derive(serde::Deserialize)]
    struct RawPartition {
        domain: Surface,
        occupied: Surface,
        walk: Surface,
        floor: Surface,
    }

    fn captured() -> RawPartition {
        serde_json::from_str(include_str!("../tests/fixtures/chi13-partition-raw.json")).unwrap()
    }

    // Historical fixture lacks the original Fu. Keep its sequential path as
    // explicit characterization, including its unchanged microfragment bounds.
    // The new branch is exercised with caller-captured Fu in floor_complement.
    fn historical_sequential_floor_partition(raw: &RawPartition) -> Partition {
        let occupied = intersection(&raw.domain, &raw.occupied);
        let remaining = difference(&raw.domain, &raw.occupied);
        let courtyards = intersection(&remaining, &vec![]);
        let remaining = difference(&remaining, &vec![]);
        let circulation = intersection(&remaining, &raw.walk);
        let remaining = difference(&remaining, &raw.walk);
        Partition {
            occupied,
            courtyards,
            circulation,
            service: difference(&remaining, &raw.floor),
            residual: intersection(&remaining, &raw.floor),
        }
    }

    #[test]
    fn historical_sequential_partition_remains_characterized() {
        let raw = captured();
        let result = historical_sequential_floor_partition(&raw);
        assert_invariants(&raw.domain, &result);
        assert!(area(&difference(&result.occupied, &raw.occupied)) < 1e-5);
        assert!(area(&difference(&result.circulation, &raw.walk)) < 1e-5);
        assert!(area(&intersection(&result.service, &raw.floor)) < 1e-5);
        assert!(area(&difference(&result.residual, &raw.floor)) < 1e-5);
        assert!((area(&result.residual) - 43.4317).abs() < 1e-4);

        // Thirty-two radial bays leave real floor pockets. These must remain;
        // the tiny near-coincident ribbons are bounded, never removed here.
        let physical: Vec<_> = result
            .residual
            .iter()
            .filter_map(|p| {
                let s = vec![p.clone()];
                let a = area(&s);
                (a >= 1e-4).then_some((a, area_tolerance(&s) * 2000.0))
            })
            .collect();
        assert_eq!(physical.len(), 34);
        assert!(
            physical
                .iter()
                .all(|(a, perimeter)| *a > 1.0 && 2.0 * a / perimeter > 0.01)
        );

        let hole_areas = |s: &Surface| {
            let mut a: Vec<_> = s
                .iter()
                .flat_map(|p| &p.holes)
                .map(|r| -signed_area(r))
                .filter(|a| *a > 1e-4)
                .collect();
            a.sort_by(f64::total_cmp);
            a
        };
        let input_holes = hole_areas(&raw.walk);
        let output_holes = hole_areas(&result.circulation);
        assert_eq!(input_holes.len(), 7);
        assert_eq!(input_holes.len(), output_holes.len());
        assert!(
            input_holes
                .iter()
                .zip(output_holes)
                .all(|(a, b)| (a - b).abs() < 1e-5)
        );

        let replay = historical_sequential_floor_partition(&raw);
        assert_eq!(
            serde_json::to_vec(&result).unwrap(),
            serde_json::to_vec(&replay).unwrap()
        );

        let mut dropped_polygons = 0;
        let mut dropped_holes = 0;
        let mut dropped_area = 0.0;
        let mut raw_micro_counts = vec![];
        let mut audited = |a: &Surface, b: &Surface, subtract: bool| {
            let a = to_geo(a);
            let b = to_geo(b);
            let result = if subtract {
                a.difference(&b)
            } else {
                a.intersection(&b)
            };
            let micro = result.0.iter().filter(|p| p.unsigned_area() < 1e-4).count();
            raw_micro_counts.push(micro);
            for p in &result.0 {
                let exterior = geo::Polygon::new(p.exterior().clone(), vec![]).unsigned_area();
                if exterior <= 1e-10 {
                    dropped_polygons += 1;
                    dropped_area += p.unsigned_area();
                } else {
                    for h in p.interiors() {
                        let hole_area = geo::Polygon::new(h.clone(), vec![]).unsigned_area();
                        if hole_area <= 1e-10 {
                            dropped_holes += 1;
                            dropped_area += hole_area;
                        }
                    }
                }
            }
            from_geo(&result)
        };
        let occupied = audited(&raw.domain, &raw.occupied, false);
        let remaining = audited(&raw.domain, &raw.occupied, true);
        let circulation = audited(&remaining, &raw.walk, false);
        let remaining = audited(&remaining, &raw.walk, true);
        let service = audited(&remaining, &raw.floor, true);
        let residual = audited(&remaining, &raw.floor, false);
        assert_eq!(occupied, result.occupied);
        assert_eq!(circulation, result.circulation);
        assert_eq!(service, result.service);
        assert_eq!(residual, result.residual);
        eprintln!(
            "from_geo removed {dropped_polygons} polygons/{dropped_holes} holes, total area {dropped_area:.12}m²"
        );
        eprintln!("raw microfragments per operation: {raw_micro_counts:?}");
        assert!(dropped_area < 1e-7);
        assert!(
            raw_micro_counts
                .iter()
                .all(|n| *n <= MAX_RAW_MICRO_COMPONENTS)
        );
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    #[should_panic(expected = "is_fill_top")]
    fn legacy_partition_panics_on_captured_raw_inputs() {
        let raw = captured();
        let occupied = intersection(&raw.domain, &raw.occupied);
        let courtyards = difference(&intersection(&raw.domain, &vec![]), &occupied);
        let circulation = difference(
            &intersection(&raw.domain, &raw.walk),
            &union(&occupied, &courtyards),
        );
        let service = difference(
            &intersection(&raw.domain, &difference(&raw.domain, &raw.floor)),
            &unite(&[occupied.clone(), courtyards.clone(), circulation.clone()]),
        );
        let _ = difference(
            &raw.domain,
            &unite(&[occupied, courtyards, circulation, service]),
        );
    }

    #[test]
    fn synthetic_partitions_keep_holes_collinear_edges_and_raw_precedence() {
        let domain = rectangle(0.0, 0.0, 10.0, 10.0);
        let mut touching_holes = domain.clone();
        for h in [rectangle(2.0, 2.0, 2.0, 2.0), rectangle(4.0, 4.0, 2.0, 2.0)] {
            let mut ring = h[0].outer.clone();
            ring.reverse();
            touching_holes[0].holes.push(ring);
        }
        let annulus = difference(&domain, &rectangle(0.02, 0.02, 9.96, 9.96));
        let disjoint = vec![
            rectangle(0.0, 0.0, 3.0, 3.0)[0].clone(),
            rectangle(7.0, 7.0, 3.0, 3.0)[0].clone(),
        ];
        for domain in [vec![], domain.clone(), touching_holes, annulus, disjoint] {
            for occupied in [vec![], domain.clone(), rectangle(0.0, 0.0, 5.0, 10.0)] {
                for epsilon in [1e-9, 1e-8, 1e-7, 1e-6] {
                    let mut courts = rectangle(5.0, 0.0, 2.0, 10.0);
                    courts[0].outer.iter_mut().for_each(|p| p.x -= epsilon);
                    let walk = rectangle(6.0, 0.0, 2.0, 10.0);
                    let floor = rectangle(0.0, 0.0, 9.0, 10.0);
                    let p = partition(
                        &domain,
                        occupied.clone(),
                        courts.clone(),
                        walk.clone(),
                        PartitionService::Surface(rectangle(7.0, 0.0, 3.0, 10.0)),
                    );
                    assert_invariants(&domain, &p);
                    assert!(area(&difference(&p.occupied, &occupied)) < 1e-5);
                    assert!(area(&difference(&p.courtyards, &courts)) < 1e-5);
                    assert!(area(&difference(&p.circulation, &walk)) < 1e-5);
                    let footprint_domain = domain.clone();
                    let level_domain = union(
                        &footprint_domain,
                        &intersection(&walk, &rectangle(-1.0, -1.0, 12.0, 12.0)),
                    );
                    let p = partition(
                        &level_domain,
                        occupied.clone(),
                        courts,
                        walk,
                        PartitionService::FloorComplement {
                            floor: floor.clone(),
                            footprint_domain,
                        },
                    );
                    assert_invariants(&level_domain, &p);
                    assert!(area(&intersection(&p.service, &floor)) < 1e-5);
                    assert!(area(&difference(&p.residual, &floor)) < 1e-5);
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn native_outboard787_draw() -> Result<HouseUnit, String> {
    let config: HouseConfig = serde_json::from_str(include_str!(
        "../../../fixtures/houses/config-outboard787.json"
    ))
    .unwrap();
    assert_eq!(config.count, 10);
    let data = catalogue()?;
    let (source, p, seed) = selected_draws(data, &config)?
        .into_iter()
        .nth(2)
        .ok_or("Témoin 787 sans draw original 2.")?;
    generate_unit(source, &p, &config, &seed, 2)
}
