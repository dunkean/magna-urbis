//! Style registry: what a style's buildings are made of.
//!
//! `styles.json` holds the *kits* (one per architectural family: plan weights,
//! extras, roof variants, details) and how a culture gets its kit: an explicit
//! entry (`cultures`), else the first `derive` rule its building traits match
//! (roof kind, wall, cover, pitch), else `default`. `cultures.<id>.traits`
//! holds the building traits a tissue does not carry (roof tradition without
//! `arch`, climate, body and metric scales, home form). Code reads kits and traits,
//! never a culture's name, so a new style is a data block: a kit of its own or
//! an existing one, plus the facets the file reserves for the other stages
//! (`streets`, `plots`, `plan`, `regional`, `epochs`; see its `_doc`).
use crate::rng::Rng;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// The home vocabulary of a kit (`forms::plan`, `massing.rs`).
#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(in crate::urban) struct HouseKit {
    /// Plan weights: `bar` (one body), `ell` (rear wing at one end), `tee`
    /// (rear wing in the middle), `court` (two rear wings), `cross` (a taller
    /// cross-wing at one end), `aitch` (a cross-wing at both ends).
    pub plans: HashMap<String, f64>,
    /// How much room and wealth favour the larger plans (0 none, 1 strongly).
    pub growth: f64,
    /// Chances of each extra on a home that has room for it.
    pub outshot: f64,
    pub porch: f64,
    pub turret: f64,
    pub bay: f64,
    pub chimney: f64,
    pub dormer: f64,
    /// Roof kinds of a home's bodies and their weights; empty keeps the tradition's roof.
    pub roofs: HashMap<String, f64>,
    /// Eaves past the walls (m).
    pub overhang: f64,
    /// Chimney stack material.
    pub stack: String,
}
impl Default for HouseKit {
    fn default() -> Self {
        HouseKit {
            plans: HashMap::from([("bar".to_string(), 1.0)]),
            growth: 0.5,
            outshot: 0.0,
            porch: 0.0,
            turret: 0.0,
            bay: 0.0,
            chimney: 0.0,
            dormer: 0.0,
            roofs: HashMap::new(),
            overhang: 0.3,
            stack: "stone".into(),
        }
    }
}

/// One building trait a derive rule tests (absent fields match anything).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Derive {
    roof: Vec<String>,
    wall: Vec<String>,
    cover: Vec<String>,
    /// Pitch range in degrees.
    pitch: Option<[f64; 2]>,
    kit: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Kit {
    house: HouseKit,
}

/// Roof tradition of a culture whose tissue declares no `arch`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::urban) struct TraditionTraits {
    /// gable | hip | shed | pyramid | cone | tent | dome | barrel | flat.
    pub roof: String,
    /// Degrees.
    pub pitch: f64,
    pub storeys: [u32; 2],
    pub cover: String,
    pub wall: String,
    /// Gabled row houses turn their gable to the street.
    pub gable_to_street: bool,
    /// Building form the typology names (`yurt`, `tipi`, `stilt`), else empty.
    pub form: String,
}

