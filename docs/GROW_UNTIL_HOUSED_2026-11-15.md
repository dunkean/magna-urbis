# Growth that stops when the town is housed

15 November 2026. Decision note on the one large lever left in the quarters stage ("S2" of `CITY_GENERATION_SCALING_2026-11-14.md`). Nothing described here is implemented.

## Summary

Today a town is planned about a quarter too large, then cut back until only built land remains. Stopping the growth as soon as the households are housed would remove that surplus and the loop that cuts it back. It saves about a third of the quarters stage (3 s at 100k, 30 to 35 s at 1M), changes the edge of every town, and costs four to six agent sessions plus two rounds of picture review. For ordinary towns the time saved is small; the stronger reason to do it is growth over time.

## What happens today

1. The land budget is taken before the yield of the land is known, so the plan carries a margin. The forecast of capacity cannot be used to size it: it is wrong by a factor of 3 to 4 (83,000 households forecast for 25,000 required at 100k).
2. Every quarter of that plan gets its streets, its blocks and several cadastre passes.
3. The trim then asks, over the whole town, "which blocks get no building?", gives the empty quarters and blocks back to the fields, prunes their streets, and asks again, because pruning changes the answer. It must reach its exact fixed point: four passes, then two more after the walls settle.

Measured on the current tree (8 threads, reference setting):

| Town | Quarters stage | Trim loop inside it | Land given back |
| --- | --- | --- | --- |
| 100,000 | 10.4 s | 3.9 s | 54 quarters, 293 blocks |
| 250,000 | 24.5 s | not split | 77 quarters, 618 blocks |
| 1,000,000 | 98.4 s | 40.3 s | not counted |

The work of this weekend made each pass cheaper with identical output. What is left cannot be removed without changing the result: the second pass really does see different streets and pressures.

## What the change is

- Quarters are opened in growth order (epoch, then distance from the centre), which is already the order of the street cut.
- After each batch, their lots are cut and the households they hold are counted, with the probe cadastre that exists since this weekend.
- Opening stops when the requirement and its margin are held. The last quarter is filled from its inner edge; its outer blocks are never cut.
- The programme and the allocation run once, on a town with no empty quarter. The only trim left is local (a lane that serves nothing).

The stop must use the measured count, never the forecast.

## What it means for the towns

- **Every town edge changes.** Today the edge is carved: what is left after empty land was removed from a larger plan. With this change the edge is where growth stopped. Expect a more compact fringe and fewer isolated built blocks far out along the roads. Fringe fields, exits and gate villages attach to that new edge.
- **The walled core should not change in principle**, since it belongs to the earliest growth; the wall fit reads the built lots, so it must be checked on the wall indicators (share of the walled area built, households per hectare inside, empty blocks inside).
- **Which lots get a house can shift**, because today the allocation order decides what is built on a plan that is too large.
- **Same seed, different town.** Saved towns, test references and the review sheets all change. The project accepts that, but it means a full review.
- **Constrained sites gain most**: a mountain or a low-density culture extends its footprint first (by 1.43 for the halfling flank town) and pays for land it gives back.

## What it enables besides speed

- **Real growth over time.** Generating to a population P1 and continuing to P2 gives the same town as generating to P2 directly. The chronology hook `urban::grown_at` becomes exact, and a town can be shown at any date of its history or grown on request.
- **A cost that follows what is kept**, instead of what was planned.
- **Fewer nested loops**: the capacity replan disappears with the over-generation.

## Time saved

Estimates, not measures: the trim passes after the first go away, and the surplus share of the plan with them.

| Town | Quarters stage today | Expected | Click to map in the V2 today | Expected |
| --- | --- | --- | --- | --- |
| 20,000 | about 3 s | about 2.5 s | 21 s | about 20 s |
| 100,000 | 10.4 s | about 7 s | 40 to 43 s | about 37 to 40 s |
| 1,000,000 | 98.4 s | about 65 s | 282 s | about 250 s |

## Development cost

| Step | Work | Size |
| --- | --- | --- |
| 1. Measured stop | Open quarters in batches, cut and count, stop rule. The present trim stays as a safety net and should find nothing. | 2 to 3 agent sessions |
| 2. The fringe | Last quarter, edge blocks, fringe fields, exits, gate villages; pictures of the 20-town suite and the wall indicators. | 1 to 2 sessions, then a review of pictures |
| 3. Clean-up | Remove the fixed-point trim and the capacity replan, update the urban tests (about 680, some assert counts and shapes). | 1 session |
| 4. Review sheets | Every town changes: the sheets are regenerated and reviewed. | Hours of machine time, then a review |

In all: four to six agent sessions of two to three hours, two review rounds, two to three days elapsed.

## Risks

- A stop that does not agree with the final allocation leaves a town short or over its population. The count must be the allocation's own rule, on the same blocks.
- The paths that are not ordinary towns need their own check: walled towns (today's test of enclosed blocks over the margin triggers a replan), small places and camps, informal quarters (they extend a formal prefix), neighbouring towns, the density gradient.
- The look of the fringe is a matter of taste. It cannot be validated by tests alone.

## Recommendation

Do not do it for speed alone: ordinary towns gain one to three seconds. Do it when growth over time is wanted, and then as a layout option beside the present behaviour (carved by default, accretion on request) until the pictures are approved, so that no existing town changes before the review.
