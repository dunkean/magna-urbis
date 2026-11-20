//! Urban products resident in one WASM instance, addressed by ids: stages pass
//! handles instead of re-sending JSON geometry (layouts ≈1.5 MB, partitions
//! ≈4 MB for a 10k town). Each product is retained after the decimal round trip
//! the JSON boundary applies (and the native server applies, `urban_session.rs`),
//! so a resident stage sees exactly the numbers an uploaded one would.
//! JSON still leaves Rust once per stage, for the UI that edits and inspects plans.
//! The `_pack` twins and pack reads return partitions as a `magna-city-parcels`
//! pack (`urban::parcel_pack`, the same bytes the native engine replies with);
//! every pack header carries `partitionsId`: the id under which exactly those
//! partitions are resident here, 0 when they are not retained.
use crate::settlements::SettlementTerrain;
use magna_urbis_core::urban::{parcel_pack, Layout, Partition};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

/// Groups of a built-capacity reply: what `reconcile_built` changes.
const BUILT_CAPACITY_GROUPS: [&str; 4] = ["allocations", "floorNeed", "adjacency", "environment"];

/// Ids are never reused within an instance; 0 means "none".
#[derive(Default)]
pub(crate) struct Resident {
    next: u32,
    layouts: Option<(u32, Arc<Vec<Layout>>)>,
    partitions: Option<(u32, Arc<Vec<Partition>>)>,
}

impl Resident {
    fn id(&mut self) -> u32 {
        self.next = self.next.wrapping_add(1).max(1);
        self.next
    }
    fn clear(&mut self) {
        self.layouts = None;
        self.partitions = None;
    }
    fn set_layouts(&mut self, layouts: Vec<Layout>) -> u32 {
        let id = self.id();
        self.layouts = Some((id, Arc::new(layouts)));
        self.partitions = None;
        id
    }
    fn set_partitions(&mut self, partitions: Vec<Partition>) -> u32 {
        let id = self.id();
        self.partitions = Some((id, Arc::new(partitions)));
        id
    }
    fn layouts(&self, id: u32) -> Result<Arc<Vec<Layout>>, JsValue> {
        match &self.layouts {
            Some((current, values)) if *current == id => Ok(Arc::clone(values)),
            _ => Err(stale("layouts")),
        }
    }
    fn partitions(&self, id: u32) -> Result<Arc<Vec<Partition>>, JsValue> {
        match &self.partitions {
            Some((current, values)) if *current == id => Ok(Arc::clone(values)),
            _ => Err(stale("partitions")),
        }
    }
}

fn stale(what: &str) -> JsValue {
    JsValue::from_str(&format!(
        "[urban_resident_stale] Resident {what} were replaced; resend them."
    ))
}

