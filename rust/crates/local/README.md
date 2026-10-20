# Local engine

`cargo build --release -p magna-urbis-local` builds the loopback service on Windows
and Linux. No browser or WASM runtime is needed by the executable. The web profile
does not depend on this crate.

Run `magna-urbis-local --port 8791` (or `--port 0` for a free port). The first stdout
line is JSON: `{"ready":true,"port":8791}`. `MAGNA_LOCAL_ADDR` overrides the default
`127.0.0.1:8791`; only loopback bindings and local browser origins are accepted.

- `GET /status` identifies the service and protocol version.
- `POST /terrain` prepares and retains the native core terrain, zones and coasts,
  and samples camera regions without regenerating them.
- `POST /raster` uploads the adapted settlement raster once, in binary.
- `POST /settlements` runs placement and/or roads against that retained raster.
- `POST /urban` generates quarters or recuts retained layouts into parcels.
- `POST /houses/catalogue`, `/houses/preflight`, `/houses/generate` reuse the
  native houses catalogue and generator, with the existing JSON envelope.
- `POST /release` drops one session explicitly.

The TypeScript adapters in `bridge/nativeEngine.ts` and `bridge/nativeTerrain.ts`
define the request boundary. Terrain and raster packets contain a little-endian
u32 padded-header length, a JSON header padded to four bytes, then raw arrays.
Terrain replies describe their arrays in the header; raster uploads contain
height, water level, river width (f32), river ID (i32), then water mask (u8).
There is no base64 or JSON raster conversion on ordinary terrain/urban transfers.

Eight least-recently-used sessions are retained at most, with a bounded number of
concurrent requests. Each bench has its own session. Neural calculations keep
their existing GPU services; the browser keeps the current GPU sampling and water
chain after native procedural generation. Regional and coastal/zoned physical raster
control points are transferred exactly. Analytic plains, valleys and finite shapes
are sampled once at 1024² for that GPU chain, bounding their finest available detail; direct native
regional sampling and cavern masks remain available through `/terrain`.
