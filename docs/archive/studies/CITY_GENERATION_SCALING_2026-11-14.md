# City generation at scale: pipeline review and optimisation plan

Review of 14 November 2026. Scope: the town chain of the V2 (quarters → parcels → programme → building sites), for two problems: large towns (100k and above) and constrained towns (sparse cultures, steep or wet sites). Nothing in the generator was changed for this review; it measures, explains and proposes.

## 1. Summary

- The chain is close to linear up to 50k, then follows about N^1.4: 2.3 s at 10k, 33 s at 100k, 2 min at 250k, and an estimated 12 to 20 min at 1M.
- The quarters stage is 80 to 90 % of the chain at every size.
- Inside the quarters stage, drawing the town is the small part. At 100k the plan takes 4 s and the checks that follow take 24 s. These checks run the programme, the cadastre and the allocation on the whole town 7 to 8 times to find out which blocks stay empty.
- Every town is over-generated: 20 to 25 % of its quarters and several hundred blocks are cut, parcelled, allocated, then given back to the fields.
- A constrained town is slow for two reasons. A sparse culture is a bigger town for the same people (halfling: 2.5 to 3.3 times the blocks). And on a hard site each correction (capacity, slope) is a new full-town generation: a halfling town of 10k takes 6 s on a plain and 24 s on a mountain flank, with four complete plans and two complete check tails.
- One town runs mostly on one thread: 8 to 16 threads are only 2.2 times faster than one.

The proposal is to close the loop: decide with cheap, local information before generating, generate district by district until the households are housed, and stop. Expected: 100k in 2 to 3 s instead of 28 s, 1M in 15 to 30 s (and usable on a laptop with districts generated on demand), the mountain halfling town at the price of the plain one.

## 2. Measurements

Setup: exact replay of the V2 engine requests captured on 13 November (`cities_native_replay`, `fast` profile, tree of 14 November 02:18), on an i9-12900K, 8 threads pinned to 4 performance cores (affinity `0xFF00`), which is also the closest to a good laptop. Two maps derived from that capture: "smooth", the 6 km map stretched to 24 km so that a 1M town fits and slopes are gentle, and "real", the 6 km map as captured (25 % water, a plain, a mountain range in the west). Times are single runs.

The timings are sensitive to what else runs. The same 50k town took 9.5 to 10.6 s on performance cores, 14.6 to 23.5 s with 21 threads on cores 3–23 (the efficiency cores are included), and 85 s while another session was compiling on those cores. A first series taken with 21 threads while other replays ran showed up to 5 times these figures; it is not used below, except for 1M.

### Size (european-organic, smooth map)

| Population | Quarters | Parcels | Programme | Building sites | Chain | Blocks kept |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2,500 | 0.7 s | 0.06 s | 0.02 s | 0.06 s | 0.9 s | 73 |
| 10,000 | 1.8 s | 0.18 s | 0.06 s | 0.22 s | 2.3 s | 237 |
| 25,000 | 4.1 s | 0.41 s | 0.15 s | 0.49 s | 5.1 s | 505 |
| 50,000 | 10.6 s | 0.79 s | 0.29 s | 0.89 s | 12.6 s | 978 |
| 100,000 | 28.1 s | 1.9 s | 0.67 s | 2.5 s | 33.1 s | 1,995 |
| 250,000 | 104.5 s | 4.4 s | 1.5 s | 7.0 s | 117.4 s | 4,553 |
| 1,000,000 | not finished: stopped after 5.5 min in the first check passes (21 threads, plan alone 125 s) | | | | est. 12–20 min | |

### Anatomy of the quarters stage (same runs)

"Plan" is `quarters::generate_once` (footprint, composition, street cut, network cleaning, blocks). "Tail" is everything `generate_quarters` does after it.

