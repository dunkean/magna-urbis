# Source-level boundary query roundoff

The retained V7 40 km source is clipped in float64 before triangulation. A relative FP32 vertex at a known clipped boundary reconstructs as -0.000122070301586 m when the render origin is 20038.9862060547 m. The previous strict source-support check rejected 43 triangles, totaling 33242.4971079826 m². The identical source at the 10 km render origin has no missing triangles.

The adapter retries only failed queries outside source support by at most half an ULP of their FP32 relative coordinate (plus float64 origin-addition roundoff). It clamps the **lookup coordinate**, leaving mesh vertices, source contours, measured levels, wet search neighbourhood and genuine missing data unchanged.

`float-boundary-report.json` records the exact reproduction, 40 km and 10 km origins, a 64 m rebase and a translated world at ±1e9 m. All four production `SurfaceHydrology.prepare` runs retain zero missing triangles/area after the correction. Synthetic tests preserve absent wet levels and reject genuinely out-of-domain points. This is CPU evidence of source-level lookup and geometry assembly, not a new GPU image or source generation.
