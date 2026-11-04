//! Activity data (`activities.json`): the massing looks, installation ground kinds,
//! the V0.2 archetypes resolved onto them (with the services.json role and the
//! farmstead outbuilding they equal), the site templates and the culture matrix.
//! Data and lookups; `pick` draws the archetype of a specialised service lot
//! (building_sites.rs), whose look massing.rs applies.
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Deserialize)]
pub(crate) struct Look {
    pub roof: Vec<String>,
    pub eave: [f64; 2],
    pub floors: [u32; 2],
    pub footprint: Footprint,
    pub features: Vec<String>,
}
#[derive(Deserialize)]
pub(crate) struct Footprint { pub w: [f64; 2], pub d: [f64; 2] }

#[derive(Deserialize)]
pub(crate) struct Ground { pub semantic: String, pub size: [f64; 2] }

#[derive(Deserialize)]
pub(crate) struct Archetype {
    pub id: String,
    pub category: String,
    /// `building` (has a `look`) or `installation` (has a `ground`).
    pub kind: String,
    pub look: Option<String>,
    pub ground: Option<String>,
    /// services.json role this archetype specialises.
    pub role: Option<String>,
    /// catalogue.json `farmstead.buildings` key it equals.
    pub farmstead: Option<String>,
    /// Culture ids or family names allowed (absent = all).
    pub only: Option<Vec<String>>,
    /// massing.rs part label of a free-standing building (`nave`, `tower`, `minaret`…), `building` when absent.
    #[serde(default)]
    pub part: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct Site {
    pub id: String,
    /// Buildings always built; `a|b|c` = the first of them the culture may build.
    pub required: Vec<String>,
    pub optional: Vec<String>,
    pub installations: Vec<String>,
    /// Potential ids, all required; `a|b` = either.
    pub context: Vec<String>,
    pub mode: String,
    pub allowed_modes: Vec<String>,
    pub promote: String,
    pub access: String,
    pub target: String,
    pub seasonal: bool,
    pub claims: Vec<String>,
    pub only: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub(crate) struct Family {
    pub cultures: Vec<String>,
    pub transport: Vec<String>,
    /// Categories allowed (empty = all).
    pub allow_categories: Vec<String>,
    pub deny: Vec<String>,
    pub prefer: BTreeMap<String, f64>,
}
/// Per-culture adjustments: transport / allow_categories replace the family's when present, deny and prefer add to it.
#[derive(Deserialize, Default)]
pub(crate) struct Override {
    pub transport: Option<Vec<String>>,
    pub allow_categories: Option<Vec<String>>,
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub prefer: BTreeMap<String, f64>,
}
#[derive(Deserialize)]
pub(crate) struct Cultures { pub families: BTreeMap<String, Family>, pub overrides: BTreeMap<String, Override> }

#[derive(Deserialize)]
pub(crate) struct Activities {
    pub potentials: Vec<String>,
    pub transports: Vec<String>,
    pub looks: BTreeMap<String, Look>,
    pub family_looks: BTreeMap<String, String>,
    pub ground: BTreeMap<String, Ground>,
    pub archetypes: Vec<Archetype>,
    pub sites: Vec<Site>,
    pub cultures: Cultures,
}

pub(crate) fn data() -> &'static Activities {
    static DATA: OnceLock<Activities> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("activities.json")).expect("activities.json"))
}

pub(crate) fn archetype(id: &str) -> Option<&'static Archetype> { data().archetypes.iter().find(|a| a.id == id) }

pub(crate) fn family_of(culture: &str) -> Option<(&'static str, &'static Family)> {
    data().cultures.families.iter().find(|(_, f)| f.cultures.iter().any(|c| c == culture)).map(|(k, f)| (k.as_str(), f))
}

