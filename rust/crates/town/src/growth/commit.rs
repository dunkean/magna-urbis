//! One quarter's draft turned into the operations of its `OpenQuarter` event.
//!
//! The quarter's face becomes a block first, so that every face its streets split off is born a
//! block. The skeleton's planned streets along it are then built (`retypes`), so that the pieces
//! its streets split off them are streets too. The streets follow as `journal::ops_for_draft`
//! seats them on the graph as it stands after the quarters committed before this one. When the
//! graph refuses the draft as a whole, the streets are tried one by one on a stage and those it
//! accepts are kept: a street that would cross a neighbour's seated street is lost, not the
//! quarter.

use std::collections::HashSet;

use super::skeleton::planned_street;
use crate::armature::in_town;
use crate::graph::{Clock, EdgeClass, FaceId, FaceKind, Graph, Key};
use crate::journal::{Op, QuarterDraft, Writer, ops_for_draft};

/// The operations opening the quarter of `draft` in the face keyed `face`, dated `at`; none when
/// the face is gone. `arms` are the chains of the main axes.
pub(super) fn quarter_ops(
    writer: &Writer,
    at: Clock,
    draft: &QuarterDraft,
    face: &Key,
    arms: &HashSet<&Key>,
) -> Vec<Op> {
    let quarter = draft.key();
    let graph = writer.graph();
    let Some(id) = graph.face_id(face).filter(|&f| graph.face(f).life.live()) else {
        return Vec::new();
    };
    let streets = ops_for_draft(&draft.draft, &quarter, &draft.outline, graph);
    let block = Op::SetFaceKind {
        face: face.clone(),
        kind: FaceKind::Block,
    };
    let mut stage = writer.stage(at);
    if stage.try_push(vec![block]).is_err() {
        return Vec::new();
    }
    for op in retypes(graph, id, arms) {
        let _ = stage.try_push(vec![op]);
    }
    if stage.try_push(streets.clone()).is_ok() {
        return stage.into_ops();
    }
    for op in streets {
        let _ = stage.try_push(vec![op]);
    }
    stage.into_ops()
}

/// The planned streets of the skeleton along `face` that its opening builds: every main axis,
/// and each quarter street with town on its other side. The others stay provisional.
fn retypes(graph: &Graph, face: FaceId, arms: &HashSet<&Key>) -> Vec<Op> {
    let mut seen = HashSet::new();
    let mut ops = Vec::new();
    for h in graph.walks(face).into_iter().flatten() {
        let edge = graph.edge(h.edge());
        if !planned_street(edge, arms) || !seen.insert(edge.key.clone()) {
            continue;
        }
        let axis = edge.chain.as_ref().is_some_and(|c| arms.contains(c));
        if axis || in_town(graph, graph.half(h.twin()).face) {
            ops.push(Op::SetEdgeClass {
                edge: edge.key.clone(),
                class: EdgeClass::Street,
            });
        }
    }
    ops
}
