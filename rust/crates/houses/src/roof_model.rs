//! Explicit roof parameters and local arms; no cultural-name inference.
use super::{Point, Surface};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofAxis {
    #[default]
    Longitudinal,
    Transverse,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntermediateCover {
    #[default]
    None,
    Terrace,
    Shed,
    Skirt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorbelProfile {
    Dome,
    Barrel,
}

/// A resolved masonry course profile; every physical dimension is explicit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorbelSpec {
    pub profile: CorbelProfile,
    pub courses: u32,
    pub rise_m: f64,
    pub cap_span_m: f64,
    pub cap_thickness_m: f64,
    pub min_bearing_m: f64,
    pub material: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultEnd {
    Start,
    End,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VaultSpec {
    pub open_ends: Vec<VaultEnd>,
    pub bearing_ratio: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofDrainage {
    Inward,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofTriangulation {
    Boundary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellProfile {
    Round,
    Ogival,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShellSpec {
    pub profile: ShellProfile,
    pub rib_width_m: f64,
    pub rib_depth_m: f64,
    pub rib_spacing_m: f64,
    pub material: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HornLayout {
    SerialTiers,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HornCount {
    Four,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HornConfidence {
    Stylized,
}

/// Four stylized longitudinal peaks; heights derive from the actual wall arm.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HornRoofSpec {
    pub layout: HornLayout,
    pub count: HornCount,
    pub central_span_ratio: f64,
    pub rise_ratio: f64,
    pub outer_rise_scale: f64,
    pub confidence: HornConfidence,
}

/// Resolved, visible stylization parameters. Irrelevant RF fields are inert.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RoofSpec {
    pub axis: RoofAxis,
    pub tiers: u32,
    pub tier_inset_ratio: f64,
    pub tier_rise_m: f64,
    pub drum_height_m: f64,
    pub gambrel_break_ratio: f64,
    pub gambrel_lower_pitch_deg: f64,
    pub saddle_rise_ratio: f64,
    pub step_count: u32,
    pub shell_sections: u32,
    pub parapet_height_m: f64,
    /// N/E/S/W in the supplied local arm frame (0/1/2/3).
    pub drainage_side: u32,
    pub dome_rise_ratio: f64,
    pub oculus_ratio: f64,
    pub curve_lift_ratio: f64,
    pub tent_crown_ratio: f64,
    pub shell_cross_rise_ratio: f64,
    pub shell_long_rise_ratio: f64,
    /// Minimum angular sections; existing FP boundary vertices are preserved.
    pub round_segments: u32,
    pub curve_sections: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corbel: Option<CorbelSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault: Option<VaultSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drainage: Option<RoofDrainage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell: Option<ShellSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triangulation: Option<RoofTriangulation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horns: Option<HornRoofSpec>,
}

impl Default for RoofSpec {
    fn default() -> Self {
        Self {
            axis: RoofAxis::Longitudinal,
            tiers: 3,
            tier_inset_ratio: 0.15,
            tier_rise_m: 1.0,
            drum_height_m: 0.7,
            gambrel_break_ratio: 0.55,
            gambrel_lower_pitch_deg: 55.0,
            saddle_rise_ratio: 0.18,
            step_count: 7,
            shell_sections: 12,
            parapet_height_m: 0.4,
            drainage_side: 2,
            dome_rise_ratio: 1.0,
            oculus_ratio: 0.0,
            curve_lift_ratio: 0.12,
            tent_crown_ratio: 0.08,
            shell_cross_rise_ratio: 0.7,
            shell_long_rise_ratio: 0.18,
            round_segments: 32,
            curve_sections: 12,
            corbel: None,
            vault: None,
            drainage: None,
            shell: None,
            triangulation: None,
            horns: None,
        }
    }
}

/// A finite supporting arm, including deliberate prolongation at roof joints.
/// `origin` is its north-west local corner; axis is unit longitudinal x.
/// Transverse y = [-axis[1], axis[0]], matching x-right/y-down coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoofArm {
    pub origin: Point,
    pub axis: [f64; 2],
    pub length_m: f64,
    pub width_m: f64,
    /// For a feature cover, a finite Raw clipping mask. Its material domain is
    /// Attachment.domain intersected with this mask, never the mask by itself.
    /// Body arms retain their finite supporting domains and overhang rules.
    pub domain: Surface,
}

/// Explicit, non-walkable cover of an open feature; domain includes its overhang.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoofAttachment {
    pub owner_body_id: Option<String>,
    /// A membrane chamber enclosed by its owner's roof, with its own mesh layer.
    #[serde(default, skip_serializing_if = "is_false")]
    pub nested: bool,
    pub level: u32,
    pub domain: Surface,
    pub rf: String,
    pub spec: RoofSpec,
    pub arms: Vec<RoofArm>,
    pub support_z_m: f64,
    pub pitch_deg: f64,
    pub overhang_m: f64,
    pub material: String,
    pub frame_material: String,
    pub supports: Vec<String>,
    /// Maximum unsupported edge span, in metres; must be in (0, 6].
    pub max_span_m: f64,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofFaceKind {
    Pan,
    Slab,
    Gable,
    Tympanum,
    StepWall,
    Drum,
    Parapet,
    Skirt,
    SteppedGable,
    CorbelSoffit,
    CorbelRiser,
    ShellOuter,
    ShellInner,
    ShellRib,
    ShellRibEnd,
    ShellJamb,
    ShellLintel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofEdgeKind {
    Eave,
    Ridge,
    Hip,
    Valley,
    Crease,
    Junction,
    Step,
    Verge,
    Oculus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoofGroup {
    pub id: String,
    pub rf: String,
    pub body_id: String,
    #[serde(default)]
    pub feature_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    pub level: u32,
    /// Finite projected roof domain, including admissible edge overhangs.
    pub domain: Surface,
}
