# Linux 编译指南

## 系统依赖

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

## 编译步骤

### 开发模式

```bash
npm run tauri dev
```

### 发布构建

```bash
npm run tauri build
```

## 说明

> **注意**：当前 Linux 编译支持仅为占位实现，缺少实际功能实现。缺少系统操作相关的功能，后续将尽可能改善。
