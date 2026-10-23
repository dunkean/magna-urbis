//! Retained authoritative urban geometry, independent of HTTP/session lookup.
//!
//! The caller owns the session and must look up an existing session for reads.
//! Invalidate before replacing terrain/layouts/partitions, including operations
//! that can fail; publish a handle only after successful retention. Coordinates
//! arrive already normalized by the boundary's existing decimal round trip.

use magna_urbis_core::{
    settlements,
    urban::{
        Layout, Partition,
        building_sites::{BuildingSiteIndex, MAX_SITE_PAGE_BYTES, SitePage},
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::RandomState,
    hash::BuildHasher,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;

/// Runtime reference only: never persist this in a decor or a share URL.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UrbanSourceHandle {
    pub version: u8,
    pub session: String,
    pub terrain_revision: String,
    pub layouts_revision: String,
    pub partitions_revision: String,
}

impl UrbanSourceHandle {
    pub fn validate_shape(&self) -> Result<()> {
        if self.version != 1 {
            return Err("[urban_source_version] Unsupported retained urban source version.".into());
        }
        for value in [
            &self.session,
            &self.terrain_revision,
            &self.layouts_revision,
            &self.partitions_revision,
        ] {
            if value.is_empty() || value.len() > 128 {
                return Err("[urban_source_invalid] Invalid retained urban source token.".into());
            }
        }
        Ok(())
    }
}

struct Retained<T> {
    revision: String,
    values: Arc<Vec<T>>,
}

/// One current snapshot, not an unbounded revision history. The existing
/// layoutsId cache may hold the same Arc, or a separate full set when this
/// snapshot comes from explicitly supplied layouts for one selected city.
#[derive(Default)]
pub(crate) struct RetainedUrban {
    terrain_revision: Option<String>,
    layouts: Option<Retained<Layout>>,
    partitions: Option<Retained<Partition>>,
    // At most one prepared query per retained snapshot. A new begin replaces
    // its index; no pages or duplicate cadastral geometry are retained here.
    building_sites: Option<PreparedBuildingSites>,
}

struct PreparedBuildingSites {
    id: String,
    seed: String,
    culture: Option<String>,
    selected: Vec<usize>,
    index: BuildingSiteIndex,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildingSitesBegin {
    pub source_id: String,
    pub total: usize,
}

pub(crate) struct UrbanSnapshot<'a> {
    pub layouts: &'a Arc<Vec<Layout>>,
    pub partitions: &'a Arc<Vec<Partition>>,
}

impl RetainedUrban {
    /// Call before accepting a replacement raster, even if its validation fails.
    pub fn invalidate_terrain(&mut self) {
        self.terrain_revision = None;
        self.invalidate_layouts();
    }

    /// Mark a successfully replaced terrain as ready. Repeated uploads always
    /// produce a new incarnation; equal payloads do not revive an old handle.
    pub fn retain_terrain(&mut self) -> Result<()> {
        self.invalidate_terrain();
        self.terrain_revision = Some(new_revision()?);
        Ok(())
    }

    /// Call before quarters generation/replacement.
    pub fn invalidate_layouts(&mut self) {
        self.layouts = None;
        self.invalidate_partitions();
    }

    pub fn retain_layouts(&mut self, layouts: Arc<Vec<Layout>>) -> Result<()> {
        self.require_terrain()?;
        let revision = new_revision()?;
        self.invalidate_layouts();
        self.layouts = Some(Retained {
            revision,
            values: layouts,
        });
        Ok(())
    }

    /// Call before parcels, programme reallocation or built-capacity changes.
    /// The layout Arc remains available for the new partition snapshot.
    pub fn invalidate_partitions(&mut self) {
        self.partitions = None;
        self.building_sites = None;
    }

    /// `layouts` is the exact authoritative input of these partitions. It may
    /// be a selected subset distinct from the caller's legacy layoutsId cache.
    /// Reuse its Arc to preserve the layout revision when only programme changes.
    pub fn retain_partitions(
        &mut self,
        layouts: Arc<Vec<Layout>>,
        partitions: Arc<Vec<Partition>>,
    ) -> Result<()> {
        self.require_terrain()?;
        let layout_revision = if self
            .layouts
            .as_ref()
            .is_some_and(|old| Arc::ptr_eq(&old.values, &layouts))
        {
            None
        } else {
            Some(new_revision()?)
        };
        let revision = new_revision()?;
        self.building_sites = None;
        if let Some(revision) = layout_revision {
            self.layouts = Some(Retained {
                revision,
                values: layouts,
            });
        }
        self.partitions = Some(Retained {
            revision,
            values: partitions,
        });
        Ok(())
    }

    pub fn source(&self, session: &str) -> Result<UrbanSourceHandle> {
        let handle = UrbanSourceHandle {
            version: 1,
            session: session.into(),
            terrain_revision: self.require_terrain()?.into(),
            layouts_revision: self.layouts.as_ref().ok_or_else(stale)?.revision.clone(),
            partitions_revision: self.partitions.as_ref().ok_or_else(stale)?.revision.clone(),
        };
        handle.validate_shape()?;
        Ok(handle)
    }

    /// `session` is the key from the caller's existing-session lookup. This
    /// method allocates no geometry, creates no session and changes no revision.
    pub fn validate_source(
        &self,
        session: &str,
        source: &UrbanSourceHandle,
    ) -> Result<UrbanSnapshot<'_>> {
        source.validate_shape()?;
        let layouts = self.layouts.as_ref().ok_or_else(stale)?;
        let partitions = self.partitions.as_ref().ok_or_else(stale)?;
        if source.session != session
            || self.terrain_revision.as_deref() != Some(source.terrain_revision.as_str())
            || layouts.revision != source.layouts_revision
            || partitions.revision != source.partitions_revision
        {
            return Err(stale());
        }
        Ok(UrbanSnapshot {
            layouts: &layouts.values,
            partitions: &partitions.values,
        })
    }

    fn require_terrain(&self) -> Result<&str> {
        self.terrain_revision.as_deref().ok_or_else(stale)
    }

    pub fn begin_building_sites(
        &mut self,
        session: &str,
        source: &UrbanSourceHandle,
        selected: &[usize],
        seed: &str,
        culture: Option<&str>,
    ) -> Result<BuildingSitesBegin> {
        let snapshot = self.validate_source(session, source)?;
        let index = BuildingSiteIndex::prepare(snapshot.layouts, snapshot.partitions, selected)?;
        let id = new_revision()?;
        let result = BuildingSitesBegin {
            source_id: id.clone(),
            total: index.total(),
        };
        self.building_sites = Some(PreparedBuildingSites {
            id,
            seed: seed.into(),
            culture: culture.map(str::to_owned),
            selected: selected.to_vec(),
            index,
        });
        Ok(result)
    }

    /// Every read validates both the complete snapshot handle and the query
    /// incarnation. Page offsets are replayable, not a destructive cursor.
    #[allow(clippy::too_many_arguments)]
    pub fn page_building_sites(
        &mut self,
        session: &str,
        source: &UrbanSourceHandle,
        source_id: &str,
        terrain: &settlements::Terrain,
        offset: usize,
        limit: usize,
        max_bytes: usize,
    ) -> Result<SitePage> {
        let snapshot = self.validate_source(session, source)?;
        // Clone only Arc handles so the query index can be borrowed mutably.
        let layouts = Arc::clone(snapshot.layouts);
        let partitions = Arc::clone(snapshot.partitions);
        let prepared = self.building_sites.as_mut().filter(|p| p.id == source_id)
            .ok_or("[urban_sites_stale] Building site query was replaced or expired; begin it explicitly.")?;
        terrain.urban_building_sites_page(
            &mut prepared.index,
            &prepared.seed,
            &layouts,
            &partitions,
            prepared.culture.as_deref(),
            offset,
            limit,
            max_bytes,
        )
    }

    /// A scene editor reads its original site from an immutable descriptor,
    /// independently of any later streaming query. Reuse the active index only
    /// for an exact match; otherwise the temporary index is dropped after one
    /// payload. This neither replaces the stream nor retains another snapshot.
    #[allow(clippy::too_many_arguments)]
    pub fn read_building_site(
        &mut self,
        session: &str,
        source: &UrbanSourceHandle,
        selected: &[usize],
        seed: &str,
        culture: Option<&str>,
        terrain: &settlements::Terrain,
        offset: usize,
        expected_id: &str,
        max_bytes: usize,
    ) -> Result<(serde_json::Value, usize)> {
        if !(2..=MAX_SITE_PAGE_BYTES).contains(&max_bytes) {
            return Err("[urban_site_budget] Building site budget must be in 2..=24 MiB.".into());
        }
        let snapshot = self.validate_source(session, source)?;
        let layouts = Arc::clone(snapshot.layouts);
        let partitions = Arc::clone(snapshot.partitions);
        let mut temporary;
        let index =
            if let Some(prepared) = self.building_sites.as_mut().filter(|p| {
                p.selected == selected && p.seed == seed && p.culture.as_deref() == culture
            }) {
                &mut prepared.index
            } else {
                temporary = BuildingSiteIndex::prepare(&layouts, &partitions, selected)?;
                &mut temporary
            };
        if offset >= index.total() {
            return Err(
                "[urban_site_offset] Building site offset is outside the selected source.".into(),
            );
        }
        let mut page = terrain.urban_building_sites_page(
            index,
            seed,
            &layouts,
            &partitions,
            culture,
            offset,
            1,
            max_bytes,
        )?;
        let site = page.requests.pop().ok_or_else(|| {
            format!(
                "[urban_site_budget] Building site requires {} bytes including array delimiters.",
                page.required_bytes.unwrap_or(0)
            )
        })?;
        if site["id"].as_str() != Some(expected_id) {
            return Err(
                "[urban_site_identity] Building site ID does not match the original scene locator."
                    .into(),
            );
        }
        Ok((site, page.total))
    }
}

