//! Footprint sizing, foundation placement and accessible growth.
use super::{
    area, budget, distance, epoch_densities, epoch_fractions, epoch_zone, family, generate,
    geography, orientation, planned, summit_access, template,
};
use crate::rng::Rng;
use crate::urban::{
    FootprintConfig, LayoutConfig, Morph, Point, Site, Street, Surface, UrbanCenter, composition,
    geometry as g, quarters, resolve, routing, site_options_tests,
};
use std::f64::consts::PI;

#[test]
fn v7_a_secondary_planned_core_takes_the_given_frame() {
    let n = 64; let height = vec![10.0; n * n]; let water = vec![0u8; n * n];
    let surface = Surface { geometry: None, width: 4000., n, height: &height, water: &water, interpolation: Default::default(),};
    let centers = vec![UrbanCenter { id: 0, point: Point { x: 1000., y: 1000. }, weight: 0.6 },
        UrbanCenter { id: 1, point: Point { x: 3000., y: 3000. }, weight: 0.4 }];
    let cfg = LayoutConfig { footprint: FootprintConfig { irregularity: 0.0, ..Default::default() }, ..Default::default() };
    let frame = |secondary: Option<f64>, c: Point| {
        let (_, phases) = planned(400_000., "rectangle", &cfg, &centers, PI / 4., secondary, &[1.0], surface, &Rng::new("v7"));
        quarters::outline_frame(phases[0].iter().find(|s| g::contains(s, c)).unwrap())
    };
    assert!((2. * frame(Some(0.0), centers[1].point)).sin().abs() < 0.05, "second core cardinal");
    assert!((2. * frame(Some(0.0), centers[0].point)).cos().abs() < 0.05, "first core keeps its turn");
    assert!((2. * frame(None, centers[1].point)).cos().abs() < 0.05, "off: second core follows the first");
}

#[test]
fn site_options_grid_outline_uses_the_grid_at_500_and_10000_and_keeps_water_out() {
    let height=vec![20.;128*128];
    let water=vec![0; height.len()];
    let surface=Surface{geometry:None,width:3000.,n:128,height:&height,water:&water, interpolation: Default::default(),};
    let mut cfg=LayoutConfig{fortification:"none".into(),regular_grid_outline:true,..Default::default()};
    cfg.footprint.budget="radius".into();
    cfg.footprint.epochs=1;
    let mut site=Site{key:"grid".into(),name:String::new(),culture:"bastide".into(),population:500,center:Point{x:1500.,y:1500.},radius:250., neighbours: Vec::new()};
    let morph=resolve("bastide","culture","auto","village",1.,&serde_json::json!({}),"quarters").unwrap();
    for (pop,radius) in [(500,150.),(10000,450.)] {
        site.population=pop;
        let off=LayoutConfig{regular_grid_outline:false,..cfg.clone()};
        let a=generate("grid-witness",&site,&off,&morph,surface,&[],radius);
        let b=generate("grid-witness",&site,&cfg,&morph,surface,&[],radius);
        assert_eq!(b.structure.family,"rectangle");
        assert!(b.structure.allocated.iter().flat_map(|s| s.outer.iter().zip(s.outer.iter().cycle().skip(1)).take(s.outer.len()))
            .all(|(a,b)| (a.x-b.x).abs()<1e-5 || (a.y-b.y).abs()<1e-5));
        assert!(area(&b.structure.allocated)>=b.structure.metrics.target_area*0.99);
        if let Ok(out)=std::env::var("SITE_OPTS_WITNESSES") {
            site_options_tests::svg(&out,&format!("bastide-{pop}-off"),&a.guides,&a.structure.allocated,3000.);
            site_options_tests::svg(&out,&format!("bastide-{pop}-on"),&b.guides,&b.structure.allocated,3000.);
        }
    }
    // With no regional road, the armature must use the outline's angle,
    // rather than its independent random bearing. All components share it.
    cfg.footprint.orientation=23.;
    let plan=composition::generate("rotated-grid",&site,&cfg,surface,&[],450.).unwrap();
    let angle=orientation(&site,&cfg,surface,&[]);
    let major:Vec<_>=plan.plan.streets.iter().filter(|s|s.rank<=1).flat_map(|s|s.path.windows(2))
        .filter(|w|distance(w[0],w[1])>20.).collect();
    assert!(!major.is_empty());
    assert!(major.iter().all(|w| (((w[1].y-w[0].y).atan2(w[1].x-w[0].x)-angle)*4.).cos()>0.999));
    cfg.footprint.orientation=0.;
    // An explicit artistic form still wins, and organic cultures keep their form.
    cfg.footprint.family="circle".into();
    assert_eq!(family(&site,&cfg,geography(&site,&cfg,surface,250.),250.),"circle");
    cfg.footprint.family="auto".into();site.culture="european-organic".into();
    assert_ne!(family(&site,&cfg,geography(&site,&cfg,surface,250.),250.),"rectangle");
    site.culture="bastide".into();
    let mut water=water.clone();
    for y in 0..128 {for x in 65..128 {water[y*128+x]=1;}}
    let surface=Surface{water:&water,..surface};
    let result=generate("coastal-grid",&site,&cfg,&morph,surface,&[],450.);
    assert!(result.structure.allocated.iter().all(|s| !surface.wet(g::interior_point(s))));
}

