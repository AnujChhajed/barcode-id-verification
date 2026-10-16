<#
.SYNOPSIS
    ABB Plant 3 Gate Verification System — Database Restore Script
.DESCRIPTION
    Restores a PostgreSQL database from a custom-format dump file using an administrative role.
    Safe for maintenance drills and production restores.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$DumpFile,
    [string]$DatabaseName = "abb_gate_verification",
    [string]$HostName = "localhost",
    [int]$Port = 5432,
    [string]$AdminUser = $null,
    [string]$RestoreDatabaseUrl = $null,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptRoot = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$ProjectRoot = if ($ScriptRoot -match "[\\/]scripts$") { Split-Path -Parent $ScriptRoot } else { $ScriptRoot }
$BackupDir = Join-Path $ProjectRoot "backups"

# Find pg_restore.exe and psql.exe
$PsqlPaths = @(
    "C:\Program Files\PostgreSQL\18\bin",
    "C:\Program Files\PostgreSQL\17\bin",
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin"
)
$PgRestoreExe = $null
$PsqlExe = $null
foreach ($path in $PsqlPaths) {
    if (Test-Path (Join-Path $path "pg_restore.exe")) {
        $PgRestoreExe = Join-Path $path "pg_restore.exe"
        $PsqlExe = Join-Path $path "psql.exe"
        break
    }
}
if (-not $PgRestoreExe) {
    $cmd = Get-Command "pg_restore.exe" -ErrorAction SilentlyContinue
    if ($cmd) { 
        $PgRestoreExe = $cmd.Source 
        $PsqlExe = Join-Path (Split-Path -Parent $cmd.Source) "psql.exe"
    }
}
if (-not $PgRestoreExe) {
    Write-Host "ERROR: pg_restore.exe not found." -ForegroundColor Red
    exit 1
}

# Resolve administrative connection URL or credentials
# Priority: Parameter -> $env:RESTORE_DATABASE_URL -> $env:MIGRATION_DATABASE_URL
$adminUrl = if ($RestoreDatabaseUrl) { $RestoreDatabaseUrl }
            elseif ($env:RESTORE_DATABASE_URL) { $env:RESTORE_DATABASE_URL }
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

# Safeguard: Prevent executing restore as unprivileged runtime role abb_app
if ($dbUser -eq "abb_app") {
    Write-Host "SAFETY REFUSAL: 'abb_app' is the runtime least-privilege role and lacks permissions to perform database restore (DROP/CREATE objects)." -ForegroundColor Red
    Write-Host "Please specify an administrative user (-AdminUser postgres) or set RESTORE_DATABASE_URL." -ForegroundColor Red
    exit 1
}

# Prompt for dump file if not provided
if (-not $DumpFile) {
    if (Test-Path $BackupDir) {
        $dumps = Get-ChildItem -Path $BackupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending
        if ($dumps.Count -gt 0) {
            Write-Host "Available backup files:" -ForegroundColor Cyan
            for ($i = 0; $i -lt $dumps.Count; $i++) {
                Write-Host "  [$($i+1)] $($dumps[$i].Name) ($([math]::Round($dumps[$i].Length / 1KB, 2)) KB, $($dumps[$i].LastWriteTime))" -ForegroundColor White
            }
            Write-Host "Select a file [1-$($dumps.Count)] or enter path: " -NoNewline -ForegroundColor Gray
            $sel = Read-Host
            if ($sel -match "^\d+$" -and [int]$sel -le $dumps.Count) {
                $DumpFile = $dumps[[int]$sel - 1].FullName
            } else {
                $DumpFile = $sel
            }
        }
    }
    if (-not $DumpFile) {
        Write-Host "Enter path to the .dump file: " -NoNewline -ForegroundColor Gray
        $DumpFile = Read-Host
    }
}

if (-not (Test-Path $DumpFile)) {
    Write-Host "ERROR: File '$DumpFile' does not exist." -ForegroundColor Red
    exit 1
}

# Target Database Confirmation Safeguard
Write-Host ""
Write-Host "==========================================================================" -ForegroundColor Red
Write-Host "WARNING: DESTRUCTIVE RESTORE OPERATION" -ForegroundColor Yellow
Write-Host "Target Database : $DatabaseName" -ForegroundColor Cyan
Write-Host "Target Host     : ${HostName}:${Port}" -ForegroundColor Cyan
Write-Host "Restore User    : $dbUser" -ForegroundColor Cyan
Write-Host "Dump File       : $DumpFile" -ForegroundColor Cyan
Write-Host "This operation will DROP and RECREATE tables, replacing data in '$DatabaseName'." -ForegroundColor Yellow
Write-Host "==========================================================================" -ForegroundColor Red

if ($DatabaseName -eq "abb_gate_verification") {
    Write-Host "CRITICAL SAFEGUARD: You have targeted the production database 'abb_gate_verification'." -ForegroundColor Red
    Write-Host "To confirm destructive restore, type the exact database name ('$DatabaseName'): " -NoNewline -ForegroundColor Yellow
    $typedConfirm = Read-Host
    if ($typedConfirm -ne $DatabaseName) {
        Write-Host "SAFETY REFUSAL: Confirmation mismatch ('$typedConfirm' != '$DatabaseName'). Restore cancelled." -ForegroundColor Red
        exit 1
    }
} elseif (-not $Force) {
    Write-Host "Are you sure you want to proceed with restore into '$DatabaseName'? (Y/N): " -NoNewline -ForegroundColor Yellow
    $confirm = Read-Host
    if ($confirm -notmatch "^[Yy]") {
        Write-Host "Restore cancelled by user." -ForegroundColor Gray
        exit 0
    }
}

if (-not $env:PGPASSWORD) {
    Write-Host "Enter password for administrative PostgreSQL user '$dbUser': " -NoNewline -ForegroundColor Gray
    $sec = Read-Host -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
}

Write-Host "Restoring database '$DatabaseName' from '$DumpFile'..." -ForegroundColor Cyan

try {
    & $PgRestoreExe -h $HostName -p $Port -U $dbUser -d $DatabaseName -v --clean --if-exists $DumpFile
    $exit = $LASTEXITCODE

    if ($exit -eq 0 -or $exit -eq 1) {
        # Exit code 1 in pg_restore often means minor warnings (e.g. drop table if not exists)
        Write-Host "Database restore completed successfully!" -ForegroundColor Green
    } else {
        Write-Host "ERROR: pg_restore failed with exit code $exit." -ForegroundColor Red
        exit 1
    }
} finally {
    $env:PGPASSWORD = $null
}
