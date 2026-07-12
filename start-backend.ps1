param(
    [switch]$WithoutOllama
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $PSScriptRoot ".runtime"
$stateFile = Join-Path $runtimeDir "backend-supervisors.json"
$bootstrapScript = Join-Path $PSScriptRoot "bootstrap.ps1"

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (Test-Path $stateFile) {
    & (Join-Path $PSScriptRoot "stop-backend.ps1")
}

$services = @("python-core", "node-api")
if (-not $WithoutOllama) {
    $ollama = Get-Command "ollama.exe" -ErrorAction SilentlyContinue
    if (-not $ollama) {
        $ollamaPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        if (Test-Path $ollamaPath) {
            $ollama = $ollamaPath
        }
    }
    if ($ollama) {
        $services += "ollama"
    } else {
        Write-Host "Ollama is not installed; skipping it."
    }
}

$started = @()
foreach ($service in $services) {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"{0}"' -f $bootstrapScript),
        "-Service", $service
    )
    $process = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru

    $started += [pscustomobject]@{
        Service = $service
        Pid = $process.Id
        StartedAt = (Get-Date).ToString("o")
    }
    Write-Host "Started $service supervisor (PID $($process.Id))."
}

$started | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
Write-Host "Backend services are running in the background. Vite was not started."
Write-Host "Run .\stop-backend.ps1 to stop them."
