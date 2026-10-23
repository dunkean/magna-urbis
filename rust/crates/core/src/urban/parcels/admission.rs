//! Two native admission tiers per lot. Courtyard cultures route to a large
//! court recipe (about 30 x 30 m) that most real lots of a medina, a Byzantine
//! quarter or a hutong cannot hold; those lots still carry the pack's smallest
//! ordinary house (a single or strip recipe of the same architecture pack).
//! Both tiers are real houses recipes, so the houses engine stays the judge.
use super::super::culture::UrbanAdmissibility;
use super::Shape;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Profile {
    recipe_id: String,
    pack: String,
    layout: String,
    status: String,
    min_envelope_m: [f64; 2],
    min_access_width_m: f64,
    floors: [u32; 2],
    #[serde(default)]
    eras: Vec<String>,
    #[serde(default)]
    tradition_id: Option<String>,
    #[serde(default)]
    inspired_only: bool,
}
#[derive(Deserialize)]
struct Catalogue {
    profiles: Vec<Profile>,
}
fn catalogue() -> &'static Catalogue {
    static C: OnceLock<Catalogue> = OnceLock::new();
    C.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../houses/data/urban-admission.json"))
            .expect("versioned houses admission catalogue")
    })
}

/// Compact recipes the houses engine composes on irregular city lots (replay of
/// 30 Byzantine lots on /houses/plans, 2026-10-22): other single recipes of the
/// same packs (EUR-EAST-B01/B03, AS-KOR-B01...) keep their native template and
/// are refused almost everywhere. Without an entry, the smallest one is used.
const COMPOSABLE: &[&str] = &[
    "AF-MAG-B01",
    "AS-CHI-B01",
    "EUR-EAST-B02",
    "AS-KOR-B05",
    "AF-EAST-B06",
    "AF-SAHEL-B04",
    "AS-JAP-B10",
    "ATL-CEL-B06",
];

/// The pack's smallest supported single/strip house (at least 25 m², at most
/// two base floors), when the primary recipe is much larger than it. Same
/// 0.3 m clearance on each side as the primary profile.
pub(in super::super) fn compact_fallback(
    pack: &str,
    period: &str,
    primary: &UrbanAdmissibility,
) -> Option<UrbanAdmissibility> {
    // The fallback keeps the primary recipe's tradition (shared palette registry).
    let tradition = catalogue()
        .profiles
        .iter()
        .find(|p| p.recipe_id == primary.recipe_id)
        .and_then(|p| p.tradition_id.as_deref());
    let p = catalogue()
        .profiles
        .iter()
        .filter(|p| {
            p.pack == pack
                && p.status == "supported"
                && matches!(p.layout.as_str(), "single" | "strip")
                && p.floors[0] <= 2
                && p.min_envelope_m[0] * p.min_envelope_m[1] >= 25.0
                && (period.is_empty()
                    || period == "any"
                    || p.eras.iter().any(|e| e == period)
                    || (p.inspired_only && p.eras.is_empty()))
                && (tradition.is_none() || p.tradition_id.as_deref() == tradition)
        })
        .min_by(|a, b| {
            let preferred = |p: &Profile| !COMPOSABLE.contains(&p.recipe_id.as_str());
            preferred(a)
                .cmp(&preferred(b))
                .then(
                    (a.min_envelope_m[0] * a.min_envelope_m[1])
                        .total_cmp(&(b.min_envelope_m[0] * b.min_envelope_m[1])),
                )
                .then(a.recipe_id.cmp(&b.recipe_id))
        })?;
    let (front, depth) = (p.min_envelope_m[0] + 0.6, p.min_envelope_m[1] + 0.6);
    (primary.min_area > 1.5 * front * depth).then(|| UrbanAdmissibility {
        recipe_id: p.recipe_id.clone(),
        native_layout: p.layout.clone(),
        floors: p.floors,
        eras: p.eras.clone(),
        min_frontage: front,
        min_access_width: p.min_access_width_m.max(0.8),
        min_area: front * depth,
        min_depth: depth,
        max_slope: primary.max_slope,
        shared_access: primary.shared_access,
        party_walls: p.layout == "strip" || primary.party_walls,
    })
}

/// Whether a stored witness rectangle has exactly this profile's dimensions.
pub(in super::super) fn witnessed_by(envelope: &Shape, a: &UrbanAdmissibility) -> bool {
    let side = |i: usize| {
        let (p, q) = (
            envelope.outer[i],
            envelope.outer[(i + 1) % envelope.outer.len()],
        );
        (q.x - p.x).hypot(q.y - p.y)
    };
    envelope.outer.len() == 4
        && (side(0) - a.min_frontage).abs() < 1e-6
        && (side(1) - a.min_depth).abs() < 1e-6
}