#[test]
fn site_options_hill_uses_a_reachable_summit_and_a_grade_limited_switchback() {
    let n=128;
    let height:Vec<f32>=(0..n*n).map(|i| {
        let x=(i%n) as f64*1000./n as f64+500./n as f64;
        let y=(i/n) as f64*1000./n as f64+500./n as f64;
        (100.+45.*(-((x-600.).powi(2)+(y-500.).powi(2))/(2.*140_f64.powi(2))).exp()) as f32
    }).collect();
    let water=vec![0; height.len()];
    let surface=Surface{geometry:None,width:1000.,n,height:&height,water:&water, interpolation: Default::default(),};
    let site=Site{key:"hill".into(),name:String::new(),culture:"european-organic".into(),population:3000,center:Point{x:480.,y:500.},radius:300., neighbours: Vec::new()};
    let cfg=LayoutConfig{power_high_ground:true,site_archetype:"hilltop".into(),..Default::default()};
    let roads=vec![Street{path:vec![Point{x:350.,y:250.},Point{x:350.,y:750.}],widths:vec![5.;2],rank:1,role:"regional".into()}];
    assert!(summit_access(&site,&LayoutConfig{power_high_ground:false,..cfg.clone()},surface,&roads,300.).is_none());
    let (summit,route)=summit_access(&site,&cfg,surface,&roads,300.).expect("reachable hilltop");
    let route=route.expect("summit approach");
    assert!(distance(summit,Point{x:600.,y:500.})<12.,"{summit:?}");
    assert!(surface.height_at(summit)>surface.height_at(site.center)+10.);
    assert!(routing::path_clear(surface,&route.path,cfg.max_street_grade));
    let length:f64=route.path.windows(2).map(|w|distance(w[0],w[1])).sum();
    assert!(length>distance(route.path[0],summit)*1.15,"{length}: {:?}",route.path);
    if let Ok(out)=std::env::var("SITE_OPTS_WITNESSES") {
        let contours:Vec<_>=[70.,140.,210.,280.].into_iter().map(|r| template(Point{x:600.,y:500.},"circle",r,1.,0.,0.,0.)).collect();
        site_options_tests::svg(&out,"hill-off",&roads,&contours,1000.);
        site_options_tests::svg(&out,"hill-on",&[roads,vec![route]].concat(),&contours,1000.);
    }
}

