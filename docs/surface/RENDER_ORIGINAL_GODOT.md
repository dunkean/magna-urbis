# Original renderer: Godot 2D window

This isolated project displays the output of `RenderOriginalRD`. It loads no Terrain3D, atlas/PBR, trees or SurfaceWorld 3D pipeline. The original renderer's calculations and four pipelines belong to the renderer; `main.gd` only loads the exported scene, displays its texture and moves the view. The full-screen texture is vertically flipped (`flip_v=true`) to preserve the original WebGL FBO convention; display filtering is nearest-neighbor.

```powershell
.\Test-Render.ps1 -Scene 'PATH/fixture.json' -Check
.\Test-Render.ps1 -Scene 'PATH/fixture.json'
.\Test-Render.ps1 -Scene 'PATH/fixture.json' -Width 160 -Focus '20000,20000'
.\Test-Render.ps1 -Scene 'PATH/fixture.json' -Resolution 1024x640 -Frames 4 -Capture './capture.png'
```

`Test-Render.cmd` passes the same arguments to local PowerShell. No files are installed or downloaded. `-Check` validates the fixture's inputs, shaders and local references without starting Godot or the GPU. It does not independently certify identity with the original: renderer hashes and comparisons remain separate evidence. The scene path is explicit; no substitute scene is fabricated if it is missing.

Defaults: 40000 m width, center 20000/20000, fixed 1280×800 window. `-Resolution` sets the startup size; this first version does not request reallocation on window resize. `-Width` and `-Focus` are camera parameters, not generation or movement of source data.

- Left drag: pan.
- Wheel: zoom around the cursor.
- H: show or hide help.
- S: capture the renderer in the Godot user `captures` directory.
- Escape: exit and clean up renderer resources.

The logical camera retains center and width as float64 scalars. It sends the top-left corner `[x,y]` and meters per pixel; no world position is converted to float32 `Vector2` in the wrapper. A view request is sent only on change, without a ScenePrepare worker or 3D scene computation. The historical `--z` CLI parameter carries the second planar Y coordinate of Render.

The required contract is `configure(scene_path, size)->bool`, `set_view(origin, mpp)`, `output_texture`, `ready`, `failed`, `stats()`, asynchronous `capture_png(path)` and `cleanup()`. A renderer configuration or runtime error causes explicit failure. `--frames 0` leaves the window interactive; a positive number exits after that many ready frames. With capture, the default is two ready frames. The PNG comes from the renderer without HUD, separate from a window screenshot.

This wrapper adds no pattern, recipe, terrain or evidence of observed ground. The source remains the exported fixture. GPU visual parity with the original web Render must be measured separately; syntax validation or launcher preflight does not provide that qualification.
