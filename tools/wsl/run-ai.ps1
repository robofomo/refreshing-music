param(
  [ValidateSet("beats", "whisperx", "stems", "preprocess-ai")]
  [string]$Task = "preprocess-ai",
  [string]$CondaEnv = "refresh-ai",
  [string]$VenvPath = "/home/seva/envs/refresh-ai",
  [switch]$SkipConda,
  [switch]$SkipVenv,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TaskArgs
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

$cmd = @(
  "--cd", $repoWsl,
  "env",
  "CONDA_ENV_NAME=$CondaEnv",
  "SKIP_CONDA=$skipCondaVal",
  "VENV_PATH=$VenvPath",
  "SKIP_VENV=$skipVenvVal",
  "bash", "tools/wsl/run-ai.sh", $Task
) + $TaskArgs

& wsl @cmd
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
