$ErrorActionPreference = "Stop"

$node = "node"
$bundledNode = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$bundledNpm = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\npm.cmd"
if (Test-Path $bundledNode) {
    $node = $bundledNode
}
$npm = "npm"
if (Test-Path $bundledNpm) {
    $npm = $bundledNpm
}

Push-Location .\vue-web
try {
    if (-not (Test-Path ".\node_modules")) {
        & $npm install
    }
    & $npm run dev
} finally {
    Pop-Location
}
