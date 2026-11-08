@echo off
setlocal EnableDelayedExpansion

echo.
echo  ====================================================
echo   J.A.R.V.I.S. setup
echo  ====================================================
echo.

:: Resolve a usable Python 3.10+ interpreter.
:: Prefer `python` on PATH; fall back to the Windows `py` launcher.
set "PY="
where python >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('where python') do (
    set "PY=%%i"
    goto :have_py
  )
)

where py >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%i in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do (
    set "PY=%%i"
    goto :have_py
  )
)

echo [ERROR] Python 3.10+ was not found.
echo         Install from https://www.python.org/downloads/
echo         and tick "Add python.exe to PATH", then re-run setup.bat.
echo         Or install the Python Launcher ^(py.exe^) and try again.
pause
exit /b 1

:have_py
echo [py]  using: !PY!
"!PY!" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Need Python 3.10 or newer. Found:
  "!PY!" --version
  pause
  exit /b 1
)

if not exist venv (
  echo [py]  creating virtual environment...
  "!PY!" -m venv venv
  if errorlevel 1 (
    echo [ERROR] Failed to create venv.
    pause
    exit /b 1
  )
)

call venv\Scripts\activate.bat

echo [py]  upgrading pip...
python -m pip install --upgrade pip --disable-pip-version-check >nul

echo [py]  installing requirements...
pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed. Check requirements.txt.
  pause
  exit /b 1
)

echo [browser] installing Playwright Chromium runtime...
python -m playwright install chromium
if errorlevel 1 (
  echo [warn] Playwright browser install failed. Browser control will be unavailable until this succeeds.
)

if not exist .env (
  echo [env] creating .env from .env.example...
  copy /Y .env.example .env >nul
)

if not exist data            mkdir data
if not exist data\logs       mkdir data\logs
if not exist data\backups    mkdir data\backups
if not exist data\sandbox    mkdir data\sandbox

echo.
echo [web] checking for Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [warn] Node.js not found on PATH.
  echo        Install Node 18+ from https://nodejs.org then re-run setup.bat
  echo        to build the cinematic web frontend.
  echo        ^(Backend will still run; it serves a placeholder until frontend is built.^)
  goto :done
)

pushd web
echo [web] installing npm dependencies ^(this can take a minute^)...
call npm install --silent
if errorlevel 1 (
  echo [ERROR] npm install failed.
  popd
  pause
  exit /b 1
)
echo [web] building frontend ^(production bundle^)...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  popd
  pause
  exit /b 1
)
popd

:done
echo.
echo  ====================================================
echo   Done.
echo     1. Edit .env  ^(LLM_API_KEY etc.^)
echo     2. Edit config.yaml  ^(model endpoint + provider^)
echo     3. Run:  run.bat
echo  ====================================================
echo.
pause