/// Building traits of a culture that its tissue does not carry
/// (`styles*.json`, `cultures.<id>.traits`). Every field has a neutral
/// default, so a culture only states what sets it apart.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::urban) struct CultureTraits {
    /// Roof tradition when the tissue declares no `arch`.
    pub tradition: Option<TraditionTraits>,
    /// Low tiled roofs and few, small openings in masonry (Mediterranean building).
    pub mediterranean: bool,
    /// Roof-top detail family of flat roofs: `maghreb` | `levant` | `persian` | `pueblo` | `meso`; empty: none.
    pub flavor: String,
    /// Inhabitants' size against a human (0: human).
    pub body_scale: f64,
    /// Metric scale of the whole house (0: 1; giants build large).
    pub metric_scale: f64,
    /// Exterior form of homes: `tree` | `mushroom` | `longhouse` | `yurt` | `battered` | `mage` | `stilt`; empty: none.
    pub form: String,
    /// Share of the lots that take `form`, the others keeping the tradition
    /// (0: all; a people that mixes tree dwellings and ordinary houses).
    pub form_share: f64,
    /// Homes are one huge storey of massive stone under a flat roof (giants).
    pub massive_storey: bool,
    /// Homes stand on posts whatever their form (light bodies over water or marsh).
    pub piles: bool,
    /// Facade openness 0..1 of every wall (0: by climate and wall).
    pub openness: f64,
    /// Facade openness 0..1 of the non-masonry walls of a Mediterranean or
    /// flavored culture, whose masonry has few openings (0: fully open).
    pub light_wall_openness: f64,
    /// Era of a modern style: `modern` | `futuristic` | `alien`; empty for the
    /// historical and fantasy cultures. The modern families of
    /// `parcels/monuments/` build for the cultures that have one, and the web
    /// reads it (road pavements, `gen/options.ts` `cultureEra`).
    pub era: String,
    /// Override groups of `roles_*.json` this culture shares, in order, after
    /// its own `overrides.<culture id>` (styles of one building tradition share
    /// their flat roofs, mansards or tower crowns without copying them).
    pub role_groups: Vec<String>,
    /// Wall palette of a modern style: an id of `palettes` (`styles_modern.json`);
    /// empty: the walls keep their material's own colour (no `tint`).
    pub palette: String,
    /// Height ladder of a modern style: an id of `ladders` (`styles_modern.json`)
    /// capping its ordinary buildings' storeys by the settlement's population;
    /// empty: no cap (the tissue's storey range by zone only).
    pub height_ladder: String,
}

/// Wall tints of a style (`palettes.<id>`): sRGB `#rrggbb` keys and their
/// weights, for ordinary homes and for singular and collective buildings.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub(in crate::urban) struct Palette {
    pub homes: HashMap<String, f64>,
    pub special: HashMap<String, f64>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Culture {
    kit: String,
    traits: CultureTraits,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Styles {
    default: String,
    kits: HashMap<String, Kit>,
    derive: Vec<Derive>,
    cultures: HashMap<String, Culture>,
    palettes: HashMap<String, Palette>,
    /// Height ladders: `[population, storeys]` steps in ascending population.
    ladders: HashMap<String, Vec<[f64; 2]>>,
}

/// The registry: `styles.json`, then the files that add styles to it (their
/// kits and cultures join the tables, their derive rules come after).
fn styles() -> &'static Styles {
    static STYLES: OnceLock<Styles> = OnceLock::new();
    STYLES.get_or_init(|| {
        let mut all: Styles = serde_json::from_str(include_str!("styles.json")).unwrap_or_else(|e| panic!("styles.json: {e}"));
        for (name, text) in [("styles_modern.json", include_str!("styles_modern.json"))] {
            let more: Styles = serde_json::from_str(text).unwrap_or_else(|e| panic!("{name}: {e}"));
            all.kits.extend(more.kits);
            all.cultures.extend(more.cultures);
            all.derive.extend(more.derive);
            all.palettes.extend(more.palettes);
            all.ladders.extend(more.ladders);
        }
        all
    })
}

/// Storey cap of a culture's ordinary buildings in a settlement of
/// `population` (its `heightLadder`): the storeys of the last step the
/// population reaches. A quarter the user set as city core (`core`) and an
/// unknown population (0) take the ladder's top step. None: no ladder.
pub(in crate::urban) fn storey_cap(culture: &str, population: u32, core: bool) -> Option<u32> {
    let steps = styles().ladders.get(traits(culture).height_ladder.as_str())?;
    let top = steps.last()?;
    let step = if core || population == 0 { top } else {
        steps.iter().take_while(|s| s[0] <= population as f64).last().unwrap_or(&steps[0])
    };
    Some((step[1].max(1.0)) as u32)
}

/// A storey range under a ladder's cap: unchanged below it; else the cap on
/// top and the low end at most 60 % of it, so a capped tower tissue becomes
/// low blocks (cap 4: 2–4 storeys), never a row of equal stumps.
pub(in crate::urban) fn capped_storeys([lo, hi]: [u32; 2], cap: Option<u32>) -> [u32; 2] {
    match cap {
        Some(c) if hi > c => [lo.min(((c as f64 * 0.6).round() as u32).max(1)), c.max(1)],
        _ => [lo, hi],
    }
}

