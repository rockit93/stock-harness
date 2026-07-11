param(
    [switch]$Streamlit
)

$ErrorActionPreference = "Stop"

$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$argsList = @((Join-Path $serviceDir "start.py"))
if ($Streamlit) {
    $argsList += "--streamlit"
}

python @argsList
