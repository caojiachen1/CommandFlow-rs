#!/usr/bin/env bash
set -euo pipefail

echo "[CommandFlow-rs] Installing frontend dependencies..."
npm install

echo "[CommandFlow-rs] Building frontend..."
npm run build

echo "[CommandFlow-rs] Building Tauri app..."
cd src-tauri
cargo build --release
