use super::super::geometry::rectangle;
use super::*;
use serde_json::json;

fn fixture(street_split: bool, block_split: bool, culture: &str) -> Layout {
    let mut shape = rectangle(0.0, 0.0, 100.0, 40.0);
    if block_split {
        shape.outer.insert(1, Point { x: 50.0, y: 0.0 });
    }
    let mut path = vec![Point { x: -3.0, y: -3.0 }, Point { x: 103.0, y: -3.0 }];
    if street_split {
        path.insert(1, Point { x: 50.0, y: -3.0 });
    }
    serde_json::from_value(json!({
        "key":"segmentation-100x40", "culture":culture,"center":{"x":50.0,"y":20.0},
        "quarters":[],"warnings":[],"blocks":[{"shape":shape,"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0},"zone":"core"}],
        "streets":[{"widths":vec![6.0;path.len()],"path":path,"rank":1,"role":"street"}]
    })).unwrap()
}

fn morph(op: &str) -> Morph {
    Morph {
        value: json!({"plotOp":op,"streetOp":"grid","plotTilt":0.0,"deepFill":false,
        "frontage":{"core":[8.0,12.0]},"plotDepth":{"core":[20.0,30.0]},"houseArea":{"core":[130.0,400.0]},"coverage":{"core":[0.4,0.6]}}),
    }
}

#[test]
fn public_witness_and_access_use_the_same_frontage_tolerance() {
    let shape = rectangle(0.0, 0.0, 12.0, 20.0);
    let mut front = Front {
        a: Point { x: 0.0, y: 0.0 },
        b: Point { x: 5.599, y: 0.0 },
        street: 0,
        rank: 1,
        shared: false,
        gate: false,
    };
    // The body fits behind a public facade shorter than its 5.6 m module,
    // but that must not become an admitted plot with an unserved access.
    assert!(families::envelope(&shape, &[front], 5.6, 8.25, 0.8).is_none());
    front.b.x = 5.6;
    assert!(families::envelope(&shape, &[front], 5.6, 8.25, 0.8).is_some());
    // An actual private gate remains independent of the interior body width.
    front.b.x = 0.8;
    front.gate = true;
    assert!(families::envelope(&shape, &[front], 5.6, 8.25, 0.8).is_some());
    front.b.x = 0.799;
    assert!(families::envelope(&shape, &[front], 5.6, 8.25, 0.8).is_none());
}

#[test]
fn retained_medina_repaired_cells_recover_a_native_module_without_losing_land() {
    use geo::{Area, BooleanOps};
    let layout: Layout =
        serde_json::from_str(include_str!("fixtures/medina-repaired-core.json")).unwrap();
    let seed = "urban-buildings-review-v1";
    let automatic = ParcelConfig {
        recipe: "core".into(),
        ..Default::default()
    };
    let forced = ParcelConfig {
        operator: "strips".into(),
        ..automatic.clone()
    };
    let before =
        super::super::generate_parcels(seed, std::slice::from_ref(&layout), &forced).unwrap();
    let after =
        super::super::generate_parcels(seed, std::slice::from_ref(&layout), &automatic).unwrap();
    let count = |p: &Partition| p.parcels.iter().filter(|p| p.use_kind == "plot").count();
    // Smaller *native* flat-roof domains may make the initial cuts sufficient;
    // a particular repair provenance is not the required cadastral outcome.
    eprintln!(
        "retained medina cadence: valid plots {} -> {}; by block {:?} -> {:?}",
        count(&before[0]),
        count(&after[0]),
        (0..layout.blocks.len())
            .map(|bi| before[0]
                .parcels
                .iter()
                .filter(|p| p.block == bi && p.use_kind == "plot")
                .count())
            .collect::<Vec<_>>(),
        (0..layout.blocks.len())
            .map(|bi| after[0]
                .parcels
                .iter()
                .filter(|p| p.block == bi && p.use_kind == "plot")
                .count())
            .collect::<Vec<_>>()
    );
    // Forced strips now also cut normal to the curved souk frontage and place
    // their cuts by area, so they may beat the native cadence by one lot on
    // these three small blocks; the native path must stay within one lot and
    // still recover modules beyond the four of the original regression.
    assert!(
        count(&after[0]) + 1 >= count(&before[0]) && count(&after[0]) > 4,
        "native cadence before={} after={}",
        count(&before[0]),
        count(&after[0])
    );
    for (bi, block) in layout.blocks.iter().enumerate() {
        let cells = after[0]
            .parcels
            .iter()
            .filter(|p| p.block == bi)
            .collect::<Vec<_>>();
        let polygons = cells
            .iter()
            .map(|p| super::super::geometry::polygon(&p.shape))
            .collect::<Vec<_>>();
        let merged = geo::algorithm::bool_ops::unary_union(&polygons);
        let original = super::super::geometry::polygon(&block.shape);
        assert!(
            original.difference(&merged).unsigned_area()
                + merged.difference(&original).unsigned_area()
                < 0.01
        );
        assert!(
            polygons.iter().map(Area::unsigned_area).sum::<f64>() - merged.unsigned_area() < 0.01
        );
        for p in cells.into_iter().filter(|p| p.use_kind == "plot") {
            let profile = super::super::culture::parcel_mapping(&layout, p, "medina", "domestic")
                .unwrap()
                .admissibility;
            assert!(
                parcel_envelope(
                    p,
                    profile.min_frontage,
                    profile.min_depth,
                    profile.min_access_width
                )
                .is_some()
            );
            let witness = p.envelope.as_ref().unwrap();
            assert!(
                super::super::geometry::polygon(witness)
                    .difference(&super::super::geometry::polygon(&p.shape))
                    .unsigned_area()
                    < 1e-5
            );
            assert!(
                p.front.is_some()
                    && p.access.as_ref().is_some_and(|a| matches!(
                        a.kind.as_str(),
                        "public" | "private" | "collective"
                    ))
            );
        }
    }
    let replay = super::super::generate_parcels(seed, &[layout], &automatic).unwrap();
    assert_eq!(
        serde_json::to_value(after).unwrap(),
        serde_json::to_value(replay).unwrap()
    );
}

#[test]
fn cadastral_contacts_and_lots_are_invariant_to_both_segmentations() {
    use geo::{Area, BooleanOps};
    for op in ["burgage", "compact", "courtyard", "inherited"] {
        let culture = if op == "courtyard" {
            "medina"
        } else {
            "european-organic"
        };
        let base = generate(
            "segmentation-regression",
            &fixture(false, false, culture),
            &ParcelConfig::default(),
            &morph(op),
        )
        .unwrap();
        assert!(
            base.parcels.iter().filter(|p| p.use_kind == "plot").count() >= 2,
            "{op}: {:?}",
            base.parcels
                .iter()
                .map(|p| (&p.use_kind, &p.reason, area(&p.shape)))
                .collect::<Vec<_>>()
        );
        for (street_split, block_split) in [(true, false), (false, true), (true, true)] {
            let variant = generate(
                "segmentation-regression",
                &fixture(street_split, block_split, culture),
                &ParcelConfig::default(),
                &morph(op),
            )
            .unwrap();
            assert_eq!(
                base.parcels.len(),
                variant.parcels.len(),
                "{op} {street_split}/{block_split}: count"
            );
            assert_eq!(base.warnings, variant.warnings, "{op}: warnings");
            for p in &base.parcels {
                let q = variant
                    .parcels
                    .iter()
                    .find(|q| q.id == p.id)
                    .unwrap_or_else(|| panic!("{op}: missing stable identity {}", p.id));
                assert_eq!(
                    (&p.use_kind, &p.reason, &p.parent_ids, &p.provenance),
                    (&q.use_kind, &q.reason, &q.parent_ids, &q.provenance),
                    "{op}: use/lineage"
                );
                assert_eq!(
                    p.access.as_ref().map(|a| (&a.kind, a.street)),
                    q.access.as_ref().map(|a| (&a.kind, a.street)),
                    "{op}: access"
                );
                assert!(
                    (p.access.as_ref().unwrap().front_length
                        - q.access.as_ref().unwrap().front_length)
                        .abs()
                        < 1e-6,
                    "{op}: useful frontage"
                );
                let difference = super::super::geometry::polygon(&p.shape)
                    .xor(&super::super::geometry::polygon(&q.shape))
                    .unsigned_area();
                assert!(
                    difference <= 0.01_f64.max(area(&p.shape) * 1e-6),
                    "{op}: symmetric difference {difference}"
                );
                if p.use_kind == "plot" {
                    assert!(p.front.is_some() && p.envelope.is_some());
                }
            }
        }
    }
}

#[test]
fn cadastral_shared_court_has_real_street_and_internal_contacts() {
    let mut layout = fixture(false, false, "medina");
    layout.blocks[0].shape = rectangle(0.0, 0.0, 100.0, 70.0);
    let result = generate(
        "court-regression",
        &layout,
        &ParcelConfig::default(),
        &morph("courtyard"),
    )
    .unwrap();
    assert!(result.parcels.iter().any(|p|p.use_kind=="court" && p.access.as_ref().is_some_and(|a|a.kind=="public")),"connected shared court");
    assert!(
        result
            .parcels
            .iter()
            .any(|p| p.use_kind == "plot" && p.contacts.iter().any(|c| c.kind == "collective")),
        "internal collective contacts"
    );
    assert!(
        result
            .parcels
            .iter()
            .filter(|p| p.use_kind == "plot")
            .all(|p| p.envelope.is_some() && p.front.is_some())
    );
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    let diagnostics = result.diagnostics.unwrap();
    assert!(diagnostics.residual_area + diagnostics.overlap_area < 0.01);
}

#[test]
fn cadastral_refusals_and_intentional_gardens_are_distinct() {
    let mut layout = fixture(false, false, "medina");
    layout.blocks[0].shape = rectangle(0.0, 0.0, 5.0, 40.0);
    let rejected = generate(
        "narrow-refusal",
        &layout,
        &ParcelConfig::default(),
        &morph("wholeBlock"),
    )
    .unwrap();
    assert_eq!(rejected.parcels[0].use_kind, "residual");
    assert_eq!(rejected.parcels[0].reason, "insufficient-cultural-frontage");
    assert!(rejected.parcels[0].envelope.is_none());
    let garden = generate(
        "intentional-garden",
        &layout,
        &ParcelConfig::default(),
        &morph("garden"),
    )
    .unwrap();
    assert_eq!(garden.parcels[0].use_kind, "garden");
    assert_eq!(garden.parcels[0].reason, "intentional-garden");
    layout.streets.clear();
    let inaccessible = generate(
        "no-access",
        &layout,
        &ParcelConfig::default(),
        &morph("burgage"),
    )
    .unwrap();
    assert_eq!(inaccessible.parcels[0].reason, "no-street-contact");
    assert_eq!(inaccessible.warnings.len(), 1);
}

#[test]
fn cadastral_frontage_union_handles_split_contours_and_partial_contacts() {
    let layout = fixture(true, true, "european-organic");
    let fronts = frontages(
        &layout.blocks[0].shape,
        &layout,
        &FrontageIndex::new(&layout),
    );
    assert_eq!(fronts.len(), 1);
    assert!((length(sub(fronts[0].b, fronts[0].a)) - 100.0).abs() < 1e-6);
    let p = rectangle(20.0, 0.0, 80.0, 10.0);
    let (len, front) = frontage(&p, &fronts);
    assert!((len - 60.0).abs() < 1e-6);
    assert!((length(sub(front.unwrap().b, front.unwrap().a)) - len).abs() < 1e-6);
}

#[test]
fn cadastral_families_preserve_holes_reserves_routes_and_witnesses() {
    use geo::{Area, BooleanOps};
    let mut layout = fixture(false, false, "medina");
    layout.blocks[0].shape = rectangle(0.0, 0.0, 100.0, 80.0);
    layout.blocks[0].shape.holes.push(
        rectangle(42.0, 32.0, 58.0, 48.0)
            .outer
            .into_iter()
            .rev()
            .collect(),
    );
    let mut reserve = layout.blocks[0].clone();
    reserve.kind = "reserve:market".into();
    reserve.shape = rectangle(120.0, 0.0, 160.0, 40.0);
    layout.blocks.push(reserve);
    let retained = serde_json::to_value(&layout).unwrap();
    for op in ["strips", "compact", "courtyard", "inherited"] {
        let config = ParcelConfig {
            operator: op.into(),
            ..ParcelConfig::default()
        };
        let result = generate(
            "hole-reserve-regression",
            &layout,
            &config,
            &morph("burgage"),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&layout).unwrap(),
            retained,
            "{op}: retained layout"
        );
        let reserves: Vec<_> = result.parcels.iter().filter(|p| p.block == 1).collect();
        assert_eq!(reserves.len(), 1, "{op}: reserve retained whole");
        assert_eq!(reserves[0].reason, "reserve:market");
        assert_eq!(reserves[0].access.as_ref().unwrap().kind, "reserved");
        let diagnostics = result.diagnostics.as_ref().unwrap();
        assert!(
            diagnostics.residual_area + diagnostics.overlap_area < 0.01,
            "{op}: partition"
        );
        for p in result.parcels.iter().filter(|p| p.block == 0) {
            assert!(
                super::super::geometry::polygon(&p.shape)
                    .difference(&super::super::geometry::polygon(&layout.blocks[0].shape))
                    .unsigned_area()
                    < 0.01,
                "{op}: hole/containment"
            );
            if p.use_kind == "plot" {
                let envelope = p.envelope.as_ref().expect("every plot has a witness");
                assert!(
                    super::super::geometry::polygon(envelope)
                        .difference(&super::super::geometry::polygon(&p.shape))
                        .unsigned_area()
                        < 1e-5,
                    "{op}: witness containment"
                );
                assert!(p.front.is_some() && !p.contacts.is_empty());
            }
        }
    }
}

#[test]
fn cadastral_pressure_follows_network_subcenters_and_softens_planned_variation() {
    let mut layout = fixture(false, false, "european-organic");
    layout.center = Point { x: 10.0, y: -3.0 };
    layout.streets[0].path = vec![Point { x: 0.0, y: -3.0 }, Point { x: 400.0, y: -3.0 }];
    let first = layout.blocks[0].clone();
    layout.blocks = (0..3)
        .map(|i| {
            let mut b = first.clone();
            b.shape = rectangle(i as f64 * 150.0, 0.0, i as f64 * 150.0 + 40.0, 40.0);
            b
        })
        .collect();
    let base = occupation_pressures(&layout);
    assert!(base[0] > base[1] && base[1] > base[2]);
    layout.structure = Some(super::super::UrbanStructure {
        centers: vec![
            super::super::UrbanCenter {
                id: 0,
                point: layout.center,
                weight: 1.0,
            },
            super::super::UrbanCenter {
                id: 1,
                point: Point { x: 320.0, y: -3.0 },
                weight: 1.0,
            },
        ],
        ..Default::default()
    });
    let centered = occupation_pressures(&layout);
    assert!(centered[2] > base[2] && centered[2] > centered[1]);
    let m = morph("burgage");
    let low = pressure::apply(&m, 0.1, false, None);
    let high = pressure::apply(&m, 0.9, false, None);
    assert!(low.range("frontage", "core")[0] > high.range("frontage", "core")[0]);
    assert!(low.range("coverage", "core")[0] < high.range("coverage", "core")[0]);
    let planned_low = pressure::apply(&m, 0.1, true, None);
    let planned_high = pressure::apply(&m, 0.9, true, None);
    assert!(
        planned_low.range("frontage", "core")[0] - planned_high.range("frontage", "core")[0]
            < low.range("frontage", "core")[0] - high.range("frontage", "core")[0]
    );
}

#[test]
fn cultural_family_selection_changes_the_actual_cadastral_operator() {
    for (culture, family) in [
        ("european-organic", "frontage"),
        ("bastide", "compact"),
        ("medina", "frontage"),
        ("chinese", "courtyard"),
        ("elven", "inherited"),
    ] {
        let layout = fixture(false, false, culture);
        for recipe in ["auto", "core", "village"] {
            let family = if culture == "medina" && recipe == "village" {
                "courtyard"
            } else {
                family
            };
            let config = ParcelConfig {
                recipe: recipe.into(),
                ..Default::default()
            };
            let result = super::super::generate_parcels(
                "culture-families",
                std::slice::from_ref(&layout),
                &config,
            )
            .unwrap();
            assert!(
                result[0].parcels.iter().all(|p| p.family == family),
                "{culture}/{recipe}: expected {family}"
            );
        }
        let forced = ParcelConfig {
            recipe: "core".into(),
            operator: "frontage".into(),
            ..Default::default()
        };
        let forced = super::super::generate_parcels(
            "culture-families",
            std::slice::from_ref(&layout),
            &forced,
        )
        .unwrap();
        assert!(forced[0].parcels.iter().all(|p| p.family == "frontage"));
        let result =
            super::super::generate_parcels("culture-families", &[layout], &ParcelConfig::default())
                .unwrap();
        assert!(
            result[0].parcels.iter().all(|p| p.family == family),
            "{culture}: {:?}",
            result[0]
                .parcels
                .iter()
                .map(|p| &p.family)
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn quarter_phase_supplies_culture_when_older_blocks_omit_phase() {
    let mut layout = fixture(false, false, "european-organic");
    layout.quarters = vec![super::super::Quarter {
        shape: layout.blocks[0].shape.clone(),
        phase: 1,
        zone: "core".into(),
    }];
    layout.phases = ["european-organic", "medina"]
        .into_iter()
        .map(|culture| super::super::GrowthPhase {
            culture: culture.into(),
            kind: "core".into(),
            zone: "core".into(),
            recipe: "core".into(),
            population: 100.0,
            target_area: 4000.0,
            shapes: vec![layout.blocks[0].shape.clone()],
        })
        .collect();
    let implicit = super::super::generate_parcels(
        "legacy-phase-culture",
        std::slice::from_ref(&layout),
        &ParcelConfig::default(),
    )
    .unwrap();
    layout.blocks[0].phase = Some(1);
    let explicit =
        super::super::generate_parcels("legacy-phase-culture", &[layout], &ParcelConfig::default())
            .unwrap();
    assert_eq!(
        serde_json::to_value(&implicit).unwrap(),
        serde_json::to_value(explicit).unwrap()
    );
    assert!(implicit[0].parcels.iter().all(|p| p.family == "frontage"));
}

#[test]
fn parcel_identity_and_lineage_survive_block_insertion_and_reordering() {
    let mut layout = fixture(false, false, "european-organic");
    let cfg = ParcelConfig {
        operator: "wholeBlock".into(),
        ..Default::default()
    };
    let original =
        super::super::generate_parcels("stable-block-owners", std::slice::from_ref(&layout), &cfg)
            .unwrap();
    let mut reserve = layout.blocks[0].clone();
    reserve.kind = "reserve:market".into();
    reserve.shape = rectangle(150.0, 0.0, 190.0, 40.0);
    layout.blocks.insert(0, reserve);
    let inserted =
        super::super::generate_parcels("stable-block-owners", std::slice::from_ref(&layout), &cfg)
            .unwrap();
    let old = &original[0].parcels[0];
    let new = inserted[0].parcels.iter().find(|p| p.block == 1).unwrap();
    assert_eq!(old.id, new.id);
    assert_eq!(old.parent_ids, new.parent_ids);
    assert!(!old.id.contains("block-0/"));
    layout.blocks.reverse();
    let reordered = super::super::generate_parcels("stable-block-owners", &[layout], &cfg).unwrap();
    assert_eq!(
        inserted[0]
            .parcels
            .iter()
            .map(|p| (&p.id, &p.parent_ids))
            .collect::<std::collections::BTreeSet<_>>(),
        reordered[0]
            .parcels
            .iter()
            .map(|p| (&p.id, &p.parent_ids))
            .collect()
    );
}

#[test]
fn private_gate_width_does_not_replace_the_interior_building_module() {
    let mut layout = fixture(false, false, "medina");
    let admission = crate::urban::culture::admissibility("medina");
    let width = admission.min_frontage + 4.0;
    let depth = admission.min_depth + 4.0;
    layout.blocks[0].shape = rectangle(0.0, 0.0, width, depth);
    layout.streets[0].path = vec![
        Point {
            x: width * 0.5 - 1.0,
            y: -3.0,
        },
        Point {
            x: width * 0.5 + 1.0,
            y: -3.0,
        },
    ];
    layout.streets[0].role = "private".into();
    let config = ParcelConfig {
        operator: "wholeBlock".into(),
        ..Default::default()
    };
    let result = super::super::generate_parcels("narrow-private-gate", &[layout], &config).unwrap();
    let p = &result[0].parcels[0];
    assert_eq!(p.use_kind, "plot", "{}", p.reason);
    assert_eq!(p.access.as_ref().unwrap().kind, "private");
    assert!((p.access.as_ref().unwrap().front_length - 2.0).abs() < 1e-6);
    assert!(p.envelope.is_some());
}

#[test]
fn curved_village_fronts_keep_exact_envelopes_and_rank_useful_candidates() {
    #[derive(serde::Deserialize)]
    struct Case {
        shape: Shape,
        contacts: Vec<super::super::ParcelContact>,
        id: String,
    }
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("fixtures/village-curved-contacts.json")).unwrap();
    let profile = super::super::culture::admissibility("halfling");
    for case in cases.iter().take(2) {
        let mut p = parcel(case.shape.clone(), 0, Point { x: 1.0, y: 0.0 }, &[], "plot");
        p.contacts = case.contacts.clone();
        assert!(
            continuous_frontage(&p.contacts) > profile.min_frontage,
            "{}",
            case.id
        );
        let witness = parcel_envelope(
            &p,
            profile.min_frontage,
            profile.min_depth,
            profile.min_access_width,
        )
        .unwrap_or_else(|| panic!("real village parcel {} lost its exact witness", case.id));
        assert!(difference(&witness, &p.shape).iter().map(area).sum::<f64>() < 1e-5);
        let mut reversed = p.clone();
        reversed.contacts.reverse();
        assert!(
            parcel_envelope(
                &reversed,
                profile.min_frontage,
                profile.min_depth,
                profile.min_access_width
            )
            .is_some()
        );
        // A fully enclosed hole must remain an exclusion during admission.
        let mut perforated = p.clone();
        perforated.shape.holes.push(witness.outer.clone());
        if let Some(other) = parcel_envelope(
            &perforated,
            profile.min_frontage,
            profile.min_depth,
            profile.min_access_width,
        ) {
            assert!(
                difference(&other, &perforated.shape)
                    .iter()
                    .map(area)
                    .sum::<f64>()
                    < 1e-5
            );
        }
    }
}

#[test]
fn frontage_support_never_adds_disjoint_or_corner_contacts() {
    let mk = |a: Point, b: Point| super::super::ParcelContact {
        a,
        b,
        street: 0,
        rank: 1,
        length: length(sub(b, a)),
        kind: "public".into(),
    };
    let a = mk(Point { x: 0.0, y: 0.0 }, Point { x: 4.0, y: 0.0 });
    let disjoint = mk(Point { x: 5.0, y: 0.0 }, Point { x: 9.0, y: 0.0 });
    let corner = mk(Point { x: 4.0, y: 0.0 }, Point { x: 4.0, y: 4.0 });
    assert_eq!(continuous_frontage(&[a.clone(), disjoint]), 4.0);
    assert_eq!(continuous_frontage(&[a, corner]), 4.0);
}

#[test]
fn unsupported_period_preserves_land_without_a_neutral_admission_fallback() {
    let mut layout = fixture(false, false, "medina");
    layout.programme = Some(
        serde_json::from_value(json!({
            "version":1,"population":200,"context":{"period":"unknown-test-era"},
            "cultures":[],"demands":[],"reservations":[],"allocations":[],
            "adjacency":[],"environment":[],"reconciliationPasses":0,"warnings":[]
        }))
        .unwrap(),
    );
    let result = generate(
        "unsupported-era",
        &layout,
        &ParcelConfig::default(),
        &morph("courtyard"),
    )
    .unwrap();
    assert_eq!(result.parcels.len(), 1);
    let p = &result.parcels[0];
    assert_eq!(p.use_kind, "residual");
    assert_eq!(p.reason, "unsupported-period-profile");
    assert_eq!(area(&p.shape), 4000.0);
    assert!(!p.contacts.is_empty());
    assert!(p.envelope.is_none());
}

/// Offline probe (ignored): `Q_LAYOUT` (a replayed layout.json) and `Q_REQUEST`
/// (its quarters request) regenerate the partition and print lot balance facts.
#[test]
#[ignore]
fn probe_partition() {
    let (Ok(lp), Ok(rp)) = (std::env::var("Q_LAYOUT"), std::env::var("Q_REQUEST")) else {
        return;
    };
    let layout: Layout = serde_json::from_str(&std::fs::read_to_string(lp).unwrap()).unwrap();
    let request: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(rp).unwrap()).unwrap();
    let cfg: ParcelConfig = serde_json::from_value(match &request["parcelConfig"] {
        serde_json::Value::Null => json!({}),
        v => v.clone(),
    })
    .unwrap();
    let seed = request["seed"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| request["seed"].to_string());
    let t = std::time::Instant::now();
    let out = super::super::generate_parcels(&seed, &[layout], &cfg).unwrap();
    eprintln!("parcels {} in {:?}", out[0].parcels.len(), t.elapsed());
    if let Ok(path) = std::env::var("Q_OUT") {
        std::fs::write(path, serde_json::to_string(&out[0]).unwrap()).unwrap();
    }
}

fn front(a: (f64, f64), b: (f64, f64), rank: usize, street: usize) -> Front {
    Front {
        a: Point { x: a.0, y: a.1 },
        b: Point { x: b.0, y: b.1 },
        rank,
        street,
        shared: false,
        gate: false,
    }
}

/// Invariant (back-to-back balance): between two opposite fronts, the
/// higher-ranked street claims at most `MAX_DEPTH_SHARE` of the depth, so a
/// main-street lot and the back-lane lot behind it stay within 3:2 in depth
/// (plus the 1.2 m allowance of `ray_limit`).
#[test]
fn back_to_back_lots_share_the_block_depth_within_the_rank_bound() {
    let shape = rectangle(0.0, 0.0, 60.0, 40.0);
    // Main street (rank 0) along y = 0, back lane (rank 3) along y = 40.
    let fronts = [
        front((0.0, 0.0), (60.0, 0.0), 0, 0),
        front((60.0, 40.0), (0.0, 40.0), 3, 1),
    ];
    let mut m = morph("burgage");
    m.value["plotDepth"]["core"] = json!([38.0, 40.0]);
    m.value["deepFill"] = json!(true);
    let lots = strips(
        &shape,
        0,
        Point { x: 1.0, y: 0.0 },
        &fronts,
        &m,
        "core",
        &mut Rng::new("balance"),
    );
    let reach = |p: &Parcel, y: f64| {
        p.shape
            .outer
            .iter()
            .map(|q| (q.y - y).abs())
            .fold(0.0, f64::max)
    };
    let (mut main, mut lane) = (0.0_f64, f64::INFINITY);
    for p in lots.iter().filter(|p| p.use_kind == "plot") {
        match p.front.map(|f| f[0].y.round() as i64) {
            Some(0) => main = main.max(reach(p, 0.0)),
            Some(40) => lane = lane.min(reach(p, 40.0)),
            _ => {}
        }
    }
    assert!(main > 0.0 && lane.is_finite(), "both fronts are cut");
    assert!(
        main <= MAX_DEPTH_SHARE * 40.0 + 1.3,
        "main lots {main} m deep"
    );
    // 3:2 plus the 1.2 m allowance of `ray_limit` (before: 0.85, about 6:1).
    assert!(
        main / lane <= (0.6 * 40.0 + 1.3) / (0.4 * 40.0 - 1.3),
        "depth ratio {main}/{lane}"
    );
}

/// Invariant (lot balance): sharing a residual strip never bloats a lot past
/// 2.5x its smallest admitted neighbour; the strip becomes garden land.
#[test]
fn residual_sharing_that_would_bloat_a_lot_leaves_a_garden() {
    let fronts = [front((0.0, 34.0), (30.0, 34.0), 2, 0)];
    let axis = Point { x: 1.0, y: 0.0 };
    let admitted = |s: Shape| {
        let mut p = parcel(s.clone(), 0, axis, &fronts, "plot");
        p.envelope = Some(s);
        p
    };
    let strip = parcel(rectangle(0.0, 30.0, 30.0, 34.0), 0, axis, &fronts, "plot");
    let mut cells = vec![
        admitted(rectangle(0.0, 0.0, 30.0, 30.0)),
        admitted(rectangle(-6.0, 0.0, 0.0, 10.0)),
        strip,
    ];
    let accept = |s: &Shape| Some(s.clone());
    let shallow = |_: &Shape| false;
    assert!(share_out(
        &mut cells,
        2,
        &fronts,
        &accept,
        &shallow,
        f64::INFINITY
    ));
    assert_eq!(cells.len(), 3);
    assert!(
        (area(&cells[0].shape) - 900.0).abs() < 1e-6,
        "the big lot did not grow"
    );
    assert_eq!(cells[2].use_kind, "garden");
    assert!(cells[2].provenance.iter().any(|q| q == "balance-garden"));
}

/// Invariant (garden character): an adapted tissue keeps its garden floor;
/// lots give up rear land beyond their witness, which stays inside them.
#[test]
fn adapted_tissue_keeps_its_garden_floor_without_losing_witnesses() {
    let layout = fixture(false, false, "european-organic");
    let fronts = [front((0.0, 0.0), (100.0, 0.0), 1, 0)];
    let axis = Point { x: 1.0, y: 0.0 };
    let mut cells: Vec<Parcel> = (0..10)
        .map(|i| {
            let x = i as f64 * 10.0;
            let mut p = parcel(rectangle(x, 0.0, x + 10.0, 40.0), 0, axis, &fronts, "plot");
            p.envelope = Some(rectangle(x + 1.0, 0.0, x + 9.0, 12.0));
            p
        })
        .collect();
    let witnesses: Vec<Shape> = cells.iter().map(|p| p.envelope.clone().unwrap()).collect();
    keep_gardens(&mut cells, &fronts, &layout, 0.3, 8.0);
    let gardens: f64 = cells
        .iter()
        .filter(|p| p.use_kind == "garden")
        .map(|p| area(&p.shape))
        .sum();
    assert!(gardens >= 0.3 * 4000.0 - 1.0, "gardens {gardens} m²");
    let plots: Vec<&Parcel> = cells.iter().filter(|p| p.use_kind == "plot").collect();
    assert_eq!(plots.len(), 10);
    for (p, w) in plots.iter().zip(&witnesses) {
        let outside: f64 = difference(w, &p.shape).iter().map(area).sum();
        assert!(outside < 1e-6 && p.envelope.is_some() && p.front.is_some());
    }
    assert!(
        cells
            .iter()
            .filter(|p| p.use_kind == "garden")
            .all(|p| p.reason == "attached-rear-land")
    );
}

fn walled(depth: f64, wall: bool, attached: bool) -> Layout {
    let mut layout = fixture(false, false, "european-organic");
    layout.blocks[0].shape = rectangle(0.0, 0.0, 100.0, depth);
    if wall {
        let y = depth + 1.5;
        let mut e: super::super::Enclosure = serde_json::from_value(json!({
            "path":[{"x":-200.0,"y":-200.0},{"x":300.0,"y":-200.0},{"x":300.0,"y":y},{"x":-200.0,"y":y}],
            "kind":"wall","gates":[]
        }))
        .unwrap();
        if attached {
            // A lean-to on the outer face beside a road along x = 120.
            e.attached = vec![super::super::Attached {
                kind: "lean-to".into(),
                side: "out".into(),
                shape: rectangle(110.0, y + 1.5, 116.0, y + 8.0),
                height_m: 5.0,
            }];
            layout.streets.push(serde_json::from_value(json!({
                "widths":[6.0,6.0],"path":[{"x":120.0,"y":y - 50.0},{"x":120.0,"y":y + 60.0}],"rank":2,"role":"street"
            })).unwrap());
        }
        layout.enclosures.push(e);
    }
    layout
}

/// Invariant (houses against the wall): lots whose depth ends on the inner
/// face of the town wall run to it (no strip of back land in between) and
/// carry `curtain-backed`; without the wall the same block keeps rear gardens.
#[test]
fn lots_backing_onto_the_town_wall_reach_it_without_a_gap() {
    let cfg = ParcelConfig::default();
    let m = morph("burgage");
    let open = generate("wall", &walled(34.0, false, false), &cfg, &m).unwrap();
    let gardens = |p: &Partition| -> f64 {
        p.parcels
            .iter()
            .filter(|q| q.use_kind == "garden")
            .map(|q| area(&q.shape))
            .sum()
    };
    assert!(gardens(&open) > 100.0, "the open block keeps back land");
    let walled = generate("wall", &walled(34.0, true, false), &cfg, &m).unwrap();
    assert!(gardens(&walled) < 1.0, "{} m² of gap", gardens(&walled));
    let plots: Vec<&Parcel> = walled
        .parcels
        .iter()
        .filter(|q| q.use_kind == "plot")
        .collect();
    assert!(!plots.is_empty());
    assert!(
        plots
            .iter()
            .all(|q| q.provenance.iter().any(|t| t == "curtain-backed"))
    );
}

/// Invariant (faubourg against the wall): a lean-to outside the reserve with
/// a road beside it is a served plot; inside the reserve it stays decor.
#[test]
fn lean_to_outside_the_reserve_is_a_served_faubourg_lot() {
    let mut layout = walled(30.0, true, true);
    let lots = lean_to_lots(&layout);
    assert_eq!(lots.len(), 1);
    let lot = &lots[0];
    assert_eq!(
        (lot.use_kind.as_str(), lot.family.as_str()),
        ("plot", "faubourg")
    );
    assert_eq!(lot.access.as_ref().and_then(|a| a.street), Some(1));
    assert!(lot.front.is_some() && lot.envelope.is_some());
    layout.enclosures[0].reserve = vec![layout.enclosures[0].attached[0].shape.clone()];
    assert!(lean_to_lots(&layout).is_empty());
}

/// Invariant (corner lots, A3 « paires déséquilibrées »): a corner lot of 3x
/// its street neighbour's area gives its far part along the side street to a
/// lot of its own; the corner keeps about 1.6x its neighbour, the land is
/// shared exactly and every part keeps a witness.
#[test]
fn an_oversized_corner_lot_gives_its_side_street_part_to_a_lot_of_its_own() {
    // Main street along y = 0, side street along x = 0.
    let fronts = [
        front((0.0, 0.0), (40.0, 0.0), 1, 0),
        front((0.0, 40.0), (0.0, 0.0), 2, 1),
    ];
    let axis = Point { x: 1.0, y: 0.0 };
    let mut corner = parcel(rectangle(0.0, 0.0, 10.0, 40.0), 0, axis, &fronts, "plot");
    corner.provenance.push("corner-lot".into());
    let neighbour = parcel(rectangle(10.0, 0.0, 18.0, 15.0), 0, axis, &fronts, "plot");
    let mut cells = vec![corner, neighbour];
    let witness = |s: &Shape| (area(s) >= 60.0).then(|| s.clone());
    for c in &mut cells {
        c.envelope = witness(&c.shape);
    }
    split_corners(&mut cells, &fronts, &witness, &|_| false);
    assert_eq!(cells.len(), 3, "the corner lot is split");
    let total: f64 = cells.iter().map(|c| area(&c.shape)).sum();
    assert!((total - 520.0).abs() < 1e-6, "exact partition: {total}");
    let corner = area(&cells[0].shape);
    assert!(
        corner / 120.0 < 3.0 && corner / 120.0 > 1.2,
        "corner {corner:.1} m²"
    );
    let side = &cells[2];
    assert!(side.provenance.iter().any(|x| x == "corner-split"));
    assert!(!side.provenance.iter().any(|x| x == "corner-lot"));
    assert!(
        frontage(&side.shape, &fronts).0 >= 3.0,
        "the side lot fronts the side street"
    );
    assert!(cells.iter().all(|c| c.envelope.is_some()));
}

/// Invariant (court lot pairs): in a court tissue whose lots are admitted by
/// the compact tier only, neighbours on one street are joined when together
/// they hold the court house; the union is exact, admitted by the court
/// profile, and some lots stay ordinary houses (types mix in the block).
#[test]
fn court_tissues_pair_small_lots_into_court_house_lots() {
    let fronts = [front((0.0, 0.0), (120.0, 0.0), 1, 0)];
    let axis = Point { x: 1.0, y: 0.0 };
    // MED-ANT's atrium house (28.1 x 28.3 m) on 8 m x 30 m lots.
    let court = super::super::culture::UrbanAdmissibility {
        recipe_id: "MED-ANT-B02".into(),
        native_layout: "atrium".into(),
        floors: [1, 2],
        eras: vec![],
        min_frontage: 28.1,
        min_access_width: 1.2,
        min_area: 28.1 * 28.3,
        min_depth: 28.3,
        max_slope: 0.2,
        shared_access: false,
        party_walls: true,
    };
    let small = super::super::culture::UrbanAdmissibility {
        recipe_id: "MED-ANT-B12".into(),
        native_layout: "single".into(),
        min_frontage: 5.4,
        min_area: 5.4 * 7.95,
        min_depth: 7.95,
        ..court.clone()
    };
    let layout: Layout = serde_json::from_value(json!({
        "key":"pairs","culture":"roman-core","center":{"x":60.0,"y":15.0},
        "quarters":[],"warnings":[],"blocks":[{"shape":rectangle(0.0, 0.0, 120.0, 30.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0},"zone":"core"}],
        "streets":[{"widths":[6.0,6.0],"path":[{"x":-3.0,"y":-3.0},{"x":123.0,"y":-3.0}],"rank":1,"role":"street"}]
    }))
    .unwrap();
    let mut cells: Vec<Parcel> = (0..15)
        .map(|i| {
            let x = i as f64 * 8.0;
            parcel(rectangle(x, 0.0, x + 8.0, 30.0), 0, axis, &fronts, "plot")
        })
        .collect();
    qualify(
        &mut cells,
        &fronts,
        &layout,
        &court,
        Some(&small),
        false,
        "frontage",
        None,
    );
    assert!(
        cells
            .iter()
            .all(|c| c.envelope.as_ref().is_some_and(|e| witnessed_by(e, &small)))
    );
    let mut rng = Rng::new("pairs");
    pair_courts(
        &mut cells,
        &fronts,
        &layout,
        &court,
        Some(&small),
        "frontage",
        None,
        Some("MED-ANT"),
        0.55,
        &mut rng,
    );
    let paired: Vec<_> = cells
        .iter()
        .filter(|c| c.provenance.iter().any(|x| x == "court-pair"))
        .collect();
    assert!(!paired.is_empty(), "no court lot pair");
    assert!(paired.len() < cells.len(), "every lot became a court house");
    for p in &paired {
        assert!(p.envelope.as_ref().is_some_and(|e| witnessed_by(e, &court)));
        assert!(super::courts::holds_court(p, "MED-ANT", Some("dwelling")));
        assert!(p.parent_ids.len() >= 2 && p.parent_ids.len() <= 4);
    }
    let total: f64 = cells.iter().map(|c| area(&c.shape)).sum();
    assert!((total - 3600.0).abs() < 1e-6, "exact partition: {total}");
}
