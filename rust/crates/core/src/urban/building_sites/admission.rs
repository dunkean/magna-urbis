//! Native recipe feasibility checks and lot deficit diagnostics.

use super::*;

/// `URBAN_FEASIBILITY=probe` (measurement only) writes the direct native
/// poses of every eligible witness, whatever houses' wealth and built-target
/// gates, under `native_minimum_probe`, which houses ignores.
pub(super) fn feasibility_probe() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").is_ok_and(|v| v == "probe"))
}
pub(super) fn wish_of(floors: &Value) -> Option<[u32; 2]> {
    let a = floors.as_array()?;
    Some([a.first()?.as_u64()? as u32, a.get(1)?.as_u64()? as u32])
}
/// `URBAN_FEASIBILITY=round6` keeps Round 6 F's feasibility without the
/// Round 7 J additions (programme typology, functional-choice targets,
/// facility deficits and reservations, native footing), for A/B measurement.
pub(in crate::urban) fn round7() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").map_or(true, |v| v != "round6"))
}
/// `URBAN_FEASIBILITY=off` restores the former requests (A/B measurement).
pub(super) fn feasibility_enabled() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_FEASIBILITY").map_or(true, |v| v != "off"))
}
/// Native court layouts: a collective body wraps a court only on a lot that
/// holds one of these (atrium, peristyle, court house, siheyuan, tulou ring).
pub(super) fn court_layout(p: &NativeProfile) -> bool {
    matches!(
        p.layout.as_str(),
        "courtyard" | "atrium" | "peristyle" | "siheyuan" | "ring"
    )
}
/// A tall collective native recipe: three floors or more in a row (strip) or
/// court layout. A `single` tower (casa-torre, Svan or Yemeni tower house) is
/// one household's tower, not a tenement.
pub(super) fn tall_collective(p: &NativeProfile) -> bool {
    p.floors[1] >= 3 && (p.layout == "strip" || court_layout(p))
}
/// Floors wished for a collective dwelling (`dwelling.tenement`): among the
/// levels (3 to 5) that the admissible tall native witnesses actually offer on
/// this lot, rising with pressure; `None` when no such witness fits.
pub(super) fn collective_floors(fits: &[&NativeProfile], pressure: f64) -> Option<[u32; 2]> {
    let mut levels: Vec<u32> = fits
        .iter()
        .flat_map(|p| p.floors[0].max(3)..=p.floors[1].min(5))
        .collect();
    levels.sort_unstable();
    levels.dedup();
    let (&lo, n) = (levels.first()?, levels.len());
    let pick = levels[((n - 1) as f64 * pressure.clamp(0.0, 1.0)).round() as usize];
    Some([lo, pick])
}
/// Why no native source houses may draw can occupy this lot, when the city
/// can show it for every one of them (certified or not): `forme` when none
/// has a pose inside the lot at its nominal minima; `pente` when the
/// foundation step of every pose that fits exceeds the limit
/// (`feasibility::pose_lower_bound`, which stops at the first foundable
/// pose, so a level lot costs one pose). Otherwise houses judges the plan.
pub(super) fn lot_deficit(
    drawable: &[&NativeProfile],
    surface: Surface<'_>,
    lot: &super::super::Shape,
    dirs: &[super::super::Point],
    gradient: [f64; 2],
    step: f64,
) -> Option<&'static str> {
    if drawable.is_empty() || dirs.is_empty() || !drawable.iter().all(|w| w.ground) {
        return None;
    }
    let limit = step + 0.02;
    // Round 6 only proved lots whose centre gradient was visibly steep.
    let narrow = drawable
        .iter()
        .filter_map(|w| w.nominal)
        .map(|n| n[0].min(n[1]))
        .fold(f64::INFINITY, f64::min);
    if !round7() && gradient[0].hypot(gradient[1]) * narrow <= step {
        return drawable
            .iter()
            .all(|w| {
                !feasibility::pose_lower_bound(surface, lot, dirs, w, f64::INFINITY).is_finite()
            })
            .then_some("forme");
    }
    let mut placeable = false;
    // The bound reads only a source's footing and bearing: sources sharing
    // both are searched once.
    let mut searched: Vec<(Option<[u64; 2]>, bool, bool)> = Vec::new();
    for w in drawable {
        let key = (
            w.footing().map(|f| f.map(f64::to_bits)),
            w.bearing == feasibility::Bearing::Ring,
            w.bearing == feasibility::Bearing::Extent,
        );
        if searched.contains(&key) {
            continue;
        }
        searched.push(key);
        let bound = feasibility::pose_lower_bound(surface, lot, dirs, w, limit);
        if bound <= limit {
            return None;
        }
        placeable |= bound.is_finite();
    }
    Some(if placeable { "pente" } else { "forme" })
}
/// Whether a block can found at least one source of this pinned recipe at a
/// pose along one of its street contacts (`dirs`): the reservation test of a
/// facility before subdivision, the same lower bound as the lot deficit (so
/// a block is refused exactly when its lot would be a proven deficit, never
/// when the recipe could stand on it). Unknown sources
/// (no nominal minima, posts or piers) count as foundable.
pub(in crate::urban) fn recipe_foundable(
    surface: Surface<'_>,
    shape: &super::super::Shape,
    dirs: &[super::super::Point],
    recipe: &str,
) -> bool {
    let sources = feasibility::recipe_sources(recipe);
    if sources.is_empty() || dirs.is_empty() || !sources.iter().all(|w| w.ground) {
        return true;
    }
    // The trim passes ask again for the same blocks: memoised for the run,
    // keyed by the exact block, directions, recipe and the heights the poses
    // can read (the raster window under the block, with the interpolation
    // stencil's margin).
    let mut key = super::super::probe_cache::Key::new("building_sites.recipe_foundable/v2");
    key.shape(shape).usize(dirs.len());
    for &d in dirs {
        key.point(d);
    }
    key.str(recipe).f64(surface.width).usize(surface.n).usize(surface.height.len());
    match surface.interpolation {
        super::super::HeightInterpolation::Bilinear => key.usize(0),
        super::super::HeightInterpolation::PhysicalBilinear => key.usize(1),
        super::super::HeightInterpolation::BSpline { floor } => key.usize(2).f64(f64::from(floor)),
    };
    let r = surface.height_resolution();
    let (x0, y0, x1, y1) = super::super::geometry::bbox(shape);
    let cell = |v: f64| (v / surface.width * r as f64 - 0.5).floor();
    let span = |a: f64, b: f64| {
        let lo = (cell(a) - 2.0).clamp(0.0, r.saturating_sub(1) as f64) as usize;
        let hi = (cell(b) + 3.0).clamp(0.0, r.saturating_sub(1) as f64) as usize;
        (lo, hi)
    };
    let ((i0, i1), (j0, j1)) = (span(x0, x1), span(y0, y1));
    key.usize(i0).usize(i1).usize(j0).usize(j1);
    for j in j0..=j1 {
        for i in i0..=i1 {
            key.u64(u64::from(surface.height.get(j * r + i).map_or(u32::MAX, |h| h.to_bits())));
        }
    }
    if let Some(hit) = FOUNDABLE.get(&key) {
        return hit;
    }
    let limit = feasibility::MAX_FOUNDATION_STEP + 0.02;
    // The bound reads only a source's footing and bearing: sources sharing
    // both are searched once.
    let mut searched: Vec<(Option<[u64; 2]>, bool, bool)> = Vec::new();
    let found = sources.iter().any(|w| {
        let key = (
            w.footing().map(|f| f.map(f64::to_bits)),
            w.bearing == feasibility::Bearing::Ring,
            w.bearing == feasibility::Bearing::Extent,
        );
        if searched.contains(&key) {
            return false;
        }
        searched.push(key);
        feasibility::pose_lower_bound(surface, shape, dirs, w, limit) <= limit
    });
    FOUNDABLE.put(key, found);
    found
}
static FOUNDABLE: super::super::probe_cache::Memo<bool> = super::super::probe_cache::Memo::new();
pub(in crate::urban) fn clear_probe_cache() {
    FOUNDABLE.clear();
}
pub(super) fn deficit_message(cause: &str) -> &'static str {
    match cause {
        "source_absente" => {
            "Déficit de couverture architecturale : aucune source fonctionnelle admissible déclarée pour ce rôle ; l'assise d'un modèle résidentiel ne prouve pas l'impossibilité de l'équipement."
        }
        "pente" => {
            "Déficit urbain : pente trop forte pour l'assise de tout bâtiment natif admissible (marche > 0,75 m) ; lot laissé ouvert."
        }
        _ => {
            "Déficit urbain : aucun bâtiment natif admissible ne tient sur ce lot ; lot laissé ouvert."
        }
    }
}
/// The urban-deficit warning, or `None` when every lot is buildable.
pub fn deficit_warning(requests: &[Value]) -> Option<String> {
    let (mut shape, mut slope, mut source, mut households) = (0usize, 0usize, 0usize, 0.0f64);
    for r in requests {
        let d = &r["programme"]["deficit"];
        match d["cause"].as_str() {
            Some("pente") => slope += 1,
            Some("source_absente") => source += 1,
            Some(_) => shape += 1,
            None => continue,
        }
        households += d["households"].as_f64().unwrap_or(0.0);
    }
    (shape + slope + source > 0).then(|| warnings::building_deficit(slope, shape, source, households))
}
