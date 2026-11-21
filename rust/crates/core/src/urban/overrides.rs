//! User edits as the configurations carry them (quarters, blocks, lots), and
//! the records of the structural edits applied to a plan (`edits`).
use super::{Block, Shape};
use serde::{Deserialize, Serialize};

/// User overrides keyed by the quarter's index in `layout.quarters`.
///
/// Stability rule: the composition quarters (the first ones in `layout.quarters`)
/// depend only on the seed, the site and the layout config *without* `overrides`:
/// culture/tissue/density edits act after the quarter partition, on that quarter's
/// subdivision only, with an RNG forked from the quarter index, so editing one
/// quarter never renumbers or reshapes them. Peripheral frontage strips appended
/// after them follow the final streets and may change. An edited culture reaches
/// the quarter's lots through an appended growth phase. Role and wealth overrides
/// are applied by the programme stage.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UrbanOverrides {
    pub quarters: std::collections::BTreeMap<String, QuarterOverride>,
}
/// Plan recipe of one growth zone; an empty field keeps the settlement's own.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PhaseOverride {
    pub culture: String,
    pub recipe: String,
    pub tissue: String,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QuarterOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub building_culture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_config: Option<serde_json::Value>,
    pub role: Option<String>,
    pub wealth: Option<f64>,
    pub culture: Option<String>,
    pub tissue: Option<String>,
    pub density: Option<f64>,
    /// User-set zone of the quarter: its lots are cut with that zone's tables
    /// and occupation pressure (`parcels.rs` `edited_pressure`: core = narrow,
    /// deep, continuous, high coverage; faubourg/village = wide lots, gardens),
    /// and `core` lifts the style's height ladder (`forms/kit.rs` `storey_cap`)
    /// to its top step whatever the population.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// New outline (`urban/edits.rs`): clipped to dry land, the other quarters
    /// and the main streets; the quarter's interior is redrawn inside it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// Split into 2..64 closed parts (`urban/edits/quarter_parts.rs`), applied
    /// last on the finished quarter plan: each clipped to the quarter and cut
    /// out of the parts before it; together they must cover it. Part 0 keeps
    /// index `i`, part `k` is appended after the plan's quarters and keyed
    /// `"<i>/<k>"` (`LayoutConfig::quarter_edits`). No street is built.
    /// `"<i>"` keys only; exclusive with `shape`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<Shape>>,
    /// The quarter owns no block any more; main streets stay. On a part key
    /// `"<i>/<k>"`: the part keeps its outline and index, its blocks hold no lot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    /// Hide selected split pieces, including part 0, without removing siblings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_parts: Vec<usize>,
    /// Redraw of the quarter's interior (streets, blocks, lots); absent = original.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt: Option<u32>,
}
/// User overrides keyed by parcel id. Parcel ids hash the lot geometry within
/// its block, so they are stable for the same layout and parcel config; these
/// overrides only change uses, never geometry, so they never renumber lots.
/// A quarter role override can move programme reservations, hence re-cut and
/// re-identify the lots of the blocks involved.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ParcelOverrides {
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub blocks: std::collections::BTreeMap<String, BlockOverride>,
    pub parcels: std::collections::BTreeMap<String, ParcelOverride>,
}
/// Edit of one retained street block, keyed `"<i>"` (block `i` of the input
/// layout) or `"<i>/<k>"` (part `k ≥ 1` of split block `i`); see `urban/edits/blocks.rs`.
/// Without `shape`, `parts` or `deleted`, borders and streets stay fixed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BlockOverride {
    pub culture: Option<String>,
    pub role: Option<String>,
    pub density: Option<f64>,
    pub operator: Option<String>,
    pub salt: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_config: Option<serde_json::Value>,
    /// New outline, clipped to the block's quarter, the street and wall ribbons
    /// and the other blocks (`"<i>"` keys only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// Split into 2..64 closed parts, clipped like `shape` and each cut out of
    /// the ones before it: part 0 keeps index `i`, part `k` is `"<i>/<k>"`
    /// (`"<i>"` keys only; exclusive with `shape`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<Shape>>,
    /// The block (or part) holds no lot: kind `deleted`, open ground.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    /// Deleted pieces of `parts`, including part 0 without deleting its siblings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_parts: Vec<usize>,
}
/// Record of the structural block edits applied to a prepared layout
/// (`LayoutConfig::block_edits`, `Partition::prepared`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BlockEdits {
    /// Block count of the input layout; parts `k ≥ 1` are appended after it.
    pub count: usize,
    /// Signature of the prepared block list (count, kinds, quarters).
    pub signature: String,
    /// Input blocks replaced in place (reshaped, split or deleted).
    pub originals: Vec<OriginalBlock>,
    /// Every edited surface of the prepared list, by prepared index.
    pub origins: Vec<BlockOrigin>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalBlock {
    pub index: usize,
    pub block: Block,
}
/// Prepared block `block` is part `part` of input block `source` (part 0 for a
/// reshaped or deleted block); its edit key is `"<source>"` or `"<source>/<part>"`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BlockOrigin {
    pub block: usize,
    pub source: usize,
    pub part: usize,
    pub deleted: bool,
}
/// Record of the quarter splits applied by the quarter stage
/// (`LayoutConfig::quarter_edits`, `edits/quarter_parts.rs`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QuarterEdits {
    /// Quarter count of the plan before the splits; parts `k ≥ 1` follow it.
    pub count: usize,
    /// Block count before the splits; extra pieces of cut blocks follow it.
    pub block_count: usize,
    /// Every output quarter of a split (part 0 included), by output index.
    /// Quarters absent here were not split.
    pub parts: Vec<QuarterPart>,
    /// Outline of each split quarter before the split.
    pub originals: Vec<OriginalQuarter>,
}
/// Output quarter `quarter` is part `part` of source quarter `source`; its
/// edit key is `"<source>"` (part 0) or `"<source>/<part>"`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QuarterPart {
    pub quarter: usize,
    pub source: usize,
    pub part: usize,
    pub deleted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalQuarter {
    pub index: usize,
    pub shape: Shape,
}
/// Forced use of one lot: a catalogue role (`worship.parish`, `commerce.inn`,
/// `open.garden`, `dwelling.mansion`…), a houses function, a household count.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ParcelOverride {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub culture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_config: Option<serde_json::Value>,
    pub role: Option<String>,
    pub function: Option<String>,
    pub households: Option<f64>,
    /// New outline (`urban/edits.rs`), clipped to its block; neighbours give up
    /// or take back the difference. The lot keeps its id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// Split into 2..64 closed parts, clipped to the lot and each cut out of
    /// the ones before it. Part 0 keeps the id; part `k` is `"<id>/part-<k>"`
    /// (addressable by its own override). Exclusive with `shape`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<Shape>>,
    /// `merge` (absorbed by its best neighbour) or `garden` (unbuilt open ground).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<String>,
    /// Redraw of the lot's use among admissible demands, and of its house seed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt: Option<u32>,
}
