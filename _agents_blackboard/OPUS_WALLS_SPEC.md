# Walls and palisades: typology, structures, rendering (spec, stream W)

TODO.md: « Il faut distinguer murailles et palissades. Les murailles devraient être plus complexes avec des bâtiments intégrés (portes, tours, etc.), des bâtiments collés parfois (in et out of city) et des formes qui varient (des vaubans aux polygonales simples). »

## 0. Current state (read 2026-10-22)

- `composition.rs::fortify` (called once from the settlement composition, `placement == "center"`): the kind comes from `profiles::fortification(profile, cfg.fortification, pop)` and is one of `wall|palisade|hedge|none`. The enclosed land is the union of the founding epochs (`across_water`, then pieces over 15 000 m²). `curtain()` runs two corner-cutting passes and a simplification with tolerance `clamp(0.02·√A, 2, 10)`. `partition()` splits plan quarters along the line. `gates()` gives the street crossings, and `water_gates()` gives the bank points, which are appended to `gates`. `towers()` places towers at the corners (turn > 28°), two towers 7 m either side of each gate, and towers every 55 m. All towers are points with no size, and only `wall` gets any.
- `Enclosure {path (closed), kind, gates: [Point], towers: [Point]}`, serialised in snake_case.
- The later stages that read enclosures belong to other streams: `quarters.rs` cuts blocks with a centred wall ribbon of **3 m (wall) / 1.5 m (other)**, `network::enclosure_lanes` adds an intramural `wall-lane` at offset `-(wall_half + w/2)` (wall_half 1.5/0.75, w 4/3) on 80 % of enclosures, `roles::gates` places gate services (it includes water gates), and `serve_quarters` checks `crosses_wall`.
- `macroplan.rs` (P) emits its own enclosures for the non-`center` placement, with `towers: []`. This spec leaves that path alone; the builder below is public, so P can call it later.
- The culture catalogue holds `core|ring.enclosure.{shape, wall, fossil, towers: round|square, gates, orientation, aspect}` and `render.towerShape`. `plan.fortification` is `auto|wall|palisade|hedge|none`. Cultures with palisades: russian-kremlin, slavic-gord, mississippian, maori-pa, guarani-village, goblin-warren. Square towers: medina, chinese, hanseatic, byzantine, mesopotamian, al-andalus, rajput (round), and others.
- Programme context: `period` is `""|"A"|"M"` (UI « Époque locale »). It is also used for recipe admission, so **no new period value may be added** (an unknown era makes the native recipes refuse). `kinds.rs`: `MarketTown` rewrites `fortification: culture` to `none`. `WalledTown` is 2.5k–30k when fortified. `defence.castle` and `defence.keep` (site `hill`) already exist in `services.json`.
- Rendering: `cityCanvas.ts` builds `CityWall {kind, pieces, gates, gateTowers, towers}`. `cityGlBuild.ts` draws the walls as a stroke (3.5 m, or a 2 m dash for a palisade) and the towers as instanced discs of a single radius. `terrainUrban.ts` (around line 781) draws an SVG stroke. In 3D the walls are only painted on the plan texture. `city3dMeshes.ts::city3dBridges` is the model for procedural volumes.

## 1. Typology resolver

New module `rust/crates/core/src/urban/fortification.rs` (owned by W) and a new data file `rust/crates/core/src/urban/fortifications.json` (owned by W; it holds the defaults by tradition, so `catalogue.json` needs no edit). The **kind** (`wall|palisade|hedge`) still comes from `profiles::fortification`, so `kinds.rs`, `macroplan.rs` and old scenes stay unchanged. The resolver only picks a **style** inside that kind.

### 1.1 Styles (presets; every number can be overridden by the culture)