| Population | Plan | Tail | Tail share | `programme::prepare` | `programme::allocate` | Bridges + water | Unlabelled tail |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 0.4 s | 1.4 s | 78 % | 6 × 0.03 s | 13 × 0.02 s | 0.03 s | 0.9 s |
| 50,000 | 1.6 s | 9.0 s | 85 % | 8 × 0.16 s | 14 × 0.15 s | 1.0 s | 4.6 s |
| 100,000 | 4.0 s | 24.1 s | 86 % | 7 × 0.37 s | 12 × 0.36 s | 4.8 s | 12.3 s |
| 250,000 | 10.5 s | 94.0 s | 90 % | 8 × 0.90 s | 14 × 0.98 s | 21.9 s | 50.7 s |

The unlabelled half of the tail has no `URBAN_PROFILE` lap. The native sampler attributes it to the same trim passes (cadastre regeneration, lot consolidation, street pruning) and to about ten whole-town finishing passes worth 3 to 14 % each (`join_bank_networks`, `fit_enclosures`, `springs::reserve`, `trim::footprint`, `access::refine`, `fortification::sync_gates`).

### Constraint (real map, culture × site)

| Case | Quarters | Full plans | Plan | Tail | Blocks kept |
| --- | ---: | ---: | ---: | ---: | ---: |
| european-organic 10k, plain | 2.6 s | 1 | 0.8 s | 1.8 s | 215 |
| halfling 10k, plain | 6.3 s | 1 | 2.6 s | 3.7 s | 703 |
| halfling 10k, mountain flank | 24.2 s | 4 | 10.4 s | 13.7 s | 668 |
| european-organic 50k, plain | 17.6 s | 1 | 4.6 s | 13.0 s | 1,144 |
| european-organic 50k, deep mountain | 26.1 s | 1 | 12.7 s | 13.4 s | 752 |
| halfling 50k, plain | 40.8 s | 1 | 11.8 s | 29.0 s | 2,892 |
| halfling 50k, deep mountain | 50.2 s | 1 | 10.5 s | 39.7 s | 3,290 |

On the mountain flank the halfling 10k town replans for capacity, then relaxes its slope gates and lays the whole town out again: four plans, two tails. Neither 50k site triggered these ladders; when they fire at 50k, as they do at 10k, expect three to four times the figures above.

## 3. Diagnosis

**D1. The chain is open-loop at town scale.** It sizes the town by land area, generates everything, measures the outcome with the full downstream stages, then corrects by generating again or by trimming. Every correction loop works on the whole town:

| Loop | Where | Worst case |
| --- | --- | --- |
| Steep land ladder: the footprint flood repeated on steeper grades | `footprint.rs:2528` | 5 floods |
| Capacity replan: second full plan when the measured yield is short | `quarters.rs:2955` | 2 plans |
| Enclosed blocks over the +30 % margin: smaller budget, full plan again | `quarters.rs:2857` | 4 plans |
| Slope relaxation: the whole `lay` (plans and tail) per step | `mod.rs:1851`, `slopes.rs` | 4 lays |
| Trim to a fixed point: programme + cadastre + allocation per pass | `trim.rs:552`, called at `mod.rs:1733` and `mod.rs:1742` | 8 passes |
| Door-based trim after bridges: cadastre + site index + previews per pass | `trim.rs:592` | 4 passes |
| Springs: programme again | `mod.rs:1797` | 1 pass |

These loops nest, so the cost is (lays) × [(plans) × plan + (passes) × whole-town check]. On easy ground only the trim loops run and they already cost 3 to 9 times the plan, more as the town grows. On hard ground the outer loops multiply everything.

**D2. The trim passes exist to answer one question** ("which blocks get no building?") and pay the complete answer each time. `generate_parcels` allocates twice per call (`mod.rs:1964` and `mod.rs:1969`, the second after parcel edits that a probe never has). The memo of `probe_cache` saves the lot cutting of unchanged blocks, but not the programme, the allocation, the consolidation or the pruning, which are global.

**D3. Over-generation is structural.** The land budget is taken before the yield is known, so the plan carries a margin and the excess is removed afterwards: 54 quarters and 293 blocks at 100k, 77 quarters and 618 blocks at 250k, 13 quarters and 209 blocks for the mountain halfling 10k town (whose footprint was first extended by 1.43). All of that land went through the street cut, the network cleaning and several cadastre passes.

