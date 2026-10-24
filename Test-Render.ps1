[CmdletBinding()]
param(
    [string]$Scene = '',
    [double]$Width = 40000,
    [string]$Focus = '20000,20000',
    [string]$Resolution = '1280x800',
    [string]$Capture = '',
    [int]$Frames = 0,
    [switch]$Check,
    [string]$Godot = 'D:/workspace/self/_surface-tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe'
)
$ErrorActionPreference = 'Stop'
function Require-File([string]$Path, [switch]$AllowEmpty) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Fichier local absent : $Path. Aucun téléchargement automatique." }
    if (!$AllowEmpty -and (Get-Item -LiteralPath $Path).Length -eq 0) { throw "Fichier vide : $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}
if (!$Scene) { throw 'Indiquer -Scene CHEMIN/fixture.json (export exact du Render original).' }
if ([double]::IsNaN($Width) -or [double]::IsInfinity($Width) -or $Width -le 0) { throw 'Width doit être une largeur finie positive en mètres.' }
$parts = $Focus.Split(',')
if ($parts.Count -ne 2) { throw 'Focus attendu : X,Y (par exemple 20000,20000).' }
$coordinates = foreach ($part in $parts) {
    $value = 0.0
    if (![double]::TryParse($part, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or [double]::IsNaN($value) -or [double]::IsInfinity($value)) { throw 'Focus doit contenir deux nombres finis (décimales avec point).' }
    $value.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
}
if ($Resolution -notmatch '^([0-9]+)x([0-9]+)$' -or [int]$Matches[1] -lt 64 -or [int]$Matches[1] -gt 4096 -or [int]$Matches[2] -lt 64 -or [int]$Matches[2] -gt 4096) { throw 'Resolution attendue : WIDTHxHEIGHT, chaque dimension de 64 à 4096.' }
if ($Frames -lt 0) { throw 'Frames doit être positif ou nul (interactif).' }
if ($Capture -and $Frames -eq 0) { $Frames = 2 }
$Godot = Require-File $Godot; $Scene = Require-File $Scene
$project = Join-Path $PSScriptRoot 'godot-render'
foreach ($file in @('project.godot','main.gd','render_original_rd.gd')) { $null = Require-File (Join-Path $project $file) }
foreach ($program in @('terrain','river','composite','renderWater')) {
    foreach ($stage in @('vert','frag')) { $null = Require-File (Join-Path $project "shaders/$program.$stage.glsl") }
}
$null = Require-File (Join-Path $project 'shaders/shader_layout.json')
$fixture = Get-Content -LiteralPath $Scene -Raw -Encoding UTF8 | ConvertFrom-Json
if ($fixture.format -cne 'magna-render-original-fixture' -or $fixture.version -ne 1) { throw 'Format/version de fixture Render original non reconnu.' }
$fixtureDirectory = Split-Path $Scene -Parent
function Fixture-File([string]$Relative, [switch]$AllowEmpty) {
    if (!$Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '^[a-zA-Z]+:') { throw "Référence locale relative attendue : $Relative" }
    $path = [IO.Path]::GetFullPath((Join-Path $fixtureDirectory $Relative))
    if (!$path.StartsWith($fixtureDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Référence hors dossier fixture : $Relative" }
    return Require-File $path -AllowEmpty:$AllowEmpty
}
$textureCount = 0
foreach ($entry in $fixture.data.PSObject.Properties) {
    $texture = $entry.Value
    if ($texture.format -cnotin @('RF','RGF','RGBA8','R8')) { throw "Format texture inconnu : $($texture.format)" }
    $path = Fixture-File $texture.file
    foreach ($mip in $texture.mips) {
        if ($mip.width -le 0 -or $mip.height -le 0 -or $mip.byteOffset -lt 0 -or $mip.byteLength -le 0 -or ($mip.byteOffset + $mip.byteLength) -gt (Get-Item -LiteralPath $path).Length) { throw "Mip hors fichier : $($texture.file)" }
    }
    $textureCount++
}
if ($textureCount -eq 0) { throw 'Aucune texture source dans cette fixture.' }
foreach ($entry in $fixture.buffers.PSObject.Properties) { $null = Fixture-File $entry.Value.file -AllowEmpty }
if ($fixture.reference.pngFile) { $null = Fixture-File $fixture.reference.pngFile }
if ($fixture.reference.rgbaFile) { $null = Fixture-File $fixture.reference.rgbaFile }
$launch = @('--audio-driver','Dummy','--path',$project,'--script','res://main.gd','--','--scene',$Scene,
    '--width',$Width.ToString('R',[Globalization.CultureInfo]::InvariantCulture),'--x',$coordinates[0],'--z',$coordinates[1],
    '--resolution',$Resolution,'--frames',$Frames.ToString([Globalization.CultureInfo]::InvariantCulture))
if ($Capture) { $Capture = [IO.Path]::GetFullPath($Capture); $launch += @('--capture',$Capture) }
Write-Host "Render original 2D — $Width m ; centre $Focus ; $Resolution ; $textureCount textures locales."
Write-Host 'Glisser : déplacer ; molette : zoom au curseur ; H : aide ; S : capture ; Échap : quitter.'
Write-Host 'Données source retenues. Aucun Terrain3D, PBR, arbre, atlas ou téléchargement.'
if ($Check) { Write-Host 'Check terminé : aucun moteur ni GPU lancé.'; return }
if ($Capture) { $null = New-Item -ItemType Directory -Force -Path (Split-Path $Capture -Parent) }
& $Godot @launch
if ($LASTEXITCODE -ne 0) { throw "Godot a quitté avec le code $LASTEXITCODE." }