/// Whether a culture may build an archetype: `only` gate, allowed category, not denied.
pub(crate) fn allowed(culture: &str, archetype_id: &str) -> bool {
    let (Some(a), Some((fam, f))) = (archetype(archetype_id), family_of(culture)) else { return false };
    if a.only.as_ref().is_some_and(|o| !o.iter().any(|x| x == culture || x == fam)) { return false; }
    let o = data().cultures.overrides.get(culture);
    let cats = o.and_then(|o| o.allow_categories.as_ref()).unwrap_or(&f.allow_categories);
    if !cats.is_empty() && !cats.contains(&a.category) { return false; }
    !f.deny.contains(&a.id) && !o.is_some_and(|o| o.deny.contains(&a.id))
}

/// Draw weight of an archetype for a culture (1 when not preferred).
pub(crate) fn weight(culture: &str, archetype_id: &str) -> f64 {
    let Some((_, f)) = family_of(culture) else { return 1.0 };
    data().cultures.overrides.get(culture).and_then(|o| o.prefer.get(archetype_id))
        .or_else(|| f.prefer.get(archetype_id)).copied().unwrap_or(1.0)
}

/// Transport modes of a culture, in order of importance (empty for an unknown culture).
pub(crate) fn transport(culture: &str) -> &'static [String] {
    data().cultures.overrides.get(culture).and_then(|o| o.transport.as_deref())
        .or_else(|| family_of(culture).map(|(_, f)| f.transport.as_slice())).unwrap_or(&[])
}

/// Archetypes that specialise a services.json role.
pub(crate) fn specialisations(role: &str) -> impl Iterator<Item = &'static Archetype> + '_ {
    data().archetypes.iter().filter(move |a| a.role.as_deref() == Some(role))
}

/// Lot context an archetype draw reads.
#[derive(Clone, Copy, Default)]
pub(crate) struct LotContext {
    /// The lot fronts a river.
    pub river: bool,
    /// The lot fronts the sea or a lake.
    pub shore: bool,
    /// Open ground away from the dense centre (edge, faubourg, village…).
    pub open: bool,
}

/// The building archetype a lot of `role` takes: among the role's
/// specialisations the culture may build, those its context admits (water
/// mills on a river, tidal mills on a shore, windmills on open ground), the
/// most site-specific tier first (water, then wind, then the rest), drawn by
/// culture weight from the lot seed. None when the role has no specialisation.
pub(crate) fn pick(role: &str, culture: &str, ctx: LotContext, seed: &str) -> Option<&'static str> {
    let tier = |a: &Archetype| match a.look.as_deref() {
        Some("water_mill") => 0,
        Some("wind_mill") => 1,
        _ => 2,
    };
    let fits = |a: &Archetype| match a.look.as_deref() {
        // A boat mill floats on the river: never a lot's building.
        Some("water_mill") if a.id.starts_with("boat") => false,
        Some("water_mill") if a.id.starts_with("tidal") => ctx.shore,
        Some("water_mill") => ctx.river,
        Some("wind_mill") => ctx.open,
        _ => true,
    };
    let all: Vec<&Archetype> = specialisations(role).filter(|a| a.kind == "building" && fits(a) && allowed(culture, &a.id)).collect();
    let best = all.iter().map(|a| tier(a)).min()?;
    let pool: Vec<(&Archetype, f64)> = all.into_iter().filter(|a| tier(a) == best).map(|a| (a, weight(culture, &a.id).max(0.0))).collect();
    let total: f64 = pool.iter().map(|p| p.1).sum();
    let mut x = crate::rng::Rng::new(seed).fork("archetype").float() * total;
    for (a, w) in &pool {
        if x < *w { return Some(a.id.as_str()); }
        x -= w;
    }
    pool.last().map(|p| p.0.id.as_str())
}

