$lines = Get-Content F:\FIREBLADE_GITHUB\Fireblade_Website\.env.production.local
$k = ($lines | Where-Object { $_ -like '*SUPABASE_PUBLISHABLE_KEY*' } | Select-Object -First 1).Split('=', 2)[1].Trim().Trim('"')
$parts = $k.Split('.')
if ($parts.Length -gt 1) {
    $payload = $parts[1]
    $pad = (4 - ($payload.Length % 4)) % 4
    $payload = $payload + ("=" * $pad)
    $bytes = [System.Convert]::FromBase64String($payload)
    [System.Text.Encoding]::UTF8.GetString($bytes)
} else {
    $k
}
