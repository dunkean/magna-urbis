//! Cultural traits and material styles used by procedural massing.

use super::*;

#[derive(Clone, Copy)]
pub(super) struct Tradition {
    pub(super) roof: &'static str,
    pub(super) pitch: f64,
    pub(super) storeys: [u32; 2],
    pub(super) cover: &'static str,
    pub(super) wall: &'static str,
    /// Ridge perpendicular to the street (gabled row houses), else along the
    /// street for street bodies.
    pub(super) gable_to_street: bool,
    /// Building form the typology names (`yurt`, `tipi`, `stilt`), else empty.
    pub(super) form: &'static str,
}

const fn t(
    roof: &'static str,
    pitch: f64,
    storeys: [u32; 2],
    cover: &'static str,
    wall: &'static str,
) -> Tradition {
    Tradition {
        roof,
        pitch,
        storeys,
        cover,
        wall,
        gable_to_street: false,
        form: "",
    }
}

/// Roof tradition a culture's style traits declare, for a tissue without
/// `arch` (`forms/styles.json`, `cultures.<id>.traits.tradition`). Its `form`
/// makes a landmark or untyped lot of a tipi people a tipi too, never a stone nave.
fn declared(traits: &'static super::super::forms::kit::CultureTraits) -> Option<Tradition> {
    traits.tradition.as_ref().map(|d| Tradition {
        roof: d.roof.as_str(),
        pitch: d.pitch,
        storeys: d.storeys,
        cover: d.cover.as_str(),
        wall: d.wall.as_str(),
        gable_to_street: d.gable_to_street,
        form: d.form.as_str(),
    })
}

/// Cover and wall a catalogue `arch.material` asks for (None: keep the roof
/// kind's default cover / the culture's wall).
fn material_style(material: &str, roof: &str, typology: &str) -> (Option<&'static str>, Option<&'static str>) {
    let pitched_wood = matches!(roof, "gable" | "thatch-ridge");
    // Modern masonry under a flat roof: a bitumen membrane, not earth.
    let flat = matches!(roof, "flat" | "terraced");
    match material {
        "concrete" => (flat.then_some("bitumen"), Some("concrete")),
        "ashlar" | "limestone" => (Some(if flat { "bitumen" } else { "zinc" }), Some("ashlar")),
        "glass" => (Some("bitumen"), Some("glass")),
        "steel" => (Some("metal"), Some("steel")),
        "plaster" => (flat.then_some("bitumen"), None),
        "timber" => (None, Some("timber")),
        "wood" => match typology {
            "stilt-house" => (Some("bamboo"), Some("bamboo")),
            _ => (if pitched_wood { Some("shingle") } else { None }, Some("wood")),
        },
        "cedar-plank" => (Some("shingle"), Some("wood")),
        "brick" => (flat.then_some("bitumen"), Some("brick")),
        "stone" | "granite" | "marble" => (None, Some("stone")),
        "dark-stone" | "rock" => (Some("stone"), Some("stone")),
        "coral-stone" => (Some("plaster"), Some("coral")),
        "mud" | "adobe" | "earth" | "rammed-earth" => (Some("earth"), Some("earth")),
        "thatch" => match typology {
            "maloca" => (Some("palm"), Some("wood")),
            "stilt-house" => (Some("palm"), Some("bamboo")),
            "beehive-hut" => (Some("thatch"), Some("wattle")),
            _ => (Some("thatch"), Some("wood")),
        },
        "reed" => (Some("reed"), Some("wattle")),
        "bamboo" => (Some("bamboo"), Some("bamboo")),
        "palm" => (Some("palm"), Some("wood")),
        "wattle" => (Some(if typology == "maya-house" { "palm" } else { "reed" }), Some("wattle")),
        "turf" => (Some("turf"), Some("earth")),
        "hide" => (Some("hide"), Some("hide")),
        "felt" | "fabric" => (Some("felt"), Some("hide")),
        "bark" | "living-wood" => (Some("bark"), Some("wood")),
        "fungal" => (Some("turf"), Some("wattle")),
        "snow" => (Some("snow"), Some("plaster")),
        _ => (None, None),
    }
}

/// Roof tradition of the lot: the tissue's `arch` first, else the culture's
/// declared tradition, else a plain tiled gable.
pub(super) fn tradition(arch: &Value, culture: &str) -> Tradition {
    let traits = super::super::forms::kit::traits(culture);
    let fallback = declared(traits).unwrap_or(t("gable", 38.0, [1, 2], "tile", "plaster"));
    let Some(roof) = arch["roof"].as_str() else {
        return fallback;
    };
    let typology = arch["typology"].as_str().unwrap_or("");
    let material = arch["material"].as_str().unwrap_or("");
    let storeys = match (arch["storeys"][0].as_u64(), arch["storeys"][1].as_u64()) {
        (Some(lo), Some(hi)) if lo >= 1 && hi >= lo => [lo as u32, hi as u32],
        _ => fallback.storeys,
    };
    let (mat_cover, mat_wall) = material_style(material, roof, typology);
    let wall = mat_wall.unwrap_or(fallback.wall);
    // Mediterranean tile roofs stay low whatever the tissue's material;
    // elsewhere a gable's pitch follows its cover (steep thatch and timber
    // towns, low plank and turf roofs).
    let mediterranean = traits.mediterranean;
    let gable_pitch = match material {
        _ if mediterranean => 24.0,
        "timber" => 50.0,
        "brick" | "thatch" => 46.0,
        "stone" => 40.0,
        "turf" | "wood" => 34.0,
        "cedar-plank" => 22.0,
        _ => 38.0,
    };
    let (kind, pitch, cover) = match roof {
        "gable" => ("gable", gable_pitch, if material == "stone" && !mediterranean { "slate" } else { "tile" }),
        "tiled-hip" => ("hip", if mediterranean { 22.0 } else { 28.0 }, "tile"),
        "hip" => ("hip", 32.0, "tile"),
        "shed" => ("shed", 18.0, "shingle"),
        "flat" | "terraced" => ("flat", 0.0, "earth"),
        "dome" => ("dome", 0.0, "plaster"),
        "thatch-round" => ("cone", 42.0, "thatch"),
        "conical" => ("cone", 40.0, "thatch"),
        "pyramidal" => ("pyramid", 35.0, "tile"),
        "barrel" => ("barrel", 0.0, "plaster"),
        "thatch-ridge" => ("gable", 45.0, "thatch"),
        _ => (fallback.roof, fallback.pitch, fallback.cover),
    };
    let cover = mat_cover.unwrap_or(cover);
    // Round roofs of skins and felt are tents (yurts, tipis, orc huts).
    let kind = if matches!(material, "hide" | "felt" | "fabric") && matches!(kind, "cone" | "dome") {
        "tent"
    } else {
        kind
    };
    Tradition {
        roof: kind,
        pitch,
        storeys,
        cover,
        wall,
        gable_to_street: kind == "gable"
            && !mediterranean
            && (typology.contains("gable") || typology.contains("giebel")),
        form: match typology {
            "ger" | "yurt" => "yurt",
            "tipi" | "tepee" => "tipi",
            "stilt-house" => "stilt",
            _ => "",
        },
    }
}

/// Roof kind, pitch (degrees), cover and wall of a lot's tradition: the
/// building traits a style kit is chosen from (`forms::kit`).
pub(in crate::urban) fn house_traits(arch: &Value, culture: &str) -> (&'static str, f64, &'static str, &'static str) {
    let t = tradition(arch, culture);
    (t.roof, t.pitch, t.cover, t.wall)
}
