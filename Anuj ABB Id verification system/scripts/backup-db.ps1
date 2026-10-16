<#
.SYNOPSIS
    ABB Plant 3 Gate Verification System — Database Backup Script
.DESCRIPTION
    Creates a compressed, timestamped custom-format PostgreSQL dump of abb_gate_verification.
    Safe for production handovers and daily backups.
#>

[CmdletBinding()]
param(
    [string]$DatabaseName = "abb_gate_verification",
    [string]$BackupDir = "backups",
    [string]$HostName = "localhost",
    [int]$Port = 5432,
    [string]$AdminUser = $null,
    [string]$BackupDatabaseUrl = $null
)

$ErrorActionPreference = "Stop"
$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$ProjectRoot = if ($ScriptRoot -match "[\\/]scripts$") { Split-Path -Parent $ScriptRoot } else { $ScriptRoot }
$TargetBackupDir = Join-Path $ProjectRoot $BackupDir

if (-not (Test-Path $TargetBackupDir)) {
    New-Item -ItemType Directory -Path $TargetBackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $TargetBackupDir "${DatabaseName}_${Timestamp}.dump"

# Find pg_dump.exe
$PsqlPaths = @(
    "C:\Program Files\PostgreSQL\18\bin",
    "C:\Program Files\PostgreSQL\17\bin",
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin"
)
$PgDumpExe = $null
foreach ($path in $PsqlPaths) {
    if (Test-Path (Join-Path $path "pg_dump.exe")) {
        $PgDumpExe = Join-Path $path "pg_dump.exe"
        break
    }
}
if (-not $PgDumpExe) {
    $cmd = Get-Command "pg_dump.exe" -ErrorAction SilentlyContinue
    if ($cmd) { $PgDumpExe = $cmd.Source }
}
if (-not $PgDumpExe) {
    Write-Host "ERROR: pg_dump.exe not found." -ForegroundColor Red
    exit 1
}

# Resolve connection URL or credentials
# Priority: Parameter -> $env:BACKUP_DATABASE_URL -> $env:MIGRATION_DATABASE_URL
$adminUrl = if ($BackupDatabaseUrl) { $BackupDatabaseUrl }
            elseif ($env:BACKUP_DATABASE_URL) { $env:BACKUP_DATABASE_URL }
            elseif ($env:MIGRATION_DATABASE_URL) { $env:MIGRATION_DATABASE_URL }
            else { $null }

$dbUser = "postgres"

if ($adminUrl) {
    if ($adminUrl -match "postgresql://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)") {
        $dbUser = $Matches[1]
        $env:PGPASSWORD = [System.Uri]::UnescapeDataString($Matches[2])
        $HostName = $Matches[3]
        if ($Matches[4]) { $Port = [int]$Matches[4] }
        if (-not $PSBoundParameters.ContainsKey('DatabaseName')) {
            $DatabaseName = $Matches[5]
        }
    }
}

if ($AdminUser) {
    $dbUser = $AdminUser
} elseif (-not $adminUrl -and $env:PGUSER) {
    $dbUser = $env:PGUSER
}

if (-not $env:PGPASSWORD) {
    Write-Host "Enter password for PostgreSQL user '$dbUser': " -NoNewline -ForegroundColor Gray
    $sec = Read-Host -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
}

Write-Host "Backing up database '$DatabaseName' to '$BackupFile'..." -ForegroundColor Cyan

try {
    & $PgDumpExe -h $HostName -p $Port -U $dbUser -F c -b -v -f $BackupFile $DatabaseName
    $exit = $LASTEXITCODE

    if ($exit -eq 0) {
        $size = (Get-Item $BackupFile).Length
        Write-Host "Backup completed successfully!" -ForegroundColor Green
        Write-Host "  File: $BackupFile ($([math]::Round($size / 1KB, 2)) KB)" -ForegroundColor Green
    } else {
        Write-Host "ERROR: pg_dump failed with exit code $exit." -ForegroundColor Red
        exit 1
    }
} finally {
    $env:PGPASSWORD = $null
}
