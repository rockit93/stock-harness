#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5-coder:14b}"
SKIP_OLLAMA="${SKIP_OLLAMA:-0}"
SKIP_MODEL_PULL="${SKIP_MODEL_PULL:-0}"

python_cmd=()
python_candidates=(
  "python3.12"
  "python3.11"
  "python3"
  "python"
)

for candidate in "${python_candidates[@]}"; do
  if command -v "${candidate}" >/dev/null 2>&1 && "${candidate}" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' >/dev/null 2>&1; then
    python_cmd=("${candidate}")
    break
  fi
done

if [[ "${#python_cmd[@]}" -eq 0 ]]; then
  echo "Python 3.11+ was not found." >&2
  exit 1
fi

echo "Creating virtual environment..."
"${python_cmd[@]}" -m venv "${ROOT_DIR}/.venv"

echo "Installing Python packages..."
"${ROOT_DIR}/.venv/bin/python" -m pip install --upgrade pip
"${ROOT_DIR}/.venv/bin/python" -m pip install -r "${ROOT_DIR}/backend/python-core/requirements.txt"

echo "Installing Node packages..."
(cd "${ROOT_DIR}/backend/node-api" && npm install)
(cd "${ROOT_DIR}/frontend/web" && npm install)

ensure_ollama() {
  if [[ "${SKIP_OLLAMA}" == "1" ]]; then
    echo "Skipping Ollama setup."
    return
  fi

  if ! command -v ollama >/dev/null 2>&1; then
    echo "Installing Ollama..."
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL https://ollama.com/install.sh | sh
    else
      echo "curl is unavailable. Install Ollama from https://ollama.com/download, then run: ollama pull ${OLLAMA_MODEL}" >&2
      return
    fi
  fi

  if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama service..."
    (ollama serve >/tmp/stock-harness-ollama.log 2>&1 &)
    sleep 5
  fi

  if [[ "${SKIP_MODEL_PULL}" != "1" ]]; then
    echo "Pulling Ollama model: ${OLLAMA_MODEL}"
    ollama pull "${OLLAMA_MODEL}"
  fi
}

ensure_ollama

echo ""
echo "Done. Start the app with:"
echo "  ./bootstrap.sh"
