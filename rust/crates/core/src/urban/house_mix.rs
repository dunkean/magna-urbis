//! Mixed house styles. The building profile string that already travels from the
//! web to `building_sites` is either a culture id (the old surcharge, read as
//! the city mix with one style) or a JSON object `{"culture"?, "houses"?}`.
//! Resolution per lot: quarter, then the block's zone, then the city mix; none
//! chosen means the lot's own culture. The draw is deterministic: seed + a key
//! from the mix's `spread` (lot id, block or quarter).
use crate::rng::Rng;
use serde::Deserialize;
use std::collections::BTreeMap;

/// Ordinary homes only: cultural silhouettes and tower houses keep their size.
pub(super) fn ordinary_home(culture: &str, arch: &serde_json::Value, seed: &str) -> bool {
    let (scale, form) = super::culture::house_parameters(culture);
    let typology = arch["typology"].as_str().unwrap_or("");
    scale == 1.0
        && (matches!(form, "" | "stilt" | "battered")
            || form == "tree" && Rng::new(seed).fork("tree-share").float() >= 0.5)
        && !super::massing::tower_house(culture, arch)
        && !matches!(typology, "longhouse" | "maloca" | "plank-house" | "ger" | "yurt" | "tipi" | "tepee")
        && !matches!(arch["material"].as_str().unwrap_or(""), "hide" | "felt" | "fabric")
}

pub(super) struct HomeContext<'a> {
    pub zone: &'a str,
    pub district: &'a str,
    pub wealth: f64,
    pub pressure: f64,
    /// Distance from the city centre in equivalent settled radii.
    pub distance: f64,
    pub outside: bool,
    pub farm: bool,
}

impl HomeContext<'_> {
    /// Area multiplier; a separate stream leaves the unchanged houses' draws intact.
    pub fn area_scale(&self, seed: &str) -> f64 {
        if self.zone == "core" { return 1.0; }
        let p = self.pressure.clamp(0.0, 1.0);
        // The fringe grows with distance and falling access pressure alike,
        // inside or outside a wall (no zone step); farms, gardens and villages
        // are fringe whole.
        let countryside = matches!(self.zone, "rural" | "village" | "hamlet");
        let fringe = if self.farm || self.district == "gardens" || self.zone == "fringe" || countryside {
            1.0
        } else {
            // A faubourg is fringe from its first lot (between village and ring).
            ((self.distance - 0.45) / 0.55).max((0.5 - p) / 0.35).clamp(0.0, 1.0)
                .max(if self.outside { 0.5 } else { 0.0 })
                .max(if self.zone == "faubourg" { 0.6 } else { 0.0 })
        };
        let poor = if self.district == "poor" { 1.0 }
            else { ((0.5 - self.wealth) / 0.25).clamp(0.0, 1.0) };
        // The countryside is small houses: most homes shrink, a few notable ones keep the lot's size.
        let chance = if countryside { 0.7 } else { (fringe * (0.6 + 0.1 * (1.0 - p))).max(poor * (0.45 + 0.1 * (1.0 - p))) };
        if Rng::new(seed).fork("small-home").float() >= chance { return 1.0; }
        // 15–22 % less area at the fringe (faubourg), 25–30 % in the countryside, 7–12 % in poor urban quarters.
        let cut = if countryside { 0.3 - 0.05 * p } else { fringe * (0.22 - 0.07 * p) };
        1.0 - cut.max(poor * (0.12 - 0.05 * p))
    }
}

