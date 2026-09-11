param(
  [string]$Root = 'C:\Users\admin\Documents\NavigatorPedagoga',
  [string]$Repo = 'C:\Users\admin\Documents\Codex\2026-09-09\new-chat\work\np-remote'
)
$stopFile = Join-Path $Root 'runtime/STOP'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
$script = Join-Path $Repo 'scripts/local/supervisor.ps1'
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -Root `"$Root`" -Repo `"$Repo`""
