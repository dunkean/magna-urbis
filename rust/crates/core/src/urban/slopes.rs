//! Terrain selects a terraced street tissue before quarters and house admission.
//! Cultural architecture remains the same; easy ground keeps its exact config.
use super::{LayoutConfig, Point, Site, Surface};

pub(super) fn adapt(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>) -> Option<LayoutConfig> {
    // Sub-town clusters already use the small-settlement slope grammar. Their
    // village land/household module must not be replaced by town ward tissue.
    if cfg.programme.intent != "settlement"
        || crate::settlements::demographics::below(site.population, "town")
        || cfg.placement != "center" || cfg.footprint.mechanism == "legacy"
        || cfg.tissue != "culture" || cfg.site_adaptation == 0.0 {
        return None;
    }
    // Survey the neighbourhood, rather than the marker alone: a hilltop has
    // zero centre gradient, while a volcanic gully can be locally near vertical.
    let radius = site.radius.min(250.0);
    let d = (surface.width / surface.height_resolution() as f64).max(2.0);
    let mut grades = vec![];
    for y in -2..=2 {
        for x in -2..=2 {
            let p = Point { x: site.center.x + x as f64 * radius * 0.35,
                y: site.center.y + y as f64 * radius * 0.35 };
            if surface.wet(p) { continue; }
            let gx = (surface.height_at(Point { x: p.x + d, y: p.y })
                - surface.height_at(Point { x: p.x - d, y: p.y })) / (2.0 * d);
            let gy = (surface.height_at(Point { x: p.x, y: p.y + d })
                - surface.height_at(Point { x: p.x, y: p.y - d })) / (2.0 * d);
            grades.push(gx.hypot(gy));
        }
    }
    grades.sort_by(f64::total_cmp);
    if grades.is_empty() || grades[grades.len() / 2] <= 0.34 { return None; }
    let mut adapted = cfg.clone();
    adapted.tissue = "terraces".into();
    // Terrain determines the ward direction; regional roads connect to it.
    adapted.axis_alignment = "culture".into();
    // Finite house admission (8x the native grade) and the existing bounded
    // 6 m stepped foundation let smaller, aligned sources occupy terraces.
    adapted.programme.slope_relax = adapted.programme.slope_relax.max(0.875);
    Some(adapted)
}