/// Massing of one free-standing activity building (a territorial site, no lot):
/// the archetype's look on `ring`, in the culture's tradition. One piece.
pub(crate) fn building_massing(archetype_id: &str, culture: &str, ring: &[super::Point], seed: &str) -> serde_json::Value {
    let Some(a) = archetype(archetype_id) else { return serde_json::Value::Null };
    let parts = [(super::Shape { outer: ring.to_vec(), holes: vec![] }, a.part.as_deref().unwrap_or("building"))];
    super::massing::massing(&super::massing::Input {
        parts: &parts,
        arch: &serde_json::Value::Null,
        culture,
        zone: "village",
        role: a.role.as_deref().unwrap_or(""),
        function: "workshop",
        landmark: false,
        wealth: 0.4,
        pressure: 0.0,
        small_home: false,
        population: 0,
        fronts: &[],
        low_rural: true,
        distance: 2.0,
        seed,
        archetype: archetype_id,
    })
}

impl crate::settlements::installations::Ground for super::Surface<'_> {
    fn width(&self) -> f64 { self.width }
    fn n(&self) -> usize { self.n }
    fn water_at(&self, i: usize) -> u8 { self.water[i] }
    fn river_width_at(&self, _: usize) -> f32 { 10.0 }
    fn height_at(&self, p: super::Point) -> f64 { super::Surface::height_at(self, p) }
}

/// City Bench `activity` intent: one site template standing as the whole place.
/// Buildings of template `template` laid as a yard at `centre` along `angle`
/// (`key`: the place's key; the same call gives the same yard at every stage).
pub(crate) fn site_yard(template: &str, culture: &str, key: &str, centre: super::Point, angle: f64, ground: &dyn crate::settlements::installations::Ground) -> Vec<crate::settlements::activities::ActivityBuilding> {
    use crate::settlements::activities as sites;
    if is_farm(template) {
        return farm_yard(&format!("activity:{key}"), culture, centre, angle, if template == "large_estate" { 0.85 } else { 0.5 }, ground);
    }
    let Some(t) = data().sites.iter().find(|s| s.id == template) else { return vec![] };
    let mut rng = crate::rng::Rng::new(&format!("activity-site:{key}"));
    let names = sites::pick(t, culture, 2, &mut rng);
    if names.is_empty() {
        return vec![];
    }
    sites::yard(&format!("activity:{key}"), culture, &names, centre, angle, &mut rng, ground, &|_| true)
}

/// Dispersed-farm density of a culture (farmsteads.rs).
pub(crate) fn farm_density(culture: &str) -> f64 { super::farmsteads::density(culture) }

/// Farm templates: their yard is a farmstead (farmsteads.rs), never loose sheds.
pub(crate) fn is_farm(template: &str) -> bool { matches!(template, "small_farm" | "large_estate") }

