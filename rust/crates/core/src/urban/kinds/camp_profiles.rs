//! Cultural camp selection and dimensions for camp growth.

use super::*;

/// The actual chosen native preset declares its camp layout. Automatic
/// cultural recipes follow their existing grown-profile transition. The older
/// nomad catalogue can still declare a ring through `camp.layout`; no culture
/// name list is maintained here. Explicit presets never borrow that fallback.
fn camp_preset_params(culture: &str, population: u32, cfg: &LayoutConfig) -> &'static serde_json::Value {
    let recipe = if cfg.recipe == "auto" {
        composition::recipe(culture, population, "core")
    } else {
        cfg.recipe.clone()
    };
    let preset = if cfg.preset == "culture" { format!("{culture}/{recipe}") } else { cfg.preset.clone() };
    &super::super::catalogue()["presets"][preset]["params"]
}

pub(in crate::urban) fn native_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    let params = camp_preset_params(culture, population, cfg);
    params["campLayout"].as_str().is_some_and(|layout| !layout.is_empty())
        || organic_camp(culture, population, params)
}

/// A camp laid out as a ring round its centre (kraal, tipis, yurts, guarani
/// plaza): no quay or landing row belongs to it.
pub(in crate::urban) fn ring_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    camp_preset_params(culture, population, cfg)["campLayout"] == "ring"
}

// A clustered footpath camp keeps its organic cut, including below the
// hamlet threshold. The selected recipe must still declare that grammar.
pub(super) fn organic_camp(culture: &str, population: u32, params: &serde_json::Value) -> bool {
    params["parcellation"] == "organic" && params["footpathWidth"].as_f64().is_some_and(|w| w > 0.0)
        && composition::culture_data(culture, population)["village"]["form"] == "ring"
}

pub(super) fn cultural_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    let params = camp_preset_params(culture, population, cfg);
    if !params.is_object() { return false; }
    if organic_camp(culture, population, params) { return true; }
    if let Some(layout) = params.get("campLayout") {
        return layout.as_str().is_some_and(|s| !s.is_empty());
    }
    cfg.preset == "culture" && cfg.recipe == "auto"
        && composition::culture_data(culture, population)["camp"]["layout"].as_str() == Some("ring")
}

/// Ring geometry of a figure camp (catalogue `camp*` fields) as the parcels'
/// camp forms read it; a court camp grown into rings (`campGrowth`) pitches
/// its tents closer, around a court open to its bearing.
pub(in crate::urban) struct RingGeometry {
    pub spacing: f64,
    pub depth: f64,
    pub path: f64,
    pub gap: f64,
    pub centre: f64,
}
pub(in crate::urban) fn ring_geometry(morph: &Morph) -> RingGeometry {
    let [lo, hi] = morph.pair("campArc");
    let mut g = RingGeometry {
        spacing: 0.5 * (lo.max(4.0) + hi.max(lo.max(4.0))),
        depth: morph.number_or("campRow", 10.0).max(4.0),
        path: morph.number_or("campPath", 3.0).clamp(1.2, 8.0),
        gap: morph.number_or("campGap", 0.0).clamp(0.0, 150.0).to_radians(),
        centre: morph.number_or("campCentre", 0.3),
    };
    if morph.text("campForm") == "court" {
        g.spacing = (0.6 * g.spacing).max(g.depth);
        g.gap = g.gap.max(30f64.to_radians());
        g.centre = g.centre.max(0.3);
    }
    g
}
/// Dwellings of the first ring of a concentric camp (`campRingMax`, else
/// by figure): the rest stands on full rows around it.
pub(in crate::urban) fn camp_ring_max(morph: &Morph) -> usize {
    let d = match morph.text("campForm") {
        "horseshoe" => 40.0,
        "court" => 50.0,
        _ => 60.0,
    };
    morph.number_or("campRingMax", d).max(8.0) as usize
}
/// Dwellings of one figure before a clustered camp founds a daughter camp
/// (`campUnitMax`, else by figure).
pub(in crate::urban) fn camp_unit_max(morph: &Morph) -> usize {
    let u = morph.number_or("campUnitMax", 0.0);
    if u >= 3.0 {
        u as usize
    } else if morph.text("campForm") == "court" {
        80
    } else {
        60
    }
}
/// Outer radius (circle estimate) of a ring figure of `k` dwellings whose
/// first row holds at most `cap`, the next rows full.
pub(in crate::urban) fn ring_extent(k: usize, cap: usize, g: &RingGeometry) -> f64 {
    let span = std::f64::consts::TAU - g.gap;
    let r = (k.min(cap) as f64 * g.spacing / span).max(g.depth * (1.0 + 2.0 * g.centre)).max(12.0);
    let (mut left, mut rows) = (k, 0usize);
    while left > 0 && rows < 16 {
        let c = (((r + rows as f64 * (g.depth + g.path)) * span / g.spacing).floor() as usize).max(1);
        left = left.saturating_sub(c);
        rows += 1;
    }
    r + rows.max(1) as f64 * (g.depth + g.path)
}
/// Outer radius of a Mongol ordu of `k` tents at `spacing`: its court, then
/// family groups (ails) on about 2.6 spacing² of ground per tent.
pub(in crate::urban) fn court_extent(k: usize, spacing: f64) -> f64 {
    let rc = (2.5 * spacing).max(30.0).max((2.0 * spacing).max(26.0)) + spacing;
    (rc * rc + k as f64 * 2.6 * spacing * spacing / std::f64::consts::PI).sqrt() * 1.15
}
/// Land (m²) a figure camp grown past one figure (`campGrowth` concentric or
/// clusters) needs: its rows or its daughter camps, deformed and spaced.
/// `None` for the default single figure, whose land is left as sized.
pub(in crate::urban) fn camp_growth_land(site: &Site, cfg: &LayoutConfig, morph: &Morph) -> Option<f64> {
    let form = morph.text("campForm");
    if cfg.camp_growth == "ring" || morph.text("campLayout").is_empty() || !matches!(form, "circle" | "horseshoe" | "court") {
        return None;
    }
    let culture = culture(site, cfg);
    if !native_camp(culture, site.population, cfg) {
        return None;
    }
    let n = (super::super::footprint::capacity::households(culture, site.population) * 1.2).ceil().max(3.0) as usize;
    let g = ring_geometry(morph);
    let pi = std::f64::consts::PI;
    if cfg.camp_growth == "clusters" {
        let units = n.div_ceil(camp_unit_max(morph)).max(1);
        let k = n.div_ceil(units);
        let cap = camp_ring_max(morph).min(k.div_ceil(2)).max(12);
        let r = if form == "court" { court_extent(k, g.spacing) } else { 1.2 * ring_extent(k, cap, &g) };
        // Radius of the circle enclosing `units` equal discs, with slack
        // for an irregular land.
        let enclose = match units { 1 => 1.0, 2 => 2.0, 3 => 2.155, 4 => 2.414, 5 => 2.701, 6 | 7 => 3.0, u => (u as f64 / 0.7).sqrt() };
        return Some(pi * (1.35 * enclose * (r + g.depth + g.path)).powi(2));
    }
    let r = 1.2 * ring_extent(n, camp_ring_max(morph), &g);
    Some(pi * (r + 2.0 * g.depth).powi(2))
}
