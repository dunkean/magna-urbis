//! Town-wide parcel inputs and the effective morphology of each block.

use super::{pressure, tidy};
use super::admission::compact_fallback;
use super::pressure::occupation_pressures;
use super::wall_lots::wall_faces;
use crate::rng::Rng;
use crate::urban::{Block, BlockOverride, CapacityPlan, GrowthPhase, Layout, Morph, ParcelConfig, Point};
use crate::urban::culture::UrbanAdmissibility;
use crate::urban::geometry::area;
use std::collections::BTreeMap;

fn cultural_context<'a>(layout: &'a Layout, block: &crate::urban::Block, fallback: &'a str) -> &'a str {
    block
        .phase
        .or_else(|| layout.quarters.get(block.quarter).map(|q| q.phase))
        .and_then(|phase| layout.phases.get(phase))
        .filter(|p| !p.culture.is_empty())
        .map_or(fallback, |p| p.culture.as_str())
}

/// Growth zones a quarter edit may set (`overrides.quarters.<i>.zone`).
const QUARTER_ZONES: [&str; 5] = ["core", "middle", "edge", "faubourg", "village"];
/// A user edit of a quarter's growth zone and/or density, resolved for one block.
struct QuarterEdit {
    phase: usize,
    zone: String,
    zone_set: bool,
    density: f64,
    density_set: bool,
}
/// Occupation pressure of an edited quarter: a set zone stands for its place
/// on the town's gradient (core = the densest street pressure, a faubourg
/// almost none); a set density moves it, 0.3 per doubling (×10 reaches the
/// densest tissue from an ordinary ring, ×0.1 the loosest). Lot width, depth,
/// house area and coverage follow it through `pressure::apply`, in every
/// culture; the admission floors (smallest native house) still hold.
fn edited_pressure(measured: f64, edit: &QuarterEdit) -> f64 {
    let base = if edit.zone_set {
        match edit.zone.as_str() {
            "core" => 1.0,
            "middle" => 0.7,
            "edge" => 0.4,
            "faubourg" => 0.2,
            _ => 0.05,
        }
    } else {
        measured
    };
    let shift = if edit.density_set { 0.3 * edit.density.log2() } else { 0.0 };
    (base + shift).clamp(0.0, 1.0)
}
/// The quarter density control spans ×0.1–×10 while the morph's own density
/// transformation (`resolve`) stops at ×0.5–×2: beyond it the lot tables keep
/// moving at the same rates per doubling, bounded by the same floors.
fn steer(morph: &mut Morph, density: f64) {
    let f = (1.0 / density).clamp(0.1, 10.0).log2();
    let residual = f - f.clamp(-1.0, 1.0);
    if residual == 0.0 {
        return;
    }
    let looser = residual > 0.0;
    for (key, rate, lo, hi) in [
        ("coverage", -0.24, 0.05, 0.97),
        ("frontage", 0.32, 3.5, f64::MAX),
        ("plotDepth", 0.22, 8.0, f64::MAX),
        ("blockSize", if looser { 0.45 } else { 0.1 }, 300.0, f64::MAX),
        ("houseArea", if looser { 0.25 } else { 0.12 }, 30.0, f64::MAX),
    ] {
        let scale = (1.0 + rate * residual).max(0.35);
        if let Some(zones) = morph.value[key].as_object_mut() {
            for range in zones.values_mut() {
                if let Some(a) = range.as_array_mut() {
                    for n in a {
                        *n = serde_json::json!((n.as_f64().unwrap_or(0.0) * scale).clamp(lo, hi));
                    }
                }
            }
        }
    }
}

pub(super) struct Preparation<'a> {
    pub(super) layout: &'a Layout,
    pub(super) cfg: &'a ParcelConfig,
    pub(super) culture: &'a str,
    pub(super) plan: Option<&'a CapacityPlan>,
    fallback_morph: &'a Morph,
    road_pressures: Vec<f64>,
    phase_morphs: Vec<Morph>,
    borrowed_morphs: Vec<Morph>,
    edited_morphs: BTreeMap<(usize, u64, String, bool), Morph>,
    block_morphs: BTreeMap<String, Morph>,
    zone_blends: Vec<Option<crate::urban::zone_blend::Blend>>,
}

