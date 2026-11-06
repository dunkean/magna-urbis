//! Household groups vary in size while preserving the exact camp population.
use crate::rng::Rng;

pub(in crate::urban) fn groups(total: usize, count: usize, spread: f64, rng: &mut Rng) -> Vec<usize> {
    let spread = spread.clamp(0.0, 0.75);
    let weights: Vec<f64> = (0..count).map(|_| rng.range(1.0 - spread, 1.0 + spread)).collect();
    let sum: f64 = weights.iter().sum();
    let mut left = total;
    weights.iter().enumerate().map(|(i, w)| {
        let k = if i + 1 == count { left } else { ((total as f64 * w / sum).round() as usize).min(left.saturating_sub(count - i - 1)) };
        left -= k;
        k
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn camp_review_varied_groups_keep_every_household_and_differ_between_seeds() {
        let a = groups(330, 8, 0.65, &mut Rng::new("camp-a"));
        let b = groups(330, 8, 0.65, &mut Rng::new("camp-b"));
        assert_eq!(a.iter().sum::<usize>(), 330);
        assert!(a.iter().all(|&k| k > 0));
        assert!(a.iter().max().unwrap() - a.iter().min().unwrap() > 15);
        assert_ne!(a, b);
    }

    fn ring_spread(culture: &str, wobble: Option<f64>) -> (f64, usize) {
        use crate::urban::{LayoutConfig, Point, Site, Surface};
        let n = 64;
        let (height, water) = (vec![10.0; n * n], vec![0u8; n * n]);
        let surface = Surface { geometry: None, width: 4000.0, n, height: &height, water: &water, interpolation: Default::default(),};
        let c = Point { x: 2000.0, y: 2000.0 };
        let site = Site { key: "wobble".into(), name: String::new(), population: 500, culture: culture.into(), center: c, radius: 150.0 };
        let cfg = LayoutConfig { camp_ring_wobble: wobble, ..Default::default() };
        let plan = super::super::camp(&site, &cfg, &None, &[], surface, &mut Rng::new("wobble")).unwrap();
        let ring = plan.streets.iter().max_by_key(|s| s.path.len()).unwrap();
        let r: Vec<f64> = ring.path.iter().map(|p| (p.x - c.x).hypot(p.y - c.y)).collect();
        let (lo, hi) = (r.iter().cloned().fold(f64::MAX, f64::min), r.iter().cloned().fold(0.0, f64::max));
        ((hi - lo) / hi, plan.blocks.len())
    }

    #[test]
    fn camp_review_plains_ring_wobbles_but_stays_a_camp_circle() {
        assert_eq!(ring_spread("native-plains", None),ring_spread("native-plains", Some(0.15)),"default keeps the cultural circle");
        assert!(ring_spread("native-plains", Some(0.0)).0 < 1e-6,"explicit zero makes a regular circle");
        let (plains, blocks) = ring_spread("native-plains", Some(0.15));
        assert!(plains > 0.06 && plains < 0.4, "{plains}");
        assert!(blocks >= 4, "{blocks}");
        assert!(ring_spread("kraal", None).0 < 1e-6, "kraal ring must stay a perfect circle");
    }

    #[test]
    fn camp_review_ring_wobble_override_is_absent_until_requested() {
        use crate::urban::LayoutConfig;
        let cfg: LayoutConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.camp_ring_wobble, None);
        let value = serde_json::to_value(&cfg).unwrap();
        assert!(value.get("campRingWobble").is_none());
    }
}