**D4. Several kernels are global and superlinear**, which is where the exponent comes from. Between 100k and 250k (× 2.5 in population): bridge selection and water clearing × 4.6, the unlabelled trim work × 4.1, network cleaning × 3.2, one allocation × 2.7, one programme pass × 2.4.

**D5. Constraint is mostly size.** The cost follows blocks and street length, not people: a halfling town has 2.5 to 3.3 times the blocks of a european-organic one and costs 2.3 to 2.4 times as much on the same plain. Terrain detail adds a factor of its own: the plan of the same 50k town takes 4.6 s on the real map against 1.6 s on the smooth one, because every dry test and clip reads water rings of 3,000 vertices. The ladders of D1 come on top when the site refuses land.

**D6. One town is serial.** The 50k town takes 21.6 s on one thread and 9.5 to 10.6 s on 8 to 16. The street cut is parallel per quarter; the network cleaning, the blocks, the whole tail and the allocation are not. More cores do not help a metropolis today, and a pool wider than the performance cores makes it slower.

## 4. Proposal

Four structural changes, in the order of value for effort, then a list of kernels. S1 keeps the present design and is the safe first step. S2 and S3 remove the loops. S4 changes the unit of work and is what makes 1M possible.

### S1. One measuring pass instead of eight (keeps the design)

- Label the tail first: one `URBAN_PROFILE` lap per call in `plan_at` and `finish`, so that the half that is unlabelled today is measured rather than sampled.
- In `trim::unbuilt`, ask for the answer only: one allocation, no second `allocate`, no consolidation, no parcel edits.
- From the second pass on, recompute the dirty set only: the blocks touching a street the previous pass pruned. The programme of the untouched blocks is unchanged.
- Merge the second `trim::run` (after the walls settle), `trim::finish` and the springs pass into one final pass on the final network.
- Give `select_bridges_graded`, `clear_water` and `join_bank_networks` a spatial index over streets and wet runs.

Expected: tail divided by 2 to 2.5 (100k: 28 s → about 13 s). Output: identical or nearly so; the dirty-set pass must be checked on sheets.

### S2. Grow until housed (the accretion design, brought forward)

This is the growth by accretion decided on 26 October for the chronology work; the performance case is a reason to do it now.

- Quarters are opened in growth order (epoch, then distance), which is already the order of the street cut.
- After each batch of quarters, cut their lots and count the households they hold, with the estimator that exists (`parcels::generate` per block and the household rule of `programme::allocate`, restricted to those blocks).
- Stop opening quarters when the requirement and its margin are held. The last quarter is filled from its inner edge; its outer blocks are never cut.
- The programme and the allocation then run once, on a town that has no empty quarter.

Removes D2 and D3: no vacant quarters, no fixed-point trim, no capacity replan (the count is exact as it goes). The only trim left is local (a lane that serves nothing). Expected with S1: 100k in about 7 s, and a cost that follows what is kept. Output changes: the fringe is built by accretion rather than carved, so town edges differ; before and after sheets are needed. Invariant to test: generating to P1 then continuing to P2 equals generating to P2.

### S3. A yield field instead of ladders (the constrained site)

Compute once per site, on the footprint grid, a field of households per hectare for each slope relaxation level (strict, 0.5, 0.75, open): the tissue yield from the reference-block probe that `capacity` already runs, times the share of the cell that passes the slope gate at that level, times its dry share. Then:

- The footprint flood (`footprint::accessible`, already a cost-ordered flood) accumulates households instead of area, charges a premium for the steeper classes, and stops at the requirement. One flood replaces the steep ladder, the area budget and its extension.
- The relaxation level becomes a property of each quarter, read from the cells it took: strict rules on the flat, terraces on the flanks. It replaces the full relays of `SLOPE_RELAX_STEPS` and most of `slopes::complete`, and it is more credible than one level for the whole town.
- The forecast is terrain-aware from the start, so the second plan for a yield "recalibrated to 38 %" disappears.
- Access is decided the same way: one multi-source flood from the existing network gives every cell its cost to the network and its parent. Feeders, exits and "no carriage road reaches this quarter" are read from that field instead of one route search per request, and an unreachable quarter is known before it is cut.

