$ErrorActionPreference = "Stop"

$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$npm = "npm.cmd"
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $npm = (Get-Command npm.cmd).Source
}

Push-Location $serviceDir
try {
    if (-not (Test-Path ".\node_modules")) {
        & $npm install
    }
    & $npm run dev
} finally {
    Pop-Location
}
