# Qwen Local Desktop

Qwen 모델을 로컬에서 실행하는 Linux 데스크톱 채팅 앱입니다.

프로젝트 폴더의 파일을 대화에 첨부하고, PDF와 스크린샷을 읽으며, 대화 기록을 기기에 저장합니다.

## Install

Ubuntu/Linux x64 소스 빌드입니다. Node.js와 Rust, Tauri Linux 빌드 환경이 필요합니다.

```sh
npm install
```

모델과 CPU/CUDA 실행 파일은 저장소에 포함하지 않습니다. [런타임 준비 안내](INFERENCE_INTEGRATION_PLAN.md)에 따라 로컬 파일을 배치해야 합니다. 현재 공개 릴리스 패키지는 없습니다.

## Quickstart

런타임 파일을 준비한 뒤 저장소 루트에서 실행합니다.

```sh
npx tauri dev
```

프로젝트 폴더를 열고 `@file`로 파일을 선택해 대화에 넣습니다. 스크린샷은 `Ctrl+V`로 붙여넣습니다.

## 대화와 파일

- **로컬 추론:** `llama.cpp`로 Qwen 모델을 실행하고 응답을 스트리밍합니다.
- **프로젝트 문맥:** 파일 트리와 `.gitignore`를 반영한 검색으로 필요한 파일을 찾습니다.
- **첨부 읽기:** 텍스트·소스·Markdown·JSON·CSV·PDF와 스크린샷 OCR을 지원합니다.
- **변경 검토:** 파일 수정은 diff를 확인하고 직접 적용합니다.

PDF에는 `pdftotext`, 스크린샷에는 한국어·영어 Tesseract가 필요합니다. 대화 기록은 로컬 SQLite에 저장합니다.

## 모델

현재 번들 설정은 `Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`를 사용합니다. CUDA 경로와 CPU 폴백을 구분하며, 소스 빌드에 필요한 파일 경로는 [설정 파일](src-tauri/tauri.conf.json)에 있습니다.

[빌드·검증 안내](CONTRIBUTING.md) · [화면 설계](DESIGN.md)

## License

저장소 자체의 공개 라이선스는 지정되지 않았습니다. 모델과 동봉 런타임에는 각 배포자의 조건이 적용됩니다.
