#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TASK="${1:-preprocess-ai}"
shift || true

CONDA_ENV_NAME="${CONDA_ENV_NAME:-refresh-ai}"
SKIP_CONDA="${SKIP_CONDA:-0}"
VENV_PATH="${VENV_PATH:-}"
SKIP_VENV="${SKIP_VENV:-0}"

if [[ -f "$HOME/.bashrc" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.bashrc"
fi
if [[ -f "$HOME/.profile" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.profile"
fi

# Common nvm install path fallback for non-interactive shells.
if [[ -z "${NVM_DIR:-}" ]]; then
  export NVM_DIR="$HOME/.nvm"
fi
if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$NVM_DIR/nvm.sh"
fi

activate_conda_if_available() {
  if [[ "${_PY_ENV_ACTIVATED:-0}" == "1" ]]; then
    return 0
  fi
  if [[ "$SKIP_CONDA" == "1" ]]; then
    return 0
  fi

  if ! command -v conda >/dev/null 2>&1; then
    return 0
  fi

  eval "$(conda shell.bash hook)"
  conda activate "$CONDA_ENV_NAME"
}

activate_venv_if_available() {
  if [[ "$SKIP_VENV" == "1" ]]; then
    return 0
  fi

  local candidate="$VENV_PATH"
  if [[ -z "$candidate" ]]; then
    candidate="$HOME/envs/refresh-ai"
  fi

  if [[ -f "$candidate/bin/activate" ]]; then
    # shellcheck disable=SC1090
    source "$candidate/bin/activate"
    export _PY_ENV_ACTIVATED=1
  fi
}

activate_venv_if_available
activate_conda_if_available

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found in WSL PATH." >&2
  exit 1
fi

if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  echo "Python not found in WSL PATH." >&2
  exit 1
fi

# Prefer GPU + larger ASR model in WSL unless caller overrides.
if [[ -z "${WHISPERX_DEVICE:-}" ]]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    export WHISPERX_DEVICE="cuda"
  else
    export WHISPERX_DEVICE="cpu"
  fi
fi
if [[ -z "${WHISPERX_MODEL:-}" ]]; then
  if [[ "$WHISPERX_DEVICE" == "cuda" ]]; then
    export WHISPERX_MODEL="large-v3"
  else
    export WHISPERX_MODEL="small"
  fi
fi

echo "[run-ai] node=$(command -v node)"
if command -v python >/dev/null 2>&1; then
  echo "[run-ai] python=$(command -v python)"
elif command -v python3 >/dev/null 2>&1; then
  echo "[run-ai] python3=$(command -v python3)"
fi
echo "[run-ai] whisperx_device=$WHISPERX_DEVICE whisperx_model=$WHISPERX_MODEL"

case "$TASK" in
  beats)
    npm run beats -- "$@"
    ;;
  whisperx)
    npm run whisperx -- "$@"
    ;;
  stems)
    npm run stems -- "$@"
    ;;
  preprocess-ai|preprocess:ai)
    npm run preprocess:ai -- "$@"
    ;;
  *)
    echo "Unknown task: $TASK" >&2
    echo "Use one of: beats | whisperx | stems | preprocess-ai" >&2
    exit 1
    ;;
esac
