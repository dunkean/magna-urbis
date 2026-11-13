//! Countryside sites: the dispersed farms on arable land round the settlements and the
//! rural places of worship. Farms (urban/activities.rs `farm_yard`, the city farmsteads'
//! generator) stand in their parent's farmland reach, a few isolated ones farther out;
//! hamlets and villages keep a chapel or a temple of their culture just outside, remote
//! ground a monastery; on the finished network, wayside shrines mark road junctions near
//! the places and chapels the crossroads of open country. Each is an [`ActivitySite`]
//! (nobody lives there); every draw is keyed by position or parent key.
use super::activities::{self as sites, ActivityBuilding, ActivitySite};
use super::grid::Fields;
use super::installations;
use super::roads::{RoadOutput, RoadSite};
use super::{Point, Settlement, extent_radius};
use crate::resources::ResourceFields;
use crate::rng::Rng;
use crate::urban::activities as act;
use std::f64::consts::TAU;

fn hash01(key: &str) -> f64 {
    Rng::new(key).float()
}

fn dry(f: &Fields, p: Point) -> bool {
    p.x >= 0.0 && p.y >= 0.0 && p.x < f.r.width && p.y < f.r.width && f.r.water[f.index(p)] == 0
}

/// Edge distance to the nearest settlement (index, m; negative inside).
fn nearest(settlements: &[Settlement], p: Point) -> Option<(usize, f64)> {
    settlements
        .iter()
        .enumerate()
        .map(|(i, s)| (i, p.distance(s.center) - s.radius))
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
}

/// Angle of the yard frame whose `v` axis (angle + 90°) points along `v`.
fn frame_angle(v: Point) -> f64 {
    (-v.x).atan2(v.y)
}

fn template(id: &str) -> Option<&'static act::Site> {
    act::data().sites.iter().find(|s| s.id == id)
}

/// The rural place of worship of a culture: a chapel for the European families, the
/// culture's temple (mosque, shrine, gompa, hof…) elsewhere.
fn worship_template(culture: &str) -> Option<&'static str> {
    ["country_chapel", "country_temple"].into_iter().find(|t| template(t).is_some_and(|s| sites::culture_ok(&s.only, culture)))
}

/// Wayside templates of a road junction and their share: a shrine, the culture's
/// own marker (cross, torii, ovoo, totem pole…), a calvary, a memorial, a holy well.
const WAYSIDE: [(&str, f64); 5] = [("roadside_shrine", 0.35), ("wayside_marker_site", 0.35), ("wayside_calvary", 0.1), ("wayside_memorial", 0.1), ("wayside_well", 0.1)];

fn is_wayside(template: &str) -> bool {
    WAYSIDE.iter().any(|w| w.0 == template)
}

/// The wayside monument of a junction, drawn by `h` (0..1) among those the culture builds.
fn wayside_template(culture: &str, h: f64) -> Option<&'static str> {
    let builds = |id: &str| {
        template(id).is_some_and(|t| sites::culture_ok(&t.only, culture) && t.required.iter().all(|r| sites::resolve(r, culture).is_some_and(|a| act::allowed(culture, a))))
    };
    let pool: Vec<(&'static str, f64)> = WAYSIDE.iter().copied().filter(|w| builds(w.0)).collect();
    let mut x = h * pool.iter().map(|w| w.1).sum::<f64>();
    for (id, share) in &pool {
        if x < *share {
            return Some(*id);
        }
        x -= share;
    }
    pool.last().map(|w| w.0)
}

/// Every required entry of a template stands in the yard.
fn complete(t: &act::Site, culture: &str, b: &[ActivityBuilding]) -> bool {
    t.required.iter().all(|r| sites::resolve(r, culture).is_some_and(|a| b.iter().any(|x| x.archetype == a)))
}

