# Qwen Local — 실제 모델 통합 및 안정화 계획

작성일: 2026-09-07  
대상: Ubuntu Linux x86_64 단일 사용자 데스크탑 앱  
고정 모델: `Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`  
모델 SHA-256: `528639d25ec2ebd81f68dbc508f4dbdb2f9fa314cddbcf0c3512e34281ecd7a8`  
모델 크기: `2,497,280,256 bytes`

## 1. 현재 판정

개발 소스 트리에서는 CPU `llama-server`와 GGUF를 찾아 실행할 수 있지만, 현재 만들어진 AppImage를 **실제 모델 통합 완료 상태로 볼 수는 없다**.

가장 큰 이유는 다음 세 가지다.

1. Tauri가 번들 리소스의 원래 상대 경로를 보존하는데 Rust 코드는 파일이 리소스 루트에 바로 있다고 가정한다.
2. 현재 패키지는 CUDA 빌드가 아니라 CPU 전용 `llama-server`를 포함한다.
3. `/health`가 끝까지 실패해도 프런트엔드가 무조건 `Ready`로 바뀐다.

따라서 기존 PHASE 7을 아래의 7A–7E로 나누어 순차 진행한다. 각 단계가 완료되기 전에는 다음 단계를 구현하지 않는다.

## 2. 확인된 환경

| 항목 | 확인값 |
|---|---|
| GPU | NVIDIA GeForce RTX 3050 Laptop GPU |
| VRAM | 4096 MiB |
| Compute Capability | 8.6 |
| NVIDIA Driver | 595.84 |
| llama.cpp | `0.4.0-dev`, commit `7620399` |
| CPU 빌드 | 실행 가능, 약 22 MB |
| CUDA 빌드 | 실행 가능, 약 209 MB |
| CUDA 빌드 아키텍처 | 현재 `75` — GPU의 `86`과 불일치 |
| 기본 Context | 8192 |
| KV cache | f16 유지 |

## 3. 기능 문제와 우선순위

| ID | 우선순위 | 문제 | 근거 | 영향 |
|---|---:|---|---|---|
| QI-01 | Blocking | 패키지 리소스 경로 불일치 | 번들에는 `_up_/models/...`와 `_up_/.phase0/...`로 들어가지만 `main.rs`는 리소스 루트의 `llama-server`와 GGUF를 찾음 | 설치된 앱에서 모델/서버를 찾지 못할 수 있음 |
| QI-02 | Blocking | AppImage가 CPU 서버를 번들함 | `tauri.conf.json`이 `.phase0/llama-build`를 지정 | GPU Mode를 바꿔도 실제 CUDA 추론 불가 |
| QI-03 | Blocking | 거짓 `Ready` 상태 | 초기화·재시작·재시도 루프가 성공 여부를 확인하지 않고 종료 후 `Ready` 설정 | 모델이 죽었거나 로드 실패해도 전송 UI가 활성화됨 |
| QI-04 | Critical | CUDA 아키텍처 불일치 | CUDA 서버가 `CMAKE_CUDA_ARCHITECTURES=75`, 실제 GPU는 8.6 | 실행 실패 또는 성능 저하 가능 |
| QI-05 | Critical | 프로세스 수명주기 보장이 약함 | React cleanup에 종료를 의존하고 Tauri 종료 이벤트 처리가 없음 | 비정상 종료 후 고아 프로세스/포트 점유 가능 |
| QI-06 | Critical | 고정 포트 충돌을 구분하지 못함 | 항상 `127.0.0.1:18080`; 기존 서버 식별 없음 | 다른 프로세스를 Qwen 백엔드로 오인 가능 |
| QI-07 | High | CUDA 런타임 의존성이 패키지 정책에 없음 | CUDA 서버가 시스템 `libcudart`, `libcublas`, `libcuda`에 동적 링크 | 다른 설치 상태에서 시작 실패 원인을 알기 어려움 |
| QI-08 | High | 자식 프로세스 사망 감지가 늦음 | `start_backend`를 다시 호출할 때만 `try_wait` 확인 | 실행 중 서버 사망 후 UI 상태가 오래 잘못 유지됨 |
| QI-09 | High | SSE 파서가 마지막 이벤트를 잃을 수 있음 | 개행 없는 마지막 buffer를 처리하지 않으며 JSON 1건 오류가 전체 요청을 중단 | 응답 끝부분 누락 또는 불필요한 Error |
| QI-10 | Medium | 진단 메시지가 너무 일반적임 | UI에는 `Local backend unavailable.`만 표시 | 모델 없음, CUDA, VRAM, 포트 문제를 사용자가 구분 못함 |
| QI-11 | Medium | 백엔드 로그가 무제한 누적됨 | `backend.log`를 매 실행 append | 장기 사용 시 불필요한 디스크 증가 |
| QI-12 | Medium | 릴리스가 고정 모델임을 검증하지 않음 | 파일 존재만 확인하고 checksum/메타데이터 미검증 | 다른 GGUF가 같은 이름으로 바뀌어도 감지 못함 |

