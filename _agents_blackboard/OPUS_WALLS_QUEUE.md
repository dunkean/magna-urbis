# Walls (stream W) — queued for other streams (2026-10-23)

Rust stage landed: `urban/fortification.rs` + `urban/fortifications.json`; `Enclosure` gains optional
snake_case fields (`style, material, curtain_width_m, height_m, towers_detail, gatehouses, bastions,
outworks, ditch, attached, reserve`); `LayoutConfig.fortificationStyle` (default `auto`).
`composition::fortify` subtracts `Enclosure.reserve` from the plan quarters. Measured with
`exitTreatment: legacy`, blocks ∩ reserve = 0 m² on every case. With adaptive exits it is not 0, because later stages put land back:

**Update after the FIX stage (03:50).** `fortification::settle` (hooked in `mod.rs` after `access::refine`) now re-applies
the rules on the final layout: gates are recomputed from the final streets, structures are clipped by final ribbons,
and blocks give up the reserve (pieces < 100 m² dropped). Measured blocks ∩ structures = 0 on every case. Items 1 and 2
remain the proper fix: today the peripheral roads weave through the curtain and each crossing becomes a plain opening
(01-l: 21, Vauban: 34), and frontage blocks are trimmed afterwards instead of never being cut there.

1. **[C / quarters.rs, fringe.rs] Peripheral frontage refills the reserve.** `fringe::frontages` only
   subtracts `union(quarters)`, so it takes the ditch, berm and glacis land that the reserve freed. Measured blocks ∩ reserve:
   01l 15.6k m², 01l-vauban 68.5k m², 01s 12.1k m², 03 7.4k m², 13-gord 1.9k m².
   This also breaks `quarters::tests::steep_bay_quarters_are_served_and_overrides_stay_local`
   ("quarter N has no street": the new frontage piece does not touch any street).
   Fix: after `fringe::frontages(...)`, subtract `enclosures[*].reserve` from each frontage shape and
   drop pieces under 100 m². Also pass the reserve into `occupied`.
2. **[C / network.rs] Streets added later cross the reserve.** These are peripheral roads, feeders and lanes
   (I4: 01l 2.3k m², 01l-vauban 8.5k m², 01s 1.3k m²; mostly `peripheral` rank 2 through the ditch).
   `resolve_exits` and the peripheral roads should treat `reserve` (minus gatehouse `passage`s and ditch causeways) as an obstacle.
   `network::hierarchy` should also cap the street width inside a gate passage at `passage_width_m - 1`.
   Fortify already predicts `rank_widths(...)[arterial] × 1.1` for the streets that cross the wall.
3. **[C / quarters.rs test] `city_scale_hierarchy_density_and_walls`** asserts `towers.len() >= 12`.
   The european 50k draw is now `bastioned`, and by contract a bastioned trace has no towers.
   Suggested assert: `wall.towers.len() + wall.bastions.len() >= 12`.
4. **[C / quarters, network] Inner party wall** (spec §3.2.1): move the wall-lane draw into fortification.
   Wire the ribbon widths to `fortification::ribbon_half(kind)` / `curtain_width_m`.
5. **[R / occupation, building_sites] Lots against the inner face** (§3.2.2): `ParcelContact{kind:"wall"}`.
6. **[C / parcels] Faubourg lean-tos as real lots** (§3.2.3). `attached` is decor for now.
7. **[P / roles, macroplan]** Skip `defence.castle`/`keep` when a `citadel` outwork exists. Anchor gate
   services on `gatehouses` and ignore `kind:"water"`. `macroplan` enclosures (non-centre placement)
   can call `fortification::build` later (it is `pub(super)`).
8. **[kinds.rs] MarketTown** sets `fortification: culture → none`. Keep `culture` when the kind is palisade.
9. **[Astra / bridge]** `urban.ts` `Enclosure` now has the optional fields (done). Still to do: `urbanConfig.ts`
   `fortificationStyle: 'auto'`, and the City Bench select « Style de l’enceinte » (Selon la culture, Palissade,
   Palissade sur levée (gord), Enceinte simple, Enceinte flanquée de tours, Double enceinte, Enceinte en
   pisé, Enceinte à barbacanes (wengcheng), Tracé bastionné (Vauban)).
10. **[render]** 2D and 3D drawing of the new fields (spec §4) is the next W stage.
