//! Forms of singular and utility buildings, by family.
//!
//! A form lays the labelled parts of one building on its site (`landmark::Site`:
//! rectangles, bars, disks, apses, rings, courts, polygons, ellipses and ring
//! wedges in the frame of the lot's main frontage). Parts never overlap; each
//! label is raised by its rule in `forms/roles_monuments_*.json` (wall height,
//! base, roof, tiers, materials), which a culture or a monument family may
//! override, and `forms::roof` joins the roofs. A form therefore only decides
//! the plan: what stands where, how large, in which proportion.
//!
//! `build` asks every family in turn: the cultural ones first (each builds a
//! role only for its own family or cultures), then the shared civic and
//! utility forms any culture may fall back to. A family returns false for a
//! role it does not build, and the older forms of `landmark.rs` then apply.
use super::landmark::Site;
use super::occupation::Occupancy;
use crate::rng::Rng;

mod african;
mod american;
mod asian;
mod civic;
mod classical;
mod fantasy;
mod islamic;
mod medieval;
mod metropolis;
mod modern;
mod rural;
mod utility;

/// What a form reads besides its site.
pub(super) struct Brief<'a> {
    /// Programme role (`civic.theatre`, `commerce.tavern`…).
    pub(super) role: &'a str,
    /// Monument family of the architecture pack (`landmark::family`): `orthodox`,
    /// `maghreb`, `persian`, `chinese`, `japanese`, `indic`, `antique`,
    /// `american`, `african`, `western`.
    pub(super) family: &'static str,
    /// Culture id of the lot's tissue (`european-organic`, `dwarven`…).
    pub(super) culture: &'a str,
    /// `core`, `middle`, `edge`, `faubourg`, `village`.
    pub(super) zone: &'a str,
    /// Allocation function (`collective`, `workshop`, `warehouse`, `mixed`, `domestic`).
    pub(super) function: &'a str,
    pub(super) wealth: f64,
    /// The settlement's main building of its kind (larger, richer).
    pub(super) landmark: bool,
}
impl Brief<'_> {
    /// The role is `prefix` or one of its sub-roles (`prefix.…`).
    pub(super) fn is(&self, prefix: &str) -> bool {
        self.role == prefix || self.role.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('.'))
    }
    pub(super) fn any(&self, prefixes: &[&str]) -> bool {
        prefixes.iter().any(|p| self.is(p))
    }
}

/// Lays the role's building on the site when a family builds it. A family
/// that declines (false) leaves the site and the random stream as it found
/// them, so the older forms then apply exactly as before.
pub(super) fn build(x: &mut Site, o: &Occupancy, family: &'static str, rng: &mut Rng) -> bool {
    let q = Brief {
        role: o.role,
        family,
        culture: o.morph.value["id"].as_str().unwrap_or("").split('/').next().unwrap_or(""),
        zone: o.zone,
        function: o.function,
        wealth: o.wealth,
        landmark: o.landmark,
    };
    let families: [fn(&mut Site, &Brief, &mut Rng) -> bool; 12] = [
        modern::build,
        metropolis::build,
        rural::build,
        classical::build,
        islamic::build,
        asian::build,
        american::build,
        african::build,
        fantasy::build,
        medieval::build,
        civic::build,
        utility::build,
    ];
    for family in families {
        let (kept, mut draw) = (x.out.len(), rng.clone());
        if family(x, &q, &mut draw) && x.out.len() > kept {
            *rng = draw;
            return true;
        }
        x.out.truncate(kept);
    }
    false
}
