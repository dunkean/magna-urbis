//! Lossless retained architecture without repeated parameter bundles or surfaces.
//! This is a storage format, never a second procedural draw.
use crate::catalogue::{Parameters, catalogue};
use crate::engine::ResolvedArchitecture;
use crate::layouts::{BodySpec, LayoutPlan};
use crate::model::*;
use geo::algorithm::Validation;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
pub struct ParameterDelta {
    set: Map<String, Value>,
    remove: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct CompactBody {
    footprint: usize,
    voids: Vec<usize>,
    levels: Vec<usize>,
    cells: Vec<StructuralCell>,
    parameters: usize,
    role: Role,
    component: Option<String>,
    z: f64,
    arms: Vec<RoofArm>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(remote = "Self")]
pub struct CompactArchitecture {
    pub format: String,
    pub generator_version: String,
    pub catalogue_version: String,
    pub recipe_id: String,
    pub variant_id: String,
    config: HouseConfig,
    parameters: Vec<ParameterDelta>,
    surfaces: Vec<Surface>,
    lot: usize,
    courts: usize,
    paths: usize,
    bodies: Vec<CompactBody>,
    features: Vec<Feature>,
    context: Vec<Feature>,
    diagnostics: Vec<String>,
    entrance: Option<crate::access::StructuralEntrance>,
}

// JSON parsers (including JS) are free to round decimal doubles by an ulp.
// Exact roof junctions must survive cold storage; encode retained f64 bits only
// in this opaque format, without changing the project's historical JSON parser.
fn encode_floats(value: &mut Value) {
    match value {
        Value::Number(n) if n.is_f64() => {
            *value = serde_json::json!({"$f64": format!("{:016x}", n.as_f64().unwrap().to_bits())});
        }
        Value::Array(a) => a.iter_mut().for_each(encode_floats),
        Value::Object(o) => o.values_mut().for_each(encode_floats),
        _ => {}
    }
}
fn decode_floats(value: &mut Value) -> Result<(), String> {
    match value {
        Value::Object(o) if o.len() == 1 && o.contains_key("$f64") => {
            let hex = o["$f64"].as_str().ok_or("Invalid retained double.")?;
            if hex.len() != 16 {
                return Err("Invalid retained double length.".into());
            }
            let bits = u64::from_str_radix(hex, 16).map_err(|_| "Invalid retained double bits.")?;
            let number = serde_json::Number::from_f64(f64::from_bits(bits))
                .ok_or("Non-finite retained double.")?;
            *value = Value::Number(number);
        }
        Value::Array(a) => {
            for v in a {
                decode_floats(v)?;
            }
        }
        Value::Object(o) => {
            for v in o.values_mut() {
                decode_floats(v)?;
            }
        }
        _ => {}
    }
    Ok(())
}
impl Serialize for CompactArchitecture {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = Self::serialize(self, serde_json::value::Serializer)
            .map_err(serde::ser::Error::custom)?;
        encode_floats(&mut value);
        value.serialize(serializer)
    }
}
impl<'de> Deserialize<'de> for CompactArchitecture {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut value = Value::deserialize(deserializer)?;
        decode_floats(&mut value).map_err(serde::de::Error::custom)?;
        Self::deserialize(value).map_err(serde::de::Error::custom)
    }
}

fn source(
    config: &HouseConfig,
    recipe_id: &str,
    variant_id: &str,
) -> Result<&'static Parameters, String> {
    let data = catalogue()?;
    if config.workshop.is_some() {
        return data
            .workshop_presets
            .iter()
            .find(|p| p.id == recipe_id)
            .map(|p| &p.parameters)
            .ok_or_else(|| "Unknown compact workshop preset.".into());
    }
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.id == recipe_id)
        .ok_or("Unknown compact recipe.")?;
    if recipe.parameters.variant_id == variant_id {
        return Ok(&recipe.parameters);
    }
    recipe
        .variants
        .iter()
        .find(|v| v.parameters.variant_id == variant_id)
        .map(|v| &v.parameters)
        .ok_or_else(|| "Unknown compact recipe variant.".into())
}

impl ParameterDelta {
    fn between(base: &Value, value: &Value) -> Result<Self, String> {
        let base = base.as_object().ok_or("Invalid parameter base.")?;
        let value = value.as_object().ok_or("Invalid parameters.")?;
        Ok(Self {
            set: value
                .iter()
                .filter(|(key, v)| base.get(*key) != Some(*v))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            remove: base
                .keys()
                .filter(|k| !value.contains_key(*k))
                .cloned()
                .collect(),
        })
    }
    fn apply(&self, base: &Value) -> Result<Parameters, String> {
        let mut object = base.as_object().ok_or("Invalid parameter base.")?.clone();
        for key in &self.remove {
            object.remove(key);
        }
        object.extend(self.set.clone());
        serde_json::from_value(Value::Object(object)).map_err(|e| e.to_string())
    }
}