fn js_err(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Pack groups from a comma-separated list; empty: every group. Unknown names
/// are refused by `parcel_pack::pack`.
fn pack_groups(groups: &str) -> Option<Vec<&str>> {
    let list: Vec<&str> = groups
        .split(',')
        .map(str::trim)
        .filter(|g| !g.is_empty())
        .collect();
    (!list.is_empty()).then_some(list)
}

/// A pack of `partitions` whose header envelope is `{ "partitionsId": id }`.
fn pack_reply(
    partitions: &[Partition],
    groups: Option<&[&str]>,
    partitions_id: u32,
) -> Result<Vec<u8>, JsValue> {
    let envelope = serde_json::json!({ "partitionsId": partitions_id });
    parcel_pack::pack(partitions, groups, &envelope).map_err(js_err)
}

/// The JSON boundary's decimal normalisation, in Rust: serialise once (that text
/// is also what JS receives) and retain the reparsed values.
fn normalised<T: serde::Serialize + serde::de::DeserializeOwned>(
    values: &T,
) -> Result<(String, T), JsValue> {
    let json = serde_json::to_string(values).map_err(js_err)?;
    let parsed = serde_json::from_str(&js_numbers(&json)).map_err(js_err)?;
    Ok((json, parsed))
}

/// The JS round trip (`JSON.stringify(JSON.parse(text))`) also turns `-0.0`
/// into `0`: apply it to number tokens (never inside strings) so resident
/// products equal the ones a JS caller used to re-send.
pub(crate) fn js_numbers(json: &str) -> std::borrow::Cow<'_, str> {
    let bytes = json.as_bytes();
    let (mut in_string, mut escaped, mut out, mut copied) = (false, false, None::<String>, 0);
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else if b == b'"' {
            in_string = true;
        } else if b == b'-'
            && bytes[i..].starts_with(b"-0.0")
            && !bytes
                .get(i + 4)
                .is_some_and(|c| c.is_ascii_digit() || *c == b'e' || *c == b'E')
        {
            let out = out.get_or_insert_with(|| String::with_capacity(json.len()));
            out.push_str(&json[copied..i]);
            out.push_str("0.0");
            copied = i + 4;
            i += 4;
            continue;
        }
        i += 1;
    }
    match out {
        None => std::borrow::Cow::Borrowed(json),
        Some(mut out) => {
            out.push_str(&json[copied..]);
            std::borrow::Cow::Owned(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::js_numbers;

    #[test]
    fn negative_zero_tokens_follow_the_js_round_trip_outside_strings() {
        let text = r#"{"a":-0.0,"b":[-0.0],"c":-0.05,"d":"x -0.0, \"-0.0\"","e":-0.0e1}"#;
        assert_eq!(
            js_numbers(text),
            r#"{"a":0.0,"b":[0.0],"c":-0.05,"d":"x -0.0, \"-0.0\"","e":-0.0e1}"#
        );
        assert!(matches!(
            js_numbers(r#"{"a":1.0}"#),
            std::borrow::Cow::Borrowed(_)
        ));
    }

    /// The pool's binary image carries exactly the products the JSON text did.
    /// Uses a saved city (`MAGNA_URBAN_FIXTURE`: layouts.json, partitions.json).
    #[test]
    fn binary_image_round_trip_equals_the_json_products() {
        let Some(dir) = std::env::var_os("MAGNA_URBAN_FIXTURE") else {
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let read = |name: &str| std::fs::read_to_string(dir.join(name)).unwrap();
        let layouts: Vec<super::Layout> = serde_json::from_str(&read("layouts.json")).unwrap();
        let partitions: Vec<super::Partition> =
            serde_json::from_str(&read("partitions.json")).unwrap();
        let image = rmp_serde::to_vec_named(&super::ImageRef {
            layouts: &layouts,
            partitions: Some(&partitions),
        })
        .unwrap();
        let back: super::Image = rmp_serde::from_slice(&image).unwrap();
        assert_eq!(
            serde_json::to_string(&back.layouts).unwrap(),
            serde_json::to_string(&layouts).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&back.partitions.unwrap()).unwrap(),
            serde_json::to_string(&partitions).unwrap()
        );
    }
}

/// Binary image (MessagePack, named fields) of resident products for another
/// instance of the same module (`urbanPool.ts` workers): exact f64 bits,
/// transferred once and decoded once per worker, never per slice.
#[derive(serde::Serialize)]
struct ImageRef<'a> {
    layouts: &'a [Layout],
    partitions: Option<&'a [Partition]>,
}
#[derive(serde::Deserialize)]
struct Image {
    layouts: Vec<Layout>,
    partitions: Option<Vec<Partition>>,
}

/// Work shared by the text exports and their pack twins.
impl SettlementTerrain {
    /// Parcels of resident layouts `start..end` (clamped) and whether the range
    /// covers every layout; a full range drops the resident partitions first.
    fn resident_parcels(
        &mut self,
        seed: &str,
        layouts_id: u32,
        config: &str,
        start: u32,
        end: u32,
    ) -> Result<(Vec<Partition>, bool), JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let end = (end as usize).min(layouts.len());
        let start = (start as usize).min(end);
        let full = start == 0 && end == layouts.len();
        if full {
            self.resident.partitions = None;
        }
        let cfg = serde_json::from_str(config).map_err(js_err)?;
        let output = magna_urbis_core::urban::generate_parcels(seed, &layouts[start..end], &cfg)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok((output, full))
    }
    /// Programme reallocation of resident products; the resident partitions
    /// are dropped (the caller retains the result).
    fn resident_programme(
        &mut self,
        layouts_id: u32,
        partitions_id: u32,
    ) -> Result<Vec<Partition>, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = self.resident.partitions(partitions_id)?;
        self.resident.partitions = None;
        magna_urbis_core::urban::programme::reallocate(&layouts, &partitions)
            .map_err(|e| JsValue::from_str(&e))
    }
    /// Normalise `output` (`normalised()`, the values every later stage reads),
    /// retain it and return the pack of the retained partitions.
    fn retain_and_pack(&mut self, output: Vec<Partition>) -> Result<Vec<u8>, JsValue> {
        let (_, partitions) = normalised(&output)?;
        drop(output);
        let id = self.resident.set_partitions(partitions);
        let partitions = self.resident.partitions(id)?;
        pack_reply(&partitions, None, id)
    }
}