pub(super) struct PreparedBlock<'a> {
    pub(super) block_edit: Option<&'a BlockOverride>,
    pub(super) block_culture: &'a str,
    pub(super) operator: &'a String,
    pub(super) period: &'a str,
    pub(super) route_op: String,
    pub(super) zone: String,
    pub(super) dense_souk: bool,
    pub(super) occupation: f64,
    pub(super) morph: Morph,
    pub(super) faces: Vec<(Point, Point)>,
    pub(super) admission: Option<UrbanAdmissibility>,
    pub(super) fallback: Option<UrbanAdmissibility>,
    pub(super) pack: Option<String>,
    pub(super) borrowed: bool,
}

fn phase_chosen(layout: &Layout, p: &GrowthPhase) -> bool {
    layout.config.as_ref().is_some_and(|c| {
        crate::urban::composition::zone_chosen(&c.phase_overrides, &p.zone) && !p.culture.is_empty()
    })
}

fn phase_zone(layout: &Layout, cfg: &ParcelConfig, p: &GrowthPhase) -> String {
    if cfg.zone == "auto" || phase_chosen(layout, p) {
        p.zone.clone()
    } else {
        cfg.zone.clone()
    }
}

fn quarter_edit(layout: &Layout, cfg: &ParcelConfig, block: &Block) -> Option<QuarterEdit> {
    let edits = layout.config.as_ref().map(|c| &c.overrides.quarters);
    let edit = edits.and_then(|e| e.get(&block.quarter.to_string()))?;
    let zone = edit.zone.as_deref().filter(|z| QUARTER_ZONES.contains(z));
    let density = edit.density.filter(|d| d.is_finite() && *d > 0.0);
    if zone.is_none() && density.is_none() {
        return None;
    }
    let pi = layout
        .quarters
        .get(block.quarter)
        .map(|q| block.phase.unwrap_or(q.phase))
        .filter(|&pi| pi < layout.phases.len())?;
    Some(QuarterEdit {
        phase: pi,
        zone: zone.map_or_else(|| phase_zone(layout, cfg, &layout.phases[pi]), str::to_owned),
        zone_set: zone.is_some(),
        density: density.map_or(cfg.density, |d| d.clamp(0.1, 10.0)),
        density_set: density.is_some(),
    })
}

