//! Replays one captured /landuse request and measures how far its cultivated land lies from the
//! people who farm it. Run from the repository root:
//!   cargo run -p magna-urbis-core --example landuse_reach -- <capture.bin> [more.bin ...]
//! Prints fieldHa, population and the share of field area beyond 1.5 / 2 / 3 km of the nearest
//! farmstead or settlement (field areas sampled on a 100 m grid, 1 sample = 1 ha).
use magna_urbis_core::landuse;
use serde_json::Value;
use std::fs;

fn pt(v: &Value) -> Option<(f64, f64)> {
    match v {
        Value::Object(o) => Some((o.get("x")?.as_f64()?, o.get("y")?.as_f64()?)),
        Value::Array(a) if a.len() == 2 => Some((a[0].as_f64()?, a[1].as_f64()?)),
        _ => None,
    }
}
fn ring(v: &Value) -> Vec<(f64, f64)> {
    v.as_array().map(|a| a.iter().filter_map(pt).collect()).unwrap_or_default()
}
fn inside(r: &[(f64, f64)], x: f64, y: f64) -> bool {
    let mut c = false;
    let mut j = r.len().wrapping_sub(1);
    for i in 0..r.len() {
        let (a, b) = (r[i], r[j]);
        if (a.1 > y) != (b.1 > y) && x < (b.0 - a.0) * (y - a.1) / (b.1 - a.1) + a.0 {
            c = !c;
        }
        j = i;
    }
    c
}

fn main() {
    for path in std::env::args().skip(1) {
        let b = fs::read(&path).unwrap();
        let n = u32::from_le_bytes(b[..4].try_into().unwrap()) as usize;
        let header = String::from_utf8(b[4..4 + n].to_vec()).unwrap();
        let req: Value = serde_json::from_str(header.trim_end()).unwrap();
        if req["operation"] != "rural" {
            println!("{path}: operation {} skipped", req["operation"]);
            continue;
        }
        let reply = landuse::wire::execute(&header, &b[4 + n..]).unwrap();
        let out = landuse::wire::decode_reply(&reply).unwrap();
        // Workers: settlements (centre, radius) and farmsteads (position).
        let mut workers: Vec<(f64, f64, f64)> = vec![];
        let mut pop = 0.0;
        let g = &req["geometry"];
        let plan_pop = req["plan"]["population"].as_f64();
        if let Some(c) = pt(&g["site"]["center"]) {
            workers.push((c.0, c.1, g["site"]["reserveRadius"].as_f64().unwrap_or(0.0)));
        }
        for st in g["settlements"].as_array().into_iter().flatten() {
            let p = st["population"].as_f64().unwrap_or(0.0);
            pop += p;
            if let Some(c) = pt(&st["center"]) {
                workers.push((c.0, c.1, st["radius"].as_f64().unwrap_or(0.0)));
            }
            println!(
                "  settlement {} main={} detail={} pop={p} center={:?}",
                st["key"], st["main"], st["detail"], pt(&st["center"])
            );
        }
        let farms = out["layer"]["farmsteads"].as_array().cloned().unwrap_or_default();
        let farm_n = workers.len();
        for f in &farms {
            if let Some(c) = pt(&f["pos"]) {
                workers.push((c.0, c.1, 0.0));
            }
        }
        let (mut ha, mut far15, mut far2, mut far3, mut max_d) = (0.0, 0.0, 0.0, 0.0, 0.0_f64);
        let mut far_centroid = (0.0, 0.0);
        let mut by_kind = std::collections::BTreeMap::<String, f64>::new();
        for a in out["layer"]["areas"].as_array().into_iter().flatten() {
            let kind = a["kind"].as_str().unwrap_or("");
            let outer = ring(&a["poly"]);
            if outer.len() < 3 {
                continue;
            }
            let holes: Vec<_> = a["holes"].as_array().into_iter().flatten().map(ring).collect();
            let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for &(x, y) in &outer {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
            let mut y = (y0 / 100.0).floor() * 100.0 + 50.0;
            while y < y1 {
                let mut x = (x0 / 100.0).floor() * 100.0 + 50.0;
                while x < x1 {
                    if inside(&outer, x, y) && !holes.iter().any(|h| inside(h, x, y)) {
                        *by_kind.entry(kind.to_string()).or_default() += 1.0;
                        if kind == "field" {
                            ha += 1.0;
                            let d = workers
                                .iter()
                                .map(|w| ((x - w.0).hypot(y - w.1) - w.2).max(0.0))
                                .fold(f64::MAX, f64::min);
                            max_d = max_d.max(d);
                            if d > 1500.0 {
                                far15 += 1.0;
                            }
                            if d > 2000.0 {
                                far2 += 1.0;
                                far_centroid.0 += x;
                                far_centroid.1 += y;
                            }
                            if d > 3000.0 {
                                far3 += 1.0;
                            }
                        }
                    }
                    x += 100.0;
                }
                y += 100.0;
            }
        }
        let st = &out["stats"];
        println!(
            "{path}: mapSize={} planPop={plan_pop:?} settlementsPop={pop} settlements={} farmsteads={} fieldHa={} sampledFieldHa={ha} haPerHead={:.2}",
            req["mapSize"],
            farm_n,
            farms.len(),
            st["fieldHa"],
            ha / plan_pop.unwrap_or(pop).max(1.0)
        );
        println!(
            "  field beyond 1.5km={:.1}% 2km={:.1}% 3km={:.1}% max={:.0}m farCentroid=({:.0},{:.0}) kinds(ha)={by_kind:?}",
            100.0 * far15 / ha.max(1.0),
            100.0 * far2 / ha.max(1.0),
            100.0 * far3 / ha.max(1.0),
            max_d,
            far_centroid.0 / far2.max(1.0),
            far_centroid.1 / far2.max(1.0)
        );
        let keys: Vec<_> = st
            .as_object()
            .map(|o| o.iter().filter(|(k, _)| !k.starts_with("ms.")).map(|(k, v)| format!("{k}={v}")).collect())
            .unwrap_or_default();
        println!("  stats {}", keys.join(" "));
    }
}
