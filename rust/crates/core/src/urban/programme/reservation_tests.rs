//! Demand preparation, service siting and whole-block reservations.

use crate::urban::{Layout, Point, Shape, Surface, geometry::{area, centroid, rectangle}};
use serde_json::json;
use std::collections::BTreeSet;

use super::{BuiltOpenSpace, BuiltScene, ProgrammeContext, Reservation, UrbanProgramme, allocate, has_envelope,
    prepare, reallocate, reconcile_built};
use super::admission::{eligible, public_open_access};
use super::environment::block_is_wet;
use super::test_fixtures::{context_for, layout, partition, prepare_case};

/// Uses the same continuous metric contacts as cadastral qualification.
fn block_front(layout: &Layout, shape: &Shape) -> Option<(usize, f64)> {
    crate::urban::parcels::block_contacts(shape, layout)
        .into_iter()
        .max_by(|a, b| {
            a.length
                .total_cmp(&b.length)
                .then_with(|| b.street.cmp(&a.street))
        })
        .map(|c| (c.street, c.length))
}

#[test]
fn shoreline_roundoff_is_not_an_inundated_service_block() {
    let geography = super::super::Geography::new(
        super::super::VectorGeography {
            springs: vec![],
            land: vec![rectangle(0., 0., 100., 100.).outer],
            water: vec![],
        },
        256.,
    )
    .unwrap();
    let height = vec![0.; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: Some(&geography),
        width: 256.,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let coastal = rectangle(90., 20., 100.0000032, 60.);
    assert!(coastal.outer.iter().any(|&p| surface.wet(p)));
    assert!(!block_is_wet(surface, &coastal, centroid(&coastal)));
    // A real 2 cm intrusion is larger than numerical boundary tolerance.
    let submerged_edge = rectangle(90., 20., 100.02, 60.);
    assert!(block_is_wet(
        surface,
        &submerged_edge,
        centroid(&submerged_edge)
    ));
    let spike = Shape {
        outer: vec![
            Point { x: 90., y: 20. },
            Point { x: 100., y: 20. },
            Point { x: 100., y: 39.999 },
            Point { x: 100.02, y: 40. },
            Point { x: 100., y: 40.001 },
            Point { x: 100., y: 60. },
            Point { x: 90., y: 60. },
        ],
        holes: vec![],
    };
    assert!(block_is_wet(surface, &spike, centroid(&spike)));
    let submerged = rectangle(101., 20., 110., 60.);
    assert!(block_is_wet(surface, &submerged, centroid(&submerged)));
}

/// A facility block is reserved only where its
/// pinned native recipe can be founded at a street pose.
#[test]
fn facilities_reserve_only_blocks_that_found_their_recipe() {
    let run = |grade: f32| {
        let blocks: Vec<_> = (0..4)
            .map(|i| {
                let x = 20.0 + 110.0 * f64::from(i);
                json!({"shape":rectangle(x,110.0,x+100.0,190.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}})
            })
            .collect();
        let mut l: Layout = serde_json::from_value(json!({"key":"forum","culture":"roman-core",
            "center":{"x":240.0,"y":150.0},"quarters":[],"blocks":blocks,
            "streets":[{"path":[{"x":10.0,"y":105.0},{"x":470.0,"y":105.0}],"widths":[10.0,10.0],"rank":1,"role":"street"},
                {"path":[{"x":10.0,"y":195.0},{"x":470.0,"y":195.0}],"widths":[10.0,10.0],"rank":2,"role":"street"}],
            "warnings":[]}))
        .unwrap();
        // A plane rising away from the street: `grade` m per m.
        let height: Vec<f32> = (0..128 * 128)
            .map(|i| grade * ((i / 128) as f32 + 0.5) * 4.0)
            .collect();
        let water = vec![0; 128 * 128];
        prepare(
            &mut l,
            5000,
            &ProgrammeContext::default(),
            Surface {
                geometry: None,
                width: 512.0,
                n: 128,
                height: &height,
                water: &water,
                interpolation: Default::default(),
            },
        )
        .unwrap();
        l
    };
    let built = |l: &Layout| {
        let pr = l.programme.as_ref().unwrap();
        pr.reservations
            .iter()
            .filter(|r| {
                pr.demands.iter().any(|d| {
                    d.id == r.demand_id
                        && matches!(d.function.as_str(), "collective" | "warehouse")
                })
            })
            .map(|r| (r.block, area(&r.shape)))
            .collect::<Vec<_>>()
    };
    let level = run(0.0);
    assert!(!built(&level).is_empty());
    // 6 % everywhere: no Roman court building (26 m) founds within 0.75 m.
    let steep = run(0.06);
    assert!(built(&steep).is_empty(), "{:?}", built(&steep));
}

#[test]
fn existing_market_place_precedes_reserving_an_ordinary_housing_block() {
    let mut l = layout("bastide");
    l.blocks[1].kind = "place".into();
    let height = vec![0.0; 1024];
    let water = vec![0; 1024];
    prepare(
        &mut l,
        600,
        &ProgrammeContext::default(),
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    let market = l
        .programme
        .as_ref()
        .unwrap()
        .demands
        .iter()
        .find(|d| d.function == "market")
        .unwrap();
    let reservation = l
        .programme
        .as_ref()
        .unwrap()
        .reservations
        .iter()
        .find(|r| r.demand_id == market.id)
        .unwrap();
    assert_eq!(reservation.block, 1);
    assert_eq!(l.blocks[1].kind, "place");
    assert_eq!(l.blocks.iter().filter(|b| b.kind == "block").count(), 1);
    let p = partition(&l).parcels.remove(1);
    assert!(eligible(&l, &p, market, l.programme.as_ref().unwrap()));
}
#[test]
fn reserved_market_precedes_an_admissible_housing_frontage_at_allocation() {
    let mut l = layout("bastide");
    l.blocks[1].kind = "market".into();
    let height = vec![0.0; 1024];
    let water = vec![0; 1024];
    prepare(
        &mut l,
        600,
        &ProgrammeContext::default(),
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    let result = super::super::generate_parcels(
        "market-reservation-priority",
        &[l],
        &Default::default(),
    )
    .unwrap();
    let p = &result[0];
    let pr = p.programme.as_ref().unwrap();
    let market = pr
        .allocations
        .iter()
        .filter(|a| a.function == "market")
        .collect::<Vec<_>>();
    assert_eq!(market.len(), 1);
    let reserved = p
        .parcels
        .iter()
        .find(|p| p.id == market[0].parcel_id)
        .unwrap();
    assert_eq!(reserved.block, 1);
    assert_eq!(reserved.access.as_ref().unwrap().kind, "reserved");
    assert!(public_open_access(reserved, 0.8));
    assert!(
        pr.allocations
            .iter()
            .filter(|a| a.function == "domestic" || a.function == "mixed")
            .any(|a| {
                p.parcels
                    .iter()
                    .any(|p| p.id == a.parcel_id && p.block != 1)
            })
    );
}
#[test]
fn an_isolated_site_has_one_intent_and_one_unsubdivided_accessible_domain() {
    for (role, function) in [
        ("isolated-farm", "domestic"),
        ("roadside-temple", "collective"),
    ] {
        let mut l = layout("european-organic");
        let height = vec![0.0; 1024];
        let water = vec![0; 1024];
        prepare(
            &mut l,
            50_000,
            &ProgrammeContext {
                resources: vec!["timber".into()],
                lore: vec!["temple".into()],
                ..context_for(role)
            },
            Surface {
                geometry: None,
                width: 1000.0,
                n: 32,
                height: &height,
                water: &water,
                interpolation: Default::default(),
            },
        )
        .unwrap();
        let pr = l.programme.as_ref().unwrap();
        assert_eq!(pr.population, 50_000);
        assert_eq!(pr.demands.len(), 1);
        assert_eq!(pr.demands[0].function, function);
        assert_eq!(pr.reservations.len(), 1);
        if role == "isolated-farm" {
            assert_eq!(pr.demands[0].requested, 1.0);
        }
        let mut p = partition(&l);
        allocate(&l, &mut p);
        let pr = p.programme.unwrap();
        assert_eq!(pr.allocations.len(), 1);
        assert_eq!(pr.allocations[0].function, function);
        assert_eq!(
            pr.allocations[0].parcel_id,
            format!("lot/{}", pr.reservations[0].block)
        );
        assert_eq!(pr.demands[0].built_capacity, 0.0);
    }
}
#[test]
fn metropolitan_collective_reservations_use_several_real_blocks_not_a_population_sized_sliver_test()
 {
    let mut l = layout("european-organic");
    let height = vec![0.0; 1024];
    let water = vec![0; 1024];
    // Every block is smaller than 35% of the collective demand. Enough
    // ordinary accessible land nevertheless exists for several real sites.
    let original = l.blocks[0].clone();
    l.blocks = (0..20)
        .map(|i| {
            let mut b = original.clone();
            b.kind = "block".into();
            b.shape = rectangle(
                110.0 + i as f64 * 20.0,
                110.0,
                130.0 + i as f64 * 20.0,
                140.0,
            );
            b
        })
        .collect();
    l.streets[0].path[1].x = 520.0;
    prepare(
        &mut l,
        5000,
        &context_for("capital"),
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    let pr = l.programme.as_ref().unwrap();
    // Catalogue institutions (town hall, keep, ...) each keep a real block.
    let collective = pr
        .demands
        .iter()
        .filter(|d| d.function == "collective")
        .map(|d| d.id.as_str())
        .collect::<BTreeSet<_>>();
    assert!(
        pr.reservations
            .iter()
            .filter(|r| collective.contains(r.demand_id.as_str()))
            .count()
            > 1
    );
    let ids = pr
        .reservations
        .iter()
        .map(|r| &r.id)
        .collect::<BTreeSet<_>>();
    assert_eq!(ids.len(), pr.reservations.len());
}
#[test]
fn reserved_medina_collective_keeps_the_profile_used_before_subdivision() {
    let l = prepare_case("capital", false, "medina");
    let pr = l.programme.as_ref().unwrap();
    let demand = pr
        .demands
        .iter()
        .find(|d| d.function == "collective")
        .unwrap();
    let reserve = pr
        .reservations
        .iter()
        .find(|r| r.demand_id == demand.id)
        .unwrap();
    let mut p = partition(&l).parcels.remove(reserve.block);
    p.family = "reserve".into();
    let before = super::super::culture::block_mapping(
        &l,
        "medina",
        reserve.block,
        "collective",
        &pr.context.period,
    )
    .unwrap();
    let after = super::super::culture::parcel_mapping(&l, &p, "medina", "collective").unwrap();
    assert_eq!(before.admissibility.recipe_id, "AF-MAG-B01");
    assert_eq!(
        after.admissibility.recipe_id,
        before.admissibility.recipe_id
    );
    assert!(eligible(&l, &p, demand, pr));
}
#[test]
fn port_storage_is_admitted_on_measured_navigable_frontage_not_on_the_declared_label() {
    let l = prepare_case("port", true, "european-organic");
    let mut pr = l.programme.clone().unwrap();
    assert!(!pr.navigable_frontage, "a dry test surface has no navigable quay");
    pr.reservations.clear();
    let d = pr.demands.iter().find(|d| d.function == "warehouse").unwrap().clone();
    let p = partition(&l).parcels.into_iter().find(|p| p.use_kind == "plot").unwrap();
    pr.environment[p.block].waterfront = true;
    assert!(!eligible(&l, &p, &d, &pr), "the declaration alone never admits port storage");
    pr.navigable_frontage = true;
    pr.context.navigable_access = false;
    assert!(eligible(&l, &p, &d, &pr), "measured navigable frontage admits it without a declaration");
}
#[test]
fn private_attached_or_unserved_gardens_are_never_public_commons() {
    let l = prepare_case("agricultural", false, "european-organic");
    let mut pr = l.programme.clone().unwrap();
    pr.reservations.clear();
    let d = pr.demands.iter().find(|d| d.function == "common").unwrap();
    let mut p = partition(&l).parcels.remove(0);
    p.use_kind = "garden".into();
    assert!(eligible(&l, &p, d, &pr));
    for kind in ["attached", "unserved", "private"] {
        p.access.as_mut().unwrap().kind = kind.into();
        assert!(!eligible(&l, &p, d, &pr), "{kind}");
    }
}
#[test]
fn metropolitan_commons_reserve_open_land_without_taking_markets_or_private_gardens() {
    let mut l = layout("european-organic");
    let original = l.blocks[0].clone();
    l.blocks = (0..200)
        .map(|i| {
            let mut b = original.clone();
            b.shape = rectangle(
                110.0 + i as f64 * 20.0,
                110.0,
                130.0 + i as f64 * 20.0,
                140.0,
            );
            b
        })
        .collect();
    l.blocks[0].kind = "market".into();
    // A disconnected pre-existing common cannot be promised as accessible.
    l.blocks[199].kind = "reserve:common".into();
    l.blocks[199].shape = rectangle(300.0, 300.0, 320.0, 330.0);
    l.streets[0].path[1].x = 4100.0;
    let height = vec![0.0; 1024];
    let water = vec![0; 1024];
    let surface = Surface {
        geometry: None,
        width: 5000.0,
        n: 32,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    prepare(&mut l, 50_000, &ProgrammeContext::default(), surface).unwrap();
    let pr = l.programme.as_ref().unwrap();
    let d = pr.demands.iter().find(|d| d.function == "common").unwrap();
    assert_eq!(d.requested, 25_000.0);
    let reservations = pr
        .reservations
        .iter()
        .filter(|r| r.demand_id == d.id)
        .collect::<Vec<_>>();
    assert!(reservations.len() > 1);
    assert!(reservations.iter().all(|r| r.block != 0 && r.block != 199));
    assert_eq!(l.blocks[0].kind, "market");
    assert!(
        pr.reservations
            .iter()
            .any(|r| r.block == 0 && r.demand_id.ends_with("/market"))
    );
    let mut parts =
        super::super::generate_parcels("common-50000", &[l.clone()], &Default::default())
            .unwrap();
    let p = &mut parts[0];
    // An existing private garden is retained beside, but outside, the
    // reserved domains. Public street contact does not make it public.
    let used = pr
        .reservations
        .iter()
        .map(|r| r.block)
        .collect::<BTreeSet<_>>();
    let private = p
        .parcels
        .iter_mut()
        .find(|p| p.block != 199 && !used.contains(&p.block))
        .unwrap();
    private.use_kind = "garden".into();
    private.access.as_mut().unwrap().kind = "private".into();
    let private_id = private.id.clone();
    let private_shape = serde_json::to_value(&private.shape).unwrap();
    allocate(&l, p);
    let report = p.programme.as_ref().unwrap();
    let allocated = report
        .allocations
        .iter()
        .filter(|a| a.function == "common")
        .collect::<Vec<_>>();
    assert!(allocated.len() > 1);
    assert!(allocated.iter().all(|a| a.parcel_id != private_id));
    let private = p.parcels.iter().find(|p| p.id == private_id).unwrap();
    assert_eq!(private.use_kind, "garden");
    assert_eq!(serde_json::to_value(&private.shape).unwrap(), private_shape);
    let scene = BuiltScene {
        buildings: vec![],
        refusals: vec![],
        open_spaces: allocated
            .iter()
            .map(|a| {
                let parcel = p.parcels.iter().find(|p| p.id == a.parcel_id).unwrap();
                assert_eq!(parcel.use_kind, "reserve");
                assert!(public_open_access(parcel, 0.8));
                BuiltOpenSpace {
                    id: None,
                    deficit: None,
                    parcel_id: a.parcel_id.clone(),
                    surface: vec![parcel.shape.clone()],
                }
            })
            .collect(),
    };
    let realised = reconcile_built(&parts, &scene).unwrap();
    let common = realised[0]
        .programme
        .as_ref()
        .unwrap()
        .demands
        .iter()
        .find(|d| d.function == "common")
        .unwrap();
    assert!(common.open_capacity >= 25_000.0);
    assert_eq!(common.built_capacity, 0.0);
    assert_eq!(common.deficit, 0.0);
}

#[test]
fn contextual_scenarios_keep_unknown_navigation_and_resource_provenance() {
    let ag = prepare_case("agricultural", false, "european-organic");
    let trade = prepare_case("crossroads", false, "european-organic");
    let river = prepare_case("riverine", false, "european-organic");
    let artisan = prepare_case("artisan", false, "european-organic");
    let find = |l: &Layout, f: &str| {
        l.programme
            .as_ref()
            .unwrap()
            .demands
            .iter()
            .find(|d| d.function == f)
            .map(|d| d.requested)
    };
    assert!(find(&trade, "market") > find(&ag, "market"));
    assert!(find(&river, "warehouse").is_none());
    let work = artisan
        .programme
        .unwrap()
        .demands
        .into_iter()
        .find(|d| d.function == "workshop")
        .unwrap();
    assert!(work.provenance.join(" ").contains("ore"));
    let port = prepare_case("port", false, "european-organic");
    assert!(
        port.programme
            .unwrap()
            .demands
            .iter()
            .find(|d| d.function == "warehouse")
            .unwrap()
            .reasons[0]
            .contains("No explicit navigable")
    );
}
#[test]
fn known_resource_workshop_retains_a_domain_before_cadastral_cuts() {
    let mut source = layout("european-organic");
    source.blocks.truncate(1);
    source.blocks[0].shape = rectangle(110.0, 110.0, 140.0, 150.0);
    let height = vec![0.0; 32 * 32];
    let water = vec![0; 32 * 32];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 32,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let mut diffuse = source.clone();
    let mut context = context_for("artisan");
    prepare(&mut diffuse, 600, &context, surface).unwrap();
    assert!(
        diffuse
            .programme
            .as_ref()
            .unwrap()
            .reservations
            .iter()
            .all(|r| !r.demand_id.ends_with("/workshop"))
    );
    context.resources = vec!["ore".into()];
    prepare(&mut source, 600, &context, surface).unwrap();
    let programme = source.programme.as_ref().unwrap();
    assert_eq!(programme.reservations.len(), 1);
    assert!(programme.reservations[0].demand_id.ends_with("/workshop"));
    assert_eq!(source.blocks[0].kind, "reserve:programme");
    // Prepared again (the quarter stage does, after the spring sites), the
    // block is reserved again: a mark left from the first preparation would
    // bar it from every demand and leave it without institution or house.
    prepare(&mut source, 600, &context, surface).unwrap();
    let programme = source.programme.as_ref().unwrap();
    assert_eq!(programme.reservations.len(), 1);
    assert!(programme.reservations[0].demand_id.ends_with("/workshop"));
    assert_eq!(source.blocks[0].kind, "reserve:programme");
    let parts = super::super::generate_parcels(
        "resource-workshop",
        &[source.clone()],
        &Default::default(),
    )
    .unwrap();
    assert_eq!(parts[0].parcels.len(), 1);
    assert!((area(&parts[0].parcels[0].shape) - 1200.0).abs() < 0.01);
    assert!(
        parts[0]
            .programme
            .as_ref()
            .unwrap()
            .allocations
            .iter()
            .any(|a| a.function == "workshop")
    );
}

#[test]
fn reserves_precede_cuts_and_estimated_land_is_not_built_capacity() {
    let l = prepare_case("crossroads", false, "european-organic");
    assert!(!l.programme.as_ref().unwrap().reservations.is_empty());
    let mut p = partition(&l);
    let geometry = serde_json::to_value(&p.parcels).unwrap();
    allocate(&l, &mut p);
    assert_eq!(geometry, serde_json::to_value(&p.parcels).unwrap());
    let pr = p.programme.as_ref().unwrap();
    assert!(pr.demands.iter().any(|d| d.parcel_capacity > 0.0));
    assert!(
        pr.demands
            .iter()
            .all(|d| d.built_capacity == 0.0 && d.deficit == d.requested)
    );
    assert!(pr.allocations.iter().all(|a| !a.parcel_id.is_empty()));
    let again = reallocate(&[l], &[p.clone()]).unwrap();
    assert_eq!(
        serde_json::to_value(p).unwrap(),
        serde_json::to_value(&again[0]).unwrap()
    );
}
#[test]
fn reservation_contacts_and_interior_holes_use_exact_geometry() {
    let mut l = layout("european-organic");
    let mut shape = rectangle(100.0, 110.0, 200.0, 140.0);
    l.streets[0].path = vec![Point { x: 149.5, y: 105.0 }, Point { x: 150.5, y: 105.0 }];
    let original = block_front(&l, &shape).unwrap().1;
    assert!(
        original < 5.0,
        "A one metre street cannot grant a hundred metre frontage: {original}"
    );
    shape.outer.insert(1, Point { x: 150.0, y: 110.0 });
    assert!((block_front(&l, &shape).unwrap().1 - original).abs() < 0.01);
    let l = prepare_case("agricultural", false, "european-organic");
    let mut p = partition(&l).parcels.remove(0);
    p.shape = rectangle(110.0, 110.0, 114.0, 116.0);
    p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 114.0, y: 110.0 }]);
    p.contacts.clear();
    assert!(
        has_envelope(&p, 4.0, 6.0),
        "Exact frame fits before perforation"
    );
    p.shape
        .holes
        .push(rectangle(111.8, 112.0, 112.2, 112.4).outer);
    assert!(
        !has_envelope(&p, 4.0, 6.0),
        "A wholly interior hole blocks the only geometrically possible frame"
    );
}

#[test]
fn a_reserved_sliver_cannot_satisfy_a_built_institution() {
    let mut l = prepare_case("capital", false, "european-organic");
    l.blocks[0].shape = rectangle(110.0, 110.0, 610.0, 111.0);
    let mut p = partition(&l).parcels.remove(0);
    p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 610.0, y: 110.0 }]);
    let pr = l.programme.as_mut().unwrap();
    let institutional = pr
        .demands
        .iter()
        .find(|d| d.function == "collective")
        .unwrap()
        .clone();
    pr.reservations = vec![Reservation {
        id: "sliver".into(),
        demand_id: institutional.id.clone(),
        block: 0,
        shape: l.blocks[0].shape.clone(),
        street: 0,
        frontage: 500.0,
    }];
    assert!(!eligible(
        &l,
        &p,
        &institutional,
        l.programme.as_ref().unwrap()
    ));
}

