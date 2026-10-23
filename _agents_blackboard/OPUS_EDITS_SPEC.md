# OPUS_EDITS_SPEC: edit, delete or reroll a quarter or a parcel (City Bench)

Stage: DESIGN. This document is the only file the stage writes. It covers two TODO.md Features items:
« Editer/supprimer formes quartier et parcelles » and « random sur le contenu d'un quartier ou parcelle ».

What the user gets in the City Bench inspector:
1. Edit the polygon of the selected quarter or lot: drag a vertex, add one, remove one. Delete a quarter or a lot.
2. « Tirer au sort »: redraw the content of a quarter (its streets, blocks, lots and the roles inside, with its
   shape and the rest of the city kept), or of a lot (its role among the compatible ones, and its building).
   The draw is deterministic for a given salt, so it survives share links and MU1 codes.

## 0. The current edit path (read end to end)

| Step | Where | What |
|---|---|---|
| UI | `web/src/ui/cityInspector.ts` | `quarterSection` / `lotSection` / `houseSection`. A form inside `<details class="city-edit">` with « Appliquer » / « Réinitialiser », a « modifié » badge and a `[data-edit-status]` line. The quarter key is `String(block.quarter)`, i.e. the index in `layout.quarters`. The lot key is `parcel.id`. |
| State | `web/src/ui/cityEdits.ts` | `CityEdits {quarters, parcels, buildings}`. `normalizeEdits` uses one cleaner per scope. `setEdit` merges fields, and an undefined field removes that field (through `compact`). `layoutWithEdits` / `parcelWithEdits` inject `overrides` only when edits exist. |
| Glue | `web/src/ui/terrainUrban.ts` ~1026-1036 | `inspectorHooks.editQuarter` → `request('quarters')`; `editLot` → `request('parcels')`. `editsBefore` is restored when the engine refuses an edit. `editsReport()` writes the counter and « Tout réinitialiser ». `share()` writes `urban.edits` into the query, so edits reach links, decors and MU1 codes (`citySituation.ts` packs the whole query; nothing needs to change there). |
| Contract | `rust/bridge/urbanConfig.ts` | `ParcelConfig.overrides?: UrbanEdits`, `UrbanEdits {quarters?, parcels?}`, `QuarterOverride`. The lot type is inline. |
| Rust types | `urban/mod.rs` ~403-520 | `UrbanOverrides {quarters: BTreeMap<String, QuarterOverride>}` sits inside `LayoutConfig` (`deny_unknown_fields`). `QuarterOverride` and `ParcelOverride` are `serde(default, camelCase)` without `deny_unknown_fields`. |
| Quarter use | `quarters.rs` 2642 (`cut` closure) | culture/tissue/density replace the morph. The RNG is `rng.fork("quarter:{i}")`. Line 3380 (`borrowed_quarters`) skips any quarter that has a key. Lines 3263-3272 append the edited culture phase. |
| Role use | `roles.rs` 663 | role/wealth: the quarter becomes its own district. Only entries that carry a role or a wealth are read. |
| Lot cut use | `parcels.rs` 2330 | quarter density/tissue → that quarter's lot morph. Each block's RNG is `root.fork(&block_id)`, where `block_id` is a geometry hash. |
| Lot use | `programme.rs` 1506-1540 | Band 0 forces `role/function/households` onto a lot. An unknown id gives the warning `Parcelle « id » introuvable`, never a crash. |
| Building seed | `building_sites.rs` 744 / 876 / 890 | `format!("{seed}/{}", parcel.id)`. The building id is `{parcel.id}/building`. |

Facts that drive the design:
- **Parcel ids hash geometry.** The format is `layout-<key>/block-<hash>/parcel-<hash>`. A block that keeps its shape
  keeps the ids of its lots and gets the same lot cut. A block whose shape changes gets new ids for all its lots.
- **The quarter stage is global after the cut.** `network::clean`, `hierarchy`, `widths::harmonize`, the peripheral
  frontage and `access::refine` (budget 96) all run on the whole network. Later quarters also re-read the streets of
  earlier ones (`Read`). So editing quarter *i* in place makes small changes elsewhere: the existing test
  `steep_bay_…_overrides_stay_local` accepts up to 25 % of quarters changed.
- **Lot cutting reads a global pressure** (`programme.environment[b].pressure`, computed by network centrality in
  `programme::prepare`). New streets in quarter *i* therefore change lot sizes everywhere unless pressure is frozen.
