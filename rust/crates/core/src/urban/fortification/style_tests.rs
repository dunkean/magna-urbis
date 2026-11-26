//! Style resolution by culture, population, period and terrain.

use crate::rng::Rng;
use super::moat::{suits, supply};
use super::style::{Inputs, data, num, resolve, styled};

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

/// Moats by culture: every form a style, group or culture names is a row of the `moats` table that the engine and
/// the renderers implement (profile, revetment, depth range, site, water); a culture's wet moat floods only where it is
/// fed, a sourceless one holds a rain pool.
#[test]
fn moat_forms_named_in_the_data_are_implemented_and_need_a_source_to_flood() {
    let d = data();
    let rows = d["moats"].as_object().expect("moats table");
    let mut named: Vec<String> = vec![];
    for table in ["styles", "groups", "cultures"] {
        for v in d[table].as_object().expect("table").values() {
            named.extend(v["moatForm"].as_str().map(String::from));
            named.extend(v["moatForms"].as_array().into_iter().flatten().map(|f| f["form"].as_str().expect("form id").to_string()));
        }
    }
    for f in &named {
        assert!(rows.contains_key(f) && f != "notes", "unknown moat form {f}");
    }
    let one_of = |v: &serde_json::Value, ok: &[&str]| v.as_str().is_some_and(|s| ok.contains(&s));
    for (id, row) in rows.iter().filter(|(k, _)| *k != "notes") {
        assert!(one_of(&row["profile"], &["v", "u", "flat"]), "{id}: profile");
        assert!(one_of(&row["revetment"], &["earth", "masonry", "timber", "stone", "rock"]), "{id}: revetment");
        assert!(row["needs"].is_null() || one_of(&row["needs"], &["steep", "canals"]), "{id}: needs");
        assert!(row["water"].is_null() || one_of(&row["water"], &["never", "fed"]), "{id}: water");
        let lo = num(row, "depthM", 0.0);
        assert!(lo > 0.0 && num(row, "depthMaxM", lo) >= lo, "{id}: depth range");
        assert!(named.iter().any(|f| f == id), "{id}: no culture digs it");
    }
    let (earth, rock, canal) = (&rows["earth"], &rows["rockcut"], &rows["canal"]);
    // A form that needs a site is drawn only there.
    assert!(suits(earth, false, false) && suits(rock, true, false) && !suits(rock, false, true));
    assert!(suits(canal, false, true) && !suits(canal, true, false));
    // Supply: a culture's wet moat is flooded only when fed, else a pool; a rock-cut ditch stays dry, a canal moat is wet.
    assert_eq!(supply(Some("wet"), true, false, earth), Some("pool"));
    assert_eq!(supply(Some("wet"), true, true, earth), Some("wet"));
    assert_eq!(supply(Some("wet"), true, true, rock), Some("dry"));
    assert_eq!(supply(Some("dry"), false, false, canal), Some("wet"));
    assert_eq!(supply(Some("dry"), false, false, earth), Some("dry"));
    assert_eq!(supply(None, true, true, canal), None);
    // The culture's forms reach its style: a list, a single form over its group's list, the canals of a canal town.
    assert!(styled("flanked", "roman-core", 10_000).moat_forms.iter().any(|(f, _)| f == "fossa"));
    let japanese = styled("curtain", "japanese-jokamachi", 10_000);
    assert!(japanese.moat_form == "ceremonial" && japanese.moat_forms.iter().any(|(f, _)| f == "rockcut"));
    let ringfort = styled("gord", "norse-ringfort", 3_000);
    assert!(ringfort.moat_form == "ringfort" && ringfort.moat_forms.is_empty());
    assert!(styled("flanked", "gnomish", 10_000).canals && !styled("flanked", "european-organic", 10_000).canals);
    // The form is drawn with the style and sizes its ditch: what reads the moat width reads the dug one.
    let mut level = styled("flanked", "dwarven", 10_000);
    let width = level.ditch_width[1];
    level.draw_form(&Rng::new("moat-form"), false);
    assert!(level.moat_form == "revetted" && level.moat_forms.is_empty() && level.ditch_width[1] == width, "a level hold has no rock to cut");
    level.set_form("rockcut");
    assert!((level.ditch_width[1] - 0.75 * width).abs() < 1e-9);
}