/// Building traits of a culture (neutral for a culture without an entry).
pub(in crate::urban) fn traits(culture: &str) -> &'static CultureTraits {
    static NEUTRAL: OnceLock<CultureTraits> = OnceLock::new();
    styles().cultures.get(culture).map_or_else(|| NEUTRAL.get_or_init(CultureTraits::default), |c| &c.traits)
}

/// Wall tints of a culture's palette: the `special` list (singular and
/// collective buildings) or the `homes` one; None: the culture has no palette.
pub(in crate::urban) fn tints(culture: &str, special: bool) -> Option<&'static HashMap<String, f64>> {
    let p = styles().palettes.get(traits(culture).palette.as_str())?;
    let t = if special && !p.special.is_empty() { &p.special } else { &p.homes };
    (!t.is_empty()).then_some(t)
}

/// Metric scale of a culture's houses (1 unless its traits say otherwise) and
/// the exterior form of its homes (empty: none).
pub(in crate::urban) fn house_parameters(culture: &str) -> (f64, &'static str) {
    let t = traits(culture);
    (if t.metric_scale > 0.0 { t.metric_scale } else { 1.0 }, t.form.as_str())
}

/// Building traits a kit is derived from (the lot's roof tradition).
#[derive(Clone, Copy)]
pub(in crate::urban) struct Traits<'a> {
    pub roof: &'a str,
    pub pitch: f64,
    pub cover: &'a str,
    pub wall: &'a str,
}

/// Kit id of a culture: its explicit entry, else the first derive rule its traits match.
pub(in crate::urban) fn kit_id(culture: &str, t: Traits) -> &'static str {
    let s = styles();
    if let Some(c) = s.cultures.get(culture).filter(|c| s.kits.contains_key(&c.kit)) {
        return c.kit.as_str();
    }
    let has = |list: &[String], v: &str| list.is_empty() || list.iter().any(|x| x == v);
    s.derive
        .iter()
        .find(|d| {
            has(&d.roof, t.roof) && has(&d.wall, t.wall) && has(&d.cover, t.cover)
                && d.pitch.is_none_or(|[lo, hi]| t.pitch >= lo && t.pitch <= hi)
                && s.kits.contains_key(&d.kit)
        })
        .map_or(s.default.as_str(), |d| d.kit.as_str())
}

/// The home vocabulary of a culture.
pub(in crate::urban) fn house(culture: &str, t: Traits) -> &'static HouseKit {
    static PLAIN: OnceLock<HouseKit> = OnceLock::new();
    let s = styles();
    s.kits.get(kit_id(culture, t)).map_or_else(|| PLAIN.get_or_init(HouseKit::default), |k| &k.house)
}

