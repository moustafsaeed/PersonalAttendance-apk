@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Using JAVA: %JAVA_HOME%

echo Syncing latest changes...
call npx cap sync android

cd /d "%~dp0android"
echo Building Release APK...
call gradlew.bat clean assembleRelease

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================
    echo BUILD SUCCESSFUL! Copying APK...
    copy /Y "app\build\outputs\apk\release\app-release.apk" "%~dp0Personal_Attendance_v1.0_Official_Release.apk"
    echo APK saved to: %~dp0Personal_Attendance_v1.0_Official_Release.apk
    echo ======================================================
) else (
    echo BUILD FAILED!
)
pause
