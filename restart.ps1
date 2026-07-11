param(
    [ValidateSet("all", "python-core", "node-api", "web")]
    [string]$Service = "all"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $root "stop.ps1") $Service
Start-Sleep -Seconds 1
& (Join-Path $root "bootstrap.ps1") $Service
