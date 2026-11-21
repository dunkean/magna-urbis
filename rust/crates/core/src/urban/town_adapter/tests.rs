use magna_urbis_town::{
    TownPlan,
    export::{DatedPhase, QuarterPlan},
    graph::{Clock, EdgeClass, EdgeSpec, FaceKind, Key, Level, NodeKind, Station},
    growth::{Capacity, CapacityBlock, CapacityInputs},
    journal::{Anchor, EventKind, Op, Writer},
};

use super::super::{Layout, LayoutConfig, ParcelConfig, Point, Site, Surface, parcels, resolve};
use super::{capacity::QuarterCapacity, layout};

const CULTURE: &str = "european-organic";

fn cross() -> Layout {
    use EdgeClass::{Boundary, Street};

    let points = [
        Point { x: 100.0, y: 100.0 },
        Point { x: 300.0, y: 100.0 },
        Point { x: 500.0, y: 100.0 },
        Point { x: 300.0, y: 50.0 },
        Point { x: 300.0, y: 280.0 },
        Point { x: 100.0, y: 280.0 },
        Point { x: 500.0, y: 280.0 },
    ];
    let focus = points[1];
    let nodes: Vec<_> = (0..points.len()).map(|i| Key::node(&[i as u32])).collect();
    let mut ops: Vec<_> = points
        .iter()
        .zip(&nodes)
        .map(|(&position, key)| Op::AddNode {
            key: key.clone(),
            level: Level::Ground,
            position,
            kind: NodeKind::Junction,
        })
        .collect();
    let found = EventKind::Found {
        center: focus,
        focus: "road-crossing".into(),
    };
    for (i, (a, b, class)) in [
        (0, 1, Street),
        (1, 2, Street),
        (3, 1, Street),
        (1, 4, Street),
        (4, 5, Boundary),
        (5, 0, Boundary),
        (2, 6, Boundary),
        (6, 4, Boundary),
    ]
    .into_iter()
    .enumerate()
    {
        let key = Key::edge(&found.key(), i as u32);
        let width = if class == Boundary { 0.0 } else { 8.0 };
        let mut spec = EdgeSpec::new(key, Level::Ground, class, vec![points[a], points[b]], width);
        if i < 4 {
            spec.chain = Some(Key::edge(&found.key(), (i / 2) as u32));
            spec.rank = 1;
        }
        let ends = [a, b].map(|j| Anchor::Node {
            node: nodes[j].clone(),
        });
        ops.push(Op::InsertEdge { spec, ends });
    }
    let mut writer = Writer::new(40.0);
    writer.apply(Clock::ZERO, found, ops).unwrap();
    let faces: Vec<_> = writer
        .graph()
        .live_faces()
        .filter(|&id| writer.graph().face(id).outer.is_some())
        .collect();
    let station = Station {
        host: nodes[1].clone(),
        arm: 0,
    };
    let quarter_key = Key::quarter(0, &station);
    let ops = faces
        .iter()
        .map(|&id| Op::SetFaceKind {
            face: writer.graph().face(id).key.clone(),
            kind: FaceKind::Block,
        })
        .collect();
    writer
        .apply(
            Clock::ZERO,
            EventKind::OpenQuarter {
                ring: 0,
                station,
                tissue: "organic".into(),
                outline: vec![],
            },
            ops,
        )
        .unwrap();
    let site = Site {
        key: "cross".into(),
        name: "Cross".into(),
        population: 1000,
        culture: CULTURE.into(),
        center: focus,
        radius: 300.0,
        neighbours: vec![],
    };
    layout::build(
        &TownPlan {
            graph: writer.into_graph(),
            clock: Clock::ZERO,
            center: focus,
            focus,
            phases: vec![DatedPhase {
                born: Clock::ZERO,
                kind: "village".into(),
                zone: "core".into(),
                recipe: "core".into(),
                population: 1000.0,
                target_area: 72_000.0,
            }],
            quarters: vec![QuarterPlan {
                key: quarter_key,
                phase: 0,
                tissue: "organic".into(),
                faces,
                fill_level: 1.0,
                population: 1000.0,
                aged: None,
            }],
            regional_road_result: None,
            walls: vec![],
            quays: vec![],
            port_quarters: vec![],
            fords: vec![],
            bailey: None,
            warnings: vec![],
            stop: Default::default(),
        },
        &site,
        &LayoutConfig::default(),
        CULTURE,
    )
    .unwrap()
}

#[test]
fn cross_exports_two_blocks_with_classic_parcel_frontage() {
    let layout = cross();
    assert_eq!(layout.blocks.len(), 2);
    // The four arms of the cross; the boundary edges that face open land are no streets.
    assert_eq!(layout.streets.len(), 4);
    assert_eq!(layout.quarters.len(), 1);
    assert!(layout.quarters[0].key.is_some());
    assert!(
        layout
            .blocks
            .iter()
            .all(|b| b.key.is_some() && b.quarter == 0)
    );
    assert!(
        layout
            .streets
            .iter()
            .all(|s| s.key.is_some() && s.widths == [8.0, 8.0])
    );

    let cfg = ParcelConfig::default();
    let morph = resolve(
        CULTURE,
        &cfg.preset,
        "core",
        "core",
        cfg.density,
        &cfg.params,
        "parcels",
    )
    .unwrap();
    let cut = parcels::generate_probe("cross", &layout, &cfg, &morph).unwrap();
    for block in 0..2 {
        assert!(cut.parcels.iter().any(|p| {
            p.block == block && p.access.as_ref().is_some_and(|a| a.street.is_some())
        }));
    }
}

#[test]
fn capacity_counts_households_on_one_quarters_frontages() {
    let layout = cross();
    let blocks: Vec<_> = layout
        .blocks
        .iter()
        .map(|b| CapacityBlock {
            outline: b.shape.clone(),
            frontage_edges: parcels::block_contacts(&b.shape, &layout)
                .into_iter()
                .map(|c| [c.a, c.b])
                .collect(),
        })
        .collect();
    let capacity = QuarterCapacity {
        seed: "cross",
        site_key: "cross",
        culture: CULTURE,
        config: layout.config.as_ref().unwrap(),
        surface: Surface {
            geometry: None,
            width: 600.0,
            n: 2,
            height: &[0.0; 4],
            water: &[0; 4],
            interpolation: Default::default(),
        },
    };
    let inputs = CapacityInputs {
        pressure: 0.6,
        recipe: "core",
        zone: "core",
        density: 1.0,
        intramural: false,
        fill_level: 1.0,
    };
    let full = capacity.households(&blocks, inputs);
    let half = capacity.households(
        &blocks,
        CapacityInputs {
            fill_level: 0.5,
            ..inputs
        },
    );
    assert!(half > 0.0 && half < full);
}
