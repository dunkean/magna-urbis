//! Native connected walking components, independent of the last hatch label.
use super::*;

const AREA_EPS: f64 = 1e-6;

fn key(z: f64) -> Result<i64, String> {
    if !z.is_finite() {
        return Err("Composante de toiture sans cote finie.".into());
    }
    Ok(libm::round(z * 1000.0) as i64)
}

fn equal(a: &Surface, b: &Surface) -> bool {
    area(&difference(a, b)) <= AREA_EPS && area(&difference(b, a)) <= AREA_EPS
}

fn occupied_floor(component: &Surface, occupation: &Surface) -> Surface {
    if occupation.is_empty() {
        component.clone()
    } else {
        difference(component, occupation)
    }
}

pub(crate) fn native_roof_walk_component(
    unit: &HouseUnit,
    node: &AccessNode,
) -> Result<(), String> {
    let z = key(node.z_m)?;
    if node.kind != AccessKind::Terrace
        || node.household_id.is_some()
        || unit.access.nodes.iter().filter(|n| n.id == node.id).count() != 1
        || !unit.access.nodes.iter().any(|n| n == node)
    {
        return Err("Composante de toiture sans instance Terrace publique unique.".into());
    }
    let walk = super::roof_apertures::walk_surface(unit, z)?;
    let components: Vec<_> = walk
        .into_iter()
        .map(|p| vec![p])
        .filter(|c| area(c) > 0.05)
        .collect();
    let occupation = super::public_roofs::native_link_occupation(unit, node)?;
    let matched: Vec<_> = components
        .iter()
        .filter(|c| equal(&occupied_floor(c, &occupation), &node.floor))
        .collect();
    if matched.len() != 1 {
        return Err(format!(
            "{} : sol sans composante native walkable identique (coupes unilatérales comprises).",
            node.id
        ));
    }
    let mut claimants = vec![];
    for candidate in unit
        .access
        .nodes
        .iter()
        .filter(|n| n.kind != AccessKind::Room)
    {
        if key(candidate.z_m)? == z
            && (equal(&candidate.floor, matched[0])
                || equal(&candidate.floor, &occupied_floor(matched[0], &occupation)))
        {
            claimants.push(candidate);
        }
    }
    if claimants.len() != 1 || claimants[0] != node {
        return Err("Composante native revendiquée par plusieurs nœuds publics ou privés.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn occupation_fixture() -> HouseUnit {
        super::super::public_roofs::walk_occupation_fixture()
    }
    fn low_node(unit: &HouseUnit) -> &AccessNode {
        unit.access
            .nodes
            .iter()
            .find(|n| n.id == "unit-2:space:24")
            .unwrap()
    }
    fn occupation_indices(unit: &HouseUnit) -> (usize, usize) {
        let p = unit
            .access
            .portals
            .iter()
            .position(|p| p.id == "unit-2:portal:55")
            .unwrap();
        let f = unit
            .features
            .iter()
            .position(|f| f.id == unit.access.portals[p].feature_ids[0])
            .unwrap();
        (p, f)
    }

    #[test]
    fn real_low_flight_occupation_keeps_every_material_field_unchanged() {
        let unit = occupation_fixture();
        let before = unit.clone();
        native_roof_walk_component(&unit, low_node(&unit)).unwrap();
        let occupied =
            super::super::public_roofs::native_link_occupation(&unit, low_node(&unit)).unwrap();
        assert!(area(&occupied) > 0.09);
        assert_eq!(unit, before);
    }

    #[test]
    fn occupation_requires_the_exact_unique_native_ladder_portal() {
        for case in 0..8 {
            let mut unit = occupation_fixture();
            let (p, f) = occupation_indices(&unit);
            match case {
                0 => unit.access.portals[p].from = "unit-2:space:25".into(),
                1 => unit.features[f].kind = FeatureKind::Stair,
                2 => {
                    unit.features[f].id = "unit-2:public-roof:fake:link:0".into();
                    unit.access.portals[p].feature_ids[0] = unit.features[f].id.clone();
                }
                3 => unit.features[f].vertices3d[0].z += 0.001,
                4 => unit.access.portals.push(unit.access.portals[p].clone()),
                5 => unit.features.push(unit.features[f].clone()),
                6 => unit.access.portals[p].passage = rectangle(0., 0., 0.9, 1.3),
                7 => unit.features[f].material = "MAT-ADOBE".into(),
                _ => unreachable!(),
            }
            assert!(
                native_roof_walk_component(&unit, low_node(&unit)).is_err(),
                "case {case}"
            );
        }
    }

    #[test]
    fn occupation_does_not_admit_other_unilateral_cuts_or_lost_low_support() {
        for cut in [
            rectangle(12.2, 17.0, 0.1, 0.1),
            rectangle(14.11, 14.44, 0.636, 0.636),
        ] {
            let mut unit = occupation_fixture();
            let n = unit
                .access
                .nodes
                .iter_mut()
                .find(|n| n.id == "unit-2:space:24")
                .unwrap();
            n.floor = difference(&n.floor, &cut);
            assert!(native_roof_walk_component(&unit, low_node(&unit)).is_err());
        }
    }

    #[test]
    fn occupation_rejects_a_low_structural_slab_cut_under_the_ladder() {
        let mut unit = occupation_fixture();
        let occupied =
            super::super::public_roofs::native_link_occupation(&unit, low_node(&unit)).unwrap();
        let slab = unit
            .bodies
            .iter_mut()
            .find(|b| b.id == "unit-2:body:3")
            .unwrap()
            .levels[1]
            .roof_slab
            .as_mut()
            .unwrap();
        slab.surface = difference(&slab.surface, &occupied);
        assert!(
            native_roof_walk_component(&unit, low_node(&unit))
                .unwrap_err()
                .contains("toiture porteuse")
        );
    }

    #[test]
    fn occupation_checks_both_materials_and_every_native_source() {
        for case in 0..9 {
            let mut unit = occupation_fixture();
            let occupied =
                super::super::public_roofs::native_link_occupation(&unit, low_node(&unit)).unwrap();
            let bi = unit
                .bodies
                .iter()
                .position(|b| b.id == "unit-2:body:3")
                .unwrap();
            let ti = unit
                .features
                .iter()
                .position(|f| f.id == "terrace:unit-2:body:3:1")
                .unwrap();
            match case {
                0 => {
                    let slab = unit.bodies[bi].levels[1].roof_slab.as_mut().unwrap();
                    slab.surface = difference(&slab.surface, &occupied);
                    unit.features[ti].surface = difference(&unit.features[ti].surface, &occupied);
                }
                1 => unit.bodies[bi].levels[1]
                    .roof_slab
                    .as_mut()
                    .unwrap()
                    .surface
                    .extend(rectangle(-9.0, -9.0, 1.0, 1.0)),
                2 => {
                    unit.bodies[bi].levels.swap(0, 1);
                }
                3 => unit.features[ti].z_m += 0.001,
                4 => unit.features[ti].height_m += 0.001,
                5 => unit.features[ti].material = "MAT-TIMBER-POST".into(),
                6 => {
                    unit.features.remove(ti);
                }
                7 => unit.features.push(unit.features[ti].clone()),
                8 => {
                    let mut body = unit.bodies[bi].clone();
                    body.id = "unit-2:body:extra-occupied".into();
                    let slab = body.levels[1].roof_slab.as_mut().unwrap();
                    slab.surface = difference(&slab.surface, &occupied);
                    let mut terrace = unit.features[ti].clone();
                    terrace.id = format!("terrace:{}:1", body.id);
                    unit.bodies.push(body);
                    unit.features.push(terrace);
                }
                _ => unreachable!(),
            }
            assert!(
                native_roof_walk_component(&unit, low_node(&unit)).is_err(),
                "case {case}"
            );
        }
    }

    #[test]
    fn real_pipeline_preserves_native_level_footprints() {
        for (pack, recipe) in [
            ("AS-HIM", "AS-HIM-B02"),
            ("AS-HIM", "AS-HIM-B10"),
            ("AS-CHI", "AS-CHI-B10"),
            ("MED-ANT", "MED-ANT-B04"),
        ] {
            let config = HouseConfig {
                pack: pack.into(),
                recipe: Some(recipe.into()),
                count: 10,
                variation: 0.65,
                seed: "42".into(),
                ..HouseConfig::default()
            };
            let batch = crate::generate_batch(config).unwrap();
            assert_eq!(batch.units.len(), 10);
        }
    }

    #[test]
    fn a_hatch_aperture_in_the_occupied_source_roof_is_still_refused() {
        let mut unit = occupation_fixture();
        let hole = rectangle(14.6, 14.4, 0.66, 1.06);
        let bi = unit
            .bodies
            .iter()
            .position(|b| b.id == "unit-2:body:3")
            .unwrap();
        let ti = unit
            .features
            .iter()
            .position(|f| f.id == "terrace:unit-2:body:3:1")
            .unwrap();
        let slab = unit.bodies[bi].levels[1].roof_slab.as_mut().unwrap();
        slab.surface = difference(&slab.surface, &hole);
        unit.features[ti].surface = difference(&unit.features[ti].surface, &hole);
        let mut hatch = unit
            .features
            .iter()
            .find(|f| f.kind == FeatureKind::Hatch)
            .unwrap()
            .clone();
        hatch.id = "fixture-hatch-in-occupation".into();
        hatch.surface = hole;
        unit.features.push(hatch);
        assert!(
            native_roof_walk_component(&unit, low_node(&unit))
                .unwrap_err()
                .contains("toiture porteuse")
        );
    }
    fn fixture() -> HouseUnit {
        crate::access::public_roofs::walk_component_fixture()
    }
    fn node(unit: &HouseUnit) -> &AccessNode {
        unit.access.nodes.iter().find(|n| n.id == "roof").unwrap()
    }

    #[test]
    fn native_siblings_are_independent_of_the_last_hatch_label() {
        let mut unit = fixture();
        let sibling = AccessNode {
            id: "sibling".into(),
            floor: rectangle(10.0, -4.0, 2.0, 2.0),
            ..node(&unit).clone()
        };
        let slab = unit.bodies[0].levels[2].roof_slab.as_mut().unwrap();
        slab.surface.extend(sibling.floor.clone());
        slab.access_node = Some(sibling.id.clone());
        unit.access.nodes.push(sibling.clone());
        native_roof_walk_component(&unit, node(&unit)).unwrap();
        native_roof_walk_component(&unit, &sibling).unwrap();
    }

    #[test]
    fn point_touching_polygons_never_become_one_walk_component() {
        let mut unit = fixture();
        let sibling = AccessNode {
            id: "sibling".into(),
            floor: rectangle(7.0, -0.566, 2.0, 2.0),
            ..node(&unit).clone()
        };
        unit.bodies[0].levels[2]
            .roof_slab
            .as_mut()
            .unwrap()
            .surface
            .extend(sibling.floor.clone());
        unit.access.nodes.push(sibling.clone());
        native_roof_walk_component(&unit, node(&unit)).unwrap();
        native_roof_walk_component(&unit, &sibling).unwrap();
        let combined = unit.bodies[0].levels[2]
            .roof_slab
            .as_ref()
            .unwrap()
            .surface
            .clone();
        unit.access
            .nodes
            .iter_mut()
            .find(|n| n.id == "roof")
            .unwrap()
            .floor = combined;
        assert!(native_roof_walk_component(&unit, node(&unit)).is_err());
    }

    #[test]
    fn private_or_other_walk_node_cannot_duplicate_a_component() {
        for kind in [AccessKind::Terrace, AccessKind::Circulation] {
            let mut unit = fixture();
            let duplicate = AccessNode {
                id: "duplicate".into(),
                kind,
                household_id: Some("private".into()),
                ..node(&unit).clone()
            };
            unit.access.nodes.push(duplicate);
            assert!(
                native_roof_walk_component(&unit, node(&unit))
                    .unwrap_err()
                    .contains("plusieurs")
            );
        }
    }

    #[test]
    fn near_cotes_keep_native_keys_and_unilateral_cuts_are_rejected() {
        let mut unit = fixture();
        unit.bodies[0].levels[2].roof_slab.as_mut().unwrap().z_m = 8.4006;
        assert!(native_roof_walk_component(&unit, node(&unit)).is_err());
        let mut unit = fixture();
        let target = unit
            .access
            .nodes
            .iter_mut()
            .find(|n| n.id == "roof")
            .unwrap();
        target.floor = difference(&target.floor, &rectangle(-1.0, -2.0, 0.2, 0.2));
        assert!(
            native_roof_walk_component(&unit, node(&unit))
                .unwrap_err()
                .contains("unilatérales")
        );
    }

    #[test]
    fn misleading_label_or_subset_node_does_not_establish_native_origin() {
        let mut unit = fixture();
        let slab = unit.bodies[0].levels[2].roof_slab.as_mut().unwrap();
        slab.access_node = Some("roof".into());
        slab.surface = rectangle(10.0, 10.0, 1.0, 1.0);
        assert!(native_roof_walk_component(&unit, node(&unit)).is_err());
        let mut unit = fixture();
        unit.access
            .nodes
            .iter_mut()
            .find(|n| n.id == "roof")
            .unwrap()
            .floor = rectangle(-1.0, -2.0, 0.2, 0.2);
        assert!(native_roof_walk_component(&unit, node(&unit)).is_err());
    }
}
