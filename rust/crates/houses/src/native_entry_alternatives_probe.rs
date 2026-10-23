//! Diagnostic only: root portals already cut by one native access graph.
//! No new door, wall cut, layout, frontage search or rigid pose is generated.
//! Register as a cfg(test) child of plans.rs; successful probes still need a
//! production selection/retention contract before becoming an active path.
use super::*;
use super::native_one_bend_access::one_bend_on_support_line;
use crate::access::{StructuralEntrance, structural_access, structural_site_entry};
use crate::access::plan_entry::PreparedPlanEntry;
use crate::engine::{FoundationPreparation, PreparedFoundationDomains};
use crate::wall_geometry::wall_section;

#[test]
fn existing_root_portals_probe_two_deferred_strips_at_identical_pose() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    let mut occupation = OccupationIndex::default();
    let mut witness_count = 0;
    let mut admitted = 0;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        if ["e099cf700f812cc3", "53c6fbc1ac486b3b"].iter()
            .any(|id| request.parcel_id.ends_with(id))
        {
            witness_count += 1;
            let resolved = previous.resolved.unpack().unwrap();
            let source_bytes = serde_json::to_vec(&resolved).unwrap();
            let mut unit = crate::engine::structural_unit_for_entry_probe(&resolved).unwrap();
            let selected = structural_access(&mut unit, &resolved.plan.paths, &resolved.parameters).unwrap();
            assert!(unit.rooms.is_empty() && unit.roofs.vertices.is_empty() && unit.roofs.faces.is_empty());
            let portals: Vec<_> = unit.access.portals.iter()
                .filter(|p| p.from == unit.access.root || p.to == unit.access.root)
                .collect();
            assert!(!portals.is_empty() && portals.len() <= 16, "bounded two-witness diagnostic");
            let native_features = crate::placement::native_site_features(&unit);
            assert!(native_features.iter().all(|f| matches!(f.kind,
                FeatureKind::Gallery | FeatureKind::Post | FeatureKind::PartyWall) && f.roof.is_none()));
            let body_domain = unite(&unit.bodies.iter().flat_map(|b|
                b.levels.iter().map(|l| l.footprint.clone())).collect::<Vec<_>>());
            let mut bearing_parts = vec![body_domain.clone()];
            bearing_parts.extend(native_features.iter().map(|f| f.surface.clone()));
            let bearing_domain = unite(&bearing_parts);
            let neighbors = unite(&request.neighbors.iter().map(|n| n.footprint.clone())
                .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
            let walk = difference(&difference(&request.cadastral, &request.reserves), &neighbors);
            let mut reports = vec![];
            for portal in portals {
                let body_entry = StructuralEntrance {
                    opening: portal.opening,
                    passage: portal.passage.clone(),
                    width_m: portal.width_m,
                    from_z_m: portal.from_z_m,
                    to_z_m: portal.to_z_m,
                };
                let site_entry = structural_site_entry(&unit, &resolved.parameters, &body_entry).unwrap();
                // Same wall section/support definition as plan_entry::solids_at_entry.
                // Every wall here already contains the native graph's real cuts.
                let z = site_entry.from_z_m + 0.01;
                let mut solids: Vec<_> = unit.walls.iter().map(|w| wall_section(w, z)).collect();
                solids.extend(unit.features.iter().filter(|f|
                    matches!(f.kind, FeatureKind::Post | FeatureKind::PartyWall)
                        && f.z_m <= z && f.z_m + f.height_m > z)
                    .map(|f| f.surface.clone()));
                let site_solids = unite(&solids);
                assert_eq!(site_entry.from_z_m, body_entry.from_z_m);
                let body_overlap = area(&intersection(&body_entry.passage, &site_solids));
                let site_overlap = area(&intersection(&site_entry.passage, &site_solids));
                let mut report = serde_json::json!({
                    "portalId":portal.id,
                    "selectedByCurrentMaxY":body_entry.opening == selected.opening,
                    "openingLocal":site_entry.opening,
                    "passageBoundsLocal":bounds(&site_entry.passage),
                    "bodySolidOverlapM2":body_overlap,
                    "siteSolidOverlapM2":site_overlap,
                    "passageOutsideRightsM2":area(&difference(
                        &map_surface(&site_entry.passage, &previous.transform), &walk)),
                });
                if body_overlap > 0.0001 || site_overlap > 0.0001 {
                    report["visualRefusal"] = "Native passage intersects a structural support or an uncut wall.".into();
                    reports.push(report);
                    continue;
                }
                let mut occupation_parts = vec![body_domain.clone(), resolved.plan.courts.clone(), resolved.plan.paths.clone()];
                occupation_parts.extend(native_features.iter().map(|f| f.surface.clone()));
                occupation_parts.push(body_entry.passage.clone());
                if site_entry.passage != body_entry.passage {
                    occupation_parts.push(site_entry.passage.clone());
                }
                let physical = PreparedFoundationDomains {
                    body_domain: body_domain.clone(),
                    occupation_domain: unite(&occupation_parts),
                    bearing_domain: bearing_domain.clone(),
                    occupation_parts,
                    bearing_parts: bearing_parts.clone(),
                    native_features: native_features.clone(),
                    entry: Some(PreparedPlanEntry { body_entry, site_entry, site_solids: site_solids.into(), alternatives: vec![], retained_passages: vec![] }),
                };
                // Inject only an actual existing portal into the diagnostic's
                // ephemeral preparation. The complete production visual path
                // still checks body/roof, gallery/post, terrain, rights and the
                // public connector. No success is inferred from its bbox.
                let prepared = PreparedPlan::with_native_entry(&resolved);
                assert!(prepared.foundation.set(Ok(FoundationPreparation::Supported(physical))).is_ok());
                match visual_with_front_access_prepared(
                    &request, &prepared, previous.transform.clone(), &neighbors,
                    true, false, None, true,
                ) {
                    Err(reason) => report["visualRefusal"] = reason.into(),
                    Ok(building) => {
                        admitted += 1;
                        assert_eq!(building.transform.origin, previous.transform.origin);
                        assert_eq!(building.transform.orientation_deg, previous.transform.orientation_deg);
                        assert_eq!(building.recipe_id, previous.recipe_id);
                        assert_eq!(building.variant_id, previous.variant_id);
                        assert!((area(&building.footprint) - area(&previous.footprint)).abs() < 0.0001);
                        report["visual"] = "accepted at identical pose".into();
                        for interiors in [false, true] {
                            let key = if interiors { "nativeInterior" } else { "nativeExterior" };
                            report[key] = match realize_plan(RealizePlanRequest {
                                building: building.clone(), interiors,
                            }) {
                                Ok(_) => "accepted".into(),
                                Err(reason) => serde_json::json!({"refusal":reason}),
                            };
                        }
                    }
                }
                reports.push(report);
            }
            assert_eq!(source_bytes, serde_json::to_vec(&resolved).unwrap());
            eprintln!("native-entry-alternatives-probe {}", serde_json::json!({
                "id":request.id,"pose":previous.transform,"existingRootPortals":reports,
                "productionActivated":false,"sameSourceAndPose":true,
            }));
        }
        // Alternative outcomes never affect the other witnesses' neighbours.
        let mut parts = vec![previous.footprint, previous.courtyards, previous.circulation];
        parts.extend(previous.structural_features.into_iter().map(|f| f.surface));
        occupation.insert(unite(&parts));
    }
    assert_eq!(witness_count, 2);
    eprintln!("native-entry-alternatives-probe-summary witnesses={witness_count} admittedPortals={admitted} productionActivated=false");
}


