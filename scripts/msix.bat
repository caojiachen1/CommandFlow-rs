@echo off
where winapp >nul 2>&1
if %errorlevel% neq 0 (
    echo winapp command not found. Installing Microsoft.WinAppCli...
    winget install Microsoft.WinAppCli --accept-source-agreements --accept-package-agreements
)

if not exist .\src-tauri\target\release\commandflow-rs.exe (
    echo Executable not found. Running build...
    npm run tauri build
)

if not exist devcert.pfx (
    echo Certificate not found. Generating and installing...
    winapp cert generate
    sudo winapp cert install .\devcert.pfx
)

if exist msix rmdir /s /q msix
mkdir msix
copy .\src-tauri\target\release\commandflow-rs.exe .\msix
copy .\appxmanifest.xml .\msix
xcopy /E /I .\icons .\msix\icons
winapp pack .\msix --cert .\devcert.pfx
rmdir /s /q .\msix