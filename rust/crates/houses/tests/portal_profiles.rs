use magna_urbis_houses::{
    catalogue::PortalShape,
    generate_batch,
    geometry::{area, intersection},
    model::{FeatureKind, HouseConfig},
    wall_geometry::wall_section,
};

fn source(id: &str) -> HouseConfig {
    HouseConfig {
        pack: id.rsplit_once("-B").unwrap().0.into(),
        recipe: Some(id.into()),
        count: 1,
        variation: 0.0,
        allow_late: true,
        ..Default::default()
    }
}

#[test]
fn sourced_single_low_and_differentiated_entries_reach_real_rooms() {
    for (id, expected_min) in [("ATL-CEL-B01", 1), ("AF-SAHEL-B11", 1), ("AS-KOR-B08", 2)] {
        let batch = generate_batch(source(id)).unwrap_or_else(|e| panic!("{id}: {e}"));
        let unit = &batch.units[0];
        let entries: Vec<_> = unit
            .access
            .portals
            .iter()
            .filter(|p| p.profile_id.is_some())
            .collect();
        assert!(entries.len() >= expected_min, "{id}");
        if id == "ATL-CEL-B01" {
            assert_eq!(entries.len(), 1);
        } else if id == "AF-SAHEL-B11" {
            assert!(
                entries
                    .iter()
                    .all(|p| p.head_z_m - p.from_z_m.max(p.to_z_m) <= 1.350_001)
            );
        } else {
            assert!(
                entries
                    .iter()
                    .any(|a| entries.iter().any(|b| (a.width_m - b.width_m).abs() > 0.1))
            );
        }
        for entry in entries {
            assert!(unit.access.nodes.iter().any(|n| n.id == entry.from));
            assert!(unit.access.nodes.iter().any(|n| n.id == entry.to));
        }
    }
}

#[test]
fn trapezoidal_entries_have_inclined_native_jambs_and_clear_openings() {
    let batch = generate_batch(source("AM-AND-B02")).unwrap();
    let unit = &batch.units[0];
    let entry = unit
        .access
        .portals
        .iter()
        .find(|p| p.shape == PortalShape::Trapezoid)
        .unwrap();
    assert!(entry.top_width_m.unwrap() < entry.width_m);
    let floor = entry.from_z_m.max(entry.to_z_m);
    let jambs: Vec<_> = unit
        .walls
        .iter()
        .filter(|w| w.id.contains(&entry.id) && w.solid.is_some())
        .collect();
    assert!(!jambs.is_empty());
    assert!(jambs.iter().any(|w| {
        let below = wall_section(w, floor + 0.1);
        let above = wall_section(w, entry.head_z_m - 0.1);
        area(&below) > 0.001 && area(&above) > area(&below) + 0.005
    }));
    for wall in &unit.walls {
        assert!(
            area(&intersection(
                &wall_section(wall, floor + 0.01),
                &entry.opening_surface
            )) < 0.002
        );
    }
}

#[test]
fn raised_threshold_has_a_real_bearing_volume_below_its_tread() {
    let batch = generate_batch(source("OC-PAC-B03")).unwrap();
    let unit = &batch.units[0];
    let entry = unit
        .access
        .portals
        .iter()
        .find(|p| p.sill_z_m.is_some())
        .unwrap();
    let sill = entry.sill_z_m.unwrap();
    assert!((sill - entry.from_z_m.max(entry.to_z_m) - 0.2).abs() < 0.001);
    let tread = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Threshold && entry.feature_ids.contains(&f.id))
        .unwrap();
    assert!((tread.z_m - sill).abs() < 0.001);
    assert!(unit.walls.iter().any(|w| {
        w.solid.is_some()
            && area(&intersection(&wall_section(w, sill - 0.01), &tread.surface))
                >= area(&tread.surface) - 0.001
    }));
}