impl<'a> Preparation<'a> {
    pub(super) fn new(layout: &'a Layout, cfg: &'a ParcelConfig, morph: &'a Morph) -> Result<Self, String> {
        // The first environment entry of each block, found in one pass.
        let mut first_environment: Vec<Option<&crate::urban::programme::BlockEnvironment>> = vec![None; layout.blocks.len()];
        for e in layout.programme.iter().flat_map(|pr| &pr.environment) {
            if let Some(slot) = first_environment.get_mut(e.block)
                && slot.is_none()
            {
                *slot = Some(e);
            }
        }
        let road_pressures = crate::urban::composition::gate_pressures(layout, occupation_pressures(layout).into_iter()
            .enumerate().map(|(bi,p)|first_environment.get(bi).copied().flatten().map_or(p,|e|e.pressure)).collect());
        // Quarters and blocks have their own character around the access
        // gradient (« des quartiers variables »): a denser, taller quarter here,
        // a looser one there, never a uniform ring. One draw per quarter and per
        // block, so lots, coverage, house sizes and floors all read the same.
        let road_pressures: Vec<f64> = road_pressures.iter().enumerate().map(|(bi, &p)| {
            let quarter = layout.blocks[bi].quarter;
            let q = Rng::new(&layout.key).fork(&format!("quarter-character:{quarter}")).range(-0.12, 0.12);
            // Keyed by place, not by index: redrawing one quarter leaves the others.
            let c = crate::urban::geometry::centroid(&layout.blocks[bi].shape);
            let b = Rng::new(&layout.key).fork(&format!("block-character:{:.0}:{:.0}", c.x, c.y)).range(-0.06, 0.06);
            (p + q + b).clamp(0.05, 1.0)
        }).collect();
        let culture = if cfg.culture == "site" {
            &layout.culture
        } else {
            &cfg.culture
        };
        let chosen = |p: &GrowthPhase| phase_chosen(layout, p);
        let zone_of = |p: &GrowthPhase| phase_zone(layout, cfg, p);
        let phase_morphs = layout
            .phases
            .iter()
            .enumerate()
            .map(|(index, p)| {
                let (preset, selected) = crate::urban::composition::globals(chosen(p), &cfg.preset, &cfg.recipe);
                // The style sheet's `plots` facet cuts this phase the way another culture cuts its lots.
                let sheet = crate::urban::forms::sheet::plots(layout, index);
                let own = if (cfg.culture == "site" || chosen(p)) && !p.culture.is_empty() { &p.culture } else { culture };
                crate::urban::composition::phase_morph(
                    sheet.as_ref().map_or(own.as_str(), |s| s.0.as_str()),
                    sheet.as_ref().map_or(p.recipe.as_str(), |s| s.1.as_str()),
                    &zone_of(p),
                    preset,
                    selected,
                    cfg.density,
                    &cfg.params,
                    "parcels",
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        // Adaptive capacity (`footprint::capacity`): the same densified tissue as
        // the quarter stage, and the donor's lot cutting in its borrowed quarters.
        let plan = crate::urban::footprint::capacity::of(layout)
            .filter(|_| crate::urban::footprint::capacity::parcels_enabled(cfg));
        let population = layout.programme.as_ref().map_or_else(
            || {
                layout
                    .structure
                    .as_ref()
                    .map_or(0, |s| s.metrics.planned_population.round() as u32)
            },
            |p| p.population,
        );
        let adapt = |m: &Morph, quarter: Option<usize>, p: &crate::urban::GrowthPhase| {
            crate::urban::footprint::capacity::adapt(
                m.clone(),
                plan,
                quarter,
                &p.recipe,
                &zone_of(p),
                population,
                cfg.density,
                "parcels",
            )
        };
        let borrowed_morphs = match plan {
            Some(c) if !c.donor.is_empty() && !c.borrowed_quarters.is_empty() => phase_morphs
                .iter()
                .zip(&layout.phases)
                .map(|(m, p)| adapt(m, c.borrowed_quarters.first().copied(), p))
                .collect::<Vec<_>>(),
            _ => vec![],
        };
        let phase_morphs = phase_morphs
            .iter()
            .zip(&layout.phases)
            .map(|(m, p)| adapt(m, None, p))
            .collect::<Vec<_>>();
        // User edits of a quarter (« éditer un quartier »): its growth zone,
        // density and tissue reach the lot cutting of that quarter's blocks only.
        // The edited morph goes through the same resolution as its phase (style
        // sheet, adaptive capacity), with the edited zone and density; the zone
        // and density then set the quarter's occupation pressure (`edited_pressure`),
        // which drives lot width, depth and coverage along the culture's own
        // core-to-edge gradient.
        let edits = layout.config.as_ref().map(|c| &c.overrides.quarters);
        let mut edited_morphs: BTreeMap<(usize, u64, String, bool), Morph> = BTreeMap::new();
        for block in &layout.blocks {
            let Some(e) = quarter_edit(layout, cfg, block) else {
                continue;
            };
            let borrowed = plan.is_some_and(|c| c.borrowed_quarters.contains(&block.quarter));
            let key = (e.phase, e.density.to_bits(), e.zone.clone(), borrowed);
            if edited_morphs.contains_key(&key) {
                continue;
            }
            let p = &layout.phases[e.phase];
            let (preset, selected) = crate::urban::composition::globals(chosen(p), &cfg.preset, &cfg.recipe);
            let sheet = crate::urban::forms::sheet::plots(layout, e.phase);
            let own = if (cfg.culture == "site" || chosen(p)) && !p.culture.is_empty() { &p.culture } else { culture };
            let m = crate::urban::composition::phase_morph(
                sheet.as_ref().map_or(own.as_str(), |s| s.0.as_str()),
                sheet.as_ref().map_or(p.recipe.as_str(), |s| s.1.as_str()),
                &e.zone,
                preset,
                selected,
                e.density,
                &cfg.params,
                "parcels",
            )?;
            let quarter = if borrowed { plan.and_then(|c| c.borrowed_quarters.first().copied()) } else { None };
            let mut m = crate::urban::footprint::capacity::adapt(m, plan, quarter, &p.recipe, &e.zone, population, e.density, "parcels");
            steer(&mut m, e.density);
            edited_morphs.insert(key, m);
        }
        // Blocks are cut independently (each forks its own random stream from its
        // geometric identity) and merged in block order: identical output on any
        // number of threads.
        let mut block_morphs = BTreeMap::new();
        for (id, edit) in &cfg.overrides.blocks {
            let Some(block) = id.parse::<usize>().ok().and_then(|i| layout.blocks.get(i)) else { continue; };
            if edit.culture.is_some() || edit.density.is_some() {
                let culture = edit.culture.as_deref().unwrap_or_else(|| cultural_context(layout, block, culture));
                let density = edit.density.or_else(|| edits.and_then(|e| e.get(&block.quarter.to_string())).and_then(|e| e.density)).unwrap_or(cfg.density);
                let m = crate::urban::composition::phase_morph(culture, "auto", &block.zone, &cfg.preset, &cfg.recipe, density, &cfg.params, "parcels")?;
                block_morphs.insert(id.clone(), m);
            }
        }
        let zone_blends = crate::urban::zone_blend::blocks(layout);
        Ok(Self {
            layout, cfg, culture, plan, fallback_morph: morph, road_pressures,
            phase_morphs, borrowed_morphs, edited_morphs, block_morphs, zone_blends,
        })
    }

    pub(super) fn block(&self, bi: usize, block: &'a Block) -> PreparedBlock<'a> {
        let Self {
            layout, cfg, culture, plan, fallback_morph, road_pressures, phase_morphs,
            borrowed_morphs, edited_morphs, block_morphs, zone_blends,
        } = self;
        let (layout, cfg, culture, plan) = (*layout, *cfg, *culture, *plan);
        let edits = layout.config.as_ref().map(|c| &c.overrides.quarters);
        let block_edit = cfg.overrides.blocks.get(&bi.to_string());
        let block_culture = block_edit.and_then(|e| e.culture.as_deref()).unwrap_or_else(|| cultural_context(layout, block, culture));
        let edit = edits.and_then(|e| e.get(&block.quarter.to_string()));
        let phase_index = layout
            .quarters
            .get(block.quarter)
            .map(|q| block.phase.unwrap_or(q.phase));
        let borrowed = plan.is_some_and(|c| c.borrowed_quarters.contains(&block.quarter));
        let quarter_edit = quarter_edit(layout, cfg, block);
        let edited = quarter_edit
            .as_ref()
            .and_then(|e| edited_morphs.get(&(e.phase, e.density.to_bits(), e.zone.clone(), borrowed)));
        let morph = block_morphs.get(&bi.to_string()).or(edited)
            .or_else(|| {
                phase_index.and_then(|pi| {
                    if borrowed {
                        borrowed_morphs.get(pi)
                    } else {
                        phase_morphs.get(pi)
                    }
                })
            })
            .unwrap_or(fallback_morph);
        let tissue = edit
            .and_then(|e| e.tissue.as_deref())
            .filter(|t| *t != "culture")
            .or_else(|| {
                layout
                    .structure
                    .as_ref()
                    .and_then(|s| {
                        s.districts
                            .iter()
                            .find(|d| d.quarters.contains(&block.quarter))
                    })
                    .map(|d| d.tissue.as_str())
            })
            .unwrap_or("culture");
        let mut local_morph = crate::urban::with_tissue(morph.clone(), tissue);
        // A street village's plan lays one house lot per household at a 12-16 m
        // module (`kinds::linear`): its lots are cut at that module, not at the
        // culture's wider village frontage, or half its households go unhoused.
        if layout.archetype == "street-village" {
            let [a, b] = local_morph.range("frontage", &block.zone);
            if b > 0.0 && local_morph.value["frontage"].is_object() {
                let module = ((a + b) * 0.5).clamp(12.0, 16.0);
                local_morph.value["frontage"][block.zone.as_str()] = serde_json::json!([module * 0.85, module * 1.2]);
            }
        }
        // A street village read from its site (`villageStreets`): the culture's
        // `village.street.plotJitter` spreads its lot widths (`strips`, `_lotSpread`).
        if layout.archetype == "street-village" && layout.config.as_ref().is_some_and(|c| c.village_streets) {
            let street = &crate::urban::catalogue()["cultures"][block_culture]["village"]["street"];
            let spread = street["plotJitter"].as_f64().unwrap_or(0.3);
            local_morph.value["_lotSpread"] = serde_json::json!(spread.clamp(0.0, 1.0));
            // A culture whose village farm is one compound (`wholeFarms`) keeps
            // each farm plot of the plan as one lot, its width and depth as drawn.
            if street["wholeFarms"].as_bool() == Some(true) && block.kind == "block" && area(&block.shape) <= 3000.0 {
                local_morph.value["plotOp"] = serde_json::json!("wholeBlock");
            }
        }
        if layout.config.as_ref().is_some_and(|c| c.old_enclosure_citadel) {
            local_morph.value["_innerWalls"] = serde_json::json!(true);
        }
        // `zoneDensity: gradient`: near another phase the lot tables lean toward it.
        if edited.is_none() && !block_morphs.contains_key(&bi.to_string()) {
            let zone = if cfg.zone == "auto" { block.zone.as_str() } else { cfg.zone.as_str() };
            crate::urban::zone_blend::blend_block(layout, zone_blends[bi], bi, zone, &mut local_morph, |pi, _, _| {
                let m = if borrowed { borrowed_morphs.get(pi) } else { phase_morphs.get(pi) }?;
                Some(crate::urban::with_tissue(m.clone(), tissue))
            });
        }
        let operator = block_edit.and_then(|e| e.operator.as_ref()).unwrap_or_else(|| cfg.zone_operators.get(&block.zone).unwrap_or(&cfg.operator));
        if operator != "culture" {
            local_morph.value["plotOp"] = serde_json::json!(match operator.as_str() {
                "strips" => "burgage",
                "oriented" => "compact",
                op => op,
            });
        }
        if operator == "culture"
            && cfg.preset == "culture"
            && cfg.params.get("plotOp").is_none()
        {
            if let Some(mapping) = crate::urban::culture::contextual_mapping(
                block_culture,
                layout
                    .programme
                    .as_ref()
                    .map_or("any", |p| p.context.period.as_str()),
                &block.zone,
                local_morph.text("plotOp"),
                "domestic",
            ) {
                if mapping.family == "inherited"
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!("inherited");
                } else if mapping.family == "compact"
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!("compact");
                } else if matches!(mapping.family.as_str(), "courtyard" | "compound")
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!(mapping.family);
                }
            }
        }
        // A zone the user set on the quarter wins over the plan's own.
        let zone = match &quarter_edit {
            Some(e) if e.zone_set => &e.zone,
            _ if cfg.zone == "auto" => &block.zone,
            _ => &cfg.zone,
        };
        let dense_souk = block_culture == "medina"
            && local_morph.text("id") == "medina-souk"
            && matches!(zone.as_str(), "core" | "middle")
            && operator == "culture"
            && cfg.preset == "culture"
            && ["plotOp", "plotDepth", "frontage", "houseArea"]
                .iter()
                .all(|key| cfg.params.get(key).is_none());
        let local_depth = local_morph.range("plotDepth", zone);
        let period = layout
            .programme
            .as_ref()
            .map_or("any", |p| p.context.period.as_str());
        let route_op = local_morph.text("plotOp").to_owned();
        let route = crate::urban::culture::contextual_mapping(
            block_culture,
            period,
            &block.zone,
            &route_op,
            "domestic",
        );
        let fallback = route
            .as_ref()
            .and_then(|c| compact_fallback(&c.architecture_pack, period, &c.admissibility));
        let pack = route.as_ref().map(|c| c.architecture_pack.clone());
        let admission = route.map(|c| c.admissibility);
        if operator == "culture" && cfg.preset == "culture" && cfg.params.get("plotOp").is_none() {
            crate::urban::composition::gate_morph(layout, bi, &mut local_morph);
        }
        let occupation = quarter_edit
            .as_ref()
            .map_or(road_pressures[bi], |e| edited_pressure(road_pressures[bi], e));
        // Lot sizes keep the culture's own ranges, floored by the smallest
        // native house that may occupy them (the compact tier when it exists),
        // not by a 30 m court house that only grand lots hold.
        let mut local_morph = pressure::apply(
            &local_morph,
            occupation,
            local_morph.text("streetOp") == "grid",
            fallback.as_ref().or(admission.as_ref()),
        );
        if dense_souk {
            let minimum = admission.as_ref().map_or(0.0, |p| p.min_depth);
            local_morph.value["plotDepth"][zone] =
                serde_json::json!(local_depth.map(|d| d.max(minimum)));
        }
        local_morph.value["_lotSolidity"] =
            serde_json::json!(tidy::solidity_floor(block_culture, local_morph.text("plotOp")));
        if let Some(a) = fallback.as_ref().or(admission.as_ref()) {
            local_morph.value["_witness"] =
                serde_json::json!([a.min_frontage, a.min_depth, a.min_access_width, a.min_area]);
        }
        let faces = wall_faces(&block.shape, layout);
        if !faces.is_empty() {
            local_morph.value["_wallFace"] = serde_json::json!(
                faces
                    .iter()
                    .map(|(a, b)| [a.x, a.y, b.x, b.y])
                    .collect::<Vec<_>>()
            );
        }
        PreparedBlock {
            block_edit, block_culture, operator, period, route_op, zone: zone.clone(),
            dense_souk, occupation, morph: local_morph, faces, admission, fallback, pack, borrowed,
        }
    }
}