- `Shape` does not derive `PartialEq`, but `QuarterOverride` does. Adding `shape: Option<Shape>` requires
  `PartialEq` on `Shape` (`Point` already has it).
- Struct literals of `QuarterOverride` and `ParcelOverride` (tests in roles.rs, parcels.rs and quarters.rs) all use
  `..Default::default()`, so new fields are source-compatible.

## (a) Contract

### TypeScript: `rust/bridge/urbanConfig.ts` (ours)

```ts
/** A user-drawn polygon in world metres (outer ring, optional holes); rounded to 0.1 m by the UI. */
export interface EditShape { outer: { x: number; y: number }[]; holes?: { x: number; y: number }[][] }
export interface QuarterOverride {
  culture?: string; tissue?: string; density?: number; role?: string; wealth?: number;
  /** New outline of the quarter. The engine clips it (see b.2), so the applied shape can be smaller. */
  shape?: EditShape;
  /** The quarter's blocks and lots are removed. The land returns to open ground; main streets stay. */
  deleted?: boolean;
  /** Redraw of the quarter's interior: 1, 2, 3… (absent = the original draw). */
  salt?: number;
}
export interface ParcelOverride {
  role?: string; function?: string; households?: number;
  /** New outline of the lot, clipped to its block. Neighbours give up or take back the difference. */
  shape?: EditShape;
  /** 'merge': the lot is absorbed by its best neighbour (default of « Supprimer »).
   *  'garden': the lot stays, as unbuilt open ground. */
  deleted?: 'merge' | 'garden';
  /** Redraw of the lot's role among admissible demands, plus its building seed. */
  salt?: number;
}
export interface UrbanEdits { quarters?: Record<string, QuarterOverride>; parcels?: Record<string, ParcelOverride> }
```

`cityEdits.ts` re-exports these types instead of keeping its own `QuarterEdit` / `LotEdit` copies (alias them for
callers). The cleaners extend as follows:
- `shape`: outer ring of 3 to 512 points; every coordinate finite and inside `[-1e6, 1e6]`; rounded to 0.1 m;
  consecutive duplicates dropped; at most 16 holes. Anything else drops the field.
- `salt`: an integer in 1 to 2^31−1. 0 or any other value drops the field.
- `deleted`: `true` only (quarter) or `'merge' | 'garden'` (lot). Anything else drops the field.

### Rust: `urban/mod.rs` (additive, no default changes)

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]   // + PartialEq (one token)
pub struct Shape { … }

