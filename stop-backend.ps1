$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $PSScriptRoot ".runtime"
$stateFile = Join-Path $runtimeDir "backend-supervisors.json"
$bootstrapScript = Join-Path $PSScriptRoot "bootstrap.ps1"

if (Test-Path $stateFile) {
    $entries = Get-Content $stateFile -Raw | ConvertFrom-Json
    $allProcesses = @(Get-CimInstance Win32_Process)

    foreach ($entry in $entries) {
        $pidValue = [int]$entry.Pid
        $process = $allProcesses | Where-Object { $_.ProcessId -eq $pidValue } | Select-Object -First 1
        if (-not $process) {
            continue
        }

        # Avoid terminating an unrelated process if Windows has reused a stale PID.
        if (-not $process.CommandLine -or -not $process.CommandLine.Contains($bootstrapScript)) {
            Write-Warning "Skipping stale PID $pidValue for $($entry.Service)."
            continue
        }

        Write-Host "Stopping $($entry.Service) supervisor tree (PID $pidValue)..."
        & taskkill.exe /PID $pidValue /T /F | Out-Null
    }

    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
}

# Clean up backend listeners even if the state file was lost or a supervisor
# exited unexpectedly. Deliberately do not stop the Vite service on port 5173.
& (Join-Path $PSScriptRoot "stop.ps1") -Service python-core
& (Join-Path $PSScriptRoot "stop.ps1") -Service node-api

Write-Host "Backend services stopped. Vite was left untouched."
