<#
.SYNOPSIS
    ABB Plant 3 Gate Verification System - PostgreSQL Database Setup and Verification Script
.DESCRIPTION
    Automates the local setup of PostgreSQL for the company laptop:
    1. Checks if PostgreSQL binaries exist and are accessible.
    2. Checks if the PostgreSQL Windows service is running.
    3. Prompts securely for credentials (never echoes or hardcodes passwords).
    4. Checks whether the target database exists; creates it if missing.
    5. Creates a dedicated application role with least privilege.
    6. Updates backend/.env with the connection string.
    7. Runs PostgreSQL migrations safely.
    8. Verifies all schema tables and connection integrity.
    9. Offers to run the administrator bootstrap script.
#>

[CmdletBinding()]
param(
    [string]$DatabaseName = "abb_gate_verification",
    [string]$AppUser = "abb_app",
    [int]$Port = 5432,
    [string]$HostName = "localhost"
)

$ErrorActionPreference = "Stop"

if ($DatabaseName -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') {
    Write-Host ("ERROR: Database name '{0}' contains invalid characters." -f $DatabaseName) -ForegroundColor Red
    exit 1
}
if ($AppUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') {
    Write-Host ("ERROR: Application username '{0}' contains invalid characters." -f $AppUser) -ForegroundColor Red
    exit 1
}

$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$ProjectRoot = if ($ScriptRoot -match "[\\/]scripts$") { Split-Path -Parent $ScriptRoot } else { $ScriptRoot }
$BackendDir = Join-Path $ProjectRoot "backend"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   ABB Plant 3 Gate Verification - Local PostgreSQL Setup        " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------------
# 1. Locate PostgreSQL binaries
# -----------------------------------------------------------------------------
Write-Host "[1/7] Checking PostgreSQL installation..." -ForegroundColor Yellow

$PsqlPaths = @(
    "C:\Program Files\PostgreSQL\18\bin",
    "C:\Program Files\PostgreSQL\17\bin",
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin"
)

$PgBinDir = $null
foreach ($path in $PsqlPaths) {
    if (Test-Path (Join-Path $path "psql.exe")) {
        $PgBinDir = $path
        break
    }
}

if (-not $PgBinDir) {
    $cmd = Get-Command "psql.exe" -ErrorAction SilentlyContinue
    if ($cmd) {
        $PgBinDir = Split-Path -Parent $cmd.Source
    }
}

if (-not $PgBinDir) {
    Write-Host "ERROR: PostgreSQL was not found in standard paths or PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "To install PostgreSQL on this laptop:" -ForegroundColor Yellow
    Write-Host "  Option A (winget):"
    Write-Host "    winget install PostgreSQL.PostgreSQL.18" -ForegroundColor White
    Write-Host "  Option B (official installer):"
    Write-Host "    Download from https://www.postgresql.org/download/windows/" -ForegroundColor White
    Write-Host ""
    exit 1
}

$PsqlExe = Join-Path $PgBinDir "psql.exe"
$PgIsReadyExe = Join-Path $PgBinDir "pg_isready.exe"
$PgDumpExe = Join-Path $PgBinDir "pg_dump.exe"

$pgVersion = & $PsqlExe --version
Write-Host ("  Found: {0} ({1})" -f $pgVersion, $PsqlExe) -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Check service status
# -----------------------------------------------------------------------------
Write-Host "[2/7] Checking PostgreSQL service status..." -ForegroundColor Yellow

$service = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service) {
    Write-Host ("  Windows service {0} status: {1}" -f $service.Name, $service.Status) -ForegroundColor Gray
    if ($service.Status -ne "Running") {
        Write-Host "  Starting PostgreSQL service..." -ForegroundColor Yellow
        Start-Service $service.Name
        Start-Sleep -Seconds 2
    }
}

$serverEndpoint = ("{0}:{1}" -f $HostName, $Port)

if (Test-Path $PgIsReadyExe) {
    $readyOut = & $PgIsReadyExe -h $HostName -p $Port 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ("ERROR: PostgreSQL is not accepting connections at {0} ({1})" -f $serverEndpoint, $readyOut) -ForegroundColor Red
        exit 1
    }
    Write-Host ("  PostgreSQL is accepting connections at {0}." -f $serverEndpoint) -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 3. Authenticate as postgres superuser
# -----------------------------------------------------------------------------
Write-Host "[3/7] PostgreSQL Superuser Authentication..." -ForegroundColor Yellow
Write-Host "  Enter the password for the local postgres superuser account." -ForegroundColor Gray
Write-Host "  (Password will not be echoed or stored in files): " -NoNewline -ForegroundColor Gray

