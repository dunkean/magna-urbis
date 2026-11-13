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
    /// A constructed installation can declare its material independently of
    /// the culture's dwelling form (for example a stone water trough).
    #[serde(default)]
    pub material: Option<String>,
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
    /// The singular building it becomes where it stands alone in a yard (`formed`).
    #[serde(default)]
    pub form: Option<Form>,
}

/// The form of a town lot (parcels/monuments, parcels/landmark.rs) an isolated
/// yard building takes: a chapel is a small church, a road inn a court of ranges.
#[derive(Deserialize)]
pub(crate) struct Form {
    /// Role whose form is built: a services.json role (`worship.parish`,
    /// `commerce.inn`…) or a countryside one of parcels/monuments/rural.rs
    /// (`rural.windmill`, `rural.barrow`…).
    pub role: String,
    /// Ground the form needs (m): width along its front, depth behind it.
    pub site: [f64; 2],
    /// Part label the culture's form must hold (`abbey-range`, `stupa`…); a
    /// culture whose form of that role has none keeps the single ring.
    #[serde(default)]
    pub has: Option<String>,
    /// Archetypes of the same yard the form already holds (a belfry, a
    /// cloister, a stable): they join it instead of standing beside it.
    #[serde(default)]
    pub absorbs: Vec<String>,
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
    /// A remote place (settlements/remote.rs): placed by its terrain situation, never by a resource anchor.
    #[serde(default)]
    pub remote: Option<RemotePlace>,
}

/// What makes a template a remote place: where it may stand and how one gets there.
#[derive(Deserialize)]
pub(crate) struct RemotePlace {
    /// Situations it stands in (keys of `remote.situations`).
    pub situations: Vec<String>,
    /// Access kinds (keys of `remote.accesses`) and their draw weights.
    pub access: BTreeMap<String, f64>,
    /// Share of these places found in ruins.
    #[serde(default)]
    pub ruined: f64,
    /// Draw weight among the templates of one situation.
    pub weight: f64,
}

/// A terrain situation of the remote places: its draw weight and the thresholds its
/// predicate reads (metres, grades, potentials; see `remote._doc`).
#[derive(Deserialize)]
pub(crate) struct Situation {
    pub weight: f64,
    #[serde(flatten)]
    pub thresholds: BTreeMap<String, f64>,
}
impl Situation {
    /// A threshold of the situation, 0 when it declares none of that name.
    pub(crate) fn at(&self, key: &str) -> f64 {
        self.thresholds.get(key).copied().unwrap_or(0.0)
    }
}

/// A way to a remote place.
#[derive(Deserialize)]
pub(crate) struct Access {
    /// Geometry: `none` (no path at all), `path` (an ordinary trail to the door), `fall`
    /// (steps down the fall line), `span` (across water to the nearest other shore),
    /// `bore` (a gallery through the rock).
    pub line: String,
    /// Installation archetype drawn along the line.
    #[serde(default)]
    pub installation: Option<String>,
    /// Steepest grade of a `fall` line (rise over run).
    #[serde(default)]
    pub grade: f64,
    /// Longest line (m).
    #[serde(default)]
    pub reach: f64,
}

/// Remote places (settlements/remote.rs): rarity, spacing and the two vocabularies.
#[derive(Deserialize)]
pub(crate) struct Remote {
    /// Places on 100 km² of land at frequency 1; the count grows as the square root of the land.
    pub rate: f64,
    /// Most places of one region, whatever the frequency.
    pub most: usize,
    /// Distance kept between two remote places (m).
    pub spacing: f64,
    /// Distance kept from the edge of any settlement (m).
    pub clear: f64,
    /// Distance kept from the other countryside sites (m).
    pub site_gap: f64,
    /// Grade under which a stair stops: an ordinary trail takes over.
    pub path_grade: f64,
    pub situations: BTreeMap<String, Situation>,
    pub accesses: BTreeMap<String, Access>,
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
    pub remote: Remote,
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

/// The culture's own building tradition (typology, roof, storeys, material): the `arch`
/// of its village preset in the catalogue, else its hamlet's, else its core's. Null when
/// it declares none (massing.rs then reads its own table).
pub(crate) fn culture_arch(culture: &str) -> &'static serde_json::Value {
    let presets = &super::catalogue()["presets"];
    ["village", "hamlet", "core"]
        .iter()
        .map(|recipe| &presets[format!("{culture}/{recipe}")]["params"]["arch"])
        .find(|arch| arch.is_object())
        .unwrap_or(&serde_json::Value::Null)
}