pub struct QuarterOverride {
    pub role: Option<String>, pub wealth: Option<f64>, pub culture: Option<String>,
    pub tissue: Option<String>, pub density: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub shape: Option<Shape>,
    #[serde(skip_serializing_if = "Option::is_none")] pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")] pub salt: Option<u32>,
}
pub struct ParcelOverride {
    pub role: Option<String>, pub function: Option<String>, pub households: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub shape: Option<Shape>,
    /// "merge" | "garden"; anything else is a validation error.
    #[serde(skip_serializing_if = "Option::is_none")] pub deleted: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub salt: Option<u32>,
}
```

- The `skip_serializing_if` attributes keep the echoed `layout.config` / `partition.config` byte-identical for links
  that have no new fields. The existing fields serialize `null` and stay unchanged.
- `mod edits;` is added next to the other modules.
- An engine that predates this work ignores the new keys, because the override structs do not deny unknown fields.
  The UI detects this case: when the echoed `layout.config.overrides.quarters[k]` lacks a `salt` or `shape` that was
  sent, it shows « Moteur sans retouche de forme : reconstruire le serveur natif ».

### Keys and ID stability rules

1. **Quarter key** is the index in `layout.quarters`, as today.
   - Composition quarters keep their index under every edit, because the splice in b.1 never renumbers them.
   - Peripheral frontage strips (appended last) keep their index too, because the splice keeps the base plan's strips.
   - Structural edits are offered only when the City Bench targets one city (`target !== 'all'`). In multi-city
     requests the key is ambiguous (existing limitation).
   - Second guard: a `shape` must overlap the original quarter by at least 10 % of the quarter's area, or it is
     ignored with a warning.
2. **A quarter that is rerolled, reshaped or deleted** gets new blocks, so the lots inside it get new ids.
   - Lot edits and house edits keyed on the old ids become **dormant**. They are never deleted automatically and
     never crash anything: the programme emits its `Parcelle « … » introuvable` warning and house edits find no
     request.
   - Resetting the quarter edit restores the old geometry, hence the old ids, so dormant edits apply again.
   - The UI counts dormant edits (keys absent from the current plan) and offers « Purger les retouches inactives ».
3. **A lot edited in geometry (shape or merge) keeps its id.** Its neighbours keep theirs too. Ids are computed by the
   cut, before edits apply, and the post-pass never re-hashes them.
   - The absorbed id of a merge is appended to the survivor's `parent_ids`, with provenance `edit:merged`.
   - A remainder that nobody takes becomes a new lot with id `<id>/reste-<k>` (k in ring order).
   - The cut is deterministic, so the same pre-edit ids reappear on every run and the edits re-apply.
4. **Salt never changes an id by itself.** A lot salt keeps the lot and building ids (the house style edit stays).
   A quarter salt changes the geometry of the lots inside it, hence their ids (rule 2).
5. **Warnings name the item.** They are prefixed `Retouche Q<n> :` or `Retouche parcelle <id> :`, so the inspector
   can show each warning under its own item.

## (b) Rust semantics: new module `rust/crates/core/src/urban/edits.rs`

One owner, ours. Everything below is implemented there and reached through one-line hooks.

### b.1 Quarter structural edits: two plans and a splice

Applying structural edits inside `quarters::generate` cannot keep the other quarters byte-identical, because of the
global passes listed in section 0. Structural edits are therefore applied by **splicing**:

```
L0 = plan(strip(cfg))      // exactly today's output: structural fields removed (empty entries dropped)
L1 = plan(variant(cfg))    // only when a salt or shape exists: same plan with salted forks and reshaped quarters
S  = splice(L0, L1, E)     // E = quarters with a structural edit (deleted wins over shape and salt)
finish(S)                  // access::summarize, programme::prepare (programme reset to None first), kinds::finish
freeze(S, finish(clone L0))   // untouched blocks keep L0's pressure; untouched districts keep L0's role and wealth
S.config = full cfg        // the parcel stage sees salt and deleted
```

- **No structural edit → `plan(cfg)` then `finish` and nothing else.** The output is byte-identical to today
  (test T2).
- Cost: about 2× the layout time, and only while a structural quarter edit exists. L1 still cuts every quarter.
  An optional `#[serde(skip)] variant_only` flag can later skip the unedited cuts.

`splice(L0, L1, E)` produces each field as follows (all deterministic, iterating in BTreeMap order):

- **quarters**
  - The base is `L0.quarters` (count, order, phases and zones kept).
  - A reshaped quarter takes `L1.quarters[i].shape`, which is already clipped (b.2).
  - A deleted quarter keeps its shape, so restore and labels still work. It simply owns no block.
  - Consumers detect deletion with `edits::quarter_removed(layout, i)`, which reads
    `layout.config.overrides.quarters`. The renderer may skip that quarter's dashed outline (render agent, optional).
- **streets**
  - A street is *internal to i* when all of these hold:
    - its rank is 2 or more;
    - its role is not one of `bridge|ford|causeway|boundary|wall-lane`;
    - at least 90 % of its length lies inside the quarter shape inflated by 2 m.
  - S keeps the `L0.streets` in their relative order. It removes those internal to an edited *i* (judged against the
    old shape). For a deleted quarter, only the internal streets that no remaining block touches within
    half-width + 2 m are removed.
  - S then appends the `L1.streets` internal to *i* (judged against the new shape), except those that duplicate a
    kept street (same path, or at least 80 % of the length within 3 m of a kept street).
  - Main streets (rank ≤ 1) and composition and regional streets always come from L0. This is the invariant
    "main streets kept".
  - Keeping the relative order matters: the frontage tie-break of `parcels` follows street order (see
    `FrontageIndex`).
