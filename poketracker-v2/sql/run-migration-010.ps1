$ErrorActionPreference = 'Stop'

$databaseUrl = Read-Host 'Paste the NEW Railway DATABASE_PUBLIC_URL, then press Enter'

if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $databaseUrl -notmatch '^postgres(ql)?://') {
  Write-Error 'No valid PostgreSQL URL was entered. Nothing was changed.'
}

$sqlDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path

docker run --rm `
  -v "${sqlDirectory}:/sql:ro" `
  postgres:16-alpine `
  psql "$databaseUrl" -v ON_ERROR_STOP=1 `
  -f /sql/migration_010_spaces_inventory.sql

if ($LASTEXITCODE -ne 0) {
  throw "Migration failed with exit code $LASTEXITCODE"
}

Write-Host 'Migration 010 completed successfully.' -ForegroundColor Green