/// Contract the whole house together, preserving its courts and connected wings.
/// A concave lot or reserved hole may prevent a contraction: keep its valid plan.
pub(super) fn scale_home(parts: &mut [(super::Shape, &'static str)], lot: &super::Parcel, area: f64) {
    if area >= 1.0 || parts.is_empty() { return; }
    let c = lot.front.map(|f| super::Point { x:(f[0].x+f[1].x)*0.5, y:(f[0].y+f[1].y)*0.5 })
        .unwrap_or_else(|| super::geometry::interior_point(&parts[0].0));
    let k = area.sqrt();
    let ring = |r: &[super::Point]| r.iter().map(|p| super::Point {
        x:c.x + (p.x-c.x)*k, y:c.y + (p.y-c.y)*k,
    }).collect();
    let scaled: Vec<_> = parts.iter().map(|(s,l)| (super::Shape {
        outer:ring(&s.outer), holes:s.holes.iter().map(|h| ring(h)).collect(),
    }, *l)).collect();
    if scaled.iter().all(|(s,_)| super::geometry::area(s) >= 4.0
        && super::geometry::difference(s, &lot.shape).iter().map(super::geometry::area).sum::<f64>() < 0.01) {
        parts.clone_from_slice(&scaled);
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseStyle {
    pub culture: String,
    pub weight: f64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseMix {
    pub styles: Vec<HouseStyle>,
    /// `lot` (default), `block` or `quarter`.
    pub spread: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseSettings {
    pub city: Option<HouseMix>,
    pub zones: BTreeMap<String, HouseMix>,
    pub quarters: BTreeMap<String, HouseMix>,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Profile {
    culture: String,
    houses: HouseSettings,
}

impl HouseStyle {
    fn usable(&self) -> bool {
        self.weight.is_finite() && self.weight > 0.0 && !self.culture.is_empty()
    }
}

impl HouseMix {
    fn usable(&self) -> bool {
        self.styles.iter().any(HouseStyle::usable)
    }
}

impl HouseSettings {
    /// `None` when the profile chooses nothing (empty, `site`, empty object).
    pub fn parse(profile: Option<&str>) -> Option<Self> {
        let text = profile
            .map(str::trim)
            .filter(|p| !p.is_empty() && *p != "site")?;
        if !text.starts_with('{') {
            return Some(Self::single(text));
        }
        let mut profile: Profile = serde_json::from_str(text).ok()?;
        if !profile.culture.is_empty()
            && profile.culture != "site"
            && profile.houses.city.as_ref().is_none_or(|m| !m.usable())
        {
            profile.houses.city = Self::single(&profile.culture).city;
        }
        Some(profile.houses)
    }

    fn single(culture: &str) -> Self {
        Self {
            city: Some(HouseMix {
                styles: vec![HouseStyle {
                    culture: culture.into(),
                    weight: 100.0,
                }],
                spread: "lot".into(),
            }),
            ..Self::default()
        }
    }

    /// The drawn culture of one lot, or `None` to keep the lot's own.
    pub fn pick(
        &self,
        seed: &str,
        layout: &str,
        lot: &str,
        block: usize,
        quarter: usize,
        zone: &str,
    ) -> Option<&str> {
        let mix = [
            self.quarters.get(&quarter.to_string()),
            self.zones.get(zone),
            self.city.as_ref(),
        ]
        .into_iter()
        .flatten()
        .find(|m| m.usable())?;
        let key = match mix.spread.as_str() {
            "quarter" => format!("{layout}/q{quarter}"),
            "block" => format!("{layout}/b{block}"),
            _ => lot.to_owned(),
        };
        let total: f64 = mix
            .styles
            .iter()
            .filter(|s| s.usable())
            .map(|s| s.weight)
            .sum();
        let mut target = Rng::new(seed).fork(&format!("houses:{key}")).float() * total;
        for s in mix.styles.iter().filter(|s| s.usable()) {
            if target < s.weight {
                return Some(&s.culture);
            }
            target -= s.weight;
        }
        mix.styles
            .iter()
            .rfind(|s| s.usable())
            .map(|s| s.culture.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smaller_footprints_keep_courts_wings_and_lot_reserves() {
        use super::super::geometry::{area, difference, rectangle};
        use serde_json::json;
        let mut lot: super::super::Parcel = serde_json::from_value(json!({
            "shape":rectangle(0.,0.,24.,30.), "block":0, "use":"domestic",
            "front":[{"x":0.,"y":0.},{"x":24.,"y":0.}], "axis":{"x":1.,"y":0.}, "rank":0,
        })).unwrap();
        let mut court = rectangle(3.,2.,21.,20.);
        court.holes.push(rectangle(8.,7.,16.,14.).outer);
        let mut parts = vec![(court, "building"), (rectangle(3.,20.,9.,26.), "building")];
        let original = parts.clone();
        scale_home(&mut parts, &lot, 1.0);
        assert_eq!(parts, original);
        scale_home(&mut parts, &lot, 0.8);
        for ((s,_),(old,_)) in parts.iter().zip(&original) {
            assert!((area(s)/area(old)-0.8).abs() < 1e-6);
            assert!(difference(s, &lot.shape).iter().map(area).sum::<f64>() < 0.01);
            assert_eq!(s.holes.len(), old.holes.len());
        }
        assert!((parts[0].0.outer[2].y-parts[1].0.outer[0].y).abs() < 1e-6, "wings stay attached");
        lot.front = Some([super::super::Point { x:0.,y:0. }, super::super::Point { x:8.,y:0. }]);
        lot.shape.holes.push(rectangle(10.,5.,12.,10.).outer);
        let mut parts = vec![(rectangle(12.2,2.,20.,15.), "building")];
        let original = parts.clone();
        scale_home(&mut parts, &lot, 0.8);
        assert_eq!(parts, original, "a contraction cannot invade a reserved hole");
    }

    fn mix(spread: &str, styles: &[(&str, f64)]) -> HouseMix {
        HouseMix {
            styles: styles
                .iter()
                .map(|(c, w)| HouseStyle {
                    culture: (*c).into(),
                    weight: *w,
                })
                .collect(),
            spread: spread.into(),
        }
    }

    #[test]
    fn house_mix_is_deterministic_weighted_and_spread_by_key() {
        let settings = HouseSettings {
            city: Some(mix("lot", &[("a", 50.0), ("b", 50.0)])),
            ..HouseSettings::default()
        };
        let draw = |seed: &str, lot: &str| {
            settings
                .pick(seed, "L", lot, 0, 0, "core")
                .map(str::to_owned)
        };
        assert_eq!(draw("s", "lot-1"), draw("s", "lot-1"));
        let kinds: std::collections::BTreeSet<_> = (0..40)
            .filter_map(|i| draw("s", &format!("lot-{i}")))
            .collect();
        assert_eq!(kinds.len(), 2, "lots are mixed");
        // Weights 0 / 100 never draw the zero-weight style.
        let only = HouseSettings {
            city: Some(mix("lot", &[("a", 0.0), ("b", 100.0)])),
            ..HouseSettings::default()
        };
        assert!((0..40).all(|i| only.pick("s", "L", &format!("l{i}"), 0, 0, "core") == Some("b")));
        // `block`: one culture per block whatever the lot; blocks differ.
        let blocks = HouseSettings {
            city: Some(mix("block", &[("a", 50.0), ("b", 50.0)])),
            ..HouseSettings::default()
        };
        for block in 0..8 {
            let first = blocks.pick("s", "L", "l0", block, 0, "core");
            assert!(
                (1..12).all(|i| blocks.pick("s", "L", &format!("l{i}"), block, 0, "core") == first)
            );
        }
        let per_block: std::collections::BTreeSet<_> = (0..16)
            .filter_map(|b| blocks.pick("s", "L", "l0", b, 0, "core"))
            .collect();
        assert_eq!(per_block.len(), 2);
        // Quarter beats zone beats city; an empty mix inherits.
        let mut nested = settings.clone();
        nested
            .zones
            .insert("edge".into(), mix("lot", &[("z", 1.0)]));
        nested
            .quarters
            .insert("3".into(), mix("lot", &[("q", 1.0)]));
        nested.quarters.insert("4".into(), mix("lot", &[]));
        assert_eq!(nested.pick("s", "L", "l", 0, 3, "edge"), Some("q"));
        assert_eq!(nested.pick("s", "L", "l", 0, 1, "edge"), Some("z"));
        assert!(matches!(
            nested.pick("s", "L", "l", 0, 4, "core"),
            Some("a" | "b")
        ));
        assert_eq!(
            HouseSettings::default().pick("s", "L", "l", 0, 0, "core"),
            None
        );
    }

    #[test]
    fn old_culture_override_reads_as_the_city_mix() {
        for old in ["norse", r#"{"culture":"norse"}"#] {
            let s = HouseSettings::parse(Some(old)).expect("profile");
            assert_eq!(s.pick("s", "L", "l", 2, 1, "middle"), Some("norse"));
        }
        assert!(HouseSettings::parse(Some("")).is_none());
        assert!(HouseSettings::parse(Some("site")).is_none());
        assert!(HouseSettings::parse(None).is_none());
        let s = HouseSettings::parse(Some(
            r#"{"houses":{"zones":{"core":{"styles":[{"culture":"x","weight":3}],"spread":"block"}}}}"#,
        ))
        .expect("houses");
        assert_eq!(s.pick("s", "L", "l", 0, 0, "core"), Some("x"));
        assert_eq!(s.pick("s", "L", "l", 0, 0, "edge"), None);
    }
}
