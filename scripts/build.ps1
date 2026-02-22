$ErrorActionPreference = 'Stop'
Write-Host '[CommandFlow-rs] Installing frontend dependencies...'
npm install

Write-Host '[CommandFlow-rs] Building frontend...'
npm run build

Write-Host '[CommandFlow-rs] Building Tauri app...'
Push-Location src-tauri
cargo build --release
Pop-Location
