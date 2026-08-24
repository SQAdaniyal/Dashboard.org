param([string]$TaskName = 'Catalect KPI Dashboard Refresh')
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument 'refresh.mjs' -WorkingDirectory $root
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 11:00AM),
  (New-ScheduledTaskTrigger -Daily -At 3:00PM),
  (New-ScheduledTaskTrigger -Daily -At 5:00PM)
)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Description 'Refreshes the local Catalect KPI data snapshot at scheduled times.' -Force
