# V10 upload diagnostic

V10 remains FAILED. Its recorded large preview has a 10.717 s gap between the first and second chunk response callbacks; another preview has a 9.755 s gap from worker output to the first response callback. These are Playwright/CDP callback timestamps, not independently persisted broker receive/send times. The simultaneous native 10.550 s frame/input stall prevents attributing this to network throughput alone.

A short CPU/HTTP-only test uses Chromium with GPU disabled, the actual production `postSurfaceBinary` and `createSurfaceLiveBroker`, and the complete archived 69.8 MB live-refinement body. It is **not** a replay of the unarchived 9.35 MB preview. No UI application, Vite middleware, native renderer, shader or generation runs in this test.

The 17 ordered 4 MiB chunks preserve the complete SHA. Total transfer: 3.813 s. Maximum client fetch-to-headers: 236 ms. Maximum acknowledgement-to-next-request: 0.10 ms. Maximum broker processing interval: 46.5 ms. Maximum Node event-loop delay: 359 ms. No 10 s pause reproduced. See [v10-upload-isolated-http.json](evidence/v10-upload-isolated-http.json).

This result does not clear the browser UI, Vite, driver or OS during the actual campaign. Post-run CPU/RAM availability is not an in-stall measurement. No unrelated process was stopped, and no runtime fix is made on this evidence alone.

The next full trace should persist the actual preview body and SHA, browser upload start/header/JSON-ack marks, CDP `request.timing()`, browser long tasks, independent broker monotonic read/copy/send marks and event-loop delay, aligned to the new native phase instrumentation. Moving upload into a Worker could improve resilience to a main-thread task, but is not established as the fix for V10 and is not implemented here.

Reproduce in the private checkout:

```powershell
cd web
npx tsx scripts/probe_surface_upload_chain.ts --source <archived.surfacebin> --out <report.json> --browser <cached chromium executable>
```

The tool owns and closes its local ephemeral HTTP server and isolated browser. It never invokes neural generation or Godot.
