mkdir msix
copy .\src-tauri\target\release\commandflow-rs.exe .\msix
copy .\appxmanifest.xml .\msix
xcopy /E /I .\icons .\msix\icons
winapp cert generate --if-exists skip
winapp pack .\msix --cert .\devcert.pfx
@REM sudo winapp cert install .\devcert.pfx
rm -rf .\msix