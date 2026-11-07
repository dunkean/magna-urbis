use super::{
    boolean::{self as bo, Op},
    fields::{self, Context, Net},
    geom::*,
    raster::*,
    *,
};
use std::{collections::BTreeMap, f64::consts::PI};
#[derive(Clone, Default, Deserialize)]
pub(crate) struct Road {
    pub path: Polygon,
    pub width: f64,
    #[serde(default)]
    pub kind: String,
}
pub(crate) fn roads(input: &Input) -> Vec<Road> {
    serde::Deserialize::deserialize(&input.geometry["roads"]).unwrap_or_default()
}
pub(crate) fn plan(input: &Input) -> &Value {
    input.plan.as_ref().unwrap_or(&Value::Null)
}
pub(crate) fn ring_scale(pop: f64) -> f64 {
    if pop < 15.0 {
        450.0
    } else {
        1200.0 * (pop.max(15.0) / 100.0).powf(0.23)
    }
}
fn cultivation_scale(pop: f64) -> f64 {
    ring_scale(pop).max((pop.max(1.0) * 1800.0 / PI).sqrt() / 0.42)
}
pub(crate) struct Soil<'a> {
    input: &'a Input,
    noise: &'a Noise,
    grid: (usize, usize, f64, f64, f64),
}
impl<'a> Soil<'a> {
    pub(crate) fn new(input: &'a Input, noise: &'a Noise) -> Self {
        Self {
            input,
            noise,
            grid: (
                num(&input.soil_context["w"]) as usize,
                num(&input.soil_context["h"]) as usize,
                num(&input.soil_context["cell"]),
                num(&input.soil_context["x0"]),
                num(&input.soil_context["y0"]),
            ),
        }
    }
    pub(crate) fn at(&self, x: f64, y: f64) -> f64 {
        let i = self.input;

        if i.soil.is_empty() {
            return self.noise.fbm(x / 380.0, y / 380.0, 3);
        }
        let (w, h, cell, origin_x, origin_y) = self.grid;
        if w == 0 || h == 0 || i.soil.len() != w * h || cell <= 0.0 {
            return f64::NAN;
        }
        let gx = ((x - origin_x) / cell - 0.5).clamp(0.0, w as f64 - 1.0);
        let gy = ((y - origin_y) / cell - 0.5).clamp(0.0, h as f64 - 1.0);
        let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
        let (tx, ty) = (gx - x0 as f64, gy - y0 as f64);
        (i.soil[y0 * w + x0] as f64 * (1.0 - tx) + i.soil[y0 * w + x1] as f64 * tx) * (1.0 - ty)
            + (i.soil[y1 * w + x0] as f64 * (1.0 - tx) + i.soil[y1 * w + x1] as f64 * tx) * ty
    }
}
fn component(c: &[u8], seen: &mut [bool], seed: usize, n: usize) -> Vec<usize> {
    let k = c[seed];
    let mut comp = vec![];
    let mut stack = vec![seed];
    seen[seed] = true;
    while let Some(i) = stack.pop() {
        comp.push(i);
        let (x, y) = ((i % n) as isize, (i / n) as isize);
        for d in (0..8).step_by(2) {
            let (xx, yy) = (x + D8[d].0, y + D8[d].1);
            if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                continue;
            }
            let j = yy as usize * n + xx as usize;
            if !seen[j] && c[j] == k {
                seen[j] = true;
                stack.push(j);
            }
        }
    }
    comp
}
fn neighbours(i: usize, n: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((i % n) as isize, (i / n) as isize);
    D8.into_iter().filter_map(move |(dx, dy)| {
        let (xx, yy) = (x + dx, y + dy);
        (xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize)
            .then_some((yy * n as isize + xx) as usize)
    })
}
pub fn generate_rural(input: &Input) -> Result<RuralOutput, String> {
    input.validate(true)?;
    let clock = timing::Clock::new();
    let (n, cell) = (input.w, input.cell);
    let total = n * n;
    let s_map = input.map_size;
    let g = &input.geometry;
    let pl = plan(input);
    let planned = input.plan.is_some();
    let root = Rng::new(&input.seed);
    let rr = root.fork("rural");
    let noise = Noise::new(rr.fork("noise"));
    let soil = Soil::new(input, &noise);
    let roads = roads(input);
    let b = input.biome.as_str();
    let mut stats = BTreeMap::new();
    let mut road_m = vec![0; total];
    let mut road_ang_c = vec![0_f32; total];
    let mut excl = vec![0; total];
    for rd in &roads {
        for a in rd.path.windows(2) {
            let ang = (a[1].y - a[0].y).atan2(a[1].x - a[0].x).rem_euclid(PI);
            near_line(a, n, n, cell, cell * 0.7, |i| {
                road_m[i] = 1;
                road_ang_c[i] = ang as f32;
            });
        }
        near_line(
            &rd.path,
            n,
            n,
            cell,
            rd.width / 2.0 + 0.75 * cell + 3.0,
            |i| excl[i] = 1,
        );
    }
    let (d_road, road_ang) = distance_field(&road_m, n, n, cell, Some(&road_ang_c));
    let secondary: Vec<_> = arr(&g["settlements"])
        .iter()
        .filter(|v| !yes(&v["main"]))
        .collect();
    let urban = &g["urban"];
    let lm = if input.options["mapSize"].is_null() {
        s_map
    } else {
        (s_map * 2.0).min(if planned {
            cultivation_scale(num(&pl["population"]))
        } else {
            ring_scale(urban["population"].as_f64().unwrap_or(100.0))
        })
    };
    let reserve_cost = 1.25 * num(&g["site"]["reserveRadius"]);
    let cost = &input.cost;
    let mut reserve = vec![0; total];
    let open_town = planned
        || s(&urban["archetype"]) == "town"
            && !yes(&urban["renderHints"]["openGround"])
            && !yes(&urban["renderHints"]["stilts"])
            && !arr(&urban["walls"])
                .iter()
                .any(|w| s(&w["role"]).is_empty() || ["town", "outer"].contains(&s(&w["role"])))
            && !arr(&urban["phases"]).iter().any(|p| yes(&p["walled"]))
            && !arr(&urban["lines"])
                .iter()
                .any(|l| s(&l["kind"]) == "hedge");
    let mut cover_reserve: Option<Vec<u8>> = None;
    let mut u_dist = vec![0_f32; total];
    let empty_main = if planned {
        arr(&pl["footprint"]).is_empty()
    } else {
        urban.is_object() && !urban["macro"].is_object() && arr(&urban["buildings"]).is_empty()
    };
    let built = if planned {
        regions(&pl["footprint"])
    } else if empty_main {
        vec![]
    } else {
        regions(&urban["footprintH"])
    };
    let rural_res = regions(&urban["ruralReserve"]);
    let foot = if !empty_main && !rural_res.is_empty() {
        bo::safe(&built, &rural_res, Op::Union)
    } else {
        built
    };
    if !foot.is_empty() {
        let rings = foot
            .iter()
            .flat_map(|r| std::iter::once(r.outer.clone()).chain(r.holes.clone()))
            .collect::<Vec<_>>();
        rasterize(&rings, n, n, cell, &mut reserve);
        if open_town {
            cover_reserve = Some(reserve.clone());
        }
        let margin = if arr(&urban["walls"]).is_empty() {
            5.0
        } else {
            14.0
        } + 0.5 * cell;
        let (d_res, val) = distance_field(&reserve, n, n, cell, Some(cost));
        for i in 0..total {
            if (d_res[i] as f64) <= margin {
                reserve[i] = 1;
            }
            if let Some(cr) = &mut cover_reserve {
                if (d_res[i] as f64) <= margin {
                    let wx = (i % n) as f64 * cell + 0.5 * cell;
                    let wy = (i / n) as f64 * cell + 0.5 * cell;
                    let cm = 0.5 * cell + 2.0 + noise.noise(wx / 40.0, wy / 40.0);
                    if (d_res[i] as f64) <= cm {
                        cr[i] = 1;
                    }
                }
            }
            u_dist[i] = (0.0_f64
                .max((cost[i] as f64).min(1e5) - if val[i].is_nan() { 0.0 } else { val[i] as f64 }))
                as f32;
        }
    } else if !empty_main {
        for i in 0..total {
            if (cost[i] as f64) <= reserve_cost {
                reserve[i] = 1;
            }
            u_dist[i] = ((cost[i] as f64).min(1e5) - reserve_cost) as f32;
        }
    } else {
        u_dist.fill(1e5);
    }
    let mut cover_footprints = foot.clone();
    if !secondary.is_empty() {
        let mut src = vec![0; total];
        let mut res_sec = vec![0; total];
        let mut scale = vec![0_f32; total];
        let mut own = vec![0; total];
        for st in &secondary {
            let k = lm
                / if planned {
                    cultivation_scale(num(&st["population"]))
                } else {
                    ring_scale(num(&st["population"]))
                };
            let su = &st["urban"];
            let empty =
                su.is_object() && !su["macro"].is_object() && arr(&su["buildings"]).is_empty();
            let key = s(&st["key"]);
            let own_plan = pl["settlementFootprints"].get(key);
            let mut own_foot = if let Some(v) = own_plan {
                regions(v)
            } else if s(&st["detail"]) == "farmstead" {
                vec![piece(circle(
                    serde_json::from_value(st["center"].clone()).unwrap_or_default(),
                    20.0,
                    12,
                ))]
            } else if empty {
                vec![]
            } else {
                let foot = regions(&su["footprintH"]);
                if !foot.is_empty() {
                    foot
                } else {
                    let e = poly(&st["extent"]);
                    if e.len() >= 3 { vec![piece(e)] } else { vec![] }
                }
            };
            let rr_ = regions(&su["ruralReserve"]);
            if !empty && !rr_.is_empty() {
                own_foot = bo::safe(&own_foot, &rr_, Op::Union);
            }
            cover_footprints.extend(own_foot.clone());
            let rings: Vec<_> = own_foot
                .iter()
                .flat_map(|r| std::iter::once(r.outer.clone()).chain(r.holes.clone()))
                .collect();
            if rings.is_empty() {
                continue;
            }
            rasterize(&rings, n, n, cell, &mut own);
            let bb = bbox(&rings.iter().flatten().copied().collect::<Vec<_>>());
            let x0 = ((bb.x0 / cell).floor() - 1.0).max(0.0) as isize;
            let x1 = ((bb.x1 / cell).ceil() + 1.0).min(n as f64 - 1.0) as isize;
            let y0 = ((bb.y0 / cell).floor() - 1.0).max(0.0) as isize;
            let y1 = ((bb.y1 / cell).ceil() + 1.0).min(n as f64 - 1.0) as isize;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let i = y as usize * n + x as usize;
                    if own[i] == 0 {
                        continue;
                    }
                    own[i] = 0;
                    src[i] = 1;
                    scale[i] = k as f32;
                    if s(&st["detail"]) != "farmstead" {
                        res_sec[i] = 1;
                    }
                }
            }
        }
        let (d_res, _) = distance_field(&res_sec, n, n, cell, None);
        let (d_sec, val) = distance_field(&src, n, n, cell, Some(&scale));
        let warp = Noise::new(rr.fork("clearing"));
        for i in 0..total {
            if (d_res[i] as f64) <= 5.0 + 0.5 * cell {
                reserve[i] = 1;
                if let Some(cr) = &mut cover_reserve {
                    cr[i] = 1;
                }
            }
            let wx = (i % n) as f64 * cell + 0.5 * cell;
            let wy = (i / n) as f64 * cell + 0.5 * cell;
            let u2 = d_sec[i] as f64
                * val[i] as f64
                * (1.0 + 0.38 * warp.fbm(wx / 650.0, wy / 650.0, 3));
            if u2 < (u_dist[i] as f64) {
                u_dist[i] = u2 as f32;
            }
        }
    }
    let mut farm_reserve = reserve.clone();
    for u in ground::layers(input) {
        if u["macro"].is_object()
            && arr(&u["macro"]["quarters"]).iter().any(|q| {
                s(&q["kind"]) == "quarter" && arr(&q["lab"]).iter().any(|l| num(l) == -1.0)
            })
        {
            for ph in regions(&u["footprintH"]) {
                for ring in std::iter::once(&ph.outer).chain(&ph.holes) {
                    if ring.len() >= 3 {
                        near_line(
                            &closed(ring),
                            n,
                            n,
                            cell,
                            21.0 + std::f64::consts::SQRT_2 * cell,
                            |i| farm_reserve[i] = 1,
                        );
                    }
                }
            }
        }
    }
    let slope_l = blur(
        &input.slope,
        n,
        n,
        ((45.0 / cell + 0.5).floor() as usize).max(1),
        1,
    );
    let mut near_sl = vec![];
    for i in (0..total).step_by(3) {
        if input.water[i] == 0 && (cost[i] as f64) < 0.5 * lm {
            near_sl.push(slope_l[i] as f64);
        }
    }
    near_sl.sort_by(f64::total_cmp);
    let qs = |p: f64| {
        if near_sl.is_empty() {
            0.05
        } else {
            near_sl[(near_sl.len() as f64 * p).floor() as usize]
        }
    };
    let mountain = s(&input.options["relief"]) == "mountains";
    let field_cap = if mountain { 0.26_f64 } else { 0.15 };
    let field_max = 0.06_f64.max(field_cap.min(qs(0.42)));
    let pasture_max = (field_max + 0.03).max(if mountain { 0.5_f64 } else { 0.3 }.min(qs(0.82)));
    stats.insert(
        "fieldMaxSlope".into(),
        (field_max * 1000.0 + 0.5).floor() / 1000.0,
    );
    let farm_clock = timing::Clock::new();
    let (farmsteads, farm_mask) = super::rural_farms::generate(
        input,
        &rr,
        &soil,
        &roads,
        &slope_l,
        &farm_reserve,
        &u_dist,
        lm,
        pasture_max,
        &mut stats,
    );
    stats.insert("ms.lu.pre".into(), clock.ms());
    stats.insert("ms.lu.farms".into(), farm_clock.ms());
    let class_clock = timing::Clock::new();
    let mut d_farm = vec![1e9_f32; total];
    for fm in &farmsteads {
        let p: Point = serde_json::from_value(fm["pos"].clone()).unwrap_or_default();
        let (cx, cy) = ((p.x / cell).floor() as isize, (p.y / cell).floor() as isize);
        let r = (200.0 / cell).ceil() as isize + 1;
        for y in (cy - r).max(0)..=(cy + r).min(n as isize - 1) {
            for x in (cx - r).max(0)..=(cx + r).min(n as isize - 1) {
                let d = ((x as f64 + 0.5) * cell - p.x).hypot((y as f64 + 0.5) * cell - p.y);
                let i = y as usize * n + x as usize;
                if d < d_farm[i] as f64 {
                    d_farm[i] = d as f32;
                }
            }
        }
    }
    let boc_noise = Noise::new(rr.fork("bocage"));
    let bocage = |wx: f64, wy: f64, dw: f64| {
        let base = 0.35 * (1.0 - (dw / 450.0).min(1.0)) + 0.45 * (0.5 - wx / s_map)
            - if mountain { 0.2 } else { 0.0 };
        if base + 0.5 <= 0.4 {
            -1.0
        } else {
            base + 0.5 * boc_noise.fbm(wx / 900.0, wy / 900.0, 2)
        }
    };
    let mut cls = vec![0_u8; total];
    let mut cultivation = vec![0_u8; total];
    let hb = blur(
        &input.height,
        n,
        n,
        ((300.0 / cell + 0.5).floor() as usize).max(2),
        2,
    );
    let mut prom_vals = vec![];
    for i in (0..total).step_by(5) {
        let p = input.height[i] as f64 - hb[i] as f64;
        if p > 0.0 && input.water[i] == 0 {
            prom_vals.push(p);
        }
    }
    prom_vals.sort_by(f64::total_cmp);
    let prom_hi = 4.0_f64.max(if prom_vals.is_empty() {
        8.0
    } else {
        prom_vals[(prom_vals.len() as f64 * 0.75).floor() as usize]
    });
    let sea = input.sea_fraction > 0.02;
    let multi = !secondary.is_empty();
    let stride = (380.0 / (4.0 * cell)).floor().clamp(1.0, 8.0) as usize;
    let sgw = ((n - 1) as f64 / stride as f64).ceil() as usize + 2;
    let mut soil_g = vec![0_f32; sgw * sgw];
    par::for_each(&mut soil_g, |i, out| {
        let (gx, gy) = (i % sgw, i / sgw);
        *out = soil.at(
            (gx * stride) as f64 * cell + 0.5 * cell,
            (gy * stride) as f64 * cell + 0.5 * cell,
        ) as f32;
    });
    let soil_at = |x: f64, y: f64| {
        let fx = x / stride as f64;
        let fy = y / stride as f64;
        let x0 = fx.floor();
        let y0 = fy.floor();
        let tx = fx - x0;
        let ty = fy - y0;
        let o = y0 as isize * sgw as isize + x0 as isize;
        let get = |i: isize| soil_g.get(i as usize).copied().unwrap_or(f32::NAN) as f64;
        (get(o) * (1.0 - tx) + get(o + 1) * tx) * (1.0 - ty)
            + (get(o + sgw as isize) * (1.0 - tx) + get(o + sgw as isize + 1) * tx) * ty
    };
    let u1 = if planned {
        140.0_f64.min(0.04 * lm + 30.0)
    } else {
        0.05 * lm + 30.0
    };
    let u2 = if planned {
        320.0_f64.min(0.11 * lm)
    } else {
        0.11 * lm
    };
    let u3 = 0.42 * lm;
    let u4 = 0.55 * lm;
    let verge = |u: f64| {
        if ["desert", "tundra", "underdark"].contains(&b) {
            8
        } else if b == "steppe" {
            3
        } else if ["forest", "tropical"].contains(&b) && u > u3 * 0.6 {
            4
        } else {
            2
        }
    };
    par::for_each2(&mut cls, &mut cultivation, |i, class, cultivated| {
        let (x, y) = (i % n, i / n);
        let water = input.water[i];
        let dw = input.d_water[i] as f64;
        if water == 1
            || water == 2
            || dw < 0.6 * cell && water == 0
            || cover_reserve.as_ref().unwrap_or(&reserve)[i] != 0
            || farm_mask[i] == 1
        {
            return;
        }
        let (wx, wy) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
        let sl = slope_l[i] as f64;
        let hab = input.hab[i] as f64;
        let u = u_dist[i] as f64;
        let soil = soil_at(x as f64, y as f64);
        let prom = input.height[i] as f64 - hb[i] as f64;
        let gb = || noise.fbm(wx / 110.0 + 40.0, wy / 110.0 - 17.0, 2);
        let gc = || noise.fbm(wx / 70.0 - 9.0, wy / 70.0 + 5.0, 2);
        if planned
            && !["underdark", "underdark-caverns"].contains(&b)
            && sl < field_max
            && soil > -0.6
        {
            let crop = if u < u1 {
                if d_road[i] < 85.0 && soil > -0.35 {
                    6
                } else if d_road[i] < 190.0 && soil > -0.15 {
                    5
                } else {
                    1
                }
            } else if u < u2 {
                if d_road[i] < 240.0 && soil > -0.05 {
                    5
                } else if soil > -0.35 {
                    1
                } else {
                    2
                }
            } else if u < u3 * (1.0 + 0.28 * soil) {
                1
            } else {
                0
            };
            if excl[i] == 0 && crop != 0 {
                let k = biome_kind(crop, b, dw, hab, sl, soil, u, u3);
                if [1, 5, 6].contains(&k) {
                    *cultivated = k;
                }
            }
        }
        let mut k = if hab < 1.4
            && sl < 0.02
            && dw < 150.0
            && gb()
                > -0.15
                    - if sea && input.d_sea[i] < 200.0 {
                        0.25
                    } else {
                        0.0
                    } {
            7
        } else if hab < 4.5 && dw < 240.0 && sl < 0.5 * field_max && (dw < 130.0 || soil < 0.1) {
            2
        } else if sl > pasture_max || (prom > prom_hi * 1.15 && sl > field_max) {
            4
        } else if farm_mask[i] == 2 {
            if gc() > 0.0 { 5 } else { 6 }
        } else if planned && u < u1 && sl < field_max {
            if d_road[i] < 85.0 && soil > -0.35 {
                6
            } else if d_road[i] < 190.0 && soil > -0.15 {
                5
            } else {
                1
            }
        } else if u < u1 && sl < field_max {
            if d_road[i] < 80.0 && gc() > -0.05 {
                6
            } else {
                5
            }
        } else if planned && u < u2 && sl < field_max {
            if d_road[i] < 240.0 && soil > -0.05 {
                5
            } else if soil > -0.35 {
                1
            } else {
                2
            }
        } else if u < u2 && sl < field_max {
            if gc() > 0.05 {
                5
            } else if gc() > -0.35 {
                1
            } else {
                2
            }
        } else if multi && u > u4 * (1.0 + 0.2 * soil) {
            if soil > -0.45 { 4 } else { 8 }
        } else if sl > field_max {
            if soil > 0.15 { 4 } else { 3 }
        } else if u < u3 * (1.0 + 0.28 * soil) && soil > -0.6 {
            1
        } else if u < u4 * (1.0 + 0.2 * soil) {
            if soil < -0.05 || gb() > 0.35 { 8 } else { 3 }
        } else if soil > 0.0 {
            4
        } else {
            3
        };
        if b != "temperate" {
            k = biome_kind(k, b, dw, hab, sl, soil, u, u3);
        }
        if k == 1 {
            let e = pl["fieldEnclosure"].as_f64();
            let g = e.map(|e| (e / 0.4).min(3.0)).unwrap_or(1.0);
            let close = if e.is_some_and(|e| e <= 0.02) {
                false
            } else {
                (d_farm[i] as f64) < 190.0 * g && (d_farm[i] as f64) < (115.0 + 75.0 * gc()) * g
                    || u < 0.17 * lm * g && gb() > -0.3
                    || bocage(wx, wy, dw) > e.map(|e| 0.4 + 1.5 * (0.4 - e)).unwrap_or(0.4)
            };
            if close {
                k = 9;
            }
        }
        if excl[i] != 0 && !natural(k) {
            k = verge(u);
        }
        *class = k;
    });
    let fm: Vec<_> = cls.iter().map(|&k| u8::from(k == 1 || k == 9)).collect();
    let (df, _) = distance_field(&fm, n, n, cell, None);
    for i in 0..total {
        if cls[i] != 4 || df[i] > 95.0 {
            continue;
        }
        let (wx, wy) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
        let a = noise.fbm(wx / 95.0 + 200.0, wy / 95.0 + 77.0, 2);
        if a > 0.05
            && (df[i] as f64) < 30.0 + 90.0 * a
            && (slope_l[i] as f64) < field_max * 1.15
            && input.hab[i] > 2.5
        {
            cls[i] = 9;
        }
    }
    for _ in 0..2 {
        let mut tmp = cls.clone();
        for y in 1..n - 1 {
            for x in 1..n - 1 {
                let i = y * n + x;
                if cls[i] == 0 {
                    continue;
                }
                let mut counts = [0; 10];
                for j in neighbours(i, n) {
                    counts[cls[j] as usize] += 1;
                }
                let mut bk = cls[i];
                let mut bc = counts[bk as usize];
                for k in 1..10 {
                    if counts[k] > bc {
                        bc = counts[k];
                        bk = k as u8;
                    }
                }
                if bk != cls[i] && bc >= 5 {
                    tmp[i] = bk;
                }
            }
        }
        cls = tmp;
    }
    let mut seen = vec![false; total];
    let min_cells = 6_usize.max((1500.0 / (cell * cell) + 0.5).floor() as usize);
    for seed in 0..total {
        if cls[seed] == 0 || seen[seed] {
            continue;
        }
        let k = cls[seed];
        let comp = component(&cls, &mut seen, seed, n);
        if comp.len() >= min_cells || planned && [5, 6].contains(&k) && comp.len() >= 2 {
            continue;
        }
        let mut counts = [0; 10];
        for &i in &comp {
            for j in neighbours(i, n) {
                let v = cls[j];
                if v != k {
                    counts[v as usize] += 1;
                }
            }
        }
        let (mut bk, mut bc) = (0, 0);
        for v in 1..10 {
            if counts[v] > bc {
                bc = counts[v];
                bk = v as u8;
            }
        }
        for i in comp {
            cls[i] = bk;
        }
    }
    for i in 0..total {
        if excl[i] != 0 && cls[i] != 0 && !natural(cls[i]) {
            cls[i] = verge(u_dist[i] as f64);
        }
        if b == "underdark" && cls[i] == 6 {
            cls[i] = biome_kind(
                6,
                b,
                input.d_water[i] as f64,
                input.hab[i] as f64,
                slope_l[i] as f64,
                0.0,
                u_dist[i] as f64,
                u3,
            );
        }
    }
    let natural_ground = ground::urban_natural_ground(input);
    let landscape_ground = urban_landscape_ground(input, false);
    let mut cover_ground = natural_ground.clone();
    cover_ground.extend(landscape_cover_ground(input, &landscape_ground));
    if !cover_ground.is_empty() {
        if cover_reserve.is_none() {
            cover_reserve = Some(reserve.clone());
        }
        let mut mask = vec![0; total];
        raster_regions(&cover_ground, n, n, cell, &mut mask);
        let src: Vec<_> = cls.iter().map(|&k| u8::from(k != 0)).collect();
        let carry: Vec<_> = cls.iter().map(|&k| k as f32).collect();
        let (_, nearest) = distance_field(&src, n, n, cell, Some(&carry));
        for i in 0..total {
            let w = input.water[i];
            let dw = input.d_water[i] as f64;
            if mask[i] == 0
                || cls[i] != 0
                || w == 1
                || w == 2
                || dw < 0.6 * cell && w == 0
                || excl[i] != 0
                || farm_mask[i] == 1
            {
                continue;
            }
            let near = nearest[i] as u8;
            if near == 0 {
                continue;
            }
            let sl = slope_l[i] as f64;
            let hab = input.hab[i] as f64;
            let prom = input.height[i] as f64 - hb[i] as f64;
            let mut k = if natural(near) { near } else { 3 };
            if sl > pasture_max || prom > prom_hi * 1.15 && sl > field_max {
                k = 4;
            } else if k == 7 && (hab >= 4.5 || dw >= 240.0) {
                k = 2;
            }
            if b != "temperate" {
                k = biome_kind(
                    k,
                    b,
                    dw,
                    hab,
                    sl,
                    soil_at((i % n) as f64, (i / n) as f64),
                    u_dist[i] as f64,
                    u3,
                );
            }
            if natural(k) {
                cls[i] = k;
            }
        }
    }
    if !input.natural_forest.is_empty() {
        let stands = blur(&input.natural_forest, n, n, 3, 2);
        let local = blur(
            &input.height,
            n,
            n,
            ((110.0 / cell + 0.5).floor() as usize).max(2),
            2,
        );
        let edge = Noise::new(rr.fork("stand-edge"));
        let (mut sum, mut count) = (0.0, 0);
        for i in (0..total).step_by(7) {
            if input.water[i] == 0 {
                sum += (input.height[i] as f64 - local[i] as f64).abs();
                count += 1;
            }
        }
        let relief = 0.5_f64.max(2.2 * sum / (count.max(1) as f64));
        par::for_each(&mut cls, |i, class| {
            let spur = ((input.height[i] as f64 - local[i] as f64) / relief).clamp(-1.0, 1.0);
            let score = (stands[i] as f64
                + 0.12
                    * edge.fbm(
                        ((i % n) as f64 + 0.5) * cell / 190.0,
                        ((i / n) as f64 + 0.5) * cell / 190.0,
                        4,
                    )
                - 0.17 * spur) as f32;
            let sl = input.slope[i] as f64;
            if *class == 0 {
                return;
            }
            if !natural(*class) {
                if sl > field_cap || !cost[i].is_finite() && secondary.is_empty() {
                    *class = 3;
                } else {
                    return;
                }
            }
            if *class == 4 && (score as f64) < 0.22 {
                *class = if sl > pasture_max { 8 } else { 3 };
            } else if u_dist[i] as f64 > u4 && *class != 7 && score as f64 >= 0.22 {
                *class = 4;
            }
        });
    }
    if planned && !["underdark", "underdark-caverns"].contains(&b) {
        let mut wet = vec![0_f32; total];
        let mut damp = vec![0_f32; total];
        for i in 0..total {
            let hab = input.hab[i] as f64;
            let d = input.d_water[i];
            let sl = slope_l[i] as f64;
            wet[i] = if hab >= -0.5
                && hab < 0.35
                && d < 70.0
                && sl < 0.012
                && (input.height[i] as f64 - hb[i] as f64) < -4.0
            {
                1.0
            } else {
                0.0
            };
            damp[i] = if hab >= -0.5 && hab < 2.0 && d < 70.0 && sl < 0.5 * field_max {
                1.0
            } else {
                0.0
            };
        }
        let rad = ((40.0 / cell + 0.5).floor() as usize).max(1);
        let marsh = blur(&wet, n, n, rad, 2);
        let meadow = blur(&damp, n, n, rad, 2);
        for i in 0..total {
            if cls[i] != 7 && cls[i] != 2 {
                continue;
            }
            if marsh[i] > 0.55 {
                cls[i] = 7;
            } else if meadow[i] > 0.5 {
                cls[i] = 2;
            } else if cultivation[i] != 0 {
                cls[i] = cultivation[i];
                *stats.entry("wet.cultivatedHa".into()).or_insert(0.0) += cell * cell / 1e4;
            } else {
                cls[i] = 3;
            }
        }
        let mut seen = vec![false; total];
        for seed in 0..total {
            if cls[seed] != 7 || seen[seed] {
                continue;
            }
            let comp = component(&cls, &mut seen, seed, n);
            if (comp.len() as f64) * cell * cell < 12000.0 {
                for i in comp {
                    cls[i] = 2;
                }
            }
        }
    }
    stats.insert("ms.lu.classes".into(), class_clock.ms());
    let vector_clock = timing::Clock::new();
    let min_area = 1200.0_f64.max(2.2 * cell * cell);
    let mut areas = vec![];
    let mut field_regions = vec![];
    let mut close_regions = vec![];
    let mut horticulture: Vec<(u8, Region)> = vec![];
    let mut counts = BTreeMap::new();
    let warp_noise = Noise::new(rr.fork("warp"));
    let wamp = (0.5 * cell).clamp(2.0, 4.0);
    let ex_m: Vec<_> = (0..total).map(|i| cls[i] == 0 || excl[i] != 0).collect();
    let ex_dist = |q: Point| {
        let i = idx(q, n, n, cell);
        let (cx, cy) = ((i % n) as isize, (i / n) as isize);
        let mut best = 3.0 * cell;
        for yy in (cy - 3).max(0)..=(cy + 3).min(n as isize - 1) {
            for xx in (cx - 3).max(0)..=(cx + 3).min(n as isize - 1) {
                if !ex_m[yy as usize * n + xx as usize] {
                    continue;
                }
                best = best
                    .min(((xx as f64 + 0.5) * cell - q.x).hypot((yy as f64 + 0.5) * cell - q.y));
            }
        }
        best
    };
    let warp_ring = |r: &Polygon| {
        let mut dense = vec![];
        for i in 0..r.len() {
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            let m = (dist(a, b) / 14.0).ceil().max(1.0) as usize;
            for k in 0..m {
                dense.push(lerp(a, b, k as f64 / m as f64));
            }
        }
        simplify(&dense, 0.35)
            .iter()
            .map(|q| {
                let a = wamp * smooth(ex_dist(*q), 0.8 * cell, 2.4 * cell);
                p(
                    q.x + a
                        * (warp_noise.noise(q.x / 48.0, q.y / 48.0)
                            + 0.25 * warp_noise.noise(q.x / 20.0 + 5.0, q.y / 20.0)),
                    q.y + a
                        * (warp_noise.noise(q.x / 48.0 + 31.0, q.y / 48.0 - 7.0)
                            + 0.25 * warp_noise.noise(q.x / 20.0, q.y / 20.0 + 9.0)),
                )
            })
            .collect::<Polygon>()
    };
    let cover_foot = if cover_reserve.is_some() {
        cover_footprints
    } else {
        vec![]
    };
    let mut road_cuts = vec![];
    for rd in &roads {
        for ab in simplify(&rd.path, 0.75).windows(2) {
            let (a, b) = (ab[0], ab[1]);
            let len = dist(a, b);
            if len < 0.001 {
                continue;
            }
            let radius = rd.width / 2.0 + 2.0 + 0.75;
            road_cuts.push(piece(rect(
                (a.x + b.x) / 2.0,
                (a.y + b.y) / 2.0,
                len + 2.0 * radius,
                2.0 * radius,
                (b.y - a.y).atan2(b.x - a.x),
            )));
        }
    }
    let mut failures = 0.0;
    let mut clip_dropped = 0.0;
    let windows: Vec<_> = (0..10_u8).map(|k| class_window(&cls, n, n, k)).collect();
    let pieces = par::map(&(1..10_u8).collect::<Vec<_>>(), |&k| {
        let mut failures = 0.0;
        let mut clip_dropped = 0.0;
        let Some(win) = windows[k as usize] else {
            return (k, vec![], failures, clip_dropped);
        };
        let ind: Vec<_> = cls
            .iter()
            .map(|&v| if v == k { 1.0 } else { 0.0 })
            .collect();
        let threshold = if planned && [5, 6].contains(&k) {
            300.0_f64.max(0.6 * cell * cell)
        } else {
            min_area
        };
        let mut rs = vec![];
        for r in vectorize(&ind, n, n, cell, threshold, win) {
            let warped = Region {
                outer: warp_ring(&r.outer),
                holes: r.holes.iter().map(&warp_ring).collect(),
            };
            let mut result = vec![warped.clone()];
            if cover_reserve.is_some() {
                let box_ = bbox(&warped.outer);
                let near: Vec<_> = cover_foot
                    .iter()
                    .filter(|r| box_.meets(bbox(&r.outer)))
                    .cloned()
                    .collect();
                if !near.is_empty() {
                    let clipped = bo::safe(&[warped.clone()], &near, Op::Difference);
                    if clipped.is_empty() {
                        let mut lost = false;
                        for y in 0..16 {
                            for x in 0..16 {
                                let p = p(
                                    box_.x0 + (x as f64 + 0.5) * (box_.x1 - box_.x0) / 16.0,
                                    box_.y0 + (y as f64 + 0.5) * (box_.y1 - box_.y0) / 16.0,
                                );
                                if inside(&warped, p) && !near.iter().any(|r| inside(r, p)) {
                                    lost = true;
                                    break;
                                }
                            }
                            if lost {
                                break;
                            }
                        }
                        if lost {
                            clip_dropped += 1.0;
                        }
                    }
                    result = clipped
                        .into_iter()
                        .filter(|r| region_area(r) >= 0.4 * min_area)
                        .collect();
                    if natural(k) {
                        let permission: Vec<_> = cover_ground
                            .iter()
                            .filter(|r| box_.meets(bbox(&r.outer)))
                            .cloned()
                            .collect();
                        result.extend(
                            bo::safe(&[warped], &permission, Op::Intersection)
                                .into_iter()
                                .filter(|r| region_area(r) > 0.01),
                        );
                    }
                }
            }
            if natural(k) {
                result = bo::clear_roads(&result, &road_cuts, &mut failures);
            }
            rs.extend(result);
        }
        (k, rs, failures, clip_dropped)
    });
    for (k, rs, failed, dropped) in pieces {
        if windows[k as usize].is_none() {
            continue;
        }
        failures += failed;
        clip_dropped += dropped;
        counts.insert(
            format!(
                "n.{}{}",
                KINDS[k as usize],
                if k == 9 { ".close" } else { "" }
            ),
            rs.len() as f64,
        );
        for r in rs {
            if k == 1 {
                field_regions.push(r);
            } else if k == 9 {
                close_regions.push(r);
            } else if planned && [5, 6].contains(&k) && b != "underdark" {
                horticulture.push((k, r));
            } else {
                let mut a = Area::new(KINDS[k as usize], r);
                if b == "underdark" && k == 6 {
                    a.cultivation = Some("fungal".into());
                }
                areas.push(a);
            }
        }
    }
    stats.insert("ms.lu.vector".into(), vector_clock.ms());
    let fields_clock = timing::Clock::new();
    let hsm = blur(&input.height, n, n, 2, 2);
    let mut ft_rng = rr.fork("furlong");
    let angle_noise = Noise::new(rr.fork("angle"));
    let dir = |x: f64, y: f64| {
        let ci = idx(p(x, y), n, n, cell);
        let sl = slope_l[ci] as f64;
        let ws = smooth(sl, 0.022, 0.05);
        let cx = (x / cell).floor().max(1.0).min(n as f64 - 2.0) as usize;
        let cy = (y / cell).floor().max(1.0).min(n as f64 - 2.0) as usize;
        let (xl, xr, yu, yd) = (
            cx.saturating_sub(1),
            (cx + 1).min(n - 1),
            cy.saturating_sub(1),
            (cy + 1).min(n - 1),
        );
        let gx = (hsm[cy * n + xr] as f64 - hsm[cy * n + xl] as f64) / ((xr - xl) as f64 * cell);
        let gy = (hsm[yd * n + cx] as f64 - hsm[yu * n + cx] as f64) / ((yd - yu) as f64 * cell);
        let a_s = gy.atan2(gx) + PI / 2.0;
        let wr = 1.0 - smooth(d_road[ci] as f64, 110.0, 300.0);
        let ar = road_ang[ci] as f64 + PI / 2.0;
        let an = angle_noise.fbm(x / 700.0, y / 700.0, 2) * 2.4;
        let fx = (1.0 - wr) * (2.0 * an).cos() + wr * (2.0 * ar).cos();
        let fy = (1.0 - wr) * (2.0 * an).sin() + wr * (2.0 * ar).sin();
        let vx = ws * (2.0 * a_s).cos() + (1.0 - ws) * fx;
        let vy = ws * (2.0 * a_s).sin() + (1.0 - ws) * fy;
        vy.atan2(vx) / 2.0
    };
    let slope_at = |x: f64, y: f64| slope_l[idx(p(x, y), n, n, cell)] as f64;
    let strip_lod = input.strip_lod.as_ref().map(|v| {
        (
            serde::Deserialize::deserialize(&v["center"]).unwrap_or_default(),
            num(&v["radius"]),
        )
    });
    let lod = |p_: Point| {
        let (c, radius) = strip_lod.unwrap();
        dist(p_, c) < radius
    };
    let angle_sample = |x, y| angle_noise.noise(x, y);
    let mk_ctx = |closed| Context {
        dir: &dir,
        slope: &slope_at,
        closed,
        noise: &angle_sample,
        regular: planned,
        access: planned,
        min_area: None,
        strips_at: if input.strip_lod.is_some() {
            Some(&lod as &dyn Fn(Point) -> bool)
        } else {
            None
        },
    };
    let mut net = Net::default();
    for (k, r) in &horticulture {
        let mut plots = Net::default();
        let ctx = Context {
            min_area: Some(100.0),
            ..mk_ctx(true)
        };
        let mut rng = rr.fork(&format!("horticulture:{}:{}", r.outer[0].x, r.outer[0].y));
        fields::partition(r, &ctx, &mut rng, &mut plots);
        for fl in plots.furlongs {
            let mut a = Area::new(KINDS[*k as usize], fl.region);
            a.strip_angle = Some(fl.angle);
            areas.push(a);
        }
        net.headlands.extend(plots.headlands);
        net.ways.extend(plots.ways);
        for r in plots.margins {
            areas.push(Area::new("pasture", r));
        }
    }
    let mut field_area = 0.0;
    for r in &field_regions {
        field_area += region_area(r);
        fields::partition(r, &mk_ctx(false), &mut ft_rng, &mut net);
    }
    for r in &close_regions {
        field_area += region_area(r);
        fields::partition(r, &mk_ctx(true), &mut ft_rng, &mut net);
    }
    let mut connectors: Vec<_> = roads.iter().map(|r| (r.path.clone(), r.width)).collect();
    for f in &farmsteads {
        let drive = poly(&f["drive"]);
        if drive.len() >= 2
            && dist(drive[0], *drive.last().unwrap()) > 0.5
            && roads
                .iter()
                .any(|r| line_dist(drive[0], &r.path) <= r.width / 2.0 + 1.5)
        {
            connectors.push((drive, 3.0));
        }
    }
    for u in std::iter::once(urban).chain(secondary.iter().map(|st| &st["urban"])) {
        for st in arr(&u["streets"]) {
            if !["boundary", "wall-lane"].contains(&s(&st["role"])) && num(&st["width"]) > 0.0 {
                connectors.push((poly(&st["path"]), num(&st["width"])));
            }
        }
    }
    if planned {
        let protected_land: Vec<_> = cover_foot
            .iter()
            .chain(&field_regions)
            .chain(&close_regions)
            .chain(horticulture.iter().map(|(_, r)| r))
            .collect();
        let linked = fields::connect(
            &mut net,
            &connectors,
            240.0_f64.min(65.0_f64.max(2.5 * cell)),
            |a, b| {
                let box_ = bbox(&[a, b]);
                let near: Vec<_> = protected_land
                    .iter()
                    .copied()
                    .filter(|r| box_.meets(bbox(&r.outer)))
                    .collect();
                let steps = (dist(a, b) / 3.0_f64.min(cell / 2.0)).ceil().max(2.0) as usize;
                for k in 1..steps {
                    let p = lerp(a, b, k as f64 / steps as f64);
                    let i = idx(p, n, n, cell);
                    if input.water[i] != 0
                        || farm_mask[i] == 1
                        || input.slope[i] > 0.3
                        || near.iter().any(|r| inside(r, p))
                    {
                        return false;
                    }
                }
                true
            },
        );
        stats.insert("ways.linked".into(), linked as f64);
    }
    let (dropped, demoted) = fields::prune(&mut net, &connectors, 1.6 * cell + 20.0);
    stats.insert("ways.dropped".into(), dropped as f64);
    stats.insert("ways.demoted".into(), demoted as f64);
    if planned {
        net.headlands.clear();
    }
    if planned && !net.ways.is_empty() {
        let cuts: Vec<_> = net.ways.iter().map(|p| piece(ribbon(p, 4.4))).collect();
        let mut kept = vec![];
        for fl in net.furlongs {
            let box_ = bbox(&fl.region.outer);
            let near: Vec<_> = cuts
                .iter()
                .filter(|r| box_.meets(bbox(&r.outer)))
                .cloned()
                .collect();
            let pieces = if near.is_empty() {
                vec![fl.region.clone()]
            } else {
                bo::retain(&[fl.region.clone()], &near, &mut failures)
            };
            for r in pieces {
                let (u0, u1, v0, v1) = fields::extents(&r.outer, fl.angle.cos(), fl.angle.sin());
                let a = region_area(&r);
                if a < 1000.0 || a / (u1 - u0).max(v1 - v0).max(1.0) < 18.0 {
                    net.margins.push(r);
                } else {
                    kept.push(fields::Furlong {
                        region: r,
                        ..fl.clone()
                    });
                }
            }
        }
        net.furlongs = kept;
        let mut cleared = vec![];
        for a in areas {
            if !["garden", "orchard"].contains(&a.kind.as_str()) {
                cleared.push(a);
                continue;
            }
            let box_ = bbox(&a.poly);
            let near: Vec<_> = cuts
                .iter()
                .filter(|r| box_.meets(bbox(&r.outer)))
                .cloned()
                .collect();
            let pieces = if near.is_empty() {
                vec![a.region()]
            } else {
                bo::retain(&[a.region()], &near, &mut failures)
            };
            for r in pieces {
                cleared.push(Area {
                    poly: r.outer,
                    holes: r.holes,
                    ..a.clone()
                });
            }
        }
        areas = cleared;
    }
    if planned {
        field_area = net.furlongs.iter().map(|fl| region_area(&fl.region)).sum();
        for r in &net.margins {
            areas.push(Area::new("pasture", r.clone()));
        }
    }
    let (mut strip_count, mut furlong_count, mut close_count) = (0, 0, 0);
    let mut strip_rng = rr.fork("strips");
    for mut fl in net.furlongs {
        if fl.enclosed {
            close_count += 1;
            let c = centroid(&fl.region.outer);
            let ci = idx(c, n, n, cell);
            let pasture = if planned {
                slope_l[ci] as f64 > field_max * 0.9
                    || soil_at(c.x / cell - 0.5, c.y / cell - 0.5) < -0.2
                    || [7, 2].contains(&cls[ci])
            } else {
                ft_rng.chance(0.42)
            };
            let mut a = Area::new(if pasture { "pasture" } else { "field" }, fl.region);
            if !pasture {
                a.strip_angle = Some(fl.angle);
                if fl.parcel {
                    a.field_layout = Some("parcel".into());
                }
            }
            a.enclosed = true;
            if let Some(material) = pl["fieldMaterial"].as_str().filter(|&s| s != "hedge") {
                a.enclosure = Some(material.into());
            }
            areas.push(a);
            continue;
        }
        if planned {
            fields::cut_strips(&mut fl, &mut strip_rng, None);
        }
        strip_count += fl.strips.len();
        furlong_count += 1;
        let mut a = Area::new("field", fl.region);
        a.strip_angle = Some(fl.angle);
        a.strips = fl.strips;
        if fl.parcel {
            a.field_layout = Some("parcel".into());
        }
        areas.push(a);
    }
    if planned && !net.ways.is_empty() {
        let woods: Vec<_> = net
            .ways
            .iter()
            .map(|p| piece(ribbon(p, 5.0)))
            .filter(|r| r.outer.len() >= 3)
            .collect();
        let open: Vec<_> = net
            .ways
            .iter()
            .map(|p| piece(ribbon(p, 3.0)))
            .filter(|r| r.outer.len() >= 3)
            .collect();
        let mut cleared = vec![];
        for a in areas {
            if !["forest", "meadow", "pasture", "commons", "marsh"].contains(&a.kind.as_str()) {
                cleared.push(a);
                continue;
            }
            for r in bo::clear_roads(
                &[a.region()],
                if a.kind == "forest" { &woods } else { &open },
                &mut failures,
            ) {
                cleared.push(Area {
                    poly: r.outer,
                    holes: r.holes,
                    ..a.clone()
                });
            }
        }
        areas = cleared;
    }
    stats.insert("ms.lu.fields".into(), fields_clock.ms());
    let reserve_polys = if !foot.is_empty() {
        foot.into_iter().map(|r| r.outer).collect()
    } else {
        let ind = reserve
            .iter()
            .map(|&v| if v != 0 { 1.0 } else { 0.0 })
            .collect::<Vec<_>>();
        vectorize(
            &ind,
            n,
            n,
            cell,
            4000.0,
            Window {
                x0: 0,
                y0: 0,
                x1: n as isize - 1,
                y1: n as isize - 1,
            },
        )
        .into_iter()
        .map(|r| r.outer)
        .collect()
    };
    for (k, v) in [
        ("furlongs", furlong_count),
        ("closes", close_count),
        ("ways", net.ways.len()),
        ("strips", strip_count),
        ("areas", areas.len()),
        ("farmsteads", farmsteads.len()),
    ] {
        stats.insert(k.into(), v as f64);
    }
    stats.insert("fieldHa".into(), (field_area / 1e4 + 0.5).floor());
    stats.extend(counts);
    if failures > 0.0 {
        stats.insert("lu.cutFailures".into(), failures);
    }
    if clip_dropped > 0.0 {
        stats.insert("lu.clipDropped".into(), clip_dropped);
    }
    Ok(RuralOutput {
        layer: Layer {
            areas,
            farmsteads,
            reserve: reserve_polys,
            ways: Some(net.ways),
            headlands: Some(net.headlands),
            natural_ground,
            landscape_ground: Some(landscape_ground),
        },
        stats,
    })
}
