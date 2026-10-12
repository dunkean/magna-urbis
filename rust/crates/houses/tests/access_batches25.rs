use magna_urbis_houses::{
    generate_batch,
    model::{AccessKind, HouseConfig},
};
use std::collections::{BTreeSet, VecDeque};

#[test]
fn varied_collective_and_rockcut_batches_keep_their_programme_and_private_access() {
    for id in ["MED-ANT-B04", "AS-HIM-B10", "AS-CHI-B10", "AS-HIM-B02"] {
        let batch = generate_batch(HouseConfig {
            pack: id.rsplit_once("-B").unwrap().0.into(),
            recipe: Some(id.into()),
            seed: "42".into(),
            count: 10,
            variation: 0.65,
            allow_late: false,
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(batch.units.len(), 10);
        let unit = &batch.units[2];
        let (bodies, rooms) = match id {
            "MED-ANT-B04" => (4, 160),
            "AS-HIM-B10" | "AS-CHI-B10" => (12, 72),
            _ => (4, 22),
        };
        assert_eq!(unit.bodies.len(), bodies, "{id}");
        assert_eq!(unit.rooms.len(), rooms, "{id}");
        for unit in &batch.units {
            for owner in unit
                .rooms
                .iter()
                .filter_map(|r| r.household_id.as_ref())
                .collect::<BTreeSet<_>>()
            {
                let allowed: BTreeSet<_> = unit
                    .access
                    .nodes
                    .iter()
                    .filter(|n| n.household_id.as_ref().is_none_or(|id| id == owner))
                    .map(|n| n.id.as_str())
                    .collect();
                let mut reached = BTreeSet::from([unit.access.root.as_str()]);
                let mut queue = VecDeque::from([unit.access.root.as_str()]);
                while let Some(current) = queue.pop_front() {
                    for p in &unit.access.portals {
                        let next = if p.from == current {
                            Some(p.to.as_str())
                        } else if p.to == current {
                            Some(p.from.as_str())
                        } else {
                            None
                        };
                        if let Some(next) = next
                            && allowed.contains(next)
                            && reached.insert(next)
                        {
                            queue.push_back(next);
                        }
                    }
                }
                assert!(
                    unit.rooms
                        .iter()
                        .filter(|r| r.household_id.as_ref() == Some(owner))
                        .all(|r| reached.contains(r.access_node.as_str())),
                    "{id}/{} owner{owner}",
                    unit.id
                );
            }
            assert!(
                unit.access
                    .nodes
                    .iter()
                    .filter(|n| n.kind == AccessKind::Terrace && n.household_id.is_none())
                    .all(|n| !n.floor.is_empty())
            );
        }
    }
}
