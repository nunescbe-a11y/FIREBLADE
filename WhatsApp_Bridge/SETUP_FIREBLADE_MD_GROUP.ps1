$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bridgeDir = "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge"
$secureDir = Join-Path $bridgeDir "secure"
$logDir = Join-Path $bridgeDir "logs"
$keyPath = Join-Path $secureDir "bridge.key"
$configPath = Join-Path $secureDir "pending-report-group.json"
$startScript = Join-Path $bridgeDir "START_FIREBLADE_WHATSAPP_PERMANENT.ps1"
$baseUrl = "http://127.0.0.1:3100"
$sessionKey = "fb_md"

New-Item -ItemType Directory -Force -Path $secureDir,$logDir | Out-Null
if (!(Test-Path -LiteralPath $keyPath)) { throw "Fireblade secure bridge key was not found." }
$bridgeKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
$headers = @{ "X-Fireblade-Bridge-Key" = $bridgeKey }

function Test-Bridge {
    try {
        $h = Invoke-RestMethod -Uri "$baseUrl/health" -Headers $headers -TimeoutSec 2
        return [bool]$h.ok
    } catch { return $false }
}

if (-not (Test-Bridge)) {
    Write-Host "Starting Fireblade WhatsApp Bridge..." -ForegroundColor Cyan
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`"" `
        -WindowStyle Hidden | Out-Null
    for ($i=0; $i -lt 75; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Bridge) { break }
    }
    if (-not (Test-Bridge)) { throw "WhatsApp bridge did not become ready." }
}

Write-Host "Starting MD WhatsApp session..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$baseUrl/sessions/$sessionKey/start" -Headers $headers -TimeoutSec 120 | Out-Null

$lastQr = ""
$ready = $false
for ($i=0; $i -lt 240; $i++) {
    Start-Sleep -Seconds 1
    $status = Invoke-RestMethod -Uri "$baseUrl/sessions/$sessionKey/status" -Headers $headers -TimeoutSec 5
    if ($status.status -eq "READY") {
        $ready = $true
        Write-Host "MD_WHATSAPP_READY" -ForegroundColor Green
        break
    }
    if ($status.status -eq "QR_READY" -and $status.qr_data_url -and $status.qr_data_url -ne $lastQr) {
        $lastQr = [string]$status.qr_data_url
        if ($lastQr -match '^data:image\/png;base64,(.+)$') {
            $qrPath = Join-Path $logDir "md-whatsapp-qr.png"
            [System.IO.File]::WriteAllBytes($qrPath, [Convert]::FromBase64String($Matches[1]))
            Write-Host "Scan the QR with the MD phone: WhatsApp > Linked devices > Link a device" -ForegroundColor Yellow
            Start-Process $qrPath
        }
    }
    if ($status.status -eq "ERROR") { throw "MD WhatsApp session error: $($status.error)" }
}
if (-not $ready) { throw "MD WhatsApp was not linked within 4 minutes. Run this setup again when ready to scan." }

$groupResult = Invoke-RestMethod -Uri "$baseUrl/sessions/$sessionKey/groups" -Headers $headers -TimeoutSec 60
$groups = @($groupResult.groups)
if (-not $groups.Count) {
    throw "No WhatsApp groups were found on the MD account. Create/add the Marketing group first, then run this setup again."
}

Write-Host "" 
Write-Host "Select the Marketing WhatsApp group:" -ForegroundColor Cyan
for ($i=0; $i -lt $groups.Count; $i++) {
    Write-Host ("[{0}] {1}" -f ($i+1), $groups[$i].name)
}

[int]$choice = 0
while ($choice -lt 1 -or $choice -gt $groups.Count) {
    $raw = Read-Host "Enter group number"
    [void][int]::TryParse($raw, [ref]$choice)
}
$selected = $groups[$choice-1]

$config = [ordered]@{
    session_key = $sessionKey
    group_id = [string]$selected.id
    group_name = [string]$selected.name
    configured_at = (Get-Date).ToString("o")
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

Write-Host "" 
Write-Host "FIREBLADE_MD_GROUP_PRODUCTION_READY" -ForegroundColor Green
Write-Host "Sender: MD WhatsApp ($($groupResult.number))"
Write-Host "Destination group: $($selected.name)"
Write-Host "Daily schedule: 09:15 AM IST"
Write-Host "Rule: yesterday only; unresolved callbacks only; grouped by Marketing employee"
Write-Host "No test/preview message was sent."

Remove-Variable bridgeKey -ErrorAction SilentlyContinue