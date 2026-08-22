$ErrorActionPreference = "Stop"
$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
$env:Path = "$infraDir\node-v26.7.0-win-x64;" + $env:Path

Write-Host "Generating Prisma client..."
npx prisma generate

Write-Host "Running DB push..."
npx prisma db push --accept-data-loss

Write-Host "Running seed..."
npm run seed

Write-Host "Running activate-channel..."
npm run activate-channel

Write-Host "Setup phase 2 complete!"