fn input() -> (Site, Morph) {
    (
        Site {
            key: "footprint".into(),
            name: String::new(),
            population: 1000,
            culture: "european-organic".into(),
            center: Point {
                x: 1500.0,
                y: 1500.0,
            },
            radius: 250.0,
            neighbours: Vec::new(),
        },
        resolve(
            "european-organic",
            "culture",
            "core",
            "core",
            1.0,
            &serde_json::json!({}),
            "quarters",
        )
        .unwrap(),
    )
}
#[test]
fn automatic_population_budget_follows_catalogue_cadence_without_overriding_manual_or_radius() {
    let (mut site, morph) = input();
    site.population = 50_000;
    let mut cfg = LayoutConfig::default();
    let (target, density) = budget(&site, &cfg, &morph, 250.0);
    let densities = epoch_densities(&site, &cfg, &morph);
    // Core denser than its periphery, and a larger city has a denser core.
    assert!(densities.windows(2).all(|d| d[0] > d[1]), "{densities:?}");
    site.population = 5_000;
    assert!(epoch_densities(&site, &cfg, &morph)[0] < densities[0]);
    site.population = 50_000;
    assert!(density > 100.0 && density < densities[0]);
    assert!((target - site.population as f64 / density * 10_000.0).abs() < 1e-5);
    let fractions = epoch_fractions(&densities);
    assert!(fractions[0] < 1.0 / 3.0 && (fractions[2] - 1.0).abs() < 1e-9);
    cfg.footprint.gross_density = 185.0;
    let explicit = budget(&site, &cfg, &morph, 250.0);
    assert_eq!(explicit.1, 185.0);
    assert!((explicit.0 - 50_000.0 / 185.0 * 10_000.0).abs() < 1e-6);
    cfg.footprint.budget = "radius".into();
    let manual_radius = budget(&site, &cfg, &morph, 250.0);
    cfg.footprint.gross_density = 0.0;
    assert_eq!(manual_radius, budget(&site, &cfg, &morph, 250.0));
    assert_eq!(manual_radius.0, PI * 250.0 * 250.0);
}
/// A modern town grows a ring of detached houses (its faubourg tissue in
/// the edge zone) around its core; a style that densifies keeps its rings.
#[test]
fn a_suburb_ring_style_builds_its_outer_epoch_with_its_faubourg_tissue() {
    let cfg = LayoutConfig::default();
    assert_eq!(epoch_zone(&cfg, "cyberpunk", 25_000, 0), ("core", "core"));
    assert_eq!(epoch_zone(&cfg, "cyberpunk", 25_000, 1), ("middle", "ring"));
    assert_eq!(epoch_zone(&cfg, "cyberpunk", 25_000, 2), ("edge", "faubourg"));
    assert_eq!(epoch_zone(&cfg, "corporate-arcology", 25_000, 2), ("edge", "ring"));
    assert_eq!(epoch_zone(&cfg, "european-organic", 25_000, 2), ("edge", "ring"));
}
#[test]
fn porous_growth_is_seeded_and_keeps_a_measured_population_budget() {
    let (site, morph) = input();
    let height = vec![100.0; 128 * 128];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let mut cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "dendritic".into(),
            gross_density: 70.0,
            cohesion: 0.6,
            satellites: 0.7,
            branch_depth: 0.6,
            gap_size: 100.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let grown = generate(
        "porous-regression-2026-10-20",
        &site,
        &cfg,
        &morph,
        surface,
        &[],
        250.0,
    );
    let replay = generate(
        "porous-regression-2026-10-20",
        &site,
        &cfg,
        &morph,
        surface,
        &[],
        250.0,
    );
    assert_eq!(
        serde_json::to_string(&(&grown.structure, &grown.links)).unwrap(),
        serde_json::to_string(&(&replay.structure, &replay.links)).unwrap()
    );
    assert!(grown.structure.metrics.allocated_area > grown.structure.metrics.target_area * 0.9);
    assert!(
        grown.structure.metrics.allocated_area < grown.structure.metrics.target_area * 1.02
    );
    assert!(grown.structure.centers.iter().all(|c| {
        grown
            .structure
            .allocated
            .iter()
            .any(|s| g::contains(s, c.point))
    }));
    assert!(grown.links.iter().all(|s| routing::path_clear(
        surface,
        &s.path,
        if s.role == "stairs" {
            cfg.max_stair_grade
        } else {
            cfg.max_lane_grade
        }
    )));
    cfg.footprint.cohesion = 1.0;
    cfg.footprint.satellites = 0.0;
    cfg.footprint.branch_depth = 0.0;
    let compact = generate(
        "porous-regression-2026-10-20",
        &site,
        &cfg,
        &morph,
        surface,
        &[],
        250.0,
    );
    let overlap: f64 = grown
        .structure
        .allocated
        .iter()
        .flat_map(|a| {
            compact
                .structure
                .allocated
                .iter()
                .flat_map(move |b| g::intersection(a, b))
        })
        .map(|s| g::area(&s))
        .sum();
    assert!(overlap < grown.structure.metrics.allocated_area * 0.95);
}

