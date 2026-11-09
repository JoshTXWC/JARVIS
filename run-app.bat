@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

set "ROOT=%~dp0"
set "LOG=%ROOT%run-app.log"

echo. > "%LOG%"
call :log "=== JARVIS run-app.bat started %DATE% %TIME% ==="
call :log "ROOT = %ROOT%"

where node >nul 2>&1
if errorlevel 1 goto :no_node
for /f "tokens=*" %%v in ('node --version 2^>^&1') do call :log "node %%v"

if not exist "%ROOT%venv\Scripts\activate.bat" goto :no_venv
call :log "venv OK"

if not exist "%ROOT%electron\node_modules" goto :npm_install
goto :web_build_check

:npm_install
call :log "node_modules missing - running npm install (first time, ~30s)..."
echo.
echo  Installing Electron dependencies (one-time setup)...
echo  This may take up to 60 seconds. Please wait.
echo.
pushd "%ROOT%electron"
call npm install >> "%LOG%" 2>&1
set _ERR=!errorlevel!
popd
if not !_ERR! == 0 goto :npm_failed
call :log "npm install OK"

:web_build_check
REM Electron serves jarvis from web\dist — rebuild when missing or stale vs src.
if not exist "%ROOT%web\dist\index.html" goto :web_build
if /I "%JARVIS_FORCE_WEB_BUILD%"=="1" goto :web_build
powershell -NoProfile -Command ^
  "$dist=Get-Item -LiteralPath '%ROOT%web\dist\index.html' -ErrorAction SilentlyContinue; if(-not $dist){exit 2}; $newest=Get-ChildItem -LiteralPath '%ROOT%web\src','%ROOT%web\public' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if($newest -and $newest.LastWriteTime -gt $dist.LastWriteTime){exit 3}; exit 0" >> "%LOG%" 2>&1
if errorlevel 3 goto :web_build
if errorlevel 2 goto :web_build
call :log "web\dist is up to date"
goto :launch

:web_build
call :log "Building web frontend (web\dist)..."
echo.
echo  Building web UI (needed for Electron)...
echo.
if not exist "%ROOT%web\node_modules" (
  pushd "%ROOT%web"
  call npm install >> "%LOG%" 2>&1
  set _ERR=!errorlevel!
  popd
  if not !_ERR! == 0 goto :web_build_failed
)
pushd "%ROOT%web"
call npm run build >> "%LOG%" 2>&1
set _ERR=!errorlevel!
popd
if not !_ERR! == 0 goto :web_build_failed
call :log "web build OK"

:launch
call :log "Launching Electron (npm start)..."
echo.
echo  Launching JARVIS...
echo  This window can be minimized. Close the JARVIS window to exit.
echo.
pushd "%ROOT%electron"
call npm start >> "%LOG%" 2>&1
set _EXIT=!errorlevel!
popd

call :log "Electron exited with code !_EXIT!"
if not !_EXIT! == 0 (
  echo.
  echo  JARVIS exited with error code !_EXIT!
  echo  Full log: %LOG%
  echo.
)
pause
exit /b !_EXIT!

:no_node
call :log "[ERROR] node.exe not found in PATH."
echo.
echo  Node.js is required but was not found in PATH.
echo  Download from: https://nodejs.org/
echo.
echo  Full log saved to: %LOG%
pause
exit /b 1

:no_venv
call :log "[ERROR] venv not found at %ROOT%venv"
echo.
echo  Python virtual environment not found.
echo  Run setup.bat first, then retry.
echo.
echo  Full log saved to: %LOG%
pause
exit /b 1

:npm_failed
call :log "[ERROR] npm install failed exit code !_ERR!"
echo.
echo  npm install failed. See full log: %LOG%
echo.
pause
exit /b 1

:web_build_failed
call :log "[ERROR] web build failed exit code !_ERR!"
echo.
echo  Web UI build failed. See full log: %LOG%
echo  Or run manually:  cd web ^&^& npm run build
echo.
pause
exit /b 1

:log
echo [%TIME%] %~1
echo [%TIME%] %~1 >> "%LOG%"
goto :eof
