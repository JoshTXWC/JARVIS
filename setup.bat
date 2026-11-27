@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo  ====================================================
echo   J.A.R.V.I.S. setup  ^(safe to re-run any time^)
echo  ====================================================
echo.
echo   Optional switches ^(set before running^):
echo     set JARVIS_MEDIA=1   force-install local image/3D generation deps
echo     set JARVIS_MEDIA=0   skip them
echo     set JARVIS_NO_PULL=1 don't download the chat model / voice now
echo.

:: 1. Python 3.10-3.13
:: Prefer a known-good version via the py launcher (wheels for faster-whisper,
:: piper, onnxruntime lag behind brand-new Python releases), then PATH python.
:: The Microsoft Store "python" alias fails the version probe and is skipped.
set "PY="
set "PY_FALLBACK="
where py >nul 2>&1
if not errorlevel 1 (
  for %%V in (3.12 3.13 3.11 3.10) do (
    if not defined PY (
      for /f "delims=" %%i in ('py -%%V -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%i"
    )
  )
)
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%i in ('where python') do (
      if not defined PY (
        "%%i" -c "import sys; raise SystemExit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1
        if not errorlevel 1 (
          set "PY=%%i"
        ) else (
          "%%i" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,14) else 1)" >nul 2>&1
          if not errorlevel 1 if not defined PY_FALLBACK set "PY_FALLBACK=%%i"
        )
      )
    )
  )
)
if not defined PY if defined PY_FALLBACK (
  echo [warn] Only Python 3.14+ found. Some voice packages may not have wheels yet.
  echo        If install fails, install Python 3.12 from https://www.python.org/downloads/
  set "PY=!PY_FALLBACK!"
)
if not defined PY (
  echo [ERROR] Python 3.10 - 3.13 was not found.
  echo         Install Python 3.12 from https://www.python.org/downloads/
  echo         ^(tick "Add python.exe to PATH"^)  or:  winget install Python.Python.3.12
  echo         then re-run setup.bat.
  pause
  exit /b 1
)
echo [py]  using: !PY!
"!PY!" --version

if exist venv\Scripts\python.exe (
  venv\Scripts\python.exe -c "import sys" >nul 2>&1
  if errorlevel 1 (
    echo [py]  existing venv is broken ^(Python moved/uninstalled^) - recreating...
    rmdir /s /q venv
  )
)
if not exist venv\Scripts\python.exe (
  echo [py]  creating virtual environment...
  "!PY!" -m venv venv
  if errorlevel 1 (
    echo [ERROR] Failed to create venv.
    pause
    exit /b 1
  )
)

call venv\Scripts\activate.bat
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo [py]  upgrading pip...
python -m pip install --upgrade pip --disable-pip-version-check -q

echo [py]  installing core requirements ^(chat, voice, memory, tools^)...
python -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 (
  echo [warn] pip install failed - retrying once ^(network hiccups are common^)...
  python -m pip install -r requirements.txt --disable-pip-version-check
  if errorlevel 1 (
    echo [ERROR] Core pip install failed. Scroll up for the package that failed.
    pause
    exit /b 1
  )
)

:: 2. Optional: local image / 3D generation (several GB)
set "WANT_MEDIA=%JARVIS_MEDIA%"
if not defined WANT_MEDIA (
  set "WANT_MEDIA=0"
  where nvidia-smi >nul 2>&1
  if not errorlevel 1 set "WANT_MEDIA=1"
)
if "!WANT_MEDIA!"=="1" (
  echo [media] NVIDIA GPU detected - installing CUDA torch + image/3D generation deps...
  echo         ^(optional, ~3-5 GB; failures here do not affect chat^)
  python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" >nul 2>&1
  if errorlevel 1 (
    python -m pip install --index-url https://download.pytorch.org/whl/cu128 torch --disable-pip-version-check
    if errorlevel 1 echo [warn] CUDA torch install failed - image/3D generation will be unavailable.
  )
  python -m pip install -r requirements-media.txt --disable-pip-version-check
  if errorlevel 1 echo [warn] Some media packages failed - image/3D generation may be unavailable.
) else (
  echo [media] skipping local image/3D generation deps ^(no NVIDIA GPU, or JARVIS_MEDIA=0^)
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
if not exist data\voices     mkdir data\voices

:: 3. Ollama (local LLM runtime)
echo.
echo [ollama] checking for Ollama...
set "HAVE_OLLAMA=0"
where ollama >nul 2>&1
if not errorlevel 1 set "HAVE_OLLAMA=1"
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "HAVE_OLLAMA=1"
if "!HAVE_OLLAMA!"=="0" (
  where winget >nul 2>&1
  if not errorlevel 1 (
    echo [ollama] not found - installing with winget...
    winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "HAVE_OLLAMA=1"
  )
)
if "!HAVE_OLLAMA!"=="0" (
  echo [warn] Ollama is not installed. JARVIS needs it for local chat.
  echo        Download: https://ollama.com/download/windows  then re-run setup.bat
) else (
  echo [ollama] installed
)
:: Ollama's default 4096-token context is too small for tool use.
if not defined OLLAMA_CONTEXT_LENGTH (
  echo [ollama] setting OLLAMA_CONTEXT_LENGTH=8192 for your user ^(restart the Ollama tray app to apply^)
  setx OLLAMA_CONTEXT_LENGTH 8192 >nul
  set "OLLAMA_CONTEXT_LENGTH=8192"
)

:: 4. Web UI
echo.
echo [web] checking for Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [warn] Node.js not found on PATH.
  echo        Install Node 20 LTS from https://nodejs.org  ^(or: winget install OpenJS.NodeJS.LTS^)
  echo        then re-run setup.bat. The desktop app needs it.
  goto :bootstrap
)

pushd web
echo [web] installing npm dependencies ^(this can take a minute^)...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo [ERROR] npm install failed in web\.
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

pushd electron
echo [app] installing Electron shell...
call npm install --no-fund --no-audit
if errorlevel 1 echo [warn] Electron npm install failed - run-app.bat will retry.
if not exist node_modules\electron\dist\electron.exe call npm rebuild electron
popd

:: 5. Models + voice + health check
:bootstrap
echo.
echo [setup] downloading chat model / memory embeddings / JARVIS voice and checking health...
if "%JARVIS_NO_PULL%"=="1" (
  python -m jarvis.bootstrap --no-pull
) else (
  python -m jarvis.bootstrap
)

echo.
echo  ====================================================
echo   Done.  Start JARVIS with:   run-app.bat
echo.
echo   Optional:
echo     - .env           GITHUB_TOKEN for GitHub push / PRs, cloud API keys
echo     - config.yaml    model: section ^(or switch models in the Models panel^)
echo     - run.bat        backend only, opens in your browser
echo  ====================================================
echo.
pause
