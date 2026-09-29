@echo off
setlocal
set "FIREBLADE_APK=%~dp0..\Releases\Fireblade_App_1.3.0.apk"
if not exist "%FIREBLADE_APK%" (
 echo Build the release on the original signing PC first.
 pause
 exit /b 1
)
where adb >nul 2>nul
if errorlevel 1 (
 echo Add Android SDK platform-tools to PATH first.
 pause
 exit /b 1
)
adb install -r "%FIREBLADE_APK%"
if errorlevel 1 echo Update failed. Keep the installed app and check the signing key. Do not uninstall it.
pause
