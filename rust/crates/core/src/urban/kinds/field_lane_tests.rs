use super::*;

#[test]
fn street_village_lanes_vary_without_losing_the_spine_or_field_access() {
    let p = |x, y| Point { x, y };
    let n = 128;
    let height = vec![0.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None, width: 2000.0, n, height: &height, water: &water,
        interpolation: Default::default(),
    };
    let roads = vec![street(vec![p(100.0, 990.0), p(1000.0, 1010.0), p(1900.0, 980.0)], 6.0, 0, "regional")];
    let inherited = roads[0].path.clone();
    let site = Site {
        key: "field-lanes".into(), name: String::new(), population: 500,
        culture: "hanseatic".into(), center: p(1000.0, 1000.0), radius: 100.0,
        neighbours: Vec::new(),
    };
    let near = nearest(site.center, &roads, 600.0);
    let morph = Morph { value: serde_json::json!({
        "plotDepth": {"village": [40.0, 60.0]},
        "frontage": {"village": [12.0, 16.0]},
    }) };
    for strength in [0.0, 1.0] {
        let cfg = LayoutConfig {
            road_width_by_size: false, organic_branch_variation: strength,
            ribbon_width_variation: strength, ..LayoutConfig::default()
        };
        let build = |seed| linear(
            &site, &cfg, Kind::StreetVillage, &morph, &near, &[], &|_| 3.05,
            &roads, surface, &mut Rng::new(seed), 1.0,
        ).unwrap();
        let plan = build("field-lanes");
        let paths = |plan: &Plan| plan.streets.iter().map(|s| s.path.clone()).collect::<Vec<_>>();
        assert_eq!(paths(&plan), paths(&build("field-lanes")), "seed replay");
        assert_ne!(paths(&plan), paths(&build("other-field-lanes")), "seed variation");
        assert!(plan.streets.len() >= 6, "both sides keep field access");
        let mut angles = vec![];
        for lane in &plan.streets {
            // One broad bend (five points), cut where its last plot ends.
            assert!((2..=5).contains(&lane.path.len()), "one broad bend with bounded work");
            assert_eq!(lane.widths.len(), lane.path.len());
            // It ends square at the far edge of its last plot, never beyond.
            let length = *arc(&lane.path).last().unwrap();
            let served = street_village::served_reach(&lane.path, lane.widths[0] * 0.5 + 3.0, &plan.blocks)
                .expect("a lane serves a plot");
            assert!(length - served <= 1.0, "lane runs {:.1} m past its last plot", length - served);
            assert!(routing::path_clear(surface, &lane.path, cfg.max_lane_grade));
            let (a, b) = (lane.path[0], *lane.path.last().unwrap());
            let (_, segment) = roads[0].path.windows(2)
                .map(|w| (g::distance(a, w[0], w[1]).0, w))
                .min_by(|a, b| a.0.total_cmp(&b.0)).unwrap();
            assert!(g::distance(a, segment[0], segment[1]).0 < 1e-6, "junction stays on spine");
            let d = unit(segment[0], segment[1]);
            let outward = perp(d);
            let across = ((b.x - a.x) * outward.x + (b.y - a.y) * outward.y).abs();
            // Field access: the lane reaches the back of the plot strip.
            assert!(across > 3.05 + 60.0 * 0.6, "lane reaches the fields behind the plots");
            if lane.path.len() >= 3 {
                let bend = g::distance(lane.path[2], a, b).0;
                assert!(bend < 5.1, "gentle bend: {bend}");
            }
            angles.push(((b.x - a.x) * d.x + (b.y - a.y) * d.y) / across);
            // Parcels are cut by the actual curved ribbon, not its chord.
            for ribbon in g::ribbon(&lane.path, &lane.widths) {
                for (shape, _) in plan.blocks.iter().filter(|(_, kind)| *kind == "block") {
                    let overlap: f64 = g::intersection(shape, &ribbon).iter().map(g::area).sum();
                    assert!(overlap < 0.01, "lane overlaps a plot by {overlap} m2");
                }
            }
        }
        angles.sort_by(f64::total_cmp);
        assert!(angles.last().unwrap() - angles[0] > 0.03, "unequal angles");
    }
    assert_eq!(roads[0].path, inherited);

    // A low ridge on the right must win over the seed's preferred bend.
    let height: Vec<f32> = (0..n * n).map(|i| {
        let x = (i % n) as f64 * 4.0 + 2.0;
        ((x - 256.0).max(0.0) * 0.2) as f32
    }).collect();
    let terrain = Surface { width: 512.0, height: &height, ..surface };
    let path = field_lane(terrain, p(256.0, 400.0), p(256.0, 480.0), -4.0, 0.12).unwrap();
    assert!(path[2].x < 256.0, "bend follows the lower terrain cost");
    assert!(routing::path_clear(terrain, &path, 0.12));
    let flooded = vec![1; n * n];
    assert!(field_lane(Surface { water: &flooded, ..surface }, p(500.0, 400.0), p(500.0, 480.0), 4.0, 0.12).is_none());
}
