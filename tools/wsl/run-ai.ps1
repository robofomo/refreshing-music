param(
  [ValidateSet("beats", "whisperx", "stems", "preprocess-ai")]
  [string]$Task = "preprocess-ai",
  [string]$CondaEnv = "refresh-ai",
  [string]$VenvPath = "/home/seva/envs/refresh-ai",
  [switch]$SkipConda,
  [switch]$SkipVenv,
  [string[]]$TaskArgs = @(),
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoWin = Resolve-Path (Join-Path $scriptDir "..\..")
$repoWinForWsl = ([string]$repoWin) -replace "\\", "/"
$repoWsl = (wsl wslpath -a -- "$repoWinForWsl").Trim()

if (-not $repoWsl) {
  throw "Failed to resolve WSL path for repo: $repoWin"
}

$skipCondaVal = if ($SkipConda) { "1" } else { "0" }
$skipVenvVal = if ($SkipVenv) { "1" } else { "0" }
$allTaskArgs = @($TaskArgs) + @($RemainingArgs)

if ($Task -eq "whisperx") {
  $preflight = @(
    "--cd", $repoWsl,
    "env",
    "CONDA_ENV_NAME=$CondaEnv",
    "SKIP_CONDA=$skipCondaVal",
    "VENV_PATH=$VenvPath",
    "SKIP_VENV=$skipVenvVal",
    "bash", "-lc",
    @'
set -e
if [[ "$SKIP_VENV" != "1" && -f "$VENV_PATH/bin/activate" ]]; then
  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"
fi
if command -v conda >/dev/null 2>&1 && [[ "$SKIP_CONDA" != "1" ]]; then
  eval "$(conda shell.bash hook)"
  conda activate "$CONDA_ENV_NAME"
fi
python - <<'PY'
import importlib.util
import sys
if importlib.util.find_spec("whisperx") is None:
    sys.stderr.write("WhisperX is not installed in the active WSL Python environment.\n")
    sys.stderr.write("Expected env from README/tools/wsl/run-ai.ps1 was not ready.\n")
    raise SystemExit(2)
print("whisperx-ready")
PY
'@
  )
  & wsl @preflight
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$cmd = @(
  "--cd", $repoWsl,
  "env",
  "CONDA_ENV_NAME=$CondaEnv",
  "SKIP_CONDA=$skipCondaVal",
  "VENV_PATH=$VenvPath",
  "SKIP_VENV=$skipVenvVal",
  "bash", "tools/wsl/run-ai.sh", $Task
) + $allTaskArgs

Write-Host ("[run-ai.ps1] wsl " + (($cmd | ForEach-Object {
  if ($_ -match "\s") { '"' + $_ + '"' } else { $_ }
}) -join " "))

& wsl @cmd
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
