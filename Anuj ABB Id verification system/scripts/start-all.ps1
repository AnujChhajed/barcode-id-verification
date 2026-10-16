<#
.SYNOPSIS
    ABB Plant 3 Gate Verification System - Application Launcher Script
.DESCRIPTION
    Starts both the Express backend and Vite frontend services on the company laptop.
#>

[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$ProjectRoot = if ($ScriptRoot -match "[\\/]scripts$") { Split-Path -Parent $ScriptRoot } else { $ScriptRoot }
$BackendDir = Join-Path $ProjectRoot "backend"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   ABB Plant 3 Gate Verification System - Starting Services      " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify PostgreSQL is up
Write-Host "[1/3] Checking database connectivity..." -ForegroundColor Yellow
$backendEnv = Join-Path $BackendDir ".env"
if (-not (Test-Path $backendEnv)) {
    Write-Host "WARNING: backend/.env was not found." -ForegroundColor Yellow
    Write-Host "Please run .\scripts\setup-db.ps1 first to initialize the database." -ForegroundColor Yellow
    exit 1
}

# 2. Check Backend dependencies
Write-Host "[2/3] Starting Express Backend (Port 4000)..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $BackendDir "node_modules"))) {
    Write-Host "  Installing backend dependencies..." -ForegroundColor Gray
    Push-Location $BackendDir
    npm install
    Pop-Location
}

# Start backend in new PowerShell window
$backendCmd = ("Set-Location ""{0}""; npm start" -f $BackendDir)
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal

# Wait for backend health endpoint
Write-Host "  Waiting for backend to respond..." -ForegroundColor Gray
$attempts = 0
$backendReady = $false
while ($attempts -lt 15) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($res.status -eq "ok" -or $res.db -eq "connected" -or $res.database -eq "connected") {
            $backendReady = $true
            break
        }
    } catch {
        # still booting
    }
    $attempts++
}

if ($backendReady) {
    Write-Host "  Backend running on http://localhost:4000" -ForegroundColor Green
} else {
    Write-Host "  Backend started (check backend window for logs)." -ForegroundColor Gray
}

# 3. Check Frontend dependencies & start
Write-Host "[3/3] Starting Frontend..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Host "  Installing frontend dependencies..." -ForegroundColor Gray
    Push-Location $ProjectRoot
    npm install
    Pop-Location
}

# Start frontend in new PowerShell window
$frontendCmd = ("Set-Location ""{0}""; npm run dev" -f $ProjectRoot)
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal

Write-Host ""
Write-Host "Both services have been launched in separate console windows." -ForegroundColor Green
Write-Host "  Backend API:  http://localhost:4000" -ForegroundColor White
Write-Host "  Frontend App: http://localhost:5173 (or http://localhost:8080)" -ForegroundColor White
Write-Host ""

if (-not $NoBrowser) {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:5173"
}