/// A working farm on its own lot at `centre`: the farmhouse on the lot's front (towards
/// `-v`, v = `angle` + 90°), its culture's farm type of outbuildings round the yard
/// (farmsteads.rs, the city farms' generator) and the city massing of every body.
/// Bodies on water are dropped; no farm when the house is. Keyed by `id`.
pub(crate) fn farm_yard(id: &str, culture: &str, centre: super::Point, angle: f64, wealth: f64, ground: &dyn crate::settlements::installations::Ground) -> Vec<crate::settlements::activities::ActivityBuilding> {
    use super::Point;
    let (u, v) = (Point { x: angle.cos(), y: angle.sin() }, Point { x: -angle.sin(), y: angle.cos() });
    let at = |s: f64, t: f64| Point { x: centre.x + u.x * s + v.x * t, y: centre.y + u.y * s + v.y * t };
    let rect = |s0: f64, s1: f64, t0: f64, t1: f64| super::Shape { outer: vec![at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)], holes: vec![] };
    let wet = |r: &[Point]| r.iter().any(|&p| p.x < 0.0 || p.y < 0.0 || p.x >= ground.width() || p.y >= ground.width() || ground.water_at(ground.index(p)) != 0);
    let scale = super::culture::house_parameters(culture).0;
    let (lw, ld) = ((34.0 + 26.0 * wealth) * scale, (40.0 + 26.0 * wealth) * scale);
    let lot = rect(-lw / 2.0, lw / 2.0, -ld / 2.0, ld / 2.0);
    // A lot too tight for any outbuilding retries with the next seed: never a lone house.
    let (mut best, mut best_seed): (Vec<(super::Shape, &'static str)>, String) = (vec![], id.to_string());
    for k in 0..3 {
        let seed = if k == 0 { id.to_string() } else { format!("{id}#{k}") };
        let (hw, hd) = super::farmsteads::house_size(culture, &seed);
        let (hw, hd) = (hw * scale * (0.9 + 0.25 * wealth), hd * scale * (0.9 + 0.25 * wealth));
        let s = crate::rng::Rng::new(&seed).fork("farmhouse-at").range(-0.2, 0.2) * (lw - hw);
        let house = rect(s - hw / 2.0, s + hw / 2.0, -ld / 2.0 + 1.0, -ld / 2.0 + 1.0 + hd);
        if wet(&house.outer) {
            return vec![];
        }
        let mut parts = vec![(house, "building")];
        if super::farmsteads::build(&mut parts, &lot, culture, true, true, wealth, &seed).is_none() {
            continue;
        }
        parts.retain(|(p, _)| !wet(&p.outer));
        if parts.len() > best.len() {
            best = parts;
            best_seed = seed;
        }
        if best.len() >= 3 {
            break;
        }
    }
    if best.is_empty() {
        return vec![];
    }
    let front = [at(-lw / 2.0, -ld / 2.0), at(lw / 2.0, -ld / 2.0)];
    let massing = super::massing::massing(&super::massing::Input {
        parts: &best, arch: &serde_json::Value::Null, culture, zone: "rural", role: "dwelling.farm", function: "dwelling",
        landmark: false, wealth, pressure: 0.0, small_home: false, population: 0, fronts: &[front], low_rural: true, distance: 2.0,
        seed: &best_seed, archetype: "",
    });
    let kind = super::farmsteads::farm_type(culture, &best_seed);
    best.iter().enumerate().map(|(k, (shape, label))| crate::settlements::activities::ActivityBuilding {
        archetype: if k == 0 { "farmhouse".into() } else { label.to_string() },
        look: if k == 0 { kind.into() } else { label.to_string() },
        ring: shape.outer.clone(),
        massing: serde_json::Value::Array(vec![massing.get(k).cloned().unwrap_or(serde_json::Value::Null)]),
    }).collect()
}

/// Whether a template works water (mill race, pier, pans…): its yard stands on a bank.
pub(crate) fn site_wants_water(template: &str) -> bool {
    data().sites.iter().find(|s| s.id == template).is_some_and(|t| t.installations.iter().any(|i| matches!(i.as_str(), "mill_weir" | "mill_leat" | "wooden_pier" | "boat_ramp" | "canoe_landing" | "salt_pans" | "fish_weir" | "fish_trap")))
}

/// Ground installations of that site (flat shapes beside the yard) not entering `avoid`.
pub(crate) fn site_installations(template: &str, culture: &str, key: &str, centre: super::Point, yard: &[crate::settlements::activities::ActivityBuilding], ground: &dyn crate::settlements::installations::Ground, avoid: &dyn Fn(super::Point) -> bool) -> Vec<crate::settlements::installations::Installation> {
    let Some(t) = data().sites.iter().find(|s| s.id == template) else { return vec![] };
    crate::settlements::installations::lay(&crate::settlements::activities::allowed_installations(t, culture), &format!("activity:{key}"), centre, yard, ground, None, avoid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Every quoted `word.word` string of a JSON text (the role ids of services.json).
    fn roles(text: &str) -> BTreeSet<&str> {
        text.split('"').skip(1).step_by(2).filter(|s| s.contains('.') && !s.contains(' ') && s.chars().all(|c| c.is_ascii_lowercase() || c == '.' || c == '-')).collect()
    }

    #[test]
    fn activities_catalogue_is_coherent() {
        let d = data();
        let services = roles(include_str!("services.json"));
        let cat: serde_json::Value = serde_json::from_str(include_str!("catalogue.json")).unwrap();
        let farm = &cat["farmstead"]["buildings"];
        let cultures: BTreeSet<&str> = cat["cultures"].as_object().unwrap().keys().map(String::as_str).collect();
        // 310 archetypes, unique ids, looks/ground resolve
        assert_eq!(d.archetypes.len(), 310);
        let ids: BTreeSet<&str> = d.archetypes.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids.len(), 310, "duplicate archetype id");
        assert!(d.family_looks.values().all(|l| d.looks.contains_key(l)), "family_looks -> unknown look");
        let cats: BTreeSet<&str> = d.archetypes.iter().map(|a| a.category.as_str()).collect();
        let known_group = |x: &String| cultures.contains(x.as_str()) || d.cultures.families.contains_key(x);
        for a in &d.archetypes {
            match a.kind.as_str() {
                "building" => assert!(a.look.as_ref().is_some_and(|l| d.looks.contains_key(l)) && a.ground.is_none(), "{}: look", a.id),
                "installation" => assert!(a.ground.as_ref().is_some_and(|g| d.ground.contains_key(g)) && a.look.is_none(), "{}: ground", a.id),
                k => panic!("{}: kind {k}", a.id),
            }
            if let Some(r) = &a.role { assert!(services.contains(r.as_str()), "{}: role {r} not in services.json", a.id); }
            if let Some(f) = &a.farmstead { assert!(farm.get(f).is_some(), "{}: farmstead {f}", a.id); }
            assert!(a.only.iter().flatten().all(known_group), "{}: only", a.id);
        }
        // sites
        let pot: BTreeSet<&str> = d.potentials.iter().map(String::as_str).collect();
        for s in &d.sites {
            for b in s.required.iter().chain(&s.optional).flat_map(|b| b.split('|')) {
                assert!(archetype(b).is_some_and(|a| a.kind == "building"), "{}: building {b}", s.id);
            }
            for i in &s.installations { assert!(archetype(i).is_some_and(|a| a.kind == "installation"), "{}: installation {i}", s.id); }
            for c in s.context.iter().flat_map(|c| c.split('|')) { assert!(pot.contains(c), "{}: context {c}", s.id); }
            for r in &s.claims { assert!(services.contains(r.as_str()), "{}: claim {r}", s.id); }
            assert!(s.only.iter().flatten().all(known_group), "{}: only", s.id);
        }
        assert_eq!(d.sites.len(), 54);
        // cultures: each of the catalogue's cultures in exactly one family
        let mut seen = BTreeSet::new();
        for f in d.cultures.families.values() {
            for c in &f.cultures { assert!(seen.insert(c.as_str()), "culture {c} in two families"); }
            assert!(f.transport.iter().all(|t| d.transports.contains(t)));
            assert!(f.allow_categories.iter().all(|c| cats.contains(c.as_str())));
            for k in f.deny.iter().chain(f.prefer.keys()) { assert!(ids.contains(k.as_str()), "family deny/prefer {k}"); }
        }
        assert_eq!(seen, cultures, "family cultures != catalogue.json cultures");
        for (c, o) in &d.cultures.overrides {
            assert!(cultures.contains(c.as_str()), "override for unknown culture {c}");
            assert!(o.transport.iter().flatten().all(|t| d.transports.contains(t)));
            assert!(o.allow_categories.iter().flatten().all(|c| cats.contains(c.as_str())));
            for k in o.deny.iter().chain(o.prefer.keys()) { assert!(ids.contains(k.as_str()), "override deny/prefer {k}"); }
        }
        assert!(cultures.iter().all(|c| !transport(c).is_empty()), "culture without transport");
        // every specialised role has an archetype some culture may build
        let roles: BTreeSet<&str> = d.archetypes.iter().filter_map(|a| a.role.as_deref()).collect();
        for r in roles {
            assert!(specialisations(r).any(|a| cultures.iter().any(|c| allowed(c, &a.id))), "role {r}: no archetype allowed anywhere");
        }
        eprintln!("activities: {} archetypes, {} sites, {} families, {} overrides", d.archetypes.len(), d.sites.len(), d.cultures.families.len(), d.cultures.overrides.len());
    }
}
