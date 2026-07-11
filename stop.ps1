param(
    [ValidateSet("all", "python-core", "node-api", "web")]
    [string]$Service = "all"
)

$ErrorActionPreference = "Stop"

$services = @{
    "python-core" = @{ Name = "Python Core"; Port = 8765; Path = Join-Path $PSScriptRoot "backend\python-core" }
    "node-api" = @{ Name = "Node API"; Port = 8787; Path = Join-Path $PSScriptRoot "backend\node-api" }
    "web" = @{ Name = "Vue Web"; Port = 5173; Path = Join-Path $PSScriptRoot "frontend\web" }
}

function Get-SelectedServices {
    param([string]$Name)

    if ($Name -eq "all") {
        return @("python-core", "node-api", "web")
    }

    return @($Name)
}

function Get-DescendantProcessIds {
    param(
        [int]$ProcessId,
        [object[]]$Processes
    )

    $children = @($Processes | Where-Object { $_.ParentProcessId -eq $ProcessId })
    foreach ($child in $children) {
        Get-DescendantProcessIds -ProcessId ([int]$child.ProcessId) -Processes $Processes
        [int]$child.ProcessId
    }
}

function Stop-ServiceProcesses {
    param(
        [hashtable]$Config,
        [int[]]$ProcessIds
    )

    $allProcesses = @(Get-CimInstance Win32_Process)
    $servicePath = [string]$Config.Path
    $escapedPath = $servicePath.Replace("\", "\\")
    $pathProcessIds = @(
        $allProcesses |
            Where-Object {
                $_.CommandLine -and (
                    $_.CommandLine.Contains($servicePath) -or
                    $_.CommandLine.Contains($escapedPath)
                )
            } |
            Select-Object -ExpandProperty ProcessId
    )
    $expandedProcessIds = @($ProcessIds + $pathProcessIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    foreach ($processId in @($expandedProcessIds)) {
        $expandedProcessIds += @(Get-DescendantProcessIds -ProcessId ([int]$processId) -Processes $allProcesses)
    }

    $expandedProcessIds = @($expandedProcessIds | Where-Object { $_ -gt 0 } | Select-Object -Unique | Sort-Object -Descending)
    if (-not $expandedProcessIds.Count) {
        Write-Host "$($Config.Name) is not running on port $($Config.Port)."
        return
    }

    foreach ($processId in $expandedProcessIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        Write-Host "Stopping $($Config.Name) process PID $processId..."
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

foreach ($key in Get-SelectedServices $Service) {
    $config = $services[$key]
    $port = [int]$config.Port
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    $processIds = @($connections | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -ExpandProperty OwningProcess -Unique)

    Stop-ServiceProcesses -Config $config -ProcessIds $processIds
}
