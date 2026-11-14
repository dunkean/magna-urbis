//! Growth chronology read from a finished layout.
use super::{Layout, geometry as g};

/// Which quarters exist when the town has `population` inhabitants: the
/// quarters in growth order (epoch, then distance from the centre) until they
/// hold that many people, each epoch's population shared between its quarters
/// by area. Every quarter exists at the planned total; a layout without growth
/// epochs is whole as soon as it has an inhabitant.
pub fn grown_at(layout: &Layout, population: u32) -> Vec<bool> {
    let n = layout.quarters.len();
    let total: f64 = layout.phases.iter().map(|p| p.population).sum();
    if total <= 0.0 {
        return vec![population > 0; n];
    }
    let area: Vec<f64> = layout.quarters.iter().map(|q| g::area(&q.shape)).collect();
    let mut epoch_area = vec![0.0; layout.phases.len()];
    for (q, a) in layout.quarters.iter().zip(&area) {
        if let Some(sum) = epoch_area.get_mut(q.phase) {
            *sum += a;
        }
    }
    let far: Vec<f64> = layout
        .quarters
        .iter()
        .map(|q| {
            let c = g::interior_point(&q.shape);
            (c.x - layout.center.x).hypot(c.y - layout.center.y)
        })
        .collect();
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| {
        layout.quarters[a].phase.cmp(&layout.quarters[b].phase).then(far[a].total_cmp(&far[b])).then(a.cmp(&b))
    });
    let mut exists = vec![false; n];
    let mut housed = 0.0;
    for i in order {
        if housed >= f64::from(population) {
            break;
        }
        exists[i] = true;
        let epoch = layout.quarters[i].phase;
        if let (Some(phase), Some(&land)) = (layout.phases.get(epoch), epoch_area.get(epoch))
            && land > 0.0
        {
            housed += phase.population * area[i] / land;
        }
    }
    exists
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarters_appear_epoch_by_epoch_then_outwards() {
        let quarter = |x: f64, phase: usize| serde_json::json!({"shape": g::rectangle(x, 0.0, x + 100.0, 100.0), "phase": phase, "zone": "core"});
        let phase = |population: f64| serde_json::json!({"kind": "foundation", "zone": "core", "recipe": "core", "population": population, "targetArea": 10000.0, "shapes": []});
        let layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "growth", "culture": "european-organic", "center": {"x": 50.0, "y": 50.0},
            // Founding quarter at the centre, then two quarters of the second epoch, the far one listed first.
            "quarters": [quarter(0.0, 0), quarter(400.0, 1), quarter(200.0, 1)],
            "streets": [], "blocks": [], "warnings": [],
            "phases": [phase(1000.0), phase(2000.0)],
        }))
        .unwrap();
        assert_eq!(grown_at(&layout, 0), [false, false, false]);
        assert_eq!(grown_at(&layout, 500), [true, false, false]);
        assert_eq!(grown_at(&layout, 1500), [true, false, true]);
        assert_eq!(grown_at(&layout, 2500), [true, true, true]);
        assert_eq!(grown_at(&layout, 3000), [true, true, true]);
    }
}
