$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
Set-Location "F:\FIREBLADE_GITHUB\Android_Call_Collector\android"
.\gradlew.bat assembleRelease --no-daemon
