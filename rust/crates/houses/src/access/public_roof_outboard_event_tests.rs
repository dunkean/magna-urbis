use super::*;

std::thread_local! {
    static CAPTURE: std::cell::RefCell<Option<Option<HouseUnit>>> = const { std::cell::RefCell::new(None) };
}

pub(crate) fn capture(profile: &HouseUnit) {
    if profile
        .access
        .portals
        .last()
        .is_some_and(|p| p.to == "unit-2:space:787")
    {
        CAPTURE.with(|slot| {
            if let Some(captured) = slot.borrow_mut().as_mut() {
                assert!(captured.is_none());
                *captured = Some(profile.clone());
            }
        });
    }
}

pub(crate) fn witness() -> HouseUnit {
    static NATIVE: std::sync::OnceLock<HouseUnit> = std::sync::OnceLock::new();
    NATIVE
        .get_or_init(|| {
            CAPTURE.with(|slot| *slot.borrow_mut() = Some(None));
            crate::engine::native_outboard787_draw().unwrap();
            CAPTURE.with(|slot| slot.borrow_mut().take().unwrap().unwrap())
        })
        .clone()
}

fn frame(d: f64) -> Frame {
    Frame {
        origin: point(9.314, -d),
        tangent: point(1.0, 0.0),
        outward: point(0.0, -1.0),
        distance: d,
    }
}

pub(crate) fn rebuild(profile: &HouseUnit, d: f64) -> HouseUnit {
    let mut unit = profile.clone();
    let last = unit.access.portals.last().unwrap();
    assert_eq!(last.to, "unit-2:space:787");
    let head = unit
        .features
        .iter()
        .find(|f| f.id == last.feature_ids[0])
        .unwrap();
    let key = head.id.strip_suffix(":landing:3").unwrap().to_string();
    let serial: usize = key
        .strip_prefix("unit-2:public-roof:")
        .unwrap()
        .strip_suffix(":outboard")
        .unwrap()
        .parse()
        .unwrap();
    let portals: Vec<_> = (0..5)
        .map(|i| {
            unit.access
                .portals
                .iter()
                .find(|p| p.id == format!("unit-2:portal:{}", serial + i))
                .unwrap()
                .clone()
        })
        .collect();
    let base = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == portals[0].from)
        .unwrap()
        .clone();
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == last.to)
        .unwrap()
        .clone();
    let stops: Vec<_> = portals[1..4]
        .iter()
        .map(|p| unit.access.nodes.iter().find(|n| n.id == p.to).unwrap().z_m)
        .collect();
    unit.features
        .retain(|f| !f.id.starts_with(&format!("{key}:")));
    unit.access
        .nodes
        .retain(|n| !portals[..4].iter().any(|p| p.to == n.id));
    unit.access
        .portals
        .retain(|p| !portals.iter().any(|old| old.id == p.id));
    unit.roofs = RoofMesh::default();
    let f = frame(d);
    let (opening, passage) = bridge::passage(f, true);
    install_mode(
        &mut unit,
        &base,
        &target,
        f,
        &stops,
        opening,
        passage,
        floor(f),
        RouteMode::Outboard,
    )
    .unwrap();
    unit
}

#[test]
fn native_787_event_emits_the_same_material_bits_and_keeps_old_eaves_none() {
    let profile = witness();
    let candidate = rebuild(&profile, 0.171);
    let initial = frame(0.171);
    let d = distance_existing(&profile, &candidate, initial, 0.0, 8.4)
        .unwrap()
        .unwrap();
    assert_eq!(d.to_bits(), snap(0.479).to_bits());
    assert!(
        distance(&profile, &candidate, initial, 0.0, 8.4)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        serde_json::to_vec(&rebuild(&profile, d)).unwrap(),
        serde_json::to_vec(&rebuild(&profile, 0.479)).unwrap()
    );
    let mut emitted = rebuild(&profile, d);
    crate::roofs::build_roofs_with_budget(&mut emitted, crate::engine::MAX_BATCH_FACES as usize)
        .unwrap();
    // Reproduce the one-ulp edge from the current native Body/Level operands
    // using the real roof operator, instead of copying the previous mesh.
    for level in [0, 1] {
        let y = emitted
            .roofs
            .faces
            .iter()
            .filter(|f| {
                f.body_id == "unit-2:body:1" && f.level == level && f.kind == RoofFaceKind::Slab
            })
            .flat_map(|f| {
                f.vertices
                    .iter()
                    .map(|i| emitted.roofs.vertices[*i as usize].y)
            })
            .min_by(f64::total_cmp)
            .unwrap();
        assert_eq!(y.to_bits(), (-0.33899999999999997f64).to_bits());
    }
    validate_geometry(&emitted, true).unwrap();
    println!(
        "787: emitted bits={:016x}, complete rebuilt roof validation PASS",
        d.to_bits()
    );
}

