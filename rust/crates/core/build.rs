use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::{env, fs, path::Path};

// Validate base ids against the same native house mapping used by the city.
#[allow(dead_code)]
#[path = "src/urban/culture/registry.rs"]
mod registry;

const MANIFEST: &str = "../../../contributions/urban-cultures.json";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Contribution {
    id: String,
    label: String,
    base: String,
    #[serde(default)]
    recipes: BTreeMap<String, String>,
    style: Style,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Style {
    kit: String,
    palette: Palette,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Palette {
    homes: BTreeMap<String, f64>,
    #[serde(default)]
    special: BTreeMap<String, f64>,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &str) -> T {
    println!("cargo:rerun-if-changed={path}");
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn main() {
    println!("cargo:rerun-if-changed=src/urban/culture/registry.rs");
    let contributions: Vec<Contribution> = read_json(MANIFEST);
    let urban: Value = read_json("src/urban/catalogue.json");
    let historical: Value = read_json("src/urban/forms/styles.json");
    let modern: Value = read_json("src/urban/forms/styles_modern.json");
    let mut cultures = BTreeMap::new();
    let mut presets = BTreeMap::new();
    let mut styles = BTreeMap::new();

    for entry in contributions {
        let id = &entry.id;
        let prefix = format!("{MANIFEST} ({id})");
        assert!(
            !id.is_empty()
                && id.len() <= 64
                && id.split('-').all(|word| {
                    !word.is_empty()
                        && word
                            .bytes()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
                }),
            "{prefix}: id must be a lowercase, hyphen-separated identifier"
        );
        assert!(
            !matches!(id.as_str(), "site" | "auto" | "culture")
                && urban["cultures"].get(id.as_str()).is_none()
                && !cultures.contains_key(id),
            "{prefix}: culture id is reserved or already used"
        );
        assert!(
            !entry.label.trim().is_empty() && !entry.label.chars().any(char::is_control),
            "{prefix}: label must be nonempty text"
        );
        let base = &entry.base;
        assert!(
            urban["cultures"][base].is_object()
                && registry::MAPPINGS.iter().any(|m| m.0 == base.as_str()),
            "{prefix}: base '{base}' must be a built-in culture with native house recipes"
        );
        let kit = &entry.style.kit;
        assert!(
            historical["kits"][kit].is_object() || modern["kits"][kit].is_object(),
            "{prefix}: unknown style.kit '{kit}'"
        );
        assert!(
            !entry.style.palette.homes.is_empty(),
            "{prefix}: style.palette.homes must contain at least one colour"
        );
        for (kind, colors) in [
            ("homes", &entry.style.palette.homes),
            ("special", &entry.style.palette.special),
        ] {
            for (color, weight) in colors {
                assert!(
                    color.starts_with('#')
                        && color.len() == 7
                        && color[1..].bytes().all(|c| c.is_ascii_hexdigit())
                        && weight.is_finite()
                        && *weight > 0.0,
                    "{prefix}: style.palette.{kind} requires #rrggbb colours with positive finite weights (got {color}: {weight})"
                );
            }
            assert!(
                colors.values().sum::<f64>().is_finite(),
                "{prefix}: style.palette.{kind} weights are too large"
            );
        }

        let mut culture = urban["cultures"][base].clone();
        culture["label"] = json!(entry.label);
        let inherited = culture["recipes"]
            .as_array_mut()
            .expect("built-in recipe list");
        for recipe in entry.recipes.keys() {
            assert!(
                inherited
                    .iter()
                    .any(|r| r["id"].as_str() == Some(recipe.as_str())),
                "{prefix}: unknown recipe slot '{recipe}' in '{base}'"
            );
        }
        for recipe in inherited {
            let slot = recipe["id"].as_str().expect("built-in recipe id");
            let source = entry
                .recipes
                .get(slot)
                .map(String::as_str)
                .unwrap_or_else(|| recipe["preset"].as_str().expect("built-in recipe preset"));
            let preset = &urban["presets"][source];
            assert!(
                preset["params"].is_object(),
                "{prefix}: recipe '{slot}' points to unknown preset '{source}'"
            );
            let alias = format!("{id}/{slot}");
            assert!(
                urban["presets"].get(alias.as_str()).is_none(),
                "{prefix}: generated preset '{alias}' would replace a built-in preset"
            );
            presets.insert(alias.clone(), preset.clone());
            recipe["preset"] = json!(alias);
        }
        styles.insert(id.clone(), json!({
            "base": base,
            "kit": kit,
            "palette": { "homes": entry.style.palette.homes, "special": entry.style.palette.special }
        }));
        cultures.insert(entry.id, culture);
    }

    let out = env::var_os("OUT_DIR").expect("Cargo output directory");
    let catalogue = json!({ "cultures": cultures, "presets": presets, "styles": styles });
    fs::write(
        Path::new(&out).join("contributor-cultures.json"),
        catalogue.to_string(),
    )
    .expect("write prepared contributor cultures");
}
