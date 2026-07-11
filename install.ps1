$ErrorActionPreference = "Stop"

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
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host ""
Write-Host "Done. Start the app with:"
Write-Host ".\run.ps1"
