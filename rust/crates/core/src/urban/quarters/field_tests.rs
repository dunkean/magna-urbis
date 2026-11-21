//! Street guidance parameter tests.

use super::{FieldOrientation, FieldParams};
use crate::urban::resolve;

#[test]
fn field_params_match_morphology_defaults_and_overrides() {
    use serde_json::json;

    for (overrides, orientation) in [
        (json!({}), FieldOrientation::Cardinal),
        (
            json!({
                "streetOp": "organic",
                "orientation": "water",
                "fieldWavelength": 190.25,
                "fieldNoise": 3.5,
                "gridSkew": 0.025,
                "contourFollow": 0.25,
                "fieldTwist": -0.125,
                "fieldRandom": 0.625,
                "contourBlend": 0.75,
                "curvature": 0.375,
            }),
            FieldOrientation::Water,
        ),
    ] {
        let m = resolve("chinese", "culture", "core", "core", 1.0, &overrides, "quarters")
            .unwrap();
        let params = FieldParams::new(&m);
        assert_eq!(params.orientation, orientation);
        assert_eq!(params.grid, m.text("streetOp") == "grid");
        for (value, expected) in [
            (params.wavelength, m.number("fieldWavelength")),
            (params.noise, m.number("fieldNoise")),
            (params.grid_skew, m.number("gridSkew")),
            (params.contour_follow, m.number_or("contourFollow", 0.0)),
            (params.twist, m.number("fieldTwist")),
            (params.random, m.number("fieldRandom")),
            (params.contour_blend, m.number_or("contourBlend", 0.0)),
            (params.curvature, m.number("curvature")),
        ] {
            assert_eq!(value.to_bits(), expected.to_bits());
        }
    }
}