| style | kind | material | curtain_width_m | height_m (towers) | towers | gate (major / minor) | ditch | outworks |
|---|---|---|---|---|---|---|---|---|
| `palisade` | palisade | timber | 1.5 | 3.5 (5) | none; one timber gate tower at major gates if pop ≥ 600 | `timber` / opening | dry 4 m, bank inside the ribbon | — |
| `gord` | palisade | timber-earth | 6 (earth bank + timber box) | 5 (7) | square timber towers 5×5 at major gates and salients (turn > 40°) | `timber` / opening | dry or wet, 6 m | — |
| `hedge` | hedge | thorn | 1.5 | 2.5 | none | opening | none | — |
| `curtain` (simple polygonal) | wall | stone | 3 | 7 (10) | corners only (turn > 35°), r 3 | `tower` / postern | none, or dry 8 m (p 0.3) | — |
| `flanked` (medieval) | wall | stone | 3 | 9 (13) | corners and every 40–70 m, r 3.5 (corners and gates 4.5) | `twin-tower` / `tower` | wet if water is within reach, else dry with p 0.5, else none; 12 m | — |
| `concentric` | wall | stone | 3.5 | 10 (14); outer wall 6 | as `flanked`; small towers r 2.5 on the outer wall | `twin-tower` + `barbican` / `tower` | outside the outer wall, 15 m | `outer-wall` (lists 10–14 m wide), `barbican` |
| `rammed-earth` (Islamic, Maghreb, Mesopotamia, Sahel) | wall | rammed-earth | 4 | 8 (10) | square 6×6 every 25–35 m (round for persian) | `bab` (massive square gate 16×(w+12)) / `tower` | dry 8 m (p 0.5) | `antemural` (low outer wall, if pop ≥ 30k) |
| `wengcheng` (China, Korea, Vietnam, Bagan) | wall | brick (rammed-earth for pop < 10k) | 6 (pop < 20k) to 12 | 11 (15; gate tower 20) | corner towers 12×12; « horse-face » towers 8×10 every 60–80 m | `tower` + `wengcheng` / `tower` | wet moat 20–30 m beyond a 10 m berm | `wengcheng` at each major gate |
| `bastioned` (Vauban) | wall | earth-stone | 12 (rampart) | 7 (no towers) | none (bastions instead) | `ravelin` / postern | wet or dry 25 m | `ravelin`, `glacis` 20 m, `citadel` (pop ≥ 30k, p 0.5) |

Fantasy and Indian variants are presets with overrides rather than separate styles. `rajput-fort` and `indus-planned` use `flanked` with towers `round` r 6, spacing 45 m and gate `bab`. `dwarven`, `duergar-hold` and `giant-hold` use `curtain` with towers `square`, `curtain_width_m` 6 and `height_m` 14. `wizard-city` uses `flanked` round with spacing 35 m.

### 1.2 Inputs, all available inside `fortify`

- `culture` and `pop`. Settlement kind: `small`, `metropolis`, or the effective `cfg.settlement_form`.
- `cfg.programme.period` (`A` excludes `bastioned` and `concentric`, except for byzantine-greek and roman-core; `M` excludes `bastioned`; `""` allows all).
- `cfg.programme.state`. `cfg.site_archetype` (`hilltop|spur|pass|island` count as defensive).
- Prosperity `p = clamp((log10(pop) − 3.3) / 1.7, 0, 1) × {thriving 1, declining 0.75, abandoned/ruined 0.5}`. District wealth only exists after the programme, so it is not used.
- Relief `R`: the length-weighted mean, over the curtain segments, of `|h(m + 12n) − h(m − 12n)| / 24`, where m is the midpoint and n the outward normal. A run is steep when its own value exceeds 0.15.
- `wet_share`: the share of the curtain length whose point 10 m outward is wet.

### 1.3 Deterministic choice

