@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Cobrinha da Live

set "USER_FILE=.snake-user.txt"
set "TIKTOK_USER="

if exist "%USER_FILE%" (
  set /p TIKTOK_USER=<"%USER_FILE%"
)

if not defined TIKTOK_USER (
  echo.
  echo ==========================================
  echo        COBRINHA DA LIVE - TIKTOK
  echo ==========================================
  echo.
  set /p TIKTOK_USER=Digite o @ da conta TikTok sem o arroba: 
  if not defined TIKTOK_USER (
    echo Conta TikTok nao informada.
    pause
    exit /b 1
  )
  if "!TIKTOK_USER:~0,1!"=="@" set "TIKTOK_USER=!TIKTOK_USER:~1!"
  >"%USER_FILE%" echo !TIKTOK_USER!
)

if "!TIKTOK_USER:~0,1!"=="@" set "TIKTOK_USER=!TIKTOK_USER:~1!"

if not defined EULER_API_KEY (
  echo.
  echo ==========================================
  echo   EULER NAO CONFIGURADO NESTE WINDOWS
  echo ==========================================
  echo.
  echo O jogo abre, mas a LIVE e a biblioteca de presentes
  echo nao carregam sem a variavel EULER_API_KEY.
  echo.
  echo Execute CONFIGURAR_EULER.bat uma vez e depois
  echo abra novamente INICIAR_COBRINHA.bat.
  echo.
  pause
  exit /b 1
)

echo.
echo Conta: @!TIKTOK_USER!
echo Verificando servidor...

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo Iniciando servidor...
  start "TikTok Live Games - Servidor" cmd /k "cd /d ""%~dp0"" && npm start"

  echo Aguardando servidor ficar pronto...
  powershell -NoProfile -Command "$ok=$false; 1..30 | ForEach-Object { try { Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/api/health' -TimeoutSec 1 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; if(-not $ok){exit 1}" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Nao foi possivel iniciar o servidor.
    echo Confira a janela do servidor para ver o erro.
    pause
    exit /b 1
  )
) else (
  echo Servidor ja esta rodando.
)

echo Abrindo o jogo...
start "" "http://localhost:3000/games/snake/index.html?username=!TIKTOK_USER!"

exit /b 0
