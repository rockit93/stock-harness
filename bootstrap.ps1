param(
    [ValidateSet("all", "python-core", "node-api", "web")]
    [string]$Service = "all"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
    @{ Command = "py"; Args = @("-3.11") },
    @{ Command = "py"; Args = @("-3.12") },
    @{ Command = "python"; Args = @() },
    @{ Command = "python3"; Args = @() }
)

$python = $null
foreach ($candidate in $candidates) {
    try {
        & $candidate.Command @($candidate.Args) -c "import sys; raise SystemExit(sys.version_info < (3, 11))" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $python = $candidate
            break
        }
    } catch {
    }
}

if (-not $python) {
    throw "Python was not found. Install Python 3.11+ first."
}

& $python.Command @($python.Args) (Join-Path $root "bootstrap.py") $Service
