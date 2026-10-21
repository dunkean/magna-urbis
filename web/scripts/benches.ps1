param(
  [ValidateSet('start', 'stop')][string]$Action = 'start',
  [ValidateRange(10, 1800)][int]$TimeoutSeconds = 300,
  [switch]$Warmup,
  [ValidateSet('python', 'native', 'none')][string]$NeuralBackend = 'python',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$NeuralArguments = @()
)

$ErrorActionPreference = 'Stop'
$WebDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RepoDir = [IO.Path]::GetFullPath((Join-Path $WebDir '..'))
$RuntimeDir = Join-Path $WebDir 'out\benches-runtime'
$LocalUrl = 'http://127.0.0.1:8791'
$InitialSource = if ($NeuralBackend -eq 'native') { 'neural' } elseif ($NeuralBackend -eq 'none') { 'procedural' } else { 'neural-python' }
$SiteUrl = "http://127.0.0.1:5173/rustbench.html?profile=local#terrain?v=4&source=$InitialSource&width=2400"
$NeuralUrl = if ($NeuralBackend -eq 'python') { 'http://127.0.0.1:8793' } else { 'http://127.0.0.1:8792' }
if ($NeuralBackend -eq 'native') { $SiteUrl += '&neural=http%3A%2F%2F127.0.0.1%3A8792' }
$RustDir = Join-Path $RepoDir 'rust'
$targetDir = $env:CARGO_TARGET_DIR
if (-not $targetDir) {
  $config = Join-Path $RustDir '.cargo\config.toml'
  if (Test-Path -LiteralPath $config) {
    $text = Get-Content -LiteralPath $config -Raw
    if ($text -match '(?m)^\s*target-dir\s*=\s*"([^"]+)"') { $targetDir = $Matches[1] }
  }
}
if (-not $targetDir) { $targetDir = Join-Path $RustDir 'target' }
if (-not [IO.Path]::IsPathRooted($targetDir)) { $targetDir = Join-Path $RustDir $targetDir }
$LocalExe = $env:MAGNA_LOCAL_BIN
if (-not $LocalExe) { $LocalExe = Join-Path $targetDir 'release\magna-urbis-local.exe' }
$LocalExe = [IO.Path]::GetFullPath($LocalExe)

