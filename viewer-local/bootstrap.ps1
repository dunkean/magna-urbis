param([string]$Godot = $env:GODOT, [switch]$Run, [string]$World, [string]$Assets)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$url = 'https://github.com/TokisanGames/Terrain3D/releases/download/v1.0.2-stable/Terrain3D_v1.0.2-stable.zip'
$sha = 'A071850250EC5E596AA54DA61C01D75768774EB379EE997584D426A45F4884A2'
$archive = Join-Path $project '.deps/terrain3d-1.0.2.zip'
New-Item -ItemType Directory -Force (Join-Path $project '.deps') | Out-Null
if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest $url -OutFile $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sha) { throw 'Terrain3D archive checksum mismatch' }
if (!(Test-Path -LiteralPath (Join-Path $project '.deps/terrain3d-1.0.2/addons/terrain_3d/terrain.gdextension'))) {
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $project '.deps/terrain3d-1.0.2') -Force
}
$copyAddon = $false
foreach ($relative in @('terrain.gdextension', 'extras/shaders/minimum.gdshader', 'bin/libterrain.windows.debug.x86_64.dll')) {
    $expected = Join-Path $project ('.deps/terrain3d-1.0.2/addons/terrain_3d/' + $relative)
    $installed = Join-Path $project ('addons/terrain_3d/' + $relative)
    if (!(Test-Path -LiteralPath $installed) -or (Get-FileHash -LiteralPath $expected).Hash -ne (Get-FileHash -LiteralPath $installed).Hash) { $copyAddon = $true }
}
if ($copyAddon) {
    Copy-Item -LiteralPath (Join-Path $project '.deps/terrain3d-1.0.2/addons') -Destination $project -Recurse -Force
}
if ($Godot) {
    & $Godot --headless --path $project --editor --import --quit
    if ($LASTEXITCODE -ne 0) { throw 'Godot import failed' }
}
if ($Run) {
    if (!$Godot -or !$World) { throw '-Run requires -Godot and -World' }
    $arguments = @('--path', $project, '--', '--world', (Resolve-Path -LiteralPath $World).Path)
    if ($Assets) { $arguments += @('--assets', (Resolve-Path -LiteralPath $Assets).Path) }
    & $Godot @arguments
}
