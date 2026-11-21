//! Shared layouts and partitions for programme tests.

use crate::urban::{Layout, Partition, Surface, geometry::rectangle, roles};
use serde_json::json;

use super::{ProgrammeContext, ProgrammeFunctions, prepare};

/// Test shorthand: an isolated intent, or one specialisation at full weight.
pub(super) fn context_for(label: &str) -> ProgrammeContext {
    let mut c = ProgrammeContext::default();
    if roles::is_isolated(label) { c.intent = label.into(); return c; }
    let mut f = ProgrammeFunctions::default();
    match label {
        "agricultural" => f.agricultural = 1.0, "crossroads" => f.commerce = 1.0, "artisan" => f.artisan = 1.0,
        "riverine" => f.riverine = 1.0, "port" => f.port = 1.0, "capital" => f.capital = 1.0, _ => return c,
    }
    c.functions = Some(f);
    c
}

pub(super) fn layout(culture: &str) -> Layout {
    serde_json::from_value(json!({"key":"programme-case","culture":culture,"center":{"x":150.0,"y":130.0},
        "quarters":[],"blocks":[{"shape":rectangle(110.0,110.0,130.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}},
        {"shape":rectangle(130.0,110.0,150.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}},
        {"shape":rectangle(150.0,110.0,170.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}}],
        "streets":[{"path":[{"x":100.0,"y":105.0},{"x":200.0,"y":105.0}],"widths":[10.0,10.0],"rank":1,"role":"street"}],"warnings":[]})).unwrap()
}
pub(super) fn prepare_case(role: &str, navigable: bool, culture: &str) -> Layout {
    let mut l = layout(culture);
    let height = vec![0.0; 32 * 32];
    let water = vec![0; 32 * 32];
    prepare(
        &mut l,
        600,
        &ProgrammeContext {
            navigable_access: navigable,
            resources: if role == "artisan" {
                vec!["ore".into()]
            } else {
                vec![]
            },
            ..context_for(role)
        },
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    l
}

pub(super) fn partition(l: &Layout) -> Partition {
    serde_json::from_value(json!({"key":l.key,"warnings":[],"parcels":l.blocks.iter().enumerate().map(|(i,b)|json!({
        "id":format!("lot/{i}"),"shape":b.shape,"block":i,"use":if b.kind.starts_with("reserve"){"reserve"}else{"plot"},
        "front":[{"x":b.shape.outer[0].x,"y":110.0},{"x":b.shape.outer[1].x,"y":110.0}],"axis":{"x":1.0,"y":0.0},"rank":1,
        "access":{"kind":"public","street":0,"frontLength":20.0}
    })).collect::<Vec<_>>()})).unwrap()
}