#[wasm_bindgen]
impl SettlementTerrain {
    /// Quarters as `urban_quarters`, retained under `resident_layouts_id()`.
    /// Returns the JSON text for the UI (the only copy that crosses to JS).
    pub fn urban_quarters_resident(
        &mut self,
        seed: &str,
        sites: &str,
        config: &str,
        roads: &str,
    ) -> Result<String, JsValue> {
        self.resident.clear();
        let sites =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Site>>(sites).map_err(js_err)?;
        let cfg = serde_json::from_str(config).map_err(js_err)?;
        let roads =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Street>>(roads).map_err(js_err)?;
        let output = self
            .inner
            .urban_quarters(seed, &sites, &cfg, &roads)
            .map_err(|e| JsValue::from_str(&e))?;
        let (json, layouts) = normalised(&output)?;
        self.resident.set_layouts(layouts);
        Ok(json)
    }
    /// Quarters of several independent towns in one call, each job exactly the
    /// call `urban_quarters_resident(seed, sites, config, roads)` would make. The
    /// jobs run as parallel items of the rayon pool (threads build), so towns share
    /// one instance and one pool. Replies each job's layouts JSON, in job order,
    /// separated by U+001E (never present in JSON text); nothing is made resident.
    /// The first error in job order wins.
    pub fn urban_quarters_batch(&self, jobs: &str) -> Result<String, JsValue> {
        #[derive(serde::Deserialize)]
        struct Job {
            seed: String,
            sites: Vec<magna_urbis_core::urban::Site>,
            config: magna_urbis_core::urban::LayoutConfig,
            roads: Vec<magna_urbis_core::urban::Street>,
        }
        let jobs = serde_json::from_str::<Vec<Job>>(jobs).map_err(js_err)?;
        let inner = &self.inner;
        let run = |job: &Job| -> Result<String, String> {
            let output = inner.urban_quarters(&job.seed, &job.sites, &job.config, &job.roads)?;
            serde_json::to_string(&output).map_err(|e| e.to_string())
        };
        #[cfg(feature = "threads")]
        let results: Vec<Result<String, String>> = {
            use rayon::prelude::*;
            jobs.par_iter().map(run).collect()
        };
        #[cfg(not(feature = "threads"))]
        let results: Vec<Result<String, String>> = jobs.iter().map(run).collect();
        let texts = results.into_iter().collect::<Result<Vec<_>, _>>().map_err(|e| JsValue::from_str(&e))?;
        Ok(texts.join("\u{1e}"))
    }
    /// Retain layouts given as JSON (explicit plans, or pool slices merged as
    /// text). Returns their id; partitions are dropped.
    pub fn retain_layouts_json(&mut self, layouts: &str) -> Result<u32, JsValue> {
        self.resident.clear();
        let layouts = serde_json::from_str::<Vec<Layout>>(&js_numbers(layouts)).map_err(js_err)?;
        Ok(self.resident.set_layouts(layouts))
    }
    /// Retain partitions given as JSON next to the current resident layouts.
    pub fn retain_partitions_json(&mut self, partitions: &str) -> Result<u32, JsValue> {
        self.resident.partitions = None;
        let partitions =
            serde_json::from_str::<Vec<Partition>>(&js_numbers(partitions)).map_err(js_err)?;
        Ok(self.resident.set_partitions(partitions))
    }
    pub fn resident_layouts_id(&self) -> u32 {
        self.resident.layouts.as_ref().map_or(0, |(id, _)| *id)
    }
    pub fn resident_partitions_id(&self) -> u32 {
        self.resident.partitions.as_ref().map_or(0, |(id, _)| *id)
    }
    pub fn resident_layouts_len(&self) -> u32 {
        self.resident
            .layouts
            .as_ref()
            .map_or(0, |(_, l)| l.len() as u32)
    }
    pub fn drop_resident(&mut self) {
        self.resident.clear();
    }
    /// Parcels of resident layouts `start..end` (clamped; all: `0, u32::MAX`).
    /// The full range is retained under `resident_partitions_id()`; a slice
    /// (pool participant) is only returned.
    pub fn urban_parcels_resident(
        &mut self,
        seed: &str,
        layouts_id: u32,
        config: &str,
        start: u32,
        end: u32,
    ) -> Result<String, JsValue> {
        let (output, full) = self.resident_parcels(seed, layouts_id, config, start, end)?;
        if !full {
            return serde_json::to_string(&output).map_err(js_err);
        }
        let (json, partitions) = normalised(&output)?;
        self.resident.set_partitions(partitions);
        Ok(json)
    }
    /// `urban_parcels_resident` returning a full pack instead of the JSON text.
    /// The full range is normalised, retained and packed from the retained
    /// values (`partitionsId` in the header); a slice is packed as computed,
    /// not retained (`partitionsId` 0).
    pub fn urban_parcels_resident_pack(
        &mut self,
        seed: &str,
        layouts_id: u32,
        config: &str,
        start: u32,
        end: u32,
    ) -> Result<Vec<u8>, JsValue> {
        let (output, full) = self.resident_parcels(seed, layouts_id, config, start, end)?;
        if !full {
            return pack_reply(&output, None, 0);
        }
        self.retain_and_pack(output)
    }
    /// Programme reallocation of resident products; the result replaces them.
    pub fn urban_programme_resident(
        &mut self,
        layouts_id: u32,
        partitions_id: u32,
    ) -> Result<String, JsValue> {
        let result = self.resident_programme(layouts_id, partitions_id)?;
        let (json, partitions) = normalised(&result)?;
        self.resident.set_partitions(partitions);
        Ok(json)
    }
    /// `urban_programme_resident` returning a full pack of the retained
    /// result (`partitionsId` in the header) instead of the JSON text.
    pub fn urban_programme_resident_pack(
        &mut self,
        layouts_id: u32,
        partitions_id: u32,
    ) -> Result<Vec<u8>, JsValue> {
        let result = self.resident_programme(layouts_id, partitions_id)?;
        self.retain_and_pack(result)
    }
    /// Pack of the resident partitions `partitions_id`; `groups` is a
    /// comma-separated list of `parcel_pack::GROUPS` (empty: all).
    pub fn urban_parcel_pack_resident(
        &self,
        partitions_id: u32,
        groups: &str,
    ) -> Result<Vec<u8>, JsValue> {
        let partitions = self.resident.partitions(partitions_id)?;
        let groups = pack_groups(groups);
        pack_reply(&partitions, groups.as_deref(), partitions_id)
    }
    /// Retain the partitions of a full pack (`urban_parcel_pack_resident` with
    /// every group, or a native pack reply) next to the current resident
    /// layouts. Returns their new id.
    pub fn retain_partitions_pack(&mut self, bytes: &[u8]) -> Result<u32, JsValue> {
        self.resident.partitions = None;
        let partitions = parcel_pack::unpack(bytes).map_err(js_err)?;
        Ok(self.resident.set_partitions(partitions))
    }
    /// `urban_built_capacity` on resident partitions (`scene`: the same JSON).
    /// The result is not retained; it is packed as computed with the groups
    /// `reconcile_built` changes (`partitionsId` 0).
    pub fn urban_built_capacity_resident(
        &self,
        partitions_id: u32,
        scene: &str,
    ) -> Result<Vec<u8>, JsValue> {
        let partitions = self.resident.partitions(partitions_id)?;
        let scene =
            serde_json::from_str::<magna_urbis_core::urban::programme::BuiltScene>(scene)
                .map_err(js_err)?;
        let result = magna_urbis_core::urban::programme::reconcile_built(&partitions, &scene)
            .map_err(|e| JsValue::from_str(&e))?;
        pack_reply(&result, Some(&BUILT_CAPACITY_GROUPS[..]), 0)
    }
    /// JSON text of `parcel_pack::record`: parcel `index` of the resident
    /// partition `key` with its allocations, adjacency and environment.
    pub fn urban_parcel_record_resident(
        &self,
        partitions_id: u32,
        key: &str,
        index: u32,
    ) -> Result<String, JsValue> {
        let partitions = self.resident.partitions(partitions_id)?;
        let partition = partitions
            .iter()
            .find(|p| p.key == key)
            .ok_or_else(|| JsValue::from_str(&format!("No resident partition {key:?}")))?;
        let record = parcel_pack::record(partition, index as usize).map_err(js_err)?;
        serde_json::to_string(&record).map_err(js_err)
    }
    pub fn urban_building_sites_total_resident(
        &self,
        layouts_id: u32,
        partitions_id: u32,
    ) -> Result<u32, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = self.resident.partitions(partitions_id)?;
        magna_urbis_core::urban::building_sites::request_count(&layouts, &partitions)
            .map(|n| n as u32)
            .map_err(|e| JsValue::from_str(&e))
    }
    /// Building sites `start..end` (clamped) of resident products, as a JSON
    /// array: the houses planner consumes placement requests as JSON.
    pub fn urban_building_sites_resident(
        &self,
        seed: &str,
        layouts_id: u32,
        partitions_id: u32,
        architecture_culture: Option<String>,
        start: u32,
        end: u32,
    ) -> Result<String, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = self.resident.partitions(partitions_id)?;
        let result = self
            .inner
            .urban_building_sites_range(
                seed,
                &layouts,
                &partitions,
                architecture_culture.as_deref(),
                start as usize,
                end as usize,
            )
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&result).map_err(js_err)
    }
    /// Display rows of the building sites of resident products: the
    /// `magna-city-sites` blob of the native `buildingSiteVisuals` read (origin =
    /// first layout centre), generated in chunks without the request trees.
    pub fn urban_building_site_display_resident(
        &self,
        seed: &str,
        layouts_id: u32,
        partitions_id: u32,
        architecture_culture: Option<String>,
        version: u32,
    ) -> Result<Vec<u8>, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = self.resident.partitions(partitions_id)?;
        let origin = layouts
            .first()
            .map_or(magna_urbis_core::urban::Point { x: 0.0, y: 0.0 }, |layout| layout.center);
        self.inner
            .urban_building_site_display(
                seed,
                &layouts,
                &partitions,
                architecture_culture.as_deref(),
                origin,
                version,
            )
            .map_err(|e| JsValue::from_str(&e))
    }
    /// Display buffers (`urban::display`, same blob as the native
    /// `displayBuffers` read) of resident products; `partitions_id` 0: none.
    pub fn urban_display_buffers_resident(
        &self,
        layouts_id: u32,
        partitions_id: u32,
        ids: bool,
    ) -> Result<Vec<u8>, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = if partitions_id == 0 {
            Arc::new(Vec::new())
        } else {
            self.resident.partitions(partitions_id)?
        };
        Ok(magna_urbis_core::urban::display::display_buffers(
            &layouts,
            &partitions,
            ids,
        ))
    }
    /// MessagePack image of resident products (`partitions_id` 0: layouts only)
    /// for `import_resident` in another instance.
    pub fn export_resident(&self, layouts_id: u32, partitions_id: u32) -> Result<Vec<u8>, JsValue> {
        let layouts = self.resident.layouts(layouts_id)?;
        let partitions = if partitions_id == 0 {
            None
        } else {
            Some(self.resident.partitions(partitions_id)?)
        };
        let image = ImageRef {
            layouts: &layouts,
            partitions: partitions.as_deref().map(Vec::as_slice),
        };
        rmp_serde::to_vec_named(&image).map_err(js_err)
    }
    /// Replace the resident products by an `export_resident` image; returns the
    /// new layouts id (`resident_partitions_id()` is 0 without partitions).
    pub fn import_resident(&mut self, image: &[u8]) -> Result<u32, JsValue> {
        self.resident.clear();
        let image: Image = rmp_serde::from_slice(image).map_err(js_err)?;
        let id = self.resident.set_layouts(image.layouts);
        if let Some(partitions) = image.partitions {
            self.resident.set_partitions(partitions);
        }
        Ok(id)
    }
}
