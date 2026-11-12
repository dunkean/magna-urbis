use super::hash::{HashMap, HashSet};
use super::{
    farms::{self, Context, LocalFarm},
    geom::*,
    raster::*,
    rural::{Road, Soil, plan, ring_scale},
    *,
};
use std::collections::BTreeMap;
#[derive(Clone, Copy)]
struct Place {
    o: Point,
    v: Point,
}
struct Planned {
    lf: LocalFarm,
    o: Point,
    v: Point,
}
#[derive(Clone, Copy)]
struct Nearest {
    d: f64,
    bp: Point,
    t: Point,
    w: f64,
}
struct Builder<'a> {
    input: &'a Input,
    soil: &'a Soil<'a>,
    pays: Noise,
    roads: &'a [Road],
    slope: &'a [f32],
    reserve: &'a [u8],
    u_dist: &'a [f32],
    lm: f64,
    lots: Vec<(Point, f64)>,
    farms: Vec<Value>,
    segments: Vec<(Point, Point, f64)>,
    buckets: HashMap<i32, Vec<usize>>,
    bw: i32,
}
impl Builder<'_> {
    fn cell_at(&self, p: Point) -> usize {
        idx(p, self.input.w, self.input.h, self.input.cell)
    }
    fn culture_at(&self, p: Point) -> String {
        let mut best = s(&self.input.options["culture"]);
        let mut bd = f64::INFINITY;
        for st in arr(&self.input.geometry["settlements"]) {
            if s(&st["detail"]) == "farmstead" {
                continue;
            }
            let c: Point = serde_json::from_value(st["center"].clone()).unwrap_or_default();
            let d = dist(p, c) / ring_scale(num(&st["population"]));
            if d < bd {
                bd = d;
                best = s(&st["culture"]);
            }
        }
        best.into()
    }
    fn context(&self, p: Point, culture: &str, pop: Option<f64>) -> Context {
        let input = self.input;
        let i = self.cell_at(p);
        let get = |x, y| sample(&input.height, input.w, input.h, input.cell, x, y);
        let g = 35.0;
        let hx = get(p.x + g, p.y) - get(p.x - g, p.y);
        let hy = get(p.x, p.y + g) - get(p.x, p.y - g);
        let gl = hx.hypot(hy);
        let mut mean = 0.0;
        for k in 0..8 {
            mean += get(
                p.x + 260.0 * (k as f64 * 0.785).cos(),
                p.y + 260.0 * (k as f64 * 0.785).sin(),
            );
        }
        let prom = get(p.x, p.y) - mean / 8.0;
        Context {
            culture: culture.into(),
            pop,
            biome: if input.biome == "underdark" {
                input.biome.clone()
            } else {
                String::new()
            },
            soil: self.soil.at(p.x, p.y),
            slope: self.slope[i] as f64,
            downhill: if gl / (2.0 * g) > 0.012 {
                Some(super::geom::p(-hx / gl, -hy / gl))
            } else {
                None
            },
            wet: ((5.0 - input.hab[i] as f64) / 3.5).clamp(0.0, 1.0)
                * ((450.0 - input.d_water[i] as f64) / 300.0).clamp(0.0, 1.0),
            exposed: (prom / 18.0
                + if input.sea_fraction > 0.02 && input.d_sea[i] < 350.0 {
                    0.35
                } else {
                    0.0
                })
            .clamp(0.0, 1.0),
            market: (self.u_dist[i] as f64 / (0.42 * self.lm)).clamp(0.0, 1.0),
            west: 0.5 - p.x / input.map_size + 0.35 * self.pays.fbm(p.x / 3000.0, p.y / 3000.0, 2),
            street_aligned_homes: false,
        }
    }
    fn nearest_road(&self, p: Point) -> Nearest {
        let mut nr = Nearest {
            d: f64::INFINITY,
            bp: p,
            t: super::geom::p(1.0, 0.0),
            w: 3.0,
        };
        for rd in self.roads {
            for ab in rd.path.windows(2) {
                let (a, b) = (ab[0], ab[1]);
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let l2 = dx * dx + dy * dy;
                let l2 = if l2 == 0.0 { 1.0 } else { l2 };
                let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0);
                let q = lerp(a, b, t);
                let dd = dist(q, p);
                if dd < nr.d {
                    nr = Nearest {
                        d: dd,
                        bp: q,
                        t: super::geom::p(dx / l2.sqrt(), dy / l2.sqrt()),
                        w: rd.width,
                    };
                }
            }
        }
        nr
    }
    fn lot_ok(&self, o: Point, v: Point, w: f64, d: f64, gap: f64) -> bool {
        let input = self.input;
        let u = p(v.y, -v.x);
        let point = |u_: f64, v_: f64| p(o.x + u_ * u.x + v_ * v.x, o.y + u_ * u.y + v_ * v.y);
        let c = point(0.0, d / 2.0);
        let rad = 0.5 * w.hypot(d);
        if input.biome == "desert" && input.d_water[self.cell_at(c)] > 350.0 {
            return false;
        }
        let s = input.map_size;
        if c.x - rad < 0.01 * s
            || c.y - rad < 0.01 * s
            || c.x + rad > 0.99 * s
            || c.y + rad > 0.99 * s
        {
            return false;
        }
        if self.lots.iter().any(|&(p, r)| dist(p, c) < r + rad + gap) {
            return false;
        }
        let step = 4.0_f64.min(0.45 * input.cell);
        let mut vv = 0.5;
        while vv <= d {
            let mut uu = -w / 2.0 + 0.5;
            while uu <= w / 2.0 {
                let i = self.cell_at(point(uu, vv));
                if input.water[i] != 0
                    || self.reserve[i] != 0
                    || (input.d_water[i] as f64) < input.cell
                {
                    return false;
                }
                uu += step;
            }
            vv += step;
        }
        let mut seen = HashSet::default();
        for y in ((c.y - rad - 20.0) / 200.0).floor() as i32
            ..=((c.y + rad + 20.0) / 200.0).floor() as i32
        {
            for x in ((c.x - rad - 20.0) / 200.0).floor() as i32
                ..=((c.x + rad + 20.0) / 200.0).floor() as i32
            {
                for &k in self.buckets.get(&(y * self.bw + x)).into_iter().flatten() {
                    if !seen.insert(k) {
                        continue;
                    }
                    let (a, b, pad) = self.segments[k];
                    let (ax, ay, bx, by) = (a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y);
                    if farms::seg_rect_dist(
                        p(ax * u.x + ay * u.y, ax * v.x + ay * v.y),
                        p(bx * u.x + by * u.y, bx * v.x + by * v.y),
                        -w / 2.0,
                        0.0,
                        w / 2.0,
                        d,
                    ) < pad
                    {
                        return false;
                    }
                }
            }
        }
        true
    }
    fn plan_on(
        &self,
        mut ctx: Context,
        mut r: Rng,
        places: impl Fn(f64) -> Vec<Place>,
        gap: f64,
    ) -> Option<Planned> {
        let pl = plan(self.input);
        let size = if yes(&pl["denserSmallholdings"]) && ctx.market < 0.45 {
            0
        } else {
            farms::size(&ctx, &mut r)
        };
        let initial = places(0.0);
        if yes(&pl["streetAlignedHomes"])
            && initial
                .first()
                .is_some_and(|q| self.nearest_road(q.o).d < 100.0)
        {
            ctx.street_aligned_homes = true;
        }
        let t = farms::farm_type(&ctx, size, &mut r);
        for si in (0..=size).rev() {
            let lr = r.fork(&format!("plan{si}"));
            for (k, q) in initial.iter().enumerate() {
                let lf = farms::layout(
                    &t,
                    si,
                    &ctx,
                    farms::frame(q.v, ctx.downhill),
                    lr.fork(&format!("l{k}")),
                );
                let q = places(lf.d)[k];
                if self.lot_ok(q.o, q.v, lf.w, lf.d, gap) {
                    return Some(Planned { lf, o: q.o, v: q.v });
                }
            }
        }
        None
    }
    fn accept(&mut self, pl: Planned, culture: &str, bp: Option<Point>) {
        let input = self.input;
        let mut g = farms::place(&pl.lf, pl.o, pl.v);
        let c = p(
            pl.o.x + pl.v.x * pl.lf.d / 2.0,
            pl.o.y + pl.v.y * pl.lf.d / 2.0,
        );
        let key = format!("{},{}", (c.x + 0.5).floor(), (c.y + 0.5).floor());
        if !Rng::new(&input.seed)
            .fork("outbuildings")
            .fork(&key)
            .chance(plan(input)["outbuildings"].as_f64().unwrap_or(0.5))
            && arr(&g["parts"]).len() > 1
        {
            let parts = arr(&g["parts"]);
            let mut main = &parts[0];
            for b in parts {
                if area(&poly(&b["poly"])).abs() > area(&poly(&main["poly"])).abs() {
                    main = b;
                }
            }
            let houses: Vec<_> = parts
                .iter()
                .filter(|p| s(&p["use"]) == "house")
                .cloned()
                .collect();
            g["parts"] = if houses.is_empty() {
                Value::Array(vec![main.clone()])
            } else {
                Value::Array(houses)
            };
        }
        self.lots.push((c, 0.5 * pl.lf.w.hypot(pl.lf.d)));
        let gate: Point = serde_json::from_value(g["gate"].clone()).unwrap_or_default();
        g["pos"] = serde_json::to_value(c).unwrap();
        g["buildings"] = Value::Array(arr(&g["parts"]).iter().map(|p| p["poly"].clone()).collect());
        g["drive"] = serde_json::to_value(if let Some(bp) = bp {
            vec![bp, gate]
        } else {
            vec![gate, gate]
        })
        .unwrap();
        g["type"] = pl.lf.type_.clone().into();
        g["size"] = farms::SIZES[pl.lf.size].into();
        g["culture"] = culture.into();
        g["tags"] = serde_json::to_value(&pl.lf.tags).unwrap();
        if pl.lf.tags.iter().any(|t| t == "fungal-cultivation") {
            g["cultivation"] = "fungal".into();
        }
        self.farms.push(g);
    }
}
#[allow(clippy::too_many_arguments)]
fn new_builder<'a>(
    input: &'a Input,
    rr: &Rng,
    soil: &'a Soil<'a>,
    roads: &'a [Road],
    slope: &'a [f32],
    reserve: &'a [u8],
    u_dist: &'a [f32],
    lm: f64,
) -> Builder<'a> {
    let s_map = input.map_size;
    let mut build = Builder {
        input,
        soil,
        pays: Noise::new(rr.fork("pays")),
        roads,
        slope,
        reserve,
        u_dist,
        lm,
        lots: vec![],
        farms: vec![],
        segments: vec![],
        buckets: HashMap::default(),
        bw: (s_map / 200.0).ceil() as i32 + 1,
    };
    let mut add = |a: Point, b: Point, pad: f64| {
        let id = build.segments.len();
        build.segments.push((a, b, pad));
        let box_ = bbox(&[a, b]);
        for y in (box_.y0 / 200.0).floor() as i32..=(box_.y1 / 200.0).floor() as i32 {
            for x in (box_.x0 / 200.0).floor() as i32..=(box_.x1 / 200.0).floor() as i32 {
                build.buckets.entry(y * build.bw + x).or_default().push(id);
            }
        }
    };
    for rd in roads {
        for ab in rd.path.windows(2) {
            add(ab[0], ab[1], rd.width / 2.0 + 1.5);
        }
    }
    for rv in arr(&input.geometry["terrain"]["rivers"]) {
        let path = poly(&rv["path"]);
        for i in 1..path.len() {
            add(
                path[i - 1],
                path[i],
                rv["width"][i - 1]
                    .as_f64()
                    .unwrap_or(2.0)
                    .max(rv["width"][i].as_f64().unwrap_or(2.0))
                    / 2.0
                    + 3.0,
            );
        }
    }
    build
}
/// Farmsteads for cultivated land that no existing farmer reaches: one farm per site, laid out
/// like the other farms and given a drive to the nearest road when one is within walking range.
#[allow(clippy::too_many_arguments)]
pub(crate) fn add_for_demand<'a>(
    input: &'a Input,
    rr: &Rng,
    soil: &'a Soil<'a>,
    roads: &'a [Road],
    slope: &'a [f32],
    reserve: &'a [u8],
    u_dist: &'a [f32],
    lm: f64,
    existing: &[Value],
    sites: &[Point],
) -> Vec<Value> {
    let mut build = new_builder(input, rr, soil, roads, slope, reserve, u_dist, lm);
    for f in existing {
        if let Ok(c) = serde_json::from_value::<Point>(f["pos"].clone()) {
            build.lots.push((c, 30.0));
        }
    }
    let fr = rr.fork("demand-farm");
    for (k, &c) in sites.iter().enumerate() {
        let nr = build.nearest_road(c);
        let culture = build.culture_at(c);
        let ctx = build.context(c, &culture, None);
        let d0 = if nr.d > 1.0 {
            p((c.x - nr.bp.x) / nr.d, (c.y - nr.bp.y) / nr.d)
        } else {
            ctx.downhill.unwrap_or(p(0.0, 1.0))
        };
        let places = |d: f64| {
            [(1.0, 0.0), (0.0, 1.0), (0.0, -1.0), (-1.0, 0.0)]
                .iter()
                .map(|&(cx, cy)| {
                    let v = p(d0.x * cx - d0.y * cy, d0.x * cy + d0.y * cx);
                    Place {
                        o: p(c.x - v.x * d / 2.0, c.y - v.y * d / 2.0),
                        v,
                    }
                })
                .collect::<Vec<_>>()
        };
        if let Some(pl) = build.plan_on(ctx, fr.fork(&format!("d{k}")), places, 12.0) {
            build.accept(pl, &culture, (nr.d < 1500.0).then_some(nr.bp));
        }
    }
    build.farms
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn generate<'a>(
    input: &'a Input,
    rr: &Rng,
    soil: &'a Soil<'a>,
    roads: &'a [Road],
    slope: &'a [f32],
    reserve: &'a [u8],
    u_dist: &'a [f32],
    lm: f64,
    pasture_max: f64,
    stats: &mut BTreeMap<String, f64>,
) -> (Vec<Value>, Vec<u8>) {
    let n = input.w;
    let cell = input.cell;
    let total = n * n;
    let s_map = input.map_size;
    let pl = plan(input);
    let mut build = new_builder(input, rr, soil, roads, slope, reserve, u_dist, lm);
    let enabled = pl["farmsteads"].as_bool() != Some(false);
    let root = Rng::new(&input.seed);
    if enabled {
        for st in arr(&input.geometry["settlements"]) {
            if yes(&st["main"]) || s(&st["detail"]) != "farmstead" {
                continue;
            }
            let fr = root
                .fork(&format!("settlement:{}", s(&st["key"])))
                .fork("farm");
            let center: Point = serde_json::from_value(st["center"].clone()).unwrap_or_default();
            let nr = build.nearest_road(center);
            let ctx = build.context(center, s(&st["culture"]), Some(num(&st["population"])));
            let side_first = if fr.clone().chance(0.5) { 1.0 } else { -1.0 };
            let mut fr = fr;
            fr.chance(0.5);
            let d0 = if nr.d > 1.0 {
                p((center.x - nr.bp.x) / nr.d, (center.y - nr.bp.y) / nr.d)
            } else {
                p(0.0, 1.0)
            };
            let places = |d: f64| {
                let mut out = vec![];
                if nr.d < 60.0 {
                    for sd in [side_first, -side_first] {
                        let v = p(-nr.t.y * sd, nr.t.x * sd);
                        out.push(Place {
                            o: p(
                                nr.bp.x + v.x * (nr.w / 2.0 + 3.0),
                                nr.bp.y + v.y * (nr.w / 2.0 + 3.0),
                            ),
                            v,
                        });
                    }
                }
                let rotations = if yes(&pl["streetAlignedHomes"]) && nr.d < 100.0 {
                    vec![(1.0, 0.0)]
                } else {
                    vec![(1.0, 0.0), (0.0, 1.0), (0.0, -1.0), (-1.0, 0.0)]
                };
                for (cx, cy) in rotations {
                    let v = p(d0.x * cx - d0.y * cy, d0.x * cy + d0.y * cx);
                    out.push(Place {
                        o: p(center.x - v.x * d / 2.0, center.y - v.y * d / 2.0),
                        v,
                    });
                }
                out
            };
            let mut farm = build.plan_on(ctx.clone(), fr.clone(), places, 12.0);
            if farm.as_ref().is_some_and(|q| {
                dist(
                    p(q.o.x + q.v.x * q.lf.d / 2.0, q.o.y + q.v.y * q.lf.d / 2.0),
                    center,
                ) > 75.0
            }) {
                farm = None;
            }
            if farm.is_none() {
                *stats.entry("farm.forced".into()).or_insert(0.0) += 1.0;
                let forced = if input.biome == "underdark" {
                    if ctx.culture == "myconid-colony" {
                        "spore-farm"
                    } else {
                        "fungal-farm"
                    }
                } else {
                    "l-yard"
                };
                let mut ctx = ctx;
                if yes(&pl["streetAlignedHomes"]) && nr.d < 100.0 {
                    ctx.street_aligned_homes = true;
                }
                let lf = farms::layout(
                    forced,
                    0,
                    &ctx,
                    farms::frame(d0, ctx.downhill),
                    fr.fork("forced"),
                );
                let o = p(center.x - d0.x * lf.d / 2.0, center.y - d0.y * lf.d / 2.0);
                farm = Some(Planned { lf, o, v: d0 });
            }
            build.accept(
                farm.unwrap(),
                s(&st["culture"]),
                if nr.d < 400.0 { Some(nr.bp) } else { None },
            );
        }
    }
    let custom = !input.options["mapSize"].is_null();
    let denser = yes(&pl["denserSmallholdings"]);
    let rds = if custom || input.main_roads.is_none() {
        roads
    } else {
        &roads[..input.main_roads.unwrap().min(roads.len())]
    };
    let size = s(&input.options["size"]);
    let main_culture = s(&input.options["culture"]);
    if enabled {
        let base = match size {
            "hamlet" => 0.0,
            "village" => 2.0,
            "town" => 4.0,
            "city" => 7.0,
            "metropolis" => 10.0,
            _ => 0.0,
        };
        let farm_count = ((base
            + if custom {
                90.0_f64.min((0.2 * (s_map / 1000.0).powi(2) + 0.5).floor())
            } else {
                0.0
            })
            * if denser { 3.0 } else { 1.0 }
            * num(&farms::culture(main_culture)["density"])
            + 0.5)
            .floor() as usize;
        let mut fr = rr.fork("farm");
        let mut cand = vec![];
        for rd in rds {
            if rd.kind == "track" && !custom {
                continue;
            }
            let mut path = vec![];
            if denser {
                for (i, &a) in rd.path.iter().enumerate() {
                    if i == 0 {
                        path.push(a);
                        continue;
                    }
                    let b = rd.path[i - 1];
                    let count = (dist(a, b) / 45.0).ceil().max(1.0) as usize;
                    for j in 0..count {
                        path.push(lerp(b, a, (j + 1) as f64 / count as f64));
                    }
                }
            } else {
                path = rd.path.clone();
            }
            let mut acc = 0.0;
            for ab in path.windows(2) {
                let (a, b) = (ab[0], ab[1]);
                let l = dist(a, b);
                acc += l;
                if acc < 50.0 {
                    continue;
                }
                acc = 0.0;
                let t = p(
                    (b.x - a.x) / if l == 0.0 { 1.0 } else { l },
                    (b.y - a.y) / if l == 0.0 { 1.0 } else { l },
                );
                let side = if fr.chance(0.5) { 1.0 } else { -1.0 };
                let v = p(-t.y * side, t.x * side);
                let o = p(
                    b.x + v.x * (rd.width / 2.0 + 3.0),
                    b.y + v.y * (rd.width / 2.0 + 3.0),
                );
                let pp = p(o.x + v.x * 25.0, o.y + v.y * 25.0);
                if pp.x < 0.06 * s_map
                    || pp.y < 0.06 * s_map
                    || pp.x > 0.94 * s_map
                    || pp.y > 0.94 * s_map
                {
                    continue;
                }
                let i = build.cell_at(pp);
                if input.water[i] != 0
                    || input.d_water[i] < 40.0
                    || input.hab[i] < 0.8
                    || (slope[i] as f64) > pasture_max
                    || reserve[i] != 0
                    || (u_dist[i] as f64)
                        < if denser {
                            0.025
                        } else if custom {
                            0.07
                        } else {
                            0.1
                        } * lm
                    || u_dist[i] as f64 > 0.42 * lm
                {
                    continue;
                }
                cand.push((
                    Place { o, v },
                    fr.float()
                        + if denser {
                            2.0 * (1.0 - (u_dist[i] as f64 / (0.42 * lm)).min(1.0))
                        } else {
                            0.0
                        },
                ));
            }
        }
        cand.sort_by(|a, b| b.1.total_cmp(&a.1));
        let min_sp = if denser {
            65.0_f64.max(0.035 * lm)
        } else if custom {
            200.0_f64.max(0.09 * lm)
        } else {
            0.13 * lm
        };
        let mut made = 0;
        for (c, _) in cand {
            if made >= farm_count {
                break;
            }
            if build.lots.iter().any(|&(p, _)| dist(p, c.o) < min_sp) {
                continue;
            }
            let p = p(c.o.x + c.v.x * 25.0, c.o.y + c.v.y * 25.0);
            let culture = build.culture_at(p);
            let ctx = build.context(p, &culture, None);
            let Some(pl) = build.plan_on(ctx, fr.fork(&format!("f{made}")), |_| vec![c], 12.0)
            else {
                continue;
            };
            let g = farms::place(&pl.lf, pl.o, pl.v);
            let gate = serde_json::from_value(g["gate"].clone()).unwrap_or_default();
            let nr = build.nearest_road(gate);
            build.accept(pl, &culture, Some(nr.bp));
            made += 1;
        }
    }
    if enabled {
        let base = match size {
            "hamlet" => 0.0,
            "village" | "town" => 1.0,
            "city" => 2.0,
            "metropolis" => 3.0,
            _ => 1.0,
        };
        let want = ((base
            + if custom {
                30.0_f64.min((0.05 * (s_map / 1000.0).powi(2) + 0.5).floor())
            } else {
                0.0
            })
            * num(&farms::culture(main_culture)["density"])
            + 0.5)
            .floor() as usize;
        let mut hr = rr.fork("hamlet");
        let mut sites = vec![];
        for rd in rds {
            if rd.kind == "track" && !custom {
                continue;
            }
            for i in (1..rd.path.len()).step_by(2) {
                let (a, b) = (rd.path[i - 1], rd.path[i]);
                let l = dist(a, b);
                if l < 1.0 {
                    continue;
                }
                let side = if hr.chance(0.5) { 1.0 } else { -1.0 };
                let v = p(-(b.y - a.y) / l * side, (b.x - a.x) / l * side);
                let pp = p(b.x + v.x * 80.0, b.y + v.y * 80.0);
                if pp.x < 0.08 * s_map
                    || pp.y < 0.08 * s_map
                    || pp.x > 0.92 * s_map
                    || pp.y > 0.92 * s_map
                {
                    continue;
                }
                let i = build.cell_at(pp);
                if input.water[i] != 0
                    || input.d_water[i] < 40.0
                    || input.hab[i] < 0.8
                    || (slope[i] as f64) > pasture_max
                    || reserve[i] != 0
                    || (u_dist[i] as f64) < 0.18 * lm
                    || u_dist[i] as f64 > 0.45 * lm
                {
                    continue;
                }
                sites.push((b, v, rd.width, hr.float()));
            }
        }
        sites.sort_by(|a, b| b.3.total_cmp(&a.3));
        let mut made = 0;
        for (o, norm, width, _) in sites {
            if made >= want {
                break;
            }
            if build
                .lots
                .iter()
                .any(|&(p, _)| dist(p, o) < 160.0_f64.max(0.1 * lm))
            {
                continue;
            }
            let culture = build.culture_at(p(o.x + norm.x * 80.0, o.y + norm.y * 80.0));
            let range = &farms::culture(&culture)["hamlet"];
            let count = hr.int(num(&range[0]) as u32, num(&range[1]) as u32) as usize;
            let before = build.farms.len();
            let lots_before = build.lots.len();
            let mut last = None;
            let mut last_q = o;
            let mut along = width / 2.0 + 14.0;
            while build.farms.len() - before < count && along < 320.0 {
                for sd in [1.0, -1.0] {
                    if build.farms.len() - before >= count {
                        break;
                    }
                    let q = p(o.x + norm.x * along, o.y + norm.y * along);
                    let v = p(norm.y * sd, -norm.x * sd);
                    let oo = p(q.x + v.x * 3.5, q.y + v.y * 3.5);
                    let ctx = build.context(oo, &culture, Some(6.0));
                    let fr = hr.fork(&format!("h{made}:{along}:{sd}"));
                    let Some(pl) = build.plan_on(ctx, fr, |_| vec![Place { o: oo, v }], 2.0) else {
                        continue;
                    };
                    build.accept(pl, &culture, Some(q));
                    last = Some(build.farms.len() - 1);
                    last_q = q;
                }
                along += 9.0;
            }
            if build.farms.len() - before < count.min(3) {
                build.farms.truncate(before);
                build.lots.truncate(lots_before);
                continue;
            }
            if let Some(last) = last {
                let mut drive = vec![o, last_q];
                drive.extend(poly(&build.farms[last]["drive"]).into_iter().skip(1));
                build.farms[last]["drive"] = serde_json::to_value(drive).unwrap();
            }
            for k in before..build.farms.len() {
                let mut tags = arr(&build.farms[k]["tags"]).to_vec();
                tags.push("hamlet".into());
                build.farms[k]["tags"] = tags.into();
            }
            made += 1;
        }
        stats.insert("farm.hamlets".into(), made as f64);
    }
    for f in &build.farms {
        *stats
            .entry(format!("farm.{}", s(&f["type"])))
            .or_insert(0.0) += 1.0;
    }
    let mut mask = vec![0_u8; total];
    if !build.farms.is_empty() {
        let lots: Vec<_> = build.farms.iter().map(|f| poly(&f["lot"])).collect();
        rasterize(&lots, n, n, cell, &mut mask);
        for fm in &build.farms {
            let ring = closed(&poly(&fm["lot"]));
            near_line(&ring, n, n, cell, 0.75 * cell, |i| mask[i] = 1);
            near_line(&ring, n, n, cell, 40.0, |i| {
                if mask[i] == 0 {
                    mask[i] = 2;
                }
            });
            let drive = poly(&fm["drive"]);
            if drive
                .first()
                .zip(drive.last())
                .is_some_and(|(&a, &b)| dist(a, b) > 0.5)
            {
                near_line(&drive, n, n, cell, 3.0 + 0.75 * cell, |i| mask[i] = 1);
            }
        }
    }
    (build.farms, mask)
}