/// Massing of one free-standing activity building (a territorial site, no lot):
/// the archetype's look on `ring`, in the culture's tradition. One piece.
pub(crate) fn building_massing(archetype_id: &str, culture: &str, ring: &[super::Point], seed: &str) -> serde_json::Value {
    let Some(a) = archetype(archetype_id) else { return serde_json::Value::Null };
    let parts = [(super::Shape { outer: ring.to_vec(), holes: vec![] }, a.part.as_deref().unwrap_or("building"))];
    super::massing::massing(&super::massing::Input {
        parts: &parts,
        arch: culture_arch(culture),
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
        complex: false, user_core: false,
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
    let id = format!("activity:{key}");
    let yard = sites::yard(&id, culture, &names, centre, angle, &mut rng, ground, &|_| true);
    formed(&id, culture, yard, angle, ground, &|_| true)
}

/// Clear ground kept between a form's site and the other buildings of its yard (m).
const FORM_GAP_M: f64 = 5.0;

/// Part labels of a windmill body that carries the sails (parcels/monuments/rural.rs).
const SAIL_LABELS: [&str; 4] = ["mill-buck", "mill-tower", "mill-smock", "mill-drum"];

/// Sails on a windmill body raised by a mass rule: the `sails` roof feature of
/// massing.rs (`{kind, x, y, w, d, h, angle, turn}`) on the top volume of the
/// massing entry `piece`, the hub out of the wall (or the cap) the seed turns
/// to the wind. A cap carries the windshaft in its slope, a gabled buck just
/// under its eaves.
fn add_sails(piece: &mut serde_json::Value, seed: &str) {
    let Some(v) = piece.get_mut("volumes").and_then(|v| v.as_array_mut()).and_then(|v| v.last_mut()) else { return };
    let ring: Vec<(f64, f64)> = v["ring"].as_array().into_iter().flatten().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect();
    if ring.len() < 3 {
        return;
    }
    let n = ring.len() as f64;
    let (cx, cy) = (ring.iter().map(|p| p.0).sum::<f64>() / n, ring.iter().map(|p| p.1).sum::<f64>() / n);
    let mut r = crate::rng::Rng::new(seed).fork("sails");
    let capped = matches!(v["roof"].as_str(), Some("cone" | "dome" | "pyramid"));
    let side = |k: usize| {
        let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
        (b.0 - a.0).hypot(b.1 - a.1)
    };
    // Any face of a round tower; one of the two gable ends (the short sides) of a buck.
    let k = if capped {
        ((r.float() * n) as usize).min(ring.len() - 1)
    } else {
        let short = (0..ring.len()).min_by(|&i, &j| side(i).total_cmp(&side(j))).unwrap_or(0);
        if r.chance(0.5) { (short + ring.len() / 2) % ring.len() } else { short }
    };
    let turn = r.range(0.0, std::f64::consts::FRAC_PI_2);
    let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
    let (mx, my) = ((a.0 + b.0) * 0.5 - cx, (a.1 + b.1) * 0.5 - cy);
    let reach = mx.hypot(my);
    if reach < 0.5 {
        return;
    }
    let angle = my.atan2(mx);
    let (eave, rise) = (v["eave_m"].as_f64().unwrap_or(0.0), v["rise_m"].as_f64().unwrap_or(0.0));
    let (out, up) = if capped { (0.45 * reach + 0.5, 0.55 * rise) } else { (reach + 0.4, -0.8) };
    let len = ((eave + up) * 0.8).min(reach * 3.2).max(3.0);
    let round2 = |x: f64| (x * 100.0).round() / 100.0;
    let feature = serde_json::json!({
        "kind": "sails", "x": round2(cx + angle.cos() * out), "y": round2(cy + angle.sin() * out),
        "w": round2(len), "d": round2(len * 0.2), "h": round2(up), "angle": round2(angle), "turn": round2(turn),
    });
    if !v.get("features").is_some_and(|f| f.is_array()) {
        v["features"] = serde_json::json!([]);
    }
    if let Some(f) = v["features"].as_array_mut() {
        f.push(feature);
    }
}

/// The yard with its singular buildings as real forms. A building whose
/// archetype names a `form` is replaced by the labelled parts of that role's
/// building in its culture (parcels/standalone.rs), on the form's site centred
/// where the building stood, its front on the yard's front (towards `-v`,
/// v = `angle` + 90°). The buildings the form `absorbs` (a belfry, a cloister,
/// a stable) join it: each gives its archetype to one part, so every template
/// entry still stands in the yard. The other buildings step aside along their
/// own side of the yard, `FORM_GAP_M` clear of the site. One building per
/// part, in order, each with its own massing entry, the roofs composed across
/// the whole form. The largest form of a yard is laid first; a form whose
/// ground is refused (water, a cliff, `ok`), that would push a neighbour onto
/// such ground or that the culture does not build leaves the yard as it was.
/// A yard already formed is returned unchanged.
pub(crate) fn formed(id: &str, culture: &str, yard: Vec<crate::settlements::activities::ActivityBuilding>, angle: f64, ground: &dyn crate::settlements::installations::Ground, ok: &dyn Fn(&[super::Point]) -> bool) -> Vec<crate::settlements::activities::ActivityBuilding> {
    use super::Point;
    use crate::settlements::activities::ActivityBuilding;
    let form_of = |name: &str| archetype(name).and_then(|a| a.form.as_ref());
    // A formed part carries its label as look; an untouched building its archetype's.
    let plain = |b: &ActivityBuilding| archetype(&b.archetype).is_some_and(|a| a.look.as_deref() == Some(b.look.as_str()));
    if !yard.iter().all(plain) {
        return yard;
    }
    let area_of = |i: usize| form_of(&yard[i].archetype).map_or(0.0, |f| f.site[0] * f.site[1]);
    let mut bearers: Vec<usize> = (0..yard.len()).filter(|&i| form_of(&yard[i].archetype).is_some()).collect();
    if bearers.is_empty() {
        return yard;
    }
    bearers.sort_by(|&a, &b| area_of(b).total_cmp(&area_of(a)).then(a.cmp(&b)));
    let (u, v) = (Point { x: angle.cos(), y: angle.sin() }, Point { x: -angle.sin(), y: angle.cos() });
    // Forms are measured in metres; a giant's site grows with its houses.
    let scale = super::culture::house_parameters(culture).0.max(1.0);
    let local = |p: Point, c: Point| ((p.x - c.x) * u.x + (p.y - c.y) * u.y, (p.x - c.x) * v.x + (p.y - c.y) * v.y);
    let centre_of = |ring: &[Point]| {
        let n = ring.len().max(1) as f64;
        Point { x: ring.iter().map(|p| p.x).sum::<f64>() / n, y: ring.iter().map(|p| p.y).sum::<f64>() / n }
    };
    // Half extents along u and v of the ground a building needs: its ring, and its own form's site when it has one.
    let reach = |j: usize, ring: &[Point]| {
        let c = centre_of(ring);
        let (hs, ht) = ring.iter().fold((0.0_f64, 0.0_f64), |(a, b), &p| {
            let (s, t) = local(p, c);
            (a.max(s.abs()), b.max(t.abs()))
        });
        match form_of(&yard[j].archetype) {
            Some(f) => (hs.max(f.site[0] * scale * 0.5), ht.max(f.site[1] * scale * 0.5)),
            None => (hs, ht),
        }
    };
    let dry = |p: Point| p.x >= 0.0 && p.y >= 0.0 && p.x < ground.width() && p.y < ground.width() && ground.water_at(ground.index(p)) == 0;
    // Dry at every corner and mid-side, admitted by the caller, on ground the culture builds on.
    let stands = |ring: &[Point]| {
        (0..ring.len()).all(|k| {
            let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
            dry(a) && dry(Point { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 })
        }) && ok(ring)
            && ground_fits(ring, culture, ground)
    };
    let mut rings: Vec<Vec<Point>> = yard.iter().map(|b| b.ring.clone()).collect();
    let mut moved = vec![false; yard.len()];
    let mut taken = vec![false; yard.len()];
    // What stands for each building in the end: itself (None), the parts of its form, or nothing once absorbed.
    let mut built: Vec<Option<Vec<ActivityBuilding>>> = yard.iter().map(|_| None).collect();
    // Sites of the forms already laid: centre and half extents along u and v.
    let mut sites: Vec<(Point, f64, f64)> = vec![];
    for &i in &bearers {
        if taken[i] {
            continue;
        }
        let Some(form) = form_of(&yard[i].archetype) else { continue };
        let members: Vec<usize> = (0..yard.len()).filter(|&j| !taken[j] && (j == i || form.absorbs.iter().any(|a| *a == yard[j].archetype))).collect();
        let centre = centre_of(&rings[members[0]]);
        let seed = format!("{id}/form/{}", yard[i].archetype);
        // The whole site, then a tighter one where the ground refuses it.
        for k in [1.0, 0.8] {
            let (hw, hd) = (form.site[0] * scale * k * 0.5, form.site[1] * scale * k * 0.5);
            let corner = |s: f64, t: f64| Point { x: centre.x + u.x * s + v.x * t, y: centre.y + u.y * s + v.y * t };
            let rect = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
            let crowded = sites.iter().any(|&(c, hs, ht)| {
                let (s, t) = local(centre, c);
                s.abs() < hs + hw + 1.0 && t.abs() < ht + hd + 1.0
            });
            if crowded || !stands(&rect) {
                continue;
            }
            // The other buildings step aside, each along the side of the yard it stands on.
            let mut next = rings.clone();
            let mut shifted: Vec<usize> = vec![];
            let mut clear = true;
            for j in 0..yard.len() {
                if taken[j] || members.contains(&j) {
                    continue;
                }
                let (ds, dt) = local(centre_of(&next[j]), centre);
                let (hs, ht) = reach(j, &next[j]);
                let (need_s, need_t) = (hw + FORM_GAP_M + hs, hd + FORM_GAP_M + ht);
                if ds.abs() >= need_s || dt.abs() >= need_t {
                    continue;
                }
                let (ms, mt) = if ds.abs() * need_t >= dt.abs() * need_s { ((need_s - ds.abs()).copysign(ds), 0.0) } else { (0.0, (need_t - dt.abs()).copysign(dt)) };
                for p in next[j].iter_mut() {
                    *p = Point { x: p.x + u.x * ms + v.x * mt, y: p.y + u.y * ms + v.y * mt };
                }
                if !stands(&next[j]) {
                    clear = false;
                    break;
                }
                shifted.push(j);
            }
            if !clear {
                continue;
            }
            let Some(parts) = super::parcels::standalone::parts(&form.role, culture, centre, u, v, 2.0 * hw, 2.0 * hd, 0.5, &seed) else { continue };
            if parts.len() < members.len()
                || form.has.as_deref().is_some_and(|label| !parts.iter().any(|p| p.1 == label))
                || parts.iter().any(|(shape, _)| !shape.outer.iter().all(|&p| dry(p)))
            {
                continue;
            }
            // One massing for the whole form, so that its roofs join; raised at village scale.
            let front = [corner(-hw, -hd), corner(hw, -hd)];
            let massing = super::massing::massing(&super::massing::Input {
                parts: &parts,
                arch: culture_arch(culture),
                culture,
                zone: "village",
                role: &form.role,
                function: "collective",
                landmark: true,
                wealth: 0.5,
                pressure: 0.0,
                small_home: false,
                population: 100,
                fronts: &[front],
                low_rural: true,
                distance: 2.0,
                seed: &seed,
                archetype: "",
                complex: true, user_core: false,
            });
            // Every absorbed building gives its archetype to one part: one of its own label
            // when the form has it (the belfry is the tower), else the last one free
            // (the yard's last buildings take the form's rear ranges).
            let mut names: Vec<&str> = vec![yard[i].archetype.as_str(); parts.len()];
            let mut free = vec![true; parts.len()];
            for &j in members.iter().rev().filter(|&&j| j != i) {
                let label = archetype(&yard[j].archetype).and_then(|a| a.part.as_deref());
                let own = (0..parts.len()).find(|&p| free[p] && Some(parts[p].1) == label);
                if let Some(p) = own.or_else(|| (0..parts.len()).rev().find(|&p| free[p])) {
                    names[p] = yard[j].archetype.as_str();
                    free[p] = false;
                }
            }
            let mut pieces: Vec<ActivityBuilding> = parts
                .iter()
                .enumerate()
                .map(|(p, (shape, label))| {
                    let mut piece = massing.get(p).cloned().unwrap_or(serde_json::Value::Null);
                    if SAIL_LABELS.contains(label) {
                        add_sails(&mut piece, &seed);
                    }
                    ActivityBuilding { archetype: names[p].to_string(), look: label.to_string(), ring: shape.outer.clone(), massing: serde_json::Value::Array(vec![piece]) }
                })
                .collect();
            // The yard's first building stays first under its own name.
            if let Some(p) = pieces.iter().position(|b| b.archetype == yard[members[0]].archetype) {
                pieces.swap(0, p);
            }
            for &j in &members {
                taken[j] = true;
                built[j] = Some(vec![]);
            }
            built[members[0]] = Some(pieces);
            for &j in &shifted {
                moved[j] = true;
            }
            rings = next;
            sites.push((centre, hw, hd));
            break;
        }
    }
    let mut out = vec![];
    for (j, b) in yard.into_iter().enumerate() {
        match built[j].take() {
            Some(pieces) => out.extend(pieces),
            // A building that stepped aside is raised again where it now stands.
            None if moved[j] => {
                let ring = std::mem::take(&mut rings[j]);
                let massing = building_massing(&b.archetype, culture, &ring, &format!("{id}/{j}"));
                out.push(ActivityBuilding { ring, massing, ..b });
            }
            None => out.push(b),
        }
    }
    out
}

/// Most broken-wall pieces of one ruined yard.
const RUINED_YARD_PIECES: usize = 36;

/// A yard fallen into ruin (the lost ruins of settlements/remote.rs): every building
/// becomes the broken walls of its own footprint (parcels/ruins.rs `broken_walls`, the one
/// ruin representation), so the ruin stands on the ground the building stood on. Each
/// piece keeps the archetype of the building it comes from; its look is its ruin label
/// (`ruin`, `ruin-corner`, `rubble`). A yard that leaves no wall is returned as it was.
pub(crate) fn ruined(id: &str, culture: &str, yard: Vec<crate::settlements::activities::ActivityBuilding>) -> Vec<crate::settlements::activities::ActivityBuilding> {
    use super::parcels::ruins;
    use crate::settlements::activities::ActivityBuilding;
    let mut rng = crate::rng::Rng::new(id).fork("ruined-yard");
    let mut parts: Vec<(super::Shape, &'static str)> = vec![];
    let mut owner: Vec<usize> = vec![];
    for (j, b) in yard.iter().enumerate() {
        let left = RUINED_YARD_PIECES.saturating_sub(parts.len());
        if left == 0 {
            break;
        }
        let mut budget = ruins::RUIN_BUDGET.min(left);
        ruins::broken_walls(&b.ring, None, 0.3, (0.4, 1.0), &mut rng, &mut budget, &mut parts);
        owner.resize(parts.len(), j);
    }
    if parts.is_empty() {
        return yard;
    }
    let seed = format!("{id}/ruin");
    let massing = super::massing::massing(&super::massing::Input {
        parts: &parts,
        arch: culture_arch(culture),
        culture,
        zone: "village",
        role: "",
        function: "collective",
        landmark: false,
        wealth: 0.4,
        pressure: 0.0,
        small_home: false,
        population: 0,
        fronts: &[],
        low_rural: true,
        distance: 2.0,
        seed: &seed,
        archetype: "",
        complex: false, user_core: false,
    });
    parts
        .iter()
        .enumerate()
        .map(|(k, (shape, label))| ActivityBuilding {
            archetype: yard[owner[k]].archetype.clone(),
            look: label.to_string(),
            ring: shape.outer.clone(),
            massing: serde_json::Value::Array(vec![massing.get(k).cloned().unwrap_or(serde_json::Value::Null)]),
        })
        .collect()
}

/// The activity grammar certifies its own buildings, rather than a residential
/// admission envelope. Recheck containment after road cuts or parcel edits.
pub(crate) fn retained_yard(layout: &super::Layout, template: &str, block: usize, shape: &super::Shape, ground: &dyn crate::settlements::installations::Ground) -> Vec<crate::settlements::activities::ActivityBuilding> {
    let Some(structure) = layout.structure.as_ref().filter(|s| s.mechanism == "kind") else { return vec![] };
    let Some(centre) = structure.centers.first().map(|c| c.point) else { return vec![] };
    let Some(block) = layout.blocks.get(block) else { return vec![] };
    let yard = site_yard(template, &layout.culture, &layout.key, centre, block.axis.y.atan2(block.axis.x), ground);
    if yard.iter().all(|b| {
        let body = super::Shape { outer: b.ring.clone(), holes: vec![] };
        super::geometry::difference(&body, shape).iter().map(super::geometry::area).sum::<f64>() <= 0.01
    }) { yard } else { vec![] }
}

/// Required stepped plinth for the actual utility bodies. Each body has its
/// own platform; the difference in elevation across the entire yard is irrelevant.
pub(crate) fn yard_step(yard: &[crate::settlements::activities::ActivityBuilding], ground: &dyn crate::settlements::installations::Ground) -> f64 {
    yard.iter().map(|b| {
        let shape = super::Shape { outer: b.ring.clone(), holes: vec![] };
        let (x0, y0, x1, y1) = super::geometry::bbox(&shape);
        let nx = ((x1 - x0) / 0.5).ceil().max(1.0) as usize;
        let ny = ((y1 - y0) / 0.5).ceil().max(1.0) as usize;
        let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
        // The bounding rectangle conservatively includes the whole footing.
        for y in 0..=ny { for x in 0..=nx {
            let h = ground.height_at(super::Point { x: x0 + (x1 - x0) * x as f64 / nx as f64, y: y0 + (y1 - y0) * y as f64 / ny as f64 });
            low = low.min(h);
            high = high.max(h);
        }}
        high - low
    }).fold(0.0, f64::max)
}

/// Steepest steady ground (rise over run) an isolated body stands on with a stepped plinth:
/// 45°, the 3D view's cliff slope (`CITY3D_CLIFF_SLOPE`). Terracing cultures go to `2 × TERRACE_SLOPE`.
const STEADY_SLOPE: f64 = 1.0;
/// A break in the ground: the grade between neighbouring samples jumps by this much
/// (rise over run) where one side is steeper than `BREAK_SLOPE`. A uniform slope has none.
const BREAK_JUMP: f64 = 0.35;
const BREAK_SLOPE: f64 = 0.5;
/// Highest stepped plinth across the footprint's short side (two terraced-town steps), m.
const ISOLATED_PLINTH_M: f64 = 12.0;

/// Invariant for every isolated building (activity yards, farms, worship sites, network
/// nodes): it never stands across a cliff. A steady slope is normal ground (a stepped,
/// terraced plinth) up to `STEADY_SLOPE` (twice the town terrace limit for cultures that cut
/// terraces). Refused: a break under the footprint (the grade between neighbouring samples
/// jumps, a cliff edge or foot), a steady grade beyond the limit, or a plinth above
/// `ISOLATED_PLINTH_M` even with the body turned along the contour (its short side).
pub(crate) fn ground_fits(ring: &[super::Point], culture: &str, ground: &dyn crate::settlements::installations::Ground) -> bool {
    if ring.len() < 3 {
        return true;
    }
    let profile = super::profiles::profile(culture);
    let limit = if profile.stairs || profile.pattern == "terraces" { (2.0 * super::profiles::TERRACE_SLOPE).max(STEADY_SLOPE) } else { STEADY_SLOPE };
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in ring {
        (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
    }
    let inside = |p: super::Point| {
        let mut odd = false;
        for (i, a) in ring.iter().enumerate() {
            let b = ring[(i + 1) % ring.len()];
            if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y) {
                odd = !odd;
            }
        }
        odd
    };
    // About 1 m apart on a house, 8 cells across a large barn, inside the ring only.
    let step = ((x1 - x0).max(y1 - y0) / 8.0).max(1.0);
    let (nx, ny) = (((x1 - x0) / step).ceil().max(1.0) as usize, ((y1 - y0) / step).ceil().max(1.0) as usize);
    let (dx, dy) = ((x1 - x0) / nx as f64, (y1 - y0) / ny as f64);
    let h: Vec<Option<f64>> = (0..=ny)
        .flat_map(|j| (0..=nx).map(move |i| super::Point { x: x0 + dx * i as f64, y: y0 + dy * j as f64 }))
        .map(|p| inside(p).then(|| ground.height_at(p)))
        .collect();
    let at = |i: usize, j: usize| h[j * (nx + 1) + i];
    // Signed grades between neighbouring samples, along rows (x) and columns (y).
    let gx = |i: usize, j: usize| match (at(i, j), at(i + 1, j)) { (Some(a), Some(b)) if dx > 1e-6 => Some((b - a) / dx), _ => None };
    let gy = |i: usize, j: usize| match (at(i, j), at(i, j + 1)) { (Some(a), Some(b)) if dy > 1e-6 => Some((b - a) / dy), _ => None };
    let broken = |a: Option<f64>, b: Option<f64>| matches!((a, b), (Some(a), Some(b)) if (a - b).abs() > BREAK_JUMP && a.abs().max(b.abs()) > BREAK_SLOPE);
    let mut steady = 0.0_f64;
    for j in 0..=ny {
        for i in 0..=nx {
            if at(i, j).is_none() {
                continue;
            }
            if i < nx {
                let g = gx(i, j);
                steady = steady.max(g.map_or(0.0, f64::abs));
                if i + 1 < nx && broken(g, gx(i + 1, j)) {
                    return false;
                }
            }
            if j < ny {
                let g = gy(i, j);
                steady = steady.max(g.map_or(0.0, f64::abs));
                if j + 1 < ny && broken(g, gy(i, j + 1)) {
                    return false;
                }
            }
        }
    }
    // The outline too, sampled every `step`: a cliff crossing only a corner of the body.
    for (k, a) in ring.iter().enumerate() {
        let b = ring[(k + 1) % ring.len()];
        let run = (b.x - a.x).hypot(b.y - a.y);
        let n = (run / step).ceil().max(1.0) as usize;
        let mut last = ground.height_at(*a);
        let mut grade: Option<f64> = None;
        for t in 1..=n {
            let p = super::Point { x: a.x + (b.x - a.x) * t as f64 / n as f64, y: a.y + (b.y - a.y) * t as f64 / n as f64 };
            let v = ground.height_at(p);
            let g = if run > 1e-6 { Some((v - last) * n as f64 / run) } else { None };
            steady = steady.max(g.map_or(0.0, f64::abs));
            if broken(grade, g) {
                return false;
            }
            (last, grade) = (v, g);
        }
    }
    let short = ring.iter().enumerate().map(|(i, a)| { let b = ring[(i + 1) % ring.len()]; (b.x - a.x).hypot(b.y - a.y) }).fold(f64::INFINITY, f64::min);
    // A round body (16-gon) has short edges: its short side is its whole extent.
    let short = if ring.len() > 4 { (x1 - x0).min(y1 - y0) } else { short };
    steady <= limit && steady * short <= ISOLATED_PLINTH_M
}

/// Dispersed-farm density of a culture (farmsteads.rs).
pub(crate) fn farm_density(culture: &str) -> f64 { super::farmsteads::density(culture) }

/// Farm templates: their yard is a farmstead (farmsteads.rs), never loose sheds.
pub(crate) fn is_farm(template: &str) -> bool { matches!(template, "small_farm" | "large_estate") }

/// A working farm on its own lot at `centre`: the farmhouse on the lot's front (towards
/// `-v`, v = `angle` + 90°), its culture's farm type of outbuildings round the yard
/// (farmsteads.rs, the city farms' generator) and the city massing of every body.
/// Bodies on water are dropped; no farm when the house is. Bodies on ground the culture
/// does not build on (a cliff, `ground_fits`) are dropped; a house there tries the next seed. Keyed by `id`.
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
        if !ground_fits(&house.outer, culture, ground) {
            continue;
        }
        let mut parts = vec![(house, "building")];
        if super::farmsteads::build(&mut parts, &lot, culture, true, true, wealth, &seed, true).is_none() {
            continue;
        }
        parts.retain(|(p, _)| !wet(&p.outer) && ground_fits(&p.outer, culture, ground));
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
        parts: &best, arch: culture_arch(culture), culture, zone: "rural", role: "dwelling.farm", function: "dwelling",
        landmark: false, wealth, pressure: 0.0, small_home: false, population: 0, fronts: &[front], low_rural: true, distance: 2.0, complex: false, user_core: false,
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

/// Metric scale of a culture's bodies (giants, small folk), for the land-use farms.
pub(crate) fn farm_scale(culture: &str) -> f64 { super::culture::house_parameters(culture).0 }

/// Massing of a countryside farm of the land-use stage (landuse/rural_farms.rs), by the
/// code of the settlement farmsteads (`farm_yard`): the culture's building tradition
/// (`culture_arch`), composed roofs on the house, the outbuildings as the low volumes of
/// the farm type `kind` (farmsteads.rs `look`). `bodies` are the farm's buildings (ring in
/// map metres, land-use `use`), `front` the lot's front edge; one piece per body, in order.
pub(crate) fn countryside_farm_massing(culture: &str, kind: &str, bodies: &[(Vec<super::Point>, &str)], front: [super::Point; 2], wealth: f64, seed: &str) -> Vec<serde_json::Value> {
    use super::Point;
    // Land-use uses onto the part labels of massing.rs: the dwellings are `building`
    // (the home of the culture: yurt, tipi, pile house…), the rest farm outbuildings.
    let mut home = false;
    let parts: Vec<(super::Shape, &'static str)> = bodies.iter().map(|(ring, use_)| {
        let round = ring.len() > 6;
        let label = match *use_ {
            "house" | "longhouse" | "roundhouse" | "ger" => "building",
            "hut" | "cultivation" if round && !home => "building",
            "barn" => "barn",
            "cultivation" => if round { "hut" } else { "barn" },
            "byre" => "byre",
            "stable" | "gatehouse" => "stable",
            "granary" | "spore-store" => "granary",
            "raised-granary" => "raised-granary",
            "shed" | "lean-to" => "shed",
            "cart-shed" | "covered-yard" => "cart-shed",
            "bakehouse" => "bakehouse",
            "well" => "well",
            "hayrick" => "hayrick",
            "pit-house" => "pit-house",
            "smithy" => "smithy",
            "storeroom" | "storehouse" => "storeroom",
            "farm-tower" | "tower" => "farm-tower",
            "dovecote" => "dovecote",
            "pigeon-tower" => "pigeon-tower",
            "cook-house" | "kitchen" => "cook-house",
            "sweat-bath" => "sweat-bath",
            "bath" => if round { "sweat-bath" } else { "storeroom" },
            "hut" => "hut",
            _ => "shed",
        };
        home |= label == "building";
        (super::geometry::normalized(super::Shape { outer: ring.clone(), holes: vec![] }), label)
    }).collect();
    if parts.is_empty() {
        return vec![];
    }
    // The house fronts its own long side nearest the lot's front (the main body of the
    // massing, its ridge along that side); a farm without a dwelling fronts the lot's.
    let house_front = parts.iter().find(|p| p.1 == "building").and_then(|(shape, _)| {
        let r = &shape.outer;
        let edge = |i: usize| (r[i], r[(i + 1) % r.len()]);
        let len = |i: usize| { let (a, b) = edge(i); (b.x - a.x).hypot(b.y - a.y) };
        let longest = (0..r.len()).map(len).fold(0.0_f64, f64::max);
        (0..r.len())
            .filter(|&i| len(i) >= 0.8 * longest)
            .map(|i| { let (a, b) = edge(i); (super::geometry::distance(Point { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 }, front[0], front[1]).0, i) })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, i)| { let (a, b) = edge(i); [a, b] })
    });
    let fronts = [house_front.unwrap_or(front)];
    let seed = super::farmsteads::pinned(seed, kind);
    match super::massing::massing(&super::massing::Input {
        parts: &parts, arch: culture_arch(culture), culture, zone: "rural", role: "dwelling.farm", function: "dwelling",
        landmark: false, wealth, pressure: 0.0, small_home: false, population: 0, fronts: &fronts, low_rural: true, distance: 2.0, complex: false, user_core: false,
        seed: &seed, archetype: "",
    }) {
        serde_json::Value::Array(pieces) => pieces,
        _ => vec![],
    }
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
        // 340 archetypes (310 + 7 spring water buildings + 15 countryside works and monuments
        // + 3 remote sanctuaries and their 5 accesses), unique ids, looks/ground resolve
        assert_eq!(d.archetypes.len(), 340);
        let ids: BTreeSet<&str> = d.archetypes.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids.len(), 340, "duplicate archetype id");
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
            if let Some(f) = &a.form {
                // A countryside role (`rural.…`) is built by parcels/monuments/rural.rs alone.
                assert!(a.kind == "building" && (f.role.starts_with("rural.") || services.contains(f.role.as_str())), "{}: form role {} not in services.json", a.id, f.role);
                assert!(f.site.iter().all(|&m| m >= 8.0), "{}: form site", a.id);
                assert!(f.absorbs.iter().all(|b| *b != a.id && ids.contains(b.as_str())), "{}: form absorbs", a.id);
            }
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
        assert_eq!(d.sites.len(), 85);
        // remote places: their situations and accesses resolve; an access with a line names its installation
        let mut remote = 0;
        for s in &d.sites {
            let Some(r) = &s.remote else { continue };
            remote += 1;
            assert!(!s.required.is_empty() && s.context.is_empty(), "{}: a remote place has buildings and no resource context", s.id);
            assert!(!r.situations.is_empty() && r.situations.iter().all(|k| d.remote.situations.contains_key(k)), "{}: remote situation", s.id);
            assert!(!r.access.is_empty() && r.access.iter().all(|(k, w)| d.remote.accesses.contains_key(k) && *w > 0.0), "{}: remote access", s.id);
            assert!((0.0..=1.0).contains(&r.ruined) && r.weight > 0.0, "{}: remote shares", s.id);
        }
        assert_eq!(remote, 8);
        for (k, a) in &d.remote.accesses {
            assert!(["none", "path", "fall", "span", "bore"].contains(&a.line.as_str()), "access {k}: line {}", a.line);
            assert!(a.installation.iter().all(|i| archetype(i).is_some_and(|x| x.kind == "installation")), "access {k}: installation");
            assert_eq!(a.installation.is_none(), matches!(a.line.as_str(), "none" | "path"), "access {k}: a line is drawn by an installation");
            assert!(a.line != "fall" || a.grade > d.remote.path_grade, "access {k}: stair grade");
        }
        assert!(d.remote.situations.values().all(|s| s.weight > 0.0) && d.remote.rate > 0.0 && d.remote.most > 0);
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

    /// A 1 km test ground: dry, `h` gives the height.
    struct Relief(fn(f64, f64) -> f64);
    impl crate::settlements::installations::Ground for Relief {
        fn width(&self) -> f64 { 1000.0 }
        fn n(&self) -> usize { 100 }
        fn water_at(&self, _: usize) -> u8 { 0 }
        fn river_width_at(&self, _: usize) -> f32 { 0.0 }
        fn height_at(&self, p: super::super::Point) -> f64 { (self.0)(p.x, p.y) }
    }

    /// A country chapel is one small church (the belfry is its tower, against the nave),
    /// a road waystation an inn round its yard, a windmill site a mill body under its
    /// sails with the miller's house; a template without forms keeps its boxes.
    #[test]
    fn isolated_singular_buildings_take_their_town_forms() {
        use super::super::Point;
        let flat = Relief(|_, _| 10.0);
        let culture = "european-organic";
        let centre = Point { x: 500.0, y: 500.0 };
        let gap = |a: &[Point], b: &[Point]| a.iter().flat_map(|p| b.iter().map(move |q| (p.x - q.x).hypot(p.y - q.y))).fold(f64::INFINITY, f64::min);
        let chapel = site_yard("country_chapel", culture, "chapel", centre, 0.3, &flat);
        let part = |look: &str| chapel.iter().find(|b| b.look == look).unwrap_or_else(|| panic!("no {look}: {:?}", chapel.iter().map(|b| b.look.as_str()).collect::<Vec<_>>()));
        let (nave, tower) = (part("nave"), part("tower"));
        assert_eq!((chapel[0].archetype.as_str(), tower.archetype.as_str()), ("chapel_nave", "chapel_belfry"));
        assert!(gap(&nave.ring, &tower.ring) < 1.0, "the tower stands apart from its nave");
        assert!(chapel.iter().all(|b| b.massing.as_array().is_some_and(|m| m.len() == 1 && m[0].is_object())));
        // A formed yard is left as it is.
        let again = formed("activity:chapel", culture, chapel.clone(), 0.3, &flat, &|_| true);
        assert_eq!(again.iter().map(|b| &b.ring).collect::<Vec<_>>(), chapel.iter().map(|b| &b.ring).collect::<Vec<_>>());
        let inn = site_yard("road_waystation", culture, "inn", centre, 1.1, &flat);
        for look in ["inn-front", "inn-range", "stable-range"] {
            assert!(inn.iter().any(|b| b.look == look), "waystation without {look}");
        }
        assert!(inn[0].archetype == "waystation" && inn.iter().any(|b| b.archetype == "roadside_inn"));
        let mill = site_yard("windmill_site", culture, "mill", centre, 0.3, &flat);
        let body = mill.iter().find(|b| SAIL_LABELS.contains(&b.look.as_str())).unwrap_or_else(|| panic!("no mill body: {:?}", mill.iter().map(|b| b.look.as_str()).collect::<Vec<_>>()));
        assert!(body.massing[0]["volumes"].as_array().is_some_and(|v| v.last().is_some_and(|top| top["features"][0]["kind"] == "sails")), "a windmill without sails");
        assert!(mill.iter().any(|b| b.look == "mill-dwelling"), "a windmill without its miller's house");
        let camp = site_yard("forest_logging", culture, "camp", centre, 0.3, &flat);
        assert!(!camp.is_empty() && camp.iter().all(|b| archetype(&b.archetype).is_some_and(|a| a.look.as_deref() == Some(b.look.as_str()))));
    }

    #[test]
    fn isolated_buildings_never_straddle_a_cliff() {
        use super::super::Point;
        let square = |x: f64, y: f64, r: f64| vec![Point { x: x - r, y: y - r }, Point { x: x + r, y: y - r }, Point { x: x + r, y: y + r }, Point { x: x - r, y: y + r }];
        // A 30 m vertical cliff along x = 500 (rising over 1 m), a 20 % hillside elsewhere.
        let cliff = Relief(|x, y| 0.2 * y + 30.0 * ((x - 500.0).clamp(0.0, 1.0)));
        let culture = "european-organic";
        assert!(ground_fits(&square(300.0, 300.0, 6.0), culture, &cliff), "a hillside house stands");
        assert!(!ground_fits(&square(500.0, 300.0, 6.0), culture, &cliff), "a house across the cliff is refused");
        // A steady 0.8 grade (39°) is a slope, not a cliff: a stepped plinth carries it.
        let steady = Relief(|x, y| 0.8 * x + 0.1 * y);
        assert!(ground_fits(&square(300.0, 300.0, 6.0), culture, &steady), "a steady slope is buildable");
        // A farm laid on the cliff line keeps only bodies on buildable ground.
        for x in [480.0, 495.0, 500.0, 505.0, 520.0] {
            for b in farm_yard(&format!("cliff-farm-{x}"), culture, Point { x, y: 300.0 }, 0.3, 0.5, &cliff) {
                assert!(ground_fits(&b.ring, culture, &cliff), "farm body on the cliff at x = {x}");
                let (lo, hi) = b.ring.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), p| (l.min(p.x), h.max(p.x)));
                assert!(hi <= 500.1 || lo >= 500.9, "farm body straddles the cliff at x = {x}");
            }
        }
    }
}