## 4. 최소 구현 원칙

- 모델 선택기, 모델 다운로드기, 로그인, 외부 API는 만들지 않는다.
- GGUF는 AppImage/deb에 포함하고 인터넷 없이 실행한다.
- 개발용 `.phase0` 경로를 릴리스가 참조하지 않게 한다.
- CUDA와 CPU 실행 파일은 둘 다 포함한다. 기본은 CUDA, 실패 시 CPU fallback과 명확한 경고를 사용한다.
- `Balanced=CUDA auto`, `Maximum Performance=CUDA all`, `Low GPU Usage=CPU`로만 매핑한다.
- Context는 기본 8192이며 설정 변경 시 실제 `-c` 값으로 재시작한다.
- **KV cache q4_0/q4_1은 이 계획에서도 제외한다. f16만 사용한다.**
- 직접 loopback HTTP 구조는 유지한다. Rust 프록시나 별도 daemon은 현재 필요 없다.
- 포트는 18080을 유지하되 시작 전에 충돌을 검사한다. 동적 포트는 실제 충돌 사례가 반복될 때만 추가한다.

## 5. 순차 실행 계획

### PHASE 7A — 릴리스 리소스 계약 수정

목표: 소스 트리 fallback 없이도 패키지 안에서 서버와 모델을 정확히 찾는다.

구현 범위:

1. CPU/CUDA 실행 파일과 llama.cpp 공유 라이브러리를 `.phase0`가 아닌 안정된 `src-tauri/resources/inference/` 아래에 둔다.
2. Tauri `bundle.resources`의 source→target map을 사용해 패키지 경로를 고정한다.
   - `inference/model.gguf`
   - `inference/cuda/llama-server` 및 필요한 llama/ggml `.so`
   - `inference/cpu/llama-server` 및 필요한 llama/ggml `.so`
3. Rust에 하나의 리소스 경로 해석 함수만 두고 start/restart/진단이 모두 이를 사용하게 한다.
4. 릴리스 빌드에서는 `QWEN_MODEL`, `QWEN_LLAMA_SERVER`, 소스 트리 fallback을 사용하지 않는다. 환경 변수 override는 debug 빌드에만 남긴다.
5. 모델 SHA-256을 릴리스 준비 단계에서 확인한다. 매 시작마다 2.5 GB를 해시하지 않고, 패키징 검사에서 한 번 검증한다.

검증:

- 프런트엔드 build와 Rust tests 통과.
- AppImage 생성 후 `unsquashfs` 목록에서 위 네 종류 리소스 확인.
- AppImage를 저장소 밖 임시 디렉터리로 복사하고 환경 변수 없이 실행.
- 소스의 `.phase0`와 `models/`에 의존하지 않는 것을 확인.

완료 기준:

- 패키지 내부 서버와 모델 경로가 자동 테스트로 검증됨.
- 누락 파일은 시작 전에 구체적인 GUI 오류로 반환됨.
- Blocking 이슈 QI-01, QI-02가 0건.

### PHASE 7B — 시작·준비·종료 상태 신뢰성

목표: UI 상태와 실제 `llama-server` 상태가 항상 일치한다.

