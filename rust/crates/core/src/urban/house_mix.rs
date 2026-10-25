//! Mixed house styles. The building profile string that already travels from the
//! web to `building_sites` is either a culture id (the old surcharge, read as
//! the city mix with one style) or a JSON object `{"culture"?, "houses"?}`.
//! Resolution per lot: quarter, then the block's zone, then the city mix; none
//! chosen means the lot's own culture. The draw is deterministic: seed + a key
//! from the mix's `spread` (lot id, block or quarter).
use crate::rng::Rng;
use serde::Deserialize;
use std::collections::BTreeMap;

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
