@echo off
setlocal
cd /d "%~dp0"
title Configurar conta TikTok

echo.
echo ==========================================
echo       CONFIGURAR CONTA DA COBRINHA
echo ==========================================
echo.
set /p TIKTOK_USER=Digite o @ da conta TikTok sem o arroba: 

if not defined TIKTOK_USER (
  echo Conta nao alterada.
  pause
  exit /b 1
)

>"%~dp0.snake-user.txt" echo %TIKTOK_USER%

echo.
echo Conta salva: @%TIKTOK_USER%
echo Agora use INICIAR_COBRINHA.bat
echo.
pause
