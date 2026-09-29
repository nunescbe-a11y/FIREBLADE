$ErrorActionPreference = "Stop"
$bridgeDir = "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge"
$secureDir = Join-Path $bridgeDir "secure"
$logDir = Join-Path $bridgeDir "logs"
$keyPath = Join-Path $secureDir "bridge.key"
$endpoint = "http://127.0.0.1:3100/automation/pending-group-report"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

try {
    if (-not (Test-Path -LiteralPath $keyPath)) { throw "Fireblade secure bridge key was not found." }
    $bridgeKey = (Get-Content -LiteralPath $keyPath -Raw).Trim()
    if (-not $bridgeKey) { throw "Fireblade secure bridge key is empty." }

    $response = Invoke-RestMethod `
        -Method Post `
        -Uri $endpoint `
        -Headers @{ "X-Fireblade-Bridge-Key" = $bridgeKey } `
        -ContentType "application/json" `
        -Body "{}" `
        -TimeoutSec 240

    if (-not $response.ok) { throw "Fireblade MD group report endpoint did not return success." }

    Add-Content `
        -Path (Join-Path $logDir "pending-call-report.log") `
        -Value "$(Get-Date -Format s) SUCCESS mode=MD_GROUP status=$($response.status) delivery=$($response.delivery_date_ist) report=$($response.report_date_ist) group=$($response.group_name) employees=$($response.employee_count) pending=$($response.pending_count) messages=$($response.message_count)"

    Remove-Variable bridgeKey -ErrorAction SilentlyContinue
    exit 0
}
catch {
    Remove-Variable bridgeKey -ErrorAction SilentlyContinue
    Add-Content `
        -Path (Join-Path $logDir "pending-call-report.log") `
        -Value "$(Get-Date -Format s) FAILED mode=MD_GROUP $($_.Exception.Message)"
    Write-Error $_.Exception.Message
    exit 1
}