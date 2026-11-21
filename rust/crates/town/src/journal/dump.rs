//! One JSON file per event: the event, its operations, and the elements it created and retired
//! with their geometry.

use std::io;
use std::path::{Path, PathBuf};

use magna_urbis_geom::{Point, Shape};
use serde::Serialize;

use super::{Event, Keys, Writer};
use crate::graph::{Clock, EdgeClass, FaceKind, Graph, Key, Level, NodeKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventDump<'a> {
    index: usize,
    event: &'a Event,
    born: Elements,
    retired: Elements,
}

#[derive(Serialize)]
struct Elements {
    nodes: Vec<NodeDump>,
    edges: Vec<EdgeDump>,
    faces: Vec<FaceDump>,
}

#[derive(Serialize)]
struct NodeDump {
    key: Key,
    level: Level,
    position: Point,
    kind: Option<NodeKind>,
}

#[derive(Serialize)]
struct EdgeDump {
    key: Key,
    stem: Key,
    level: Level,
    nodes: [Key; 2],
    class: Option<EdgeClass>,
    rank: Option<u8>,
    polyline: Vec<Point>,
    widths: Vec<f64>,
}

#[derive(Serialize)]
struct FaceDump {
    key: Key,
    level: Level,
    kind: Option<FaceKind>,
    parents: Vec<Key>,
    outline: Option<Shape>,
}

/// Elements of `keys` as they are in `graph`, with attributes read at `clock`.
fn elements(graph: &Graph, keys: &Keys, clock: Clock) -> Elements {
    Elements {
        nodes: keys
            .nodes
            .iter()
            .filter_map(|k| graph.node_id(k))
            .map(|id| {
                let n = graph.node(id);
                NodeDump {
                    key: n.key.clone(),
                    level: n.level,
                    position: n.position,
                    kind: n.kind.at(clock).copied(),
                }
            })
            .collect(),
        edges: keys
            .edges
            .iter()
            .filter_map(|k| graph.edge_id(k))
            .map(|id| {
                let e = graph.edge(id);
                EdgeDump {
                    key: e.key.clone(),
                    stem: e.stem.clone(),
                    level: e.level,
                    nodes: e.nodes.map(|n| graph.node(n).key.clone()),
                    class: e.class.at(clock).copied(),
                    rank: e.rank.at(clock).copied(),
                    polyline: e.polyline.clone(),
                    widths: e.widths.clone(),
                }
            })
            .collect(),
        faces: keys
            .faces
            .iter()
            .filter_map(|k| graph.face_id(k))
            .map(|id| {
                let f = graph.face(id);
                FaceDump {
                    key: f.key.clone(),
                    level: f.level,
                    kind: f.kind.at(clock).copied(),
                    parents: f.life.parents.clone(),
                    outline: graph.outline(id),
                }
            })
            .collect(),
    }
}

/// Write event `index` of the writer's journal to `folder/event-<index>.json`, creating the
/// folder if needed, and return the file's path. The growth driver calls it after each event
/// when a dump folder is configured; geometry is read from the current graph, so a face's
/// outline is the one it had after the event only when it is called right after the event.
pub fn dump_event(writer: &Writer, index: usize, folder: &Path) -> io::Result<PathBuf> {
    let event = writer
        .event(index)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("no event {index}")))?;
    let graph = writer.graph();
    let dump = EventDump {
        index,
        event,
        born: elements(graph, &event.born, event.clock),
        retired: elements(graph, &event.retired, event.clock),
    };
    let json = serde_json::to_vec_pretty(&dump).map_err(io::Error::other)?;
    std::fs::create_dir_all(folder)?;
    let path = folder.join(format!("event-{index:05}.json"));
    std::fs::write(&path, json)?;
    Ok(path)
}
