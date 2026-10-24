//! Urban wishes, distinct from explicit Houses controls and cadastral rights.
//! No functional or historical capability is inferred from a role label.
use crate::catalogue::{Layout, Parameters, Placement};
use crate::model::HouseConfig;
use crate::style_index::{Morphology, StyleEntry, morphology};
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};
#[path = "housing_floor_need.rs"]
mod housing_floor_need;
pub use housing_floor_need::{HousingFloorModel, HousingFloorNeed};
pub(crate) use housing_floor_need::accounting_close;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgrammeComposition {
    Row,
    Detached,
    Courtyard,
    Farm,
    Compound,
    Hall,
    Religious,
    Civic,
    Defence,
    Inn,
}

impl ProgrammeComposition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Row => "row",
            Self::Detached => "detached",
            Self::Courtyard => "courtyard",
            Self::Farm => "farm",
            Self::Compound => "compound",
            Self::Hall => "hall",
            Self::Religious => "religious",
            Self::Civic => "civic",
            Self::Defence => "defence",
            Self::Inn => "inn",
        }
    }

    pub(crate) fn residential(self) -> bool {
        matches!(
            self,
            Self::Row | Self::Detached | Self::Courtyard | Self::Farm | Self::Compound
        )
    }

    /// A preference rank, never a promise about a functional programme. Native
    /// courtyard and authored compound families remain distinct candidates.
    pub(crate) fn rank(self, p: &Parameters) -> u8 {
        let shape = morphology(p);
        match self {
            Self::Row => u8::from(p.layout != Layout::Strip),
            Self::Detached => u8::from(shape != Morphology::Single),
            Self::Courtyard => u8::from(shape != Morphology::Courtyard),
            Self::Compound => match shape {
                Morphology::Compound => 0,
                Morphology::Courtyard => 1,
                _ => 2,
            },
            Self::Farm => u8::from(!matches!(
                shape,
                Morphology::Courtyard | Morphology::Compound
            )),
            // No civic/religious/defensive/hall/inn adapter is declared here.
            _ => 0,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ArchitectureProgramme {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub landmark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub district_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wealth: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub households: Option<f64>,
    /// Indicative useful-floor allocation model, separate from massing wishes.
    /// Never a dimension control or a claim about actual useful/housed capacity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub housing_floor_need: Option<HousingFloorNeed>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composition: Option<ProgrammeComposition>,
    /// Preferred inclusive range for the main inhabited body, not every tower.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floors: Option<[u32; 2]>,
    /// Desired projected body footprint; not useful floor area or parcel area.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_area_m2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontage_continuity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party_walls: Option<bool>,
}

/// Intersect the parent bounds with the actual main residential component.
/// A tower's height does not authorize raising the main house to that height.
pub(crate) fn primary_floors(p: &Parameters) -> [u32; 2] {
    let resident = |c: &&crate::catalogue::Component| {
        c.role.residential() && c.placement != Placement::FacingMain
    };
    let primary = p
        .components
        .iter()
        .filter(resident)
        .find(|c| c.placement == Placement::Main)
        .or_else(|| {
            p.components
                .iter()
                .find(|c| c.role.residential() && c.placement != Placement::FacingMain)
        });
    primary.map_or(p.floors, |c| {
        [p.floors[0].max(c.floors[0]), p.floors[1].min(c.floors[1])]
    })
}

impl ArchitectureProgramme {
    pub fn validate(&self) -> Result<(), String> {
        if self.floors.is_some_and(|[lo, hi]| lo == 0 || lo > hi) {
            return Err("Invalid programme.floors: expected a positive inclusive range.".into());
        }
        if self
            .built_area_m2
            .is_some_and(|v| !v.is_finite() || v <= 0.)
        {
            return Err(
                "Invalid programme.built_area_m2: expected a positive footprint target.".into(),
            );
        }
        if self
            .frontage_continuity
            .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        {
            return Err("Invalid programme.frontage_continuity: expected 0..1.".into());
        }
        if self
            .wealth
            .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
            || self.households.is_some_and(|v| !v.is_finite() || v < 0.)
        {
            return Err("Invalid programme wealth or household metadata.".into());
        }
        if let Some(need) = &self.housing_floor_need {
            need.validate(self.households)?;
        }
        Ok(())
    }

    pub(crate) fn has_wishes(&self) -> bool {
        self.composition.is_some()
            || self.floors.is_some()
            || self.built_area_m2.is_some()
            || self.frontage_continuity.is_some()
            || self.party_walls.is_some()
    }

    pub(crate) fn rank(&self, entry: &StyleEntry, config: &HouseConfig) -> (u8, u32) {
        let composition = self.composition.map_or(0, |c| c.rank(entry.parameters()));
        let floors = if config.overrides.floors.is_some() {
            0
        } else {
            self.floors.map_or(0, |wish| {
                let source = primary_floors(entry.parameters());
                if source[0] > source[1] {
                    return u32::MAX;
                }
                source[0]
                    .saturating_sub(wish[1])
                    .max(wish[0].saturating_sub(source[1]))
            })
        };
        (composition, floors)
    }

    /// Choose only inside declared compatible bounds. This draw happens after
    /// canonical explicit-config filtering; omission never introduces a control.
    pub(crate) fn preferred_floor(
        &self,
        entry: &StyleEntry,
        config: &HouseConfig,
        seed: &str,
    ) -> Option<u32> {
        if config.overrides.floors.is_some() {
            return None;
        }
        let wish = self.floors?;
        let source = primary_floors(entry.parameters());
        let lo = source[0].max(wish[0]);
        let hi = source[1].min(wish[1]);
        (lo <= hi).then(|| {
            Rng::new(seed)
                .fork("urban-programme-floors-v1")
                .fork(&entry.id)
                .int(lo, hi)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{area, difference, intersection, rectangle};
    use crate::model::HistoricalMode;
    use crate::placement::{ArchitectureFunction, PlacementBatchSettings, PlacementRequest};
    use crate::plans::{PlanBatch, PlanBatchRequest, PlanBuilding, plan_batch};
    use crate::style_index::{StyleQuery, style_index};
    use std::collections::{BTreeMap, BTreeSet};

    fn site(id: &str, width: f64, depth: f64) -> PlacementRequest {
        serde_json::from_value(serde_json::json!({
            "id":id,"parcel_id":id,"seed":format!("programme/{id}"),
            "cadastral":rectangle(0.,0.,width,depth),"buildable":rectangle(0.,0.,width,depth),"reserves":[],
            "roof_domain":rectangle(0.,0.,width,depth),
            "accesses":[{"id":"front","segment":[{"x":0.,"y":depth},{"x":width,"y":depth}],"kind":"public","width_m":2.}],
            "party_boundaries":[],"neighbors":[],"culture":{"culture":"european-organic","pack":"EUR-MED","mode":"historical_inspired","borrowing":null},
            "function":"domestic","terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":1.},
            "config":{}
        })).unwrap()
    }
    fn run(r: &PlacementRequest, settings: Option<PlacementBatchSettings>) -> PlanBatch {
        plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests: vec![r.clone()],
            settings,
            footprints: BTreeMap::new(),
        })
        .unwrap()
    }
    fn one(r: &PlacementRequest) -> PlanBuilding {
        let mut batch = run(r, None);
        assert_eq!(batch.buildings.len(), 1, "{:?}", batch.refusals);
        let b = batch.buildings.pop().unwrap();
        assert!(area(&difference(&b.footprint, &r.buildable)) < 0.0001);
        assert!(
            area(&difference(
                &b.roof_footprint,
                r.roof_domain.as_ref().unwrap()
            )) < 0.0001
        );
        assert!(area(&intersection(&b.footprint, &r.reserves)) < 0.0001);
        b
    }
    fn wishes(composition: ProgrammeComposition) -> ArchitectureProgramme {
        ArchitectureProgramme {
            composition: Some(composition),
            floors: Some([1, 2]),
            ..Default::default()
        }
    }
    fn physical(b: &PlanBuilding) -> serde_json::Value {
        let mut value = serde_json::to_value(b).unwrap();
        value.as_object_mut().unwrap().remove("diagnostics");
        // These tests compare retained physical plans under different wishes.
        // The additive accounting must report those distinct wishes; it is
        // checked separately below, never counted as a geometry difference.
        value.as_object_mut().unwrap().remove("programme_outcome");
        value
    }

    #[test]
    fn urban_programme_narrow_row_preserves_legacy_and_hard_floors() {
        let mut r = site("narrow-row", 12., 30.);
        let old = run(&r, None);
        r.programme = Some(ArchitectureProgramme {
            role: Some("dwelling.row".into()),
            landmark: Some(false),
            ..Default::default()
        });
        assert_eq!(
            serde_json::to_value(old).unwrap(),
            serde_json::to_value(run(&r, None)).unwrap()
        );
        let legacy = one(&r);
        // Area is now active for automatic single-range domestic plans; an
        // explicitly selected source/variant still retains its native plan.
        let mut pinned = r.clone();
        pinned.config.as_mut().unwrap().recipe = Some(legacy.recipe_id.clone());
        pinned.config.as_mut().unwrap().overrides.variant = Some(legacy.variant_id.clone());
        let explicit = one(&pinned);
        pinned.programme = Some(ArchitectureProgramme {
            built_area_m2: Some(200.),
            frontage_continuity: Some(0.5),
            party_walls: Some(true),
            ..Default::default()
        });
        let advisory = one(&pinned);
        assert_eq!(physical(&explicit), physical(&advisory));
        assert_eq!(explicit.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, None);
        assert_eq!(advisory.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, Some(200.));
        assert_eq!(advisory.programme_outcome.as_ref().unwrap().households.housed, None);
        r.programme = Some(ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Civic),
            ..Default::default()
        });
        assert_eq!(physical(&legacy), physical(&one(&r)));
        r.programme = Some(ArchitectureProgramme {
            floors: Some([2, 3]),
            frontage_continuity: Some(1.),
            party_walls: Some(true),
            ..wishes(ProgrammeComposition::Row)
        });
        let b = one(&r);
        let entry = style_index()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.recipe_id == b.recipe_id && e.variant_id == b.variant_id)
            .unwrap();
        assert_eq!(entry.parameters().layout, Layout::Strip);
        assert!(b.volumes.iter().all(|v| (2..=3).contains(&v.levels.len())));
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("continuity and party-wall wishes are not certified"))
        );
        r.config.as_mut().unwrap().recipe = Some("EUR-MED-B02".into());
        r.config.as_mut().unwrap().overrides.floors = Some(3);
        r.programme.as_mut().unwrap().floors = Some([1, 1]);
        let b = one(&r);
        assert_eq!(b.recipe_id, "EUR-MED-B02");
        assert!(b.volumes.iter().all(|v| v.levels.len() == 3));
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("explicit override retained"))
        );
    }

    #[test]
    fn urban_programme_roomy_compound_keeps_source_components_and_explicit_model() {
        let mut r = site("roomy-wealthy", 80., 60.);
        r.programme = Some(ArchitectureProgramme {
            wealth: Some(0.9),
            built_area_m2: Some(180.),
            ..wishes(ProgrammeComposition::Compound)
        });
        let b = one(&r);
        assert_eq!(b.recipe_id, "EUR-MED-B07");
        assert!(b.volumes.len() >= 2);
        assert!(b.volumes.iter().any(|v| v.levels.len() <= 2));
        assert!(b.volumes.iter().any(|v| v.levels.len() >= 3));
        assert!(b.diagnostics.iter().any(|d| d.contains("target advisory")));
        let mut without_target = r.clone();
        without_target.programme.as_mut().unwrap().built_area_m2 = None;
        let unrequested = one(&without_target);
        assert_eq!(physical(&b), physical(&unrequested));
        assert_eq!(b.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, Some(180.));
        assert_eq!(unrequested.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, None);
        let mut pinned_variant = r.clone();
        pinned_variant.config.as_mut().unwrap().recipe = Some("EUR-MED-B02".into());
        pinned_variant.config.as_mut().unwrap().overrides.variant = Some(
            style_index()
                .unwrap()
                .entries
                .iter()
                .find(|e| e.recipe_id == "EUR-MED-B02")
                .unwrap()
                .recipe()
                .parameters
                .variant_id
                .clone(),
        );
        let with_wish = one(&pinned_variant);
        pinned_variant.programme = None;
        assert_eq!(physical(&with_wish), physical(&one(&pinned_variant)));
        let mut model = HouseConfig::default();
        model.recipe = Some("EUR-MED-B02".into());
        model.overrides.variant = Some(
            style_index()
                .unwrap()
                .entries
                .iter()
                .find(|e| e.recipe_id == "EUR-MED-B02")
                .unwrap()
                .recipe()
                .parameters
                .variant_id
                .clone(),
        );
        let settings = Some(PlacementBatchSettings {
            house_config: Some(model),
            ..Default::default()
        });
        let a = run(&r, settings.clone());
        r.programme = None;
        let legacy = run(&r, settings);
        assert_eq!(a.buildings.len(), 1, "{:?}", a.refusals);
        assert_eq!(legacy.buildings.len(), 1, "{:?}", legacy.refusals);
        assert_eq!(physical(&a.buildings[0]), physical(&legacy.buildings[0]));
    }

    #[test]
    fn urban_programme_court_shortlist_is_bounded_and_strict_fallback_explained() {
        let mut r = site("court", 80., 60.);
        r.programme = Some(wishes(ProgrammeComposition::Courtyard));
        let b = one(&r);
        assert_eq!(b.recipe_id, "EUR-MED-B06");
        assert!(area(&b.courtyards) > 1.);
        let index = style_index().unwrap();
        let config = r.config.as_ref().unwrap();
        let query = StyleQuery {
            pack_id: Some("EUR-MED".into()),
            ..Default::default()
        };
        let candidates = index
            .candidate_styles_for_programme(
                &query,
                config,
                &r.seed,
                4,
                r.programme.as_ref().unwrap(),
            )
            .unwrap();
        assert!(candidates.len() <= 4);
        assert_eq!(
            candidates
                .iter()
                .map(|e| e.recipe_id)
                .collect::<BTreeSet<_>>()
                .len(),
            candidates.len()
        );
        assert_eq!(candidates[0].recipe_id, "EUR-MED-B06");
        let ids = |entries: Vec<&StyleEntry>| {
            entries
                .into_iter()
                .map(|e| e.id.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(candidates),
            ids(index
                .candidate_styles_for_programme(
                    &query,
                    config,
                    &r.seed,
                    4,
                    r.programme.as_ref().unwrap()
                )
                .unwrap())
        );
        // Automatic height preferences must not suppress the only real court.
        r.culture.mode = HistoricalMode::HistoricalStrict;
        r.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict;
        r.programme.as_mut().unwrap().floors = Some([99, 99]);
        let b = one(&r);
        assert_eq!(b.recipe_id, "EUR-MED-B06");
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("outside preferred range") && d.contains("strict source"))
        );
        r.programme.as_mut().unwrap().floors = Some([0, 2]);
        let refused = run(&r, None);
        assert!(refused.buildings.is_empty());
        assert!(refused.refusals[0].message.contains("programme.floors"));
    }

    #[test]
    fn urban_programme_civic_is_advisory_and_farm_does_not_certify_function() {
        let mut r = site("townhall", 100., 80.);
        r.function = ArchitectureFunction::Collective;
        r.config.as_mut().unwrap().recipe = Some("EUR-MED-B02".into());
        let legacy = one(&r);
        r.programme = Some(ArchitectureProgramme {
            role: Some("civic.townhall".into()),
            landmark: Some(true),
            built_area_m2: Some(600.),
            ..wishes(ProgrammeComposition::Civic)
        });
        let b = one(&r);
        assert_eq!(physical(&legacy), physical(&b));
        assert_eq!(legacy.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, None);
        assert_eq!(b.programme_outcome.as_ref().unwrap().body_footprint.requested_m2, Some(600.));
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("unsupported functional composition")
                    && d.contains("target advisory"))
        );
        r.function = ArchitectureFunction::Domestic;
        r.config.as_mut().unwrap().recipe = None;
        r.programme = Some(wishes(ProgrammeComposition::Farm));
        let b = one(&r);
        assert!(matches!(
            b.recipe_id.as_str(),
            "EUR-MED-B06" | "EUR-MED-B07"
        ));
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("agricultural functions are not certified"))
        );
    }
}
