//! The inputs `generate_quarters` accepts: the layout configuration, the
//! terrain and roads, and the sites.
use std::collections::BTreeSet;

use crate::urban::{LayoutConfig, Site, Street, Surface, catalogue, fortification, kinds};

/// The configuration, terrain and roads of a quarter call, or the first
/// invalid group's message.
pub(in crate::urban) fn validate(config: &LayoutConfig, surface: Surface<'_>, roads: &[Street], sites: &[Site]) -> Result<(), String> {
    if !config.port_detachment.is_finite() || !(0.0..=1.0).contains(&config.port_detachment)
        || config.port_shelter.is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
    {
        return Err("Paramètres du port invalides : nombres finis entre 0 et 1 requis".into());
    }
    if config.programme.functions.is_some_and(|f| !f.valid()) {
        return Err("Poids des fonctions urbaines invalides : nombres finis entre 0 et 1 requis".into());
    }
    if !["regional", "culture"].contains(&config.axis_alignment.as_str())
        || !config.site_adaptation.is_finite()
        || !(0.0..=2.0).contains(&config.site_adaptation)
        || !["phases", "sectors"].contains(&config.mix_mode.as_str())
        || !["phases", "gradient"].contains(&config.zone_density.as_str())
        || !config.mix_share.is_finite()
        || !(0.0..=1.0).contains(&config.mix_share)
        || !config.mix_angle.is_finite()
        || !(-180.0..=180.0).contains(&config.mix_angle)
        || (!config.mix_culture.is_empty()
            && !catalogue()["cultures"][&config.mix_culture].is_object())
        || !["legacy", "adaptive", "closed"].contains(&config.exit_treatment.as_str())
        || !["auto", "none", "partial", "full"].contains(&config.peripheral_road.as_str())
        || !config.outbuildings.is_finite()
        || !(0.0..=1.0).contains(&config.outbuildings)
        || !config.organic_branch_variation.is_finite()
        || config.camp_ring_wobble.is_some_and(|v| !v.is_finite() || !(0.0..=0.4).contains(&v))
        || !(0.0..=1.0).contains(&config.organic_branch_variation)
        || !config.ribbon_width_variation.is_finite()
        || !(0.0..=1.0).contains(&config.ribbon_width_variation)
        || !config.parallel_merge.is_finite()
        || !(0.0..=1.0).contains(&config.parallel_merge)
    {
        return Err("Configuration des influences ou des sorties invalide".into());
    }
    let f = &config.footprint;
    if ![
        "auto",
        "legacy",
        "planned",
        "accessibility",
        "ribbon",
        "fusion",
    ]
    .contains(&f.mechanism.as_str())
        || ![
            "auto",
            "circle",
            "rectangle",
            "polygon",
            "compact",
            "elongated",
            "linear",
            "fan",
            "fingers",
            "dendritic",
            "lobed",
            "archipelago",
            "composite",
        ]
        .contains(&f.family.as_str())
        || !["population", "radius"].contains(&f.budget.as_str())
        || !f.gross_density.is_finite()
        || !(0.0..=1000.0).contains(&f.gross_density)
        || !f.aspect.is_finite()
        || !(1.0..=6.0).contains(&f.aspect)
        || !f.orientation.is_finite()
        || !(-180.0..=180.0).contains(&f.orientation)
        || !(1..=6).contains(&f.nuclei)
        || !(1..=5).contains(&f.epochs)
        || !f.irregularity.is_finite()
        || !(0.0..=1.0).contains(&f.irregularity)
        || !f.anisotropy.is_finite()
        || !(0.0..=1.0).contains(&f.anisotropy)
        || !f.separation.is_finite()
        || !(0.4..=3.0).contains(&f.separation)
        || [f.cohesion, f.satellites, f.branch_depth]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        || !f.gap_size.is_finite()
        || !(10.0..=500.0).contains(&f.gap_size)
        || ![
            "culture",
            "grid",
            "organic",
            "radial",
            "terraces",
            "dendritic",
            "clusters",
        ]
        .contains(&config.tissue.as_str())
        || !["adaptive", "cultural", "none"].contains(&config.access_mode.as_str())
        || !config.access_depth.is_finite()
        || !(0.0..=200.0).contains(&config.access_depth)
        || config.access_budget > 12
    {
        return Err("Configuration d’empreinte, de tissu ou de desserte invalide".into());
    }
    if surface.n < 2
        || !surface.width.is_finite()
        || surface.width <= 0.0
        || surface.height_resolution() < 2
        || surface.height_resolution().checked_mul(surface.height_resolution()) != Some(surface.height.len())
        || surface.water.len() != surface.n * surface.n
        || surface.height.iter().any(|h| !h.is_finite())
        || roads.iter().any(|s| {
            s.path.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
                || s.widths
                    .iter()
                    .any(|w| !w.is_finite() || *w <= 0.0 || *w > 100.0)
        })
    {
        return Err("Terrain ou routes urbaines invalides".into());
    }
    if sites.len() > 1000
        || !["settlement", "district"].contains(&config.scope.as_str())
        || !(["auto", "nucleated", "ribbon"].contains(&config.settlement_form.as_str())
            || kinds::Kind::from_id(&config.settlement_form).is_some())
        || config.site_archetype.len() > 32
        || config.site_archetypes.values().any(|a| a.len() > 32)
        || !["auto", "none", "few", "many"].contains(&config.suburbs.as_str())
        || !config.shanty_scale.is_finite()
        || !(0.0..=3.0).contains(&config.shanty_scale)
        || config.phases > 5
        || !(3..=64).contains(&config.count)
        || !(1..=2).contains(&config.rings)
        || !config.radius.is_finite()
        || !(0.0..=25000.0).contains(&config.radius)
        || !config.radius_scale.is_finite()
        || !(0.1..=5.0).contains(&config.radius_scale)
        || !["center", "rectangle", "skew", "notched"].contains(&config.placement.as_str())
        || !["culture", "none", "wall", "palisade"].contains(&config.fortification.as_str())
        || !(config.fortification_style == "auto"
            || fortification::STYLES.contains(&config.fortification_style.as_str()))
        || !fortification::valid_parameters(config)
        || !config.max_street_grade.is_finite()
        || !(0.02..=0.3).contains(&config.max_street_grade)
        || !config.max_lane_grade.is_finite()
        || !(config.max_street_grade..=0.4).contains(&config.max_lane_grade)
        || !config.max_stair_grade.is_finite()
        || !(config.max_lane_grade..=1.0).contains(&config.max_stair_grade)
    {
        return Err("Configuration de quartiers invalide".into());
    }
    Ok(())
}

/// The number of leading sites that are valid: a site with an empty or repeated
/// key, or a centre or radius off the terrain, stops the sites after it.
pub(in crate::urban) fn valid_sites(sites: &[Site], surface: Surface<'_>) -> usize {
    let mut keys = BTreeSet::new();
    sites
        .iter()
        .position(|site| {
            !keys.insert(&site.key)
                || site.key.is_empty()
                || !site.radius.is_finite()
                || site.radius <= 0.0
                || site.radius > 25000.0
                || !site.center.x.is_finite()
                || !site.center.y.is_finite()
                || !(0.0..=surface.width).contains(&site.center.x)
                || !(0.0..=surface.width).contains(&site.center.y)
        })
        .unwrap_or(sites.len())
}
