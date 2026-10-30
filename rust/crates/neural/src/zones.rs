//! Generator inputs derived from the same semantic masks as the procedural engine.
use crate::{Family, Regional, Request, Sketch};
use magna_urbis_core::TerrainZones;
use serde_json::Value;

pub(crate) fn apply(request: &mut Request, value: &Value) -> Result<(), String> {
    let zones: TerrainZones =
        serde_json::from_value(value["zones"].clone()).map_err(|e| format!("Zones : {e}"))?;
    zones.validate()?;
    if zones.weights.iter().all(|&w| w == 0) {
        return Ok(());
    }
    let Sketch::Regional(base) = &request.sketch else {
        return Err("Contexte régional requis pour les zones.".into());
    };
    let region = &value["region"];
    let extent = region["width"].as_f64().unwrap_or(40000.0);
    let origin = (
        region["x"].as_f64().unwrap_or(0.0),
        region["y"].as_f64().unwrap_or(0.0),
    );
    if !extent.is_finite()
        || !(500.0..=40000.0).contains(&extent)
        || !origin.0.is_finite()
        || !origin.1.is_finite()
        || origin.0 < 0.0
        || origin.1 < 0.0
        || origin.0 + extent > 40000.000001
        || origin.1 + extent > 40000.000001
    {
        return Err("Zones hors de la surface neuronale.".into());
    }
    let families = [
        Family::Flat,
        Family::Flat,
        Family::Hills,
        Family::Mountains,
        Family::HighMountains,
    ];
    let profiles = families
        .map(|family| {
            let mut profile = Regional::new(
                request.seed,
                family,
                base.mix,
                base.coast_mask,
                // By name: the browser build compiles this file against
                // neural-earth's sketch, whose island modes may differ.
                match format!("{:?}", base.islands).as_str() {
                    "Archipelago" => "archipelago",
                    "Peninsula" => "peninsula",
                    _ => "island",
                },
                base.climate,
                base.extent,
            )?;
            profile.land_scale = base.land_scale;
            Ok::<_, String>(profile)
        })
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    let n = 128;
    let mut heights = Vec::with_capacity(n * n);
    let mut relief = Vec::with_capacity(n * n);
    let mut strength = Vec::with_capacity(n * n);
    for y in 0..n {
        for x in 0..n {
            let (u, v) = ((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64);
            let (px, py) = (origin.0 + u * extent, origin.1 + v * extent);
            let weights = zones.sample(u, v);
            let coverage = 1.0 - weights[0];
            let mut h = weights[0] * base.elevation(px, py);
            let mut spread = 0.0;
            for k in 0..5 {
                h += weights[k + 1]
                    * if k == 0 {
                        -450.0
                    } else {
                        profiles[k].elevation(px, py)
                    };
                spread += weights[k + 1] * [0.0, 20.0, 110.0, 800.0, 1600.0][k] * base.land_scale;
            }
            heights.push(h);
            relief.push(if coverage > 0.0 {
                (spread / coverage) as f32
            } else {
                0.0
            });
            strength.push(coverage as f32);
        }
    }
    let context = std::mem::replace(
        &mut request.sketch,
        Sketch::Validation(crate::Validation::Plain),
    );
    request.sketch = Sketch::ReliefMap {
        resolution: n,
        relief,
        strength,
        extent,
        origin,
        context: Box::new(Sketch::Grid {
            resolution: n,
            heights,
            extent,
            origin,
            context: Box::new(context),
        }),
    };
    Ok(())
}
