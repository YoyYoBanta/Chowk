$ErrorActionPreference = "Stop"
$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
$env:Path = "$infraDir\node-v26.7.0-win-x64;" + $env:Path

Write-Host "Running npm install..."
npm install

Write-Host "Running npm run migrate..."
npm run migrate

Write-Host "Running npm run seed..."
npm run seed

Write-Host "Running npm run activate-channel..."
npm run activate-channel

Write-Host "Setup complete. Ready to boot worker."