구현 범위:

1. App.tsx의 중복된 세 개 health loop를 하나의 `waitForBackend()`로 합친다.
2. deadline 안에 `/health`가 성공한 경우에만 `Ready`로 전환하고, 시간 초과나 자식 종료 시 `Error`로 전환한다.
3. 시작 전에 18080 포트 점유를 검사하고, 점유 중이면 다른 서버를 신뢰하지 않고 충돌 오류를 표시한다.
4. Rust `backend_status` 명령으로 child의 실행/종료 상태와 마지막 오류를 반환한다.
5. Tauri 종료 이벤트에서 반드시 child를 kill/wait한다. React cleanup은 보조 경로로만 유지한다.
6. backend 재시작 때 이전 프로세스가 완전히 종료된 뒤 새 프로세스를 시작한다.
7. `backend.log`는 시작할 때 비워 최신 실행만 보존한다.

검증:

- 정상 시작 → `Starting` → `Ready`.
- 잘못된 모델 경로 → `Error`, `Ready`로 바뀌지 않음.
- 18080을 다른 프로세스가 점유 → 포트 충돌 오류.
- 서버 강제 종료 → 앱이 사망 상태를 감지하고 Retry로 복구.
- 앱 종료 후 `llama-server` 프로세스가 남지 않음.

완료 기준:

- Blocking QI-03과 Critical QI-05, QI-06 해결.
- Stop/Error 이후 새 요청 또는 Retry가 정상 동작.

### PHASE 7C — RTX 3050 CUDA 통합

목표: 현재 호스트에서 8192 context의 실제 GPU 추론이 동작하고 CPU fallback도 보존된다.

구현 범위:

1. 동일 llama.cpp commit `7620399`를 `CMAKE_CUDA_ARCHITECTURES=86`으로 다시 빌드한다.
2. CUDA 서버와 필요한 llama/ggml `.so`를 PHASE 7A의 안정된 리소스 경로에 반영한다.
3. 현재 단일 사용자 환경에서는 설치된 NVIDIA driver/CUDA 12 runtime을 시스템 요구사항으로 사용한다. CUDA toolkit 전체를 앱에 복제하지 않는다.
4. CUDA 실행/모델 로드가 실패하면 CPU 서버로 한 번 fallback하고 UI에 `CPU fallback` 이유를 표시한다.
5. 세 GPU 프로필이 실제 실행 인자로 적용되는지 로그로 검증한다.
6. 로그에서 실제 context, GPU offload layer 수, backend 종류를 진단 화면에 표시한다.

검증:

- Maximum Performance: CUDA 장치 인식, offloaded layer 1개 이상, context 8192, 스트리밍 1회 성공.
- Balanced: `-ngl auto`, context 8192, 스트리밍 1회 성공.
- Low GPU Usage: CPU 경로, 스트리밍 1회 성공.
- CUDA 의도적 실패: CPU fallback 후 응답 성공.
- `nvidia-smi`로 실행 중 VRAM 사용 증가를 확인하되 임의 성능 목표치는 두지 않는다.

완료 기준:

- RTX 3050에서 실제 CUDA 응답 확인.
- 설정값과 실제 실행 인자가 일치.
- QI-04, QI-07 해결.

### PHASE 7D — 스트리밍과 중지 안정화

목표: 응답 끝부분, 중지, 재전송이 유실 없이 동작한다.

구현 범위:

1. 기존 SSE buffer 로직을 작은 순수 함수로 분리해 CRLF, 여러 event, 마지막 무개행 event, `[DONE]`을 처리한다.
2. 형식이 잘못된 단일 event는 기록하고 건너뛰되 정상 event 전체를 버리지 않는다.
3. Stop 시 HTTP 요청을 abort하고 생성된 부분 응답만 한 번 저장한다.
4. Stop 직후 입력과 재전송을 허용하며 backend 준비 상태는 유지한다.
5. 스트림이 장시간 아무 데이터도 내지 않을 때만 idle timeout으로 중단하고 재시도 안내를 표시한다.

검증:

