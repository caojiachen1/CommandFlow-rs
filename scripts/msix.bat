mkdir msix
copy .\src-tauri\target\release\commandflow-rs.exe .\msix
winapp cert generate --if-exists skip
winapp pack .\msix --cert .\devcert.pfx
@REM sudo winapp cert install .\devcert.pfx
rm -rf .\msix