#[allow(clippy::too_many_arguments)]
fn site(t: &act::Site, mode: &str, parent: &Settlement, anchor: String, centre: Point, access: Point, buildings: Vec<ActivityBuilding>, f: &Fields) -> ActivitySite {
    let culture = parent.spec.culture.as_str();
    let id = format!("activity:{}:{anchor}", parent.spec.key);
    let installations = installations::lay(&sites::allowed_installations(t, culture), &id, centre, &buildings, f, None, &|_| false);
    ActivitySite {
        template: t.id.clone(),
        mode: mode.into(),
        parent: parent.spec.key.clone(),
        anchor,
        kind: if act::is_farm(&t.id) { "farm" } else { "worship" }.into(),
        resource: if act::is_farm(&t.id) { "arable" } else { "" }.into(),
        culture: culture.into(),
        x: centre.x,
        y: centre.y,
        ground: f.height_at(centre),
        access,
        access_class: if t.access == "trail" { "trail" } else { "track" }.into(),
        residents: 0,
        season_mask: 0x0fff,
        buildings,
        installations,
        id,
    }
}

/// Dispersed farms: about 0.45 per km² of land × `density` (V1's dispersed farms and hamlets), on
/// arable ground in the farmland reach of the nearest place (1 km + 3 radii, at most
/// 4.5 km), fading beyond it so a few stand isolated; 300 m apart (260 at most), clear of the places
/// and of the other sites. Each faces its parent, the track starting at its front.
pub(super) fn farms(settlements: &[Settlement], r: &ResourceFields, f: &Fields, taken: &[ActivitySite], density: f64) -> Vec<ActivitySite> {
    if settlements.is_empty() || density <= 0.0 {
        return vec![];
    }
    let (w, n) = (f.r.width, f.r.n);
    let land_km2 = f.r.water.iter().filter(|&&v| v == 0).count() as f64 * (w / n as f64).powi(2) / 1e6;
    let target = ((0.45 * land_km2 * density).round() as usize).min((260.0 * density.min(3.0)) as usize);
    let step = 260.0;
    let cells = (w / step).floor() as usize;
    let mut cands: Vec<(f64, Point, usize)> = vec![];
    for j in 0..cells {
        for i in 0..cells {
            let mut rng = Rng::new(&format!("farm:{i}:{j}"));
            let p = Point { x: (i as f64 + 0.15 + 0.7 * rng.float()) * step, y: (j as f64 + 0.15 + 0.7 * rng.float()) * step };
            if p.x < 0.02 * w || p.y < 0.02 * w || p.x > 0.98 * w || p.y > 0.98 * w || !dry(f, p) || f.slope[f.index(p)] > 0.22 {
                continue;
            }
            let arable = r.potentials.sample("arable", p.x, p.y) as f64;
            if arable < 0.2 {
                continue;
            }
            let Some((pi, d)) = nearest(settlements, p) else { continue };
            if d < 70.0 {
                continue;
            }
            let s = &settlements[pi];
            let reach = (1000.0 + 3.0 * s.radius).min(4500.0);
            let near = if d <= reach { 1.0 } else { (-(d - reach) / 1500.0).exp() };
            let score = arable * near * act::farm_density(&s.spec.culture) * (0.45 + 0.55 * rng.float());
            if score >= 0.04 {
                cands.push((score, p, pi));
            }
        }
    }
    cands.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.x.total_cmp(&b.1.x)).then(a.1.y.total_cmp(&b.1.y)));
    let mut kept: Vec<Point> = vec![];
    let mut out = vec![];
    for (_, p, pi) in cands {
        if out.len() >= target {
            break;
        }
        if kept.iter().any(|k| k.distance(p) < 300.0) || taken.iter().any(|t| t.access.distance(p) < 200.0 || Point { x: t.x, y: t.y }.distance(p) < 200.0) {
            continue;
        }
        let s = &settlements[pi];
        let culture = s.spec.culture.as_str();
        let anchor = format!("farm-{:.0}-{:.0}", p.x, p.y);
        let mut rng = Rng::new(&format!("farm:{}:{anchor}", s.spec.key));
        let away = if p.distance(s.center) > 1.0 { Point { x: (p.x - s.center.x) / p.distance(s.center), y: (p.y - s.center.y) / p.distance(s.center) } } else { Point { x: 0.0, y: 1.0 } };
        let angle = frame_angle(away) + rng.range(-0.4, 0.4);
        let base = match s.cls.as_str() {
            "farmstead" | "hamlet" => 0.35,
            "village" => 0.45,
            "town" => 0.55,
            _ => 0.65,
        };
        let wealth = (base + rng.range(-0.15, 0.3)).clamp(0.1, 0.95);
        let Some(t) = template(if wealth > 0.75 { "large_estate" } else { "small_farm" }) else { continue };
        let id = format!("activity:{}:{anchor}", s.spec.key);
        let buildings = act::farm_yard(&id, culture, p, angle, wealth, f);
        if buildings.len() < 2 {
            continue;
        }
        // The track starts before the farmhouse's front.
        let house = &buildings[0].ring;
        let hc = Point { x: house.iter().map(|q| q.x).sum::<f64>() / house.len() as f64, y: house.iter().map(|q| q.y).sum::<f64>() / house.len() as f64 };
        let v = Point { x: -angle.sin(), y: angle.cos() };
        let access = Point { x: hc.x - v.x * 14.0, y: hc.y - v.y * 14.0 };
        kept.push(p);
        out.push(site(t, "attached_external", s, anchor, p, if dry(f, access) { access } else { hc }, buildings, f));
    }
    out
}