1. `kind == hedge` gives `hedge`. `kind == palisade` gives `gord` when the culture's `fortification.material` is `timber-earth` (default for slavic-gord, russian-kremlin, maori-pa, mississippian), and `palisade` otherwise.
2. The new `LayoutConfig.fortification_style` (camelCase `fortificationStyle`, default `"auto"`) forces a style when it is compatible with the kind. A wall style on a palisade, or the reverse, is ignored with the warning « Style de fortification « {s} » incompatible avec {palissade|muraille} : style culturel conservé. »
3. Otherwise, for a wall: take the culture's candidates `fortification.styles` (from `catalogue.json` if present, else `fortifications.json` by culture, else by group), filter them by `minPop`/`maxPop`/`periods`, and draw with `Rng::new(&site.key).fork("fortification").fork("style").weighted_index(weights)`. Group defaults:
   - **european** (european-organic, bastide, hanseatic, flemish-cloth-town, italian-comune, rynek-town, gnomish): `curtain` below 3k; `flanked` from 3k to 20k; from 20k to 50k, `flanked` 6 / `concentric` 4 (concentric needs p > 0.6 or a defensive site); from 50k, `bastioned` 5 / `concentric` 3 / `flanked` 2.
   - roman-core: `flanked` (round towers, 30–35 m spacing). byzantine-greek: `concentric` from 20k, `flanked` (square towers) below.
   - **islamic** (medina, persian, mesopotamian, levantine-tell, al-andalus, ksar-oasis, oasis-caravan, hausa-kano, hadhrami-tower, nubian-fortified): `rammed-earth`. hausa-kano gets tower spacing ∞.
   - **sinic** (chinese, korean, bagan, vietnamese-citadel): `wengcheng`. vietnamese-citadel from 20k: `bastioned` 1 / `wengcheng` 1 (Huế).
   - Any other culture whose kind is wall: `curtain` below 3k, `flanked` above.
4. Terrain modifiers apply **after** the draw, so the draw stays stable. If `R > 0.07` (hill town), `bastioned` and `concentric` fall back to `flanked`, with the warning « Fortification : tracé {x} ramené à une enceinte flanquée (relief). » A forced style is kept. Steep runs get no ditch and 1.5× tower spacing. Runs with a wet outward side get no ditch (the water is the moat), no bastions and 1.5× tower spacing.
5. Per circuit: the outermost circuit takes the style. An inner circuit (`fossil: wall`) takes one step down (`bastioned|concentric → flanked`, `flanked → curtain` below 10k, `wengcheng` stays) and gets **no ditch and no outworks** (old ditches were filled).
6. Every per-enclosure draw uses `base.fork(&format!("enc:{i}"))`, then `.fork("towers" | "ditch" | "height" | "attached")`. `fork` takes `&self`, so no other stream's RNG moves.

### 1.4 Culture declaration (optional, serde-style defaults: everything is `Option`/`unwrap_or`)

`cultures[c].fortification` in `catalogue.json` (overrides `fortifications.json[c]`, which overrides the group):

```json
"fortification": {
  "styles": [{"style": "flanked", "weight": 3, "minPop": 3000}, {"style": "bastioned", "weight": 2, "minPop": 50000, "periods": [""]}],
  "material": "stone", "towers": "round", "towerSpacing": [40, 70], "towerRadius": [3.5, 4.5],
  "gate": "twin-tower", "ditch": "auto", "heightM": [8, 11], "curtainWidthM": 3, "attached": 0.5
}
```

The tower shape defaults to `core.enclosure.towers` (then `render.towerShape`, then `round`).

### 1.5 Trace shape by style (inside `curtain()`, so the call site is unchanged)

- `curtain`, `flanked`, `rammed-earth`: the current trace.
- Hill town (`R > 0.07`): one corner-cutting pass, tolerance `clamp(0.01·√A, 1.5, 5)`, so the wall follows the contours of the growth outline.
- `wengcheng`: the current trace, then a snap to the culture's orientation when `enclosure.shape` is `square|rect`. Vertices whose turn is under 12° are removed.
- `bastioned`: `T = clamp(0.04·√A, 12, 40)`, then `simplify(buffer(shape, +T/2).outer, T)`, then repeatedly remove the vertex of smallest turn while an adjacent edge is under 80 m. Accept the result only if `area(trace ∩ shape) ≥ 0.98·area(shape)` and `g::simple`. Otherwise fall back to the `flanked` trace and style.

## 2. Integrated structures as data

### 2.1 Contract (additive; `path`, `kind`, `gates`, `towers` keep their meaning for old clients)

