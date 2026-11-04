//! Territorial activity sites (catalogue P3): mills, quarries, mines, fishing huts,
//! sheepfolds, logging camps… outside the settlements. Each stands on one resource
//! anchor (`resources::anchors`) and belongs to the nearest settlement, its parent;
//! nobody lives there. Runs after placement, before roads. Every draw is keyed by the
//! parent key and the anchor id, so a site does not depend on iteration order.
use super::grid::Fields;
use super::installations::{self, Ground, Installation};
use super::{Point, Settlement};
use crate::resources::{ActivityAnchor, ResourceFields};
use crate::rng::Rng;
use crate::urban::activities as act;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBuilding {
    pub archetype: String,
    pub look: String,
    /// Footprint ring, map frame (m).
    pub ring: Vec<Point>,
    /// `urban/massing.rs` pieces of the ring (one piece), as the city massing.
    pub massing: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySite {
    /// `activity:<parent>:<anchor>`, also the road-site key of its access point.
    pub id: String,
    /// `activities.json` site template.
    pub template: String,
    /// attached_external | remote_seasonal | network_node
    pub mode: String,
    /// Parent settlement key.
    pub parent: String,
    /// Anchor id (hex: JSON numbers lose u64 precision).
    pub anchor: String,
    pub kind: String,
    pub resource: String,
    pub culture: String,
    pub x: f64,
    pub y: f64,
    /// Ground height at the site (m).
    pub ground: f64,
    /// Point joining the road network.
    pub access: Point,
    /// track | trail
    pub access_class: String,
    pub residents: u32,
    pub season_mask: u16,
    pub buildings: Vec<ActivityBuilding>,
    /// Ground installations (catalogue P5).
    pub installations: Vec<Installation>,
}

/// Farthest edge-to-anchor distance of an attached site / a seasonal one (m).
const ATTACHED_M: f64 = 4000.0;
const REMOTE_M: f64 = 12000.0;
const CONTEXT_MIN: f32 = 0.2;

/// Potential the anchor offers (a mine offers its deposit kind).
fn offer(a: &ActivityAnchor) -> &'static str {
    match (a.kind, a.resource) {
        ("mine", "small_coal") => "coal",
        ("mine", "salt_spring") => "salt_deposit",
        ("mine", "gypsum_quarry") => "stone_ashlar",
        ("mine", _) => "ore",
        _ => a.resource,
    }
}

/// Sites a class keeps (min, max), per-template cap and per-claim cap (a town has its own mill inside).
fn budget(cls: &str) -> (u32, u32, usize, usize) {
    match cls {
        "farmstead" => (0, 1, 1, 1),
        "hamlet" => (0, 2, 1, 1),
        "village" => (1, 4, 2, 1),
        "town" => (3, 8, 2, 2),
        "city" => (8, 15, 3, 3),
        _ => (12, 20, 4, 4),
    }
}

/// Relative demand of a template among those one anchor admits (a watch post or a
/// hunting lodge is rarer than a mill on the same knoll or wood).
fn demand(template: &str) -> f64 {
    match template {
        "hill_watch" => 0.3,
        "hunting_post" | "shipyard" => 0.5,
        _ => 1.0,
    }
}

pub(super) fn culture_ok(only: &Option<Vec<String>>, culture: &str) -> bool {
    let fam = act::family_of(culture).map(|f| f.0);
    only.as_ref().is_none_or(|o| o.iter().any(|x| x == culture || Some(x.as_str()) == fam))
}

fn draw<'a>(pool: &[(&'a str, f64)], rng: &mut Rng) -> Option<usize> {
    let total: f64 = pool.iter().map(|p| p.1).sum();
    if pool.is_empty() || total <= 0.0 {
        return None;
    }
    let mut x = rng.float() * total;
    for (i, p) in pool.iter().enumerate() {
        if x < p.1 {
            return Some(i);
        }
        x -= p.1;
    }
    Some(pool.len() - 1)
}

struct Candidate<'a> {
    anchor: &'a ActivityAnchor,
    site: &'static act::Site,
    mode: &'static str,
    score: f64,
}

