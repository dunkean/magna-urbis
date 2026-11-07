//! Small standalone kernels used by geometry regressions and interactive diagnostics.
use super::{
    farms::{self, Frame, LocalFarm, Part, Plot},
    fields::{self, Furlong, Net},
    geom::*,
    raster::*,
    *,
};
use serde_json::json;
fn net(v: &Value) -> Net {
    Net {
        furlongs: arr(&v["furlongs"])
            .iter()
            .map(|v| Furlong {
                region: Region {
                    outer: poly(&v["outer"]),
                    holes: arr(&v["holes"]).iter().map(poly).collect(),
                },
                angle: num(&v["angle"]),
                enclosed: yes(&v["enclosed"]),
                strips: arr(&v["strips"]).iter().map(poly).collect(),
                strip_w: num(&v["stripW"]),
                parcel: s(&v["layout"]) == "parcel",
            })
            .collect(),
        ways: arr(&v["ways"]).iter().map(poly).collect(),
        headlands: arr(&v["headlands"]).iter().map(poly).collect(),
        margins: regions(&v["margins"]),
    }
}
fn net_value(n: Net) -> Value {
    json!({"furlongs":n.furlongs.into_iter().map(|fl|{let mut v=json!({"outer":fl.region.outer,"holes":fl.region.holes,"angle":fl.angle,"enclosed":fl.enclosed,"stripW":fl.strip_w});if !fl.strips.is_empty(){v["strips"]=json!(fl.strips);}if fl.parcel{v["layout"]="parcel".into();}v}).collect::<Vec<_>>(),"ways":n.ways,"headlands":n.headlands,"margins":n.margins})
}
pub fn field_tool(
    request: &str,
    dir: &dyn Fn(f64, f64) -> f64,
    slope: &dyn Fn(f64, f64) -> f64,
    strips: &dyn Fn(f64, f64) -> f64,
    clear: &dyn Fn(Point, Point) -> bool,
    noise: &dyn Fn(f64, f64) -> f64,
    random: &mut impl fields::FieldRandom,
) -> Result<String, String> {
    let v: Value = serde_json::from_str(request).map_err(|e| e.to_string())?;
    let mut n = net(&v["net"]);
    let connectors: Vec<_> = arr(&v["connectors"])
        .iter()
        .map(|v| (poly(&v["path"]), num(&v["width"])))
        .collect();
    let mut result = Value::Null;
    match s(&v["operation"]) {
        "partition" => {
            let strips = |p: Point| strips(p.x, p.y) != 0.0;
            let ctx = fields::Context {
                dir,
                slope,
                closed: yes(&v["closed"]),
                noise,
                regular: yes(&v["regular"]),
                access: yes(&v["accessWays"]),
                min_area: v["minArea"].as_f64(),
                strips_at: if yes(&v["hasStripsAt"]) {
                    Some(&strips)
                } else {
                    None
                },
            };
            fields::partition(
                &Region {
                    outer: poly(&v["outer"]),
                    holes: arr(&v["holes"]).iter().map(poly).collect(),
                },
                &ctx,
                random,
                &mut n,
            );
        }
        "clip" => {
            result = json!(fields::clip_line(
                &poly(&v["path"]),
                &Region {
                    outer: poly(&v["outer"]),
                    holes: arr(&v["holes"]).iter().map(poly).collect()
                }
            ));
        }
        "prune" => {
            let (a, b) = fields::prune(&mut n, &connectors, v["tol"].as_f64().unwrap_or(12.0));
            result = json!({"dropped":a,"demoted":b});
        }
        "connect" => {
            result = json!(fields::connect(
                &mut n,
                &connectors,
                num(&v["reach"]),
                clear
            ));
        }
        _ => return Err("Unknown field tool".into()),
    }
    serde_json::to_string(&json!({"net":net_value(n),"result":result})).map_err(|e| e.to_string())
}
fn vpoint(v: &Value) -> Point {
    p(num(&v[0]), num(&v[1]))
}
fn vpoly(v: &Value) -> Polygon {
    arr(v).iter().map(vpoint).collect()
}
fn pairs(a: &[Point]) -> Value {
    json!(a.iter().map(|p| [p.x, p.y]).collect::<Vec<_>>())
}
fn parse_frame(v: &Value) -> Frame {
    Frame {
        south: vpoint(&v["south"]),
        west: vpoint(&v["west"]),
        down: if v["down"].is_array() {
            Some(vpoint(&v["down"]))
        } else {
            None
        },
    }
}
fn local_value(l: LocalFarm) -> Value {
    json!({"type":l.type_,"size":farms::SIZES[l.size],"W":l.w,"D":l.d,"parts":l.parts.iter().map(|p|{let mut v=json!({"use":p.use_,"poly":pairs(&p.poly)});if p.passage{v["passage"]=true.into();}if p.round{v["round"]=true.into();}v}).collect::<Vec<_>>(),"yard":pairs(&l.yard),"walls":l.walls.iter().map(|p|pairs(p)).collect::<Vec<_>>(),"plots":l.plots.iter().map(|p|json!({"kind":p.kind,"poly":pairs(&p.poly)})).collect::<Vec<_>>(),"trees":pairs(&l.trees),"gateU":l.gate_u,"entry":[l.entry.x,l.entry.y],"tags":l.tags})
}
fn parse_local(v: &Value) -> Result<LocalFarm, String> {
    Ok(LocalFarm {
        type_: s(&v["type"]).into(),
        size: farms::SIZES
            .iter()
            .position(|&s_| s_ == s(&v["size"]))
            .ok_or("Invalid farm size")?,
        w: num(&v["W"]),
        d: num(&v["D"]),
        parts: arr(&v["parts"])
            .iter()
            .map(|v| Part {
                use_: s(&v["use"]).into(),
                poly: vpoly(&v["poly"]),
                passage: yes(&v["passage"]),
                round: yes(&v["round"]),
            })
            .collect(),
        yard: vpoly(&v["yard"]),
        walls: arr(&v["walls"]).iter().map(vpoly).collect(),
        plots: arr(&v["plots"])
            .iter()
            .map(|v| Plot {
                kind: s(&v["kind"]).into(),
                poly: vpoly(&v["poly"]),
            })
            .collect(),
        trees: vpoly(&v["trees"]),
        gate_u: num(&v["gateU"]),
        entry: vpoint(&v["entry"]),
        tags: arr(&v["tags"]).iter().map(|v| s(v).into()).collect(),
    })
}
pub fn farm_tool(request: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(request).map_err(|e| e.to_string())?;
    let point = |v: &Value| serde_json::from_value::<Point>(v.clone()).map_err(|e| e.to_string());
    let result = match s(&v["operation"]) {
        "regime" => farms::culture(s(&v["culture"]))["types"].clone(),
        "frame" => {
            let f = farms::frame(
                point(&v["inward"])?,
                if v["downhill"].is_object() {
                    Some(point(&v["downhill"])?)
                } else {
                    None
                },
            );
            json!({"south":[f.south.x,f.south.y],"west":[f.west.x,f.west.y],"down":f.down.map(|p|[p.x,p.y])})
        }
        "place" => {
            let mut local = parse_local(&v["local"])?;
            local.type_ = s(&v["type"]).into();
            farms::place(&local, point(&v["origin"])?, point(&v["inward"])?)
        }
        "type" | "layout" => {
            let ctx: farms::Context =
                serde_json::from_value(v["context"].clone()).map_err(|e| e.to_string())?;
            let si = farms::SIZES
                .iter()
                .position(|&s_| s_ == s(&v["size"]))
                .ok_or("Invalid farm size")?;
            let mut r = Rng::new(s(&v["seed"]));
            if s(&v["operation"]) == "type" {
                json!(farms::farm_type(&ctx, si, &mut r))
            } else {
                local_value(farms::layout(
                    s(&v["type"]),
                    si,
                    &ctx,
                    parse_frame(&v["frame"]),
                    r,
                ))
            }
        }
        _ => return Err("Unknown farm tool".into()),
    };
    serde_json::to_string(&result).map_err(|e| e.to_string())
}
pub fn growth_reserve(
    base: &[u8],
    n: usize,
    cell: f64,
    footprints: &str,
) -> Result<Vec<u8>, String> {
    if n.checked_mul(n) != Some(base.len()) || !cell.is_finite() || cell <= 0.0 {
        return Err("Invalid farm reserve raster".into());
    }
    let a: Vec<Vec<Region>> = serde_json::from_str(footprints).map_err(|e| e.to_string())?;
    let mut out = base.to_vec();
    for r in a.into_iter().flatten() {
        for ring in std::iter::once(r.outer).chain(r.holes) {
            if ring.len() >= 3 {
                near_line(
                    &closed(&ring),
                    n,
                    n,
                    cell,
                    21.0 + std::f64::consts::SQRT_2 * cell,
                    |i| out[i] = 1,
                );
            }
        }
    }
    Ok(out)
}
