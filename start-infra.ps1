# Starts the portable dev stack from .infra\ - PostgreSQL, Redis, MinIO.
#
# Keep this file pure ASCII. Windows PowerShell 5.1 reads a UTF-8 file that
# has no BOM as Windows-1252, which turns an em-dash into a curly quote - and
# 5.1 treats curly quotes as string delimiters, so the whole script fails to
# parse with errors pointing at unrelated lines.
#
# This is the local equivalent of `docker compose up -d`. Use it on machines
# where Docker isn't available (see AGENTS.md / the .infra\ setup in
# setup-infra.ps1, which must have been run once first).
#
#   .\setup-infra.ps1   # one-time: download + initdb
#   .\start-infra.ps1   # every boot: start the three services
#
# Ports match .env and docker-compose.yml: postgres 5432, redis 6379,
# minio 9000 (S3 API) + 9001 (web console).

$ErrorActionPreference = "Stop"

$infraDir = Join-Path $PSScriptRoot ".infra"
$logDir   = Join-Path $infraDir "logs"
$dataDir  = Join-Path $infraDir "miniodata"

if (-not (Test-Path $infraDir)) {
    throw "No .infra\ directory at '$infraDir'. Run .\setup-infra.ps1 first."
}
New-Item -ItemType Directory -Force -Path $logDir, $dataDir | Out-Null

# Returns $true if something is already listening on the port.
function Test-Port([int] $Port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect("127.0.0.1", $Port); return $true } catch { return $false } finally { $c.Dispose() }
}

# Polls until the port accepts a connection, so we fail loudly on a bad start
# instead of reporting success for a process that died on launch.
function Wait-Port([int] $Port, [string] $Name, [int] $TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $Port) { Write-Host "  $Name is up on $Port."; return }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not come up on port $Port within ${TimeoutSeconds}s. Check $logDir."
}

# --- PostgreSQL -----------------------------------------------------------
# pg_ctl is invoked with the call operator, which quotes arguments containing
# spaces on its own - unlike Start-Process below.
if (Test-Port 5432) {
    Write-Host "Postgres already running on 5432 - skipping."
} else {
    Write-Host "Starting Postgres..."
    & "$infraDir\pgsql\bin\pg_ctl.exe" -D "$infraDir\pgdata" -l "$logDir\pg.log" -o "-p 5432" -w start
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl start failed with exit code $LASTEXITCODE. See $logDir\pg.log." }
    Wait-Port 5432 "Postgres"
}

# --- Redis ----------------------------------------------------------------
if (Test-Port 6379) {
    Write-Host "Redis already running on 6379 - skipping."
} else {
    Write-Host "Starting Redis..."
    Start-Process -FilePath "$infraDir\redis\redis-server.exe" `
        -ArgumentList "--port", "6379" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\redis.log" `
        -RedirectStandardError  "$logDir\redis.err"
    Wait-Port 6379 "Redis"
}

# --- MinIO ----------------------------------------------------------------
# Start-Process does NOT quote -ArgumentList elements that contain spaces; it
# just joins them with a space. This repo's path contains one ("Amber user"),
# so $dataDir must carry its own embedded quotes or MinIO parses it as two
# separate data directories and drops --console-address.
if (Test-Port 9000) {
    Write-Host "MinIO already running on 9000 - skipping."
} else {
    Write-Host "Starting MinIO..."
    $env:MINIO_ROOT_USER     = "minioadmin"
    $env:MINIO_ROOT_PASSWORD = "minioadmin"
    Start-Process -FilePath "$infraDir\minio.exe" `
        -ArgumentList "server", "`"$dataDir`"", "--console-address", ":9001" `
        -WindowStyle Hidden `
        -RedirectStandardOutput "$logDir\minio.log" `
        -RedirectStandardError  "$logDir\minio.err"
    Wait-Port 9000 "MinIO"
}

Write-Host ""
Write-Host "Infra is up:"
Write-Host "  postgres  localhost:5432  (db: chowk, chowk_test; user: postgres, trust auth)"
Write-Host "  redis     localhost:6379"
Write-Host "  minio     localhost:9000  (console :9001, minioadmin/minioadmin)"
Write-Host "Logs: $logDir"