pub(super) fn place(settlements: &[Settlement], r: &ResourceFields, f: &Fields) -> Vec<ActivitySite> {
    if settlements.is_empty() {
        return vec![];
    }
    let data = act::data();
    let modes = ["attached_external", "remote_seasonal"];
    let templates: Vec<&act::Site> = data
        .sites
        .iter()
        .filter(|s| s.mode != "network_node" && !s.context.is_empty())
        .filter(|s| s.allowed_modes.iter().chain([&s.mode]).any(|m| modes.contains(&m.as_str())))
        .filter(|s| !s.context.iter().any(|c| matches!(c.as_str(), "settlement" | "road" | "crossing")))
        .collect();
    // Anchors inside a settlement belong to its own programme; others go to the nearest edge.
    let mut per: Vec<Vec<Candidate>> = (0..settlements.len()).map(|_| vec![]).collect();
    for a in &r.anchors {
        let p = Point { x: a.x, y: a.y };
        let edge = |s: &Settlement| p.distance(s.center) - s.radius;
        if settlements.iter().any(|s| edge(s) < 120.0) {
            continue;
        }
        let Some((parent, d)) = settlements
            .iter()
            .enumerate()
            .map(|(i, s)| (i, edge(s)))
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
        else {
            continue;
        };
        if d > REMOTE_M {
            continue;
        }
        let s = &settlements[parent];
        let culture = s.spec.culture.as_str();
        let have = offer(a);
        for t in &templates {
            let mut used = false;
            let ok = t.context.iter().all(|c| {
                c.split('|').any(|id| {
                    if id == have && !used {
                        used = true;
                        return true;
                    }
                    !matches!(id, "ore" | "coal" | "salt_deposit") && r.potentials.sample(id, a.x, a.y) >= CONTEXT_MIN
                })
            });
            if !ok || !used || !culture_ok(&t.only, culture) || !t.required.iter().all(|b| act::allowed(culture, b)) {
                continue;
            }
            let allows = |m: &str| t.mode == m || t.allowed_modes.iter().any(|x| x == m);
            let mode = if allows("attached_external") && d <= ATTACHED_M + 0.25 * s.radius {
                "attached_external"
            } else if allows("remote_seasonal") && d <= REMOTE_M {
                "remote_seasonal"
            } else {
                continue;
            };
            let weight = t.required.iter().map(|b| act::weight(culture, b)).sum::<f64>() / t.required.len().max(1) as f64;
            // The template whose primary mode fits is the natural reading of the anchor.
            let primary = if t.mode == mode { 1.0 } else { 0.6 };
            let score = (a.potential as f64).clamp(0.05, 1.0) * weight * primary * demand(&t.id) * (-d.max(0.0) / 6000.0).exp();
            per[parent].push(Candidate { anchor: a, site: t, mode, score });
        }
    }
    let mut out = vec![];
    for (i, s) in settlements.iter().enumerate() {
        let key = &s.spec.key;
        let (lo, hi, per_template, per_claim) = budget(&s.cls);
        let mut rng = Rng::new(&format!("activities:{key}"));
        let n = lo + ((rng.float() * (hi - lo + 1) as f64) as u32).min(hi - lo);
        // One template per anchor (keyed draw among its candidates), then the best anchors.
        let mut cands = std::mem::take(&mut per[i]);
        cands.sort_by(|a, b| a.anchor.id.cmp(&b.anchor.id).then(a.site.id.cmp(&b.site.id)));
        let mut chosen: Vec<(Candidate, f64)> = vec![];
        for group in cands.chunk_by(|a, b| a.anchor.id == b.anchor.id) {
            let mut g = Rng::new(&format!("activities:{key}:{:016x}", group[0].anchor.id));
            let pool: Vec<(&str, f64)> = group.iter().map(|c| (c.site.id.as_str(), c.score)).collect();
            let Some(k) = draw(&pool, &mut g) else { continue };
            let c = &group[k];
            let rank = c.score * (0.6 + 0.4 * g.float());
            chosen.push((Candidate { anchor: c.anchor, site: c.site, mode: c.mode, score: c.score }, rank));
        }
        chosen.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.anchor.id.cmp(&b.0.anchor.id)));
        let mut kept = 0;
        let mut templates_used: Vec<&str> = vec![];
        let mut claims_used: Vec<&str> = vec![];
        for (c, _) in chosen {
            if kept >= n {
                break;
            }
            if templates_used.iter().filter(|&&t| t == c.site.id).count() >= per_template
                || c.site.claims.iter().any(|cl| claims_used.iter().filter(|&&u| u == cl).count() >= per_claim)
            {
                continue;
            }
            let Some(site) = build(s, &c, f) else { continue };
            templates_used.push(&c.site.id);
            claims_used.extend(c.site.claims.iter().map(String::as_str));
            kept += 1;
            out.push(site);
        }
    }
    out
}

/// Buildings of a site laid around its anchor: required ones, then culture-weighted optional ones.
fn build(s: &Settlement, c: &Candidate, f: &Fields) -> Option<ActivitySite> {
    let culture = s.spec.culture.as_str();
    let id = format!("activity:{}:{:016x}", s.spec.key, c.anchor.id);
    let mut rng = Rng::new(&id);
    let extra = match s.cls.as_str() {
        "farmstead" | "hamlet" => 0,
        "village" => 1,
        _ => 2,
    }
    .min((rng.float() * 3.0) as usize);
    let names = pick(c.site, culture, extra, &mut rng);
    let angle = rng.float() * std::f64::consts::PI;
    let centre = Point { x: c.anchor.x, y: c.anchor.y };
    let buildings = yard(&id, culture, &names, centre, angle, &mut rng, f, &|_| true);
    if buildings.is_empty() {
        return None;
    }
    let access = Point { x: c.anchor.access.0, y: c.anchor.access.1 };
    let installations = installations::lay(&allowed_installations(c.site, culture), &id, centre, &buildings, f, None, &|_| false);
    Some(ActivitySite {
        template: c.site.id.clone(),
        mode: c.mode.into(),
        parent: s.spec.key.clone(),
        anchor: format!("{:016x}", c.anchor.id),
        kind: c.anchor.kind.into(),
        resource: c.anchor.resource.into(),
        culture: culture.into(),
        x: centre.x,
        y: centre.y,
        ground: f.height_at(centre),
        access,
        access_class: if c.site.access == "trail" { "trail" } else { "track" }.into(),
        residents: 0,
        season_mask: c.anchor.season_mask,
        installations,
        buildings,
        id,
    })
}

