# Source boundary and hydrology channels in V13

Both GPU trials use the freshly generated **retained** V12 packet, without regeneration or navigation. They do not qualify all of V13. They ran sequentially on RTX 5090 / Forward+ with Dummy audio and no shader or runtime errors. V12 captures remain unchanged.

## Terrain boundary

The [40 km capture](evidence/source-edge-v13/40000m.png) and its [report](evidence/source-edge-v13/report.json) cover clean runtime `3e46b87`. The source file keeps exactly the same SHA before and after.

Filling representation images alone extends the edge sample to form a triangle. The shader then clips every fragment outside the exact union of validated domains. Hole bits remain in native data and interior holes remain honoured. Exported heights and height queries outside the source are not extended.

In this 40 km framing, sample centres begin at 39.0625 m: about two pixels per edge are actually outside support. The new capture shows these two columns on the left and right. The documented sky classifier measures 31 right-hand columns in the historical V12 capture versus two here. The images are not an A/B comparison of every pixel: the V12 tour had already loaded a refined RPC world. The 27 CPU assertions independently check disjoint domains, rebasing, cache precision, heights and holes. The only two stable frame samples cannot establish FPS.

## Six points from the halos reported by Opus

The [GPU channel report](evidence/water-confluence-v13.json) isolates source fill, its alpha, the symbol result, its alpha and class bytes. The [CPU diagnostic](evidence/hydro-v13-cpu-diagnostic.json) retains fields and distances to source geometry. Coordinates refer to the 2048 × 1280 V12 10 km image, not world coordinates.

| Pixels | Bounded measurement and interpretation |
| --- | --- |
| (1562,451), (1014,1091), (563,415) | Zero alpha before and after the symbol. Support contains alluvium inferred from context; removing these colours by changing the water mask would erase a ground material. |
| (1935,246) | Alpha 1 before and after, but the bank uses the symbol's fallback tint over river fill. This representation contrast is real and distinct from a network hole. |
| (620,1193), (1572,543) | Zero source alpha and symbolic alpha 1: these points near a real bank are covered by the declared 1.25-pixel symbol, not a new physical surface. |

Bake classification comes from **retained source** classes, not the physical raster cropped by the compiler. Polygons do not carry a river/lake label per group. A declared uniform tint for vectors can harmonise fill and symbol without inventing a class; it requires its own A/B. No source alluvial deposit, contour, level or width is changed by these diagnostics.

This [tint A/B](evidence/water-tint-v13.json) now passes on `cb37de2`: all twelve historical-mode PNGs are byte-exact against previous controls, and all alpha channels remain byte-exact in uniform mode. Classes, source and vertices remain identical. At (1935,246), fill and symbol now share a tint without changing the three alluvial points. A separate two-triangle GPU fixture actually checks `VERTEX_ID` for vector/sea; these six windows contain no real sea. The fixture is not new geographic evidence.

`--water-vector-tint uniform` enables this representation; `source-classes` remains the default. The driver receives `--viewer-water-vector-tint uniform` and checks policy, partitions, fill/bank tint and absence of a new class at every capture. Physical `source-levels` mode rejects this option.

The `ground-mean-unlit` diagnostic now masks all objects, including water and road Decals, to measure ground alone. V12 retained those Decals: its diagnostic helped locate the defect, but did not fully separate ground from water projection.

[Original French version](HYDROLOGY_V13_DIAGNOSTIC_FR.md).
