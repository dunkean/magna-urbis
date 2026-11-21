//! Footprint capacity probes and housing slope relaxation.
use super::super::{capacity, epochs::budget, terrain};
use super::{capacity_epochs_surveyed, housing_relaxation};
use crate::urban::{LayoutConfig, Morph, Point, Site, Surface, resolve};

/// Zone, recipe and land share of each growth epoch, for the capacity plan.
fn capacity_epochs(
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    area: f64,
    surface: Surface<'_>,
) -> Vec<capacity::Epoch> {
    capacity_epochs_surveyed(site, cfg, morph, area, surface).0
}

/// Invariant (adaptive capacity, user rule 03/11): a sparse tissue that its
/// own densified cutting cannot house on bounded land keeps its own cutting
/// (never another culture's) and states its deficit.
#[test]
fn a_bounded_sparse_tissue_keeps_its_own_cutting_and_states_its_deficit() {
    let h = vec![10.0; 128 * 128];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 6000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let site = Site {
        key: "capacity".into(),
        name: String::new(),
        population: 20_000,
        culture: "halfling".into(),
        center: Point {
            x: 3000.0,
            y: 3000.0,
        },
        radius: 600.0,
        neighbours: Vec::new(),
    };
    let cfg = LayoutConfig {
        culture: "site".into(),
        ..LayoutConfig::default()
    };
    let morph = resolve(
        "halfling",
        "culture",
        "auto",
        "core",
        1.0,
        &serde_json::json!({}),
        "quarters",
    )
    .unwrap();
    let (nominal, _) = budget(&site, &cfg, &morph, 600.0);
    let epochs = capacity_epochs(&site, &cfg, &morph, nominal, surface);
    // The terrain grants half the nominal land: no extension is possible.
    let plan = capacity::plan(&site, &cfg, &epochs, nominal, Some(nominal * 0.5)).unwrap();
    let text = capacity::describe("halfling", &plan).join(", ");
    eprintln!("{text}; {plan:?}");
    assert!(plan.extension <= 1.0 && plan.densify >= 1.0);
    assert!(plan.donor.is_empty() && plan.borrowed_share == 0.0, "{plan:?}");
    assert!(plan.shortfall > 0.0 && !text.contains("découpe empruntée"), "{text}");
}

/// Review 03/11 (ville-10k giant-hold): the giants' town kept the
/// Caucasus cutting on most of its quarters. A culture short of land
/// widens its own footprint instead, and never names a donor.
#[test]
fn review12_a_giant_town_widens_its_own_tissue_instead_of_borrowing() {
    let h = vec![10.0; 128 * 128];
    let w = vec![0; h.len()];
    let surface = Surface { geometry: None, width: 8000.0, n: 128, height: &h, water: &w, interpolation: Default::default(),};
    let site = Site { key: "capacity".into(), name: String::new(), population: 10_000, culture: "giant-hold".into(),
        center: Point { x: 4000.0, y: 4000.0 }, radius: 735.0,
        neighbours: Vec::new(), };
    let cfg = LayoutConfig { culture: "site".into(), ..LayoutConfig::default() };
    let morph = resolve("giant-hold", "culture", "auto", "core", 1.0, &serde_json::json!({}), "quarters").unwrap();
    let (nominal, _) = budget(&site, &cfg, &morph, 735.0);
    let epochs = capacity_epochs(&site, &cfg, &morph, nominal, surface);
    for yield_ratio in [0.0, 0.4] {
        let cfg = LayoutConfig { capacity_yield: yield_ratio, ..cfg.clone() };
        let plan = capacity::plan(&site, &cfg, &epochs, nominal, None).unwrap();
        let text = capacity::describe("giant-hold", &plan).join(", ");
        assert!(plan.donor.is_empty() && plan.borrowed_share == 0.0 && !text.contains("découpe empruntée"), "{text}");
        if plan.densify >= 1.0 { assert!(plan.extension > 1.0, "{text}"); }
    }
}

#[test]
fn housing_relaxation_relaxes_only_land_the_strict_gates_cannot_house() {
    // Households missed by a plan whose capacity is proportional to the housable share.
    let plan = |capacity: f64| move |share: f64| Some((1000.0 - capacity * share).max(0.0));
    // Half of the land refused, ample capacity: the strict gates house the town.
    assert_eq!(housing_relaxation(&[0.5, 0.88, 1.0, 1.0], plan(2500.0)), 0.0);
    // A flank just above half: strict short, the first relaxation houses it.
    assert_eq!(housing_relaxation(&[0.51, 0.88, 1.0, 1.0], plan(1500.0)), terrain::LEVELS[1]);
    // No level houses it: the first level that misses the fewest.
    assert_eq!(housing_relaxation(&[0.3, 0.6, 0.9, 0.9], plan(500.0)), terrain::LEVELS[2]);
    // Without a capacity plan the strict gates stay.
    assert_eq!(housing_relaxation(&[0.3, 0.6, 1.0, 1.0], |_| None), 0.0);
}