#[test]
fn exact_tangent_witness_rejects_479_and_queries_480_without_tolerance() {
    let mut profile = witness();
    let actual = -0.33899999999999997f64;
    let exact = -0.339f64;
    assert_ne!(actual.to_bits(), exact.to_bits());
    let mut changed = 0;
    for v in &mut profile.roofs.vertices {
        if v.y.to_bits() == actual.to_bits() {
            v.y = exact;
            changed += 1;
        }
    }
    assert!(changed > 0);
    assert!(validate_geometry(&profile, true).is_err());
    let candidate = rebuild(&profile, 0.171);
    let d = distance_existing(&profile, &candidate, frame(0.171), 0.0, 8.4)
        .unwrap()
        .unwrap();
    assert_eq!(d.to_bits(), snap(0.480).to_bits());
    println!("exact tangent: changed {changed} shared native vertices, emitted .480");
}

#[test]
fn event_rejects_false_body_level_group_and_absent_positive_initial_hit() {
    let profile = witness();
    let candidate = rebuild(&profile, 0.171);
    for field in 0..3 {
        let mut broken = profile.clone();
        for face in &mut broken.roofs.faces {
            if face.kind == RoofFaceKind::Slab {
                match field {
                    0 => face.body_id = "foreign".into(),
                    1 => face.level = 999,
                    _ => face.roof_group = "foreign".into(),
                }
            }
        }
        assert!(
            distance_existing(&broken, &candidate, frame(0.171), 0.0, 8.4)
                .unwrap()
                .is_none()
        );
    }
    let free = rebuild(&profile, 0.54);
    assert!(
        distance_existing(&profile, &free, frame(0.54), 0.0, 8.4)
            .unwrap()
            .is_none()
    );
}

#[test]
fn another_certified_native_body_can_set_the_maximum() {
    let mut profile = witness();
    let candidate = rebuild(&profile, 0.171);
    let mut other = profile
        .bodies
        .iter()
        .find(|b| b.id == "unit-2:body:1")
        .unwrap()
        .clone();
    other.id = "native-other-body".into();
    other.component_id = Some("native-other-component".into());
    profile.bodies.push(other.clone());
    let original = profile
        .roofs
        .faces
        .iter()
        .find(|f| f.body_id == "unit-2:body:1" && f.level == 0 && f.kind == RoofFaceKind::Slab)
        .unwrap()
        .clone();
    let mut source = original;
    source.body_id = other.id.clone();
    source.component_id = other.component_id.clone();
    source.roof_group = "native-other-body:0:intermediate".into();
    let surface = rectangle(11.2, -0.350, 0.9, 0.5);
    let offset = profile.roofs.vertices.len() as u32;
    profile
        .roofs
        .vertices
        .extend(surface[0].outer.iter().map(|p| Vertex3 {
            x: p.x,
            y: p.y,
            z: snap(2.8),
        }));
    source.vertices = (offset..offset + 4).collect();
    profile.roofs.groups.push(RoofGroup {
        id: source.roof_group.clone(),
        rf: "RF-FLAT".into(),
        body_id: other.id.clone(),
        feature_id: None,
        room_id: None,
        level: 0,
        domain: surface,
    });
    profile.roofs.faces.push(source);
    let d = distance_existing(&profile, &candidate, frame(0.171), 0.0, 8.4)
        .unwrap()
        .unwrap();
    assert!(d > snap(0.479) && d <= DISTANCE_MAX);
    profile.bodies.pop();
    assert_eq!(
        distance_existing(&profile, &candidate, frame(0.171), 0.0, 8.4).unwrap(),
        Some(snap(0.479))
    );
}
