//! District count and partition by construction: a city has as many districts
//! as its culture has neighbourhood anchors (parishes, mahalle mosques, ward
//! temples) and as its quarters can carry, not a fixed handful. Data lives in
//! `catalogue.json`: `districts.default`, `districts.pools` (French names), and
//! `cultures[c].districts` (`unit`, `anchor` service role, `per` anchors per
//! district, `people` per district when no anchor is placed, `names` pool).
use super::super::roles;
use super::super::{Point, UrbanDistrict};
use serde_json::Value;

fn culture_rules(culture: &str) -> (&'static Value, &'static Value) {
    let cat = super::super::catalogue();
    (
        &cat["cultures"][culture]["districts"],
        &cat["districts"]["default"],
    )
}

fn text(culture: &str, key: &str) -> Option<&'static str> {
    let (own, default) = culture_rules(culture);
    own[key].as_str().or_else(|| default[key].as_str())
}

fn number(culture: &str, key: &str) -> Option<f64> {
    let (own, default) = culture_rules(culture);
    own[key].as_f64().or_else(|| default[key].as_f64())
}

/// How many districts a city of `population` gets: one per `per` anchor
/// buildings the services place (parishes, mosques, temples), else one per
/// `people` inhabitants; never more than its `quarters` carry at
/// `quartersPer` quarters each.
pub(in crate::urban) fn target(culture: &str, population: u32, quarters: usize) -> usize {
    let by_anchor = text(culture, "anchor").and_then(|role| {
        roles::services(culture, population)
            .iter()
            .find(|n| n.entry.role == role)
            .map(|n| n.sites as f64 / number(culture, "per").unwrap_or(1.0).max(0.1))
    });
    let by_people = f64::from(population) / number(culture, "people").unwrap_or(3000.0).max(100.0);
    let wanted = by_anchor.unwrap_or(by_people).round().max(1.0);
    let room = quarters as f64 / number(culture, "quartersPer").unwrap_or(1.5).max(1.0);
    wanted.min(room.floor().max(1.0)) as usize
}

/// Cut the heaviest multi-quarter group in two, along its long axis at half
/// weight, until `target` groups exist. A cardinal grid cuts on the compass
/// axes (wards on the lattice); other plans cut across their principal axis so
/// every district stays one compact lump of whole quarters.
pub(in crate::urban) fn split(
    groups: &mut Vec<UrbanDistrict>,
    target: usize,
    points: &[Point],
    weight: &[f64],
    cardinal: bool,
) {
    while groups.len() < target {
        let Some(gi) = (0..groups.len())
            .filter(|&i| groups[i].quarters.len() > 1)
            .max_by(|&a, &b| {
                let w = |i: usize| groups[i].quarters.iter().map(|&q| weight[q]).sum::<f64>();
                w(a).total_cmp(&w(b)).then(b.cmp(&a))
            })
        else {
            break;
        };
        let mut qs = groups[gi].quarters.clone();
        let total: f64 = qs.iter().map(|&q| weight[q]).sum::<f64>().max(1e-9);
        let (mx, my) = qs.iter().fold((0.0, 0.0), |(x, y), &q| {
            (x + points[q].x * weight[q], y + points[q].y * weight[q])
        });
        let (mx, my) = (mx / total, my / total);
        let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
        for &q in &qs {
            let (dx, dy) = (points[q].x - mx, points[q].y - my);
            sxx += dx * dx * weight[q];
            syy += dy * dy * weight[q];
            sxy += dx * dy * weight[q];
        }
        let theta = if cardinal {
            if sxx >= syy {
                0.0
            } else {
                std::f64::consts::FRAC_PI_2
            }
        } else {
            0.5 * (2.0 * sxy).atan2(sxx - syy)
        };
        let (c, s) = (theta.cos(), theta.sin());
        let key = |q: usize| points[q].x * c + points[q].y * s;
        qs.sort_by(|&a, &b| key(a).total_cmp(&key(b)).then(a.cmp(&b)));
        let mut acc = 0.0;
        let mut cut = 1;
        for (i, &q) in qs.iter().enumerate() {
            acc += weight[q];
            if acc >= total * 0.5 {
                cut = (i + 1).clamp(1, qs.len() - 1);
                break;
            }
        }
        let mut second = groups[gi].clone();
        second.quarters = qs.split_off(cut);
        groups[gi].quarters = qs;
        groups.insert(gi + 1, second);
    }
}

/// Plan axes are compass-aligned: a cardinal lattice.
pub(in crate::urban) fn is_cardinal(culture: &str) -> bool {
    let plan = &super::super::catalogue()["cultures"][culture]["plan"];
    plan["pattern"].as_str() == Some("grid") && plan["orientation"].as_str() == Some("cardinal")
}

/// Relative inhabitants of a quarter per m² by zone: the core is packed, the
/// edge is thin, so districts are cut by people rather than by land.
pub(in crate::urban) fn zone_weight(zone: &str) -> f64 {
    match zone {
        "core" => 2.6,
        "middle" => 1.5,
        _ => 0.7,
    }
}

/// French noun of the culture's district (`paroisse`, `mahalle`, `fang`...).
pub(in crate::urban) fn unit(culture: &str) -> &'static str {
    text(culture, "unit").unwrap_or("quartier")
}

