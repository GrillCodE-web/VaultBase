@echo off
set PATH=C:\msys64\usr\bin;C:\msys64\mingw64\bin;%PATH%
cd /d "C:\PROJECT\by GrillCodE\VaultBase\manager-work\src-tauri"
echo === openssl-sys probe === > "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log" 2>&1
cargo build -p openssl-sys >> "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log" 2>&1
echo OPENSSL_EXIT=%ERRORLEVEL% >> "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log"
if ERRORLEVEL 1 goto :end
echo === cargo test === >> "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log"
cargo test >> "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log" 2>&1
echo TEST_EXIT=%ERRORLEVEL% >> "C:\Users\Giganame\AppData\Local\Temp\cargo-final.log"
:end