#[test]
fn population_budget_and_chronology_are_replayable_without_overlap() {
    let (site, morph) = input();
    let h = vec![0.0; 128 * 128];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "rectangle".into(),
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let a = generate("footprint", &site, &cfg, &morph, surface, &[], 250.0);
    let b = generate("footprint", &site, &cfg, &morph, surface, &[], 900.0);
    assert_eq!(
        serde_json::to_string(&a.structure).unwrap(),
        serde_json::to_string(&b.structure).unwrap()
    );
    assert!((a.structure.metrics.target_area - 200_000.0).abs() < 0.01);
    let mut artistic_scale = cfg.clone();
    artistic_scale.radius_scale = 4.0;
    let unchanged_budget = generate(
        "footprint",
        &site,
        &artistic_scale,
        &morph,
        surface,
        &[],
        250.0,
    );
    assert_eq!(
        serde_json::to_string(&a.structure).unwrap(),
        serde_json::to_string(&unchanged_budget.structure).unwrap()
    );
    assert!((a.structure.metrics.allocated_area - 200_000.0).abs() < 50.0);
    for (i, phase) in a.phases.iter().enumerate() {
        for later in &a.phases[i + 1..] {
            for p in phase {
                for q in later {
                    assert!(area(&g::intersection(p, q)) < 0.01);
                }
            }
        }
    }
}
#[test]
fn archipelago_retains_separate_nuclei_and_water_holes() {
    let (site, morph) = input();
    let h = vec![0.0; 128 * 128];
    let mut w = vec![0; h.len()];
    for y in 61..66 {
        for x in 61..66 {
            w[y * 128 + x] = 1;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "archipelago".into(),
            mechanism: "planned".into(),
            separation: 2.3,
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let a = generate("archipelago", &site, &cfg, &morph, surface, &[], 250.0);
    assert_eq!(a.structure.centers.len(), 3);
    assert!(a.structure.allocated.len() >= 3);
    assert!(a.structure.allocated.iter().any(|s| !s.holes.is_empty()));
    assert!(
        !a.structure
            .allocated
            .iter()
            .any(|s| g::contains(s, site.center))
    );
}
#[test]
fn accessible_growth_does_not_cross_an_unbridged_river() {
    let (mut site, morph) = input();
    site.center.x = 1350.0;
    let h = vec![0.0; 128 * 128];
    let mut w = vec![0; h.len()];
    for y in 0..128 {
        for x in 62..65 {
            w[y * 128 + x] = 1;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "compact".into(),
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let a = generate("river", &site, &cfg, &morph, surface, &[], 250.0);
    assert!(
        a.structure
            .allocated
            .iter()
            .flat_map(|s| &s.outer)
            .all(|p| p.x <= 62.0 / 128.0 * 3000.0 + 1e-7)
    );
    assert!(
        (a.structure.metrics.allocated_area - a.structure.metrics.target_area).abs() < 2000.0
    );
}

#[test]
fn accessible_growth_spans_a_river_through_an_existing_bridge() {
    let (mut site, morph) = input();
    site.center.x = 1350.0;
    site.population = 6000;
    let h = vec![0.0; 128 * 128];
    let mut w = vec![0; h.len()];
    for y in 0..128 {
        for x in 62..65 {
            w[y * 128 + x] = 1;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let (west, east) = (62.0 / 128.0 * 3000.0, 65.0 / 128.0 * 3000.0);
    let road = |a: f64, b: f64, role: &str| Street {
        path: vec![Point { x: a, y: 1500.0 }, Point { x: b, y: 1500.0 }],
        widths: vec![8.0, 8.0],
        rank: 1,
        role: role.into(),
    };
    let roads = [
        road(200.0, west - 10.0, "regional"),
        road(west - 10.0, east + 10.0, "bridge"),
        road(east + 10.0, 2800.0, "regional"),
    ];
    // Compact growth, then the bench default where porous dispersion
    // keeps only the patches it can serve.
    for cohesion in [1.0, 0.85] {
        let cfg = LayoutConfig {
            footprint: FootprintConfig {
                family: "compact".into(),
                gross_density: 50.0,
                cohesion,
                ..FootprintConfig::default()
            },
            ..LayoutConfig::default()
        };
        let a = generate("river", &site, &cfg, &morph, surface, &roads, 250.0);
        let side = |east_bank: bool| {
            a.structure
                .allocated
                .iter()
                .filter(|s| (g::centroid(s).x > east) == east_bank)
                .map(g::area)
                .sum::<f64>()
        };
        let target = a.structure.metrics.target_area;
        assert!(
            side(true) > target * 0.15,
            "east bank {:.0} m² of {target:.0}",
            side(true)
        );
        assert!(side(false) > target * 0.15);
        // Water is never allocated; only the bridge joins the banks.
        for s in &a.structure.allocated {
            assert!(
                s.outer
                    .iter()
                    .all(|p| p.x <= west + 1e-6 || p.x >= east - 1e-6)
            );
        }
        assert!(a.structure.centers.iter().any(|c| c.point.x > east));
        assert!((a.structure.metrics.allocated_area - target).abs() < target * 0.05);
    }
}

#[test]
fn town_builds_its_own_bridge_over_a_stream_but_not_over_a_wide_river() {
    // 5 m cells; a 15 m stream, then a 200 m river, east of a 5 000-inhabitant
    // town, with no regional crossing at all.
    let (mut site, morph) = input();
    site.center.x = 1350.0;
    site.population = 5000;
    let n = 600;
    let h = vec![0.0; n * n];
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "compact".into(),
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    for (cells, crossed) in [(3, true), (40, false)] {
        let mut w = vec![0; h.len()];
        for y in 0..n {
            for x in 300..300 + cells {
                w[y * n + x] = 3;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 3000.0,
            n,
            height: &h,
            water: &w,
            interpolation: Default::default(),
        };
        let (west, east) = (1500.0, 1500.0 + cells as f64 * 5.0);
        let a = generate("stream", &site, &cfg, &morph, surface, &[], 250.0);
        let target = a.structure.metrics.target_area;
        let east_bank: f64 = a
            .structure
            .allocated
            .iter()
            .filter(|s| g::centroid(s).x > east)
            .map(g::area)
            .sum();
        let bridges: Vec<_> = a.links.iter().filter(|s| s.role == "bridge").collect();
        for s in &a.structure.allocated {
            assert!(
                s.outer
                    .iter()
                    .all(|p| p.x <= west + 1e-6 || p.x >= east - 1e-6)
            );
        }
        if crossed {
            assert!(
                east_bank > target * 0.15,
                "east bank {east_bank:.0} of {target:.0} m²"
            );
            assert!(!bridges.is_empty(), "no urban bridge over the stream");
            for b in &bridges {
                let (p, q) = (b.path[0], *b.path.last().unwrap());
                // Abutment to abutment across the water, about perpendicular.
                assert!(p.x.min(q.x) < west && p.x.max(q.x) > east);
                assert!((p.y - q.y).abs() < (p.x - q.x).abs() * 0.6);
                assert!(b.widths.iter().all(|&w| w >= 3.0));
            }
            assert!((a.structure.metrics.allocated_area - target).abs() < target * 0.05);
        } else {
            assert!(
                east_bank == 0.0 && bridges.is_empty(),
                "{east_bank:.0} m² beyond 200 m of water"
            );
        }
    }
}

#[test]
fn finger_and_dendritic_families_have_distinct_geography_without_imported_roads() {
    let (site, morph) = input();
    let h = vec![0.0; 128 * 128];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let mut cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "fingers".into(),
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let fingers = generate("families", &site, &cfg, &morph, surface, &[], 250.0);
    cfg.footprint.family = "dendritic".into();
    let dendritic = generate("families", &site, &cfg, &morph, surface, &[], 250.0);
    let overlap: f64 = fingers
        .structure
        .allocated
        .iter()
        .flat_map(|a| {
            dendritic
                .structure
                .allocated
                .iter()
                .flat_map(move |b| g::intersection(a, b))
        })
        .map(|s| g::area(&s))
        .sum();
    // Compare geometry only: changing a family string cannot satisfy this.
    assert!(overlap < fingers.structure.metrics.allocated_area * 0.98);
    assert_eq!(fingers.guides.len(), 5);
    assert_eq!(dendritic.guides.len(), 7);
}

#[test]
fn disconnected_nuclei_do_not_report_an_absorption_event() {
    let (site, morph) = input();
    let h = vec![0.0; 128 * 128];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 3000.0,
        n: 128,
        height: &h,
        water: &w,
        interpolation: Default::default(),
    };
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            family: "archipelago".into(),
            separation: 2.3,
            gross_density: 50.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let a = generate("history", &site, &cfg, &morph, surface, &[], 250.0);
    assert!(a.structure.allocated.len() >= 3);
    assert!(
        a.structure
            .history
            .iter()
            .all(|e| e.kind != "nucleus-merger")
    );
}
