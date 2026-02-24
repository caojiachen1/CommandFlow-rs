# CommandFlow-rs

A cross-platform desktop automation workflow editor built with **Tauri v2, Rust, React 19, and React Flow v12**.

> ⚠️ This project is intended for office automation and test automation; it is not suitable for game automation scenarios.

## Implemented core features

- Node drag-and-drop and edge editing (React Flow)
- Left node toolbox / central canvas / right properties and log panels
- Keyboard shortcuts (run, stop, undo, redo, delete, copy)
- Workflow JSON export
- Tauri v2 Rust backend command skeleton (execute, save, load, coordinate picker)

## Tech stack

- Frontend: React 19, TypeScript, Vite, TailwindCSS, Zustand, @xyflow/react
- Desktop: Tauri 2
- Backend: Rust 1.75+
- Automation: enigo, scrap, opencv-rust, image (includes module scaffolding)

## Getting started

```text
npm install
npm run dev
npm run tauri dev
```

## Project structure

- `src/`: frontend UI, nodes, state, types
- `src-tauri/`: Rust command layer, automation engine, workflow models, permission configuration
- `scripts/`: build scripts and dependency checks