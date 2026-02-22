# CommandFlow-rs

基于 **Tauri v2 + Rust + React 19 + React Flow v12** 的跨平台桌面自动化工作流编辑器。

> ⚠️ 本项目用于办公自动化与测试自动化，不适用于游戏自动化场景。

## 已实现基础能力

- 节点拖放与连线编辑（React Flow）
- 左侧节点工具箱 / 中央画布 / 右侧属性与日志面板
- 深色/浅色/系统主题切换并持久化
- 快捷键（运行、停止、撤销、重做、删除、复制）
- 工作流 JSON 导出
- Tauri v2 Rust 后端命令骨架（执行、保存、加载、坐标拾取）

## 技术栈

- 前端：React 19、TypeScript、Vite、TailwindCSS、Zustand、@xyflow/react
- 桌面：Tauri 2
- 后端：Rust 1.75+
- 自动化：enigo、scrap、opencv-rust、image（含模块骨架）

## 启动方式

```text
npm install
npm run dev
npm run tauri dev
```

## 目录

- `src/`：前端 UI、节点、状态、类型
- `src-tauri/`：Rust 命令层、自动化引擎、工作流模型、权限配置
- `scripts/`：构建脚本与依赖检查

## 隐私与安全

- 截图与图像匹配默认本地处理，不上传云端。
- 建议生产使用时加上 failsafe 紧急停止热键与权限提示。
