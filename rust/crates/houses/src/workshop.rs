//! Explicit experimental presets, independent of cultural recipes and chronology.
use crate::catalogue::{
    Catalogue, EnclosureFamily, Envelope, GalleryCover, Layout, Parameters, Support, SupportKind,
    VerticalAccess, VerticalRoute,
};
use crate::model::{HistoricalMode, HouseConfig, MaterialSlots, RoofSpec};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct WorkshopRequest {
    pub preset_id: String,
    pub footprint: Option<String>,
    pub roof: Option<String>,
    pub width_m: Option<f64>,
    pub depth_m: Option<f64>,
    pub roof_frame: Option<String>,
    pub base: Option<String>,
    pub support: Option<Support>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkshopPreset {
    pub id: String,
    pub label: String,
    pub description: String,
    pub confidence: String,
    pub parameters: Parameters,
}

const FOOTPRINTS: [&str; 20] = [
    "FP-ROUND",
    "FP-OVAL",
    "FP-SQUARE",
    "FP-RECT",
    "FP-LONG",
    "FP-L",
    "FP-U",
    "FP-COMPLEX",
    "FP-COURT",
    "FP-POLYGON",
    "FP-TOWER",
    "FP-APSIDAL",
    "FP-TRICONCH",
    "FP-CROSS",
    "FP-TERRACE",
    "FP-ELLIPTICAL-RING",
    "FP-ROCKCUT",
    "FP-MULTICELL",
    "FP-CLUSTER-ROUND",
    "FP-IRREGULAR",
];
const ROOFS: [&str; 22] = [
    "RF-CONE",
    "RF-GABLE",
    "RF-HIP",
    "RF-FLAT",
    "RF-SHED",
    "RF-DOME",
    "RF-THATCH-VAULT",
    "RF-VAULT",
    "RF-CROSSVAULT",
    "RF-STEP",
    "RF-EAVES",
    "RF-CURVED",
    "RF-TIERED",
    "RF-REED-HIP",
    "RF-TENT",
    "RF-SADDLE",
    "RF-GAMBREL",
    "RF-DOME-CONE",
    "RF-STEEP-STEP",
    "RF-MULTIPAV",
    "RF-SNOW",
    "RF-SHELL",
];

fn parameters(fp: &str, rf: &str) -> Parameters {
    Parameters {
        variant_id: "workshop".into(),
        layout: Layout::Single,
        footprint_family: fp.into(),
        roof_system: rf.into(),
        roof_spec: RoofSpec::default(),
        gallery_cover: GalleryCover {
            enabled: false,
            rf: "RF-SHED".into(),
            spec: RoofSpec::default(),
            height_m: 2.2,
            width_m: 0.85,
            pitch_deg: 10.0,
            max_span_m: 3.0,
            support_spacing_m: 1.5,
            facade_mode: None,
        },
        detail_spec: None,
        court_program: None,
        portal_profile: None,
        site_gate_profile: None,
        structural_spec: None,
        structure_system: "post_beam".into(),
        materials: MaterialSlots {
            frame: "MAT-TIMBER-POST".into(),
            infill: "MAT-WATTLE-DAUB".into(),
            coating: "MAT-MUD-PLASTER".into(),
            cladding: "MAT-TILE-CLAY".into(),
            base: "MAT-STONE-DRY".into(),
            roof_frame: "MAT-TIMBER-POST".into(),
        },
        width_m: [16.0; 2],
        depth_m: [16.0; 2],
        floors: [1; 2],
        level_height_m: 2.8,
        bodies: [1; 2],
        cells: [0; 2],
        rooms_per_body: [1; 2],
        elevation_family: "ground".into(),
        details: vec![],
        notes: vec!["Preset géométrique stylized, sans tradition ni date attribuée.".into()],
        components: vec![],
        enclosure_family: EnclosureFamily::None,
        enclosures: vec![],
        level_materials: vec![],
        support: Support {
            kind: SupportKind::Ground,
            material: None,
            height_m: [0.0; 2],
        },
        envelope: Envelope::Walled,
        vertical_access: VerticalAccess::None,
        vertical_routes: vec![],
        shell: None,
        roof_pitch_deg: [25.0, 45.0],
        overhang_m: [0.2, 0.5],
        wall_thickness_m: [0.2, 0.35],
        courtyard_ratio: [0.25; 2],
        allowed_roofs: ROOFS.iter().map(|id| (*id).into()).collect(),
        allowed_footprints: FOOTPRINTS.iter().map(|id| (*id).into()).collect(),
    }
}

fn apply_roof_defaults(p: &mut Parameters, rf: &str) {
    p.roof_system = rf.into();
    match rf {
        "RF-FLAT" | "RF-STEP" => {
            p.roof_pitch_deg = [0.0; 2];
            p.materials.cladding = "MAT-MUD-PLASTER".into();
        }
        "RF-DOME" | "RF-VAULT" | "RF-CROSSVAULT" | "RF-DOME-CONE" => {
            p.structure_system = "masonry".into();
            p.roof_pitch_deg = [0.0; 2];
            p.materials.frame = "MAT-STONE-MORTAR".into();
            p.materials.infill = "MAT-STONE-MORTAR".into();
            p.materials.coating = "MAT-PLASTER-LIME".into();
            p.materials.cladding = "MAT-STONE-DRY".into();
            p.materials.roof_frame = "MAT-STONE-MORTAR".into();
        }
        "RF-THATCH-VAULT" | "RF-REED-HIP" => {
            p.materials.cladding = "MAT-REED".into();
        }
        "RF-TENT" => {
            p.structure_system = "flexible_frame".into();
            p.envelope = Envelope::Membrane;
            p.materials.infill = "MAT-HIDE".into();
            p.materials.coating = "MAT-HIDE".into();
            p.materials.cladding = "MAT-HIDE".into();
        }
        "RF-SNOW" => {
            p.envelope = Envelope::Shell;
            p.structure_system = "snow_shell".into();
            p.materials.frame = "MAT-ICE-SNOW".into();
            p.materials.infill = "MAT-ICE-SNOW".into();
            p.materials.coating = "MAT-ICE-SNOW".into();
            p.materials.cladding = "MAT-ICE-SNOW".into();
            p.materials.roof_frame = "MAT-ICE-SNOW".into();
            p.roof_pitch_deg = [0.0; 2];
        }
        _ => {}
    }
}

pub fn presets() -> Vec<WorkshopPreset> {
    let mut output = vec![];
    for fp in FOOTPRINTS {
        let rf = if fp == "FP-TERRACE" {
            "RF-FLAT"
        } else if fp == "FP-CLUSTER-ROUND" {
            "RF-CONE"
        } else {
            "RF-GABLE"
        };
        let mut p = parameters(fp, rf);
        apply_roof_defaults(&mut p, rf);
        match fp {
            "FP-LONG" => {
                p.width_m = [12.0; 2];
                p.depth_m = [24.0; 2];
            }
            "FP-COURT" | "FP-ELLIPTICAL-RING" | "FP-ROCKCUT" => {
                p.width_m = [24.0; 2];
                p.depth_m = [24.0; 2];
            }
            "FP-TOWER" => {
                p.floors = [3; 2];
            }
            "FP-TERRACE" => {
                p.floors = [3; 2];
                p.vertical_access = VerticalAccess::RoofHatch;
            }
            "FP-MULTICELL" => {
                p.bodies = [8; 2];
                p.width_m = [32.0; 2];
                p.depth_m = [32.0; 2];
            }
            "FP-CLUSTER-ROUND" => {
                p.bodies = [4; 2];
                p.width_m = [36.0; 2];
                p.depth_m = [36.0; 2];
            }
            _ => {}
        }
        if p.floors[0] > 1 && p.vertical_access == VerticalAccess::None {
            p.vertical_access = VerticalAccess::InternalStair;
        }
        output.push(WorkshopPreset {
            id: format!("WORKSHOP-{fp}"),
            label: format!("Plan {fp}"),
            description: "Primitive géométrique expérimentale, matériaux et programme déclarés."
                .into(),
            confidence: "stylized".into(),
            parameters: p,
        });
    }
    for rf in ROOFS {
        let fp = match rf {
            "RF-CONE" | "RF-TENT" | "RF-SNOW" | "RF-DOME" | "RF-DOME-CONE" => "FP-ROUND",
            "RF-CROSSVAULT" => "FP-CROSS",
            "RF-STEP" => "FP-TERRACE",
            _ => "FP-RECT",
        };
        let mut p = parameters(fp, rf);
        apply_roof_defaults(&mut p, rf);
        if rf == "RF-STEP" {
            p.floors = [3; 2];
            p.vertical_access = VerticalAccess::RoofHatch;
        }
        if rf == "RF-FLAT" {
            p.vertical_access = VerticalAccess::RoofHatch;
        }
        output.push(WorkshopPreset {
            id: format!("WORKSHOP-{rf}"),
            label: format!("Toiture {rf}"),
            description: "Toiture expérimentale sur emprise et porteur compatibles.".into(),
            confidence: "stylized".into(),
            parameters: p,
        });
    }
    output
}

pub(crate) fn resolve<'a>(
    data: &'a Catalogue,
    config: &HouseConfig,
) -> Result<(&'a WorkshopPreset, Parameters), String> {
    let request = config
        .workshop
        .as_ref()
        .ok_or("Configuration atelier absente.")?;
    if config.mode != HistoricalMode::FantasyMix
        || config.pack != "atelier"
        || config.era != "any"
        || config.allow_late
        || config.recipe.is_some()
        || config.size != 1.0
    {
        return Err("Atelier : mode fantasy, pack atelier, époque Tous, taille 1, sans recette ni filtre tardif.".into());
    }
    if config.overrides.footprint.is_some()
        || config.overrides.roof.is_some()
        || config.overrides.variant.is_some()
    {
        return Err("Atelier : le plan et la toiture proviennent uniquement de la demande atelier ; aucune variante culturelle.".into());
    }
    let preset = data
        .workshop_presets
        .iter()
        .find(|p| p.id == request.preset_id)
        .ok_or("Preset atelier inconnu.")?;
    let mut p = preset.parameters.clone();
    if let Some(fp) = &request.footprint {
        if !FOOTPRINTS.contains(&fp.as_str()) {
            return Err(format!("Plan atelier inconnu : {fp}."));
        }
        p.footprint_family.clone_from(fp);
    }
    if let Some(rf) = &request.roof {
        if !ROOFS.contains(&rf.as_str()) {
            return Err(format!("Toiture atelier inconnue : {rf}."));
        }
        if rf != &p.roof_system {
            apply_roof_defaults(&mut p, rf);
        }
    }
    for (range, requested) in [
        (&mut p.width_m, request.width_m),
        (&mut p.depth_m, request.depth_m),
    ] {
        if let Some(value) = requested {
            if !value.is_finite() || !(4.0..=80.0).contains(&value) {
                return Err("Dimensions atelier : 4–80 mètres, valeurs finies.".into());
            }
            *range = [value; 2];
        }
    }
    if ["FP-SQUARE", "FP-TOWER", "FP-ROUND"].contains(&p.footprint_family.as_str())
        && p.width_m != p.depth_m
    {
        return Err("Ce plan exige une largeur égale à la profondeur.".into());
    }
    for (slot, value) in [
        (&mut p.materials.frame, &config.overrides.frame),
        (&mut p.materials.infill, &config.overrides.infill),
        (&mut p.materials.coating, &config.overrides.coating),
        (&mut p.materials.cladding, &config.overrides.cladding),
        (&mut p.materials.roof_frame, &request.roof_frame),
        (&mut p.materials.base, &request.base),
    ] {
        if let Some(value) = value {
            slot.clone_from(value);
        }
    }
    for (range, value) in [
        (&mut p.roof_pitch_deg, config.overrides.roof_pitch_deg),
        (&mut p.overhang_m, config.overrides.overhang_m),
        (&mut p.courtyard_ratio, config.overrides.courtyard_ratio),
    ] {
        if let Some(value) = value {
            *range = [value; 2];
        }
    }
    if let Some(floors) = config.overrides.floors {
        p.floors = [floors; 2];
    }
    if let Some(bodies) = config.overrides.bodies {
        if !["FP-MULTICELL", "FP-CLUSTER-ROUND"].contains(&p.footprint_family.as_str()) {
            return Err("Le nombre de corps n'est réglable que pour les primitives multicellulaire et groupe de huttes.".into());
        }
        p.bodies = [bodies; 2];
    }
    if config.overrides.courtyard_ratio.is_some()
        && ![
            "FP-COURT",
            "FP-ROCKCUT",
            "FP-ELLIPTICAL-RING",
            "FP-MULTICELL",
        ]
        .contains(&p.footprint_family.as_str())
    {
        return Err("Ce plan atelier ne consomme pas un ratio de cour.".into());
    }
    if p.footprint_family == "FP-TERRACE"
        && (p.floors[0] < 2 || !["RF-FLAT", "RF-STEP"].contains(&p.roof_system.as_str()))
    {
        return Err(
            "Les gradins exigent au moins deux niveaux et une toiture plate ou à terrasses.".into(),
        );
    }
    if matches!(p.envelope, Envelope::Membrane | Envelope::Shell) && p.floors[0] > 1 {
        return Err("Une membrane ou coque atelier comporte un seul niveau.".into());
    }
    if p.floors[0] > 1 && p.vertical_access == VerticalAccess::None {
        p.vertical_access = VerticalAccess::InternalStair;
    }
    p.vertical_routes = (0..p.floors[0].saturating_sub(1))
        .map(|level| VerticalRoute {
            kind: p.vertical_access,
            from_level: level,
            to_level: level + 1,
            placement: crate::catalogue::Placement::Main,
            min_width_m: 0.9,
        })
        .collect();
    if let Some(support) = &request.support {
        p.support = support.clone();
    }
    if p.support.height_m[0] != p.support.height_m[1]
        || !p.support.height_m[0].is_finite()
        || !(0.0..=6.0).contains(&p.support.height_m[0])
    {
        return Err("Support atelier : une hauteur résolue finie entre 0 et 6 mètres.".into());
    }
    if matches!(
        p.support.kind,
        SupportKind::Posts | SupportKind::Piers | SupportKind::Raft
    ) && (p.support.height_m[0] < 0.3
        || p.support
            .material
            .as_ref()
            .is_none_or(|m| !data.material_has(m, &["support", "load_bearing", "frame"])))
    {
        return Err("Support surélevé : matériau porteur déclaré et hauteur ≥0,3 m.".into());
    }
    if matches!(p.support.kind, SupportKind::Ground | SupportKind::Rock)
        && p.support.height_m[0] != 0.0
    {
        return Err(
            "Un appui au sol ou dans la roche conserve une hauteur de support nulle.".into(),
        );
    }
    if p.support.kind == SupportKind::Raft
        && !["MAT-TIMBER-POST", "MAT-LOG", "MAT-BAMBOO", "MAT-DRIFTWOOD"]
            .contains(&p.support.material.as_deref().unwrap_or(""))
    {
        return Err("Un radeau exige un bois ou bambou flottant déclaré.".into());
    }
    data.validate_parameters(&p)?;
    Ok((preset, p))
}