impl CompactArchitecture {
    /// Inspect an archive produced by the current planning pass without
    /// rebuilding its geometry. This flag does not validate external archives.
    pub(crate) fn has_retained_entrance(&self) -> bool {
        self.entrance.is_some()
    }

    pub fn pack(resolved: &ResolvedArchitecture) -> Result<Self, String> {
        let base = serde_json::to_value(source(
            &resolved.config,
            &resolved.recipe_id,
            &resolved.parameters.variant_id,
        )?)
        .map_err(|e| e.to_string())?;
        let mut parameters = vec![];
        let mut parameter_keys = BTreeMap::new();
        let mut intern_parameter = |p: &Parameters| -> Result<usize, String> {
            let value = serde_json::to_value(p).map_err(|e| e.to_string())?;
            let key = value.to_string();
            if let Some(index) = parameter_keys.get(&key) {
                return Ok(*index);
            }
            let index = parameters.len();
            parameters.push(ParameterDelta::between(&base, &value)?);
            parameter_keys.insert(key, index);
            Ok(index)
        };
        intern_parameter(&resolved.parameters)?;
        let mut surfaces = vec![];
        let mut surface_keys = BTreeMap::new();
        let mut intern = |s: &Surface| -> usize {
            let key = serde_json::to_string(s).expect("finite retained surfaces");
            if let Some(index) = surface_keys.get(&key) {
                return *index;
            }
            let index = surfaces.len();
            surfaces.push(s.clone());
            surface_keys.insert(key, index);
            index
        };
        let p = &resolved.plan;
        let (lot, courts, paths) = (intern(&p.lot), intern(&p.courts), intern(&p.paths));
        let mut bodies = vec![];
        for b in &p.bodies {
            bodies.push(CompactBody {
                footprint: intern(&b.footprint),
                voids: b.voids.iter().map(&mut intern).collect(),
                levels: b.levels.iter().map(&mut intern).collect(),
                cells: b.cells.clone(),
                parameters: intern_parameter(&b.parameters)?,
                role: b.role,
                component: b.component.clone(),
                z: b.z,
                arms: b.arms.clone(),
            });
        }
        Ok(Self {
            format: "compact-plan-1".into(),
            generator_version: resolved.generator_version.clone(),
            catalogue_version: catalogue()?.catalogue_version.clone(),
            recipe_id: resolved.recipe_id.clone(),
            variant_id: resolved.parameters.variant_id.clone(),
            config: resolved.config.clone(),
            parameters,
            surfaces,
            lot,
            courts,
            paths,
            bodies,
            features: p.features.clone(),
            context: p.context.clone(),
            diagnostics: p.diagnostics.clone(),
            entrance: resolved.entrance.clone(),
        })
    }

