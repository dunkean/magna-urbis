//! Mass roles: how a labelled mass is raised.
//!
//! A footprint part carries a label (`wing`, `aisle`, `tier`, `cavea`…); its
//! rule says how high its walls stand, what it stands on, which roof it takes
//! and of what it is made. Rules are data (`roles_*.json`: `roles` by label,
//! `overrides` by culture id or monument family then label), so a new part of
//! a building, or a culture's own way of raising one, needs no code here.
//! A label without a rule keeps the built-in raising of `massing.rs`.
use crate::rng::Rng;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Wall height of a mass above its base.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(in crate::urban) enum Height {
    /// Metres, drawn in the range.
    M([f64; 2]),
    /// A fixed number of the lot's storeys.
    Floors(f64),
    /// The lot's storeys plus a drawn offset (`[-1, 0]`: one lower or equal).
    Rel([i32; 2]),
    /// Times the monument's nave height (it grows with the lot and the town).
    Nave(f64),
    /// Times the mass's own short side.
    Width(f64),
    /// Times the main body's wall height.
    Main(f64),
}

/// What a mass stands on.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(in crate::urban) enum Base {
    #[default]
    Ground,
    /// On top of the mass under it (the highest one holding its centre): a
    /// lantern on a hall, a shrine on its platform, a tower on its podium.
    Stack,
    /// Metres above the ground.
    M(f64),
    /// Times the main body's wall height (a clerestory, an upper gallery).
    Main(f64),
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub(in crate::urban) enum Pitch {
    Fixed(f64),
    Range([f64; 2]),
    /// The culture's pitch plus this many degrees.
    Culture { culture: f64 },
}

/// Roof skirt between two tiers (pagoda eaves): it rises `rise` metres from an
/// eave `overhang` metres past the tier's walls to the walls of the next tier.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub(in crate::urban) struct Skirt {
    pub rise: f64,
    pub overhang: f64,
}

/// A mass raised in receding tiers (stepped tower, pagoda, ziggurat, minaret).
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub(in crate::urban) struct Tiers {
    /// Number of tiers, drawn in the range.
    pub count: [u32; 2],
    /// Each tier's ring is the one below scaled by `1 - inset`.
    pub inset: f64,
    /// Share of the whole height the first tier takes (0: equal tiers).
    pub first: f64,
    pub skirt: Option<Skirt>,
    /// Roof kind of the last tier (the rule's `roof` when absent).
    pub top: Option<String>,
}
impl Default for Tiers {
    fn default() -> Self {
        Tiers { count: [2, 3], inset: 0.2, first: 0.0, skirt: None, top: None }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub(in crate::urban) struct MassRule {
    /// Wall height above the base (absent: the lot's storeys).
    pub eave: Option<Height>,
    pub base: Base,
    /// Roof kind, `culture` (the tradition's), or a draw among `a|b|c`. Kinds:
    /// gable, hip, shed, pyramid, halfhip, gablet, gambrel, mansard, saltbox,
    /// flat, cone, dome, barrel, tent.
    pub roof: Option<String>,
    /// Keep the rule's pitched roof under a flat-roof tradition (a church or
    /// a train shed in a town of flat roofs); without it such a tradition
    /// flattens ordinary pitched kinds.
    pub strict: bool,
    pub pitch: Option<Pitch>,
    /// Ridge: `long` (default, along the mass's long side), `short`, `street`
    /// (along the lot's frontage), `main` (as the main body), `cross`
    /// (across the main body's ridge).
    pub axis: Option<String>,
    /// High side of a shed: `main` (towards the main body, a lean-to), `street`, `back`.
    pub high: Option<String>,
    /// Eaves past the walls (m).
    pub overhang: Option<f64>,
    /// Wall and roof-cover material, or `culture`.
    pub wall: Option<String>,
    pub cover: Option<String>,
    /// `none` (blind walls), `door` (a door, no window); absent: windows by storey.
    pub openings: Option<String>,
    /// A small decorative mass (porch, chimney, finial): renderers may drop it when zoomed out.
    pub minor: bool,
    /// Replace the footprint by a regular polygon of this many sides inscribed in it.
    pub round: Option<u32>,
    pub tiers: Option<Tiers>,
    /// A long mass may break into parts of different heights with cross-gables, as a house body does.
    pub composable: bool,
    /// Storeys shown by the windows (absent: from the wall height).
    pub floors: Option<u32>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct File {
    roles: HashMap<String, MassRule>,
    overrides: HashMap<String, HashMap<String, MassRule>>,
}

fn table() -> &'static File {
    static TABLE: OnceLock<File> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut all = File::default();
        for (name, text) in [
            ("roles_core.json", include_str!("roles_core.json")),
            ("roles_monuments_a.json", include_str!("roles_monuments_a.json")),
            ("roles_monuments_b.json", include_str!("roles_monuments_b.json")),
            ("roles_rural.json", include_str!("roles_rural.json")),
            ("roles_modern.json", include_str!("roles_modern.json")),
        ] {
            let file: File = serde_json::from_str(text).unwrap_or_else(|e| panic!("{name}: {e}"));
            all.roles.extend(file.roles);
            for (key, rules) in file.overrides {
                all.overrides.entry(key).or_default().extend(rules);
            }
        }
        all
    })
}

