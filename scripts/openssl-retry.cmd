@echo off
setlocal
set PATH=C:\msys64\usr\bin;C:\msys64\mingw64\bin;%PATH%
set SRC=C:\PROJECT\by GrillCodE\VaultBase\manager-work\src-tauri\target\debug\build\openssl-sys-260bfb46f28a4cac\out\openssl-build\build\src
set LOG=C:\Users\Giganame\AppData\Local\Temp\openssl-retry.log
echo === retry build_libs === > %LOG%
set TRY=0
:retry
set /a TRY+=1
echo --- try %TRY% --- >> %LOG%
cmd /c "set PATH=C:\msys64\usr\bin;C:\msys64\mingw64\bin;%PATH%&& cd /d %SRC% && make build_libs" >> %LOG% 2>&1
if %ERRORLEVEL%==0 goto :done
if %TRY% GEQ 200 goto :fail
goto :retry
:done
echo RESULT=OK tries=%TRY% >> %LOG%
goto :eof
:fail
echo RESULT=FAIL tries=%TRY% >> %LOG%