/// A weighted draw among the table's keys (sorted, so the draw is stable);
/// `usable` filters them. None: nothing usable.
pub(in crate::urban) fn draw<'a>(table: &'a HashMap<String, f64>, rng: &mut Rng, usable: &dyn Fn(&str) -> bool, weight: &dyn Fn(&str, f64) -> f64) -> Option<&'a str> {
    let mut entries: Vec<(&str, f64)> = table
        .iter()
        .filter(|(k, w)| **w > 0.0 && usable(k))
        .map(|(k, w)| (k.as_str(), weight(k, *w).max(0.0)))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    let total: f64 = entries.iter().map(|e| e.1).sum();
    if total <= 0.0 {
        return None;
    }
    let mut x = rng.float() * total;
    for (k, w) in &entries {
        if x < *w {
            return Some(k);
        }
        x -= w;
    }
    entries.last().map(|e| e.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn styles_parse_and_every_referenced_kit_exists() {
        let s = styles();
        assert!(s.kits.contains_key(&s.default), "default kit");
        for d in &s.derive {
            assert!(s.kits.contains_key(&d.kit), "derive kit {}", d.kit);
        }
        // A culture may state traits only; its kit is then derived.
        for (c, v) in &s.cultures {
            assert!(v.kit.is_empty() || s.kits.contains_key(&v.kit), "culture {c} kit {}", v.kit);
        }
        // Every palette a culture names exists and lists sRGB tints.
        for (c, v) in &s.cultures {
            let id = &v.traits.palette;
            assert!(id.is_empty() || s.palettes.contains_key(id), "culture {c} palette {id}");
        }
        // Every height ladder a culture names exists, its steps ascending.
        for (c, v) in &s.cultures {
            let id = &v.traits.height_ladder;
            assert!(id.is_empty() || s.ladders.contains_key(id), "culture {c} ladder {id}");
        }
        for (id, steps) in &s.ladders {
            assert!(!steps.is_empty() && steps.windows(2).all(|w| w[0][0] < w[1][0] && w[0][1] <= w[1][1]), "ladder {id}");
        }
        for (id, p) in &s.palettes {
            assert!(!p.homes.is_empty(), "palette {id}");
            for k in p.homes.keys().chain(p.special.keys()) {
                assert!(k.len() == 7 && k.starts_with('#') && k[1..].chars().all(|c| c.is_ascii_hexdigit()), "palette {id}: {k}");
            }
        }
    }

    /// The traits of the historical and fantasy cultures, as `massing.rs` reads them.
    #[test]
    fn cultures_state_their_building_traits() {
        // (culture, roof, pitch, storeys, cover, wall): the roof tradition without `arch`.
        let traditions: [(&str, &str, f64, [u32; 2], &str, &str); 36] = [
            ("al-andalus", "hip", 24.0, [1, 2], "tile", "plaster"),
            ("bagan", "hip", 32.0, [1, 2], "tile", "wood"),
            ("budj-bim", "cone", 40.0, [1, 1], "thatch", "stone"),
            ("goblin-warren", "cone", 40.0, [1, 1], "thatch", "stone"),
            ("lizardfolk-swamp", "cone", 40.0, [1, 1], "thatch", "stone"),
            ("caucasian-highland", "flat", 0.0, [2, 3], "earth", "stone"),
            ("himalayan-terraces", "flat", 0.0, [2, 3], "earth", "stone"),
            ("dravidian-temple", "flat", 0.0, [1, 3], "plaster", "stone"),
            ("rajput-fort", "flat", 0.0, [1, 3], "plaster", "stone"),
            ("egyptian-planned", "flat", 0.0, [1, 2], "earth", "earth"),
            ("hausa-kano", "flat", 0.0, [1, 2], "earth", "earth"),
            ("mesopotamian", "flat", 0.0, [1, 2], "earth", "earth"),
            ("levantine-tell", "flat", 0.0, [1, 2], "earth", "earth"),
            ("oasis-caravan", "flat", 0.0, [1, 2], "earth", "earth"),
            ("indus-planned", "flat", 0.0, [1, 2], "earth", "brick"),
            ("ksar-oasis", "flat", 0.0, [2, 3], "earth", "earth"),
            ("hadhrami-tower", "flat", 0.0, [4, 7], "earth", "earth"),
            ("tibetan-monastery", "flat", 0.0, [2, 4], "earth", "stone"),
            ("nubian-fortified", "dome", 0.0, [1, 2], "earth", "earth"),
            ("merfolk-tidal", "dome", 0.0, [1, 2], "stone", "stone"),
            ("ethiopian-highland", "cone", 38.0, [1, 1], "thatch", "wood"),
            ("great-zimbabwe", "cone", 38.0, [1, 1], "thatch", "wood"),
            ("native-plains", "tent", 40.0, [1, 1], "hide", "hide"),
            ("mongol-ordu", "tent", 30.0, [1, 1], "felt", "hide"),
            ("siberian-camp", "tent", 36.0, [1, 1], "hide", "hide"),
            ("flemish-cloth-town", "gable", 52.0, [3, 4], "tile", "brick"),
            ("rynek-town", "gable", 45.0, [2, 4], "tile", "brick"),
            ("italian-comune", "hip", 22.0, [3, 5], "tile", "brick"),
            ("newar", "hip", 30.0, [3, 4], "tile", "brick"),
            ("vietnamese-citadel", "hip", 30.0, [1, 2], "tile", "wood"),
            ("giant-hold", "gable", 40.0, [2, 3], "stone", "stone"),
            ("javanese-courts", "pyramid", 34.0, [1, 1], "tile", "wood"),
            ("maori-pa", "gable", 42.0, [1, 2], "thatch", "wood"),
            ("slavic-gord", "gable", 42.0, [1, 2], "thatch", "wood"),
            ("mississippian", "hip", 40.0, [1, 1], "thatch", "earth"),
            ("yoruba", "hip", 40.0, [1, 1], "thatch", "earth"),
        ];
        for (culture, roof, pitch, storeys, cover, wall) in traditions {
            let t = traits(culture).tradition.as_ref().unwrap_or_else(|| panic!("{culture}: no tradition"));
            assert_eq!((t.roof.as_str(), t.pitch, t.storeys, t.cover.as_str(), t.wall.as_str()), (roof, pitch, storeys, cover, wall), "{culture}");
            assert_eq!(t.gable_to_street, culture == "flemish-cloth-town", "{culture}");
            assert_eq!(t.form, if culture == "native-plains" { "tipi" } else { "" }, "{culture}");
        }
        // Metric scale and exterior form of the homes.
        let forms: [(&str, f64, &str); 8] = [
            ("giant-hold", 2.5, ""), ("elven", 1.0, "tree"), ("myconid-colony", 1.0, "mushroom"),
            ("native-iroquoian", 1.0, "longhouse"), ("mongol-ordu", 1.0, "yurt"), ("tibetan-monastery", 1.0, "battered"),
            ("wizard-city", 1.0, "mage"), ("merfolk-tidal", 1.0, "stilt"),
        ];
        // The cultures that carry each other trait.
        let sets: [(&str, &[&str], fn(&CultureTraits) -> bool); 11] = [
            ("mediterranean", &["roman-core", "byzantine-greek", "ottoman", "venetian-lagoon", "italian-comune", "al-andalus", "bastide", "levantine-tell"], |t| t.mediterranean),
            ("maghreb", &["medina", "sahel", "ksar-oasis", "oasis-caravan", "hausa-kano", "swahili-stone-town"], |t| t.flavor == "maghreb"),
            ("levant", &["levantine-tell", "mesopotamian", "egyptian-planned", "nubian-fortified", "ottoman", "indus-planned"], |t| t.flavor == "levant"),
            ("persian", &["persian", "hadhrami-tower"], |t| t.flavor == "persian"),
            ("pueblo", &["native-pueblo"], |t| t.flavor == "pueblo"),
            ("meso", &["aztec", "maya", "inca"], |t| t.flavor == "meso"),
            ("small folk", &["gnomish", "halfling", "goblin-warren"], |t| t.body_scale != 0.0),
            ("massive storey", &["giant-hold"], |t| t.massive_storey),
            ("piles", &["lizardfolk-swamp"], |t| t.piles),
            ("form share", &["elven"], |t| t.form_share != 0.0),
            ("light wall openness", &["ottoman"], |t| t.light_wall_openness != 0.0),
        ];
        // Every culture named above carries exactly the traits listed for it.
        let named: Vec<&str> = traditions.iter().map(|t| t.0)
            .chain(forms.iter().map(|f| f.0))
            .chain(sets.iter().flat_map(|s| s.1.iter().copied()))
            .collect();
        for &id in &named {
            let t = traits(id);
            assert_eq!(t.tradition.is_some(), traditions.iter().any(|x| x.0 == id), "tradition: {id}");
            for (what, list, has) in &sets {
                assert_eq!(has(t), list.contains(&id), "{what}: {id}");
            }
            assert_eq!(t.openness, 0.0, "openness: {id}");
            let wanted = forms.iter().find(|f| f.0 == id).map_or((1.0, ""), |f| (f.1, f.2));
            assert_eq!(house_parameters(id), wanted, "{id}");
        }
        assert_eq!([traits("gnomish").body_scale, traits("halfling").body_scale, traits("goblin-warren").body_scale], [0.6, 0.65, 0.75]);
        assert_eq!((traits("elven").form_share, traits("ottoman").light_wall_openness), (0.5, 0.8));
        // A culture without an entry is neutral.
        assert_eq!(house_parameters("european-organic"), (1.0, ""));
    }

    #[test]
    fn traits_choose_the_kit() {
        let t = |roof, pitch, cover, wall| kit_id("no-such-culture", Traits { roof, pitch, cover, wall });
        assert_eq!(t("flat", 0.0, "earth", "earth"), "flat-roofed");
        assert_eq!(t("gable", 50.0, "tile", "timber"), "timber-gabled");
        assert_eq!(t("hip", 22.0, "tile", "plaster"), "low-tiled");
        assert_eq!(t("gable", 45.0, "thatch", "wood"), "thatched");
    }
}
