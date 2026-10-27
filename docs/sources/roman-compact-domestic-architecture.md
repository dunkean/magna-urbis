# Compact Roman housing: provenance and limits of procedural profiles

23 October 2026. These profiles are inspired cartographic envelopes. Attested arrangements, interpretations and production values are separated. No capacity in inhabitants, households or apartments is inferred from the name insula, number of floors or rooms. Both recipes are reserved for inspired/fantasy modes (`inspired_only=true`); the ancient context is known, but parameters do not describe a measured building.

## MED-ANT-B12 — Compact Roman dwelling over a shop

[Sposito 2016, TESS, record 18504, University of Padua](https://tess.beniculturali.unipd.it/web/scheda/?recid=18504) describes at Herculaneum V,17–18 a shop on the decumanus, a back room and a timber staircase to the upper level. The complex was detached from a neighbouring house in the first century CE. It attests a shop/dwelling arrangement without requiring a small courtyard domus or proving a detached pavilion. The [Parco Archeologico di Ercolano, Bottega V](https://ercolano.cultura.gov.it/mercato-v-5-fornello-caldaia/) confirms a multi-level commercial space with back shop and upper living rooms.

**Proposed procedural translation:** `Single/FP-RECT`, one enclosed masonry body, two storeys and an internal staircase. The rectangle has no central courtyard. Load-bearing/infill fired brick, lime plaster, timber frame, stone base and clay tiles form an inspired palette; the generic gable roof is not presented as a reconstruction of the Herculaneum example.

**Explicit artistic parameters:** width 4.5–6.5 m, depth 7–11 m, one body, two storeys, storey height 2.8 m, 1–2 generic rooms per body, walls 0.25–0.40 m, pitch 20–35°, overhang 0.15–0.30 m. Nominal footprint ranges from 31.5 to 71.5 m² at size 1; this is not an archaeological range. Weight 25 comes from artistic priority P1, not historical frequency. One default variant, no added earth terrace or corbelled structure.

**Programme and limits:** role `mixed_residential`, requested `dwelling.shop/mixed/row`. Native `shopfront` detail adds a decorative panel and marks the first generic ground-floor room as `Shop`; other rooms are `Living`. This partition is not a reconstructed Roman layout. A large shop opening, separate commercial access, facilities, independent dwellings and capacity remain uncertified. No hearth, gallery, courtyard, annex or enclosure is added. Doors, stairs, roof, terrain and site rights must still pass native validations; a parameter sheet is not an accepted placement.

## MED-ANT-B13 — Small Roman street apartment building, emitted inspired envelope

[Paola Chini, Sovrintendenza di Roma, insula dell'Ara Coeli brochure, pp. 1–2](https://sovraintendenzaroma.it/sites/default/files/storage/original/application/38bd9dd7189bec26b1f3329a548b0369.pdf) describes an early second-century brick building with shops, mezzanines and residential levels. Access differs by level. The number of apartments on a floor remains uncertain. The local 4.25 m height of a shop-floor support is not used as a general value.

The excavation study by [Calza 1915, columns 597–598](https://ostiaantica.cultura.gov.it/wp-content/uploads/2025/08/Calza-1915d.pdf) distinguishes dwellings lit from façades and others also using a courtyard. [Casa di Diana, Parco di Ostia](https://ostiaantica.cultura.gov.it/pannelli-didattici-e-mappe/larea-centrale-e-i-complessi-di-rappresentanza/casa-di-diana/) illustrates actual buildings with a central porticoed courtyard: B13 does not replace B04 or programmes requiring a courtyard. These examples do not provide statistical proportions for small lots.

**Artistic parameters:** `Strip/FP-RECT`, one body of two storeys by default; variants `three_storeys`=[3,3] and `four_storeys`=[4,4], with explicitly recalculated stair routes. Nominal width 6.5–10 m, depth 10–18 m, 2–4 generic rooms per body; same artistic materials, height, walls and covering as B12. Strip currently reserves 25% of depth for open rear space and 1.25 m for a side passage: the body measures `(W−1.25) × 0.75D`, or 39.375–118.125 m². These proportions are native conventions, not Roman measurements. No inheritance of `side_corridor` detail, which would add a gallery and posts; the passage already exists in the Strip builder.

**Declared construction:** `urban_frontage_infill=false` disables automatic burgage wings, with backward-compatible default true for old recipes. One body, its rear courtyard and native passage are retained; no false arcade or post-construction removal. Weight 25 is an artistic P1 choice, not historical frequency. The recipe and its variants are emitted for separate native validation of floors, rooms, stairs and access; emission alone certifies no placement or urban connection.

Role `communal_dwelling`, requested `dwelling.tenement/domestic/row`, context MED-ANT-S03. This is an inspired collective envelope, without certified households. The `multiple_households` flag would trigger generic subdivision with a 1.2 m passage and household IDs; it is not a Roman apartment programme and remains omitted here. Internal layout IDs provide no certified capacity. A large-footprint target cannot silently be replaced by a small tall building.

## Index and chronology

Tradition `roman_urban`, independent of S04 market-street context for B12 and S03 for B13. Both recipes are explicitly assigned; their native validations and urban-connection limits remain distinct. No automatic roman-core filter to this pair alone is enabled: existing Roman recipes must be examined before such a connection. Explicit Greek/Punic choices remain accessible.

Era A, exact dates unknown, `late_only=false`, `inspired_only=true`, confidence `stylized`, chronology `broad_tradition` and roof `uncertain`. First–second-century examples justify an Imperial Roman context, not all produced dimensions or their extension to every region. Pins, variants and explicit overrides do not bypass strict rejection of these interpretations.

[Original French version](roman-compact-domestic-architecture_FR.md).
