//! Prepare phase and quarter fields, then run the ordered subdivision pass.

use super::closes::closes;
use super::field::Field;
use super::frames::{armature_frame, enclosure_frame};
use super::speculative::{CutQuarter, Layer, OrderedCuts, Read, ordered_cuts};
use super::street_index::{Bins, RegionalIndex};
use super::subdivision::{Piece, split_quarter};
use crate::urban::{
    CapacityPlan, Enclosure, GrowthPhase, LayoutConfig, Morph, Point, Quarter, QuarterOverride,
    Shape, Site, Street, Surface, UrbanStructure, catalogue, composition, edits, geometry as g,
    profiles, with_tissue, zone_blend,
};
use crate::{noise::Noise, rng::Rng};
use std::f64::consts::{FRAC_PI_2, TAU};

#[allow(clippy::too_many_arguments)]
pub(super) fn cut_quarters(
    quarters: &[Quarter],
    streets: &mut Vec<Street>,
    enclosures: &[Enclosure],
    phases: &[GrowthPhase],
    structure: Option<&UrbanStructure>,
    walled: &[Shape],
    plan: Option<&CapacityPlan>,
    capacity_morph: impl Fn(Morph, Option<usize>, &str, &str) -> Morph + Sync,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
    nucleus_radius: f64,
    angle: f64,
    rng: &Rng,
    lap: &impl Fn(&str),
) -> Result<(Vec<Vec<Piece>>, Vec<(usize, GrowthPhase)>), String> {
    let center = site.center;
    let gradients = |p: Point| {
        let r = 70.0;
        (
            (surface.height_at(Point { x: p.x + r, y: p.y })
                - surface.height_at(Point { x: p.x - r, y: p.y }))
                / (2.0 * r),
            (surface.height_at(Point { x: p.x, y: p.y + r })
                - surface.height_at(Point { x: p.x, y: p.y - r }))
                / (2.0 * r),
        )
    };
    let (gx, gy) = gradients(center);
    let terrain = if gx.hypot(gy) > 1e-6 {
        gy.atan2(gx) + FRAC_PI_2
    } else {
        angle
    };
    let water = (0..32)
        .filter_map(|i| {
            let a = i as f64 * TAU / 32.0;
            let p = Point {
                x: center.x + a.cos() * radius,
                y: center.y + a.sin() * radius,
            };
            surface.wet(p).then_some(a + FRAC_PI_2)
        })
        .next()
        .unwrap_or(angle);
    let base_streets = std::mem::take(streets);
    let mut base_bins = Bins::new(20.0, usize::MAX);
    base_bins.sync(&base_streets);
    let mut major = Bins::new(50.0, 1);
    major.sync(&base_streets);
    let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
    let regional = RegionalIndex::new(roads, nucleus_radius * 1.5);
    let field = Field {
        regional: &regional,
        align_regional: cfg.axis_alignment == "regional"
            && cfg.params.get("orientation").is_none()
            && cfg.preset == "culture",
        adaptation: cfg.site_adaptation,
        p: m,
        center,
        angle,
        terrain,
        water,
        surface,
        noise: Noise::new(rng.fork("field")),
        radius: nucleus_radius,
        population: site.population,
        radial: cfg.preset == "culture"
            && cfg.params.get("streetOp").is_none()
            && profiles::profile(if cfg.culture == "site" {
                &site.culture
            } else {
                &cfg.culture
            })
            .pattern
                == "radial",
        phases: &[],
        phase_morphs: &[],
        phase_index: &[],
        base: &base_streets,
        base_bins: &base_bins,
        others: &[],
        bins: &bins,
        reads: None,
        major: &major,
        frame: None,
        blend: None,
    };
    let blend = (cfg.zone_density == "gradient" && phases.len() > 1)
        .then(|| zone_blend::field(phases, enclosures));
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let raw_phase_morphs = phases
        .iter()
        .map(|p| {
            let (preset, selected) = composition::globals(
                composition::zone_chosen(&cfg.phase_overrides, &p.zone),
                &cfg.preset,
                &cfg.recipe,
            );
            composition::phase_morph(
                if p.culture.is_empty() {
                    culture
                } else {
                    &p.culture
                },
                &p.recipe,
                &p.zone,
                preset,
                selected,
                cfg.density,
                &cfg.params,
                "quarters",
            )
        })
        .map(|r| r.map(|m| with_tissue(m, &cfg.tissue)))
        .collect::<Result<Vec<_>, _>>()?;
    let phase_morphs = raw_phase_morphs
        .iter()
        .zip(phases)
        .map(|(m, p)| capacity_morph(m.clone(), None, &p.recipe, &p.zone))
        .collect::<Vec<_>>();
    let phase_index = phases
        .iter()
        .enumerate()
        .flat_map(|(i, p)| {
            p.shapes
                .iter()
                .map(move |s| (i, g::ContainmentIndex::new(s)))
        })
        .collect::<Vec<_>>();
    let cut = |i: usize,
               q: &Quarter,
               others: &[Layer<'_>],
               reads: Option<&std::sync::Mutex<Vec<Read>>>|
     -> Result<CutQuarter, String> {
        let mut qr = rng.fork(&edits::quarter_fork("quarter", i, cfg));
        let mut local_cfg = cfg.clone();
        let interior = g::interior_point(&q.shape);
        let origin = structure.and_then(|s| {
            s.centers.iter().min_by(|a, b| {
                let p = interior;
                (p.x - a.point.x)
                    .hypot(p.y - a.point.y)
                    .total_cmp(&(p.x - b.point.x).hypot(p.y - b.point.y))
            })
        });
        let local_center = origin.map_or(field.center, |c| c.point);
        let local_tissue = if cfg.tissue == "culture"
            && structure.is_some_and(|s| s.family == "composite")
            && origin.is_some_and(|c| c.id > 0)
            && cfg.mix_culture.is_empty()
        {
            "grid"
        } else {
            &cfg.tissue
        };
        // A user edit of this quarter (culture, tissue, density) replaces its
        // morphology only; the RNG is still forked from the quarter index, so
        // the other quarters keep their own random streams.
        let edit = cfg.overrides.quarters.get(&i.to_string());
        let edited = match edit {
            Some(e) => quarter_edit(e, q, phases, culture, site, cfg)?,
            None => None,
        };
        let local_tissue = edit
            .and_then(|e| e.tissue.as_deref())
            .or_else(|| {
                cfg.phase_overrides
                    .get(&q.zone)
                    .map(|o| o.tissue.as_str())
                    .filter(|t| !t.is_empty())
            })
            .unwrap_or(local_tissue);
        local_cfg.tissue = local_tissue.to_owned();
        // A quarter of the plan's borrowed share is cut with the donor's
        // street spacing and lots (its houses stay the receiving culture's).
        let borrowed = edited.is_none()
            && plan
                .is_some_and(|p| p.borrowed_quarters.contains(&i));
        let local_morph = with_tissue(
            match &edited {
                Some(e) => e.0.clone(),
                None if borrowed => {
                    let phase = phases.get(q.phase);
                    capacity_morph(
                        raw_phase_morphs.get(q.phase).unwrap_or(m).clone(),
                        Some(i),
                        phase.map_or("core", |p| p.recipe.as_str()),
                        phase.map_or(q.zone.as_str(), |p| p.zone.as_str()),
                    )
                }
                None => phase_morphs.get(q.phase).unwrap_or(m).clone(),
            },
            local_tissue,
        );
        let reshaped = edited.is_some() || borrowed;
        let edited_phase = edited.and_then(|e| e.1);
        // Per-quarter memo and bins: nothing mutable is shared between threads.
        let regional = RegionalIndex::new(roads, nucleus_radius * 1.5);
        let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
        let local_field = Field {
            regional: &regional,
            bins: &bins,
            others,
            reads,
            p: &local_morph,
            noise: Noise::new(rng.fork("field")),
            radial: (local_tissue == "radial" || local_tissue == "culture" && field.radial)
                && phases.get(q.phase).is_none_or(|p| p.kind != "faubourg"),
            center: local_center,
            phases,
            phase_morphs: if local_tissue == cfg.tissue && !reshaped {
                &phase_morphs
            } else {
                &[]
            },
            phase_index: &phase_index,
            frame: None,
            blend: blend.as_deref(),
            ..field
        };
        // A planned grid is one lattice for the whole town: the same frame and
        // origin in every quarter, so its lines run on across the quarter
        // streets and meet them in crossroads rather than staggered tees.
        let enclosed = cfg.align_enclosed_grid && !walled.is_empty() && local_morph.text("streetOp") == "grid";
        let enclosure = enclosed.then(|| walled.iter().filter(|s| g::contains(s, interior))
            .min_by(|a,b| g::area(a).total_cmp(&g::area(b)))).flatten();
        let lattice = if enclosure.is_some() { local_center } else if local_morph.text("streetOp") == "grid" {
            structure
                .and_then(|s| {
                    s.centers
                        .iter()
                        .max_by(|a, b| a.weight.total_cmp(&b.weight))
                })
                .map_or(field.center, |c| c.point)
        } else {
            local_center
        };
        let hint = local_field.grid_frame(lattice);
        let frame = if let Some(enclosure) = enclosure {
            enclosure_frame(enclosure)
        } else if local_morph.text("streetOp") == "grid" {
            armature_frame(&base_streets, lattice, hint).unwrap_or(hint)
        } else {
            hint
        };
        let local_field = Field {
            center: lattice,
            frame: Some(frame),
            ..local_field
        };
        if !phases.is_empty() {
            local_cfg.zone = q.zone.clone();
        }
        #[cfg(not(target_arch = "wasm32"))]
        let quarter_tick = std::time::Instant::now();
        let mut own = vec![];
        let pcs = split_quarter(q, &local_field, &local_cfg, &mut own, &mut qr);
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var("URBAN_PROFILE").is_ok() && quarter_tick.elapsed().as_millis() > 200 {
            eprintln!(
                "    quarter {i}: {:.0} ms, {:.1} ha, {} pieces, {} outer vertices",
                quarter_tick.elapsed().as_secs_f64() * 1000.0,
                g::area(&q.shape) / 10_000.0,
                pcs.len(),
                q.shape.outer.len()
            );
        }
        if !phases.is_empty() && cfg.access_mode != "none" {
            closes(
                &pcs,
                &mut own,
                &local_field,
                &local_cfg,
                &mut rng.fork(&edits::quarter_fork("closes", i, cfg)),
            );
        }
        Ok((pcs, own, edited_phase))
    };
    let run = |i: usize, others: &[Layer<'_>]| {
        let reads = std::sync::Mutex::new(vec![]);
        let result = cut(i, &quarters[i], others, Some(&reads));
        (result, reads.into_inner().unwrap())
    };
    let OrderedCuts { pieces, mut added, edited_phases } = ordered_cuts(quarters.len(), run, lap)?;
    let mut cr = rng.fork("closes");
    if phases.is_empty() && cfg.access_mode != "none" {
        // The whole split network is this pass's own: the closes see it all.
        let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
        closes(
            &pieces.iter().flatten().cloned().collect::<Vec<_>>(),
            &mut added,
            &Field {
                bins: &bins,
                noise: Noise::new(rng.fork("field")),
                ..field
            },
            cfg,
            &mut cr,
        );
    }
    *streets = base_streets;
    streets.extend(added);
    Ok((pieces, edited_phases))
}

/// Morphology of an edited quarter, plus the phase its lots read when its
/// culture changes. `None` when the edit leaves the morphology untouched.
fn quarter_edit(
    edit: &QuarterOverride,
    q: &Quarter,
    phases: &[GrowthPhase],
    culture: &str,
    site: &Site,
    cfg: &LayoutConfig,
) -> Result<Option<(Morph, Option<GrowthPhase>)>, String> {
    if edit.culture.is_none() && edit.tissue.is_none() && edit.density.is_none() {
        return Ok(None);
    }
    if edit.tissue.as_deref().is_some_and(|t| {
        ![
            "culture",
            "grid",
            "organic",
            "radial",
            "terraces",
            "dendritic",
            "clusters",
        ]
        .contains(&t)
    }) || edit
        .culture
        .as_deref()
        .is_some_and(|c| !catalogue()["cultures"][c].is_object())
    {
        return Err("Retouche de quartier invalide (culture ou tissu inconnu)".into());
    }
    let phase = phases.get(q.phase);
    let base = phase
        .map(|p| p.culture.as_str())
        .filter(|c| !c.is_empty())
        .unwrap_or(culture);
    let target = edit.culture.as_deref().unwrap_or(base);
    let name = phase.map_or("core", |p| p.recipe.trim_start_matches("grown-"));
    let recipe = if target == base {
        phase.map_or_else(|| "core".to_owned(), |p| p.recipe.clone())
    } else {
        composition::recipe(target, site.population, name)
    };
    let (preset, selected) = composition::globals(
        composition::zone_chosen(&cfg.phase_overrides, &q.zone),
        &cfg.preset,
        &cfg.recipe,
    );
    let morph = composition::phase_morph(
        target,
        &recipe,
        &q.zone,
        preset,
        selected,
        edit.density.unwrap_or(cfg.density),
        &cfg.params,
        "quarters",
    )?;
    let own = (target != base).then(|| GrowthPhase {
        culture: target.into(),
        kind: phase.map_or_else(|| "edit".into(), |p| p.kind.clone()),
        zone: q.zone.clone(),
        recipe,
        population: 0.0,
        target_area: 0.0,
        shapes: vec![],
    });
    Ok(Some((morph, own)))
}