fn stale() -> String {
    "[urban_source_stale] Retained urban source is absent or changed; regenerate it explicitly."
        .into()
}

fn new_revision() -> Result<String> {
    static INCARNATION: OnceLock<String> = OnceLock::new();
    static NEXT: AtomicU64 = AtomicU64::new(1);
    // A process incarnation plus a non-wrapping counter: independent of browser
    // request IDs, session eviction/recreation and equal geometry. The random
    // salt also separates process restarts after a clock adjustment. This is an
    // identity token, not authentication or a promise of cryptographic secrecy.
    let incarnation = INCARNATION.get_or_init(|| {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let pid = std::process::id();
        let salt = RandomState::new().hash_one((nanos, pid));
        format!("{nanos:032x}-{pid:08x}-{salt:016x}")
    });
    let mut sequence = NEXT.load(Ordering::Relaxed);
    loop {
        let next = sequence
            .checked_add(1)
            .ok_or("Urban revision counter exhausted.")?;
        match NEXT.compare_exchange_weak(sequence, next, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break,
            Err(current) => sequence = current,
        }
    }
    Ok(format!("urb-{incarnation}-{sequence:016x}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layouts(key: &str) -> Arc<Vec<Layout>> {
        Arc::new(
            serde_json::from_value(serde_json::json!([{
                "key":key,"culture":"european-organic","center":{"x":0.1,"y":-0.0},
                "quarters":[],"streets":[],"blocks":[],"warnings":[]
            }]))
            .unwrap(),
        )
    }

    fn partitions(key: &str) -> Arc<Vec<Partition>> {
        Arc::new(
            serde_json::from_value(serde_json::json!([{
                "key":key,"parcels":[],"warnings":[]
            }]))
            .unwrap(),
        )
    }

    #[test]
    fn snapshot_handles_share_exact_geometry_and_reject_every_invalidated_source() {
        let mut retained = RetainedUrban::default();
        let full_layouts = layouts("full");
        let first_partitions = partitions("full");
        assert!(retained.retain_layouts(full_layouts.clone()).is_err());
        assert!(retained.source("worker-session").is_err());
        retained.retain_terrain().unwrap();
        retained.retain_layouts(full_layouts.clone()).unwrap();
        retained
            .retain_partitions(full_layouts.clone(), first_partitions.clone())
            .unwrap();
        let first = retained.source("worker-session").unwrap();
        let wire = serde_json::to_value(&first).unwrap();
        assert_eq!(wire["version"], 1);
        assert!(wire.get("terrainRevision").is_some());
        let restored: UrbanSourceHandle = serde_json::from_value(wire).unwrap();
        let snapshot = retained
            .validate_source("worker-session", &restored)
            .unwrap();
        assert!(Arc::ptr_eq(snapshot.layouts, &full_layouts));
        assert!(Arc::ptr_eq(snapshot.partitions, &first_partitions));
        assert_eq!(
            snapshot.layouts[0].center.x.to_bits(),
            full_layouts[0].center.x.to_bits()
        );
        assert_eq!(retained.source("worker-session").unwrap(), first);
        assert!(retained.validate_source("another-session", &first).is_err());
        for field in 0..4 {
            let mut wrong = first.clone();
            match field {
                0 => wrong.version = 2,
                1 => wrong.terrain_revision.push('x'),
                2 => wrong.layouts_revision.push('x'),
                _ => wrong.partitions_revision.push('x'),
            }
            assert!(retained.validate_source("worker-session", &wrong).is_err());
        }

        retained.invalidate_partitions();
        assert!(retained.validate_source("worker-session", &first).is_err());
        retained
            .retain_partitions(full_layouts.clone(), partitions("programme"))
            .unwrap();
        let programme = retained.source("worker-session").unwrap();
        assert_eq!(programme.terrain_revision, first.terrain_revision);
        assert_eq!(programme.layouts_revision, first.layouts_revision);
        assert_ne!(programme.partitions_revision, first.partitions_revision);
        assert!(retained.validate_source("worker-session", &first).is_err());

        let selected = layouts("selected");
        retained
            .retain_partitions(selected.clone(), partitions("selected"))
            .unwrap();
        let subset = retained.source("worker-session").unwrap();
        assert_ne!(subset.layouts_revision, programme.layouts_revision);
        assert!(Arc::ptr_eq(
            retained
                .validate_source("worker-session", &subset)
                .unwrap()
                .layouts,
            &selected
        ));
        assert_eq!(full_layouts[0].key, "full"); // external full cache is unchanged
        retained.invalidate_layouts();
        assert!(retained.validate_source("worker-session", &subset).is_err());
        retained
            .retain_partitions(full_layouts.clone(), partitions("full"))
            .unwrap();
        let quarters = retained.source("worker-session").unwrap();
        assert_ne!(quarters.layouts_revision, subset.layouts_revision);
        retained.invalidate_terrain(); // a failed raster replacement stays invalid
        assert!(retained.source("worker-session").is_err());
        assert!(
            retained
                .validate_source("worker-session", &quarters)
                .is_err()
        );
        retained.retain_terrain().unwrap();
        retained
            .retain_partitions(full_layouts.clone(), partitions("full"))
            .unwrap();
        assert_ne!(
            retained.source("worker-session").unwrap().terrain_revision,
            quarters.terrain_revision
        );

        let mut recreated = RetainedUrban::default(); // same session ID after eviction
        recreated.retain_terrain().unwrap();
        recreated
            .retain_partitions(full_layouts, first_partitions)
            .unwrap();
        assert!(recreated.validate_source("worker-session", &first).is_err());
        assert_ne!(recreated.source("worker-session").unwrap(), first);
    }
}
