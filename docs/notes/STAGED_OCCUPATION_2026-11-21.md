# Staged occupation on classic's lot cuts (M2.5, 2026-11-21)

Question (design 3.3): does a fixed set of lots per block, cut once at the quarter's birth and occupied progressively (about 60, 80 then 90 %), give a plausible picture on three tissues, or is a hierarchical lot split needed?

## The rule as implemented

- `Block::fill` (`rust/crates/core/src/urban/mod.rs`, `None` for classic). The allocation reads it in `programme_fill.rs`.
- `fill::vacant` ranks a block's housing lots (`plot`, `compound`) by access tier (`public` street, then `collective`/`private` passage, court or gate, then the rest), then original lots before subdivisions (`inherited-subdivision`, `souk-courtyard-house`), then street rank, then the cut's index. The lots past `round(fill × lots)` admit no use (`programme.rs:2278`) and end as gardens in band 5 (`programme.rs:3043`). Without that mask, classic houses every served lot that is left (`programme.rs:2937`). Reserved blocks are never thinned.
- Above 1, `fill::storey_raise` raises floors toward the culture's limit, in the same way as adaptive densification (`programme.rs:2648`). The phase schedules in `town_adapter/specs.rs` stop at 1.0, so this lever is not used yet.
- `None`: the mask is all false and the storey raise equals `densify`, so the code path is the present one.

## European organic (burgage strips)

The cut uses `plotOp: burgage`. It falls through to `strips` (`parcels.rs:4759`, `parcels.rs:1033`), which cuts run by run along each street front (`parcels.rs:1071`). Rear land past the culture's depth becomes garden (`parcels.rs:988`, `parcels.rs:4789`). Nearly every housing lot is a `public` street lot, so the tier rule reduces to street rank, then cut order.

- 60 %: the main-street fronts fill first and a lane side of the block stays open. This matches how burgage blocks grew, so it is plausible.
- 80 and 90 %: one to three lots short per block. Plausible.
- Weakness: among streets of equal rank, the cut's index decides which side fills first. Depth-bounded lots are appended after the others (`parcels.rs:4846-4866`), so a gap can open in the middle of a street wall. Wanted: order lots within a tier by station along their street, from the end nearest the older town (edge dates from the graph). No hierarchical split is needed.

## Chinese grid (courtyard operators)

`plotOp: siheyuan` with `streetOp: grid`. Strips are cut on wide frontages (14–22 m in the core); lots larger than `max(1.8 × houseArea, 1600 m²)` are split into courtyard parts (`parcels.rs:4763-4788`). Courts are paired as well (`parcels.rs:4868`, family `courtyard`, `families.rs:8`).

- Blocks hold few, large lots, so the rounding per block is coarse: at 0.6 a four-lot block keeps 2 (50 %). Every vacancy is a whole 350–900 m² compound. Empty compounds inside a laid-out ward fit a planned capital filling over time (design 5.4), so the picture is plausible at 60, 80 and 90 %.
- Densification beyond the fixed set does not fit this tissue. Storeys are low and capped (`programme.rs:2644-2652`). A non-collective lot gains households only as a "large house" (`programme.rs:1930`), and historically a siheyuan densifies into a multi-family compound. That needs a households-per-lot raise (treating the lot as collective, `programme.rs:1907`), not a storey raise. No hierarchical split is needed.

## Medina (shop strips and rear subdivision)

There are two cuts. Core and middle zones of `medina-souk` take the dense souk branch (`parcels.rs:4504`, `parcels.rs:4730-4757`): shop strips on rank ≤ 1 streets, with courtyard houses cut from the land behind them (`souk-courtyard-house`, `parcels.rs:4753`). Ring and faubourg zones take derbs (`parcels.rs:4701`, `families.rs:510`): lots on the streets, and lots along cul-de-sac passages entered as `collective` at rank + 1 (`families.rs:672`). The passages themselves are `court` parcels (`families.rs:694`).

- Souk at 60, 80 and 90 %: the shops come first, then the courtyard houses behind them. Plausible.
- Derbs at 80 and 90 %: plausible.
- Derbs at 60 %: the street wall is built and most passage lots stay empty, but the passages are already carved. Dead-end alleys then serve empty gardens, which is not how a medina grows: passages appear as the interior is divided. What is needed is a two-level cut, with the street lots and an undivided interior at birth, and the derbs and their lots cut when the fill passes the street-lot share. That is a hierarchical split limited to the derb operator. A cheaper interim fix: a passage whose lots are all vacant is drawn as part of the interior garden.

## Common caveats

- Displayed storeys are drawn in `massing.rs:555-579` from pressure, role and tradition, not from the allocation's floors. The storey raise shows only through more households per lot and the roles they produce (`massing.rs:559`).
- `fill` counts housing lots, not land. Gardens, courts and reserves are outside the count.
- The final cut and the birth cut must agree (design 3.3, lots are cut twice). Otherwise the fill share of a block refers to a different lot set at the end than at birth.
