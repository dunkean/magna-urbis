param(
    [Parameter(Mandatory=$true)][ValidateRange(1,6)][int]$Phase,
    [Parameter(Mandatory=$true)][string]$PromptFile
)
$ErrorActionPreference = 'Stop'
$repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$prompt = (Resolve-Path -LiteralPath $PromptFile).Path
$out = Join-Path $repository 'web/out/surface-reviews'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$reportPath = Join-Path $out ('phase{0:D2}.json' -f $Phase)
Push-Location -LiteralPath $repository
try {
    Get-Content -LiteralPath $prompt -Raw | claude -p --model claude-opus-5-5 --effort high --safe-mode --permission-mode dontAsk --tools Read Glob Grep --allowedTools Read Glob Grep --disable-slash-commands --no-session-persistence --output-format json | Set-Content -LiteralPath $reportPath -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "Opus review failed with exit code $LASTEXITCODE; inspect $reportPath" }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    if ($report.is_error -or !$report.result) { throw "Opus did not return a usable review: $reportPath" }
    if (!($report.modelUsage.PSObject.Properties.Name -contains 'claude-opus-5-5')) { throw 'Review model is not the requested Opus 5.5' }
    $markdown = Join-Path $out ('phase{0:D2}.md' -f $Phase)
    @('# Opus 5.5 review', '', 'Model: claude-opus-5-5; requested effort: high; read-only tools.', '', $report.result) | Set-Content -LiteralPath $markdown -Encoding utf8
    Write-Output $markdown
} finally { Pop-Location }
