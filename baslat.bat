@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Vampir Koylu
node server.js
pause
