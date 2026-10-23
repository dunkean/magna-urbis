param([string]$Godot = $env:GODOT, [switch]$Run, [string]$World, [string]$Assets)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
function At([string]$relative) { [System.IO.Path]::Combine($project, $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)) }
function Sha256([string]$path) {
    $stream = [System.IO.File]::OpenRead($path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function CopyTree([string]$source, [string]$target) {
    [System.IO.Directory]::CreateDirectory($target) | Out-Null
    foreach ($directory in [System.IO.Directory]::GetDirectories($source, '*', [System.IO.SearchOption]::AllDirectories)) {
        [System.IO.Directory]::CreateDirectory($target + $directory.Substring($source.Length)) | Out-Null
    }
    foreach ($file in [System.IO.Directory]::GetFiles($source, '*', [System.IO.SearchOption]::AllDirectories)) {
        [System.IO.File]::Copy($file, $target + $file.Substring($source.Length), $true)
    }
}
$url = 'https://github.com/TokisanGames/Terrain3D/releases/download/v1.0.2-stable/Terrain3D_v1.0.2-stable.zip'
$sha = 'A071850250EC5E596AA54DA61C01D75768774EB379EE997584D426A45F4884A2'
$archive = At '.deps/terrain3d-1.0.2.zip'
[System.IO.Directory]::CreateDirectory((At '.deps')) | Out-Null
if (![System.IO.File]::Exists($archive)) {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $client = New-Object System.Net.WebClient
    try { $client.DownloadFile($url, $archive) } finally { $client.Dispose() }
}
if ((Sha256 $archive) -ne $sha) { throw 'Terrain3D archive checksum mismatch' }
$unpacked = At '.deps/terrain3d-1.0.2'
if (![System.IO.File]::Exists([System.IO.Path]::Combine($unpacked, 'addons/terrain_3d/terrain.gdextension'))) {
    [System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
    $staging = At ('.deps/extract-' + [System.Guid]::NewGuid().ToString('N'))
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    CopyTree $staging $unpacked
}
$copyAddon = $false
foreach ($relative in @('terrain.gdextension', 'extras/shaders/minimum.gdshader', 'bin/libterrain.windows.debug.x86_64.dll')) {
    $expected = At ('.deps/terrain3d-1.0.2/addons/terrain_3d/' + $relative)
    $installed = At ('addons/terrain_3d/' + $relative)
    if (![System.IO.File]::Exists($installed) -or (Sha256 $expected) -ne (Sha256 $installed)) { $copyAddon = $true }
}
if ($copyAddon) { CopyTree (At '.deps/terrain3d-1.0.2/addons') (At 'addons') }
if ($Godot) {
    $version = & $Godot --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^4\.7\.2\.stable\.') { throw 'Expected pinned Godot 4.7.2 stable' }
    & $Godot --headless --path $project --editor --import --quit
    if ($LASTEXITCODE -ne 0) { throw 'Godot import failed' }
}
if ($Run) {
    if (!$Godot -or !$World) { throw '-Run requires -Godot and -World' }
    $arguments = @('--path', $project, '--rendering-method', 'forward_plus', '--', '--world', [System.IO.Path]::GetFullPath($World))
    if ($Assets) { $arguments += @('--assets', [System.IO.Path]::GetFullPath($Assets)) }
    & $Godot @arguments
}