- **blocks**
  - Blocks of untouched quarters are the `L0.blocks` entries, in order and byte-identical.
  - Quarter *i*'s new blocks (the `L1` blocks with `quarter == i`) are inserted at the position of *i*'s first L0
    block, or at the end if it had none.
  - Each new block is **re-clipped**: intersected with the quarter's final shape, then the ribbons of every street of
    S and of the enclosures are subtracted. Pieces under 1 m² are dropped.
  - A block that no street serves (no street within half-width + 2 m) becomes `kind = "reserve"`, the same rule as
    `quarters.rs` 3193-3270.
  - `block.phase` is mapped from L1's index to L0's by equality of the `GrowthPhase` fields `culture|kind|recipe|zone`.
    It falls back to `None`, so the block then uses the quarter's phase.
  - A deleted quarter contributes no block.
- **phases, enclosures, structure, archetype, warnings**
  - Phases, enclosures, structure, archetype and capacity metrics come from L0.
  - Warnings are L0's plus the `Retouche Q…` lines.
  - Example: « Retouche Q4 : tirage sans effet (le quartier n'a qu'un îlot) » when L1 gives *i* the same blocks
    as L0.

**freeze** runs on the untouched part only:
- For each block of S whose quarter is not in E, copy `programme.environment[b].pressure` from the prepared L0. The
  block is matched by its geometry identity (same hash as `parcels::block_identity`).
- For each district without an edited quarter, copy `role`, `wealth` and `label` from the prepared L0.
- After the freeze, the lot cut of an untouched block depends on the same inputs as before: geometry, morph, contacts
  and pressure. So its lots are byte-identical apart from `contact.street` indices (test T3).
- Programme reservations and services are recomputed globally on purpose. A service whose reserved block was in
  quarter *i* must move, and the households of a deleted quarter must be reported as a shortfall. Lots of untouched
  quarters can therefore change **role** only through that re-balance. Freezing it is a non-goal of round 1.

### b.2 Quarter `shape`

A hook in `quarters.rs`, after `lap("composition")`, applies only in L1, because L0's config is stripped:

`super::edits::reshape_quarters(&mut quarters, &mut phases, &streets, &enclosures, cfg, surface, &mut warnings);`

Rules for quarter *i* with a shape:
1. **Validate.** A non-finite coordinate, fewer than 3 or more than 512 vertices → `Err("Retouche de quartier
   invalide (forme)")`. The UI then withdraws the edit, which is the existing refusal path.
2. **Make valid.** Run `g::union(&[shape])`, keep the largest component, then apply `g::normalized`.
3. **Clip.** Take `g::dry_clip(surface, ·)` (no water) and intersect with the surface bounds. Subtract every *other*
   quarter's shape (neighbours have priority: to take a neighbour's land, shrink or delete it first). Subtract the
   ribbons of rank ≤ 1 streets and of the enclosures.
4. **Bound.** The area must be at most max(4 × the old area, 20 ha) and the shape must stay within 2 × site radius of
   the centre. It must also overlap the old shape by at least 10 % of the old area. Anything else gives a warning
   and the edit is ignored.
5. **Too small.** If the result is under 200 m², the edit is ignored with a warning.
6. **Apply.** `quarters[i].shape = result`. The land gained is also added to `phases[q.phase].shapes` (union), so
   `mix_culture` and the block-to-phase lookup keep the grown part.
7. **Subdivide.** The normal `cut` of quarter *i* then runs on the new polygon: `split_quarter`, closes, unserved
   merge and reserve. Land that leaves the quarter has no block, so it returns to open ground.

### b.3 Quarter `deleted`

This edit has no L1 work. The splice drops *i*'s blocks and removes internal local streets that no longer serve
anything. Main streets stay. The quarter shape stays as described in b.1.

Downstream:
- The parcel stage makes no lot there.
- `programme::prepare` re-runs on S. The town's population is unchanged, so its housing lands on fewer lots, and the
  programme's usual capacity warning reports the shortfall.

### b.4 Quarter `salt`

Fork hooks in `quarters.rs`, inside the `cut` closure:
- `rng.fork(&format!("quarter:{i}"))` → `rng.fork(&super::edits::quarter_fork("quarter", i, cfg))`
- `rng.fork(&format!("closes:{i}"))` → `rng.fork(&super::edits::quarter_fork("closes", i, cfg))`

`quarter_fork` returns `"{label}:{i}"`, or `"{label}:{i}/salt:{s}"` when a salt is set.

Fork hook in `parcels.rs`:
- `root.fork(&block_id)` → `root.fork(&super::edits::block_fork(&block_id, layout, block.quarter))`
- This reshuffles the lots of a salted quarter even when its blocks keep their geometry (a single-block quarter).
- The reserve enclosure fork `enclosure:{block_id}` gets the same treatment.

