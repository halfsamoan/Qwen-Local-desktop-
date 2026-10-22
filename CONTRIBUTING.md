# 개발·검증 참고

[프로젝트 소개](README.md)

기존 README의 상세 실행·검증 내용을 이 문서로 옮겼습니다. 과거 실행 기록은 당시 환경의 결과이며 새 검증 결과를 뜻하지 않습니다.

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

The local checkout used the accepted Q4_K_M artifact at `models/Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`. The model and compiled CPU/CUDA sidecars are intentionally ignored because GitHub rejects files of this size. Source builds need the model and sidecars supplied locally. No public release package is currently available.

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

`npm test` runs the frontend build, TypeScript utility tests, and the SSE/context/diff regression suite. Run Rust tests separately with `cargo test` from `src-tauri/`. `npx tauri build --bundles deb` creates a Debian package. AppImage creation may require the local linuxdeploy fallback documented in `INFERENCE_INTEGRATION_PLAN.md`.

## Documentation

- [DESIGN.md](DESIGN.md) — reference-fidelity desktop UI specification
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — sequential implementation and verification record
- [INFERENCE_INTEGRATION_PLAN.md](INFERENCE_INTEGRATION_PLAN.md) — llama.cpp, packaging, offline, and runtime validation record