pub(crate) fn allowed_installations(site: &act::Site, culture: &str) -> Vec<String> {
    site.installations.iter().filter(|i| act::allowed(culture, i)).cloned().collect()
}

/// The archetype a required entry stands for in a culture: itself, or the first
/// alternative of `a|b|c` the culture may build (None when it may build none).
pub(crate) fn resolve<'a>(entry: &'a str, culture: &str) -> Option<&'a str> {
    if !entry.contains('|') {
        return Some(entry);
    }
    entry.split('|').find(|b| act::allowed(culture, b))
}

/// Required buildings of a template, then `extra` culture-weighted optional ones (5 at most).
pub(crate) fn pick<'a>(site: &'a act::Site, culture: &str, extra: usize, rng: &mut Rng) -> Vec<&'a str> {
    let mut names: Vec<&str> = site.required.iter().filter_map(|b| resolve(b, culture)).collect();
    let mut optional: Vec<(&str, f64)> = vec![];
    for b in site.optional.iter().filter(|b| act::allowed(culture, b)) {
        if !names.contains(&b.as_str()) && !optional.iter().any(|o| o.0 == b) {
            optional.push((b, act::weight(culture, b)));
        }
    }
    for _ in 0..extra {
        let Some(k) = draw(&optional, rng) else { break };
        names.push(optional.remove(k).0);
    }
    names.truncate(5);
    names
}

/// Buildings laid as a yard around `centre`: slots on the axis (`angle`) and across it,
/// the cross ones turned a quarter. A building off the map, on water or refused by `ok` is dropped.
#[allow(clippy::too_many_arguments)]
pub(crate) fn yard(id: &str, culture: &str, names: &[&str], centre: Point, angle: f64, rng: &mut Rng, f: &dyn Ground, ok: &dyn Fn(&[Point]) -> bool) -> Vec<ActivityBuilding> {
    // A culture with no archetype for this site has nothing to lay out.
    if names.is_empty() {
        return vec![];
    }
    let (u, v) = (Point { x: angle.cos(), y: angle.sin() }, Point { x: -angle.sin(), y: angle.cos() });
    let sizes: Vec<(f64, f64)> = names
        .iter()
        .map(|b| {
            let fp = act::archetype(b).and_then(|a| a.look.as_ref()).and_then(|l| act::data().looks.get(l)).map(|l| (l.footprint.w, l.footprint.d));
            let ([w0, w1], [d0, d1]) = fp.unwrap_or(([6.0, 9.0], [5.0, 7.0]));
            let t = rng.float();
            (w0 + (w1 - w0) * t, d0 + (d1 - d0) * t)
        })
        .collect();
    let (hw0, hd0) = (sizes[0].0 / 2.0, sizes[0].1 / 2.0);
    const SLOTS: [(f64, f64); 5] = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)];
    let mut buildings = vec![];
    for (k, b) in names.iter().enumerate() {
        let (w, d) = sizes[k];
        let (sx, sy) = SLOTS[k];
        let across = sy != 0.0;
        let (hw, hd) = if across { (d / 2.0, w / 2.0) } else { (w / 2.0, d / 2.0) };
        let gap = 5.0;
        let off = (sx * (hw0 + gap + hw), sy * (hd0 + gap + hd));
        let p = Point { x: centre.x + u.x * off.0 + v.x * off.1, y: centre.y + u.y * off.0 + v.y * off.1 };
        if p.x < 0.0 || p.y < 0.0 || p.x >= f.width() || p.y >= f.width() || f.water_at(f.index(p)) != 0 {
            continue;
        }
        // A round look (stupa, domed tomb) stands on a 16-gon inside its box.
        let round = act::archetype(b).and_then(|a| a.look.as_ref()).and_then(|l| act::data().looks.get(l)).is_some_and(|l| l.features.iter().any(|f| f == "round"));
        let ring: Vec<Point> = if round {
            let r = hw.min(hd);
            (0..16).map(|k| { let a = k as f64 * std::f64::consts::TAU / 16.0; Point { x: p.x + r * a.cos(), y: p.y + r * a.sin() } }).collect()
        } else {
            [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]
                .iter()
                .map(|(a, e)| Point { x: p.x + u.x * a * hw + v.x * e * hd, y: p.y + u.y * a * hw + v.y * e * hd })
                .collect()
        };
        if !ok(&ring) {
            continue;
        }
        let look = act::archetype(b).and_then(|a| a.look.clone()).unwrap_or_default();
        let massing = act::building_massing(b, culture, &ring, &format!("{id}/{k}"));
        buildings.push(ActivityBuilding { archetype: b.to_string(), look, ring, massing });
    }
    buildings
}
