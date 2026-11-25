//! Slope limits and footing records for procedural buildings.

use super::*;

/// How a lot's buildings take sloping ground: the way (`plinth` | `terrace` |
/// `stilts`) and the largest drop (m) across a home that way takes before the
/// home is turned along the contour or made shallower.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::urban) struct Hillside {
    pub way: &'static str,
    pub max_drop_m: f64,
}

/// Masonry on a stepped plinth takes 2.5 m, light walls (timber, wood, bamboo,
/// wattle, hide) 1.5 m, stilts and terraces with their retaining wall 4 m. The
/// culture's `traits.hillside` names its way (terracing peoples) and may set
/// its own drop; pile cultures stand on stilts.
pub(in crate::urban) fn hillside(culture: &str, arch: &Value) -> Hillside {
    let declared = super::super::forms::kit::traits(culture).hillside.as_ref();
    let way = match declared.map(|h| h.way.as_str()) {
        Some("terrace") => "terrace",
        Some("stilts") => "stilts",
        Some("plinth") => "plinth",
        _ if pile_house(culture, arch) => "stilts",
        _ => "plinth",
    };
    let light = matches!(tradition(arch, culture).wall, "timber" | "wood" | "bamboo" | "wattle" | "hide");
    let default = match way {
        "terrace" | "stilts" => 4.0,
        _ if light => 1.5,
        _ => 2.5,
    };
    let own = declared.map_or(0.0, |h| h.max_drop_m);
    Hillside { way, max_drop_m: if own > 0.0 { own } else { default } }
}

/// A piece whose ground drops less than this carries no footing record.
pub(in crate::urban) const FOOTING_MIN_DROP_M: f64 = 1.0;
/// A terrace runs this far past its building on the downhill side (m).
const TERRACE_APRON_M: f64 = 1.5;

/// Footing of a piece whose ground spans `low..high` (display contract
/// `massing[i].footing`, only from `FOOTING_MIN_DROP_M`):
/// `{way, base_z_m, low_z_m, drop_m}`, the floor level at the uphill side
/// (`base_z_m`, the highest ground). `plinth`: a stepped plinth down to
/// `low_z_m`; `stilts`: each post down to its own ground; `terrace` adds
/// `terrace: {ring, wall_m}`, the level terrace the piece stands on (its box
/// across the slope, run `TERRACE_APRON_M` past it downhill, inside the lot)
/// and the height of its retaining wall on the downhill edge.
pub(in crate::urban) fn footing(
    way: &str,
    ring: &[Point],
    uphill: Point,
    lot: &Shape,
    ground: &dyn Fn(Point) -> f64,
    low: f64,
    high: f64,
) -> Option<Value> {
    if !(high - low).is_finite() || high - low < FOOTING_MIN_DROP_M {
        return None;
    }
    let mut out = json!({"way": way, "base_z_m": round2(high), "low_z_m": round2(low), "drop_m": round2(high - low)});
    let len = uphill.x.hypot(uphill.y);
    if way == "terrace" && len > 1e-9 && ring.len() >= 3 {
        let u = Point { x: uphill.x / len, y: uphill.y / len };
        let n = perp(u);
        let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in ring {
            let (s, t) = (p.x * u.x + p.y * u.y, p.x * n.x + p.y * n.y);
            (s0, s1, t0, t1) = (s0.min(s), s1.max(s), t0.min(t), t1.max(t));
        }
        let terrace = Shape {
            outer: vec![at_st(u, s0 - TERRACE_APRON_M, t0), at_st(u, s1, t0), at_st(u, s1, t1), at_st(u, s0 - TERRACE_APRON_M, t1)],
            holes: vec![],
        };
        let kept = super::super::geometry::intersection(&terrace, lot)
            .into_iter()
            .max_by(|a, b| super::super::geometry::area(a).total_cmp(&super::super::geometry::area(b)))
            .unwrap_or(terrace);
        let foot = kept.outer.iter().map(|&p| ground(p)).fold(low, f64::min);
        out["terrace"] = json!({"ring": ring_json(&kept.outer), "wall_m": round2(high - foot)});
    }
    Some(out)
}
