#!/usr/bin/env bash
set -euo pipefail

check_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[missing] $1"
    return 1
  fi
  echo "[ok] $1"
}

check_bin node
check_bin npm
check_bin rustc
check_bin cargo