/// The rule of a label: the first override among `keys` (culture id, then
/// monument family), a key's own override before those of the role groups its
/// traits share (`roleGroups`), else the shared rule. None: the label has no rule.
pub(in crate::urban) fn rule(label: &str, keys: &[&str]) -> Option<&'static MassRule> {
    let t = table();
    let own = |k: &str| t.overrides.get(k).and_then(|o| o.get(label));
    keys.iter()
        .find_map(|&k| own(k).or_else(|| super::kit::traits(k).role_groups.iter().find_map(|g| own(g.as_str()))))
        .or_else(|| t.roles.get(label))
}

/// What the rule's height reads from its lot.
#[derive(Clone, Copy)]
pub(in crate::urban) struct Lot {
    /// The lot's storeys and one storey's height (m).
    pub floors: u32,
    pub storey: f64,
    /// The monument's nave height (m).
    pub nave: f64,
    /// The mass's own short side (m).
    pub width: f64,
}

impl MassRule {
    /// Wall height above the base (m) and the storeys it shows.
    pub(in crate::urban) fn height(&self, lot: Lot, rng: &mut Rng) -> (f64, u32) {
        let storey = lot.storey.max(1.8);
        let main = lot.floors.max(1) as f64 * storey;
        let h = match self.eave {
            None => main,
            Some(Height::M([lo, hi])) => rng.range(lo, hi.max(lo)),
            Some(Height::Floors(n)) => n * storey,
            Some(Height::Rel([lo, hi])) => {
                let d = lo + rng.int(0, (hi - lo).max(0) as u32) as i32;
                (lot.floors as i32 + d).max(1) as f64 * storey
            }
            Some(Height::Nave(k)) => k * lot.nave,
            Some(Height::Width(k)) => k * lot.width,
            Some(Height::Main(k)) => k * main,
        }
        .max(0.4);
        (h, self.floors.unwrap_or(((h / storey).round() as u32).max(1)))
    }

    /// Base above the ground (m) when the rule fixes it; `Stack` is resolved
    /// once every mass of the lot stands.
    pub(in crate::urban) fn base(&self, lot: Lot) -> f64 {
        match self.base {
            Base::M(m) => m.max(0.0),
            Base::Main(k) => k * lot.floors.max(1) as f64 * lot.storey,
            Base::Ground | Base::Stack => 0.0,
        }
    }

    /// Roof kind: the rule's draw, the culture's own for `culture` or no rule.
    /// A flat-roof tradition keeps its flat roofs on ordinary pitched kinds.
    pub(in crate::urban) fn roof_kind(&'static self, culture: &'static str, rng: &mut Rng) -> &'static str {
        let Some(spec) = self.roof.as_deref() else { return culture };
        let kinds: Vec<&'static str> = spec.split('|').map(str::trim).filter(|k| !k.is_empty()).collect();
        let kind = match kinds.len() {
            0 => culture,
            1 => kinds[0],
            n => kinds[(rng.float() * n as f64) as usize % n],
        };
        match kind {
            "culture" => culture,
            "gable" | "hip" | "shed" | "halfhip" | "gablet" | "gambrel" | "mansard" | "saltbox" if culture == "flat" && !self.strict => "flat",
            k => k,
        }
    }

    /// Roof pitch in degrees.
    pub(in crate::urban) fn pitch_deg(&self, culture: f64, rng: &mut Rng) -> f64 {
        match self.pitch {
            None => culture,
            Some(Pitch::Fixed(p)) => p,
            Some(Pitch::Range([lo, hi])) => rng.range(lo, hi.max(lo)),
            Some(Pitch::Culture { culture: d }) => culture + d,
        }
        .clamp(0.0, 80.0)
    }

    /// A material of the rule (`culture` and absent keep the tradition's).
    pub(in crate::urban) fn material(spec: &'static Option<String>, culture: &'static str) -> &'static str {
        match spec.as_deref() {
            None | Some("culture") | Some("") => culture,
            Some(m) => m,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_role_file_parses_and_the_house_parts_have_rules() {
        for label in ["wing", "crosswing", "outshot", "porch", "turret", "bay"] {
            assert!(rule(label, &[]).is_some(), "{label}");
        }
        assert!(rule("building", &[]).is_none());
    }

    #[test]
    fn an_override_wins_over_the_shared_rule() {
        let shared = rule("wing", &["no-such-culture"]).unwrap();
        assert_eq!(shared, rule("wing", &[]).unwrap());
    }

    #[test]
    fn heights_follow_their_rule() {
        let lot = Lot { floors: 2, storey: 3.0, nave: 12.0, width: 5.0 };
        let mut rng = Rng::new("roles");
        let h = |eave| MassRule { eave: Some(eave), ..MassRule::default() }.height(lot, &mut Rng::new("h")).0;
        assert_eq!(h(Height::Floors(1.0)), 3.0);
        assert_eq!(h(Height::Nave(0.5)), 6.0);
        assert_eq!(h(Height::Width(2.0)), 10.0);
        assert_eq!(h(Height::Main(0.5)), 3.0);
        let rel = MassRule { eave: Some(Height::Rel([-1, 0])), ..MassRule::default() }.height(lot, &mut rng).0;
        assert!(rel == 3.0 || rel == 6.0);
    }
}
