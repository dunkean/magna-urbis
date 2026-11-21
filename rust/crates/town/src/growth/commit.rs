//! One quarter's draft turned into the operations of its `OpenQuarter` event.
//!
//! The quarter's face becomes a block first, so that every face its streets split off is born a
//! block. The streets follow as `journal::ops_for_draft` seats them on the graph as it stands
//! after the quarters committed before this one. When the graph refuses the draft as a whole, the
//! streets are tried one by one on a stage and those it accepts are kept: a street that would
//! cross a neighbour's seated street is lost, not the quarter.

use crate::graph::{Clock, FaceKind, Key};
use crate::journal::{Op, QuarterDraft, Writer, ops_for_draft};

/// The operations opening the quarter of `draft` in the face keyed `face`, dated `at`; none when
/// the face is gone.
pub(super) fn quarter_ops(writer: &Writer, at: Clock, draft: &QuarterDraft, face: &Key) -> Vec<Op> {
    let quarter = draft.key();
    let streets = ops_for_draft(&draft.draft, &quarter, &draft.outline, writer.graph());
    let block = Op::SetFaceKind {
        face: face.clone(),
        kind: FaceKind::Block,
    };
    let mut stage = writer.stage(at);
    if stage.try_push(vec![block]).is_err() {
        return Vec::new();
    }
    if stage.try_push(streets.clone()).is_ok() {
        return stage.into_ops();
    }
    for op in streets {
        let _ = stage.try_push(vec![op]);
    }
    stage.into_ops()
}
