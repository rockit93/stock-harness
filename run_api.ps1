$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Virtual environment not found. Running install.ps1 first..."
    powershell -ExecutionPolicy Bypass -File .\install.ps1
}

.\.venv\Scripts\python.exe -m uvicorn src.quant_lab.api:app --host 127.0.0.1 --port 8765 --reload
