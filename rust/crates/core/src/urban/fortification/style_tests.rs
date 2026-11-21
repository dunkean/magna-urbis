//! Style resolution by culture, population, period and terrain.

use super::{Inputs, resolve};
use crate::rng::Rng;

fn inputs<'a>(culture: &'a str, pop: u32, period: &'a str, relief: f64) -> Inputs<'a> {
    Inputs {
        culture,
        pop,
        period,
        state: "thriving",
        archetype: "",
        forced: "auto",
        relief,
    }
}

#[test]
fn resolver_follows_culture_population_period_and_relief() {
    let rng = Rng::new("resolver").fork("fortification");
    let pick = |culture: &str, pop: u32, kind: &str| {
        resolve(kind, &inputs(culture, pop, "", 0.0), &rng, &mut vec![]).id
    };
    assert_eq!(pick("european-organic", 2000, "wall"), "curtain");
    assert_eq!(pick("european-organic", 10_000, "wall"), "flanked");
    assert_eq!(pick("medina", 8000, "wall"), "rammed-earth");
    assert_eq!(pick("chinese", 8000, "wall"), "wengcheng");
    assert_eq!(pick("slavic-gord", 3000, "palisade"), "gord");
    assert_eq!(pick("goblin-warren", 3000, "palisade"), "palisade");
    assert_eq!(pick("elven", 3000, "hedge"), "hedge");
    let mut drawn = std::collections::BTreeSet::new();
    for k in 0..40 {
        let r = Rng::new(&format!("draw-{k}")).fork("fortification");
        let medieval = resolve(
            "wall",
            &inputs("european-organic", 120_000, "M", 0.0),
            &r,
            &mut vec![],
        );
        assert_ne!(medieval.id, "bastioned");
        drawn.insert(
            resolve(
                "wall",
                &inputs("european-organic", 120_000, "", 0.0),
                &r,
                &mut vec![],
            )
            .id,
        );
        // A hill town never keeps a drawn bastioned or concentric trace.
        let hill = resolve(
            "wall",
            &inputs("european-organic", 120_000, "", 0.1),
            &r,
            &mut vec![],
        );
        assert!(hill.hill && hill.id == "flanked", "{}", hill.id);
    }
    assert!(
        drawn.contains("bastioned") && drawn.contains("concentric"),
        "{drawn:?}"
    );
    // A wall style forced on a palisade is refused with a warning.
    let mut w = vec![];
    let forced = Inputs {
        forced: "bastioned",
        ..inputs("slavic-gord", 3000, "", 0.0)
    };
    assert_eq!(resolve("palisade", &forced, &rng, &mut w).id, "gord");
    assert_eq!(w[0], "Wall style bastioned skipped — incompatible fortification");
}
