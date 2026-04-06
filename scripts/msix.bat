if not exist .\src-tauri\target\release\commandflow-rs.exe (
    echo Executable not found. Running build...
    npm run tauri build
)

if not exist devcert.pfx (
    echo Certificate not found. Generating and installing...
    winapp cert generate
    winapp cert install .\devcert.pfx
)

if exist msix rm -rf msix
mkdir msix
copy .\src-tauri\target\release\commandflow-rs.exe .\msix
copy .\appxmanifest.xml .\msix
xcopy /E /I .\icons .\msix\icons
winapp pack .\msix --cert .\devcert.pfx
rm -rf .\msix