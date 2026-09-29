$ErrorActionPreference = "Stop"

$taskName = "Fireblade Pending Call Report 0915"
$bridgeDir = "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge"
$runner = Join-Path $bridgeDir "RUN_FIREBLADE_PENDING_REPORT.ps1"

if (-not (Test-Path $runner)) {
    throw "Pending report runner not found: $runner"
}

$timeZone = (Get-TimeZone).Id
if ($timeZone -ne "India Standard Time") {
    throw "Windows timezone must be India Standard Time before installing the 09:15 IST report task. Current timezone: $timeZone"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -Daily -At "09:15"

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Fireblade Gen 2 daily pending customer callback report at 09:15 IST." `
    -Force | Out-Null

Write-Host "FIREBLADE_PENDING_REPORT_TASK_READY"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