- chunk 경계가 JSON 중간에 생기는 SSE 테스트.
- 마지막 개행 없는 event 테스트.
- 생성 중 Stop → 부분 답변 저장 → 즉시 다음 질문 성공.
- server disconnect → Error → Retry → 스트리밍 성공.

완료 기준:

- QI-09 해결.
- 기존 대화 저장, 프로젝트 context, 첨부 context 회귀 없음.

### PHASE 7E — Linux 패키지 및 완전 오프라인 인수 시험

목표: 실제 배포물 하나로 앱 실행부터 종료까지 통과한다.

구현 범위:

1. Linux AppImage와 deb를 만든다. Windows 산출물은 만들지 않는다.
2. 패키지에 고정 GGUF, CPU/CUDA 서버, 필요한 llama/ggml 공유 라이브러리가 들어 있는지 검사한다.
3. 저장소 밖에서 AppImage를 실행해 개발 경로 fallback이 없음을 확인한다.
4. 네트워크를 끈 상태에서 모델 로딩, 채팅, 프로젝트 읽기, 대화 저장을 확인한다.
5. 오류 유형을 모델 없음/CUDA 실패/VRAM 부족/포트 충돌/프로세스 종료로 구분해 GUI에 표시한다.

최종 smoke test:

```text
AppImage 실행
→ Loading
→ Qwen Ready
→ 일반 질문 전송
→ 첫 토큰 스트리밍
→ Stop
→ 새 질문 성공
→ Context 8192 확인
→ Balanced에서 CUDA offload 확인
→ 앱 종료
→ llama-server 잔류 프로세스 0
→ 앱 재실행
→ 이전 대화 복원
```

완료 기준:

- AppImage/deb build 성공.
- 자동 tests와 위 smoke test 성공.
- 인터넷 연결 없이 핵심 경로 성공.
- 알려진 Blocking/Critical 이슈 0건.

## 6. 각 단계 공통 보고 형식

각 단계가 끝나면 아래 보고서를 작성하고 다음 단계로 자동 진행하지 않는다.

```text
PHASE 7X STATUS
Build: PASS / FAIL
Tests: PASS / FAIL
Smoke Test: PASS / FAIL
Regression: PASS / FAIL
Blocking Issues: number
Known Non-blocking Issues: list
Files Changed: list
Next Phase: PHASE 7Y
```

## 7. 이번 계획에서 제외한 항목

- Windows 패키징: 현재 사용자가 Linux만 사용하므로 제외.
- 다중 모델, 모델 선택 UI, 자동 다운로드: 고정 모델·완전 오프라인 원칙과 맞지 않음.
- 벡터 DB/embedding/Tree-sitter: 모델 실행 안정화와 무관하며 현재 lexical retrieval로 충분.
- KV q4_0/q4_1: 사용자 결정에 따라 명시적으로 제외.
- 동적 포트, 별도 daemon, Rust HTTP proxy: 고정 포트 충돌 검사로 해결되지 않는 사례가 확인될 때 추가.
- CUDA toolkit 전체 번들: 현재 호스트에 CUDA 12 runtime이 설치되어 있어 불필요. 다른 PC 배포가 목표가 될 때 재검토.
- 토큰/초 단위 성능 최적화: 먼저 정상 로드·스트리밍·중지·복구를 통과한 뒤 측정값이 나쁠 때만 진행.

## 8. 시작점

다음 구현 단계는 **PHASE 7A — 릴리스 리소스 계약 수정**이다. 7A 완료 보고와 사용자 확인 전에는 7B를 시작하지 않는다.

## PHASE 7A 완료 보고 — 2026-09-07

고정된 패키지 리소스 경로를 적용했다. GGUF는 `inference/model.gguf`, CPU/CUDA llama.cpp 파일은 각각 `inference/cpu/`와 `inference/cuda/`에 들어간다. 릴리스 코드는 이 경로만 사용하며 개발 환경 변수와 `.phase0` fallback은 debug 빌드에만 남겼다.

