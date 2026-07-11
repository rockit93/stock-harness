param(
    [string]$OllamaModel = "qwen2.5-coder:14b",
    [switch]$SkipOllama,
    [switch]$SkipModelPull
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Ollama {
    if ($SkipOllama) {
        Write-Host "Skipping Ollama setup."
        return
    }

    if (-not (Test-Command "ollama")) {
        if (-not (Test-Command "winget")) {
            Write-Warning "Ollama was not found and winget is unavailable. Install Ollama from https://ollama.com/download/windows, then run: ollama pull $OllamaModel"
            return
        }

        Write-Host "Installing Ollama with winget..."
        winget install --id Ollama.Ollama --source winget --accept-package-agreements --accept-source-agreements
    }

    $ollama = Get-Command "ollama" -ErrorAction SilentlyContinue
    if (-not $ollama) {
        $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        if (Test-Path $candidate) {
            $env:PATH = "$(Split-Path -Parent $candidate);$env:PATH"
        }
    }

    if (-not (Test-Command "ollama")) {
        Write-Warning "Ollama install finished but ollama.exe is not on PATH yet. Open a new terminal or add %LOCALAPPDATA%\Programs\Ollama to PATH."
        return
    }

    Write-Host "Starting Ollama service if needed..."
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 | Out-Null
    } catch {
        Start-Process -FilePath (Get-Command "ollama").Source -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 5
    }

    if (-not $SkipModelPull) {
        Write-Host "Pulling Ollama model: $OllamaModel"
        ollama pull $OllamaModel
    }
}

Write-Host "Creating virtual environment..."

$pythonCommand = $null

$candidates = @(
    @{ Command = "py"; Args = @("-3.11") },
    @{ Command = "py"; Args = @("-3.12") },
    @{ Command = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"; Args = @() },
    @{ Command = "python"; Args = @() }
)

foreach ($candidate in $candidates) {
    $command = $candidate.Command
    $args = $candidate.Args

    try {
        & $command @args --version | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $pythonCommand = $candidate
            break
        }
    } catch {
    }
}

if (-not $pythonCommand) {
    throw "Python was not found. Install Python 3.11 or Miniconda."
}

$selectedCommand = $pythonCommand.Command
$selectedArgs = $pythonCommand.Args
& $selectedCommand @selectedArgs -m venv .venv

Write-Host "Installing packages..."
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\backend\python-core\requirements.txt

Write-Host "Installing Node packages..."
Push-Location .\backend\node-api
try {
    npm.cmd install
} finally {
    Pop-Location
}
Push-Location .\frontend\web
try {
    npm.cmd install
} finally {
    Pop-Location
}

Ensure-Ollama

Write-Host ""
Write-Host "Done. Start the app with:"
Write-Host "bash .\bootstrap.sh"
Write-Host "or:"
Write-Host "powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1"
