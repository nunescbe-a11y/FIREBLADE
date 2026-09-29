$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Applying Fireblade whatsapp-web.js navigation fix..."
node .\scripts\patch-wwebjs-navigation.cjs
Write-Host "Checking bridge source..."
node --check .\server.js
Write-Host "Patch complete. Start with: npm.cmd start"
