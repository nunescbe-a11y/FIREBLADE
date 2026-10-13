$ErrorActionPreference = "Stop"

$bridgeDir = "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge"
$secureDir = Join-Path $bridgeDir "secure"
$logDir    = Join-Path $bridgeDir "logs"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-WatchdogLog {
    param([string]$Message)

    Add-Content `
        -LiteralPath (Join-Path $logDir "bridge-watchdog.log") `
        -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
}

# Only one watchdog may exist.
$mutex = [System.Threading.Mutex]::new(
    $false,
    "Global\FirebladeWhatsAppBridgeWatchdog"
)

if (-not $mutex.WaitOne(0)) {
    Write-WatchdogLog "Another watchdog instance is already running."
    exit 0
}

try {

    $bridgeKeyPath = Join-Path $secureDir "bridge.key"

    if (-not (Test-Path -LiteralPath $bridgeKeyPath)) {
        throw "Bridge key file not found."
    }

    $env:FIREBLADE_WHATSAPP_BRIDGE_KEY =
        (Get-Content -LiteralPath $bridgeKeyPath -Raw).Trim()


    # --------------------------------------------------------
    # Production Supabase environment
    # --------------------------------------------------------

    $webEnvPath =
        "F:\FIREBLADE_GEN2_WHATSAPP_REBUILD\Fireblade_Website\.env.local"

    if (-not (Test-Path -LiteralPath $webEnvPath)) {
        throw "Fireblade website .env.local was not found."
    }

    $envMap = @{}

    foreach ($line in Get-Content -LiteralPath $webEnvPath) {

        if ($line -match '^\s*#' -or $line -notmatch '=') {
            continue
        }

        $parts = $line -split '=', 2

        $name  = $parts[0].Trim()
        $value = $parts[1].Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ($name) {
            $envMap[$name] = $value
        }
    }

    $prodUrl = $envMap['NEXT_PUBLIC_SUPABASE_URL']

    if (-not $prodUrl) {
        $prodUrl = $envMap['SUPABASE_URL']
    }

    $prodKey = $envMap['SUPABASE_SERVER_SECRET']

    if (-not $prodKey) {
        $prodKey = $envMap['SUPABASE_SERVICE_ROLE_KEY']
    }

    if (-not $prodKey) {
        $prodKey = $envMap['SUPABASE_SECRET_KEY']
    }

    if (-not $prodUrl -or -not $prodKey) {
        throw "Production Supabase configuration is missing."
    }

    $env:FIREBLADE_SUPABASE_URL = $prodUrl
    $env:FIREBLADE_SUPABASE_SERVER_KEY = $prodKey

    $env:FIREBLADE_PENDING_GROUP_CONFIG =
        Join-Path $secureDir "pending-report-group.json"

    $env:FIREBLADE_PENDING_REPORT_STATE_DIR =
        Join-Path $secureDir "pending-report-state"

    # --------------------------------------------------------
    # Google Drive service account
    # --------------------------------------------------------

    $googleFile =
        Join-Path $secureDir "google_service_account.json"

    if (Test-Path -LiteralPath $googleFile) {
        $env:FIREBLADE_GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON =
            Get-Content -LiteralPath $googleFile -Raw
    }


    $env:FIREBLADE_MEDIA_ALLOWED_HOSTS =
        "iveupumupvwabmvrnxlw.supabase.co,jchjxkbitapilacrkjsm.supabase.co"

    $env:FIREBLADE_WWEBJS_AUTH_PATH =
        Join-Path $bridgeDir ".wwebjs_auth"

    $env:PUPPETEER_SKIP_DOWNLOAD = "true"
    $env:PORT = "3100"


    $nodePath =
        "$env:ProgramFiles\nodejs\node.exe"

    $serverPath =
        Join-Path $bridgeDir "server.js"

    if (-not (Test-Path -LiteralPath $nodePath)) {
        throw "Node.js executable not found: $nodePath"
    }

    Set-Location $bridgeDir


    # --------------------------------------------------------
    # Reapply the existing whatsapp-web.js navigation patch
    # after node_modules updates when the custom patch exists.
    # --------------------------------------------------------

    $wwebPatch =
        Join-Path $bridgeDir "scripts\patch-wwebjs-navigation.cjs"

    if (Test-Path -LiteralPath $wwebPatch) {

        try {
            & $nodePath $wwebPatch `
                *> (Join-Path $logDir "wwebjs-navigation-patch.log")

            Write-WatchdogLog "whatsapp-web.js navigation patch checked."
        }
        catch {
            Write-WatchdogLog "Navigation patch warning: $($_.Exception.Message)"
        }
    }


    # --------------------------------------------------------
    # Remove stale duplicate bridge Node processes.
    # --------------------------------------------------------

    Get-CimInstance Win32_Process `
        -Filter "Name='node.exe'" `
        -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -like "*FIREBLADE_GEN2_WHATSAPP_REBUILD\WhatsApp_Bridge\server.js*"
    } |
    ForEach-Object {
        Write-WatchdogLog "Stopping stale bridge PID $($_.ProcessId)"

        Stop-Process `
            -Id $_.ProcessId `
            -Force `
            -ErrorAction SilentlyContinue
    }

    Start-Sleep -Seconds 2


    # --------------------------------------------------------
    # Permanent process watchdog
    # --------------------------------------------------------

    while ($true) {

        $proc = $null

        try {

            $runStamp =
                Get-Date -Format "yyyyMMdd-HHmmss"

            $stdout =
                Join-Path $logDir "bridge-output-$runStamp.log"

            $stderr =
                Join-Path $logDir "bridge-error-$runStamp.log"

            Write-WatchdogLog "Starting Fireblade WhatsApp Bridge."

            $proc = Start-Process `
                -FilePath $nodePath `
                -ArgumentList "`"$serverPath`"" `
                -WorkingDirectory $bridgeDir `
                -PassThru `
                -WindowStyle Hidden `
                -RedirectStandardOutput $stdout `
                -RedirectStandardError $stderr


            # ------------------------------------------------
            # Wait for local HTTP service.
            # ------------------------------------------------

            $ready = $false

            for ($i = 0; $i -lt 60; $i++) {

                Start-Sleep -Seconds 1

                if ($proc.HasExited) {
                    throw "Bridge exited during startup."
                }

                try {
                    $health = Invoke-RestMethod `
                        -Uri "http://127.0.0.1:3100/health" `
                        -Headers @{
                            "X-Fireblade-Bridge-Key" =
                                $env:FIREBLADE_WHATSAPP_BRIDGE_KEY
                        } `
                        -TimeoutSec 3

                    if ($health.ok) {
                        $ready = $true
                        break
                    }
                }
                catch {}
            }


            if (-not $ready) {
                throw "Bridge did not become healthy within 60 seconds."
            }

            Write-WatchdogLog "Local bridge is healthy."


            # ------------------------------------------------
            # Restore every existing LocalAuth session.
            # ------------------------------------------------

            $authRoot =
                Join-Path $bridgeDir ".wwebjs_auth"

            Get-ChildItem `
                -LiteralPath $authRoot `
                -Directory `
                -Filter "session-*" `
                -ErrorAction SilentlyContinue |
            ForEach-Object {

                $sessionKey =
                    $_.Name -replace '^session-', ''

                try {
                    Invoke-RestMethod `
                        -Method Post `
                        -Uri "http://127.0.0.1:3100/sessions/$sessionKey/start" `
                        -Headers @{
                            "X-Fireblade-Bridge-Key" =
                                $env:FIREBLADE_WHATSAPP_BRIDGE_KEY
                        } `
                        -TimeoutSec 120 |
                    Out-Null

                    Write-WatchdogLog "Autostart requested for $sessionKey."
                }
                catch {
                    Write-WatchdogLog `
                        "Session autostart failed for $sessionKey : $($_.Exception.Message)"
                }
            }


            # ------------------------------------------------
            # Runtime health watchdog.
            # ------------------------------------------------

            $healthFailures = 0
            $lastSessionProbe = Get-Date

            while (-not $proc.HasExited) {

                Start-Sleep -Seconds 10

                try {
                    $health = Invoke-RestMethod `
                        -Uri "http://127.0.0.1:3100/health" `
                        -Headers @{
                            "X-Fireblade-Bridge-Key" =
                                $env:FIREBLADE_WHATSAPP_BRIDGE_KEY
                        } `
                        -TimeoutSec 3

                    if ($health.ok) {
                        $healthFailures = 0
                    }
                    else {
                        $healthFailures++
                    }
                }
                catch {
                    $healthFailures++
                }


                if ($healthFailures -ge 3) {

                    Write-WatchdogLog `
                        "Three local health checks failed; restarting bridge."

                    Stop-Process `
                        -Id $proc.Id `
                        -Force `
                        -ErrorAction SilentlyContinue

                    break
                }


                if (((Get-Date) - $lastSessionProbe).TotalSeconds -ge 30) {

                    $lastSessionProbe = Get-Date

                    try {
                        $status = Invoke-RestMethod `
                            -Uri "http://127.0.0.1:3100/sessions/fb_md/status" `
                            -Headers @{
                                "X-Fireblade-Bridge-Key" =
                                    $env:FIREBLADE_WHATSAPP_BRIDGE_KEY
                            } `
                            -TimeoutSec 5

                        if ($status.status -eq "DISCONNECTED") {

                            Write-WatchdogLog `
                                "fb_md disconnected; requesting reconnect."

                            Invoke-RestMethod `
                                -Method Post `
                                -Uri "http://127.0.0.1:3100/sessions/fb_md/start" `
                                -Headers @{
                                    "X-Fireblade-Bridge-Key" =
                                        $env:FIREBLADE_WHATSAPP_BRIDGE_KEY
                                } `
                                -TimeoutSec 120 |
                            Out-Null
                        }
                    }
                    catch {
                        Write-WatchdogLog `
                            "fb_md status probe warning: $($_.Exception.Message)"
                    }


                }
            }


            if ($proc.HasExited) {
                Write-WatchdogLog `
                    "Bridge process exited with code $($proc.ExitCode)."
            }
        }
        catch {
            Write-WatchdogLog `
                "Bridge watchdog cycle error: $($_.Exception.Message)"

            if ($proc -and -not $proc.HasExited) {
                Stop-Process `
                    -Id $proc.Id `
                    -Force `
                    -ErrorAction SilentlyContinue
            }
        }

        Write-WatchdogLog "Restarting bridge in 5 seconds."
        Start-Sleep -Seconds 5
    }
}
finally {

    try {
        $mutex.ReleaseMutex()
    }
    catch {}

    $mutex.Dispose()
}