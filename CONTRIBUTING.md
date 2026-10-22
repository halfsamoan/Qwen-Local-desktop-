# Development and verification

## Prerequisites

- Ubuntu/Linux x64 and Node.js 22 or newer.
- Rust and the Tauri Linux build prerequisites.
- `pdftotext` for PDF extraction.
- Tesseract with English and Korean language data for screenshot OCR.
- An NVIDIA driver and compatible CUDA runtime for the optional GPU path.

## Runtime payload

The bundle configuration references:

| Source path | Bundle destination |
|---|---|
| `models/Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf` | `inference/model.gguf` |
| `src-tauri/resources/inference/cpu/` | `inference/cpu/` |
| `src-tauri/resources/inference/cuda/` | `inference/cuda/` |

Supply the model and compiled sidecars locally before running the native application. They are intentionally excluded from Git. There is no published release package containing these files.

## Run and validate

```sh
npm install
npm test
npx tauri dev
```

`npm test` runs the frontend build and the TypeScript, SSE, context, and diff regression tests declared in `package.json`. Rust checks are separate:

```sh
cd src-tauri
cargo test
```

## Packaging

From the repository root:

```sh
npx tauri build --bundles deb
```

The Tauri configuration also declares AppImage output. Packaging still requires the complete local runtime payload and compliance with model and runtime distribution terms.

## Component boundaries

The React interface communicates through Tauri commands and events with a Rust backend. The backend owns SQLite persistence, project retrieval, filesystem checks, and the inference process. `llama-server` performs inference.

Reviewed edits check the expected original content and reject stale previews or unsafe path resolution before writing. Validate model startup, CPU fallback, interrupted streams, offline attachments, and file-edit rejection paths on the target Linux installation; a frontend test pass alone does not cover them.
