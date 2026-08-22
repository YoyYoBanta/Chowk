$ErrorActionPreference = "Stop"
$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
$env:Path = "$infraDir\node-v26.7.0-win-x64;" + $env:Path

Write-Host "Activating channel..."
npm run activate-channel -- cmt42u419000aaouh6gf9rl1n

Write-Host "Starting worker..."
npm run worker