$securePass = Read-Host -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
$PlainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

$env:PGPASSWORD = $PlainPass

# Test connection
$testResult = & $PsqlExe -U postgres -h $HostName -p $Port -d postgres -tAc "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host ("ERROR: Authentication failed for postgres user at {0}." -f $serverEndpoint) -ForegroundColor Red
    Write-Host ("Details: {0}" -f $testResult) -ForegroundColor Red
    $env:PGPASSWORD = $null
    exit 1
}
Write-Host "`n  Authentication successful." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 4. Create target database if it does not already exist
# -----------------------------------------------------------------------------
Write-Host ("[4/7] Checking database: {0}..." -f $DatabaseName) -ForegroundColor Yellow

$escapedDbName = $DatabaseName.Replace("'", "''")
$checkDbSql = "SELECT 1 FROM pg_database WHERE datname = '{0}';" -f $escapedDbName
$dbExists = & $PsqlExe -U postgres -h $HostName -p $Port -d postgres -tAc $checkDbSql
if ($dbExists -and $dbExists.Trim() -eq "1") {
    Write-Host ("  Database {0} already exists. Preserving existing data." -f $DatabaseName) -ForegroundColor Green
} else {
    Write-Host ("  Creating database: {0}..." -f $DatabaseName) -ForegroundColor Yellow
    $createDbSql = "CREATE DATABASE {0} WITH ENCODING 'UTF8';" -f $DatabaseName
    & $PsqlExe -U postgres -h $HostName -p $Port -d postgres -c $createDbSql
    if ($LASTEXITCODE -ne 0) {
        Write-Host ("ERROR: Failed to create database: {0}." -f $DatabaseName) -ForegroundColor Red
        $env:PGPASSWORD = $null
        exit 1
    }
    Write-Host ("  Database {0} created successfully." -f $DatabaseName) -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 5. Create or configure application role
# -----------------------------------------------------------------------------
Write-Host ("[5/7] Configuring application role: {0}..." -f $AppUser) -ForegroundColor Yellow

$escapedAppUser = $AppUser.Replace("'", "''")
$checkRoleSql = "SELECT 1 FROM pg_roles WHERE rolname = '{0}';" -f $escapedAppUser
$roleExists = & $PsqlExe -U postgres -h $HostName -p $Port -d postgres -tAc $checkRoleSql

$appPassword = $null
if ($roleExists -and $roleExists.Trim() -eq "1") {
    Write-Host ("  Role {0} already exists." -f $AppUser) -ForegroundColor Gray
    Write-Host ("  Enter password for {0} (or press Enter to keep existing password / use postgres): " -f $AppUser) -NoNewline -ForegroundColor Gray
    $secAppPass = Read-Host -AsSecureString
    $BSTRApp = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secAppPass)
    $appPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTRApp)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTRApp)
} else {
    Write-Host ("  Creating dedicated role {0} with least privilege..." -f $AppUser) -ForegroundColor Yellow
    Write-Host ("  Choose a password for application role {0} (or press Enter to use postgres role): " -f $AppUser) -NoNewline -ForegroundColor Gray
    $secAppPass = Read-Host -AsSecureString
    $BSTRApp = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secAppPass)
    $appPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTRApp)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTRApp)

    if (-not [string]::IsNullOrWhiteSpace($appPassword)) {
        $escapedPass = $appPassword.Replace("'", "''")
        $roleStatements = @(
            ("CREATE ROLE {0} WITH LOGIN PASSWORD '{1}';" -f $AppUser, $escapedPass),
            ("GRANT CONNECT ON DATABASE {0} TO {1};" -f $DatabaseName, $AppUser)
        )
        foreach ($stmt in $roleStatements) {
            & $PsqlExe -U postgres -h $HostName -p $Port -d postgres -c $stmt
        }

        $schemaStatements = @(
            ("GRANT USAGE, CREATE ON SCHEMA public TO {0};" -f $AppUser),
            ("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {0};" -f $AppUser),
            ("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {0};" -f $AppUser),
            ("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {0};" -f $AppUser),
            ("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO {0};" -f $AppUser)
        )
        foreach ($stmt in $schemaStatements) {
            & $PsqlExe -U postgres -h $HostName -p $Port -d $DatabaseName -c $stmt
        }
    }
}