#[test]
fn one_constructive_bend_probes_11976_without_changing_its_native_plan() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    let mut occupation = OccupationIndex::default();
    let mut witnesses = 0;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        if request.parcel_id.ends_with("53c6fbc1ac486b3b") {
            witnesses += 1;
            let resolved = previous.resolved.unpack().unwrap();
            let prepared = PreparedPlan::with_native_entry(&resolved);
            let physical = match prepared.foundation().unwrap() {
                FoundationPreparation::Supported(value) => value,
                FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            // The clone below retains the admitted elevation, volumes and
            // structures. Prove that entry preparation leaves their exact
            // native inputs unchanged, rather than inferring this from area.
            let no_entry = PreparedPlan::new(&resolved);
            let legacy_physical = match no_entry.foundation().unwrap() {
                FoundationPreparation::Supported(value) => value,
                FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            assert_eq!(physical.bearing_parts, legacy_physical.bearing_parts);
            assert_eq!(physical.native_features, legacy_physical.native_features);
            let native = physical.entry.as_ref().unwrap();
            assert_eq!(serde_json::to_vec(&native.body_entry).unwrap(),
                serde_json::to_vec(&native.site_entry).unwrap(),
                "this Strip probe must not omit a distinct body/site passage");
            let neighbors = unite(&request.neighbors.iter().map(|n| n.footprint.clone())
                .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
            // Preserve the original straight-only diagnostic after the one-bend
            // integration. No fallback context is supplied here; the production
            // integration test independently exercises the complete visual path.
            let refusal = proposed_native_access_with_entry(&request, &native.site_entry,
                &native.site_solids, &previous.transform, &previous.footprint,
                &neighbors, None).err().unwrap();
            assert_eq!(refusal, "No unobstructed connection from the retained native portal to declared frontage.");
            let width = 0.8; // Existing minimum public-connector clear width, not a setback.
            let world_entry = transform_point(Point {
                x: (native.site_entry.opening[0].x + native.site_entry.opening[1].x) * 0.5,
                y: (native.site_entry.opening[0].y + native.site_entry.opening[1].y) * 0.5,
            }, &previous.transform);
            // One segment: the nearest existing eligible public frontage, with
            // stable ID tie-break. No alternate streets or elbow distances tried.
            let access = request.accesses.iter().filter(|a|
                matches!(a.kind.as_str(), "public" | "collective" | "private")
                    && a.width_m.is_finite() && a.width_m >= width
                    && libm::hypot(a.segment[1].x-a.segment[0].x, a.segment[1].y-a.segment[0].y) >= width)
                .min_by(|a,b| {
                    let distance = |a: &ArchitectureAccess| {
                        let q = nearest(world_entry, a.segment[0], a.segment[1]);
                        libm::hypot(q.x-world_entry.x, q.y-world_entry.y)
                    };
                    distance(a).total_cmp(&distance(b)).then(a.id.cmp(&b.id))
                }).unwrap();
            let street = access.segment.map(|p| transform_point(p, &inverse(&previous.transform)));
            let construction = one_bend_on_support_line(native.site_entry.opening,
                &prepared.body_local, &native.site_solids, street, width);
            let mut report = serde_json::json!({"id":request.id,"pose":previous.transform,
                "street":access.id,"widthM":width,"constructionCount":1,
                "overallNativeSuccess":false,"productionActivated":false});
            match construction {
                Err(reason) => report["constructionRefusal"] = reason.into(),
                Ok(route) => {
                    let half = width * 0.5;
                    // Every straight strip has width w. The shared miter endpoints
                    // lie on BOTH offset lines, so the filled turn cannot create
                    // a missing triangular wedge or a narrower joint.
                    for (i, joint) in route.joint.iter().enumerate() {
                        for axis in [route.first, route.second] {
                            let signed = (joint.x-route.bend.x)*(-axis[1]) + (joint.y-route.bend.y)*axis[0];
                            assert!((signed - if i == 0 { half } else { -half }).abs() < 1e-10);
                        }
                    }
                    for (cap, segment) in [(route.door_cap,native.site_entry.opening),(route.street_cap,street)] {
                        for point in cap {
                            let projected = nearest(point,segment[0],segment[1]);
                            assert!(libm::hypot(point.x-projected.x,point.y-projected.y) < 1e-10);
                        }
                        assert!((libm::hypot(cap[1].x-cap[0].x,cap[1].y-cap[0].y)-width).abs() < 1e-10);
                    }
                    let path = map_surface(&route.path, &previous.transform);
                    let passage = map_surface(&native.site_entry.passage, &previous.transform);
                    let solids = map_surface(&native.site_solids, &previous.transform);
                    let walk = difference(&difference(&request.cadastral,&request.reserves),&neighbors);
                    let rights = contains(&walk,&passage) && contains(&walk,&path);
                    let passage_solids = area(&intersection(&passage,&solids));
                    let path_solids = area(&intersection(&path,&solids));
                    let body_overlap = area(&difference(&intersection(&path,&previous.footprint),&passage));
                    let shared_passage = area(&intersection(&path,&passage));
                    let connector_accepted = native.site_entry.width_m >= width
                        && (native.site_entry.from_z_m-native.site_entry.to_z_m).abs() <= 0.001
                        && rights && passage_solids <= 0.0001 && path_solids < 0.0001
                        && body_overlap < 0.002 && shared_passage > 0.005;
                    report["route"] = serde_json::json!({"entryLocal":route.entry,"bendLocal":route.bend,
                        "contactLocal":route.contact,"jointLocal":route.joint,"rights":rights,
                        "pathOutsideRightsM2":area(&difference(&path,&walk)),"pathSolidOverlapM2":path_solids,
                        "bodyBeyondPassageM2":body_overlap,"sharedPassageM2":shared_passage,
                        "connectorAccepted":connector_accepted});
                    if connector_accepted {
                        let mut candidate = previous.clone();
                        candidate.resolved = prepared.packed_with_native_entry().unwrap();
                        candidate.entrance = world_entry;
                        candidate.access_id = access.id.clone();
                        candidate.circulation = unite(&[map_surface(&resolved.plan.paths,&previous.transform),passage,path]);
                        candidate.diagnostics.push("CFGTEST ONLY: one constructive exterior bend, same architecture and pose; physical connector guards passed.".into());
                        assert_eq!(candidate.id,previous.id);
                        assert_eq!(candidate.footprint,previous.footprint);
                        assert_eq!(candidate.roof_footprint,previous.roof_footprint);
                        let mut retained = candidate.resolved.unpack().unwrap();
                        retained.entrance = resolved.entrance.clone();
                        assert_eq!(serde_json::to_vec(&retained).unwrap(),serde_json::to_vec(&resolved).unwrap());
                        let mut overall_native_success = true;
                        for interiors in [false,true] {
                            let key = if interiors { "nativeInterior" } else { "nativeExterior" };
                            report[key] = match realize_plan(RealizePlanRequest {building:candidate.clone(),interiors}) {
                                Ok(_) => "accepted".into(),
                                Err(reason) => {
                                    overall_native_success = false;
                                    serde_json::json!({"refusal":reason})
                                },
                            };
                        }
                        report["overallNativeSuccess"] = overall_native_success.into();
                    }
                }
            }
            eprintln!("native-entry-one-bend-probe {report}");
        }
        let mut parts=vec![previous.footprint,previous.courtyards,previous.circulation];
        parts.extend(previous.structural_features.into_iter().map(|f|f.surface));
        occupation.insert(unite(&parts));
    }
    assert_eq!(witnesses,1);
}
