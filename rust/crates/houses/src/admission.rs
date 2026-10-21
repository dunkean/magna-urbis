//! Offline small table for urban parcels, derived from actual minimum native
//! plans, supports, circulation and roof geometry without interior generation.
use crate::catalogue::{Layout, Parameters, catalogue};
use crate::engine::{ResolvedArchitecture, volume_unit};
use crate::geometry::{area, bounds};
use crate::model::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinimumAdmissionProfile {
    pub recipe_id: String,
    pub pack: String,
    pub layout: Layout,
    pub floors: [u32; 2],
    pub eras: Vec<String>,
    pub min_envelope_m: [f64; 2],
    pub min_access_width_m: f64,
    pub provenance: String,
    pub status: String,
    pub refusal: Option<String>,
}

pub(crate) fn minimum(p: &mut Parameters) {
    for range in [
        &mut p.width_m,
        &mut p.depth_m,
        &mut p.wall_thickness_m,
        &mut p.courtyard_ratio,
        &mut p.overhang_m,
        &mut p.roof_pitch_deg,
        &mut p.support.height_m,
    ] {
        range[1] = range[0];
    }
    for range in [
        &mut p.floors,
        &mut p.bodies,
        &mut p.cells,
        &mut p.rooms_per_body,
    ] {
        range[1] = range[0];
    }
    for c in &mut p.components {
        for range in [&mut c.count, &mut c.floors, &mut c.rooms_per_body] {
            range[1] = range[0];
        }
        for range in [
            &mut c.width_ratio,
            &mut c.depth_ratio,
            &mut c.wall_thickness_m,
            &mut c.courtyard_ratio,
            &mut c.overhang_m,
            &mut c.roof_pitch_deg,
            &mut c.support.height_m,
        ] {
            range[1] = range[0];
        }
    }
}

pub fn minimum_admission_profiles() -> Result<Vec<MinimumAdmissionProfile>, String> {
    let data = catalogue()?;
    let mut profiles = vec![];
    for recipe in data.recipes.iter().filter(|r| r.role.residential()) {
        let mut parameters = recipe.parameters.clone();
        minimum(&mut parameters);
        let seed = format!("urban-admission-v1:{}", recipe.id);
        let evaluated = (|| -> Result<([f64; 2], f64), String> {
            let plan = crate::layouts::build_layout(recipe, &parameters, &seed)?;
            let resolved = ResolvedArchitecture {
                schema_version: crate::SCHEMA_VERSION.into(),
                generator_version: crate::GENERATOR_VERSION.into(),
                config: HouseConfig {
                    pack: recipe.pack_id.clone(),
                    recipe: Some(recipe.id.clone()),
                    seed: seed.clone(),
                    count: 1,
                    ..HouseConfig::default()
                },
                recipe_id: recipe.id.clone(),
                parameters: parameters.clone(),
                plan,
                entrance: None,
            };
            let mut unit = volume_unit(&resolved)?;
            let entrance =
                crate::access::structural_access(&mut unit, &resolved.plan.paths, &parameters)?;
            let mut domains: Vec<_> = unit
                .bodies
                .iter()
                .flat_map(|b| b.levels.iter().map(|l| l.footprint.clone()))
                .collect();
            domains.extend([
                resolved.plan.courts.clone(),
                resolved.plan.paths.clone(),
                entrance.passage,
            ]);
            domains.extend(unit.features.iter().map(|f| f.surface.clone()));
            domains.extend(unit.roofs.faces.iter().filter_map(|face| {
                let surface = vec![Polygon {
                    outer: face
                        .vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            Point { x: v.x, y: v.y }
                        })
                        .collect(),
                    holes: vec![],
                }];
                (area(&surface) > 1e-8).then_some(surface)
            }));
            // Bounds of the complete native geometry, not a bounding-box test of
            // the parcel. The cadastral stage must fit this whole witness.
            let all = domains.into_iter().flatten().collect();
            let b = bounds(&all);
            if !b.iter().all(|v| v.is_finite()) {
                return Err("Non-finite minimum native envelope.".into());
            }
            Ok((
                [b[2] - b[0], b[3] - b[1]],
                entrance.width_m.max(
                    parameters
                        .enclosures
                        .iter()
                        .map(|e| e.gate_width_m)
                        .fold(0.8, f64::max),
                ),
            ))
        })();
        let (min_envelope_m, min_access_width_m, status, refusal) = match evaluated {
            Ok((envelope, access)) => (envelope, access, "supported".into(), None),
            Err(reason) => ([0., 0.], 0., "refused".into(), Some(reason)),
        };
        profiles.push(MinimumAdmissionProfile {recipe_id:recipe.id.clone(),pack:recipe.pack_id.clone(),layout:parameters.layout,floors:recipe.parameters.floors,eras:recipe.temporal.eras.clone(),
            min_envelope_m,min_access_width_m,status,refusal,
            provenance:format!("Native minimum default-bundle layout, roof, enclosure and access skeleton; seed {seed}; metres; no interiors.")});
    }
    profiles.sort_by(|a, b| a.recipe_id.cmp(&b.recipe_id));
    Ok(profiles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    #[test]
    fn versioned_urban_admission_matches_native_minimum_plans() {
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("../data/urban-admission.json")).unwrap();
        assert_eq!(
            expected["source_sha256"],
            format!(
                "{:x}",
                Sha256::digest(include_bytes!("../data/recipes.json"))
            )
        );
        assert_eq!(expected["generator_version"], crate::GENERATOR_VERSION);
        let saved: Vec<MinimumAdmissionProfile> =
            serde_json::from_value(expected["profiles"].clone()).unwrap();
        let current = minimum_admission_profiles().unwrap();
        assert_eq!(saved.len(), current.len());
        for (mut expected, actual) in saved.into_iter().zip(&current) {
            assert_eq!(expected.recipe_id, actual.recipe_id);
            // serde_json's text parser can move an f64 by one ULP relative to
            // to_value. A nanometre tolerance excludes that serialization noise.
            for (a, b) in expected
                .min_envelope_m
                .into_iter()
                .zip(actual.min_envelope_m)
            {
                assert!(
                    (a - b).abs() < 1e-9,
                    "{} envelope drift: {a} != {b}",
                    actual.recipe_id
                );
            }
            assert!(
                (expected.min_access_width_m - actual.min_access_width_m).abs() < 1e-9,
                "{} access drift",
                actual.recipe_id
            );
            expected.min_envelope_m = actual.min_envelope_m;
            expected.min_access_width_m = actual.min_access_width_m;
            assert_eq!(
                serde_json::to_value(expected).unwrap(),
                serde_json::to_value(actual).unwrap(),
                "{} admission metadata drift",
                actual.recipe_id
            );
        }
        for pack in &catalogue().unwrap().packs {
            assert!(
                current
                    .iter()
                    .any(|p| p.pack == pack.id && p.status == "supported"),
                "{} has no geometric route",
                pack.id
            );
        }
    }
}
