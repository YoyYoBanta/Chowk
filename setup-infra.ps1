$ErrorActionPreference = "Stop"

$redisUrl = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
$minioUrl = "https://dl.min.io/server/minio/release/windows-amd64/minio.exe"
$pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip"

$infraDir = "c:\Users\Msi\.gemini\antigravity-ide\scratch\Chowk\.infra"
New-Item -ItemType Directory -Force -Path $infraDir | Out-Null

Write-Host "Downloading Redis..."
Invoke-WebRequest -Uri $redisUrl -OutFile "$infraDir\redis.zip"
Write-Host "Extracting Redis..."
Expand-Archive -Path "$infraDir\redis.zip" -DestinationPath "$infraDir\redis" -Force

Write-Host "Downloading MinIO..."
Invoke-WebRequest -Uri $minioUrl -OutFile "$infraDir\minio.exe"

Write-Host "Downloading PostgreSQL..."
Invoke-WebRequest -Uri $pgUrl -OutFile "$infraDir\postgres.zip"
Write-Host "Extracting PostgreSQL..."
Expand-Archive -Path "$infraDir\postgres.zip" -DestinationPath "$infraDir" -Force

Write-Host "PostgreSQL initdb..."
& "$infraDir\pgsql\bin\initdb.exe" -D "$infraDir\pgdata" -U postgres -A trust

Write-Host "Infrastructure setup complete."
