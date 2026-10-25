[CmdletBinding()]
param(
    [string]$Scene = '',
    [double]$Width = 40000,
    [string]$Focus = '20000,20000',
    [string]$Resolution = '1280x800',
    [string]$Capture = '',
    [int]$Frames = 0,
    [switch]$Check,
    [string]$Tile = 'mountains--temperate',
    [ValidateSet('Dessus','3D')][string]$Mode = 'Dessus',
    [string]$Catalog = '',
    [string]$Godot = 'D:/workspace/self/_surface-tools/godot-4.7.2/Godot_v4.7.2-stable_win64_console.exe'
)
$ErrorActionPreference = 'Stop'
function Require-File([string]$Path, [switch]$AllowEmpty) {
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Fichier local absent : $Path. Aucun téléchargement automatique." }
    if (!$AllowEmpty -and (Get-Item -LiteralPath $Path).Length -eq 0) { throw "Fichier vide : $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}
if (!$Scene) {
    $Godot = Require-File $Godot
    $project = Join-Path $PSScriptRoot 'godot-render'
    if (!$Catalog) { $Catalog = Join-Path $project 'tiles/catalog.json' }
    $Catalog = Require-File $Catalog
    $data = Get-Content -LiteralPath $Catalog -Raw -Encoding UTF8 | ConvertFrom-Json
    $groundCompilerHash = (Get-FileHash -LiteralPath (Join-Path $project 'tools/surface_context.py') -Algorithm SHA256).Hash.ToLowerInvariant()
    $surfaceCompilerHash = (Get-FileHash -LiteralPath (Join-Path $project 'tools/ground_surface.py') -Algorithm SHA256).Hash.ToLowerInvariant()
    $waterCompilerHash = (Get-FileHash -LiteralPath (Join-Path $project 'tools/prepare_surface_water.py') -Algorithm SHA256).Hash.ToLowerInvariant()
    $placementCompilerHash = (Get-FileHash -LiteralPath (Join-Path $project 'tools/forest_placement.py') -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($wave in @('ripples.png','capillary.png','water.json')) { $null = Require-File (Join-Path $project "materials/water/$wave") }
    $textureCatalogue = Require-File (Join-Path $project 'ground_texture_catalogue.json')
    $textureCatalogueHash = (Get-FileHash -LiteralPath $textureCatalogue -Algorithm SHA256).Hash.ToLowerInvariant()
    $textureLibraryPath = Require-File (Join-Path $project 'materials/prepared/library.json')
    $textureLibrary = Get-Content -LiteralPath $textureLibraryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($textureLibrary.assets.Count -ne 142 -or $textureLibrary.errors.PSObject.Properties.Count -gt 0 -or $textureLibrary.catalogueSha256 -ne $textureCatalogueHash) {
        throw 'Bibliothèque PBR incomplète ou périmée. Lancer python godot-render/tools/prepare_ground_textures.py.'
    }
    foreach ($asset in $textureLibrary.assets) {
        foreach ($channel in @($asset.color, $asset.normalRoughness, $asset.height)) {
            $null = Require-File (Join-Path (Split-Path $textureLibraryPath -Parent) $channel)
        }
    }
    if ($data.format -ne 'magna-tile40-catalog' -or $data.tiles.Count -ne 42) { throw 'Catalogue incomplet : 42 tuiles requises.' }
    if ($Tile -notin $data.tiles.id) { throw "Tuile inconnue : $Tile" }
    foreach ($entry in $data.tiles) {
        $metaPath = Join-Path (Split-Path $Catalog -Parent) $entry.file
        $null = Require-File $metaPath
        $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $heightPath = Require-File (Join-Path (Split-Path $metaPath -Parent) $meta.height)
        $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $meta.map)
        if ((Get-Item -LiteralPath $heightPath).Length -ne $meta.n * $meta.n * 4) { throw "Heightfield incomplet : $heightPath" }
        if ($meta.n -ne 1334 -or !$meta.neural.nativeDefinitionRetained -or $meta.neural.decoderNativeCell -ne 30) { throw "Définition native du décodeur manquante : $metaPath" }
        if ($meta.hydrology.engine -ne 'vector' -or !$meta.hydrology.balance) { throw "Hydrologie vectorielle absente : $metaPath" }
        foreach ($asset in @($meta.hydrology.surface, $meta.hydrology.svg, $meta.hydrology.network)) {
            $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $asset)
        }
        $surfacePath = Join-Path (Split-Path $metaPath -Parent) $meta.hydrology.surface
        if ((Get-Item -LiteralPath $surfacePath).Length -ne $meta.n * $meta.n * 4) { throw "Surface hydraulique incomplète : $surfacePath" }
        if ($meta.hydrology.layers.Count -ne 5) { throw "Calques informatifs incomplets : $metaPath" }
        $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $meta.hydrology.grids.file)
        foreach ($layer in $meta.hydrology.layers) { $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $layer.file) }
        if ($meta.ground.version -ne 2 -or $meta.ground.layers.Count -ne 29 -or $meta.ground.sources.height -ne $meta.heightSha256 -or $meta.ground.sources.compiler -ne $groundCompilerHash) {
            throw "Couches du sol absentes ou périmées : $metaPath. Lancer python godot-render/tools/surface_context.py."
        }
        $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $meta.ground.grids.file)
        foreach ($layer in $meta.ground.layers) { $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $layer.file) }
        if ($meta.groundSurface.version -ne 2 -or $meta.groundSurface.materialSlots -ne 6 -or $meta.groundSurface.coverSlots -ne 3 -or $meta.groundSurface.layers.Count -ne 13 -or $meta.groundSurface.typeIds.Count -ne 90 -or $meta.groundSurface.sources.compiler -ne $surfaceCompilerHash -or $meta.groundSurface.sources.catalogue -ne $textureCatalogueHash -or $meta.groundSurface.sources.height -ne $meta.heightSha256) {
            throw "N1-N4 absents ou périmés : $metaPath. Lancer node godot-render/tools/ground_render_snow.mjs puis python godot-render/tools/ground_surface.py."
        }
        foreach ($file in $meta.groundSurface.files) { $null = Require-File (Join-Path (Split-Path $metaPath -Parent) $file) }
        $tileDirectory = Split-Path $metaPath -Parent
        foreach ($role in @('cover','forest')) {
            $coverPath = Require-File (Join-Path $tileDirectory "original-$role.json")
            $coverMeta = Get-Content -LiteralPath $coverPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($coverMeta.profile -ne 'original-render3d' -or $coverMeta.sourceHead -ne 'dff14f387a6d1edc89d93737f861ee91e022a5aa' -or $coverMeta.heightSha256 -ne $meta.heightSha256) { throw "Couvert Render3D original absent ou périmé : $metaPath" }
            if ($role -eq 'cover' -and $coverMeta.version -ne 2) { throw "Réexporter les masques opaques avec export_original_cover.mjs : $metaPath" }
            foreach ($file in $coverMeta.files) { $null = Require-File (Join-Path $tileDirectory $file.file) }
        }
        $placementPath = Require-File (Join-Path $tileDirectory 'forest-placement.json')
        $placement = Get-Content -LiteralPath $placementPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($placement.generatorSha256 -ne $placementCompilerHash -or $placement.heightSha256 -ne $meta.heightSha256 -or $placement.groundSurfaceSha256 -ne $meta.groundSurface.grids.sha256) { throw "Placement forestier périmé : $metaPath. Lancer python godot-render/tools/forest_placement.py." }
        foreach ($file in $placement.files) { $null = Require-File (Join-Path $tileDirectory $file.file) }
        $waterDetailPath = Require-File (Join-Path $tileDirectory 'surface-water-detail.json')
        $waterDetail = Get-Content -LiteralPath $waterDetailPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($waterDetail.heightSha256 -ne $meta.heightSha256 -or $waterDetail.generatorSha256 -ne $waterCompilerHash) { throw "Textures eau périmées : $metaPath. Lancer python godot-render/tools/prepare_surface_water.py." }
        $null = Require-File (Join-Path $tileDirectory $waterDetail.file)
    }
    Write-Host '42 tuiles de 40 x 40 km. Tab = Dessus / 3D ; droit = orbite ; gauche/milieu = strafe ; molette = zoom.'
    if ($Check) { Write-Host '42 tuiles, hydrologie, 29 calques du sol + 13 N1-N4/surface, couvert Render3D original, eau texturée, neige Render, 90 types et 142 sources PBR vérifiés.'; return }
    $launch = @('--audio-driver','Dummy','--path',$project,'--','--catalog',$Catalog,'--tile',$Tile)
    if ($Mode -eq '3D') { $launch += '--oblique' }
    if ($Capture) { $launch += @('--capture',[IO.Path]::GetFullPath($Capture)) }
    & $Godot @launch
    if ($LASTEXITCODE -ne 0) { throw "Godot a quitté avec le code $LASTEXITCODE." }
    return
}
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
