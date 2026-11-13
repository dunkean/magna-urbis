//! Mixed house styles. The building profile string that already travels from the
//! web to `building_sites` is either a culture id (the old surcharge, read as
//! the city mix with one style) or a JSON object `{"culture"?, "houses"?}`.
//! Resolution per lot: quarter, then the block's zone, then the city mix; none
//! chosen means the lot's own culture. The draw is deterministic: seed + a key
//! from the mix's `spread` (lot id, block or quarter).
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Ordinary homes only: cultural silhouettes and tower houses keep their size.
pub(super) fn ordinary_home(culture: &str, arch: &serde_json::Value, seed: &str) -> bool {
    let (scale, form) = super::culture::house_parameters(culture);
    let typology = arch["typology"].as_str().unwrap_or("");
    scale == 1.0
        && (matches!(form, "" | "stilt" | "battered")
            || {
                // A people that mixes its form with ordinary houses: the lots that did not draw the form.
                let share = super::forms::kit::traits(culture).form_share;
                share > 0.0 && Rng::new(seed).fork("tree-share").float() >= share
            })
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
    /// `lowRuralHouses`: countryside homes mostly small, faubourg fringe from its first lot.
    pub low_rural: bool,
}

impl HomeContext<'_> {
    /// Area multiplier; a separate stream leaves the unchanged houses' draws intact.
    pub fn area_scale(&self, seed: &str) -> f64 {
        if self.zone == "core" { return 1.0; }
        let p = self.pressure.clamp(0.0, 1.0);
        // The fringe grows with distance and falling access pressure alike,
        // inside or outside a wall (no zone step); farms, gardens and villages
        // are fringe whole.
        let rural = matches!(self.zone, "rural" | "village" | "hamlet");
        let countryside = self.low_rural && rural;
        let fringe = if self.farm || self.district == "gardens" || self.zone == "fringe" || rural {
            1.0
        } else {
            // A faubourg is fringe from its first lot (between village and ring).
            ((self.distance - 0.45) / 0.55).max((0.5 - p) / 0.35).clamp(0.0, 1.0)
                .max(if self.outside { 0.5 } else { 0.0 })
                .max(if self.low_rural && self.zone == "faubourg" { 0.6 } else { 0.0 })
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

/// Contract the whole house together in its own frame, preserving its courts
/// and connected wings: `u` along the walls of its main body that follow the
/// street, `n` away from the street. The street wall stays where it is. A
/// free-standing house shrinks alike in width (about its own centre line)
/// and in depth; a house standing against a side of its lot keeps its width
/// and loses depth (down to 0.7 of it, and never under 4 m: a stronger cut
/// then narrows it from its free side), so party walls stay shared. The map
/// scales the frame's axes, so rectangles stay rectangles; a house between
/// party walls on an oblique street slides along those walls instead.
/// A concave lot or reserved hole may prevent a contraction: keep its valid plan.
pub(super) fn scale_home(parts: &mut [(super::Shape, &'static str)], lot: &super::Parcel, area: f64) {
    use super::Point;
    // A back-lot dependency (`annex`) is not the house: it stays where it stands.
    let house = |l: &str| l != "annex";
    if area >= 1.0 || !parts.iter().any(|(_,l)| house(l)) { return; }
    let dot = |a: Point, b: Point| a.x*b.x + a.y*b.y;
    let sub = |a: Point, b: Point| Point { x:a.x-b.x, y:a.y-b.y };
    let turn = |a: Point| Point { x:-a.y, y:a.x };
    // The frame of the main body: its longest wall, or the walls across it
    // when those lie closer to the street's direction.
    let main: Vec<Point> = parts.iter().filter(|(_,l)| house(l))
        .max_by(|a,b| super::geometry::area(&a.0).total_cmp(&super::geometry::area(&b.0)))
        .map(|(s,_)| s.outer.clone()).unwrap_or_default();
    let Some(wall) = (0..main.len()).map(|i| sub(main[(i+1)%main.len()], main[i]))
        .max_by(|a,b| dot(*a,*a).total_cmp(&dot(*b,*b))).filter(|w| dot(*w,*w) > 1e-9) else { return; };
    let len = dot(wall,wall).sqrt();
    let mut u = Point { x:wall.x/len, y:wall.y/len };
    if let Some(f) = lot.front {
        let street = sub(f[1],f[0]);
        if dot(u,street).abs() < dot(turn(u),street).abs() { u = turn(u); }
    }
    let mut n = turn(u);
    if let Some(f) = lot.front {
        let mid = Point { x:(f[0].x+f[1].x)*0.5, y:(f[0].y+f[1].y)*0.5 };
        let centre = main.iter().fold(Point { x:0., y:0. }, |c,p| Point { x:c.x+p.x, y:c.y+p.y });
        let centre = Point { x:centre.x/main.len() as f64, y:centre.y/main.len() as f64 };
        if dot(n, sub(centre,mid)) < 0.0 { n = Point { x:-n.x, y:-n.y }; }
    }
    let points: Vec<Point> = parts.iter().filter(|(_,l)| house(l)).flat_map(|(s,_)| s.outer.iter().copied()).collect();
    let (s0,s1) = points.iter().fold((f64::INFINITY,f64::NEG_INFINITY), |(a,b),&p| (a.min(dot(u,p)), b.max(dot(u,p))));
    // A side of the lot (an edge running in depth) within 25 cm of the point.
    let sides = &lot.shape.outer;
    let on_side = |p: Point| (0..sides.len()).any(|i| {
        let (a,e) = (sides[i], sub(sides[(i+1)%sides.len()], sides[i]));
        let l2 = dot(e,e);
        if l2 < 1e-9 || dot(e,n).abs() < 0.7*l2.sqrt() { return false; }
        let k = (dot(sub(p,a),e)/l2).clamp(0.0,1.0);
        let d = sub(p, Point { x:a.x+e.x*k, y:a.y+e.y*k });
        dot(d,d) < 0.25*0.25
    });
    let left = points.iter().any(|&p| dot(u,p) <= s0+0.05 && on_side(p));
    let right = points.iter().any(|&p| dot(u,p) >= s1-0.05 && on_side(p));
    // Depth along `n` from the house's front: its frame level, or, for a house
    // standing against a side of its lot, the street's own line (its side
    // walls then slide along themselves and its street wall stays on the street).
    let street = lot.front.map(|f| {
        let d = sub(f[1],f[0]);
        let l = dot(d,d).sqrt().max(1e-9);
        (f[0], Point { x:-d.y/l, y:d.x/l })
    });
    let depth = |p: Point| match street {
        Some((o,m)) if (left || right) && dot(n,m).abs() > 0.5 => dot(sub(p,o),m)/dot(n,m),
        _ => dot(n,p),
    };
    let (t0,t1) = points.iter().fold((f64::INFINITY,f64::NEG_INFINITY), |(a,b),&p| (a.min(depth(p)), b.max(depth(p))));
    let (kw,kd) = if left || right {
        let kd = area.max(0.7).max((4.0/(t1-t0).max(1e-9)).min(1.0));
        (area/kd, kd)
    } else { (area.sqrt(), area.sqrt()) };
    // Width shrinks towards the wall the house stands against, else about its centre line.
    let c = match (left,right) { (true,false) => s0, (false,true) => s1, _ => (s0+s1)*0.5 };
    // Without a street the depth shrinks about the middle.
    let base = if lot.front.is_some() { t0 } else { (t0+t1)*0.5 };
    let ring = |r: &[Point]| r.iter().map(|&p| {
        let (ds,dt) = ((c - dot(u,p))*(1.0-kw), (base - depth(p))*(1.0-kd));
        Point { x:p.x + u.x*ds + n.x*dt, y:p.y + u.y*ds + n.y*dt }
    }).collect();
    let scaled: Vec<_> = parts.iter().map(|(s,l)| if house(l) { (super::Shape {
        outer:ring(&s.outer), holes:s.holes.iter().map(|h| ring(h)).collect(),
    }, *l) } else { (s.clone(), *l) }).collect();
    // A porch or a bay of a composed home is small by nature.
    let least = |l: &str| if l != "building" && super::forms::plan::is_house_part(l) { 0.8 } else { 4.0 };
    if scaled.iter().all(|(s,l)| super::geometry::area(s) >= least(l)
        && super::geometry::difference(s, &lot.shape).iter().map(super::geometry::area).sum::<f64>() < 0.01) {
        parts.clone_from_slice(&scaled);
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseStyle {
    pub culture: String,
    pub weight: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseMix {
    pub styles: Vec<HouseStyle>,
    /// `lot` (default), `block` or `quarter`.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub spread: String,
}

/// The sources of one facet of a place (houses, monuments, farms, plots,
/// streets): a mix for the whole place, for a growth zone or for a quarter.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HouseSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<HouseMix>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub zones: BTreeMap<String, HouseMix>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub quarters: BTreeMap<String, HouseMix>,
}

impl HouseSettings {
    /// No mix chosen at any level.
    pub fn is_empty(&self) -> bool {
        !self.city.as_ref().is_some_and(HouseMix::usable)
            && !self.zones.values().any(HouseMix::usable)
            && !self.quarters.values().any(HouseMix::usable)
    }
    /// The cultures of the place's mix with their weights (empty: no mix).
    pub fn shares(&self) -> Vec<(&str, f64)> {
        self.city.as_ref().map_or(vec![], |m| m.styles.iter().filter(|s| s.usable()).map(|s| (s.culture.as_str(), s.weight)).collect())
    }
    /// The culture carrying most weight in a zone's mix (else the place's mix); None: no mix there.
    pub fn dominant(&self, zone: &str) -> Option<&str> {
        let mix = [self.zones.get(zone), self.city.as_ref()].into_iter().flatten().find(|m| m.usable())?;
        mix.styles.iter().filter(|s| s.usable()).max_by(|a, b| a.weight.total_cmp(&b.weight)).map(|s| s.culture.as_str())
    }
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
        // Two bodies either side of a reserve: narrowing about their centre line would cross it.
        lot.shape.holes.push(rectangle(9.,5.,12.4,10.).outer);
        let mut parts = vec![(rectangle(2.,2.,8.,15.), "building"), (rectangle(12.5,2.,20.,15.), "building")];
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
