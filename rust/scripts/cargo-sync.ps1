# Shared, serialized cargo for every session/agent on this machine.
#   pwsh -NoProfile -File rust/scripts/cargo-sync.ps1 build -p magna-urbis-local
#   pwsh -NoProfile -File rust/scripts/cargo-sync.ps1 test -p magna-urbis-core --lib urban::
# - one machine-wide lock: concurrent callers queue instead of thrashing the CPU / target dir;
# - always the shared target dir rust/target (any private CARGO_TARGET_DIR is dropped);
# - pinned to cores 3-23 (affinity 0xFFFFF8, inherited by cargo/rustc/test binaries), 21 jobs;
# - prints the wait and build wall-clock time.
$ErrorActionPreference = 'Stop'
$rust = Split-Path -Parent $PSScriptRoot
$cargoArgs = $args

Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
Remove-Item Env:CARGO_BUILD_TARGET_DIR -ErrorAction SilentlyContinue
$env:CARGO_BUILD_JOBS = '21'
[System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity = [IntPtr]0xFFFFF8

$mutex = [System.Threading.Mutex]::new($false, 'Global\magna-urbis-cargo')
$lockInfo = Join-Path $rust 'target\cargo-sync.owner'
$waitStart = Get-Date
$owned = $false
try {
    try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) {
        $holder = if (Test-Path $lockInfo) { Get-Content $lockInfo -Raw } else { '?' }
        Write-Host "[cargo-sync] waiting for another build: $holder"
        try { $owned = $mutex.WaitOne() } catch [System.Threading.AbandonedMutexException] { $owned = $true }
    }
    $waited = ((Get-Date) - $waitStart).TotalSeconds
    New-Item -ItemType Directory -Force (Split-Path $lockInfo) | Out-Null
    "pid $PID since $(Get-Date -Format HH:mm:ss): cargo $($cargoArgs -join ' ')" | Set-Content $lockInfo
    $start = Get-Date
    Push-Location $rust
    try { & cargo @cargoArgs; $code = $LASTEXITCODE } finally { Pop-Location }
    $secs = ((Get-Date) - $start).TotalSeconds
    Write-Host ("[cargo-sync] cargo {0} -> exit {1} in {2:N1}s (waited {3:N1}s)" -f ($cargoArgs -join ' '), $code, $secs, $waited)
    exit $code
} finally {
    if ($owned) { Remove-Item $lockInfo -ErrorAction SilentlyContinue; $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
