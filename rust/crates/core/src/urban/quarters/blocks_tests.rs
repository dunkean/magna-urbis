//! Tests for repairing sliver blocks after street carving.

use super::rejoin_slivers;
use crate::urban::{Block, Point, Shape, geometry as g};

/// A 2 m strip left along a street by a dropped cut rejoins the block it
/// touches; the same strip across a street ribbon (no seam), or in
/// another quarter, stays a block of its own; a 0.5 m slit touching
/// nothing goes.
#[test]
fn a_sliver_block_rejoins_the_block_it_touches() {
    let block = |shape: Shape, quarter: usize| Block {
        shape,
        quarter,
        kind: "block".into(),
        axis: Point { x: 1.0, y: 0.0 },
        zone: "core".into(),
        phase: None,
    };
    let mut blocks = vec![
        block(g::rectangle(0.0, 0.0, 50.0, 40.0), 0),
        block(g::rectangle(0.0, 40.0, 50.0, 42.0), 0),
        block(g::rectangle(0.0, 48.0, 50.0, 50.0), 0),
        block(g::rectangle(50.0, 0.0, 52.0, 40.0), 1),
        block(g::rectangle(0.0, 60.0, 50.0, 60.5), 0),
    ];
    rejoin_slivers(&mut blocks);
    assert_eq!(blocks.len(), 3, "the 0.5 m slit between two ribbons goes");
    assert!((g::area(&blocks[0].shape) - 2100.0).abs() < 1e-6);
    assert!((g::bbox(&blocks[0].shape).3 - 42.0).abs() < 1e-9);
    assert!((g::area(&blocks[1].shape) - 100.0).abs() < 1e-6);
    assert_eq!(blocks[2].quarter, 1);
}
