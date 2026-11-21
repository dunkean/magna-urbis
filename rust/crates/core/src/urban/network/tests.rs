//! Fixtures for street network tests.

use crate::urban::{Point, Street};

#[path = "access_tests.rs"]
mod access_tests;
#[path = "junction_tests.rs"]
mod junction_tests;
#[path = "water_tests.rs"]
mod water_tests;

fn street(points: &[(f64, f64)], role: &str) -> Street {
    Street {
        path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
        widths: vec![5.0; points.len()],
        rank: 2,
        role: role.into(),
    }
}