Borrowing guard in `quarters.rs` 3380: replace
`!cfg.overrides.quarters.contains_key(&i.to_string())` with `!super::edits::keeps_own_tissue(cfg, i)`. This returns
true only when the entry has role, wealth, culture, tissue or density. Existing behaviour is identical, and an entry
with only salt or shape does not silently change the quarter's borrowed tissue between L0 and L1.

### b.5 Parcel `shape` and `deleted`: post-pass on the partition

Hook in `mod.rs` `generate_parcels`, between `parcels::generate` and `programme::allocate`:

`edits::apply_parcel_edits(layout, &mut partition);`

Edits are applied per block, in id order, shapes first, then deletions. A lot whose id is not found gives the warning
`Retouche parcelle <id> : introuvable (quartier modifié ?)` and is skipped.

**shape** of lot A in block B:
1. Validate as in b.2.1. An invalid shape gives a warning and is ignored. It is not a hard error, because lot edits
   must never block a regeneration.
2. A' = largest component of (user ∩ B.shape). The block is already free of streets and water, so A' is too. A'
   also subtracts every lot of B already edited earlier in this pass, so edited lots are protected from later edits.
3. A' under 4 m² → warning, ignored.
4. Every other lot N of B becomes N − A'. A lot that drops under 1 m² is removed with a warning (« absorbée »).
5. The remainder R = A − A' is split into components. Each component goes to the lot of B that shares the longest
   edge with it (tie: smallest id), taken as the union, and only if that union is a single polygon. Otherwise it
   becomes a new lot `<A.id>/reste-<k>` with `use = "garden"` and `reason = "user-remainder"`.
6. Every lot whose geometry changed is **re-qualified**:
   - `contacts = parcels::network_contacts(shape, layout, &FrontageIndex::new(layout))`;
   - `front` and `rank` come from the longest contact of minimal rank;
   - `access.kind = "unserved"` when there is no contact, otherwise `"public"` (or `"collective"` when the old access
     was collective);
   - `envelope = None`, so the building stage re-searches it;
   - `axis` is unchanged;
   - provenance gets `edit:shape`.
7. The partition `diagnostics` (covered, residual, overlap, unserved) are recomputed for the touched blocks.

**deleted = "merge"** (default of « Supprimer »):
- The survivor is the lot of the same block with the longest shared edge. It must be `use ∈ {plot, garden}` (plots
  first) and the union must stay a single polygon. The survivor keeps its id; `parent_ids += [A.id]`; provenance gets
  `edit:merged`. Then step 6 applies.
- With no admissible neighbour, the lot falls back to `"garden"`, with a warning.

**deleted = "garden"**:
- The lot keeps its id and geometry; `use = "garden"`, `reason = "user-open-space"`, `family = "garden"`.
- It gets no building, because the building stage only requests lots that the programme allocates to a built
  function (checked by test T7).

### b.6 Parcel `salt`

Hook in `programme.rs`, band 0, at the top of the `for (id, ov) in &cfg.overrides.parcels` loop body, after `pi` is
known:

```rust
// edits hook (urban/edits.rs): salt draws among admissible demands; geometry-only edits force nothing.
let Some(ov) = super::edits::forced_use(ov, id, &pr, &admission, pi) else { continue };
```

`forced_use` returns `Option<Cow<ParcelOverride>>`:
- `None` when the edit carries no use field (only shape or deleted). This prevents `override_demand` from forcing
  "dwelling.house" on a lot whose only edit is a shape.
- `None` also when `deleted` is set.
- The override unchanged when it has a role or function: role wins, and salt then only changes the building seed.
- For salt only: the demands with `admission[di][pi]` true, sorted by `demand.id`, and the one at index
  `fnv1a("{id}#{salt}") % n`. The override returns its `role` and `function`.
- With no admissible demand: `None`, plus the warning `Retouche parcelle <id> : aucun usage admissible pour un
  nouveau tirage`.

Building seed hook in `building_sites.rs` (stream R):
- `let site_seed = super::edits::building_seed(seed, parcel, partition);` replaces `format!("{seed}/{}", parcel.id)`.
- The two JSON `"seed": format!(…)` occurrences at 876 and 890 reuse `site_seed`.
- The result is `"{seed}/{id}"`, or `"{seed}/{id}#s{salt}"` when a salt is set.
- The building id stays `{id}/building`, so a house style edit survives a lot salt.

