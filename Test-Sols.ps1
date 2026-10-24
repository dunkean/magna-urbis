[CmdletBinding()]
param(
    [double]$Width = 40,
    [string]$Focus = '20000,20000',
    [string]$Style = 'aerial',
    [switch]$Check,
    [string]$Godot = 'D:/workspace/self/_surface-tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe',
    [string]$World = '',
    [string]$Assets = '',
    [string]$HeightBatch = ''
)
$ErrorActionPreference = 'Stop'
$shared = Join-Path (Split-Path $PSScriptRoot -Parent) 'magna-urbis-surface-world-2026-10-23'
if (!$World) { $World = Join-Path $PSScriptRoot 'web/out/surface/ground-cover-quality/retained-pages/packet.surfacebin' }
if (!$Assets) { $Assets = Join-Path $shared 'web/out/surface-assets/resolved.json' }
if (!$HeightBatch) { $HeightBatch = Join-Path $shared 'viewer-local/native-height/target/release/magna-surface-height-batch.exe' }
$project = Join-Path $PSScriptRoot 'viewer-local'
$catalogue = Join-Path $PSScriptRoot 'surface/presentation/palettes.json'
function Require-File([string]$Path) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -eq 0) { throw "Fichier local absent ou vide : $Path. Aucun téléchargement automatique." }
    return (Resolve-Path -LiteralPath $Path).Path
}
if ([double]::IsNaN($Width) -or [double]::IsInfinity($Width) -or $Width -le 0) { throw 'Width doit être une largeur finie positive, en mètres.' }
$parts = $Focus.Split(',')
if ($parts.Count -ne 2) { throw 'Focus attendu : X,Z, par exemple 20000,20000 (décimales avec point).' }
$coordinates = foreach ($part in $parts) {
    $value = 0.0
    if (![double]::TryParse($part, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or [double]::IsNaN($value) -or [double]::IsInfinity($value)) { throw 'Focus doit contenir deux nombres finis.' }
    $value.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
}
$Godot = Require-File $Godot; $World = Require-File $World; $Assets = Require-File $Assets; $HeightBatch = Require-File $HeightBatch
$null = Require-File $catalogue
$null = Require-File (Join-Path $project 'project.godot')
$null = Require-File (Join-Path $project 'diagnostics/surface_soil_preview.gd')
$null = Require-File (Join-Path $project 'addons/terrain_3d/terrain.gdextension')
$null = Require-File (Join-Path $project 'addons/terrain_3d/bin/libterrain.windows.debug.x86_64.dll')
$styles = Get-Content -LiteralPath $catalogue -Raw -Encoding UTF8 | ConvertFrom-Json
$validStyles = @('aerial') + @($styles.terrainStyles.PSObject.Properties.Name) + @($styles.palettes.PSObject.Properties.Name)
if ($Style -notin $validStyles) { throw "Style inconnu '$Style'. Valeurs : $($validStyles -join ', ')" }
$manifest = Get-Content -LiteralPath $Assets -Raw -Encoding UTF8 | ConvertFrom-Json
if (!$manifest.materials -or $manifest.materials.Count -eq 0) { throw 'Le manifeste PBR ne contient aucun matériau.' }
$mapCount = 0
foreach ($material in $manifest.materials) {
    foreach ($map in $material.maps.PSObject.Properties) {
        $path = $map.Value.path
        if (!$path) { throw "Chemin PBR absent : $($material.id)/$($map.Name)" }
        if (![IO.Path]::IsPathRooted($path)) { $path = Join-Path (Split-Path $Assets -Parent) $path }
        $null = Require-File $path; $mapCount++
    }
}
if ($mapCount -eq 0) { throw 'Le manifeste PBR ne contient aucune carte locale.' }
$mode = if ($Style -eq 'aerial') { 'aerial' } else { 'cartographic' }
$launch = @('--audio-driver','Dummy','--path',$project,'--script','res://diagnostics/surface_soil_preview.gd','--',
    '--world',$World,'--assets',$Assets,'--height-batch',$HeightBatch,'--style-catalogue',$catalogue,
    '--native-log-mode','threaded','--presentation',$mode,'--water-mode','source-map','--water-vector-tint','uniform',
    '--water-symbol-width-px','1.25','--top','--width',$Width.ToString('R',[Globalization.CultureInfo]::InvariantCulture),
    '--x',$coordinates[0],'--z',$coordinates[1],'--resolution','1600x1000')
if ($Style -ne 'aerial') { $launch += @('--style',$Style) }
Write-Host "Test sols R4 expérimental — largeur $Width m ; centre $Focus ; style $Style"
Write-Host "F1 : détail R4/ancien uniforme ; F2 : couvert bas ; F3 : moyenne physique."
Write-Host 'Molette : zoom ; glisser gauche : déplacer ; 1–7 : échelles ; Échap : quitter.'
Write-Host 'Un seul site retenu, sans génération fraîche ni sols fins observés. Arbres, objets et ombres masqués.'
Write-Host "Entrées locales validées : paquet, moteur, Terrain3D, height-batch, catalogue, $mapCount cartes PBR."
Write-Host 'Aucun manifeste arbre/végétation ajouté. Démo V15 et données source inchangées.'
if ($Check) { Write-Host 'Check terminé : aucun moteur ni GPU lancé.'; return }
& $Godot @launch
if ($LASTEXITCODE -ne 0) { throw "Godot a quitté avec le code $LASTEXITCODE." }