```rust
pub struct Enclosure {
    pub path: Vec<Point>, pub kind: String, pub gates: Vec<Point>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub towers: Vec<Point>,   // = anchors of towers_detail (on path)
    #[serde(default, skip_serializing_if = "String::is_empty")] pub style: String,
    #[serde(default, skip_serializing_if = "String::is_empty")] pub material: String,  // timber|timber-earth|thorn|stone|brick|rammed-earth|earth-stone
    #[serde(default, skip_serializing_if = "is_zero")] pub curtain_width_m: f64,       // measured from the inner face outward
    #[serde(default, skip_serializing_if = "is_zero")] pub height_m: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub towers_detail: Vec<Tower>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub gatehouses: Vec<Gatehouse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub bastions: Vec<Work>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub outworks: Vec<Work>,  // outer-wall|barbican|antemural|wengcheng|ravelin|citadel|glacis
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub ditch: Vec<Work>,     // kind dry|wet
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub attached: Vec<Attached>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub reserve: Vec<Shape>,  // union of all of the above outside the inner face
}
pub struct Tower { pub anchor: Point, pub center: Point, pub shape: String /* round|square|d|rect */, pub radius_m: f64 /* half-size across */, pub depth_m: f64 /* rect only */, pub angle: f64 /* curtain tangent, rad */, pub height_m: f64, pub kind: String /* corner|flank|gate|water */, pub footprint: Shape /* clipped polygon actually used */ }
pub struct Gatehouse { pub gate: usize /* index in gates */, pub kind: String /* timber|tower|twin-tower|bab|ravelin|water|postern */, pub shape: Shape, pub passage: [Point; 2], pub passage_width_m: f64, pub height_m: f64 }
pub struct Work { pub kind: String, pub shape: Shape, pub height_m: f64, #[serde(default, skip_serializing_if = "Option::is_none")] pub passage: Option<[Point; 2]> }
pub struct Attached { pub kind: String /* lean-to|stall */, pub side: String /* out (in: next round) */, pub shape: Shape, pub height_m: f64 }
```

`towers[i] == towers_detail[i].anchor`, and the order is gate towers, then corners, then flanks. For `bastioned`, `towers` holds only the towers of the gatehouses. `gates` stays exactly as today (water gates included). A water gate pair is also a `Gatehouse{kind: "water", passage: [bank_a, bank_b]}`, pairing consecutive land→water and water→land transitions along the path, with the wrap handled.

### 2.2 Geometry (n = outward unit normal, checked with `g::contains(wall, m + 2n) == false`; `c = curtain_width_m`; inner face at offset `-h` with `h` = 1.5 for a wall and 0.75 otherwise)

- **Curtain body**: the strip from offset `-h` to `c − h`. Extra thickness only grows **outward**.
- **Towers**: anchor on the path (corner: the vertex, on the bisector; flank: evenly spaced as today; gate: `passage_width/2 + r` either side along the curtain). The center is at offset `r − h`, so the tower's inner edge is flush with the inner face. Round towers are 16-gons. `d` is a round outer half on a square inner half. `rect` (horse-face) is `2r` along by `depth` outward.
- **Gatehouse**: a rectangle aligned with the **street** direction `s` at the crossing (not with the curtain normal), depth `L` outward (timber 5, tower 10, twin-tower 12 plus two towers r 4.5, bab 16) and width `passage + 2·mass`. `passage_width = street width + 1`, and `passage = [gate − s·h, gate + s·L]`. Minor gates (street rank ≥ 2) get the minor type.
- **Bastion** at a salient vertex V (convex, turn 15°–110°, no gate within `d + 15` m), with u and v the incoming and outgoing directions: `d = clamp(0.15·min(adjacent edges), 12, 30)`, `f = 0.4d + 6`, `cap = clamp(2.2d, 25, 60)`, `F1 = V − u·d`, `F2 = V + v·d`, `F1' = F1 + n1·f`, `F2' = F2 + n2·f`, `P = V + b·cap`, and the polygon is `[F1, F1', P, F2', F2, V]`. An edge longer than 260 m with no gate within 60 m also gets a flat bastion at its midpoint (b = n).
- **Ravelin** in front of each major gate: base centre `B = gate + n·(c + 2 + dw/2)`, half-base 30, apex `B + n·35`, minus the street ribbon. That leaves two halves, and `passage` is set.
- **Outer wall** (`concentric`): the strip along `buffer(curtain polygon, +gap)` (gap 10–14), simplified with tolerance 2, 2 m wide. Its gates are `gates(outer, plan.streets)`, and each one gets a `barbican` Work (a 10×(w+8) rectangle minus the street).
- **Wengcheng**: a court of radius 18–30 outside each major gate (a semicircle, or a rectangle when the towers are square), with a wall `0.8c` thick, as the ring polygon minus the street ribbon. Its outer gate is a `Gatehouse{kind: "tower"}` with the same `gate` index.
- **Ditch** (berm 2 m): `buffer(U, c + 2 + dw) − buffer(U, c + 2)`, where U is the curtain polygon ∪ bastions (∪ the outer wall for `concentric`), minus ravelins and their own 8 m ditch, then minus the street ribbons (causeways). It is clipped to dry land and is `wet` when the style says so or when it touches water and `R < 0.05`. **Glacis**: the next band out, 20 m wide, minus the streets.
- **Citadel** (`bastioned`, pop ≥ 30k, p 0.5): a regular pentagon of radius 90–120 m with five bastions, placed **entirely outside** at the outward salient with the highest ground, centre `V + b·(R + c + dw + 10)`, joined to the glacis.

