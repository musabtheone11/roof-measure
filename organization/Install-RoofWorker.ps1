param(
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [string]$DownloadsPath,
  [string]$StatePath = "$env:LOCALAPPDATA\DiversityRoof\organization"
)
$ErrorActionPreference = 'Stop'
if (!$DownloadsPath) {
  $folders = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
  $DownloadsPath = [Environment]::ExpandEnvironmentVariables($folders.'{374DE290-123F-4565-9164-39C4925E467B}')
}
if (!$DownloadsPath -or !(Test-Path -LiteralPath $DownloadsPath -PathType Container)) { throw 'Actual Downloads directory is unavailable. Supply -DownloadsPath.' }
$RepoPath = (Resolve-Path -LiteralPath $RepoPath).Path
$DownloadsPath = (Resolve-Path -LiteralPath $DownloadsPath).Path
foreach ($p in @($RepoPath,$DownloadsPath,$StatePath)) { if ($p.Contains('"')) { throw 'Double quotes are not supported in service paths.' } }
$node = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $node -p 'process.versions.node.split(".")[0]')) -lt 24) { throw 'Node 24 or newer is required.' }
if (!(Test-Path -LiteralPath "$RepoPath\organization\cli.mjs")) { throw 'Updated repository organization CLI not found.' }
New-Item -ItemType Directory -Force -Path $StatePath | Out-Null
$arguments = "--use-env-proxy `"$RepoPath\organization\cli.mjs`" start --downloads `"$DownloadsPath`" --state `"$StatePath`""
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $RepoPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'DiversityRoofOrganization' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'DiversityRoofOrganization'
Get-ScheduledTask -TaskName 'DiversityRoofOrganization' | Select-Object TaskName,State
Write-Output "Installed for this user's logon, not unattended boot. Verify actual detection/restart and run CLI status. Paid source processing remains gated. Downloads: $DownloadsPath"
