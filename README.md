# Qwen Local Desktop

Offline-first Linux desktop AI workspace that combines a ChatGPT-style chat experience with Codex-like project context. It runs the fixed Qwen 4B GGUF model locally through `llama.cpp`; no account, cloud API, or external OCR service is required.

## Highlights

- Native Tauri 2 desktop app for Ubuntu/Linux x64
- Streaming local inference with CUDA and CPU fallback
- Project folder picker, lazy file tree, `.gitignore`-aware search, and `@file` context
- Local SQLite conversation history with project-scoped chats and search
- TXT/source/Markdown/JSON/CSV/PDF attachments
- Clipboard screenshot paste (`Ctrl+V`) with local English/Korean Tesseract OCR
- Markdown, syntax highlighting, tables, and KaTeX math rendering
- Safe file editing: `Edit → Preview diff → Apply changes`, stale-preview and symlink protection
- Live project filesystem refresh and persistent project/conversation renaming
- Explicitly excludes q4_0/q4_1 KV cache; K/V cache remains f16

## Architecture

```text
React + TypeScript UI
        │ Tauri invoke/events
Rust desktop backend ── SQLite / project search index
        │
llama.cpp llama-server ── fixed Qwen GGUF model
```

The AI never edits files or executes commands autonomously. Manual edits require a visible diff and explicit approval, then are written atomically after an expected-content check.

## Model and runtime payload

The application is optimized for:

`Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`

The local checkout used the accepted Q4_K_M artifact at `models/Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`. The model and compiled CPU/CUDA sidecars are intentionally ignored because GitHub rejects files of this size. Release packages contain the complete runtime payload; source builds need the model and sidecars supplied locally.

## Development

Ubuntu/Linux prerequisites:

- Node.js 22+
- Rust stable and Tauri Linux prerequisites
- `pdftotext` for PDF extraction
- `tesseract-ocr`, `tesseract-ocr-eng`, and `tesseract-ocr-kor` for screenshot OCR
- NVIDIA driver/CUDA is optional; CPU fallback is supported

```bash
npm install
npm test
npx tauri dev
```

`npm test` runs the production frontend build, TypeScript utility tests, Rust tests, and the SSE/context/diff regression suite. `npx tauri build --bundles deb` creates a Debian package. AppImage creation may require the local linuxdeploy fallback documented in `INFERENCE_INTEGRATION_PLAN.md`.

## Documentation

- [DESIGN.md](DESIGN.md) — reference-fidelity desktop UI specification
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — sequential implementation and verification record
- [INFERENCE_INTEGRATION_PLAN.md](INFERENCE_INTEGRATION_PLAN.md) — llama.cpp, packaging, offline, and runtime validation record

## Portfolio notes

This project demonstrates local AI product engineering across a native desktop shell, Rust process lifecycle management, SQLite persistence, bounded code retrieval, offline OCR/PDF processing, streaming SSE UX, and safety-gated code editing. The UI intentionally uses original Qwen Local branding and open-source/icon-text primitives rather than proprietary Codex assets.