#[test]
fn requested_counts_become_demands_reported_beside_the_automatic_draw() {
    let height = vec![0.0; 32 * 32];
    let water = vec![0; 32 * 32];
    for mode in ["suggest", "force"] {
        let mut l = layout("european-organic");
        let context = ProgrammeContext {
            counts: [("worship.parish".to_string(), 3), ("craft.smithy".to_string(), 0), ("worship.cathedral".to_string(), 1)].into(),
            count_mode: mode.into(),
            ..ProgrammeContext::default()
        };
        let surface = Surface { geometry: None, width: 1000.0, n: 32, height: &height, water: &water, interpolation: Default::default() };
        prepare(&mut l, 600, &context, surface).unwrap();
        let programme = l.programme.as_ref().unwrap();
        let sites = |role: &str| programme.demands.iter().filter(|d| d.role == role).map(|d| d.sites).sum::<usize>();
        assert_eq!((sites("worship.parish"), sites("craft.smithy"), sites("worship.cathedral")), (3, 0, 1));
        let force = mode == "force";
        for d in &programme.demands {
            assert_eq!(d.explicit, force && matches!(d.role.as_str(), "worship.parish" | "worship.cathedral"), "{}", d.id);
        }
        let row = |role: &str| programme.counts.iter().find(|c| c.role == role).cloned().unwrap();
        assert_eq!(row("worship.parish").requested, Some(3));
        assert!(row("worship.parish").auto > 0, "the default draw of a 600-people town has a parish");
        assert_eq!((row("worship.cathedral").auto, row("worship.cathedral").requested), (0, Some(1)));
        assert!(programme.counts.iter().any(|c| c.requested.is_none() && c.auto > 0), "unrequested roles keep their automatic count");
    }
}