AppImage와 deb를 실제 생성해 검사했다. 두 패키지 모두 모델이 정확히 한 번 포함되고 이전 `_up_` 경로는 포함되지 않는다. AppImage 내부 GGUF SHA-256은 계획서 상단의 고정값과 일치했으며, 패키지에서 추출한 CPU/CUDA `llama-server`가 모두 `--version` 실행에 성공했다.

```text
PHASE 7A STATUS
Build: PASS — frontend, Tauri debug desktop, deb, AppImage
Tests: PASS — npm test, cargo fmt, Rust 5/5
Smoke Test: PASS — AppImage model/server paths, checksum, executable checks
Regression: PASS — existing SQLite/project/search tests and frontend build
Blocking Issues: 0
Known Non-blocking Issues:
- CUDA 파일은 아직 compute 75 빌드이며 PHASE 7C에서 compute 86으로 교체·실행 검증한다.
- 현재 start_backend는 CPU 경로를 사용한다. GPU 프로필 연결은 PHASE 7C 범위다.
- 이 호스트의 일반 AppImage 빌드에는 librsvg2-dev가 필요하다. 이번 검증은 동일 버전 패키지의 pkg-config 파일을 임시로 사용했다.
- 생성된 AppImage는 debug 검증 산출물이다. 최종 release 산출물은 PHASE 7E에서 만든다.
Files Changed:
- src-tauri/src/main.rs
- src-tauri/tauri.conf.json
- src-tauri/resources/inference/cpu/*
- src-tauri/resources/inference/cuda/*
- dist/*
- INFERENCE_INTEGRATION_PLAN.md
Next Phase: PHASE 7B — 시작·준비·종료 상태 신뢰성
```

PHASE 7B는 사용자 확인 전까지 시작하지 않는다.

## PHASE 7B 완료 보고 — 2026-09-07

백엔드 시작·준비·종료 경로를 하나로 정리했다. 프런트엔드는 `/health`만 반복 확인하지 않고 `backend_status`로 자식 프로세스의 생존 여부와 마지막 오류 로그를 함께 확인한다. 시작 중 서버가 죽으면 60초를 기다리지 않고 실제 종료 원인을 표시하며, 재시작 전 준비 상태도 초기화한다.

백엔드는 시작 전에 고정 포트 `127.0.0.1:18080` 충돌을 검사하고, 종료된 `Child` 핸들을 정리해 재시작할 수 있게 했다. 로그는 시작마다 `backend.log`로 새로 기록한다. 정상 종료는 공통 kill/wait 함수로 처리하며, Linux에서는 부모 앱이 비정상 종료되어도 `PR_SET_PDEATHSIG`로 `llama-server`가 함께 종료되도록 했다. 실제 데스크톱 앱 스모크에서 처음 발견된 고아 프로세스 문제를 수정한 뒤 동일 테스트를 통과했다.

```text
PHASE 7B STATUS
Build: PASS — frontend production build, Tauri debug desktop binary
Tests: PASS — cargo fmt, Rust 7/7, npm test
Smoke Test: PASS — desktop launch, bundled GGUF load, /health ok, app termination, llama-server orphan 0
Regression: PASS — SQLite, project tree/search, symlink exclusion, frontend build
Blocking Issues: 0
Known Non-blocking Issues:
- CUDA 실행 및 GPU 프로필 검증은 PHASE 7C 범위다. 현재 데스크톱 스모크는 CPU 백엔드를 사용한다.
- 스트리밍 parser·stall timeout·Stop 이후 재전송 검증은 PHASE 7D 범위다.
- 프런트엔드 번들은 500 kB 경고가 있으나 로컬 앱 실행을 막지 않는다.
Files Changed:
- src/App.tsx
- src-tauri/src/main.rs
- dist/*
- INFERENCE_INTEGRATION_PLAN.md
Next Phase: PHASE 7C — CUDA 활성화와 4GB VRAM 프로필 검증
```

PHASE 7C는 사용자 확인 전까지 시작하지 않는다.

## PHASE 7C 완료 보고 — 2026-09-07

