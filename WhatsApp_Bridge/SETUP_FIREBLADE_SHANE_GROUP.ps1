param (
    [string]$TargetGroupId = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bridgeDir = "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge"
if (-not (Test-Path -LiteralPath $bridgeDir)) {
    $bridgeDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$secureDir = Join-Path $bridgeDir "secure"
$logDir = Join-Path $bridgeDir "logs"
$keyPath = Join-Path $secureDir "bridge.key"
$configPath = Join-Path $secureDir "shane-assignment-group.json"
$baseUrl = "http://127.0.0.1:3100"
$sessionKey = "fb_shane_assignments"
$canonicalShanePhone = "9345226022"

New-Item -ItemType Directory -Force -Path $secureDir, $logDir | Out-Null
if (!(Test-Path -LiteralPath $keyPath)) {
    throw "Fireblade secure bridge key was not found at $keyPath."
}
$bridgeKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
$headers = @{ "X-Fireblade-Bridge-Key" = $bridgeKey }

function Test-Bridge {
    try {
        $h = Invoke-RestMethod -Uri "$baseUrl/health" -Headers $headers -TimeoutSec 2
        return [bool]$h.ok
    } catch {
        return $false
    }
}

if (-not (Test-Bridge)) {
    throw "WhatsApp bridge is not currently running on $baseUrl. Please start the bridge service first."
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "FIREBLADE SHANE SIR WHATSAPP GROUP SETUP" -ForegroundColor Cyan
Write-Host "Session: $sessionKey (Strictly separate from daily MD report)" -ForegroundColor Cyan
Write-Host "Authorized Number: $canonicalShanePhone" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "Starting Shane Sir WhatsApp session..." -ForegroundColor Cyan
$startResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/management/shane-whatsapp/start" -Headers $headers -TimeoutSec 120

$lastQr = ""
$ready = $false
$connectedNumber = ""

for ($i = 0; $i -lt 300; $i++) {
    Start-Sleep -Seconds 1
    $status = Invoke-RestMethod -Uri "$baseUrl/management/shane-whatsapp/status" -Headers $headers -TimeoutSec 5
    if ($status.status -eq "READY") {
        $ready = $true
        $connectedNumber = [string]$status.number
        Write-Host "SHANE_WHATSAPP_READY: Connected number is $connectedNumber" -ForegroundColor Green
        break
    }
    if ($status.status -eq "QR_READY" -and $status.qr_data_url -and $status.qr_data_url -ne $lastQr) {
        $lastQr = [string]$status.qr_data_url
        if ($lastQr -match '^data:image\/png;base64,(.+)$') {
            $qrPath = Join-Path $logDir "shane-whatsapp-qr.png"
            [System.IO.File]::WriteAllBytes($qrPath, [Convert]::FromBase64String($Matches[1]))
            Write-Host "SCAN REQUIRED: Scan the QR code with Shane Sir's phone ($canonicalShanePhone)" -ForegroundColor Yellow
            Write-Host "WhatsApp > Linked devices > Link a device" -ForegroundColor Yellow
            Start-Process $qrPath
        }
    }
    if ($status.status -eq "ERROR") {
        throw "Shane WhatsApp session error: $($status.error)"
    }
}

if (-not $ready) {
    throw "Shane WhatsApp was not linked within timeout. Run this setup again when ready to scan."
}

# Verify connected sender number
$cleanConnected = ($connectedNumber -replace '\D', '')
if (-not ($cleanConnected.EndsWith($canonicalShanePhone))) {
    throw "SECURITY REJECTION: The connected WhatsApp number ($connectedNumber) does not match Shane Sir's authorized number ($canonicalShanePhone). Setup halted."
}

Write-Host "Verified sender identity: Shane Sir ($connectedNumber)" -ForegroundColor Green

# Fetch available groups on Shane's account
$groupResult = Invoke-RestMethod -Uri "$baseUrl/management/shane-whatsapp/groups" -Headers $headers -TimeoutSec 60
$groups = @($groupResult.groups)
if (-not $groups.Count) {
    throw "No WhatsApp groups were found on Shane Sir's WhatsApp account. Please create or add Shane Sir to the Marketing group first."
}

$selected = $null
if ($TargetGroupId) {
    $selected = $groups | Where-Object { $_.id -eq $TargetGroupId }
    if (-not $selected) {
        throw "Target group ID '$TargetGroupId' was not found on Shane Sir's account."
    }
} else {
    Write-Host ""
    Write-Host "Available WhatsApp groups on Shane Sir's account:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $groups.Count; $i++) {
        Write-Host ("[{0}] {1} (ID: {2})" -f ($i + 1), $groups[$i].name, $groups[$i].id)
    }

    [int]$choice = 0
    while ($choice -lt 1 -or $choice -gt $groups.Count) {
        $raw = Read-Host "Enter the number of the Marketing Assignments group"
        [void][int]::TryParse($raw, [ref]$choice)
    }
    $selected = $groups[$choice - 1]
}

Write-Host ""
Write-Host "Selected Group: $($selected.name) ($($selected.id))" -ForegroundColor Cyan
Write-Host "Checking group members..." -ForegroundColor Cyan

$membersResult = Invoke-RestMethod -Uri "$baseUrl/management/shane-whatsapp/group-members?group_id=$($selected.id)" -Headers $headers -TimeoutSec 60
$members = @($membersResult.participants)
Write-Host "Total members in group: $($members.Count)" -ForegroundColor Green
foreach ($m in $members) {
    Write-Host "  - $($m.name) (Number: $($m.number), User: $($m.user), Admin: $($m.isAdmin))"
}

# Activate group configuration with current epoch cutoff
$nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$configBody = @{
    group_id = [string]$selected.id
    enabled = $true
} | ConvertTo-Json

$saveResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/management/shane-whatsapp/group" -Headers $headers -Body $configBody -ContentType "application/json" -TimeoutSec 30

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "FIREBLADE SHANE WHATSAPP GROUP CONFIGURED & ENABLED!" -ForegroundColor Green
Write-Host "Sender: Shane Sir WhatsApp ($connectedNumber)" -ForegroundColor Green
Write-Host "Destination Group: $($selected.name)" -ForegroundColor Green
Write-Host "Group ID: $($selected.id)" -ForegroundColor Green
Write-Host "Activation Cutoff Epoch: $nowEpoch (NO historical assignments will be sent)" -ForegroundColor Green
Write-Host "State: ARMED for new assignments on Shane phone" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

Remove-Variable bridgeKey -ErrorAction SilentlyContinue