### b.7 Hooks (all short, delimited by a `// edits hook (urban/edits.rs)` comment; re-read each file just before editing)

| File (owner) | Hook |
|---|---|
| `urban/mod.rs` (unowned) | `mod edits;`; `PartialEq` on `Shape`; the new override fields. In `generate_quarters`, the per-site body becomes `edits::with_quarter_edits(config, plan, finish)`. `plan(c)` = small-kind or `quarters::generate` with config `c`, then `kinds::stamp`, then `access::refine`. `finish(l)` = `access::summarize`, `programme::prepare`, `kinds::finish`. `kinds::effective` and the morph are computed once, outside the closures. In `generate_parcels`, `edits::apply_parcel_edits(layout, &mut partition);` |
| `quarters.rs` (C) | 2 fork lines in `cut`; 1 `reshape_quarters` line after `lap("composition")`; 1 filter expression in `borrowed_quarters` |
| `parcels.rs` (C) | the `root.fork(&block_id)` and `enclosure:{block_id}` fork lines |
| `programme.rs` (C) | the 2-line `forced_use` gate in band 0 |
| `building_sites.rs` (R) | `site_seed` from `edits::building_seed`, reused in the 2 JSON seeds |
| `rust/bridge/urbanConfig.ts` (ours) | contract types |

Nothing changes in `rust/bridge/**` (other than `urbanConfig.ts`), `houses/**` or `local/**`: the native server and
WASM both call `generate_quarters` / `generate_parcels`.

### b.8 Invariants (each one has a test)

- **I1. No overlap.** Within a block, the pairwise lot overlap is under 0.01 m². Between quarters, the overlap of
  final quarter shapes is under 1 m². Lot areas sum to the block area within 1e-5 relative (diagnostics residual and
  overlap stay at zero).
- **I2. Nothing on a street or in water.** No block or lot overlaps a street or enclosure ribbon by more than 0.5 m².
  Every block and lot interior point is dry (`!surface.wet`).
- **I3. Access.** Every lot has at least one network contact, or `access.kind ∈ {unserved, reserved}`. Every
  `kind == "block"` block fronts a street (the existing rule); otherwise it is `reserve`.
- **I4. Determinism.** The same seed, config and edits give byte-identical JSON on two runs and on any thread count.
  Salt 1 and salt 2 differ, and salt 1 reproduces itself.
- **I5. Locality.** Under a structural edit of quarter *i*:
  - blocks of every other quarter are byte-identical to the unedited run;
  - streets outside *i* are identical as a multiset;
  - the lots of other quarters' blocks are identical in id, shape, use and family (contact street indices excluded).
- **I6. No-op.** Without any structural field, the output is byte-identical to the pre-feature engine.
- **I7. Never crash.** Unknown keys, unknown ids, degenerate or out-of-domain shapes, a shape entirely in water, and
  deleting every quarter all give warnings or a documented `Err` for malformed input. They never panic.
- **I8. Main streets kept.** Every rank ≤ 1 street of L0 is present in S under any quarter edit.

## (c) UI

### c.1 Inspector (`cityInspector.ts`)

An action row sits under each quarter and lot section, outside the `<details>`, so it is always visible:

```
[Modifier la forme]  [Tirer au sort] tirage n° 3 [↶]  [Supprimer]
```

- **« Modifier la forme »** calls `hooks.editShape(scope, key, ring)`, which starts the shape editor (c.2).
  - When a shape edit exists, a « Forme d'origine » link appears; it calls `setEdit(…, { shape: undefined })`. The
    merge then drops only that field.
- **« Tirer au sort »** calls `editQuarter(key, { salt: (edit?.salt ?? 0) + 1 })` or `editLot(id, { salt: … })`.
  - The badge shows « tirage n° s ». « ↶ » steps the salt back by 1; 0 removes the field.
  - Help text for a quarter: « Redessine rues, îlots et parcelles de ce quartier ; sa forme et le reste de la ville
    sont conservés. »
  - Help text for a lot: « Nouveau tirage de l'usage parmi les usages admissibles, et du bâtiment. »
  - The status line shows « Nouveau tirage… ».
