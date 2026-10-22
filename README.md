# Qwen Local Desktop

A Linux desktop application for local Qwen inference, project-aware conversations, and reviewed file edits.

## Implementation

- **Inference lifecycle:** runs `llama.cpp` through a Rust backend, streams responses to the Tauri interface, and supports CUDA with a CPU fallback.
- **Project context:** provides a lazy file tree, `.gitignore`-aware search, and `@file` selection to keep retrieved context bounded.
- **Local document input:** extracts text from source files and PDFs and applies English/Korean Tesseract OCR to pasted screenshots.
- **Reviewed writes:** requires a visible diff and user approval, then checks expected content before writing files atomically.

Conversations and project history are stored in local SQLite. The model does not autonomously edit files or execute shell commands.

[Rust backend](src-tauri/src/main.rs) · [Project context](src/projectContext.ts) · [Diff logic](src/textDiff.ts)

## Run

Requires Ubuntu/Linux x64, Node.js, Rust, and the Tauri Linux prerequisites.

```sh
npm install
npx tauri dev
```

Before starting, supply the model and CPU/CUDA sidecars at the paths declared in [tauri.conf.json](src-tauri/tauri.conf.json). Those binaries are not included in the repository. PDF input requires `pdftotext`; screenshot OCR requires English and Korean Tesseract language data.

## Runtime scope

The current bundle targets `Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`. There is no public release package. Source availability and desktop implementation do not by themselves establish inference performance on another device.

[Development and verification](CONTRIBUTING.md)

## License

No repository-wide open-source license is specified. Models and bundled runtime components retain their own distribution terms.