Expected: the mountain halfling 10k town goes from 4 plans and 2 tails to 1 and 1, about 4 s with S2 instead of 24 s. Output changes on steep sites only.

### S4. Districts as the unit of work (the big blocks)

For towns above about 30k, a two-level generation:

1. Macro plan, once, for the whole town: footprint, walls, arterials, river crossings, and districts of 5 to 10k people bounded by arterials, walls and water (`structure.districts` exists). The global programme is split into district quotas: households, trades, and the unique institutions each given to one district.
2. Each district is then an independent job that runs the whole chain (street cut, network cleaning, blocks, cadastre, allocation, building sites) from its own RNG fork, in parallel over districts. Its inputs are fixed: the border arterials and the junction points the macro plan placed on them, so streets of two neighbours meet in crossroads.
3. A light pass stitches the borders and carries unplaced demand to the neighbour districts.

Why it wins: every global kernel of D4 becomes local, so the work is K × f(N/K) instead of f(N); the districts run on all cores (D6); a district is a cacheable product, so an edit regenerates one district; and districts can be generated on demand, nearest to the view first, the others drawn from the macro plan until they arrive. Sparse cultures gain the same way, since their cost is a size cost (D5).

Expected, with S2 inside each district: 100k is 12 districts of the cost of an 8k town, about 8 s of CPU, 2 to 3 s on 8 threads. 1M is 120 districts, about 1.5 min of CPU: 15 to 30 s on 8 to 16 threads, or immediate with districts on demand. Output changes: district borders follow arterials; the programme is distributed by quota rather than by one global competition. This is the largest change and needs S2 first (a district is a small accretion).

### Kernels found on the way

- K1. Catalogue JSON read in inner loops: `composition::culture_data`, `profiles::from_plan`, morph `resolve`, the floor-need rule deserialised under `programme::allocate`. Resolve each culture once into typed structs.
- K2. `geometry::centroid` goes through a geo polygon with heap allocation: 17 % of `allocate` in the sampler. Use a shoelace sum.
- K3. Parcel ids are strings, hashed with SipHash and cloned in the allocation; use indices.
- K4. Terrain detail: simplify the vector geography to a street-scale tolerance and clip it to the site window once per site; sample heights from a site-local grid.
- K5. Thread pool: cap it at the performance cores and keep the generation thread off the efficiency cores (D6, and the setup note of section 2).
- K6. Building sites grow faster than the town above 100k (2.5 s at 100k, 7.0 s at 250k); with S4 they become per district and on demand.

## 5. Expected results

Estimates built from the measured laps, to be confirmed by measurement at each step; quarters stage, 8 threads on performance cores.

| Case | Today | S1 | S1 + S2 | + S3 | + S4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k, smooth map | 1.8 s | 1.1 s | 0.8 s | | |
| 100k, smooth map | 28 s | 13 s | 7 s | | 2–3 s |
| 250k, smooth map | 105 s | 45 s | 22 s | | 4–8 s |
| 1M, smooth map | 12–20 min | 6 min | 3 min | | 15–30 s |
| halfling 10k, mountain flank | 24 s | 17 s | 9 s | 4 s | |
| halfling 50k, plain | 41 s | 21 s | 12 s | | 3–5 s |
| halfling 50k, deep mountain | 50 s | 27 s | 15 s | 13 s | 3–5 s |

## 6. Order of work and risks

1. S1 with the laps: small, low risk, gives the missing half of the tail its numbers.
2. S2: medium. Changes town edges; needs the accretion invariant test and before/after sheets.
3. S3: medium, independent of S2 in the code (footprint and routing), can run in parallel with it.
4. K1 to K5 as a side stream at any time; mechanical, no output change except K4 (water outline tolerance).
5. S4: large. Risks: seams at district borders, institutions that want a town-wide view, walls and rivers crossing districts (kept in the macro plan). Start with the cadastre, allocation and building sites per district on an unchanged street plan, which is already a gain, then move the street cut and cleaning inside the district.

Open decisions for the user: whether S2 comes now or with the chronology work; the district size for S4; and whether the web profile shows districts progressively (macro plan first).

## 7. Reproduce

