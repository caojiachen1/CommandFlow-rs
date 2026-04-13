# Linux Build Guide

## System Requirements

This guide requires Ubuntu 24.04 or later.

## Dependencies

```bash
sudo apt install \
  libwayland-dev \
  pkg-config \
  libssl-dev \
  libglib2.0-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev \
  libspa-0.2-dev \
  libpipewire-0.3-dev \
  libclang-dev \
  libudev-dev \
  libgbm-dev \
  libxdo-dev \
  xdotool -y
```

## Build Steps

### Development Mode

```bash
npm run tauri dev
```

### Release Build

```bash
npm run tauri build
```

## Notes

> **Note**: Current Linux build support is only a placeholder implementation and lacks complete functionality. System operation features are still missing and will be improved over time.
