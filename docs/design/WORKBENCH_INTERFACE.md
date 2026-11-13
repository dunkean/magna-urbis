# V2 workshop interface

## Command hierarchy

The project header owns New, Open, Share and Export. Settings contains language, units, execution choices, optional services, installed modules and model management. The illustration action opens the shared illustration client with the V2 workshop theme.

The scene bar owns the appearance preset, the 2D/3D switch, date, apparent solar time and latitude. These remain visible independently of the selected generation family. The generation sidebar retains its four families: Region, Settlements, Cities and Map. Detailed layer controls remain in the Map family.

The editing bar owns navigation, building/district/parcel inspection, moving towns, road selection and drawing, river removal and names. An active tool opens one contextual dock on the map. Tool settings are mounted in this dock rather than in separate generation families. Finish editing, the dock close button and Escape return to navigation. Starting another tool stops the previous tool through the existing `v2-edit-mode` event. An open dialog retains ownership of Escape.

At narrow widths, scene inputs remain visible, editing tools scroll horizontally, and the generation sidebar opens over the map. The app uses its actual content heights rather than subtracting a fixed header height from the viewport.

## Calendar and solar lighting

`V2Settings.scene` contains an ISO calendar date, `HH:mm` apparent solar time and a latitude in degrees (north positive). New sessions start on 1 July 2026 at 14:00, latitude 45°. The clock is display state and does not enter generation cache keys.

The date sets the annual cycle used by the retained seasonal palettes. Southern latitudes shift this cycle by half a year. The solar declination and spherical sun position follow the [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF). Time is already apparent solar time: noon is the local meridian crossing. No longitude, civil timezone or daylight-saving rule is inferred from the user's device.

The derived sun azimuth and altitude write the existing composition lighting controls. The existing renderer accepts elevations from 5° to 90°; lower positive solar altitudes use 5°. Below the horizon, ambience becomes night and direct solar shading is disabled. This is an approximate display clock, not an astronomical simulation or a new shader model.

Projects without a scene clock retain their historical manual lighting. Apply date & time opts them into the clock. An explicit season, ambience, solar-direction or light-enable edit returns to manual mode. Appearance preset changes retain a linked clock. Climate-specific seasonal calendars remain advanced render settings.

## Execution information

Settings distinguishes three different kinds of information:

1. **Next execution:** the configured engine, compute preference, city builder and optional neural runtime. Advanced overrides expose terrain sampling, procedural compute and hydrology compute.
2. **Processes and engines:** configured choices alongside evidence stored in the retained terrain and city products. Changing a preference does not relabel the previous result. Rendering is reported independently from generation. Missing evidence is shown explicitly.
3. **Available hardware and services:** detected browser/GPU capability and local service availability. An available native service is not automatically presented as the selected engine.

The complete generation log remains available in a separate disclosure. Illustration models are selected inside the illustration window; they are independent from terrain generation.

## Verification

Run `node scripts/v2_workbench_check.mjs` from `web/` with the V2 dev server on port 5174 (or set `MAGNA_V2_URL`). The browser check exercises real import/export and generation controls, the clock, mutually exclusive editing tools, engine changes after importing a project, the illustration theme, French/English switching and layouts at 1440, 1024, 768 and 390 pixels. Generated review captures go to the ignored `web/out/workbench/` directory.

The calendar's solar geometry, persistence, legacy compatibility and generation-cache independence are covered by `v2SceneClock.test.ts`. `v2ExecutionOverview.test.ts` verifies that a configured engine is not presented as execution evidence and that CPU fallback evidence remains distinct from a subsequent GPU choice.