/// Rural places of worship tied to the places: a chapel or temple just outside a hamlet
/// (55 %) or a village (30 %) — a town builds its own inside — and remote monasteries
/// (one per six places, 1–4, 1.8–9 km from any place, 7 km apart).
pub(super) fn worship(settlements: &[Settlement], f: &Fields, taken: &[ActivitySite]) -> Vec<ActivitySite> {
    let mut out: Vec<ActivitySite> = vec![];
    let clear = |p: Point, out: &[ActivitySite], gap: f64| {
        taken.iter().chain(out).all(|t| Point { x: t.x, y: t.y }.distance(p) >= gap) && settlements.iter().all(|s| p.distance(s.center) - s.radius >= 30.0)
    };
    for s in settlements {
        let chance = match s.cls.as_str() {
            "hamlet" => 0.55,
            "village" => 0.3,
            _ => 0.0,
        };
        let key = &s.spec.key;
        let culture = s.spec.culture.as_str();
        if hash01(&format!("worship:{key}")) >= chance {
            continue;
        }
        let Some(t) = worship_template(culture).and_then(template) else { continue };
        let a0 = hash01(&format!("worship:{key}:angle")) * TAU;
        for k in 0..8 {
            let a = a0 + k as f64 * TAU / 8.0;
            let dir = Point { x: a.cos(), y: a.sin() };
            let d = s.radius + 60.0 + 70.0 * hash01(&format!("worship:{key}:{k}"));
            let p = Point { x: s.center.x + dir.x * d, y: s.center.y + dir.y * d };
            if !dry(f, p) || f.slope[f.index(p)] > 0.25 || !clear(p, &out, 120.0) {
                continue;
            }
            // The portal faces the place.
            let b = act::site_yard(&t.id, culture, &format!("worship:{key}:{k}"), p, frame_angle(dir), f);
            if !complete(t, culture, &b) {
                continue;
            }
            let access = Point { x: p.x - dir.x * 22.0, y: p.y - dir.y * 22.0 };
            out.push(site(t, "attached_external", s, format!("worship-{k}"), p, if dry(f, access) { access } else { p }, b, f));
            break;
        }
    }
    // Monasteries: remote, quiet, a little raised.
    let Some(t) = template("rural_monastery") else { return out };
    if settlements.len() < 2 {
        return out;
    }
    let want = (settlements.len() as f64 / 6.0).round().clamp(1.0, 4.0) as usize;
    let (w, step) = (f.r.width, 700.0);
    let cells = (w / step).floor() as usize;
    let mut cands: Vec<(f64, Point, usize)> = vec![];
    for j in 0..cells {
        for i in 0..cells {
            let mut rng = Rng::new(&format!("monastery:{i}:{j}"));
            let p = Point { x: (i as f64 + 0.2 + 0.6 * rng.float()) * step, y: (j as f64 + 0.2 + 0.6 * rng.float()) * step };
            if p.x < 0.05 * w || p.y < 0.05 * w || p.x > 0.95 * w || p.y > 0.95 * w || !dry(f, p) || f.slope[f.index(p)] > 0.2 {
                continue;
            }
            let Some((pi, d)) = nearest(settlements, p) else { continue };
            if !(1800.0..=9000.0).contains(&d) {
                continue;
            }
            // Prefer ground above the nearest place, never far into the wilds.
            let raised = ((f.height_at(p) - f.height_at(settlements[pi].center)) / 150.0).clamp(0.0, 1.0);
            cands.push((0.6 * rng.float() + 0.4 * raised - d / 30000.0, p, pi));
        }
    }
    cands.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.x.total_cmp(&b.1.x)).then(a.1.y.total_cmp(&b.1.y)));
    let mut made: Vec<Point> = vec![];
    for (_, p, pi) in cands {
        if made.len() >= want {
            break;
        }
        if made.iter().any(|m| m.distance(p) < 7000.0) || !clear(p, &out, 400.0) {
            continue;
        }
        let s = &settlements[pi];
        let culture = s.spec.culture.as_str();
        if !sites::culture_ok(&t.only, culture) {
            continue;
        }
        let towards = Point { x: (s.center.x - p.x) / p.distance(s.center), y: (s.center.y - p.y) / p.distance(s.center) };
        let anchor = format!("monastery-{:.0}-{:.0}", p.x, p.y);
        let b = act::site_yard(&t.id, culture, &format!("{}:{anchor}", s.spec.key), p, frame_angle(Point { x: -towards.x, y: -towards.y }), f);
        if !complete(t, culture, &b) {
            continue;
        }
        let access = Point { x: p.x + towards.x * 45.0, y: p.y + towards.y * 45.0 };
        made.push(p);
        out.push(site(t, "autonomous_external", s, anchor, p, if dry(f, access) { access } else { p }, b, f));
    }
    out
}

