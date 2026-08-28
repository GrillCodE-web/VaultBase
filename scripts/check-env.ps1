# check-env.ps1 — прогон проверок VaultBase в ПРАВИЛЬНО настроенном окружении.
#
# Зачем: на этой машине "свежее" VS 18 Community содержит ОБРЕЗАННЫЙ MSVC
# (14.51.36231 — есть bin/lib, но НЕТ include/ → cl.exe падает с
# "vcruntime.h: No such file or directory"), VsDevCmd.bat падает на своём
# ext\cmake.bat, а perl из Git for Windows — урезанный (нет
# Locale/Maketext/Simple.pm → падает сборка OpenSSL через
# bundled-sqlcipher-vendored-openssl). MSVC-тулчейном cargo на этой машине
# не пользуется: и manager-work, и agent-backend собираются хостом
# x86_64-pc-windows-gnu (MSYS2 mingw64 gcc + perl).
#
# Скрипт делает то же, что сработало в прошлых сессиях:
#   1. ставит cargo-таргет/хост x86_64-pc-windows-gnu (rustup default-host);
#   2. префиксует PATH каталогами C:\msys64\usr\bin (perl flavor cygwin —
#      ЕДИНСТВЕННЫЙ, который переваривает OpenSSL Configure: mingw64- и
#      git-perl собраны как MSWin32 и падают с "doesn't produce Unix like
#      paths", exit 255) и C:\msys64\mingw64\bin (gcc 16, ar, windres;
#      gcc в usr\bin нет — конфликта тулчейнов нет). Оба РАНЬШЕ
#      C:\Program Files\Git\usr\bin (обрезанный git-perl);
#   3. гоняет npm run lint → vitest → audit_frontend.py → cargo test.
#
# Запускать из КОРНЯ нужного worktree:
#
#   powershell -File scripts\check-env.ps1            # lint + vitest + audit + cargo test
#   powershell -File scripts\check-env.ps1 -SkipCargo # только фронтенд-проверки
#   powershell -File scripts\check-env.ps1 -CargoOnly # только cargo test
#
# Код выхода: 0 — всё зелёное, 1 — хотя бы один шаг упал (сводка в конце).

param(
    [switch]$SkipCargo,
    [switch]$CargoOnly,
    [switch]$CargoCheckOnly  # cargo check вместо cargo test (быстрая проверка компиляции)
)

$ErrorActionPreference = 'Continue'
$root = (Get-Location).Path
if (-not (Test-Path "$root\src-tauri\Cargo.toml")) {
    Write-Host "ОШИБКА: запускать из корня worktree (не вижу src-tauri\Cargo.toml в $root)" -ForegroundColor Red
    exit 1
}

function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:failed += $msg }

$script:failed = @()

# --- 1. MSYS2: usr\bin (cygwin-perl для OpenSSL Configure) + mingw64\bin (gcc) -
$msysUsr = "C:\msys64\usr\bin"
$msysBin = "C:\msys64\mingw64\bin"
if (-not (Test-Path "$msysBin\gcc.exe")) { Write-Host "ОШИБКА: нет $msysBin\gcc.exe" -ForegroundColor Red; exit 1 }
if (-not (Test-Path "$msysUsr\perl.exe")) { Write-Host "ОШИБКА: нет $msysUsr\perl.exe" -ForegroundColor Red; exit 1 }
$env:PATH = "$msysUsr;$msysBin;$env:PATH"
Write-Host "toolchain: $msysUsr + $msysBin (gcc $((& "$msysBin\gcc.exe" -dumpfullversion 2>$null)), perl $((& "$msysUsr\perl.exe" -e 'print "$^V/$^O"' 2>$null)))" -ForegroundColor Cyan

# --- 2. cargo: хост x86_64-pc-windows-gnu (как в остальных worktree) ----------
$installed = rustup target list --installed 2>$null
if ($installed -notcontains 'x86_64-pc-windows-gnu') {
    Write-Host "rustup: добавляю таргет x86_64-pc-windows-gnu" -ForegroundColor Yellow
    rustup target add x86_64-pc-windows-gnu
    if ($LASTEXITCODE -ne 0) { Write-Host "ОШИБКА rustup target add" -ForegroundColor Red; exit 1 }
}
rustup set default-host x86_64-pc-windows-gnu | Out-Null
Write-Host "cargo host: $(rustc -vV | Select-String 'host:')".Trim() -ForegroundColor Cyan

# Старые билд-артефакты могли быть собраны с MSVC (особенно openssl-sys
# держит nmake/Makefile в out/) — сносим, чтобы configure пересчитался под gnu.
foreach ($pat in 'openssl-sys-*', 'openssl-*', 'ring-*') {
    Get-ChildItem "$root\src-tauri\target\debug\build" -Directory -Filter $pat -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "clean: $($_.Name)" -ForegroundColor DarkGray; Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

# Страховка: если perl всё же соберёт OpenSSL под VC-WIN64A (случится, когда в
# PATH раньше mingw64 окажется nmake/cl из MSVC), дать ему ЖИВОЙ компилятор.
$msvcBase = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC'
if (Test-Path $msvcBase) {
    $msvc = Get-ChildItem $msvcBase -Directory | Where-Object { Test-Path "$($_.FullName)\include\vcruntime.h" } |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
    if ($msvc) {
        $sdkBase = 'C:\Program Files (x86)\Windows Kits\10'
        $sdkVer = Get-ChildItem "$sdkBase\include" -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path "$($_.FullName)\ucrt\corecrt.h" } | Sort-Object Name -Descending |
            Select-Object -First 1 -ExpandProperty Name
        if ($sdkVer) {
            $env:INCLUDE = "$msvc\include;$sdkBase\include\$sdkVer\ucrt;$sdkBase\include\$sdkVer\um;$sdkBase\include\$sdkVer\shared;$sdkBase\include\$sdkVer\winrt"
            $env:LIB = "$msvc\lib\x64;$sdkBase\lib\$sdkVer\ucrt\x64;$sdkBase\lib\$sdkVer\um\x64"
            Write-Host "fallback MSVC include/lib: $msvc + SDK $sdkVer" -ForegroundColor DarkGray
        }
    }
}

# --- Проверки -----------------------------------------------------------------
function Step($name, [scriptblock]$cmd) {
    Write-Host "`n=== $name ===" -ForegroundColor Green
    & $cmd
    if ($LASTEXITCODE -ne 0) { Fail $name } else { Write-Host "  [OK] $name" -ForegroundColor Green }
}

if (-not $CargoOnly) {
    Step "npm run lint" { npm run lint }
    Step "vitest run" { npx vitest run }
    Step "audit_frontend" { python scripts\audit_frontend.py }
}
if (-not $SkipCargo) {
    if ($CargoCheckOnly) {
        Step "cargo check" { Push-Location "$root\src-tauri"; try { cargo check } finally { Pop-Location } }
    } else {
        Step "cargo test" { Push-Location "$root\src-tauri"; try { cargo test } finally { Pop-Location } }
    }
}

Write-Host "`n=== СВОДКА ===" -ForegroundColor Green
if ($script:failed.Count -eq 0) { Write-Host "Всё зелёное." -ForegroundColor Green; exit 0 }
Write-Host "Упало: $($script:failed -join ', ')" -ForegroundColor Red
exit 1
