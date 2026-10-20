//! Reviewed legacy-only component selection. No NativeDomain or new tolerance.
use crate::geometry::{self as g, area, difference, intersection, unite};
use crate::model::{
    HouseUnit, Point, Polygon, RoofArm, RoofAttachment, RoofTriangulation, Surface,
};
use geo::{Contains, Intersects};
use std::collections::BTreeSet;

fn radial(arm: &RoofArm) -> bool {
    arm.domain.len() == 1 && arm.domain[0].holes.is_empty() && arm.domain[0].outer.len() == 3
}

fn point_in_hole(p: Point, hole: &[Point]) -> bool {
    g::to_geo(&vec![Polygon {
        outer: hole.to_vec(),
        holes: vec![],
    }])
    .contains(&geo::Point::new(p.x, p.y))
}

/// Validate an explicit reference to the CURRENT Attachment.domain.
pub(crate) fn validate(roof: &RoofAttachment) -> Result<(), String> {
    let indexed = roof.arms.iter().any(|a| a.source_component.is_some());
    if !indexed {
        return Ok(());
    }
    if roof.arms.iter().any(|a| a.source_component.is_none()) {
        return Err("Bras de couverture indexés et non indexés mélangés.".into());
    }
    if roof.domain.len() > 1 && roof.spec.triangulation == Some(RoofTriangulation::Boundary) {
        return Err("Couverture Boundary multicomposante indexée non prise en charge.".into());
    }
    let indices = roof
        .arms
        .iter()
        .filter_map(|a| a.source_component)
        .collect::<BTreeSet<_>>();
    if indices.len() != roof.domain.len()
        || indices.iter().enumerate().any(|(i, &c)| c as usize != i)
    {
        return Err(
            "Indices de composantes de couverture incomplets ou hors domaine courant.".into(),
        );
    }
    for arm in &roof.arms {
        let c = arm.source_component.unwrap() as usize;
        if radial(arm) {
            let apex = arm.domain[0].outer[0];
            let holes = roof
                .domain
                .iter()
                .enumerate()
                .flat_map(|(i, p)| p.holes.iter().map(move |h| (i, h)));
            let owners = holes
                .filter(|(_, h)| point_in_hole(apex, h))
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            if owners != vec![c]
                || roof.domain.iter().enumerate().any(|(i, p)| {
                    i != c
                        && g::to_geo(&vec![p.clone()]).intersects(&geo::Point::new(apex.x, apex.y))
                })
            {
                return Err("Apex Raw sans trou strict unique de la composante courante.".into());
            }
        } else if roof
            .domain
            .iter()
            .enumerate()
            .any(|(i, p)| i != c && g::to_geo(&vec![p.clone()]).intersects(&g::to_geo(&arm.domain)))
        {
            return Err("Masque de bande dans une composante sœur.".into());
        }
    }
    coverage(&roof.domain, &roof.arms)
}

/// Existing legacy coverage tolerance only; this is not an exact mesh claim.
pub(crate) fn coverage(domain: &Surface, arms: &[RoofArm]) -> Result<(), String> {
    for (index, polygon) in domain.iter().enumerate() {
        let source = vec![polygon.clone()];
        let portions = arms
            .iter()
            .filter(|a| a.source_component == Some(index as u32))
            .map(|a| intersection(&source, &a.domain))
            .collect::<Vec<_>>();
        if portions.is_empty()
            || area(&difference(&source, &unite(&portions))) > g::area_tolerance(&source)
        {
            return Err(format!(
                "Composante {index} de couverture incomplète selon le contrat legacy."
            ));
        }
    }
    Ok(())
}

pub(crate) fn owner(unit: &HouseUnit, roof: &RoofAttachment) -> Result<(), String> {
    if roof.arms.iter().all(|a| a.source_component.is_none()) {
        return Ok(());
    }
    if let Some(id) = &roof.owner_body_id {
        let bodies = unit
            .bodies
            .iter()
            .filter(|b| &b.id == id)
            .collect::<Vec<_>>();
        if bodies.len() != 1
            || bodies[0]
                .levels
                .iter()
                .filter(|l| l.index == roof.level)
                .count()
                != 1
        {
            return Err("Attribution propriétaire/niveau de couverture non unique.".into());
        }
    }
    Ok(())
}

pub(crate) fn selected(domain: &Surface, arm: &RoofArm) -> Result<Surface, String> {
    match arm.source_component {
        Some(c) => domain
            .get(c as usize)
            .cloned()
            .map(|p| vec![p])
            .ok_or_else(|| "Index de composante hors domaine de couverture courant.".into()),
        None => Ok(domain.clone()),
    }
}

