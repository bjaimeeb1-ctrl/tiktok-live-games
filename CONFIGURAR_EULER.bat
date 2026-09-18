@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Configurar Euler Stream

echo.
echo ==========================================
echo       CONFIGURAR EULER STREAM
echo ==========================================
echo.
echo A chave sera salva apenas nas variaveis de ambiente
echo do seu usuario do Windows.
echo.
set /p EULER_KEY=Digite sua EULER_API_KEY: 

if not defined EULER_KEY (
  echo.
  echo Chave nao informada.
  pause
  exit /b 1
)

powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('EULER_API_KEY', $env:EULER_KEY, 'User')" 
if errorlevel 1 (
  echo.
  echo Nao foi possivel salvar a configuracao.
  pause
  exit /b 1
)

echo.
echo Euler configurado com sucesso.
echo Feche esta janela e execute INICIAR_COBRINHA.bat.
echo.
pause