function Get-ServiceProcesses {
  $neuralOwners = @(Get-NetTCPConnection -State Listen -LocalPort 8792,8793 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($item in Get-CimInstance Win32_Process) {
    if ($item.ProcessId -eq $PID) { continue }
    $command = ([string]$item.CommandLine).Replace('/', '\')
    $inRepo = $command.IndexOf($RepoDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
    $vite = $item.Name -eq 'node.exe' -and $inRepo -and $command -match 'vite\\bin\\vite\.js'
    $neuralLauncher = $item.Name -eq 'node.exe' -and $inRepo -and $command -match 'rust\\scripts\\terrain\.mjs"?\s+"?neural\b'
    $neural = $item.Name -eq 'neural.exe' -and ($inRepo -or $item.ProcessId -in $neuralOwners)
    $python = $inRepo -and $item.Name -in @('python.exe','node.exe') -and $command -match 'web\\scripts\\neural_python\.(py|mjs)'
    $local = $item.Name -eq [IO.Path]::GetFileName($LocalExe) -and ($inRepo -or $command.IndexOf($LocalExe, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    if ($vite -or $neuralLauncher -or $neural -or $python -or $local) { $item }
  }
}

function Stop-Services {
  $running = @(Get-ServiceProcesses)
  foreach ($item in $running) {
    if (Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue) {
      Write-Host "Arret $($item.Name) (PID $($item.ProcessId))..."
      # The process tree includes Vite's helpers, Cargo and the native GPU worker.
      # A child in this snapshot can exit while its parent tree is being killed.
      $previousPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $null = & taskkill.exe /PID $item.ProcessId /T /F 2>&1
      } finally { $ErrorActionPreference = $previousPreference }
    }
  }
  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remaining = @(Get-ServiceProcesses)
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if ($remaining.Count) { throw 'Des processus du site ou du service neural ne se sont pas arretes.' }
}

function Start-HiddenProcess([string]$Executable, [string[]]$CommandArguments, [string]$Name) {
  $quoted = @($CommandArguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
  Start-Process -FilePath $Executable -ArgumentList $quoted -WorkingDirectory $WebDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $RuntimeDir "$Name.stdout.log") `
    -RedirectStandardError (Join-Path $RuntimeDir "$Name.stderr.log")
}

try {
  if ($Action -eq 'stop') {
    Stop-Services
    Write-Host 'Site et service neural arretes.'
    exit 0
  }

  $NodeExe = (Get-Command node -ErrorAction Stop).Source
  foreach ($file in @('node_modules\vite\bin\vite.js', '..\rust\pkg\wasm\magna_urbis_wasm.js', '..\rust\pkg\houses\magna_urbis_houses_wasm.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $WebDir $file))) {
      throw "Fichier requis absent : $file. Depuis web/, lancer npm install, npm run wasm:terrain et npm run wasm:houses selon le paquet manquant."
    }
  }
  if ($NeuralArguments -match '^--address(?:=|$)') { throw 'Le port du service est fixe par le lanceur ; ne pas imposer --address.' }
  if (-not (Test-Path -LiteralPath $LocalExe -PathType Leaf)) {
    throw "Moteur Rust absent : $LocalExe. Depuis web/, lancer npm run build:local une fois."
  }
  $NeuralExe = $env:MAGNA_NEURAL_BIN
  if (-not $NeuralExe) { $NeuralExe = Join-Path $targetDir 'release\neural.exe' }
  if ($NeuralBackend -eq 'native' -and -not (Test-Path -LiteralPath $NeuralExe -PathType Leaf)) {
    throw "Binaire neural absent : $NeuralExe. Depuis web/, lancer npm run build:neural une fois."
  }
  $weights = $env:MAGNA_NEURAL_WEIGHTS
  if (-not $weights) { $weights = Join-Path $RustDir 'pkg\neural-weights' }
  if (-not [IO.Path]::IsPathRooted($weights)) { $weights = Join-Path $RustDir $weights }
  foreach ($name in $(if ($NeuralBackend -eq 'native') { @('coarse', 'base', 'decoder') } else { @() })) {
    if (-not (Test-Path -LiteralPath (Join-Path $weights "$name.safetensors") -PathType Leaf)) {
      throw "Poids $name absents dans $weights. Lancer npm run neural:serve une fois pour les preparer."
    }
  }
  $PythonExe = $env:MAGNA_NEURAL_PYTHON
  if (-not $PythonExe) { $PythonExe = Join-Path (Split-Path $RepoDir -Parent) 'infinite_map\.venv\Scripts\python.exe' }
  if ($NeuralBackend -eq 'python' -and -not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    throw "Python absent : $PythonExe. Definir MAGNA_NEURAL_PYTHON vers le Python CUDA de Neural Earth."
  }
  Stop-Services
  $ports = if ($NeuralBackend -eq 'none') { @(5173,8791) } elseif ($NeuralBackend -eq 'python') { @(5173,8791,8793) } else { @(5173,8791,8792) }
  foreach ($port in $ports) {
    $owners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($owners.Count) { throw "Le port $port est utilise par un autre programme (PID $($owners[0].OwningProcess)). Aucun processus etranger n'a ete arrete." }
  }

  $null = New-Item -ItemType Directory -Path $RuntimeDir -Force
  $SiteProcess = Start-HiddenProcess $NodeExe @((Join-Path $WebDir 'node_modules\vite\bin\vite.js'), '--mode', 'rustbench', '--host', '127.0.0.1', '--port', '5173', '--strictPort') 'site'
  $LocalProcess = Start-HiddenProcess $LocalExe @('--port', '8791') 'local'
  $NeuralProcess = $null
  if ($NeuralBackend -eq 'python') {
    $NeuralProcess = Start-HiddenProcess $PythonExe @('-u', (Join-Path $WebDir 'scripts\neural_python.py'), '--port', '8793') 'neural'
  } elseif ($NeuralBackend -eq 'native') {
    $neuralArgs = @('serve', '--weights', $weights, '--address', '127.0.0.1:8792') + $NeuralArguments
    if (-not $Warmup -and '--no-warmup' -notin $neuralArgs) { $neuralArgs += '--no-warmup' }
    $NeuralProcess = Start-HiddenProcess $NeuralExe $neuralArgs 'neural'
  }
  Write-Host "Site : $SiteUrl"
  Write-Host "Moteur Rust : $LocalUrl"
  Write-Host "Neural : $NeuralBackend (sans Docker ni compilation)"
  if ($NeuralBackend -ne 'none') { Write-Host "Service : $NeuralUrl ; poids charges au premier calcul en mode Python" }
  Write-Host "Journaux : $RuntimeDir"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastMessage = ''
  do {
    $SiteProcess.Refresh()
    $LocalProcess.Refresh()
    if ($NeuralProcess) { $NeuralProcess.Refresh() }
    if ($SiteProcess.HasExited -or $LocalProcess.HasExited -or ($NeuralProcess -and $NeuralProcess.HasExited)) { throw 'Un service a quitte pendant le demarrage.' }
    $siteReady = $false
    $localReady = $false
    $neuralReady = $NeuralBackend -eq 'none'
    try { $siteReady = (Invoke-WebRequest -UseBasicParsing -Uri $SiteUrl -TimeoutSec 2).StatusCode -eq 200 } catch { }
    $localStatus = $null
    try { $localStatus = Invoke-RestMethod -Uri "$LocalUrl/status" -TimeoutSec 2 } catch { }
    if ($localStatus.service -eq 'magna-urbis-local') {
      if ($localStatus.capabilities -notcontains 'houses.placement' -or $localStatus.capabilities -notcontains 'urban.programme') {
        throw 'Moteur Rust ancien : reconstruire avec npm run build:local, puis relancer les bancs.'
      }
      $localReady = $true
    }
    $serviceState = $null
    if ($NeuralProcess) { try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$NeuralUrl/status" -TimeoutSec 2
      $serviceState = [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray()) | ConvertFrom-Json
    } catch { } }
    if ($serviceState) {
      if ($serviceState.state -eq 'error') { throw "Service neural : $($serviceState.message)" }
      $neuralReady = $serviceState.state -eq 'ready'
      if ($serviceState.message -ne $lastMessage) {
        $lastMessage = $serviceState.message
        Write-Host "Neural : $lastMessage"
      }
    }
    if ($siteReady -and $localReady -and $neuralReady) {
      Write-Host "Pret : $SiteUrl (site PID $($SiteProcess.Id), Rust PID $($LocalProcess.Id), neural PID $($NeuralProcess.Id))"
      exit 0
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "Demarrage incomplet apres $TimeoutSeconds secondes. Consulter les journaux ou augmenter -TimeoutSeconds."
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  # A failed launch must not leave half of the requested services running.
  if ($SiteProcess -or $LocalProcess -or $NeuralProcess) {
    try { Stop-Services } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    foreach ($name in @('site', 'local', 'neural')) {
      $log = Join-Path $RuntimeDir "$name.stderr.log"
      if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 15 }
    }
  }
  exit 1
}
