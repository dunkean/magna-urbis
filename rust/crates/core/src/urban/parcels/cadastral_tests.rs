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
    assert!(
        count(&after[0]) > count(&before[0]),
        "native cadence before={} after={}",
        count(&before[0]),
        count(&after[0])
    );
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
