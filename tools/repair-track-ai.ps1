param(
  [Parameter(Mandatory = $true)]
  [string]$TrackId,
  [switch]$RerunWhisperx,
  [string]$Language = "en",
  [string]$Device = "cpu",
  [string]$Model = "small",
  [switch]$SkipPreprocess,
  [string]$CondaEnv = "refresh-ai",
  [string]$VenvPath = "/home/seva/envs/refresh-ai",
  [switch]$SkipConda,
  [switch]$SkipVenv
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

Push-Location $repoRoot
try {
  if ($RerunWhisperx) {
    & powershell -ExecutionPolicy Bypass -File .\tools\wsl\run-ai.ps1 `
      -Task whisperx `
      -CondaEnv $CondaEnv `
      -VenvPath $VenvPath `
      -SkipConda:$SkipConda `
      -SkipVenv:$SkipVenv `
      -TaskArgs @("--trackId", $TrackId, "--overwrite-ai", "--device", $Device, "--model", $Model, "--language", $Language)
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  if (-not $SkipPreprocess) {
    npm run preprocess -- --trackId $TrackId
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  git status --short -- "tracks/$TrackId.track.json"
} finally {
  Pop-Location
}
