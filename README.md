# CommandFlow-rs

A **Windows-only** desktop automation workflow editor built with **Tauri v2, Rust, React 19, and React Flow v12**.

> ⚠️ This project is intended for office automation and test automation; it is not suitable for game automation scenarios.
> 
> **Only Windows is supported at this time.** Other operating systems are not supported.

## Implemented core features

- Node drag-and-drop and edge editing (React Flow)
- Left node toolbox / central canvas / right properties and log panels
- Keyboard shortcuts (run, stop, undo, redo, delete, copy)
- Workflow JSON export
- Tauri v2 Rust backend command skeleton (execute, save, load, coordinate picker)

## TODO List

### 1. Element Identification
- [ ] UI object/control recognition (Accessibility APIs: UIA/MSAA/Java Access Bridge)
- [x] Image matching (template matching + similarity threshold; real-time polling via xcap stream)
- [ ] OCR (screen text recognition; not implemented)

### 2. Input Simulation
- [x] Mouse: move/click/double-click/drag/scroll (enigo + SendInput)
- [x] Keyboard: key press/combos/hotkey listening (enigo + virtual keys)
- [ ] IME compatibility (input method candidate selection / clipboard paste)
- [ ] Message-level sending (PostMessage/SendMessage; current uses driver-level SendInput)

### 3. Flow Control & Logic
- [x] Sequential execution (node executor)
- [x] Conditional branching (If/Else node)
- [x] Looping (Loop/While nodes)
- [ ] Exception handling (Try/Catch node)
- [x] Waiting (Delay node, image-match polling, hotkey wait)

### 4. Data Scraping & Manipulation
- [ ] Structured data extraction (tables/Excel/Web table)
- [ ] OCR + regex extraction (text parsing from screenshots)
- [x] Regex/text parsing (LLM output parsing, etc.)
- [x] Clipboard read/write and variable transfer

### 5. Stability Mechanisms
- [ ] Anchor-based positioning (anchor-based targeting)
- [x] Retry logic (e.g., xcap stream recover)
- [ ] Resolution/DPI adaptation
- [ ] Popup handling (global listener / auto-dismiss system dialogs)

## Tech stack

- Frontend: React 19, TypeScript, Vite, TailwindCSS, Zustand, @xyflow/react
- Desktop: Tauri 2
- Backend: Rust 1.75+
- Automation: enigo, scrap, opencv-rust, image (includes module scaffolding)

## Getting started

```text
npm install
npm run tauri dev
```