$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectRoot "backend"
$runtimeDb = Join-Path $backendDir "src\data\navpedagoga.sqlite"

if (-not (Test-Path (Join-Path $backendDir "node_modules"))) {
  Push-Location $backendDir
  npm ci
  Pop-Location
}

$env:DB_PATH = $runtimeDb
$env:JWT_SECRET = "navpedagoga-" + [guid]::NewGuid().ToString() + "-public"
Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $backendDir -WindowStyle Hidden
Start-Sleep -Seconds 3
npx --yes localtunnel --port 4000
