$ErrorActionPreference = "Stop"
$nodeUrl = "https://nodejs.org/dist/v26.7.0/node-v26.7.0-win-x64.zip"
$infraDir = Join-Path $PSScriptRoot ".infra"

Write-Host "Downloading Node.js..."
Invoke-WebRequest -Uri $nodeUrl -OutFile "$infraDir\node.zip"
Write-Host "Extracting Node.js..."
Expand-Archive -Path "$infraDir\node.zip" -DestinationPath "$infraDir" -Force
Write-Host "Node.js setup complete."
