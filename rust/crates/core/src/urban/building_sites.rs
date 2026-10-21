//! Neutral coarse placement intents. No dependency on the architectural engine:
//! JSON follows the documented houses placement boundary, without renderer data.
use super::geometry::interior_point;
use super::{Layout, Parcel, Partition, Point, Surface};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn access_segments(layout: &Layout, p: &Parcel) -> Vec<Value> {
    let mut out=p.contacts.iter().filter(|c|c.kind!="unserved"&&c.kind!="reserved"&&c.length>0.1)
        .map(|c|json!({"id":format!("{}/street/{}",p.id,c.street),"segment":[c.a,c.b],
            "kind":if c.kind=="collective"{"collective"}else if c.kind=="private"{"private"}else{"public"},"width_m":c.length})).collect::<Vec<_>>();
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    if !out.is_empty() {
        return out;
    }
    if let Some(front) = p.front
        && let Some(a) = &p.access
        && !matches!(a.kind.as_str(), "unserved" | "reserved")
    {
        out.push(json!({"id":format!("{}/front",p.id),"segment":front,"kind":a.kind,"width_m":a.front_length}));
        return out;
    }
    // A reservation keeps the same exact continuous contacts as the cadastre.
    out.extend(
        super::parcels::block_contacts(&p.shape, layout)
            .iter()
            .map(|c| {
                json!({
                    "id":format!("{}/reserved-street/{}",p.id,c.street),"segment":[c.a,c.b],
                    "kind":c.kind,"width_m":c.length
                })
            }),
    );
    out.sort_by(|a, b| {
        b["width_m"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["width_m"].as_f64().unwrap_or(0.0))
    });
    out
}
/// Row-major physical samples; origin is the centre of the first source cell.
fn ground_patch(surface: Surface<'_>, shape: &super::Shape) -> Value {
    let step = surface.width / surface.n as f64;
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in &shape.outer {
        x0 = x0.min(p.x);
        y0 = y0.min(p.y);
        x1 = x1.max(p.x);
        y1 = y1.max(p.y);
    }
    let lo =
        |v: f64| ((v / step - 0.5).floor() as isize - 1).clamp(0, surface.n as isize - 1) as usize;
    let hi =
        |v: f64| ((v / step - 0.5).ceil() as isize + 1).clamp(0, surface.n as isize - 1) as usize;
    let (a, b, c, d) = (lo(x0), lo(y0), hi(x1), hi(y1));
    let mut heights = vec![];
    for y in b..=d {
        for x in a..=c {
            heights.push(surface.height[y * surface.n + x]);
        }
    }
    json!({"origin":{"x":(a as f64+0.5)*step,"y":(b as f64+0.5)*step},"step_m":step,
        "width":c-a+1,"height":d-b+1,"elevations_m":heights})
}
/// Actual shared cadastral segments, only where the cultural recipe permits party walls.
fn shared_boundaries(a: &super::Shape, b: &super::Shape) -> Vec<[Point; 2]> {
    let mut out = vec![];
    for (&u, &v) in a
        .outer
        .iter()
        .zip(a.outer.iter().cycle().skip(1))
        .take(a.outer.len())
    {
        let length = (v.x - u.x).hypot(v.y - u.y);
        if length < 0.01 {
            continue;
        }
        let (dx, dy) = ((v.x - u.x) / length, (v.y - u.y) / length);
        for (&p, &q) in b
            .outer
            .iter()
            .zip(b.outer.iter().cycle().skip(1))
            .take(b.outer.len())
        {
            let side = |p: Point| ((p.x - u.x) * dy - (p.y - u.y) * dx).abs();
            if side(p) > 0.02 || side(q) > 0.02 {
                continue;
            }
            let t = |p: Point| (p.x - u.x) * dx + (p.y - u.y) * dy;
            let lo = t(p).min(t(q)).max(0.0);
            let hi = t(p).max(t(q)).min(length);
            if hi - lo > 0.1 {
                out.push([
                    Point {
                        x: u.x + lo * dx,
                        y: u.y + lo * dy,
                    },
                    Point {
                        x: u.x + hi * dx,
                        y: u.y + hi * dy,
                    },
                ]);
            }
        }
    }
    out
}
/// Discrete native levels from the applied cultural/function profile. The actual
/// recipe range remains authoritative; no height truncation occurs after placement.
fn typical_floors(
    culture: &super::culture::CultureMapping,
    function: &str,
    population: u32,
    pressure: f64,
) -> u32 {
    let desired = if function == "collective"
        || (matches!(function, "domestic" | "mixed")
            && culture.functional_profile != "communal"
            && population >= 1000
            && pressure > 0.6)
    {
        2
    } else {
        1
    };
    desired.clamp(
        culture.admissibility.floors[0],
        culture.admissibility.floors[1],
    )
}
pub fn requests(
    seed: &str,
    layouts: &[Layout],
    partitions: &[Partition],
    surface: Surface<'_>,
    water_level: &[f32],
    architecture_culture: Option<&str>,
) -> Result<Vec<Value>, String> {
    let mut requests = vec![];
    for partition in partitions {
        let layout = layouts
            .iter()
            .find(|l| l.key == partition.key)
            .ok_or("Missing layout for architecture sites")?;
        let Some(pr) = &partition.programme else {
            continue;
        };
        let parcels = partition
            .parcels
            .iter()
            .map(|p| (p.id.as_str(), p))
            .collect::<BTreeMap<_, _>>();
        let cultures = pr
            .cultures
            .iter()
            .map(|c| (c.culture.as_str(), c))
            .collect::<BTreeMap<_, _>>();
        let mut adjacent = BTreeMap::<&str, Vec<&str>>::new();
        for edge in &pr.adjacency {
            adjacent.entry(&edge.a).or_default().push(&edge.b);
            adjacent.entry(&edge.b).or_default().push(&edge.a);
        }
        let mut tissues = BTreeMap::new();
        for allocation in &pr.allocations {
            let parcel = *parcels
                .get(allocation.parcel_id.as_str())
                .ok_or("Allocated parcel ID missing")?;
            if parcel.id.is_empty() {
                return Err("Architecture sites require cadastral parcel IDs".into());
            }
            let _applied_culture = cultures
                .get(allocation.culture.as_str())
                .ok_or("Missing applied cultural mapping")?;
            let building_culture = architecture_culture
                .filter(|c| !c.is_empty() && *c != "site")
                .unwrap_or(&allocation.culture);
            let culture = super::culture::parcel_mapping(
                layout,
                parcel,
                building_culture,
                &allocation.function,
            )
            .ok_or("No contextual native recipe")?;
            let center = interior_point(&parcel.shape);
            let ground = surface.height_at(center);
            let delta = (surface.width / surface.n as f64).max(0.5);
            let gradient = [
                (surface.height_at(Point {
                    x: center.x + delta,
                    y: center.y,
                }) - surface.height_at(Point {
                    x: center.x - delta,
                    y: center.y,
                })) / (2.0 * delta),
                (surface.height_at(Point {
                    x: center.x,
                    y: center.y + delta,
                }) - surface.height_at(Point {
                    x: center.x,
                    y: center.y - delta,
                })) / (2.0 * delta),
            ];
            let index = (center.y / surface.width * surface.n as f64)
                .floor()
                .clamp(0.0, (surface.n - 1) as f64) as usize
                * surface.n
                + (center.x / surface.width * surface.n as f64)
                    .floor()
                    .clamp(0.0, (surface.n - 1) as f64) as usize;
            let water = if surface.wet(center) {
                water_level.get(index).map(|h| f64::from(*h))
            } else {
                None
            };
            let mode = match pr.context.mode.as_str() {
                "strict" => "historical_strict",
                "fantasy" => "fantasy_mix",
                _ => "historical_inspired",
            };
            let function = match allocation.function.as_str() {
                "market" | "common" => "open_space",
                f => f,
            };
            let grid = ground_patch(surface, &parcel.shape);
            let party_boundaries = if culture.admissibility.party_walls {
                adjacent
                    .get(parcel.id.as_str())
                    .into_iter()
                    .flatten()
                    .filter_map(|id| parcels.get(id).copied())
                    .flat_map(|other| shared_boundaries(&parcel.shape, &other.shape))
                    .collect::<Vec<_>>()
            } else {
                vec![]
            };
            let floors = typical_floors(
                &culture,
                &allocation.function,
                pr.population,
                parcel.pressure,
            );
            let tissue = tissues
                .entry((parcel.block, allocation.culture.clone()))
                .or_insert_with(|| {
                    super::culture::parcel_morph(
                        layout,
                        partition,
                        &allocation.culture,
                        parcel.block,
                    )
                });
            let floors = tissue.as_ref().map_or(floors, |(zone, morph)| {
                if *zone == "village"
                    || culture.functional_profile == "communal"
                    || !matches!(allocation.function.as_str(), "domestic" | "mixed")
                {
                    return floors;
                }
                let levels = &morph.value["arch"]["storeys"];
                let lo = levels[0].as_u64().unwrap_or(u64::from(floors)) as u32;
                let hi = levels[1].as_u64().unwrap_or(u64::from(floors)) as u32;
                (lo + ((hi.saturating_sub(lo)) as f64 * parcel.pressure).round() as u32).clamp(
                    culture.admissibility.floors[0],
                    culture.admissibility.floors[1],
                )
            });
            let hint = super::parcels::parcel_envelope(
                parcel,
                culture.admissibility.min_frontage,
                culture.admissibility.min_depth,
                culture.admissibility.min_access_width,
            );
            let occupation = tissue.as_ref().map(|(zone, morph)| {
                let average = |key| {
                    let r = morph.range(key, zone);
                    (r[0] + r[1]) * 0.5
                };
                json!({"coverage":average("coverage").clamp(0.05, 1.0),
                    "depth_m":average("buildDepth"),"frontage_m":average("frontage")})
            });
            let config = json!({"schema_version":"2","seed":format!("{seed}/{}",parcel.id),"pack":culture.architecture_pack,"recipe":culture.admissibility.recipe_id,
                "mode":mode,"era":if pr.context.period.is_empty(){"any"}else{&pr.context.period},"allow_late":false,
                "count":1,"size":1.0,"variation":0.65,"wealth":0.5,"orientation_deg":0.0,
                "overrides":{"footprint":null,"roof":null,"frame":null,"infill":null,"coating":null,"cladding":null,
                    "floors":floors,"bodies":null,"courtyard_ratio":null,"overhang_m":null,"roof_pitch_deg":null,"site_slope_deg":null}});
            requests.push(json!({"id":format!("{}/building",parcel.id),"parcel_id":parcel.id,
                "placement_hint":hint.as_ref().map(|shape|vec![shape]),
                "occupation":occupation,
                "cadastral":[parcel.shape],"buildable":[parcel.shape],"reserves":parcel.shape.holes.iter().map(|hole|json!({"outer":hole,"holes":[]})).collect::<Vec<_>>(),"roof_domain":[parcel.shape],
                "accesses":access_segments(layout,parcel),"party_boundaries":party_boundaries,"neighbors":[],
                "culture":{"culture":building_culture,"pack":culture.architecture_pack,"mode":mode,
                    "borrowing":if culture.borrowing.is_empty(){None}else{Some(&culture.borrowing)}},
                "function":function,"seed":format!("{seed}/{}",parcel.id),"config":config,
                "terrain":{"grid":grid,"origin":center,"ground_z_m":ground,"gradient":gradient,"water_z_m":water,"max_foundation_step_m":0.75}}));
        }
    }
    Ok(requests)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn village_levels_use_a_real_low_native_recipe() {
        let culture = super::super::culture::mapping("halfling").unwrap();
        assert!(culture.admissibility.floors[0] <= 2);
        assert_ne!(culture.admissibility.recipe_id, "EUR-MED-B08");
        assert_eq!(typical_floors(&culture, "domestic", 200, 1.0), 1);
        let town = super::super::culture::mapping("european-organic").unwrap();
        assert_eq!(typical_floors(&town, "mixed", 2500, 0.9), 2);
        assert_eq!(typical_floors(&town, "workshop", 2500, 0.9), 1);
    }
}