- **« Supprimer »** is a two-step inline confirm: the button becomes « Confirmer la suppression » for 4 s. A
  `confirm()` dialog would block headless checks.
  - A lot also gets a select: « Fusionner avec la voisine » (merge, default) / « Laisser en jardin » (garden).
  - The confirm sets `{ deleted: true }` or `{ deleted: 'merge' | 'garden' }`.
- The action row is shown only when `target !== 'all'` and the lot has an id. Otherwise it reads
  « Une seule ville ciblée requise ».
- The engine's `Retouche Q<n>` or `Retouche parcelle <id>` warnings are listed in the section, from `layout.warnings`
  and `partition.warnings` / `programme.warnings`.
- The existing « Réinitialiser » clears every field of the item, the new ones included.
- Hooks interface additions:
  `editShape(scope: 'quarter' | 'lot', key: string, ring: Point[]): void`. `editQuarter` and `editLot` keep their
  signatures; the value types gain the new fields.

### c.2 Shape editor: new `web/src/ui/cityShapeEditor.ts` (ours)

- **An SVG layer, not canvas pixels.**
  - It is a `<g id="cityShapeEditor">` appended to `#map`, after the city layer's `foreignObject` (which holds both
    the WebGL and the 2D canvas) and after the pins (`drawPins` re-appends pins; the editor re-appends itself on
    `update()`).
  - It uses world coordinates through the viewBox and native pointer events.
  - It needs no change to `cityCanvas.ts` or `cityGl*`, so it works the same with WebGL or with Canvas 2D.
  - Handles are scaled by `1 / view.scale`, like pins (6 px circles, 2 px stroke), so they keep a constant screen
    size.
- **API:** `start({ ring, original, title, onCommit(ring), onCancel })`, `update()` (on view change), `stop()`,
  `active`.
- **Initial ring:**
  - Quarter: its outer ring, simplified with Douglas–Peucker at ε = 0.5 m; ε doubles until there are 200 vertices
    or fewer.
  - Lot: its outer ring as is.
  - Holes are not edited; the engine re-derives water holes.
- **Drawing:**
  - the original outline as a ghost (dashed);
  - the draft polygon (translucent fill, 2 px stroke);
  - vertex handles;
  - edge midpoint « + » markers at close zoom.
- **Interactions:**
  - drag a handle: pointer capture, with `stopPropagation` on pointerdown so the `#viewport` pan does not start;
  - click an edge or its « + »: insert a vertex at the projected point;
  - right-click (`contextmenu` prevented) or Alt-click a handle: remove it (minimum 3);
  - snap to an original vertex within 4 px (helps keep shared borders);
  - Esc cancels, Enter validates, Ctrl+Z undoes the last vertex operation (local stack);
  - wheel zoom and drag-pan on empty ground keep working.
- **Click isolation.** While the editor is active, a **capture** listener on `#viewport` swallows `click` events
  (`stopPropagation`). This listener runs before the map's capture listener in `citybench.ts`, so clicks during
  editing never re-pick the inspector or add pins.
- **Floating toolbar** (top of the viewport):
  - « Valider », « Annuler », and « n sommets »;
  - a client-side self-intersection check: an invalid polygon shows a red outline, « Contour invalide
    (auto-intersection) », and « Valider » is disabled.
- **Commit:** the ring is rounded to 0.1 m, consecutive duplicates and collinear points are dropped, then
  `editQuarter(key, { shape: { outer, holes: [] } })` or `editLot(id, { shape })`. This is the same request path as
  other edits: `request('quarters')` or `request('parcels')`.
- **Glue** (`terrainUrban.ts`): it creates one editor and implements `hooks.editShape`. It calls `editor.update()` in
  the existing view-change path (`updateView`) and cancels the editor when the plan is replaced by another city.

### c.3 Edits box (`terrainUrban.ts` `editsReport`)

- The existing counter, plus a list of **deleted** items, each with « Restaurer ». A deleted quarter has no block, so
  it cannot be clicked any more.
- A merged lot: clicking the survivor shows « contient la parcelle supprimée … · Restaurer », found through
  `parent_ids`.
- « N retouche(s) inactive(s) » (keys absent from the current plan) with « Purger les retouches inactives ».

### c.4 Persistence

Nothing new. The edits live in `urban.edits` of the share query, hence in links, decors and MU1 codes.
- Shapes are rounded to 0.1 m to keep codes short.
- `web/scripts/city_situation.mjs` may list structural edits in its summary (optional).

