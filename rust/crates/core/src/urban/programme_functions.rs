//! Optional combinable programme functions. Missing weights retain the legacy
//! role path; explicit empty weights never resurrect that exclusive role.
use serde::{Deserialize, Serialize};
pub const PROGRAMME_FUNCTIONS_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProgrammeFunctions {
    #[serde(deserialize_with = "weight")]
    pub agricultural: f64,
    #[serde(deserialize_with = "weight")]
    pub commerce: f64,
    #[serde(deserialize_with = "weight")]
    pub artisan: f64,
    #[serde(deserialize_with = "weight")]
    pub riverine: f64,
    #[serde(deserialize_with = "weight")]
    pub port: f64,
    #[serde(deserialize_with = "weight")]
    pub capital: f64,
}
fn weight<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    let value = f64::deserialize(deserializer)?;
    if value.is_finite() && (0.0..=1.0).contains(&value) { Ok(value) }
    else { Err(serde::de::Error::custom("programme function weight must be finite and between 0 and 1")) }
}
impl ProgrammeFunctions {
    pub fn values(self) -> [f64; 6] {
        [self.agricultural, self.commerce, self.artisan, self.riverine, self.port, self.capital]
    }
    pub fn valid(self) -> bool {
        self.values().iter().all(|w| w.is_finite() && (0.0..=1.0).contains(w))
    }
    pub fn active(self) -> bool {
        self.values().iter().any(|w| *w > 0.0)
    }
    /// Already-resolved legacy role; no new automatic/default resolution here.
    pub fn from_legacy_role(role: &str) -> Self {
        let mut w = Self::default();
        match role {
            "agricultural" => w.agricultural = 1.0,
            "crossroads" => w.commerce = 1.0,
            "artisan" => w.artisan = 1.0,
            "riverine" => w.riverine = 1.0,
            "port" => w.port = 1.0,
            "capital" => w.capital = 1.0,
            _ => {}
        }
        w
    }
    pub fn mixed_share(self, population: u32) -> f64 {
        if population < 150 { return 0.0; }
        let w = self.commerce.max(self.port).max(self.capital);
        0.08 + 0.17 * w
    }
    pub fn commons_per_capita(self, communal: bool) -> f64 {
        if communal { 2.0 } else { 0.5 + 1.5 * self.agricultural }
    }
    /// A positive activity keeps its physical programme minimum; it never
    /// scales an 80m² workshop into a 0.8m² requested building.
    pub fn workshop_area(self, population: u32, known_resource: bool) -> Option<f64> {
        if self.artisan <= 0.0 && !known_resource { return None; }
        let rate = (3.5 * self.artisan).max(if known_resource { 1.0 } else { 0.0 });
        Some((f64::from(population) * rate).max(80.0))
    }
    pub fn warehouse_area(self, population: u32) -> Option<f64> {
        (self.port > 0.0).then(|| (f64::from(population) * 2.0 * self.port).max(180.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn programme_functions_weights_are_finite_bounded_and_unknown_keys_rejected() {
        for value in [-1.0, 1.01, f64::NAN, f64::INFINITY] {
            assert!(!ProgrammeFunctions { artisan: value, ..Default::default() }.valid());
        }
        assert!(serde_json::from_str::<ProgrammeFunctions>(r#"{"ports":1}"#).is_err());
        assert!(serde_json::from_str::<ProgrammeFunctions>(r#"{"artisan":1.01}"#).is_err());
        assert!(serde_json::from_str::<ProgrammeFunctions>(r#"{"artisan":-0.01}"#).is_err());
        assert!(serde_json::from_str::<ProgrammeFunctions>(r#"{}"#).unwrap().valid());
    }
    #[test]
    fn programme_functions_shared_effects_take_the_maximum_and_keep_small_programme_minima() {
        for weight in [0.0, 0.5, 1.0] {
            let w = ProgrammeFunctions { commerce: weight, port: weight, capital: weight, artisan: weight, ..Default::default() };
            assert_eq!(w.mixed_share(149), 0.0);
            assert_eq!(w.mixed_share(600), 0.08 + 0.17 * weight);
            assert_eq!(w.workshop_area(10, false), if weight > 0.0 { Some(80.0) } else { None });
            assert_eq!(w.warehouse_area(10), if weight > 0.0 { Some(180.0) } else { None });
        }
        let tiny = ProgrammeFunctions { artisan: 0.01, port: 0.01, ..Default::default() };
        assert_eq!(tiny.workshop_area(10, false), Some(80.0));
        assert_eq!(tiny.warehouse_area(10), Some(180.0));
    }
}