llama.cpp 커밋 `7620399`를 RTX 3050의 compute capability 8.6으로 다시 빌드해 CUDA 리소스를 교체했다. Balanced와 Maximum Performance는 CUDA 서버, Low GPU Usage는 CPU 서버를 사용한다. context 값은 실제 `-c` 인자로 전달되며 KV cache는 계획대로 f16을 유지한다.

Balanced 실측은 26/37 layer offload, context 8192, VRAM 2,716 MiB였고 응답에 성공했다. Maximum Performance는 VRAM 3,698 MiB에서 응답했고, Low GPU Usage는 GPU 프로세스 없이 응답했다. `CUDA_VISIBLE_DEVICES=-1` 시험에서는 CUDA 경고를 감지한 뒤 CPU 서버로 한 번 fallback하여 다시 응답했다. 설정 화면에는 실제 backend 종류, context, offload/context 로그 요약을 표시한다.

```text
PHASE 7C STATUS
Build: PASS — CUDA compute 86 llama-server, frontend, Tauri debug desktop
Tests: PASS — Rust 7/7, npm test
Smoke Test: PASS — Balanced, Maximum Performance, Low GPU Usage, forced CPU fallback
Regression: PASS — app lifecycle, SQLite, project tree/search, frontend build
Blocking Issues: 0
Known Non-blocking Issues:
- Maximum Performance는 이 4GB GPU에서 약 3,698 MiB를 사용하므로 다른 GPU 앱과 병행할 때 Balanced를 권장한다.
- CUDA toolkit/runtime은 현재 시스템 설치본을 사용한다. 다른 배포 대상 PC 지원은 범위 밖이다.
- KV q4_0/q4_1은 사용자 결정대로 제외했다.
Files Changed:
- src/App.tsx
- src/styles.css
- src-tauri/src/main.rs
- src-tauri/resources/inference/cuda/*
- dist/*
- INFERENCE_INTEGRATION_PLAN.md
Next Phase: PHASE 7D — 스트리밍과 중지 안정화
```

## PHASE 7D 완료 보고 — 2026-09-07

SSE 처리를 순수 parser로 분리했다. CRLF, 여러 event, JSON 중간 chunk, `[DONE]`, 마지막 개행 없는 event를 처리하며 잘못된 단일 JSON event는 경고 후 건너뛴다. 각 stream read에는 60초 idle timeout을 적용했다.

Stop은 진행 중 HTTP 요청만 abort하고 이미 생성된 부분 답변을 한 번 저장한다. backend 준비 상태는 유지하므로 `Stopped` 직후 입력과 새 요청이 가능하다. 실제 CUDA 앱에서 887바이트까지 스트리밍된 요청을 중간 취소한 다음 두 번째 요청이 `RESEND OK`로 성공했고, 종료 후 서버 잔류도 없었다.

```text
PHASE 7D STATUS
Build: PASS — frontend production build, Tauri debug desktop
Tests: PASS — SSE parser 1/1, Rust 7/7, npm test
Smoke Test: PASS — streaming data, client abort, immediate second response, orphan 0
Regression: PASS — CUDA backend, SQLite, project context code path, frontend build
Blocking Issues: 0
Known Non-blocking Issues:
- idle timeout은 고정 60초다. 이 PC에서 실제 stall 사례가 확인될 때만 설정값으로 승격한다.
- 프런트엔드 번들 크기 경고는 로컬 데스크톱 기능을 막지 않는다.
Files Changed:
- src/App.tsx
- src/sse.js
- tests/sse.test.mjs
- package.json
- tsconfig.app.json
- dist/*
- INFERENCE_INTEGRATION_PLAN.md
Next Phase: PHASE 7E — Linux 패키지 및 완전 오프라인 인수 시험
```

## PHASE 7E 완료 보고 — 2026-09-07

Linux release AppImage와 deb를 생성했다. 두 패키지에는 고정 GGUF, CPU/CUDA llama-server, 필요한 llama/ggml 공유 라이브러리가 포함된다. AppImage 내부 모델 SHA-256은 고정값 `528639d25ec2ebd81f68dbc508f4dbdb2f9fa314cddbcf0c3512e34281ecd7a8`과 일치했다.