fn roman(mut n: usize) -> String {
    let mut out = String::new();
    for (v, s) in [(10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")] {
        while n >= v {
            out.push_str(s);
            n -= v;
        }
    }
    out
}

/// Name of the `index`-th district of a city (a saint, a founder, a ward
/// name): the culture's pool, then the same names with a numeral.
pub(in crate::urban) fn name(culture: &str, index: usize) -> String {
    let cat = super::super::catalogue();
    let pool = text(culture, "names")
        .and_then(|p| cat["districts"]["pools"][p].as_array())
        .filter(|p| !p.is_empty());
    match pool {
        Some(pool) => {
            let base = pool[index % pool.len()].as_str().unwrap_or("");
            match index / pool.len() {
                0 => base.to_string(),
                lap => format!("{base} {}", roman(lap + 1)),
            }
        }
        None => format!("n° {}", index + 1),
    }
}

/// French label of a district: the bare unit for a residential one
/// (`Paroisse Saint-Martin`), the role's label first for a specialised one
/// (`Quartier des tanneurs, paroisse Saint-Éloi`).
pub(in crate::urban) fn label(culture: &str, role: &str, role_label: &str, index: usize) -> String {
    let unit = unit(culture);
    let name = name(culture, index);
    if matches!(role, "commoner" | "") {
        let mut chars = unit.chars();
        let head = chars
            .next()
            .map(|c| c.to_uppercase().collect::<String>())
            .unwrap_or_default();
        format!("{head}{} {name}", chars.as_str())
    } else {
        format!("{role_label}, {unit} {name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn district_count_follows_size_culture_and_quarters() {
        let european = target("european-organic", 100_000, 187);
        assert!((25..=60).contains(&european), "european 100k: {european}");
        assert!(
            target("ottoman", 100_000, 400) > european,
            "a mahalle per mosque"
        );
        assert!(target("chinese", 100_000, 98) >= 25);
        assert!(target("roman-core", 100_000, 33) <= 27);
        assert_eq!(target("european-organic", 150, 12), 1);
        assert!(target("european-organic", 5_000, 40) <= 3);
        assert!(target("european-organic", 20_000, 80) < european);
        assert_eq!(target("ottoman", 100_000, 3), 2, "quarters bound the count");
    }

    #[test]
    fn district_names_are_french_distinct_and_cultural() {
        for culture in [
            "european-organic",
            "ottoman",
            "chinese",
            "roman-core",
            "elven",
        ] {
            let labels: std::collections::BTreeSet<_> = (0..70)
                .map(|i| label(culture, "commoner", "Quartier populaire", i))
                .collect();
            assert_eq!(labels.len(), 70, "{culture}");
        }
        assert!(label("european-organic", "commoner", "", 0).starts_with("Paroisse Saint-"));
        assert!(label("ottoman", "commoner", "", 0).starts_with("Mahalle de "));
        assert!(label("chinese", "port", "Quartier du port", 1).contains("fang"));
        assert!(label("roman-core", "commoner", "", 0).starts_with("Vicus "));
    }

    #[test]
    fn split_cuts_whole_quarters_into_compact_halves() {
        let points: Vec<Point> = (0..40)
            .map(|i| Point {
                x: f64::from(i % 8) * 100.0,
                y: f64::from(i / 8) * 100.0,
            })
            .collect();
        let weight = vec![1.0; 40];
        let mut groups = vec![UrbanDistrict {
            id: 0,
            center: 0,
            phase: 0,
            tissue: String::new(),
            quarters: (0..40).collect(),
            role: String::new(),
            wealth: 0.5,
            label: String::new(),
        }];
        split(&mut groups, 8, &points, &weight, true);
        assert_eq!(groups.len(), 8);
        let mut all: Vec<usize> = groups.iter().flat_map(|d| d.quarters.clone()).collect();
        all.sort_unstable();
        assert_eq!(all, (0..40).collect::<Vec<_>>());
        let span = |v: &[f64]| {
            v.iter().cloned().fold(f64::MIN, f64::max) - v.iter().cloned().fold(f64::MAX, f64::min)
        };
        for d in &groups {
            assert_eq!(d.quarters.len(), 5, "equal weights, equal districts");
            let xs: Vec<f64> = d.quarters.iter().map(|&q| points[q].x).collect();
            let ys: Vec<f64> = d.quarters.iter().map(|&q| points[q].y).collect();
            assert!(span(&xs).max(span(&ys)) <= 400.0, "compact lump");
        }
    }

    /// A real 20k Ottoman layout: a mahalle per mosque, whole quarters, each in
    /// exactly one district.
    #[test]
    fn an_ottoman_city_gets_a_mahalle_per_mosque() {
        use super::super::super::{LayoutConfig, Site, Surface, generate_quarters};
        let (n, width) = (96usize, 2400.0);
        let height = vec![20.0f32; n * n];
        let water = vec![0u8; n * n];
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let site = Site {
            key: "mahalle".into(),
            name: String::new(),
            population: 20_000,
            culture: "ottoman".into(),
            center: Point {
                x: 1200.0,
                y: 1200.0,
            },
            radius: 700.0,
        };
        let layout = &generate_quarters(
            "districts",
            std::slice::from_ref(&site),
            &LayoutConfig::default(),
            surface,
            &[],
        )
        .unwrap()[0];
        let districts = &layout.structure.as_ref().unwrap().districts;
        let wanted = target("ottoman", 20_000, layout.quarters.len());
        assert!(wanted >= 10, "20k ottoman: {wanted}");
        assert!(
            districts.len() >= wanted.min(layout.quarters.len() / 2),
            "{} districts",
            districts.len()
        );
        let mut seen = vec![0; layout.quarters.len()];
        for d in districts {
            for &q in &d.quarters {
                seen[q] += 1;
            }
        }
        assert!(seen.iter().all(|&c| c == 1), "each quarter in one district");
    }
}
