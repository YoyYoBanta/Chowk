$ErrorActionPreference = "Stop"
$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
$nodePath = "$infraDir\node-v26.7.0-win-x64\node.exe"
$npmPath = "$infraDir\node-v26.7.0-win-x64\npm.cmd"

# Start MinIO
Write-Host "Starting MinIO..."
Start-Process -FilePath "$infraDir\minio.exe" -ArgumentList "server $infraDir\minio-data --console-address :9001" -WindowStyle Hidden -PassThru

# Start Redis
Write-Host "Starting Redis..."
Start-Process -FilePath "$infraDir\redis\Redis-x64-5.0.14.1\redis-server.exe" -WindowStyle Hidden -PassThru

# Start Postgres
Write-Host "Starting Postgres..."
Start-Process -FilePath "$infraDir\pgsql\bin\pg_ctl.exe" -ArgumentList "-D $infraDir\pgdata -l $infraDir\pgdata\logfile start" -WindowStyle Hidden -PassThru

Write-Host "Infra started successfully."