외부 네트워크 인터페이스가 없고 loopback만 존재하는 격리 환경에서 release AppImage를 실행해 `OFFLINE OK` 응답을 확인했다. 동일 데이터 디렉터리로 두 번 실행했을 때 대화 수가 `1 → 1`로 복원됐고 각 종료 후 `llama-server` 잔류는 0이었다. 최종 사용자 경로의 AppImage에서도 `READY TO USE` 스트리밍 응답과 CUDA 번들 실행을 확인했다. 모델 없음, 포트 충돌, VRAM/메모리 부족, CUDA 실패, backend 종료는 GUI에서 구분되는 문구로 표시한다.

앱 메뉴용 `/home/k/.local/share/applications/qwen-local.desktop`을 등록하고 validator를 통과했다. 터미널 없이 애플리케이션 메뉴에서 `Qwen Local`을 실행할 수 있다.

```text
PHASE 7E STATUS
Build: PASS — release AppImage and deb
Tests: PASS — SSE parser 1/1, Rust 7/7, npm test, desktop entry validation
Smoke Test: PASS — offline release response, CUDA streaming, persistence restart, orphan 0
Regression: PASS — CUDA/CPU fallback, SQLite, project tree/search, frontend build
Blocking Issues: 0
Known Non-blocking Issues:
- AppImage는 약 3.04GB, deb는 약 2.71GB다. 고정 2.5GB 모델과 CPU/CUDA 런타임을 모두 포함하기 때문에 예상된 크기다.
- frontend bundle 500kB 경고가 있으나 로컬 실행 기능에는 영향이 없다.
- release 재빌드 시 이 호스트에는 librsvg2-dev 메타데이터가 필요하지만, 완성된 앱 실행에는 필요하지 않다.
Files Changed:
- src/App.tsx
- src/styles.css
- src/sse.js
- tests/sse.test.mjs
- package.json
- tsconfig.app.json
- src-tauri/src/main.rs
- src-tauri/resources/inference/cuda/*
- dist/*
- Qwen_Local-x86_64.AppImage
- Qwen_Local_0.1.0_amd64.deb
- /home/k/.local/share/applications/qwen-local.desktop
- INFERENCE_INTEGRATION_PLAN.md
Next Phase: COMPLETE

## FINAL REVALIDATION — 2026-09-08

The release artifact was rebuilt after the final stability fixes and launched directly from the project-root AppImage. The bundled CUDA server reported `n_ctx_slot=8192`, used approximately 2,716 MiB on the RTX 3050, and answered a project-context prompt from the `wifi-viewer` README. A real Linux `Ctrl+V` image paste created a PNG attachment and extracted 1,437 characters with `eng+kor` Tesseract OCR; the smoke attachment was then removed.

The official Tauri clipboard-manager plugin is enabled with only `clipboard-manager:allow-read-image`. Plain text paste keeps the normal WebView path, while WebView image files and native clipboard fallback share the same local attachment/OCR pipeline. The final installed database passes SQLite integrity checks and contains no smoke-test attachment.

```text
FINAL INFERENCE STATUS
Build: PASS
Tests: PASS — npm test 5/5, cargo test 8/8, cargo fmt, npm audit 0
Smoke Test: PASS — packaged CUDA load, 8192 context, project answer, Ctrl+V image/OCR
Regression: PASS
Blocking Issues: 0
KV cache q4_0/q4_1: EXCLUDED by explicit user decision; K/V remain f16
Next Phase: COMPLETE
```

## FINAL FOLLOW-UP — 2026-09-08

Implemented the remaining safe editing and workspace lifecycle features: diff-gated atomic project-file writes with stale-content and symlink protection, debounced native project filesystem watching with index/tree refresh, and persistent inline project/conversation renaming. KV q4_0/q4_1 remains excluded; K/V cache stays f16 by explicit decision.

```text
FOLLOW-UP STATUS
Build: PASS
Tests: PASS — npm test 6/6, cargo fmt, cargo test 10/10
Smoke Test: PASS — packaged CUDA health/chat completion and file-write safety checks
Regression: PASS
Blocking Issues: 0
Next Phase: COMPLETE
```
```
