//! Regression tests for frontage, cutters and neighbouring lots.

use super::{generate, generate_probe};
use super::contacts::{Front, FrontageIndex, frontage, frontages};
use super::cut_geometry::{bounds, length};
use super::depth::{bound_frontage_depth, lot_depth};
use super::seams::shared;
use super::strip_layout::strips;
use crate::rng::Rng;
use crate::urban::{Block, Layout, Morph, Parcel, ParcelConfig, Point, Shape, Street};
use crate::urban::geometry::{area, difference, intersection, rectangle};
use serde_json::json;

#[test]
fn concave_territory_cannot_wrap_behind_its_residential_frontage() {
    let shape = Shape {
        outer: [
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 180.0),
            (-40.0, 180.0),
            (-40.0, -100.0),
            (0.0, -100.0),
        ]
        .into_iter()
        .map(|(x, y)| Point { x, y })
        .collect(),
        holes: vec![],
    };
    let expected = area(&shape);
    let parts = bound_frontage_depth(
        Parcel {
            pressure: 0.0,
            envelope: None,
            id: "concave-parent".into(),
            parent_ids: Vec::new(),
            provenance: Vec::new(),
            family: "frontage".into(),
            reason: String::new(),
            contacts: Vec::new(),
            shape,
            block: 0,
            axis: Point { x: 1.0, y: 0.0 },
            rank: 2,
            front: Some([Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]),
            use_kind: "plot".into(),
            access: None,
        },
        60.0,
    );
    assert!((parts.iter().map(|p| area(&p.shape)).sum::<f64>() - expected).abs() < 0.01);
    assert!(parts.iter().any(|p| p.use_kind == "plot"));
    assert!(parts.iter().filter(|p| p.use_kind == "plot").all(|p| {
        let (lo, hi) = bounds(&p.shape, Point { x: 0.0, y: 1.0 });
        lo >= -60.01 && hi <= 60.01 && p.front.is_some()
    }));
}