### 2.3 Clip rules: invariants by construction, never local special cases

For every structure S, in order:

1. `S := S − inner_core`, with `inner_core = buffer(curtain polygon, −h)`.
2. `S := S − street_clear`, where street_clear is the ribbons of `plan.streets` at fortify time (widths + 1 m). Gatehouses, ravelins, barbicans and wengcheng keep only their `passage` across it. Ditch and glacis become causeways.
3. Drop towers, bastions and lean-tos whose clipped area is under 60 % of their nominal area, or with any vertex or the centre wet (a bastion then falls back to a corner tower, which goes through the same rules). Works must be at least 90 % dry by `dry_clip`.
4. `reserve = union(curtain body outer part, towers, gatehouses, bastions, outworks, ditch, glacis, attached)`, then `plan.quarters := quarters − reserve` (drop pieces under 1 m²; `serve_quarters` already merges slivers). This runs right after the existing `partition()` calls in `fortify`.

### 2.4 Invariants (each gets one test in `fortification.rs`)

- **I1 (contract)**: old fields unchanged in meaning. Every gate is on the path (< 0.1 m) and on a street (the existing regression already checks this). `towers[i] == towers_detail[i].anchor`.
- **I2 (inner side untouched)**: every structure ∩ `inner_core` has area < 0.01 m². The intramural `wall-lane` and inner lots therefore cannot be hit.
- **I3 (no lots or blocks)**: blocks ∩ reserve < 0.5 m², and lots ∩ (curtain ribbon ∪ reserve) < 0.5 m² (via `generate_parcels`).
- **I4 (streets)**: every final street ribbon ∩ (reserve − passages − causeways) < 1 m². This catches the streets added later (exits, peripheral roads). A failure goes to the queue (§3.2), not to a local patch.
- **I5 (water)**: no tower, gatehouse or bastion centre or vertex is wet.
- **I6 (determinism)**: two runs give the same JSON, and serial and parallel runs match (the existing test keeps passing).

## 3. Attached buildings

### 3.1 Now, inside `fortify` only (no edit to `parcels/**`, `occupation.rs` or `network.rs`)

- **Outer lean-tos (« échoppes adossées »)** on curtain runs **without a ditch**, within 60 m of a major gate, on both sides of the gate road. They start 3 m past the gatehouse and stay 2 m clear of towers. Each unit is a rectangle from the outer face (offset `c − h`) to depth 5–7 m, with a frontage of 5–9 m. A row is drawn with `fortification.attached` (default european 0.5, islamic 0.6, sinic 0.4; palisade, gord and bastioned 0, because the glacis is a no-build zone). The units go through the clip rules, land in `reserve`, and are emitted as `Attached{kind: "lean-to", side: "out", height_m: 4–6}`. They are decor: no household and no parcel.
- **Gate buildings** that are part of the gatehouse (guard rooms, toll): included in the gatehouse footprint on the outward side.
- **Inner side**: nothing beyond the 1.5 m half-ribbon this round, because the `wall-lane` decision is taken later in `quarters.rs` (`rng.fork("wall-lanes")`) and occupies offsets 1.5 to 5.5 m.

