param([string]$Root = 'C:\Users\admin\Documents\NavigatorPedagoga')
New-Item -ItemType File -Force (Join-Path $Root 'runtime/STOP') | Out-Null
Write-Output 'Stop requested. Allow up to 60 seconds for active operations to finish.'