Tools, logs and sampler profiles of this review are in `web/out/perf-2026-11-14/` (local, not versioned):

- `mkcase.py OUT --pop N --culture ID [--scale K] [--center X,Y] [--archetype none]` derives a replay case from the capture of `web/out/perf-2026-11-13/chain-capture/`. Smooth map: `--scale 4 --center 3600,2100`. Real map: plain `--center 3600,2100`, mountain flank `1600,2900`, deep mountain `1000,2600`.
- `runcase.py EXE THREADS AFFINITY TIMEOUT CASE...` runs cases and prints stage times, pass counts and product counts; `laps.py` splits the quarters stage into plan and tail.
- `profile.ps1 -case NAME -seconds S` samples a run with `tools/winsample.py`; `tree2.py FILE.stacks ROOT` prints the call tree with demangled names. The sampler slows the run about 2.5 times.
- Build once: `rust/scripts/cargo-sync.ps1 build --profile fast -p magna-urbis-local --example cities_native_replay`.

## 8. Implementation status (14 November, same day)

The plan was implemented in four waves of agents (Sonnet and Opus, high effort), each wave ending with one build, the replay suite and a comparison against a reference frozen before any change. The work is in the working tree, not committed.

### What was done

- **S1, one measuring pass.** `trim::unbuilt` uses a probe cadastre (`probe_parcels`: one allocation, no lot finishing). The second `trim::run` and the second enclosure fit run only when the walls changed the blocks or streets (a signature of the plan). The trim still runs to its exact fixed point: an early stop was tried and rejected, because it left a dead-end lane on one town (unit test `serviced_quarters_fill_from_the_core_with_a_bounded_population`); the repeated passes are cheaper instead (block-cut memo no longer keyed by block index, block radius memoised, lean-to lots in parallel).
- **S3, constrained sites (partly).** `footprint/terrain.rs` surveys the land the footprint really takes with the programme's own block-slope statistic. On a site whose strict slope gate refuses more than half of that land, the relaxation level is chosen before the first layout (`footprint::slope_relax_ahead`), the capacity forecast counts the housable land, and the footprint flood takes flat land first and stops on housable area. The old relays stay as a safety net. Ordinary ground does not enter this path. Not done: the access flood, and the capacity replan caused by giant unreachable blocks, which still costs a second plan on steep sites.
- **S4, in a different form.** No district jobs. Instead every whole-town pass found by the laps was made local with spatial indexes and run in parallel where its items are independent, with byte-identical output: network cleaning and exits, hierarchy, fringe frontages, squares, the vacant-land clean-up (30 s → 0.03 s at 1M), bank joining, bridge selection, river spurs, enclosure fitting (46 + 55 s → 5 + 5 s at 1M), springs (27 s → 0.2 s), footprint outline (26 s → 4.7 s), gates, road ends.
- **Kernels.** `programme::allocate` and `prepare` (invariants hoisted, indices instead of scans, Fx hashing for pure caches, allocation-free `centroid` that reproduces geo's arithmetic). The building-sites request no longer materialises the town as JSON trees: it streams typed rows in chunks (125 s → 11.5 s at 1M, same bytes).
- **Chronology hook.** `urban::grown_at(layout, population)` says which quarters exist at a population, in growth order (epoch, then distance from the centre), from the epochs the layout already stores. One function, no new field.
- **Laps.** `URBAN_PROFILE` now labels the whole tail (`tail.*`, `parcels.*`, `quarters.*` and finer laps inside the passes).

### What was not done

- **S2, growth by accretion.** The capacity forecast that would decide when to stop opening quarters is wrong by a factor of 3 to 4 (83,000 households forecast for 25,000 required at 100k), and what gets built today is decided by the allocation order, not by the forecast. Stopping on that forecast would cut towns to a third; stopping on a measure of cut blocks changes how every town edge looks. It needs a design decision on the fringe, so it was left out rather than risk the look.
- **District jobs with seams, and districts on demand.** They would change the result slightly and need before/after sheets.

### Results

Replay of the same requests, 8 threads on performance cores, `fast` profile. Chain = quarters + parcels + programme + building sites.

| Case | Chain before | Chain after | Quarters before → after |
| --- | ---: | ---: | ---: |
| european-organic 10k, real map | 3.8 s | 2.7 s | 2.6 → 1.6 s |
| european-organic 50k, real map | 20.6 s | 10.1 s | 17.9 → 8.3 s |
| european-organic 100k, smooth map | 32.5 s | 13.5 s | 27.8 → 10.4 s |
| chinese 100k, smooth map | 16.4 s | 8.6 s | 14.3 → 7.1 s |
| european-organic 250k | 117 s | 32.8 s | 104.5 → 25.7 s |
| european-organic 1M | about 9 min (first complete run, after wave 1) | 138 s | 387 → 109.6 s |
| halfling 10k, plain | 7.8 s | 4.4 s | 6.8 → 3.8 s |
| halfling 10k, mountain flank | 25.5 s | 10.9 s | 23.7 → 10.2 s (4 plans → 2) |
| persian 20k, deep mountain | 26.1 s | 26.2 s | unchanged (3 plans, 9 s of informal quarters) |

So about 2 to 2.4 times faster up to 100k, 3.6 times at 250k, about 4 times at 1M. The target of 15 to 30 s at 1M is not reached.

End to end, in the review sheet regenerated with the new engine the same day (one row = generation, six pictures, page work): the 150k rows took 263 s (chinese), 204 s (aztec), 527 s (wizard-city with elven) and 1,393 s (persian with medina), against 1,001 s, 820 s, 3,741 s and 2,158 s in the regeneration of 11–12 November.

### Verification

- 18 of the 20 suite towns are byte-identical to the towns of the reference build (layouts, parcels, building sites). The two that differ are the steep sites S3 changes on purpose: the halfling flank town (more compact, 627 blocks for 535, all households housed) and the Persian deep-mountain town (the wall now encloses a built core: share of the walled area built 0.30 → 0.58). Pictures of all cases before and after are in `web/out/perf-2026-11-14/avant-apres/`.
- `cargo test -p magna-urbis-core --lib urban::`: 655 passed, 0 failed.

### A town of 1M cannot be shown yet

The engine generates a 1M town, but neither page can receive it. Measured on the three 1M rows tried for the review sheet (City Bench, 16 km map): every urban request is answered (the engine now prints one stderr line per `/urban` request: outcome and reply size), the quarters reply is 89 MB, and the parcels and programme reply is 557 MB of JSON. A browser cannot hold a string above about 537 MB, so the page fails to read it and shows "Calcul refusé". The same reply is 531 MiB in the V2 chain. Its content: parcels 313 MiB (contacts 35 %, shapes 24 %, envelopes 11 %), allocations 162 MiB (repeated identifiers, reasons and labels as text), adjacency 51 MiB (pairs of 68-character parcel ids). Even under the limit, the parsed objects would not fit the 4 GB of a browser tab. So a metropolis needs the same treatment the building sites got: a compact binary reply read as typed arrays, kept in the engine and sent by district on demand. Until then the practical ceiling of the pages is a few hundred thousand inhabitants.

### Where the time is now, and the next levers

1M town, quarters stage 110 s: trim passes 40 s, plan 21 s (street cut 6.5 s, composition 5.5 s), door pass 14 s, enclosure fit 10 s, bridges 6 s, footprint 5 s, programme 4.5 s, access 3 s. Then parcels 12.7 s, programme 4.2 s, building sites 11.5 s.

1. S2 with a decision on the fringe: no over-generation and no trim loop, about a third of the stage.
2. Keep the layout in memory between engine requests: the quarters reply goes through JSON text and comes back with coordinates changed in the last bit, so the parcels request cannot reuse the cadastre the quarters stage just cut (12.7 s at 1M).
3. District tiles for the street cut and the network cleaning (plan 21 s → about 12 s), then districts on demand.
4. `fit_to_built` and the block buffer of `trim::footprint`: still whole-town polygon operations, kept whole because a split changes the ring representation downstream.
5. Steep sites: the access flood and the giant unreachable blocks behind the capacity replan; the informal-quarter extension on the Persian case (9 s).
