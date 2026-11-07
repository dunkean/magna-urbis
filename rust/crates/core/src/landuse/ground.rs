use super::hash::{HashMap, HashSet};
use super::{
    boolean::{self as bo, Op},
    geom::*,
    raster::*,
    *,
};
// JSON preserves a malformed JS coordinate as null. Do not let a failed typed
// conversion turn that polygon into an empty, apparently safe permission.
fn invalid_coordinates(v: &Value) -> bool {
    match v {
        Value::Object(m) => {
            if m.contains_key("x")
                && m.contains_key("y")
                && (!m["x"].as_f64().is_some_and(f64::is_finite)
                    || !m["y"].as_f64().is_some_and(f64::is_finite))
            {
                return true;
            }
            m.iter().any(|(k, v)| {
                if k == "width" || k == "widths" {
                    if let Some(a) = v.as_array() {
                        if a.iter().any(|v| !v.as_f64().is_some_and(f64::is_finite)) {
                            return true;
                        }
                    } else if !v.as_f64().is_some_and(f64::is_finite) {
                        return true;
                    }
                }
                invalid_coordinates(v)
            })
        }
        Value::Array(a) => a.iter().any(invalid_coordinates),
        _ => false,
    }
}
pub(crate) fn layers(input: &Input) -> Vec<&Value> {
    let g = &input.geometry;
    let mut out = vec![];
    if g["urban"].is_object() {
        out.push(&g["urban"]);
    }
    for st in arr(&g["settlements"]) {
        if !yes(&st["main"]) && st["urban"].is_object() {
            out.push(&st["urban"]);
        }
    }
    if let Some(detail) = g["megaDetail"].as_object() {
        let mut keys: Vec<_> = detail.keys().collect();
        keys.sort_by_key(|k| k.parse::<u64>().unwrap_or(u64::MAX));
        for k in keys {
            out.push(&detail[k]);
        }
    }
    out
}
fn polygons(v: &Value) -> Vec<Polygon> {
    arr(v).iter().map(poly).collect()
}
fn property_polys(v: &Value, key: &str) -> Vec<Region> {
    arr(v).iter().map(|v| piece(poly(&v[key]))).collect()
}
struct Appearance {
    gardens: Vec<Region>,
    natural: Vec<Region>,
    natural_parcels: HashSet<usize>,
    earth: bool,
}
fn appearance(input: &Input, u: &Value, enabled: bool) -> Appearance {
    if u["groundMaterial"].is_object() {
        let m = &u["groundMaterial"];
        return Appearance {
            gardens: regions(&m["gardens"]),
            natural: regions(&m["natural"]),
            natural_parcels: arr(&m["naturalParcels"])
                .iter()
                .map(|v| num(v) as usize)
                .collect(),
            earth: yes(&m["earthStreets"]),
        };
    }
    let mut out = Appearance {
        gardens: vec![],
        natural: vec![],
        natural_parcels: HashSet::default(),
        earth: false,
    };
    if !enabled || yes(&u["renderHints"]["graves"]) || yes(&u["renderHints"]["stilts"]) {
        out.gardens = regions(&u["backLand"]);
        return out;
    }
    let dry = input.biome == "desert";
    let open = yes(&u["renderHints"]["openGround"]);
    let culture = u["culture"]
        .as_str()
        .or_else(|| {
            arr(&u["blockInfo"])
                .iter()
                .find_map(|b| b["culture"].as_str())
        })
        .unwrap_or("");
    out.earth = dry
        && (culture == "sahel"
            || s(&u["morphology"]).starts_with("sahel")
            || s(&u["archetype"]) != "town"
            || open);
    let blocks = polygons(&u["blocks"]);
    let parcels = arr(&u["parcels"]);
    let mut block_buckets: HashMap<(i32, i32), Vec<usize>> = HashMap::default();
    for (i, block) in blocks.iter().enumerate() {
        let b = bbox(block);
        if ![b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.is_finite()) {
            continue;
        }
        for y in (b.y0 / 128.0).floor() as i32..=(b.y1 / 128.0).floor() as i32 {
            for x in (b.x0 / 128.0).floor() as i32..=(b.x1 / 128.0).floor() as i32 {
                block_buckets.entry((x, y)).or_default().push(i);
            }
        }
    }
    let is_natural = |a: &Polygon, parcel: Option<&Value>| {
        let p = centroid(a);
        let owner = if let Some(parcel) = parcel {
            parcel["block"]
                .as_u64()
                .and_then(|i| arr(&u["blockInfo"]).get(i as usize))
        } else {
            block_buckets
                .get(&((p.x / 128.0).floor() as i32, (p.y / 128.0).floor() as i32))
                .and_then(|ids| ids.iter().copied().find(|&i| contains(&blocks[i], p)))
                .and_then(|i| arr(&u["blockInfo"]).get(i))
        };
        if arr(&u["sites"]).iter().any(|v| {
            !["suburb", "shanty"].contains(&s(&v["role"])) && contains(&poly(&v["lot"]), p)
        }) || arr(&u["landmarks"]).iter().any(|v| {
            [
                "garth",
                "orchard",
                "garden-bed",
                "cornfield",
                "terrace-field",
                "chinampa",
                "cemetery",
            ]
            .contains(&s(&v["kind"]))
                && contains(&poly(&v["poly"]), p)
        }) {
            return false;
        }
        if owner.is_some_and(|v| !["block", "shanty"].contains(&s(&v["kind"]))) {
            return false;
        }
        if owner.is_none() && parcel.is_some() && !open {
            return false;
        }
        if dry {
            let x = (p.x / input.cell).floor() as isize;
            let y = (p.y / input.cell).floor() as isize;
            let i = (y.max(0) as usize) * input.w + x.max(0) as usize;
            !(x >= 0
                && y >= 0
                && x < input.w as isize
                && y < input.h as isize
                && input.d_water.get(i).is_some_and(|&d| d <= 180.0)
                && input.hab.get(i).is_some_and(|&h| h <= 28.0))
        } else {
            open || owner.is_some_and(|v| ["edge", "faubourg", "village"].contains(&s(&v["zone"])))
        }
    };
    for (i, r) in regions(&u["backLand"]).into_iter().enumerate() {
        let parcel = u["backLandOwners"][i]
            .as_i64()
            .filter(|&i| i >= 0)
            .and_then(|i| parcels.get(i as usize));
        if is_natural(&r.outer, parcel) {
            out.natural.push(r);
        } else {
            out.gardens.push(r);
        }
    }
    for (i, v) in parcels.iter().enumerate() {
        if s(&v["use"]) == "garden" && is_natural(&poly(&v["poly"]), Some(v))
            || open && ["meadow", "green", "commons"].contains(&s(&v["use"]))
        {
            out.natural_parcels.insert(i);
        }
    }
    out
}
fn protected(input: &Input, u: &Value, enabled: bool, material: &Appearance) -> Vec<Region> {
    let mut out = vec![];
    if enabled && yes(&u["renderHints"]["openGround"]) {
        let boxes: Vec<_> = arr(&u["landmarks"])
            .iter()
            .filter(|v| s(&v["kind"]) == "camp-ground")
            .map(|v| bbox(&poly(&v["poly"])))
            .collect();
        for a in arr(&input.geometry["landuse"]["areas"]) {
            let p = poly(&a["poly"]);
            if ["field", "garden", "orchard"].contains(&s(&a["kind"]))
                && boxes.iter().any(|b| b.meets(bbox(&p)))
            {
                out.push(Region {
                    outer: orient(p),
                    holes: polygons(&a["holes"]),
                });
            }
        }
        for f in arr(&input.geometry["landuse"]["farmsteads"]) {
            let p = poly(if f["lot"].is_array() {
                &f["lot"]
            } else {
                &f["yard"]
            });
            if boxes.iter().any(|b| b.meets(bbox(&p))) {
                out.push(piece(p));
            }
        }
    }
    for (i, v) in arr(&u["parcels"]).iter().enumerate() {
        if !["plot", "hut-lot"].contains(&s(&v["use"])) && !material.natural_parcels.contains(&i) {
            out.push(piece(poly(&v["poly"])));
        }
    }
    out.extend(material.gardens.clone());
    out.extend(polygons(&u["squares"]).into_iter().map(piece));
    out.extend(regions(&u["water"]));
    out.extend(regions(&u["ruralReserve"]));
    out.extend(
        arr(&u["landmarks"])
            .iter()
            .filter(|v| s(&v["kind"]) != "camp-ground")
            .map(|v| piece(poly(&v["poly"]))),
    );
    if !material.earth {
        for st in arr(&u["streets"]) {
            let path = poly(&st["path"]);
            if (u["macro"].is_object() || yes(&st["private"])) && path.len() >= 2 {
                let widths = if st["widths"].is_array() {
                    arr(&st["widths"]).iter().map(num).collect()
                } else {
                    vec![num(&st["width"]); path.len()]
                };
                out.push(piece(ribbon_widths(&path, &widths)));
            }
        }
    }
    out
}
fn layer(
    input: &Input,
    u: &Value,
    replaced: &HashSet<usize>,
    enabled: bool,
    footprint: Option<Polygon>,
    owner: Option<&Value>,
) -> Vec<Region> {
    if invalid_coordinates(u)
        || owner.is_some_and(invalid_coordinates)
        || yes(&u["renderHints"]["stilts"])
    {
        return vec![];
    }
    let material = appearance(input, u, enabled);
    let mut source = if u["macro"].is_object() {
        arr(&u["macro"]["quarters"])
            .iter()
            .filter(|v| {
                s(&v["kind"]) == "quarter"
                    && s(&v["district"]) != "gardens"
                    && !replaced.contains(&(num(&v["id"]) as usize))
            })
            .map(|v| piece(poly(&v["pts"])))
            .collect::<Vec<_>>()
    } else if yes(&u["renderHints"]["openGround"]) || material.earth {
        let foot = regions(&u["footprintH"]);
        if foot.is_empty() {
            footprint.map(piece).into_iter().collect()
        } else {
            foot
        }
    } else {
        arr(&u["blocks"])
            .iter()
            .enumerate()
            .filter(|(i, _)| ["block", "shanty"].contains(&s(&u["blockInfo"][*i]["kind"])))
            .map(|(_, v)| piece(poly(v)))
            .collect()
    };
    if enabled && yes(&u["renderHints"]["openGround"]) {
        source.extend(
            arr(&u["landmarks"])
                .iter()
                .filter(|v| s(&v["kind"]) == "camp-ground")
                .map(|v| piece(poly(&v["poly"]))),
        );
    }
    if source.is_empty() && !u["macro"].is_object() {
        source = arr(&u["parcels"])
            .iter()
            .filter(|v| ["plot", "hut-lot"].contains(&s(&v["use"])))
            .map(|v| piece(poly(&v["poly"])))
            .collect();
    }
    if enabled {
        source.extend(material.natural.clone());
    }
    source.extend(regions(&u["openEdgeGround"]));
    let mut protect = protected(input, u, enabled, &material);
    if let Some(owner) = owner {
        protect.extend(protected(
            input,
            owner,
            enabled,
            &appearance(input, owner, enabled),
        ));
    }
    if source.is_empty() || !valid(&source) || !valid(&protect) {
        return vec![];
    }
    bo::safe(
        &bo::union_many(&source),
        &bo::union_many(&protect),
        Op::Difference,
    )
}
pub fn water_ground(input: &Input) -> Result<Vec<Region>, String> {
    if invalid_coordinates(&input.geometry["terrain"]) {
        return Err("Invalid water geometry".into());
    }
    let t = &input.geometry["terrain"];
    let coast: Vec<_> = polygons(&t["coastline"])
        .into_iter()
        .filter(|a| a.len() >= 3)
        .collect();
    let holes: HashSet<usize> = coast
        .iter()
        .enumerate()
        .filter(|(i, a)| {
            coast
                .iter()
                .enumerate()
                .filter(|(j, b)| i != j && area(b).abs() > area(a).abs() && contains(b, a[0]))
                .count()
                % 2
                == 1
        })
        .map(|(i, _)| i)
        .collect();
    let islands = polygons(&t["islands"]);
    let lakes = polygons(&t["lakes"]);
    let sea: Vec<_> = coast
        .iter()
        .enumerate()
        .filter(|(i, _)| !holes.contains(i))
        .map(|(_, a)| piece(a.clone()))
        .collect();
    let dry: Vec<_> = islands
        .iter()
        .cloned()
        .chain(
            coast
                .iter()
                .enumerate()
                .filter(|(i, _)| holes.contains(i))
                .map(|(_, a)| a.clone()),
        )
        .map(piece)
        .collect();
    let mut out = bo::safe(&sea, &dry, Op::Difference);
    let guard = 1.5 * input.map_size / 1600.0;
    for ring in coast.iter().chain(&islands).chain(&lakes) {
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let len = dx.hypot(dy);
            if len == 0.0 {
                continue;
            }
            let (nx, ny) = (-dy * guard / len, dx * guard / len);
            out.push(piece(vec![
                p(a.x + nx, a.y + ny),
                p(b.x + nx, b.y + ny),
                p(b.x - nx, b.y - ny),
                p(a.x - nx, a.y - ny),
            ]));
            let rad = guard / (std::f64::consts::PI / 24.0).cos();
            out.push(piece(
                (0..24)
                    .map(|j| {
                        let a_ = (j as f64 + 0.5) * std::f64::consts::PI / 12.0;
                        p(a.x + rad * a_.cos(), a.y + rad * a_.sin())
                    })
                    .collect(),
            ));
        }
    }
    out.extend(lakes.into_iter().map(piece));
    for rv in arr(&t["rivers"]) {
        let path = poly(&rv["path"]);
        if path.len() < 2 {
            continue;
        }
        let widths: Vec<_> = arr(&rv["width"])
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let taper = if yes(&rv["main"]) || yes(&rv["edgeFed"]) {
                    1.0
                } else {
                    (0.35 + 0.65 * i as f64 / 7.0).min(1.0)
                };
                (1.1 * input.map_size / 1600.0).max(num(w) * taper) + 3.4 * input.map_size / 1600.0
            })
            .collect();
        if widths.len() != path.len() || widths.iter().any(|w| !w.is_finite()) {
            return Err("River width/path length mismatch".into());
        }
        out.push(piece(ribbon_widths(&path, &widths)));
    }
    Ok(out)
}
pub fn urban_landscape_ground(input: &Input, enabled: bool) -> Vec<Region> {
    if invalid_coordinates(&input.geometry["terrain"]) {
        return vec![];
    }
    let g = &input.geometry;
    let all = layers(input);
    let mut host = vec![];
    if g["urban"].is_object() {
        host.push((&g["urban"], 0_usize));
    }
    for st in arr(&g["settlements"]) {
        if !yes(&st["main"]) && st["urban"].is_object() {
            host.push((&st["urban"], num(&st["index"]) as usize));
        }
    }
    let mut detail_owners: HashMap<usize, (Polygon, &Value)> = HashMap::default();
    let mut replaced = HashMap::default();
    for (u, si) in host {
        let mut ids = HashSet::default();
        for q in arr(&u["macro"]["quarters"]) {
            let key = (si * 1_000_000 + num(&q["id"]) as usize).to_string();
            if let Some(d) = g["megaDetail"].get(&key) {
                ids.insert(num(&q["id"]) as usize);
                if enabled {
                    detail_owners.insert(d as *const Value as usize, (poly(&q["pts"]), u));
                }
            }
        }
        replaced.insert(u as *const Value as usize, ids);
    }
    let empty = HashSet::default();
    let mut source = vec![];
    for u in all {
        let key = u as *const Value as usize;
        let owner = detail_owners.get(&key);
        source.extend(layer(
            input,
            u,
            replaced.get(&key).unwrap_or(&empty),
            enabled,
            owner.map(|v| v.0.clone()),
            owner.map(|v| v.1),
        ));
    }
    let Ok(water) = water_ground(input) else {
        return vec![];
    };
    if !valid(&source) || !valid(&water) {
        return vec![];
    }
    let land = bo::union_many(&source);
    let boxes: Vec<_> = land.iter().map(|r| bbox(&r.outer).grow(100.0)).collect();
    let water = bo::union_pruned(&water, |r| boxes.iter().any(|b| b.meets(bbox(&r.outer))));
    bo::safe(&land, &water, Op::Difference)
}
pub fn landscape_cover_ground(input: &Input, ground: &[Region]) -> Vec<Region> {
    let mut roofs = vec![];
    for u in layers(input) {
        let masses = regions(&u["masses"]);
        if masses.is_empty() {
            roofs.extend(property_polys(&u["buildings"], "poly"));
        } else {
            roofs.extend(masses);
        }
    }
    if !valid(&roofs) {
        return vec![];
    }
    bo::safe(ground, &bo::union_many(&roofs), Op::Difference)
}
fn eligible(u: &Value) -> bool {
    !yes(&u["renderHints"]["openGround"])
        && !yes(&u["renderHints"]["stilts"])
        && !arr(&u["phases"]).iter().any(|p| yes(&p["walled"]))
        && !arr(&u["walls"])
            .iter()
            .any(|w| s(&w["role"]).is_empty() || ["town", "outer"].contains(&s(&w["role"])))
        && !arr(&u["lines"]).iter().any(|l| {
            yes(&l["closed"])
                && ["hedge", "palisade", "turf-wall", "kraal-fence", "albarrada"]
                    .contains(&s(&l["kind"]))
        })
}
struct Grid {
    x: f64,
    y: f64,
    w: usize,
    h: usize,
    cells: Vec<u8>,
}
const EDGE: f64 = std::f64::consts::SQRT_2 * 4.0 + 0.01;
impl Grid {
    fn local(&self, a: &[Point]) -> Polygon {
        a.iter().map(|p| local_point(p, self.x, self.y)).collect()
    }
    fn mark(
        &mut self,
        a: &[Point],
        value: u8,
        boundary: bool,
        holes: &[Polygon],
    ) -> Result<(), ()> {
        if a.len() < 3 {
            return Ok(());
        }
        if a.iter()
            .chain(holes.iter().flatten())
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return Err(());
        }
        let points = self.local(a);
        let mut rings = vec![points.clone()];
        rings.extend(holes.iter().map(|h| self.local(h)));
        if value == 1 {
            rasterize(&[points], self.w, self.h, 8.0, &mut self.cells);
        } else {
            let b = bbox(&points);
            let x0 = (b.x0 / 8.0).floor().max(0.0) as usize;
            let y0 = (b.y0 / 8.0).floor().max(0.0) as usize;
            let x1 = (b.x1 / 8.0).ceil().min(self.w as f64).max(0.0) as usize;
            let y1 = (b.y1 / 8.0).ceil().min(self.h as f64).max(0.0) as usize;
            if x1 > x0 && y1 > y0 {
                let (w, h) = (x1 - x0, y1 - y0);
                let r: Vec<Polygon> = rings
                    .iter()
                    .map(|a| {
                        a.iter()
                            .map(|p| super::geom::p(p.x - x0 as f64 * 8.0, p.y - y0 as f64 * 8.0))
                            .collect()
                    })
                    .collect();
                let mut mask = vec![0; w * h];
                rasterize(&r, w, h, 8.0, &mut mask);
                for y in 0..h {
                    for x in 0..w {
                        if mask[y * w + x] != 0 {
                            self.cells[(y + y0) * self.w + x + x0] = 0;
                        }
                    }
                }
            }
        }
        if boundary {
            for a in rings {
                near_line(&closed(&a), self.w, self.h, 8.0, EDGE, |i| {
                    self.cells[i] = 0
                });
            }
        }
        Ok(())
    }
    fn clear_way(&mut self, path: &[Point], width: f64) -> Result<(), ()> {
        if path.len() < 2 {
            return Ok(());
        }
        if !width.is_finite() || path.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return Err(());
        }
        let radius = (width / 2.0).max(0.0) + 2.0 + EDGE;
        let bounds = Box2 {
            x0: self.x,
            y0: self.y,
            x1: self.x + self.w as f64 * 8.0,
            y1: self.y + self.h as f64 * 8.0,
        };
        if !bounds.meets(bbox(path).grow(radius)) {
            return Ok(());
        }
        let a = self.local(path);
        near_line(
            &a,
            self.w,
            self.h,
            8.0,
            (width / 2.0).max(0.0) + 2.0 + EDGE,
            |i| self.cells[i] = 0,
        );
        Ok(())
    }
    fn clear_box(&mut self, a: &[Point], margin: f64) -> Result<(), ()> {
        if a.is_empty() {
            return Ok(());
        }
        if a.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
            return Err(());
        }
        let b = bbox(&self.local(a)).grow(margin);
        let x0 = (b.x0 / 8.0).floor().max(0.0) as isize;
        let y0 = (b.y0 / 8.0).floor().max(0.0) as isize;
        let x1 = (b.x1 / 8.0).floor().min(self.w as f64 - 1.0) as isize;
        let y1 = (b.y1 / 8.0).floor().min(self.h as f64 - 1.0) as isize;
        for y in y0..=y1 {
            for x in x0..=x1 {
                self.cells[y as usize * self.w + x as usize] = 0;
            }
        }
        Ok(())
    }
    fn prune(&mut self, min_area: f64) {
        let mut seen = vec![false; self.cells.len()];
        for seed in 0..self.cells.len() {
            if self.cells[seed] == 0 || seen[seed] {
                continue;
            }
            let mut comp = vec![seed];
            seen[seed] = true;
            let mut cursor = 0;
            while cursor < comp.len() {
                let i = comp[cursor];
                cursor += 1;
                let x = i % self.w;
                let ns = [
                    if x > 0 { i as isize - 1 } else { -1 },
                    if x + 1 < self.w { i as isize + 1 } else { -1 },
                    i as isize - self.w as isize,
                    i as isize + self.w as isize,
                ];
                for j in ns {
                    if j < 0 || j >= self.cells.len() as isize {
                        continue;
                    }
                    let j = j as usize;
                    if self.cells[j] != 0 && !seen[j] {
                        seen[j] = true;
                        comp.push(j);
                    }
                }
            }
            if (comp.len() as f64) < (min_area / 64.0).ceil() {
                for i in comp {
                    self.cells[i] = 0;
                }
            }
        }
    }
    fn rectangles(&self) -> Vec<Region> {
        let mut finished = vec![];
        let mut active: Vec<(usize, usize, usize, usize)> = vec![];
        for y in 0..self.h {
            let mut next = vec![];
            let mut x = 0;
            while x < self.w {
                if self.cells[y * self.w + x] == 0 {
                    x += 1;
                    continue;
                }
                let x0 = x;
                while x < self.w && self.cells[y * self.w + x] != 0 {
                    x += 1;
                }
                let run = if let Some(i) = active.iter().position(|a| a.0 == x0 && a.1 == x) {
                    let mut a = active.remove(i);
                    a.3 = y + 1;
                    a
                } else {
                    (x0, x, y, y + 1)
                };
                next.push(run);
            }
            finished.extend(active);
            active = next;
        }
        finished.extend(active);
        finished
            .into_iter()
            .map(|(x0, x1, y0, y1)| {
                piece(vec![
                    p(self.x + x0 as f64 * 8.0, self.y + y0 as f64 * 8.0),
                    p(self.x + x1 as f64 * 8.0, self.y + y0 as f64 * 8.0),
                    p(self.x + x1 as f64 * 8.0, self.y + y1 as f64 * 8.0),
                    p(self.x + x0 as f64 * 8.0, self.y + y1 as f64 * 8.0),
                ])
            })
            .collect()
    }
}
fn local_point(p: &Point, x: f64, y: f64) -> Point {
    super::geom::p(p.x - x, p.y - y)
}
struct NaturalWater {
    coast: Vec<(Polygon, Vec<Polygon>)>,
    lakes: Vec<Polygon>,
    rivers: Vec<(Polygon, Vec<f64>)>,
    roads: Vec<super::rural::Road>,
}
impl NaturalWater {
    fn new(input: &Input) -> Self {
        let t = &input.geometry["terrain"];
        let islands = polygons(&t["islands"]);
        Self {
            coast: polygons(&t["coastline"])
                .into_iter()
                .map(|sea| {
                    let holes = islands
                        .iter()
                        .filter(|a| a.len() >= 3 && contains(&sea, a[0]))
                        .cloned()
                        .collect();
                    (sea, holes)
                })
                .collect(),
            lakes: polygons(&t["lakes"]),
            rivers: arr(&t["rivers"])
                .iter()
                .map(|rv| {
                    (
                        poly(&rv["path"]),
                        arr(&rv["width"]).iter().map(num).collect(),
                    )
                })
                .collect(),
            roads: super::rural::roads(input),
        }
    }
}
fn natural_layer(
    input: &Input,
    u: &Value,
    others: &[&Value],
    water: &NaturalWater,
) -> Result<Vec<Region>, ()> {
    if !eligible(u) {
        return Ok(vec![]);
    }
    let plots: Vec<_> = arr(&u["parcels"])
        .iter()
        .filter(|v| s(&v["use"]) == "plot")
        .map(|v| poly(&v["poly"]))
        .collect();
    if plots.is_empty() {
        return Ok(vec![]);
    }
    let b = bbox(&plots.iter().flatten().copied().collect::<Vec<_>>());
    let (x, y) = ((b.x0 / 8.0).floor() * 8.0, (b.y0 / 8.0).floor() * 8.0);
    let (w, h) = (((b.x1 - x) / 8.0).ceil(), ((b.y1 - y) / 8.0).ceil());
    if ![x, y, w, h].iter().all(|v| v.is_finite()) || w <= 0.0 || h <= 0.0 || w * h > 1e6 {
        return Ok(vec![]);
    }
    let mut g = Grid {
        x,
        y,
        w: w as usize,
        h: h as usize,
        cells: vec![0; (w * h) as usize],
    };
    for a in &plots {
        g.mark(a, 1, false, &[])?;
    }
    for a in &plots {
        let points = g.local(a);
        near_line(&closed(&points), g.w, g.h, 8.0, EDGE, |i| g.cells[i] = 0);
    }
    for v in arr(&u["buildings"]) {
        g.clear_box(&poly(&v["poly"]), 3.0)?;
    }
    for r in regions(&u["masses"]) {
        g.mark(&r.outer, 0, true, &[])?;
    }
    let mut protect: Vec<_> = arr(&u["parcels"])
        .iter()
        .filter(|v| s(&v["use"]) != "plot")
        .map(|v| poly(&v["poly"]))
        .collect();
    protect.extend(regions(&u["backLand"]).into_iter().map(|r| r.outer));
    protect.extend(arr(&u["landmarks"]).iter().map(|v| poly(&v["poly"])));
    protect.extend(polygons(&u["squares"]));
    protect.extend(regions(&u["water"]).into_iter().map(|r| r.outer));
    protect.extend(regions(&u["ruralReserve"]).into_iter().map(|r| r.outer));
    for v in others {
        protect.extend(regions(&v["footprintH"]).into_iter().map(|r| r.outer));
    }
    for a in protect {
        g.mark(&a, 0, true, &[])?;
    }
    for st in arr(&u["streets"]) {
        g.clear_way(&poly(&st["path"]), num(&st["width"]))?;
    }
    for rd in &water.roads {
        g.clear_way(&rd.path, rd.width)?;
    }
    for (sea, holes) in &water.coast {
        g.mark(sea, 0, true, holes)?;
    }
    for a in &water.lakes {
        g.mark(a, 0, true, &[])?;
    }
    for (path, widths) in &water.rivers {
        if path.len() != widths.len() {
            return Err(());
        }
        for i in 1..path.len() {
            let width = widths[i - 1].max(widths[i]).max(2.5);
            g.clear_way(
                &path[i - 1..=i],
                3.0 * width + 7.0 * input.map_size / 1600.0,
            )?;
        }
    }
    for wall in arr(&u["walls"]) {
        let path = poly(&wall["path"]);
        let path = if yes(&wall["closed"]) {
            closed(&path)
        } else {
            path
        };
        g.clear_way(&path, num(&wall["thickness"]) + 4.0)?;
    }
    g.prune(1200.0_f64.max(2.2 * input.cell * input.cell));
    Ok(g.rectangles())
}
pub(crate) fn urban_natural_ground(input: &Input) -> Vec<Region> {
    if invalid_coordinates(&input.geometry["terrain"])
        || invalid_coordinates(&input.geometry["roads"])
    {
        return vec![];
    }
    let all = layers(input);
    // Every layer requires every other layer to be valid. Check the shared set once.
    if all.iter().any(|u| invalid_coordinates(u)) {
        return vec![];
    }
    let water = NaturalWater::new(input);
    par::map(&all, |u| {
        let others: Vec<_> = all
            .iter()
            .copied()
            .filter(|v| !std::ptr::eq(*v, *u))
            .collect();
        natural_layer(input, u, &others, &water).unwrap_or_default()
    })
    .into_iter()
    .flatten()
    .collect()
}

