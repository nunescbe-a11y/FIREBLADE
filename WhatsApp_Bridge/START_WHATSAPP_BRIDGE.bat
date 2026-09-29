@echo off
setlocal
if "%FIREBLADE_WHATSAPP_BRIDGE_KEY%"=="" (
 echo Set FIREBLADE_WHATSAPP_BRIDGE_KEY before starting.
 exit /b 1
)
set PUPPETEER_SKIP_DOWNLOAD=true
call npm.cmd install --omit=dev || exit /b 1
call npm.cmd start