## (d) Tests

The Rust tests go in `edits.rs` `#[cfg(test)]`. They build a small synthetic flat site (~20-line helper) and call the
public `generate_quarters` / `generate_parcels`. They do not use `quarters::tests`, which is a private module.

- **T1 contract.** Old JSON without the new fields → `layout.config` serializes byte-identically. A camelCase round
  trip of `shape`, `deleted` and `salt` works. `deleted: "other"` and a non-finite vertex give an `Err`.
- **T2 no-op (I6).** A config with only a culture or role edit gives `with_quarter_edits` JSON identical to the plain
  pipeline.
- **T3 quarter salt locality (I4, I5, I8).** Salt on quarter k, checked against the unedited run:
  - blocks of k differ;
  - every other quarter's blocks are byte-identical and in order;
  - rank ≤ 1 streets are kept;
  - lots of other quarters are identical in id, shape, use and family;
  - running twice gives equal output, and salt 1 differs from salt 2.
- **T4 quarter reshape (I1, I2, I3, I5).** Pull one vertex inward and push one into the fields, then check:
  - the final shape lies within the user polygon ∩ dry land;
  - the overlap with other quarters is under 1 m²;
  - k's blocks lie inside its shape, off the street ribbons, and every one is served or is a reserve;
  - other quarters are byte-identical;
  - a polygon entirely in water gives a warning and changes nothing.
- **T5 quarter delete (I8, I7).** k has no block and no lot. No street internal to k serves nothing. Every rank ≤ 1
  street remains. The programme runs and reports the shortfall. Deleting every quarter does not panic.
- **T6 lot shape (I1, I2, I3).** Grow lot A into B within a block of at least 3 lots, then check:
  - lot areas still sum to the block area;
  - pairwise overlap is under 0.01 m²;
  - A and B keep their ids, and a remainder goes to the longest-edge neighbour;
  - lots of other blocks are byte-identical;
  - every lot has a contact or is `unserved`.
- **T7 lot delete.** `merge`: the id is gone, the survivor's `parent_ids` contains it, and the area is conserved.
  `garden`: same id, `use == "garden"`, and no building request for it.
- **T8 lot salt.** Over the lots of a block, salt changes at least one role. Every drawn role is admissible. The draw
  is deterministic. The building request seed ends with `#s<salt>` and the building id is unchanged. A shape-only
  override forces no use.
- **T9 dormant overrides (I7).** A lot override inside a salted quarter gives the warning `introuvable` and no panic.
  Removing the salt applies it again.
- **TS** `web/tests/cityEdits.test.ts`, extended:
  - cleaners for `shape` (rounding, vertex bounds, junk dropped), `salt` bounds and `deleted` values;
  - `setEdit(…, { shape: undefined })` keeps `role`;
  - `layoutWithEdits` carries the new fields.
- **UI check** (one look per feature). Native server `D:/opus-target-E/release/magna-urbis-local.exe --port 8806`;
  headless Chrome with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; URL
  `http://127.0.0.1:5173/citybench.html?standalone=1&profile=local&localServer=http%3A%2F%2F127.0.0.1%3A8806&artifact=city-01-river-plain-s`.
  1. Click a quarter, then « Tirer au sort ». Take a screenshot before and after: only that quarter's interior
     changes, and the badge reads « tirage n° 1 ».
  2. « Modifier la forme », drag one handle (CDP mouse events), add a vertex on an edge, « Valider ». Screenshot: the
     quarter follows the new outline, clipped at its neighbours and at the river.
  3. Select a lot, then « Supprimer » → « Confirmer ». Screenshot: the neighbour absorbs it.
  4. Copy the MU1 code, open it in a fresh tab, and compare the block and lot counts to the source page (equal).
  5. Kill the 8806 server.

## Implementation order (suggested)

1. Contract: `mod.rs` fields, `urbanConfig.ts`, the `cityEdits.ts` cleaners, T1 and the TS test.
2. Lot edits, b.5 and b.6 (local, cheap): T6-T8.
3. Quarter delete, b.3 (splice without L1): T2, T5.
4. Quarter salt, b.4 (L1 plus fork hooks plus freeze): T3, T9.
5. Quarter shape, b.2: T4.
6. UI: action rows, shape editor, edits box, then the UI check.