#[test]
fn forced_counts_report_placed_sites_and_warn_when_short() {
    let l = layout("european-organic");
    let mut part = partition(&l);
    let demand = "programme-case/demand/worship.parish";
    let allocation = |parcel: &str| json!({"parcelId":parcel,"demandId":demand,"function":"collective","culture":"european-organic",
        "architecturePack":"EUR-MED","capacity":100.0,"unit":"usefulAreaM2","score":0.0,"reasons":[],"role":"worship.parish"});
    for (mode, warned) in [("force", true), ("suggest", false)] {
        let mut pr: UrbanProgramme = serde_json::from_value(json!({"version":1,"population":600,
            "context":{"counts":{"worship.parish":3},"countMode":mode},"cultures":[],
            "demands":[{"id":demand,"function":"collective","unit":"usefulAreaM2","requested":300.0,"targetArea":100.0,"targetFrontage":8.0,
                "provenance":[],"requires":[],"parcelCapacity":0.0,"builtCapacity":0.0,"deficit":0.0,"reasons":[],"role":"worship.parish","sites":3}],
            "reservations":[{"id":"r0","demandId":demand,"block":0,"shape":l.blocks[0].shape,"street":0,"frontage":20.0}],
            // A reserved block is one site whatever its lots; a plot elsewhere is another.
            "allocations":[allocation("lot/0"), allocation("lot/0"), allocation("lot/1")],
            "adjacency":[],"environment":[],"reconciliationPasses":0,"warnings":[],
            "counts":[{"role":"worship.parish","auto":1,"requested":3}]})).unwrap();
        super::outcomes::count_outcomes(&mut part, &mut pr);
        assert_eq!(pr.counts[0].placed, 2);
        let short = "Building count worship.parish: 2/3 placed — no suitable site".to_string();
        assert_eq!(part.warnings.contains(&short), warned, "{mode}");
        assert_eq!(pr.warnings.contains(&short), warned, "{mode}");
        part.warnings.clear();
    }
}
