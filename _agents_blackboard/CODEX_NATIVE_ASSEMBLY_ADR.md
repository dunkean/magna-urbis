# ADR: explicit native two-member assembly, version 1

Status: proposed, isolated current-source copy only. No product promotion or author build/test/native execution. Workspace: `web/out/houses-native-assembly-contract-workspace`. Single `PlanBuilding`, `PlanBatch`, `realize_plan`, compact-plan-1 and their wire versions remain unchanged.

## Decision and exact API

A request still yields ONE parent result. A group is never a union relabelled as Single, nor two parents counted as two programmes. New opt-in capability `native-assembly-pair-1` is a normal native API in the isolated library, not a cfg(test) sidecar. Its initial constructor reuses the validated pair's source, actual seed, non-dimensional parameters, two dimension slots/four poses, one new rebuild/preparation and at most four new admissions. It is not an authored complete Javanese household grammar.

```rust
pub mod plans::assembly;
pub const ASSEMBLY_CAPABILITY: &str = "native-assembly-pair-1";
pub struct AssemblePairRequest {
    pub site: PlacementRequest,
    pub occupied_parts: Vec<Surface>,
    pub occupied_roof_parts: Vec<Surface>,
    pub incumbent: PlanBuilding,
}
pub enum AssemblyDecision {
    Retained { building: PlanBuilding, report: AssemblyAttemptReport },
    Assembled { assembly: RetainedNativeAssembly, archive: NativeAssemblyArchive, report: AssemblyAttemptReport },
}
pub fn assemble_pair(input: AssemblePairRequest) -> Result<AssemblyDecision, String>;
pub struct RetainedNativeAssembly {
    pub capability: String,
    pub id: String,
    pub parcel_id: String,
    pub programme: ArchitectureProgramme,
    pub members: [NativeAssemblyMember; 2],
    pub circulation: AssemblyCirculation,
    pub shared_context: Vec<Feature>,
    pub outcome: AssemblyProgrammeOutcome,
}
pub struct NativeAssemblyMember {
    pub key: String,
    pub plan: NativeMemberPlan,
}
// NativeMemberPlan stores the actual member's ID, parcel, function, culture,
// source/variant, transform, ground, body/roof/courts, native entrance point,
// volumes, structural features, cartographic envelope, diagnostics and
// CompactArchitecture. NO parent programme/household/need/outcome fields.
pub struct AssemblyCirculation {
    pub public_access: ArchitectureAccess,
    pub branches: [AssemblyBranch; 2],
}
// Each branch: member_key, full retained world path, native passage,
// actual contact, and a tagged target PublicAccess or MemberBranchCap.
// MemberBranchCap identifies the existing branch and its exact segment;
// it is never inserted into PlacementRequest.accesses as a fake public road.
pub struct NativeAssemblyArchive { /* lossless versioned native payload */ }
impl NativeAssemblyArchive {
    pub fn pack(value: &RetainedNativeAssembly) -> Result<Self, String>;
    pub fn unpack(&self) -> Result<RetainedNativeAssembly, String>;
}
pub struct RealizeAssemblyRequest {
    pub assembly: NativeAssemblyArchive,
    pub interiors: bool,
}
pub fn realize_assembly(input: RealizeAssemblyRequest)
    -> Result<RealizedNativeAssembly, String>;
// RealizedNativeAssembly retains the parent programme/outcome, explicit
// circulation/context and two keyed {ground_z_m, architecture: HouseBatch}.
// No flattening of member-local coordinates, graph IDs or per-source settings.
```

## Ownership, access and physical invariants

The programme and need belong to the parent once. Members contain no copied programme report or requested household credit. Actual body/roof/level geometry, source variant/config seed, compact native entrance, pose and independent foundation remain member-owned. All external site circulation belongs to `AssemblyCirculation`; native internal paths stay inside each member archive. Group-derived footprint/roof/occupation unions are measurements/index surfaces, never a substitute native member.

The old complete PlanBuilding is the fallback on every failed attempt. Successful assembly transfers its original site path unchanged into branch zero; its source/archive/body/pose/ground/native portal remain unchanged. Public API input is not a trusted admission token: validate the incumbent against its real site before using its path as an access anchor. This separate validation cost must be reported, never hidden in the new-member budget.

Branch one connects the added native portal to an exact full-width cap on the retained, publicly connected branch zero. Only actual branch geometry supplies targets. The existing native straight/analytic/one-bend connector guards are reused through a typed internal target; no replacement of the true public access or invented neighbour. Check complete path, actual passage, supports, body penetration, reserves, neighbours, cadastral rights and connection continuity. Old portal/circulation and both roof-to-other-occupation directions stay protected. No clipping, hull, new source draw, support freedom or relaxed 0.75 m/12 degree foundation limit.

Shared circulation initially describes a native planning **ground path reservation**, as existing public planning paths do; it does not invent a flat deck, ramp, stairs or universal walking-slope norm. Member endpoint elevations are explicit. Detailed path construction/functional accessibility remain unclassified unless a native operator certifies them; unknown is never presented as usable housing. Version 1 rejects unsupported context reconstruction rather than dropping or moving it: original member-local context remains in its archive; group-owned `shared_context` starts empty.

## Archive, replay and acceptance

The new archive preserves all retained f64 bits (including world pose/ground/path), embeds both true compact member archives and their group ownership/links. No parent query, terrain raster, archive reference alone or live resolver is needed to realize saved members. Unpack validates capability, unique keys/IDs, finite geometry, branch references, entry/target continuity and measured inventory. Realize invokes the ordinary retained native realization per member, preserving member-local graph IDs/settings and reporting their independent world foundations. It neither selects sources nor regenerates plans. Full detailed roof containment and interior/native-door errors propagate; no partial successful group response masks a failed member.

Gross area is the union of actual retained level footprints at each exact world elevation, including holes and heterogeneous levels. Unknown inventory stays unknown. Parent need is counted once; useful area and housed households remain unknown; sufficient gross is only a necessary-model check. Original massing wish/population/households stay unchanged.

Focused tests to prepare: legacy Single byte parity; exact fallback; true internal-to-public connected assembly; blocked or disconnected target rejection; two archive/realize members including interiors/error propagation; lossless f64 archive roundtrip and malformed capability/reference rejection; same fixed 22 real cases with no gain-selected reselection. Root alone executes. Later bridge integration needs one tagged parent record plus distinct member count and parentId/memberId picking, not flattening into existing buildings; parameters_ui coordinates that consumer contract separately.
