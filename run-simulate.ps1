$ErrorActionPreference = "Stop"
$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
$env:Path = "$infraDir\node-v26.7.0-win-x64;" + $env:Path

Write-Host "Simulating message..."
npx tsx --env-file=.env scripts/simulate-message.ts