#[test]
fn oversized_sectors_keep_short_frontage_plots_and_exact_back_land() {
    let mut shape = rectangle(0.0, 0.0, 240.0, 400.0);
    shape.holes.push(
        rectangle(80.0, 170.0, 120.0, 210.0)
            .outer
            .into_iter()
            .rev()
            .collect(),
    );
    let layout = Layout {
        config: None,
        programme: None,
        key: "unserved-deep-sector".into(),
        structure: None,
        phases: vec![],
        archetype: "district".into(),
        culture: "european-organic".into(),
        center: Point { x: 120.0, y: 200.0 },
        quarters: vec![],
        enclosures: vec![],
        warnings: vec![],
        blocks: vec![Block {
            phase: None,
            shape: shape.clone(),
            quarter: 0,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
        }],
        streets: vec![Street {
            path: vec![Point { x: 0.0, y: -3.0 }, Point { x: 240.0, y: -3.0 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "street".into(),
        }],
        claim: Default::default(),
    };
    let fronts = frontages(&shape, &layout, &FrontageIndex::new(&layout));
    for op in ["burgage", "machiya", "courtyard", "siheyuan"] {
        let morph = Morph {
            value: json!({"plotOp":op,"streetOp":"grid","plotTilt":0.0,"wideLotChance":0.0,"deepFill":true,
            "frontage":{"core":[8.0,12.0]},"plotDepth":{"core":[20.0,30.0]},"houseArea":{"core":[160.0,600.0]},"coverage":{"core":[0.9,0.95]}}),
        };
        let result =
            generate("bounded-depth", &layout, &ParcelConfig::default(), &morph).unwrap();
        let replay =
            generate("bounded-depth", &layout, &ParcelConfig::default(), &morph).unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(&replay).unwrap(),
            "{op}: replay"
        );
        assert!(result.warnings.is_empty(), "{op}: {:?}", result.warnings);
        assert!(
            (result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - area(&shape)).abs()
                < 0.01,
            "{op}: partition"
        );
        assert!(
            result.parcels.iter().filter(|p| p.front.is_some()).count() > 5,
            "{op}: frontage lots"
        );
        assert!(
            result
                .parcels
                .iter()
                .filter(|p| p.use_kind == "garden")
                .map(|p| area(&p.shape))
                .sum::<f64>()
                > 60000.0,
            "{op}: unserved back land"
        );
        for (i, p) in result.parcels.iter().enumerate() {
            assert!(
                difference(&p.shape, &shape).iter().map(area).sum::<f64>() < 0.01,
                "{op}: containment and hole"
            );
            if p.use_kind == "plot" {
                assert!(frontage(&p.shape, &fronts).0 >= 3.0, "{op}: actual access");
                assert!(
                    bounds(&p.shape, Point { x: 0.0, y: 1.0 }).1 <= 60.01,
                    "{op}: excessive depth"
                );
            }
            for other in &result.parcels[..i] {
                assert!(
                    intersection(&p.shape, &other.shape)
                        .iter()
                        .map(area)
                        .sum::<f64>()
                        < 0.01,
                    "{op}: overlap"
                );
            }
        }
    }
    // A slender plot can fit the area budget and still have an implausible
    // residential depth. Its frontage must not legitimize a 180 m backyard.
    let mut narrow = layout.clone();
    narrow.blocks[0].shape = rectangle(0.0, 0.0, 20.0, 180.0);
    let morph = Morph {
        value: json!({"plotOp":"courtyard","streetOp":"grid","deepFill":true,
        "frontage":{"core":[8.0,12.0]},"plotDepth":{"core":[20.0,30.0]},
        "houseArea":{"core":[200.0,2000.0]},"coverage":{"core":[0.9,0.95]}}),
    };
    let result = generate("long-narrow", &narrow, &ParcelConfig::default(), &morph).unwrap();
    assert!(result.parcels.iter().any(|p| p.use_kind == "garden"));
    assert!((result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - 3600.0).abs() < 0.01);
    assert!(
        result
            .parcels
            .iter()
            .filter(|p| p.use_kind == "plot")
            .all(|p| bounds(&p.shape, Point { x: 0.0, y: 1.0 }).1 <= 60.01)
    );
    // A deliberately large compound remains a compound-sized property: the
    // ordinary courtyard fallback must not replace a user's chosen typology.
    let morph = Morph {
        value: json!({"plotOp":"compound","streetOp":"grid","houseArea":{"core":[100000.0,110000.0]}}),
    };
    let compound = generate("compound", &layout, &ParcelConfig::default(), &morph).unwrap();
    assert_eq!(compound.parcels.len(), 1);
    assert_eq!(compound.parcels[0].use_kind, "plot");
    assert!((area(&compound.parcels[0].shape) - area(&shape)).abs() < 0.01);
}

#[test]
fn seeded_parcels_preserve_holes_partition_and_actual_frontage() {
    let mut shape = rectangle(0.0, 0.0, 100.0, 80.0);
    shape.holes.push(
        rectangle(42.0, 32.0, 58.0, 48.0)
            .outer
            .into_iter()
            .rev()
            .collect(),
    );
    let layout = Layout {
        config: None,
        programme: None,
        key: "frontage-fixture".into(),
        structure: None,
        phases: vec![],
        archetype: "district".into(),
        culture: "european".into(),
        center: Point { x: 50.0, y: 40.0 },
        quarters: vec![],
        enclosures: vec![],
        warnings: vec![],
        blocks: vec![Block {
            phase: None,
            shape: shape.clone(),
            quarter: 0,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
        }],
        streets: vec![Street {
            path: vec![
                Point { x: -3.0, y: -3.0 },
                Point { x: 103.0, y: -3.0 },
                Point { x: 103.0, y: 83.0 },
                Point { x: -3.0, y: 83.0 },
                Point { x: -3.0, y: -3.0 },
            ],
            widths: vec![6.0; 5],
            rank: 1,
            role: "lane".into(),
        }],
        claim: Default::default(),
    };
    let cfg = ParcelConfig::default();
    for op in [
        "burgage",
        "machiya",
        "courtyard",
        "compound",
        "siheyuan",
        "garden",
    ] {
        let morph = Morph {
            value: json!({"plotOp":op,"streetOp":"organic","plotTilt":4.0,"wideLotChance":0.08,"deepFill":false,
            "frontage":{"core":[7.0,13.0]},"plotDepth":{"core":[20.0,35.0]},"houseArea":{"core":[120.0,600.0]},"coverage":{"core":[0.4,0.6]}}),
        };
        let result = generate("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
        let replay = generate("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
        // A probe cut has the same lots and warnings, without the coverage
        // accounts; a published cut served from its memo entry is the
        // published cut computed afresh.
        let probe = generate_probe("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
        assert_eq!(serde_json::to_value(&probe.parcels).unwrap(), serde_json::to_value(&result.parcels).unwrap(), "{op}");
        assert_eq!(probe.warnings, result.warnings, "{op}");
        let (p, r) = (probe.diagnostics.unwrap(), result.diagnostics.clone().unwrap());
        assert_eq!((p.covered_area, p.residual_area, p.overlap_area), (0.0, 0.0, 0.0), "{op}");
        assert_eq!(p.unserved_area.to_bits(), r.unserved_area.to_bits(), "{op}");
        {
            let _scope = crate::urban::probe_cache::Scope::open();
            generate_probe("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
            let served = generate("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
            assert_eq!(serde_json::to_value(&served).unwrap(), serde_json::to_value(&result).unwrap(), "{op}");
        }
        assert!(result.warnings.is_empty(), "{op}: {:?}", result.warnings);
        assert!(
            (result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - area(&shape)).abs()
                < 0.01,
            "{op}"
        );
        let fronts = frontages(&shape, &layout, &FrontageIndex::new(&layout));
        for (i, p) in result.parcels.iter().enumerate() {
            assert!(
                difference(&p.shape, &shape).iter().map(area).sum::<f64>() < 0.01,
                "{op}: containment"
            );
            if p.front.is_some() {
                assert!(frontage(&p.shape, &fronts).0 >= 3.0, "{op}: access");
            }
            for q in &result.parcels[..i] {
                assert!(
                    intersection(&p.shape, &q.shape)
                        .iter()
                        .map(area)
                        .sum::<f64>()
                        < 0.01,
                    "{op}: overlap"
                );
            }
        }
        if op != "garden" {
            assert!(
                result.parcels.iter().filter(|p| p.front.is_some()).count() > 2,
                "{op}: no plots"
            );
        }
    }
}
/// A Byzantine (courtyard-culture) block is filled with admitted lots:
/// small native houses where a court house cannot fit, a derb reaching the
/// deep middle, and no lot deeper than the culture allows (bug 2b).
#[test]
fn courtyard_culture_block_is_filled_with_bounded_lots() {
    let shape = rectangle(0.0, 0.0, 96.0, 84.0);
    let mut layout: Layout = serde_json::from_value(json!({
        "key": "byzantine-block", "culture": "byzantine-greek",
        "center": {"x": 48.0, "y": 42.0},
        "quarters": [], "blocks": [], "warnings": [], "streets": []
    }))
    .unwrap();
    layout.blocks = vec![Block {
        phase: None,
        shape: shape.clone(),
        quarter: 0,
        kind: "block".into(),
        axis: Point { x: 1.0, y: 0.0 },
        zone: "core".into(),
    }];
    layout.streets = vec![Street {
        path: vec![
            Point { x: -3.0, y: -3.0 },
            Point { x: 99.0, y: -3.0 },
            Point { x: 99.0, y: 87.0 },
            Point { x: -3.0, y: 87.0 },
            Point { x: -3.0, y: -3.0 },
        ],
        widths: vec![6.0; 5],
        rank: 2,
        role: "street".into(),
    }];
    let morph = Morph {
        value: json!({"plotOp":"burgage","streetOp":"organic","plotTilt":0.0,"wideLotChance":0.05,
        "frontage":{"core":[5.0,8.0]},"plotDepth":{"core":[10.0,18.0]},
        "houseArea":{"core":[120.0,400.0]},"coverage":{"core":[0.82,0.92]}}),
    };
    let result = generate("byzantine", &layout, &ParcelConfig::default(), &morph).unwrap();
    let plots: Vec<_> = result
        .parcels
        .iter()
        .filter(|p| p.use_kind == "plot")
        .collect();
    let built: f64 = result
        .parcels
        .iter()
        .filter(|p| matches!(p.use_kind.as_str(), "plot" | "court"))
        .map(|p| area(&p.shape))
        .sum();
    assert!(
        built / area(&shape) > 0.7,
        "usable share {}",
        built / area(&shape)
    );
    assert!(plots.len() >= 12, "{} lots", plots.len());
    assert!(
        plots
            .iter()
            .all(|p| p.envelope.is_some() && p.family == "courtyard")
    );
    assert!(
        result.parcels.iter().any(|p| p.use_kind == "court"),
        "a derb serves the middle"
    );
    let index = FrontageIndex::new(&layout);
    let mut fronts = frontages(&shape, &layout, &index);
    for p in result.parcels.iter().filter(|p| p.use_kind == "court") {
        for ring in std::iter::once(&p.shape.outer) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                fronts.push(Front {
                    a: b,
                    b: a,
                    street: 0,
                    rank: 3,
                    shared: true,
                    gate: true,
                });
            }
        }
    }
    for p in &plots {
        assert!(lot_depth(&p.shape, &fronts) <= 20.0 + 0.6, "lot too deep");
    }
}

/// Area-driven cuts (TODO « parcelles déséquilibrées »): on a curved and on
/// an oblique frontage, neighbouring lots of similar frontage keep similar
/// areas (no wedge of 10x its neighbour), and every lot keeps its frontage.
#[test]
fn cut_placement_balances_areas_on_curved_and_oblique_frontages() {
    let morph = Morph {
        value: json!({"plotOp":"burgage","streetOp":"organic","wideLotChance":0.0,"deepFill":true,
            "frontage":{"core":[6.0,9.0]},"plotDepth":{"core":[24.0,30.0]},"houseArea":{"core":[80.0,300.0]},
            "coverage":{"core":[0.85,0.9]}}),
    };
    let front = |a: Point, b: Point| Front {
        a,
        b,
        rank: 1,
        street: 0,
        shared: false,
        gate: false,
    };
    // Curved street on the outside of a 70 m arc: lots fan towards the centre.
    let (r, n) = (70.0, 24);
    let arc: Vec<Point> = (0..=n)
        .map(|i| {
            let a = std::f64::consts::PI * (0.2 + 0.6 * i as f64 / n as f64);
            Point {
                x: r * a.cos(),
                y: r * a.sin(),
            }
        })
        .collect();
    // Block: the arc (clockwise, street side) closed through the centre.
    let mut outer: Vec<Point> = arc.iter().rev().copied().collect();
    outer.push(Point { x: 0.0, y: 0.0 });
    let curved = Shape {
        outer,
        holes: vec![],
    };
    let curved = crate::urban::geometry::normalized(curved);
    // Oblique block: a parallelogram whose sides meet the street at 50 degrees.
    let oblique = crate::urban::geometry::normalized(Shape {
        outer: vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 90.0, y: 0.0 },
            Point { x: 120.0, y: 36.0 },
            Point { x: 30.0, y: 36.0 },
        ],
        holes: vec![],
    });
    for (name, shape) in [("curved", curved), ("oblique", oblique)] {
        // Street contacts follow the block ring orientation.
        let ring = &shape.outer;
        let fronts: Vec<Front> = (0..ring.len())
            .map(|i| (ring[i], ring[(i + 1) % ring.len()]))
            .filter(|(a, b)| {
                if name == "curved" {
                    length(*a) > 69.0 && length(*b) > 69.0
                } else {
                    a.y.abs() < 1e-9 && b.y.abs() < 1e-9
                }
            })
            .map(|(a, b)| front(a, b))
            .collect();
        let lots = strips(
            &shape,
            0,
            Point { x: 1.0, y: 0.0 },
            &fronts,
            &morph,
            "core",
            &mut Rng::new(name),
        );
        let plots: Vec<_> = lots.iter().filter(|p| p.use_kind == "plot").collect();
        assert!(plots.len() >= 6, "{name}: {} lots", plots.len());
        for (i, a) in plots.iter().enumerate() {
            let fa = frontage(&a.shape, &fronts).0;
            assert!(fa >= 3.0, "{name}: lot without frontage");
            for b in plots.iter().skip(i + 1) {
                if shared(&a.shape, &b.shape) < 1.0 {
                    continue;
                }
                let fb = frontage(&b.shape, &fronts).0;
                let (x, y) = (area(&a.shape), area(&b.shape));
                if fa.max(fb) / fa.min(fb) <= 1.5 {
                    assert!(
                        x.max(y) / x.min(y) < 2.0,
                        "{name}: areas {x:.0} / {y:.0}, fronts {fa:.1} / {fb:.1}"
                    );
                }
            }
        }
    }
}
