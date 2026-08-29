@echo off
set "JAVA_HOME=C:\Program Files\Amazon Corretto\jdk21.0.7_6"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Using JAVA: %JAVA_HOME%
cd /d "%~dp0android"
call gradlew.bat clean assembleDebug
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================
    echo BUILD SUCCESSFUL! Copying APK...
    copy /Y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0PersonalAttendance_Update.apk"
    echo APK saved to: %~dp0PersonalAttendance_Update.apk
    echo ======================================================
) else (
    echo BUILD FAILED!
)
pause
