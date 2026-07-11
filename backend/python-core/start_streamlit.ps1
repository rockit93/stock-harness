$ErrorActionPreference = "Stop"

$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
python (Join-Path $serviceDir "start.py") --streamlit
