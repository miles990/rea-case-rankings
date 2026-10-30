# Registers the daily local run in Windows Task Scheduler: 08:18 and 12:30 (Taipei),
# the same times the Mac launchd job used. Run once from PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-schedule.ps1
# A run that was missed (PC asleep or off) starts as soon as the PC is back on.
param(
  [string]$BashExe = "$env:ProgramFiles\Git\bin\bash.exe"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $env:LOCALAPPDATA "rea-case-rankings\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $BashExe)) { throw "Git Bash not found at $BashExe (pass -BashExe)" }

# Log file per day. Bash expands $(date) and needs forward slashes in the path.
$logBash = $logDir -replace '\\', '/'
$cmd = "cd '$repo' && ./scripts/local-daily.sh >> $logBash/daily-`$(date +%F).log 2>&1"
$action = New-ScheduledTaskAction -Execute $BashExe -Argument "-lc `"$cmd`""

$triggers = @(
  New-ScheduledTaskTrigger -Daily -At "08:18"
  New-ScheduledTaskTrigger -Daily -At "12:30"
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

$name = "rea-case-rankings daily"
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings `
  -Description "Collect, score and publish REA case rankings (local run)." -Force | Out-Null

Write-Output "Registered '$name' at 08:18 and 12:30. Logs: $logDir"
