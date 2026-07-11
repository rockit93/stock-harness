param(
    [ValidateSet("all", "python-core", "node-api", "web")]
    [string]$Service = "all",
    [int]$Tail = 120,
    [switch]$Follow
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root "logs"
$services = if ($Service -eq "all") { @("python-core", "node-api", "web") } else { @($Service) }

foreach ($name in $services) {
    $path = Join-Path $logDir "$name.log"
    if (-not (Test-Path $path)) {
        Write-Host "No log file yet: $path"
        continue
    }

    Write-Host ""
    Write-Host "===== $name ====="
    if ($Follow -and $services.Count -eq 1) {
        Get-Content -Path $path -Tail $Tail -Wait
    } else {
        Get-Content -Path $path -Tail $Tail
    }
}
