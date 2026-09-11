param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$Repo
)
$ErrorActionPreference = 'Stop'
$mutex = New-Object Threading.Mutex($false, 'Local\NavigatorPedagogaServer')
if (-not $mutex.WaitOne(0)) { exit 0 }
$runtime = Join-Path $Root 'runtime'
$logs = Join-Path $runtime 'logs'
$pages = Join-Path $Root 'pages'
New-Item -ItemType Directory -Force $logs | Out-Null
$nodePath = (Get-Command node.exe).Source
$gitPath = (Get-Command git.exe).Source
$pgCtl = Join-Path $runtime 'pgsql/bin/pg_ctl.exe'
$pgData = Join-Path $runtime 'pgdata'
$backend = $null
$tunnel = $null
$published = ''
$tunnelLog = ''
$lastBackup = [DateTime]::MinValue
$env:DOTENV_CONFIG_PATH = Join-Path $runtime 'server.env'
$env:GIT_TERMINAL_PROMPT = '0'

function Write-Status([string]$Message) {
  Add-Content -LiteralPath (Join-Path $logs 'supervisor.log') -Value "$(Get-Date -Format o) $Message"
}
function Git-Run([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $result = & $gitPath -C $pages @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $result" }
  } finally { $ErrorActionPreference = $previous }
}
try {
  Write-Status 'Supervisor started'
  while (-not (Test-Path (Join-Path $runtime 'STOP'))) {
    try {
      & $pgCtl -D $pgData status *> $null
      if ($LASTEXITCODE -ne 0) {
        $pgLog = Join-Path $runtime 'postgres.log'
        $pgStart = Start-Process $pgCtl -ArgumentList "-D `"$pgData`" -l `"$pgLog`" -w start" -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'postgres-start.log') -RedirectStandardError (Join-Path $logs 'postgres-start.err')
        # Start-Process -Wait also waits for the long-lived postgres descendant.
        if (-not $pgStart.WaitForExit(60000)) { throw 'PostgreSQL start timed out' }
        & $pgCtl -D $pgData status *> $null
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start' }
        Write-Status 'PostgreSQL started'
      }
      if (-not $backend -or $backend.HasExited) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backend = Start-Process $nodePath -ArgumentList 'src/index.js' -WorkingDirectory (Join-Path $Repo 'backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "backend-$stamp.log") -RedirectStandardError (Join-Path $logs "backend-$stamp.err")
        Write-Status "Backend started PID $($backend.Id)"
      }
      $health = Invoke-RestMethod 'http://127.0.0.1:4100/api/health' -TimeoutSec 10
      if (-not $health.ok -or $health.database -ne 'postgres') { throw 'Backend not ready' }
      if (-not $tunnel -or $tunnel.HasExited) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $tunnelLog = Join-Path $logs "tunnel-$stamp.log"
        $knownHosts = Join-Path $runtime 'known_hosts'
        $tunnelArgs = "-T -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=`"$knownHosts`" -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -R 80:127.0.0.1:4100 nokey@localhost.run -- --output json --inject-http-proxy-headers"
        $tunnel = Start-Process ssh.exe -ArgumentList $tunnelArgs -WorkingDirectory $runtime -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError (Join-Path $logs "tunnel-$stamp.err")
        Write-Status "Tunnel started PID $($tunnel.Id)"
      }
      $opened = Get-Content -LiteralPath $tunnelLog -Tail 50 -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.StartsWith('{')) { try { $_ | ConvertFrom-Json } catch {} }
      } | Where-Object { $_.event -eq 'tcpip-forward' -and $_.status -eq 'success' -and $_.type -eq 'opened' } | Select-Object -Last 1
      if ($opened -and $opened.address -match '^[a-z0-9-]+\.(lhr\.life|localhost\.run)$') {
        $endpoint = 'https://' + $opened.address + '/api'
        if ($endpoint -ne $published) {
          $publicHealth = Invoke-RestMethod ($endpoint + '/health') -TimeoutSec 20
          if (-not $publicHealth.ok) { throw 'Public API not ready' }
          @{ apiBase = $endpoint; updatedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pages 'endpoint.json') -Encoding UTF8
          Git-Run @('add', '--', 'endpoint.json')
          & $gitPath -C $pages diff --cached --quiet
          if ($LASTEXITCODE -eq 1) { Git-Run @('commit', '-m', 'Update local API endpoint') }
          Git-Run @('push', 'origin', 'gh-pages')
          $published = $endpoint
          @{ apiBase = $endpoint; backendPid = $backend.Id; tunnelPid = $tunnel.Id; updatedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'status.json') -Encoding UTF8
          Write-Status "Published endpoint $endpoint"
        }
      }
      if (((Get-Date) - $lastBackup).TotalHours -ge 1) {
        & $nodePath (Join-Path $Repo 'backend/scripts/local-backup.mjs') $Root >> (Join-Path $logs 'backup.log') 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Daily backup failed' }
        $lastBackup = Get-Date
      }
    } catch { Write-Status $_.Exception.Message }
    Start-Sleep -Seconds 10
  }
} finally {
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id }
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id }
  & $pgCtl -D $pgData -m fast -w stop *> $null
  Write-Status 'Supervisor stopped'
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
