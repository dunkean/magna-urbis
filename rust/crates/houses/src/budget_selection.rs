//! Private result of one shared domestic budget search. No second search budget.
use super::*;

pub(super) struct Selection {
    pub(super) building: PlanBuilding,
    // Present only if a later adapted-minimum candidate improved the nominal
    // winner. This is an admitted plan, before ordinary final entry retention.
    pub(super) nominal: Option<PlanBuilding>,
}

impl Selection {
    pub(super) fn single(building: PlanBuilding) -> Self {
        Self { building, nominal: None }
    }

    pub(super) fn finalize(self, r: &PlacementRequest, occupied: &Surface) -> PlanBuilding {
        let finalized = retain_final_native_entry_result(r, occupied, self.building);
        let mut chosen = finalized.building;
        if finalized.policy == FinalEntryPolicy::PreserveWinningGeometry {
            if self.nominal.is_some() && !chosen.resolved.has_retained_entrance() {
                chosen.diagnostics.push("Adapted domestic budget selection: final shared-structure entrance preparation did not certify the winning pose; its admitted dimensions and programme were retained with the explicit proxy limitation. No nominal dimension fallback, extra final preparation, pose or door was attempted.".into());
            }
            return chosen;
        }
        let Some(nominal) = self.nominal else { return chosen; };
        // The adapted scope is one Single rectangle. Its existing finalizer
        // checks precisely the retained pose, with no door/pose alternatives.
        // Read the retained certificate, never infer success from diagnostics.
        if chosen.resolved.has_retained_entrance() {
            return chosen;
        }
        // At most one additional FINAL entry preparation/admission, separate
        // from the shared 8 dimensions / 24 budget admissions / 8 guide calls.
        // This historical safeguard remains unchanged for plain Singles.
        // Shared structural details returned above without changing dimensions.
        let mut fallback = retain_final_native_entry(r, occupied, nominal);
        if fallback.resolved.has_retained_entrance() {
            fallback.diagnostics.push("Adapted domestic budget selection: adapted area winner had no retained native entrance; the best nominal plan and its certified existing-pose entrance were retained. At most 1 additional final Single entry check; no new dimension, pose, door or source.".into());
            fallback
        } else {
            chosen.diagnostics.push("Adapted domestic budget selection: neither area winner nor nominal fallback obtained a retained native entrance; the better admitted area was retained. At most 1 additional final Single entry check; no new dimension, pose, door or source.".into());
            chosen
        }
    }
}