pub(crate) fn portion(
    source: &Surface,
    arm: &RoofArm,
    covered: &Surface,
) -> Result<Surface, String> {
    let component = selected(source, arm)?;
    let portion = intersection(covered, &intersection(&component, &arm.domain));
    if area(&difference(&portion, &component)) > g::area_tolerance(&component) {
        return Err("Portion de couverture hors de sa composante courante.".into());
    }
    Ok(portion)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (HouseUnit, RoofAttachment) {
        let value: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/meso-components-before-access.json"
        ))
        .unwrap();
        let mut unit: HouseUnit = serde_json::from_value(value["unit"].clone()).unwrap();
        let feature = unit
            .features
            .iter_mut()
            .find(|f| f.id == "detail-galleries-9")
            .unwrap();
        let roof = feature.roof.as_mut().unwrap();
        for (i, arm) in roof.arms.iter_mut().enumerate() {
            arm.source_component = Some(if i < 4 { 0 } else { 1 });
        }
        let roof = roof.clone();
        (unit, roof)
    }
    #[test]
    fn current_mixed_fixture_keeps_masks_and_current_components() {
        let (unit, roof) = fixture();
        validate(&roof).unwrap();
        owner(&unit, &roof).unwrap();
        for arm in &roof.arms {
            let c = arm.source_component.unwrap() as usize;
            let selected = selected(&roof.domain, arm).unwrap();
            assert_eq!(
                serde_json::to_vec(&selected).unwrap(),
                serde_json::to_vec(&vec![roof.domain[c].clone()]).unwrap()
            );
            let d = portion(&roof.domain, arm, &roof.domain).unwrap();
            let foreign = vec![roof.domain[1 - c].clone()];
            assert_eq!(area(&intersection(&d, &foreign)), 0.0);
        }
    }
    #[test]
    fn serde_omits_none_and_preserves_explicit_index() {
        let (_, roof) = fixture();
        let mut arm = roof.arms[0].clone();
        arm.source_component = None;
        let json = serde_json::to_value(&arm).unwrap();
        assert!(json.get("source_component").is_none());
        let read: RoofArm = serde_json::from_value(json).unwrap();
        assert_eq!(read.source_component, None);
        arm.source_component = Some(1);
        let read: RoofArm = serde_json::from_str(&serde_json::to_string(&arm).unwrap()).unwrap();
        assert_eq!(read.source_component, Some(1));
    }
    #[test]
    fn all_none_is_legacy_and_partial_or_foreign_indices_are_closed() {
        let (_, roof) = fixture();
        let mut legacy = roof.clone();
        for arm in &mut legacy.arms {
            arm.source_component = None;
        }
        validate(&legacy).unwrap();
        for mutation in 0..4 {
            let mut r = roof.clone();
            match mutation {
                0 => r.arms[0].source_component = None,
                1 => r.arms[0].source_component = Some(2),
                2 => r.arms[4].source_component = Some(0),
                _ => r.arms[0].source_component = Some(1),
            }
            assert!(validate(&r).is_err(), "mutation {mutation}");
        }
    }
    #[test]
    fn split_current_gallery_keeps_four_legacy_none_arms() {
        let (_, mut roof) = fixture();
        // The real four-band component of the captured gallery, before a trim.
        roof.domain = vec![roof.domain[0].clone()];
        roof.arms.truncate(4);
        for arm in &mut roof.arms {
            arm.source_component = None;
        }
        assert_eq!(roof.domain.len(), 1);
        assert_eq!(roof.domain[0].outer.len(), 4);
        assert_eq!(roof.domain[0].holes.len(), 1);
        assert_eq!(roof.domain[0].holes[0].len(), 4);
        assert_eq!(roof.arms.len(), 4);
        validate(&roof).unwrap();
        let old_arms = serde_json::to_vec(&roof.arms).unwrap();
        let b = g::bounds(&roof.domain);
        let cut = g::rectangle(
            (b[0] + b[2]) * 0.5 - 0.1,
            b[1] - 1.0,
            0.2,
            b[3] - b[1] + 2.0,
        );
        roof.domain = difference(&roof.domain, &cut);
        assert_eq!(roof.domain.len(), 2);
        assert!(roof.arms.iter().any(|arm| {
            roof.domain
                .iter()
                .filter(|polygon| area(&intersection(&vec![(*polygon).clone()], &arm.domain)) > 0.0)
                .count()
                == 2
        }));
        assert!(roof.arms.iter().all(|arm| arm.source_component.is_none()));
        assert_eq!(serde_json::to_vec(&roof.arms).unwrap(), old_arms);
        validate(&roof).unwrap();
        for arm in &roof.arms {
            assert_eq!(selected(&roof.domain, arm).unwrap(), roof.domain);
        }
    }
    #[test]
    fn reordered_split_removed_hole_and_boundary_domains_are_closed() {
        let (_, roof) = fixture();
        for mutation in 0..4 {
            let mut r = roof.clone();
            match mutation {
                0 => r.domain.swap(0, 1),
                1 => {
                    let b = g::bounds(&vec![r.domain[1].clone()]);
                    let cut = g::rectangle(
                        (b[0] + b[2]) * 0.5 - 0.1,
                        b[1] - 1.0,
                        0.2,
                        b[3] - b[1] + 2.0,
                    );
                    let parts = difference(&vec![r.domain[1].clone()], &cut);
                    assert_eq!(parts.len(), 2);
                    r.domain.pop();
                    r.domain.extend(parts);
                }
                2 => r.domain[1].holes.clear(),
                _ => r.spec.triangulation = Some(RoofTriangulation::Boundary),
            }
            assert!(validate(&r).is_err(), "mutation {mutation}");
        }
    }
    #[test]
    fn apex_boundary_foreign_band_and_nonunique_owner_are_closed() {
        let (mut unit, roof) = fixture();
        let mut r = roof.clone();
        r.arms[4].domain[0].outer[0] = r.domain[1].holes[0][0];
        assert!(validate(&r).is_err());
        let mut r = roof.clone();
        r.arms[0].domain.push(r.domain[1].clone());
        assert!(validate(&r).is_err());
        let body = unit
            .bodies
            .iter()
            .find(|b| Some(&b.id) == roof.owner_body_id.as_ref())
            .unwrap()
            .clone();
        unit.bodies.push(body);
        assert!(owner(&unit, &roof).is_err());
    }
    #[test]
    fn source_component_on_body_is_rejected_before_mesh_install() {
        let (mut unit, roof) = fixture();
        unit.bodies[0].roof_arms.push(roof.arms[0].clone());
        let before = serde_json::to_vec(&unit.roofs).unwrap();
        let error = crate::roofs::build_roofs(&mut unit).unwrap_err();
        assert!(error.contains("Body"), "{error}");
        assert_eq!(serde_json::to_vec(&unit.roofs).unwrap(), before);
    }
}