fn seg_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    p.distance(Point { x: a.x + dx * t, y: a.y + dy * t })
}

/// Junctions of the finished network: a wayside shrine at a road junction within 5 km of
/// a place (half of them), a chapel or temple at a crossroads of open country (1.5 km+ out,
/// one in five); 1.2 km apart and from the other nodes, at most 16 shrines and 5 chapels.
pub(super) fn junctions(seed: &str, f: &Fields, road_sites: &[RoadSite], roads: &RoadOutput, nodes: &[ActivitySite]) -> Vec<ActivitySite> {
    let places: Vec<&RoadSite> = road_sites.iter().filter(|s| s.access.is_none()).collect();
    if places.is_empty() {
        return vec![];
    }
    let earthen = |c: &str| matches!(c, "track" | "trail");
    let mut out: Vec<ActivitySite> = vec![];
    for (j, jn) in roads.junctions.iter().enumerate() {
        if jn.degree < 3 || jn.site.as_deref().is_some_and(|s| s != "access") {
            continue;
        }
        let incident: Vec<_> = roads.segments.iter().filter(|s| (s.a == j || s.b == j) && s.path.len() >= 2).collect();
        if incident.iter().filter(|s| !earthen(&s.class)).count() < 2 {
            continue;
        }
        let at = jn.point;
        let Some((pi, edge)) = places
            .iter()
            .enumerate()
            .map(|(i, s)| (i, at.distance(s.center) - if s.radius > 0.0 { s.radius } else { extent_radius(s.population) }))
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
        else {
            continue;
        };
        if edge < 120.0 {
            continue;
        }
        let place = places[pi];
        let h = hash01(&format!("junction:{seed}:{:.0}:{:.0}", at.x, at.y));
        let chapel = edge >= 1500.0 && h < 0.2;
        let name = if chapel {
            worship_template(&place.culture)
        } else if edge < 5000.0 && h < 0.5 {
            wayside_template(&place.culture, hash01(&format!("junction-kind:{seed}:{:.0}:{:.0}", at.x, at.y)))
        } else {
            None
        };
        let Some(t) = name.and_then(template) else { continue };
        let count = out.iter().filter(|o| is_wayside(&o.template) != chapel).count();
        if count >= if chapel { 5 } else { 16 } || out.iter().chain(nodes).any(|o| o.access.distance(at) < 1200.0) {
            continue;
        }
        // In the widest angle between the roads leaving the junction.
        let mut dirs: Vec<f64> = incident
            .iter()
            .map(|s| {
                let (p, q) = if s.a == j { (s.path[0], s.path[1]) } else { (s.path[s.path.len() - 1], s.path[s.path.len() - 2]) };
                (q.y - p.y).atan2(q.x - p.x)
            })
            .collect();
        dirs.sort_by(f64::total_cmp);
        let (mut gap, mut bis) = (0.0, 0.0);
        for k in 0..dirs.len() {
            let next = if k + 1 < dirs.len() { dirs[k + 1] } else { dirs[0] + TAU };
            if next - dirs[k] > gap {
                gap = next - dirs[k];
                bis = dirs[k] + gap / 2.0;
            }
        }
        let ribbon: Vec<(Point, Point, f64)> = roads
            .segments
            .iter()
            .flat_map(|s| s.path.windows(2).filter(|w| seg_distance(at, w[0], w[1]) < 200.0).map(|w| (w[0], w[1], s.width / 2.0)).collect::<Vec<_>>())
            .collect();
        let ok = |ring: &[Point]| ring.iter().all(|&q| dry(f, q) && ribbon.iter().all(|(a, b, hw)| seg_distance(q, *a, *b) > hw + 2.5));
        let id = format!("node:{}:{:.0}:{:.0}", t.id, at.x, at.y);
        let mut rng = Rng::new(&id);
        let culture = place.culture.as_str();
        let names = sites::pick(t, culture, usize::from(chapel && rng.float() < 0.5), &mut rng);
        let dir = Point { x: bis.cos(), y: bis.sin() };
        let mut placed = None;
        for dist in if chapel { [26.0, 38.0, 52.0] } else { [9.0, 14.0, 20.0] } {
            let centre = Point { x: at.x + dir.x * dist, y: at.y + dir.y * dist };
            // The portal faces the junction.
            let b = sites::yard(&id, culture, &names, centre, frame_angle(dir), &mut rng, f, &ok);
            if complete(t, culture, &b) {
                placed = Some((centre, b));
                break;
            }
        }
        let Some((centre, buildings)) = placed else { continue };
        let installations = installations::lay(&sites::allowed_installations(t, culture), &id, centre, &buildings, f, Some(at), &|q| ribbon.iter().any(|(a, b, hw)| seg_distance(q, *a, *b) <= hw + 2.0));
        out.push(ActivitySite {
            template: t.id.clone(),
            mode: "network_node".into(),
            parent: place.key.clone(),
            anchor: String::new(),
            kind: "network_node".into(),
            resource: incident.iter().find(|s| !earthen(&s.class)).map_or_else(String::new, |s| s.class.clone()),
            culture: culture.into(),
            x: centre.x,
            y: centre.y,
            ground: f.height_at(centre),
            access: at,
            access_class: "track".into(),
            residents: 0,
            season_mask: 0x0fff,
            buildings,
            installations,
            id,
        });
    }
    out
}