    pub fn unpack(&self) -> Result<ResolvedArchitecture, String> {
        if self.format != "compact-plan-1"
            || self.generator_version != crate::GENERATOR_VERSION
            || self.catalogue_version != catalogue()?.catalogue_version
        {
            return Err(
                "Retained compact plan version mismatch; the plan was not regenerated.".into(),
            );
        }
        catalogue()?.validate_config(&self.config)?;
        if self.bodies.len() > crate::engine::MAX_BODIES as usize
            || self.surfaces.len() > 10_000
            || self.parameters.len() > crate::engine::MAX_BODIES as usize + 1
            || self.features.len() + self.context.len() > 20_000
        {
            return Err("Compact architecture exceeds structural limits.".into());
        }
        let vertices: Vec<_> = self
            .surfaces
            .iter()
            .map(|s| {
                s.iter()
                    .map(|p| p.outer.len() + p.holes.iter().map(Vec::len).sum::<usize>())
                    .sum::<usize>()
            })
            .collect();
        let mut geometries: Vec<&Surface> = self.surfaces.iter().collect();
        for b in &self.bodies {
            geometries.extend(b.cells.iter().map(|c| &c.footprint));
            geometries.extend(b.arms.iter().map(|a| &a.domain));
        }
        for f in self.features.iter().chain(&self.context) {
            geometries.push(&f.surface);
            if let Some(roof) = &f.roof {
                geometries.push(&roof.domain);
                geometries.extend(roof.arms.iter().map(|a| &a.domain));
            }
        }
        if let Some(entrance) = &self.entrance {
            geometries.push(&entrance.passage);
        }
        if geometries
            .iter()
            .map(|s| {
                s.iter()
                    .map(|p| p.outer.len() + p.holes.iter().map(Vec::len).sum::<usize>())
                    .sum::<usize>()
            })
            .sum::<usize>()
            > 1_000_000
        {
            return Err("Compact surface vertex budget exceeded.".into());
        }
        for s in geometries {
            if !s.is_empty()
                && (!crate::placement::valid_surface(s) || !crate::geometry::to_geo(s).is_valid())
            {
                return Err("Invalid retained surface geometry.".into());
            }
        }
        let mut expanded = 0usize;
        for b in &self.bodies {
            if b.levels.is_empty()
                || b.levels.len() > 64
                || b.voids.len() > 256
                || b.cells.len() > 2400
                || b.arms.len() > 256
                || !b.z.is_finite()
            {
                return Err("Compact body exceeds structural limits.".into());
            }
            for index in std::iter::once(&b.footprint)
                .chain(&b.levels)
                .chain(&b.voids)
            {
                expanded = expanded
                    .checked_add(
                        *vertices
                            .get(*index)
                            .ok_or("Invalid compact surface reference.")?,
                    )
                    .ok_or("Expanded geometry overflow.")?;
                if expanded > 2_000_000 {
                    return Err("Expanded geometry vertex budget exceeded.".into());
                }
            }
        }
        let base = serde_json::to_value(source(&self.config, &self.recipe_id, &self.variant_id)?)
            .map_err(|e| e.to_string())?;
        let parameters: Vec<_> = self
            .parameters
            .iter()
            .map(|d| d.apply(&base))
            .collect::<Result<_, _>>()?;
        for p in &parameters {
            catalogue()?.validate_parameters(p)?;
            if !p.level_height_m.is_finite()
                || p.level_height_m <= 0.
                || p.level_height_m > 100.
                || p.overhang_m
                    .iter()
                    .any(|v| !v.is_finite() || *v < 0. || *v > 100.)
                || p.roof_pitch_deg
                    .iter()
                    .any(|v| !v.is_finite() || *v < 0. || *v >= 90.)
            {
                return Err("Invalid retained building dimensions.".into());
            }
        }
        let get_surface = |index: usize| {
            self.surfaces
                .get(index)
                .cloned()
                .ok_or_else(|| "Invalid compact surface reference.".to_string())
        };
        let mut bodies = vec![];
        for b in &self.bodies {
            if std::iter::once(&b.footprint)
                .chain(&b.levels)
                .any(|i| self.surfaces.get(*i).is_none_or(Vec::is_empty))
            {
                return Err("Retained body or level has no footprint.".into());
            }
            bodies.push(BodySpec {
                footprint: get_surface(b.footprint)?,
                voids: b
                    .voids
                    .iter()
                    .map(|i| get_surface(*i))
                    .collect::<Result<_, _>>()?,
                levels: b
                    .levels
                    .iter()
                    .map(|i| get_surface(*i))
                    .collect::<Result<_, _>>()?,
                cells: b.cells.clone(),
                parameters: parameters
                    .get(b.parameters)
                    .cloned()
                    .ok_or("Invalid compact parameter reference.")?,
                role: b.role,
                component: b.component.clone(),
                z: b.z,
                arms: b.arms.clone(),
            });
        }
        Ok(ResolvedArchitecture {
            schema_version: crate::SCHEMA_VERSION.into(),
            generator_version: self.generator_version.clone(),
            config: self.config.clone(),
            recipe_id: self.recipe_id.clone(),
            parameters: parameters
                .first()
                .cloned()
                .ok_or("Missing root parameters.")?,
            plan: LayoutPlan {
                lot: get_surface(self.lot)?,
                courts: get_surface(self.courts)?,
                paths: get_surface(self.paths)?,
                bodies,
                features: self.features.clone(),
                context: self.context.clone(),
                diagnostics: self.diagnostics.clone(),
            },
            entrance: self.entrance.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lossless_replay_and_version_rejection() {
        let original = crate::resolve_architecture(HouseConfig {
            recipe: Some("EUR-MED-B02".into()),
            count: 1,
            ..Default::default()
        })
        .unwrap();
        let compact = CompactArchitecture::pack(&original).unwrap();
        let bytes = serde_json::to_vec(&compact).unwrap();
        let restored: CompactArchitecture = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            serde_json::to_value(&original).unwrap(),
            serde_json::to_value(restored.unpack().unwrap()).unwrap()
        );
        assert!(bytes.len() < serde_json::to_vec(&original).unwrap().len());
        let mut old = restored;
        old.catalogue_version = "old".into();
        assert!(old.unpack().is_err());
    }
    #[test]
    fn corrupt_surface_reference_is_refused() {
        let original = crate::resolve_architecture(HouseConfig {
            count: 1,
            ..Default::default()
        })
        .unwrap();
        let mut compact = CompactArchitecture::pack(&original).unwrap();
        compact.lot = usize::MAX;
        assert!(compact.unpack().is_err());
    }
    #[test]
    fn expanded_references_and_negative_parameters_are_refused() {
        let original = crate::resolve_architecture(HouseConfig {
            count: 1,
            ..Default::default()
        })
        .unwrap();
        let mut c = CompactArchitecture::pack(&original).unwrap();
        c.bodies[0].levels = vec![c.bodies[0].footprint; 100_000];
        assert!(c.unpack().is_err());
        let mut c = CompactArchitecture::pack(&original).unwrap();
        c.parameters[0]
            .set
            .insert("level_height_m".into(), serde_json::json!(-2.));
        assert!(c.unpack().is_err());
    }
}