### 3.2 Queued for the next round (owners in brackets)

1. **Inner party wall [C/quarters, network]**: move the wall-lane draw into the fortification stage (`Enclosure.inner_lane: Vec<[usize; 2]>` runs) so that lots back onto the curtain where there is no lane. Wire `quarters.rs` (ribbon widths) and `network.rs` (`wall_half`) to `fortification::ribbon_half(kind)` and `curtain_width_m`.
2. **Lots against the wall [R/occupation, building_sites]**: a lot whose rear edge lies on the inner face (< 0.2 m) gets `ParcelContact{kind: "wall"}`, and its building is built to the rear line with the curtain as party wall. Inner « maisons adossées » follow from this.
3. **Faubourg against the outer face [C/parcels]**: turn `attached` lean-tos into real lots (a reserve exception for `attached`) with frontage on the gate road.
4. **Exits and peripheral roads [C/network]**: `resolve_exits` and peripheral frontage roads treat `Enclosure.reserve` minus passages as an obstacle (fixes any I4 failure).
5. **Programme [P]**: `defence.castle`/`keep` is skipped when a `citadel` outwork exists. A castle lot within 30 m of the curtain uses it as its wall. Gate services (`commerce.market.gate`, inns, tolls) anchor on `gatehouses` and ignore `kind: "water"` gates.
6. **Bent entrances [C/network]**: a real chicane for `bab`/`barbican` requires a street detour, so `bab` is a straight-through massive gate for now.
7. **`kinds.rs`**: `MarketTown` sets `fortification: culture → none`, so a palisaded market town is impossible with defaults. Proposal: keep `culture` when the culture's kind is `palisade`.
8. **[Astra] `rust/bridge/urban.ts` and `urbanConfig.ts`**: the optional `Enclosure` fields above, and `fortificationStyle: 'auto'` in `LayoutConfig`. City Bench select « Style de l’enceinte » with: Selon la culture, Palissade, Palissade sur levée (gord), Enceinte simple, Enceinte flanquée de tours, Double enceinte, Enceinte en pisé, Enceinte à barbacanes (wengcheng), Tracé bastionné (Vauban).

## 4. Rendering

### 4.1 2D: `cityCanvas.ts` scene, `cityGlBuild.ts`, `cityGlStyle.ts` and the SVG in `terrainUrban.ts`; wall functions only, coordinated with the render agent

- `CityWall` gains `style, material, curtainWidth, height, towersDetail, gatehouses, bastions, outworks, ditch, attached`, read through a local contract type (as `EnclosureContract` does today) until the bridge has them. Without them, the current drawing is unchanged.
- Fill order:
  1. Ditch: wet ditches use the palette's water colour; dry ditches use earth `#8a7a5e` at 45 %.
  2. Glacis: `#d8ccb0` at 35 %.
  3. Outworks, bastions and ravelins: wall fill `#b6a793` with a `#4b443b` outline.
  4. Curtain body: a filled strip of width `curtainWidth` from the inner face, falling back to the current 3.5 m stroke.
  5. Towers: true shapes in the fill mesh (instanced discs gain a per-instance radius and a round/square flag).
  6. Gatehouses: masses filled, passage in street colour.
  7. Attached: building mass colour.
- Palisade: a dotted timber line 1.5 m wide, `#72533a`, dash 1.3/0.5 (as today). `gord` adds an earth bank strip `#a08a64` and timber gate towers `#6b4a2e`. Hedge: a green dotted line `#4f6b3a`, 2 m.
- Wall width by style: palisade 1.5, curtain 3, flanked 3, rammed-earth 4, wengcheng 6–12, bastioned 12. Parchment palette: `PARCH.wall` / `wallFill` / `tower`.
- LOD: far shows the curtain stroke only. Mid adds the curtain fill, bastions, ditch and glacis. Near and close add towers, gatehouses, outworks and attached.

### 4.2 3D: new `city3dWalls(enclosures, heightAt)` in `city3dMeshes.ts`, modelled on `city3dBridges` (PlacedBuilding with `baseVolume`), called from `city3d.ts`