pub(crate) fn operation(input: &Input, v: &Value) -> Result<Vec<Region>, String> {
    if ["urban", "owner", "source", "protection", "water"]
        .iter()
        .any(|&k| invalid_coordinates(&v[k]))
    {
        return Ok(vec![]);
    }
    let enabled = yes(&v["appearance"]);
    Ok(match s(&v["operation"]) {
        "water-ground" => return water_ground(input),
        "protected-ground" => {
            let u = &v["urban"];
            protected(input, u, enabled, &appearance(input, u, enabled))
        }
        "layer-ground" => {
            let replaced = arr(&v["replaced"])
                .iter()
                .map(|v| num(v) as usize)
                .collect();
            layer(
                input,
                &v["urban"],
                &replaced,
                enabled,
                v["footprint"].is_array().then(|| poly(&v["footprint"])),
                v["owner"].is_object().then_some(&v["owner"]),
            )
        }
        "dry-ground" => {
            let source = regions(&v["source"]);
            let protection = regions(&v["protection"]);
            let water = regions(&v["water"]);
            if source.is_empty() || !valid(&source) || !valid(&protection) || !valid(&water) {
                return Ok(vec![]);
            }
            let boxes: Vec<_> = source.iter().map(|r| bbox(&r.outer)).collect();
            let near = |a: Vec<Region>| {
                a.into_iter()
                    .filter(|r| boxes.iter().any(|b| b.meets(bbox(&r.outer))))
                    .collect::<Vec<_>>()
            };
            let protect = bo::union_many(&near(protection));
            let ground = bo::safe(&bo::union_many(&source), &protect, Op::Difference);
            bo::safe(&ground, &bo::union_many(&near(water)), Op::Difference)
        }
        _ => vec![],
    })
}
