@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo  VaultBase — Local Windows Build
echo  Target: x86_64-pc-windows-msvc
echo ============================================================
echo.

:: Check Rust
where rustup >nul 2>&1 || (echo [ERROR] rustup not found. Install from https://rustup.rs && exit /b 1)
where cargo  >nul 2>&1 || (echo [ERROR] cargo not found && exit /b 1)

:: Check Node
where node >nul 2>&1 || (echo [ERROR] node.js not found. Install from https://nodejs.org && exit /b 1)
where npm  >nul 2>&1 || (echo [ERROR] npm not found && exit /b 1)

:: Ensure MSVC target
echo [1/5] Checking Rust target...
rustup target add x86_64-pc-windows-msvc
rustup toolchain install stable-x86_64-pc-windows-msvc

:: Install frontend deps
echo [2/5] Installing npm dependencies...
call npm ci
if errorlevel 1 (echo [ERROR] npm ci failed && exit /b 1)

:: Build frontend
echo [3/5] Building frontend...
call npm run build
if errorlevel 1 (echo [ERROR] Frontend build failed && exit /b 1)

:: Build Tauri (Windows only: produces .msi and .exe)
echo [4/5] Building Tauri app...
call npm run tauri build -- --target x86_64-pc-windows-msvc
if errorlevel 1 (echo [ERROR] Tauri build failed && exit /b 1)

echo.
echo [5/5] Done! Find installers in:
echo   src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\
echo   src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\
echo.
pause