- Curtain: per-segment quads over the curtain body, from `min(ground) − 0.5` to `ground + height_m`, with a flat wall walk. Segments covered by a gate passage are skipped.
- Towers: prisms of `towers_detail.footprint`, height `tower.height_m`. Gatehouses: masses up to `height + 3`, with a lintel over the passage from z 5. Bastions and ravelins: extruded to 0.8 × height. Outer wall: 0.6 × height.
- Palisade: a 0.4 m timber strip 3.5 m high. `gord`: a 1.5 m earth bank under the palisade.
- Water gate spans: an arch volume with piers every 8 m, as for bridges. Ditch and glacis stay on the plan texture.
- Optional battlement hint at close LOD: blocks 0.6 m high every 2 m on the outer edge.
- Materials: `slots(material)`, where `timber` gives timber, `brick` and `rammed-earth` give earth, and `stone` and `earth-stone` give stone.

## 5. Verification cases

All cases run with `cd web && node scripts/city_replay.mjs --decor <map> --request <req> --server http://127.0.0.1:8802 --out web/out/walls/<case>`. Request copies only change the culture, population, `fortification` and `fortificationStyle` fields. For each case, look at the 2D and 3D renders and print: style, the number of towers, gatehouses, bastions and outworks, the I2–I5 overlap areas, and wet towers.

1. `01l-auto`: `c-final/city-01-river-plain-l` (100k european-organic, river). Expect `bastioned`, `concentric` or `flanked` from the draw, water gates paired, no ditch on the river side, causeways at the gates.
2. `01s-flanked`: `a2/city-01-river-plain-s` (5k european). Expect `flanked`: twin-tower gates, flanking towers 40–70 m apart, and lean-tos near the gates where there is no ditch.
3. `13-gord`: copy of `a2/city-13-temperate-valley-s` with `culture: slavic-gord` (5k → WalledTown, palisade). Expect `gord`: timber line, earth bank, timber gate towers, ditch.
4. `05-medina` and `13-chinese`: `a2/city-05-arid-plateau-s` (medina) gives `rammed-earth` with square towers 25–35 m apart and `bab` gates. `a2/city-13-temperate-valley-s` (chinese, fossil wall) gives `wengcheng` on the outer circuit (moat, wengcheng at major gates) and a plain inner circuit.
5. `03-hill`: `a2/city-03-aegean-hills-s` (byzantine-greek 5k). Expect `flanked` with the contour trace (R > 0.07), no ditch on steep runs, and towers at the salients.
6. `01l-vauban`: copy of case 1 with `fortificationStyle: "bastioned"`. Expect bastions at the salients, ravelins in front of the major gates, wet or dry ditch, glacis, optional citadel outside, and faubourg quarters cut back by the reserve without blocks in it.

Rust tests in `fortification.rs`: one test each for I1–I6, plus one table test of the resolver (european 2k → curtain, 10k → flanked; medina → rammed-earth; chinese → wengcheng; slavic-gord → gord; period `M` never bastioned; a hill draw falls back to flanked).

## 6. Files and order

- **Rust (W)**:
  - New: `urban/fortification.rs`, `urban/fortifications.json`.
  - `mod.rs`: the `Enclosure` fields, `LayoutConfig.fortification_style` (default `"auto"`), `mod fortification`.
  - `composition.rs`: inside `fn fortify`, `curtain` and `towers` only. `fortify` calls `fortification::resolve` and then `fortification::build(&mut enclosure, &plan.streets, surface, &style, rng)`, then subtracts the reserve.
  - Build with `CARGO_TARGET_DIR=D:/opus-target-W`. Run `cargo test -p magna-urbis-core urban::fortification` plus the existing regression `flat/walled` test and `parallel_quarter_stage_matches_serial`.
- **2D render (W, coordinated with the render agent)**: wall functions in `cityCanvas.ts`, `cityGlBuild.ts`, `cityGlStyle.ts`, `cityGl.ts` (tower instances), and the SVG at `terrainUrban.ts` around line 781.
- **3D (W)**: `city3dWalls` in `city3dMeshes.ts` and one call in `city3d.ts`.
- **Queue (§3.2)**: post on the blackboard for C, R, P and Astra.