# Determine DATABASE_URL to store in backend/.env
$finalUser = if (-not [string]::IsNullOrWhiteSpace($appPassword)) { $AppUser } else { "postgres" }
$finalPass = if (-not [string]::IsNullOrWhiteSpace($appPassword)) { $appPassword } else { $PlainPass }

# Encode URL characters if needed
$encodedPass = [System.Uri]::EscapeDataString($finalPass)
$dbUrl = "postgresql://{0}:{1}@{2}:{3}/{4}" -f $finalUser, $encodedPass, $HostName, $Port, $DatabaseName

# Write/Update backend/.env
$backendEnvPath = Join-Path $BackendDir ".env"
$envLines = @()
if (Test-Path $backendEnvPath) {
    $existing = Get-Content $backendEnvPath
    $foundDb = $false
    foreach ($line in $existing) {
        if ($line -match "^DATABASE_URL=") {
            $envLines += ("DATABASE_URL={0}" -f $dbUrl)
            $foundDb = $true
        } else {
            $envLines += $line
        }
    }
    if (-not $foundDb) {
        $envLines += ("DATABASE_URL={0}" -f $dbUrl)
    }
} else {
    $envLines = @(
        "PORT=4000",
        "HOST=127.0.0.1",
        "NODE_ENV=development",
        ("DATABASE_URL={0}" -f $dbUrl),
        "CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173",
        "SESSION_COOKIE_NAME=abb_session",
        "SESSION_TIMEOUT_MINUTES=30",
        "SESSION_COOKIE_SECURE=false",
        "LOGIN_RATE_WINDOW_MS=900000",
        "LOGIN_RATE_MAX=5"
    )
}
Set-Content -Path $backendEnvPath -Value $envLines -Encoding UTF8
Write-Host ("  Updated backend/.env with DATABASE_URL ({0}@{1}/{2})" -f $finalUser, $serverEndpoint, $DatabaseName) -ForegroundColor Green

# Clear superuser password from environment
$env:PGPASSWORD = $null

# -----------------------------------------------------------------------------
# 6. Apply versioned PostgreSQL migrations
# -----------------------------------------------------------------------------
Write-Host "[6/7] Running database migrations..." -ForegroundColor Yellow

Push-Location $BackendDir
try {
    node scripts/migrate.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Migration runner failed." -ForegroundColor Red
        Pop-Location
        exit 1
    }
} finally {
    Pop-Location
}

# -----------------------------------------------------------------------------
# 7. Verify schema and table structure
# -----------------------------------------------------------------------------
Write-Host "[7/7] Verifying database schema and tables..." -ForegroundColor Yellow

$env:PGPASSWORD = $finalPass
$querySchemaSql = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
$tableList = & $PsqlExe -U $finalUser -h $HostName -p $Port -d $DatabaseName -tAc $querySchemaSql
$env:PGPASSWORD = $null

$tables = @()
if ($tableList) {
    $tables = ($tableList -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

Write-Host ("  Found {0} public tables in {1}:" -f $tables.Count, $DatabaseName) -ForegroundColor Gray
foreach ($t in $tables) {
    Write-Host ("    - {0}" -f $t) -ForegroundColor Gray
}

$requiredTables = @("users", "contractors", "persons", "id_cards", "visits", "gate_logs", "canteen_logs", "audit_logs", "sessions", "settings")
$missing = @()
foreach ($req in $requiredTables) {
    if ($tables -notcontains $req) {
        $missing += $req
    }
}

if ($missing.Count -gt 0) {
    $missingList = $missing -join ", "
    Write-Host ("WARNING: The following required tables were not found: {0}" -f $missingList) -ForegroundColor Yellow
} else {
    Write-Host "  All 10 schema tables verified successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "   PostgreSQL Setup Completed Successfully!                      " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""

# -----------------------------------------------------------------------------
# Optional: Bootstrap administrator
# -----------------------------------------------------------------------------
Write-Host "Would you like to create or verify the initial Administrator account now? (Y/N): " -NoNewline -ForegroundColor Cyan
$resp = Read-Host
if ($resp -match "^[Yy]") {
    Push-Location $BackendDir
    try {
        node scripts/bootstrap-admin.js
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Next steps to run the application:" -ForegroundColor Cyan
Write-Host "  1. Start backend:  cd backend; npm start" -ForegroundColor White
Write-Host "  2. Start frontend: npm run dev" -ForegroundColor White
Write-Host "  3. Or run both:    .\scripts\start-all.ps1" -ForegroundColor White
Write-Host ""
