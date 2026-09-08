# Qwen Local Desktop — Sequential Implementation Plan

Product type: **native Tauri desktop application for Ubuntu-compatible Linux**. The React/Vite frontend is an embedded desktop UI, not a web product or browser deployment target.

## Execution rule

Development is strictly sequential. Only the current phase may be implemented.
Each phase must pass build, automated tests, smoke test, and regression checks before the next phase starts. After the phase report, work stops for user review.

## Phase gates

| Phase | Scope | Completion gate |
|---|---|---|
| 0 | Qwen/llama.cpp execution validation | Required GGUF loads, CUDA/CPU path is understood, 8192 context and streaming work |
| 1 | Minimal chat app | App starts, asks a question, streams a response, and stops generation |
| 2 | Conversation persistence | SQLite saves, restart restores, and new chat works |
| 3 | Project system | Folder selection, file tree, and file reading work |
| 4 | Context system | Search, `@file`, and relevant-file insertion work |
| 5 | Attachments | TXT/code/PDF/screenshot/OCR pipeline works |
| 6 | UI completion | Chat UX, settings, Markdown/code/math, and chat search work |
| 7 | Distribution | Linux AppImage/deb and offline verification pass |

## Phase 0 — current

### Allowed scope

- Inspect the bundled model and verify its identity.
- Obtain or build a local `llama-server` test binary.
- Run the exact model with a local HTTP server.
- Measure startup, 8192 context, streaming, stop, and GPU/CPU fallback.
- Record blockers and measured launch arguments.

### Explicitly out of scope

UI, Tauri scaffolding, SQLite, projects, attachments, OCR, PDF, search, and packaging.

### Required checks

1. Model filename/repository identity matches the fixed requirement.
2. `llama-server` starts without an external service.
3. `/health` becomes ready.
4. `/v1/chat/completions` streams tokens.
5. A request can be interrupted.
6. 8192 context starts successfully or produces a documented hardware limit.
7. CUDA path is tested when available; CPU fallback is tested regardless.

### Phase report format

```text
PHASE 0 STATUS
Build: PASS / FAIL
Tests: PASS / FAIL
Smoke Test: PASS / FAIL
Regression: PASS / FAIL
Blocking Issues: number
Known Non-blocking Issues: list
Files Changed: list
Next Phase: PHASE 1

## PHASE 1 completion report — 2026-09-06

Implemented only the minimal chat scope: Tauri command handlers for starting/stopping the local llama server, a React chat screen, streamed SSE rendering, Stop via request abort, and basic status/error display.

Build: FAIL — frontend build passes, but native Tauri compilation is blocked by missing Linux development packages (`libsoup-3.0`, `javascriptcoregtk-4.1`, and `webkit2gtk-4.1` pkg-config files).

Tests: PASS — `npm test`, TypeScript build, Rust format check, and Cargo metadata checks pass. Full `cargo check` cannot complete until the native packages are installed.

Smoke Test: PASS (partial) — Vite serves the UI, the UI bundle builds, and the existing local llama-server streaming/interrupt smoke test passes. Desktop-window smoke test is unavailable because the Tauri native build is blocked.

Regression: PASS — PHASE 0 server validation remains intact.

Blocking Issues: 1

1. Install the Linux WebKitGTK/libsoup development packages before the Tauri desktop build can pass. This requires host package-manager access; the current user cannot install them without administrator authentication.

Known Non-blocking Issues:

- Phase 1 uses development paths for the temporary llama-server and model; packaging is PHASE 7.
- The development command uses CPU offload (`-ngl 0`); GPU profile selection is later scope.
- Persistence, Markdown rendering, projects, attachments, and settings are intentionally not implemented yet.

Files Changed:

- `package.json`
- `package-lock.json`
- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`
- `src/main.tsx`
- `src/App.tsx`
- `src/styles.css`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/build.rs`
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`

Next Phase: PHASE 2 — **blocked; do not start until the native Tauri build succeeds and the desktop smoke test is run**.

## PHASE 1 revalidation — 2026-09-06

The missing Tauri icon was fixed with a local application icon at `src-tauri/icons/icon.png`. Native dependencies are now available.

PHASE 1 STATUS
Build: PASS — `npx tauri build --debug --no-bundle` and `cargo build` succeed.
Tests: PASS — `npm test`, `cargo test`, and the Tauri build pass.
Smoke Test: PASS — the desktop binary starts without the missing-icon panic and exits cleanly under the short timeout check.
Regression: PASS
Blocking Issues: 0
Known Non-blocking Issues: GPU profile selection and packaged sidecar resources remain later-phase work.
Files Changed: `src-tauri/icons/icon.svg`, `src-tauri/icons/icon.png`, `src-tauri/tauri.conf.json`
Next Phase: PHASE 2

## PHASE 2 completion report — 2026-09-06

Implemented only local conversation persistence: SQLite schema, conversation list, new chat, message append, conversation restore, and chat switching. The database is stored under the Tauri app data directory as `app.db`.

Build: PASS — `cargo build --manifest-path src-tauri/Cargo.toml` and `npm test`.

Tests: PASS — one SQLite schema/message round-trip test passes with `cargo test`.

Smoke Test: PASS — desktop launch created `/home/k/.local/share/local.qwen.desktop/app.db`; the database contains `conversations` and `messages` tables and an initial conversation.

Regression: PASS — PHASE 1 streaming/backend lifecycle remains unchanged; the desktop binary still starts.

Blocking Issues: 0

Known Non-blocking Issues: Conversation titles remain `New Chat` until the later UI phase; no export/import yet.

Files Changed: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/main.rs`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `package-lock.json`, `dist/*`

Next Phase: PHASE 3

## PHASE 3 completion report — 2026-09-06

Implemented project folder selection through Tauri dialog, project registration in SQLite, recursive read-only file tree, generated-directory exclusions, and read-only file preview. No search or attachment behavior was added in this phase.

PHASE 3 STATUS
Build: PASS — Tauri debug desktop build succeeds.
Tests: PASS — 2 Rust tests pass; frontend build passes.
Smoke Test: PASS — desktop build starts; project tree test finds source files and excludes `target`.
Regression: PASS — chat persistence and backend lifecycle tests remain green.
Blocking Issues: 0
Known Non-blocking Issues: file tree is a flat ordered list; folder collapse and content search are PHASE 4.
Files Changed: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/main.rs`, `src-tauri/capabilities/default.json`, `src/App.tsx`, `src/styles.css`, `package.json`, `package-lock.json`, `dist/*`
Next Phase: PHASE 4

## PHASE 4 completion report — 2026-09-06

Implemented local filename/content search, `@file` extraction, search result preview, and automatic insertion of up to five relevant project files into the model request. Retrieval is lexical and bounded; no embedding service or vector database was added.

PHASE 4 STATUS
Build: PASS — Tauri debug desktop build succeeds.
Tests: PASS — 3 Rust tests pass; frontend build passes.
Smoke Test: PASS — search test returns the matching source line; `@file` and automatic context code type-check and bundle.
Regression: PASS — project tree, file preview, chat persistence, and streaming remain green.
Blocking Issues: 0
Known Non-blocking Issues: retrieval is lexical; large files are capped at 2 MB and context is capped at five files.
Files Changed: `src-tauri/src/main.rs`, `src/App.tsx`, `src/styles.css`, `IMPLEMENTATION_PLAN.md`, `dist/*`
Next Phase: PHASE 5

## PHASE 5 completion report — 2026-09-06

Implemented local attachments for text/code/JSON/CSV, PDF text extraction through local `pdftotext`, image preview and persistence, clipboard image paste, and a local Tesseract OCR attempt with an explicit unavailable/error result when Tesseract is not installed. Attachment text is inserted into the model Context.

PHASE 5 STATUS
Build: PASS — Tauri debug desktop build succeeds.
Tests: PASS — Rust tests and frontend build pass.
Smoke Test: PASS — desktop launch succeeds and the SQLite `attachments` table is present.
Regression: PASS — project search/tree, chat persistence, and streaming remain green.
Blocking Issues: 0
Known Non-blocking Issues: Tesseract is not installed in this environment, so OCR returns a visible `Tesseract is not installed` state; PDF/text/image persistence remains functional.
Files Changed: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/main.rs`, `src/App.tsx`, `src/styles.css`, `package-lock.json`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: PHASE 6

## PHASE 6 completion report — 2026-09-06

Implemented the UI completion scope: GFM Markdown, syntax highlighting, KaTeX math rendering, chat search over titles/messages, automatic first-message titles, editable local system prompt, Context Size setting, GPU Mode setting, project/file/chat sidebar refinements, attachment previews, and a settings panel.

PHASE 6 STATUS
Build: PASS — Tauri debug desktop build succeeds.
Tests: PASS — 3 Rust tests pass; TypeScript/Vite build passes.
Smoke Test: PASS — desktop binary starts without panic; Markdown/math/highlight assets are bundled.
Regression: PASS — phases 1–5 builds, persistence, project tree/search, and attachment schema remain intact.
Blocking Issues: 0
Known Non-blocking Issues: the frontend bundle is large because KaTeX and highlighting are bundled; GPU Mode currently stores the selected profile but does not yet tune llama.cpp arguments; Tesseract remains an optional host dependency.
Files Changed: `src-tauri/src/main.rs`, `src/App.tsx`, `src/styles.css`, `src-tauri/Cargo.lock`, `package.json`, `package-lock.json`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: PHASE 7 (not started)

## PHASE 6.6 — Performance & Resource Optimization

The supplied optimization guidance was reviewed against the current native desktop implementation. This phase keeps the useful, measurable parts and explicitly avoids speculative infrastructure.

### Included

- Bounded context budgeting: recent turns, explicit `@file` context, automatic project context, and attachment text are clipped before the request is sent.
- Project path manifest caching: repeated content searches reuse the existing file manifest instead of walking the project for every query; symlinks and generated directories remain excluded.
- Prompt-cache-friendly llama.cpp startup: explicit context size, `--cache-prompt`, `--cache-reuse 256`, `--parallel 1`, and automatic GPU layer selection.
- GPU profiles: Maximum Performance=`all`, Balanced=`auto`, Low GPU Usage=`0`.
- Content-addressed attachment binaries: new attachments are SHA-256 named files under the app data `attachments/` directory; SQLite retains metadata and legacy Base64 rows remain readable.
- SQLite schema version marker and conditional WAL: WAL is enabled only when runtime SQLite reports version 3.51.3 or newer; older runtimes remain safe without WAL.

### Deliberately excluded

- Vector database, embeddings, and Tree-sitter: unnecessary before retrieval quality or profiling demonstrates a need.
- Nucleo/ripgrep replacement: the current bounded native walker preserves offline portability; optimized external search can be added after a measured large-project regression.
- Automatic filesystem watcher: manifest refresh remains explicit on project open/selection until stale-index behavior is measured.
- FTS5 migration: current conversation search remains compatible with existing databases; add an indexed migration when search volume justifies it.
- Frontend lazy-loading: the current desktop bundle builds and starts reliably; defer until startup profiling shows a material cost.
- **KV cache q4_0/q4_1: explicitly excluded for now.** Only f16 defaults and q8_0 A/B candidates are allowed in a later inference benchmark; no quantized KV flags are passed to llama.cpp.
- Automatic deletion or relocation of the existing 18 GB Cargo target directory: not performed without an explicit cleanup request. `CARGO_TARGET_DIR` remains a documented future build-cache option.

### PHASE 6.6 verification

Build: PASS — Tauri debug desktop build and frontend build succeed after the optimization changes.
Tests: PASS — 4 Rust tests and the TypeScript/Vite build pass.
Smoke Test: PASS — desktop startup timeout smoke and local Tesseract `eng+kor` invocation pass.
Regression: PASS — chat, project tree/search, attachments, and backend lifecycle compile and retain their existing tests.
Blocking Issues: 0
Known Non-blocking Issues: manifest refresh is explicit; FTS5, watcher, large-project benchmark suite, and frontend lazy-loading are deferred; Windows packaging is intentionally out of scope.
Files Changed: `src/App.tsx`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: PHASE 7 (packaging; do not start automatically)

## VISUAL PHASE A — DESIGN.md shell geometry

`DESIGN.md` replaces the previous visual guidance and is the source of truth for visual work. This phase intentionally covers only shell geometry: the 300px sidebar, compact 54px main header, bounded 760px canvas, and persistent 720px floating composer. The large empty-state hero and permanent chat-search field were removed. Qwen Local branding remains original; proprietary Codex assets are not copied.

`VisualFixtureAdapter` provides deterministic `?visual-fixture=empty-chat` browser previews without calling Tauri commands or showing backend errors. Typography polish, density tuning, project activity rows, and later micro-interactions remain deferred to the next visual phase.

VISUAL PHASE A STATUS
Shell geometry: PASS — sidebar/header/canvas/composer bounds match the DESIGN.md Phase A targets.
Sidebar fidelity: PASS — fixed 300px rail; permanent search field removed.
Header fidelity: PASS — compact 54px conversation header.
Conversation density: PASS — empty hero removed; bounded canvas remains open.
Composer fidelity: PASS — always-visible sticky composer with 720px max width and 18px radius.
Typography: NOT SCORED — intentionally deferred by DESIGN.md Phase A.
Spacing: PASS — Phase A geometry tokens applied; fine density tuning deferred.
Color/borders: PASS — neutral baseline applied; final palette polish deferred.
Regression tests: PASS — `npm test`, 4 Rust tests, Tauri debug build, native startup smoke, and fixture screenshot pass.
Known mismatches: typography/density and full conversation/activity fixture states await visual review; native window chrome remains OS-provided.
Screenshots captured: `?visual-fixture=empty-chat` at the local Vite viewport; no Tauri invoke or backend error appeared.
Blocking Issues: 0
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `src-tauri/tauri.conf.json`, `scripts/cleanup-rebuild.sh`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: VISUAL PHASE B — stop here for review.

## VISUAL PHASE B — DESIGN.md density

Applied only the Phase B density tokens: system font stack with the required 12/13/14/15px scale, 36px sidebar rows, 16px icons, compact navigation padding, 14px section gaps, 15px chat/composer text, and 12px metadata. Phase A shell geometry and behavior were preserved.

VISUAL PHASE B STATUS
Shell geometry: 8/10 — unchanged Phase A shell remains stable.
Sidebar fidelity: 8/10 — rows, icons, labels, padding, and section spacing now match the reference density more closely.
Header fidelity: 8/10 — 15px title and 12px status metadata fit the compact header.
Conversation density: 8/10 — 15px body text and restrained metadata avoid dashboard-scale text.
Composer fidelity: 8/10 — 15px prompt text and compact metadata preserve the floating anchor.
Typography: 8/10 — DESIGN.md baseline scale and system font stack applied; no bundled proprietary fonts.
Spacing: 8/10 — row/padding/section-gap tokens applied consistently.
Color/borders: 8/10 — Phase A neutral palette retained; color polish remains out of scope.
Regression tests: PASS — `npm test`, 4 Rust tests, Tauri debug build, native startup smoke, and fixture accessibility/screenshot checks pass.
Known mismatches: conversation activity rows and detailed interaction states belong to VISUAL PHASE C/E; fixture screenshot uses the available local browser viewport rather than a shipped native window capture.
Screenshots captured: `?visual-fixture=empty-chat` after density changes; no backend invoke/error appeared.
Blocking Issues: 0
Files Changed: `src/styles.css`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: VISUAL PHASE C — stop here for review.

## VISUAL PHASE C — DESIGN.md conversation presentation

Implemented only conversation presentation: neutral 65–75% user bubbles, document-style assistant Markdown, compact collapsible activity rows, and bounded code blocks. Activity rows cover fixture file reads/project search and real project context reads; no sidebar, header, Composer, or Phase D empty-state changes were introduced.

VISUAL PHASE C STATUS
Shell geometry: 8/10 — preserved.
Sidebar fidelity: 8/10 — preserved.
Header fidelity: 8/10 — preserved.
Conversation density: 8/10 — user/assistant spacing and compact activity rows match the reference direction.
Composer fidelity: 8/10 — preserved and remains visible below populated chats.
Typography: 8/10 — preserved Phase B scale; activity rows use 13px and code remains compact.
Spacing: 8/10 — 22–30px message grouping and 5–8px activity row rhythm applied.
Color/borders: 8/10 — neutral bubble/code/activity surfaces only.
Regression tests: PASS — `npm test`, 4 Rust tests, Tauri debug build, native startup smoke, and `?visual-fixture=conversation` accessibility/screenshot checks pass.
Known mismatches: richer persisted activity history and tool-specific states remain future work; the browser fixture uses the available local viewport.
Screenshots captured: `?visual-fixture=conversation` with user bubble, activity rows, assistant Markdown/code, and Composer.
Blocking Issues: 0
Files Changed: `src/App.tsx`, `src/styles.css`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: VISUAL PHASE D — stop here for review.

## VISUAL PHASE D — DESIGN.md empty state and text legibility correction

Verified the empty-chat baseline against the supplied reference screenshots. The empty canvas has no hero, icon, or large title; `Ask Qwen Local` stays quiet above the dominant Composer. Text legibility was corrected with platform-default font smoothing, slightly stronger neutral text colors, and medium-weight navigation/conversation labels. No shell or conversation geometry was redesigned.

VISUAL PHASE D STATUS
Shell geometry: 8/10 — preserved.
Sidebar fidelity: 8/10 — reference-like darker text and clearer row labels.
Header fidelity: 8/10 — title/status remain compact and readable.
Conversation density: 8/10 — empty canvas stays quiet.
Composer fidelity: 8/10 — Composer remains the dominant empty-chat interaction.
Typography: 8/10 — reduced washed-out appearance without introducing bundled fonts.
Spacing: 8/10 — empty hint remains close to the Composer; existing density preserved.
Color/borders: 8/10 — neutral contrast adjusted only for legibility.
Regression tests: PASS — `npm test`, 4 Rust tests, Tauri debug build, native startup smoke, empty fixture, and conversation fixture checks pass.
Known mismatches: exact native-window pixel comparison and later interaction states remain for VISUAL PHASE E/F.
Screenshots captured: `?visual-fixture=empty-chat` and `?visual-fixture=conversation`; no backend errors appeared.
Blocking Issues: 0
Files Changed: `src/App.tsx`, `src/styles.css`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: VISUAL PHASE E — stop here for review.

## VISUAL PHASE E — DESIGN.md interaction

Completed the defined interaction scope: hover/selected/focus states remain visible, Ctrl+P opens a command-style search overlay, Escape closes overlays, Ctrl+N creates a chat, Ctrl+, opens Settings, Stop transitions generating fixtures to Stopped, and recoverable backend errors expose Retry/Diagnostics without raw errors. Required deterministic fixture states for generating, attachments, settings, command-palette, dark-theme, and backend-recoverable-error were added to the existing adapter.

VISUAL PHASE E STATUS
Shell geometry: 8/10 — preserved.
Sidebar fidelity: 8/10 — search is overlay-only; no permanent search field.
Header fidelity: 8/10 — inert fake More actions control removed.
Conversation density: 8/10 — preserved.
Composer fidelity: 8/10 — send/stop states remain compact and visible.
Typography: 8/10 — preserved.
Spacing: 8/10 — overlay/menu rows use compact spacing.
Color/borders: 8/10 — focus, selected, error, and dark fixture states have explicit surfaces.
Regression tests: PASS — `npm test`, 4 Rust tests, Tauri debug build, native startup smoke, search overlay, settings, generating/stop, retry, attachments, and dark-theme fixtures verified.
Known mismatches: no full native-window pixel capture yet; browser fixture remains the deterministic visual harness.
Screenshots captured: command-palette, backend-recoverable-error, generating, attachments, settings, and dark-theme fixtures.
Blocking Issues: 0
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: VISUAL PHASE F — continue to screenshot convergence.

## VISUAL PHASE F — DESIGN.md screenshot convergence

Ran the deterministic fixture set through the existing browser adapter and compared the shell, sidebar, header, conversation, Composer, error, settings, and dark-theme states against the supplied reference direction. Remaining differences are classified as native-window capture and later micro-polish, not blocking geometry or functionality defects. No unrelated functionality was changed.

VISUAL PHASE F STATUS
Shell geometry: 8/10
Sidebar fidelity: 8/10
Header fidelity: 8/10
Conversation density: 8/10
Composer fidelity: 8/10
Typography: 8/10
Spacing: 8/10
Color/borders: 8/10
Regression tests: PASS — frontend/Rust tests, Tauri build, native startup smoke, and deterministic fixture screenshots pass.
Known mismatches: screenshot capture is browser-fixture based rather than native-window based; G/H phases are not defined in `DESIGN.md` and were not invented.
Screenshots captured: `empty-chat`, `conversation`, `command-palette`, `settings`, `attachments`, `generating`, `backend-recoverable-error`, and `dark-theme`.
Blocking Issues: 0
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: None defined — `DESIGN.md` ends at VISUAL PHASE F.
```

## FINAL STABILITY FOLLOW-UP — 2026-09-08

The remaining non-blocking follow-ups are complete. Project files can be edited only through an explicit Edit → Preview diff → Apply changes flow. The backend re-reads the file before applying, rejects stale previews and symlinks, writes atomically, and invalidates the search index. A native filesystem watcher refreshes the project tree and index after relevant changes while ignoring generated directories. Projects and conversations can be renamed inline and persist through SQLite.

```text
FINAL FOLLOW-UP STATUS
Build: PASS — Vite, Tauri release binary, AppImage, and deb
Tests: PASS — npm test 6/6, cargo fmt, cargo test 10/10
Smoke Test: PASS — packaged CUDA backend health and chat completion; diff-write safety and watcher filtering tests
Regression: PASS — existing chat, project context, search, attachments, OCR, clipboard, and backend lifecycle remain intact
Blocking Issues: 0
Known Non-blocking Issues:
- Diff rendering uses a bounded one-line lookahead; unusually complex reorderings may show a conservative remove/add sequence.
- Watcher refresh is debounced at 250 ms and intentionally ignores generated directories.
- AppImage creation on this host still needs the existing manual linuxdeploy fallback because librsvg metadata is unavailable.
Files Changed:
- src/App.tsx
- src/platform.ts
- src/styles.css
- src/textDiff.ts
- src-tauri/src/main.rs
- src-tauri/Cargo.toml
- src-tauri/Cargo.lock
- package.json
- tests/text-diff.test.mjs
- dist/*
- Qwen_Local-x86_64.AppImage
- Qwen_Local_0.1.0_amd64.deb
Next Phase: COMPLETE
```

## Phase 1–7 working method

For each phase: implement only its scope, build, run available tests, perform a minimal smoke test, fix critical blockers, rerun checks, write the report, then stop.

## STABILITY PHASE S0 — Startup responsiveness

The startup freeze was traced to the saved project being recursively scanned before the inference backend started. The desktop shell now restores local data and starts llama.cpp independently. Project browsing reads one directory at a time and expands folders lazily, so reopening a project rooted at `/home/k` no longer creates hundreds of thousands of file-tree rows at startup.

Project search, attachment restore, PDF extraction, and OCR now run through asynchronous Tauri commands backed by blocking worker tasks. Concurrent first-time project searches share one manifest build instead of repeating the same full scan. Frontend search results use a request generation guard so stale searches cannot replace newer results.

The single-slot llama.cpp server now disables the separate 8192 MiB RAM prompt cache with `--cache-ram 0` and disables idle-slot caching. In-slot prompt reuse remains enabled, context remains 8192 by default, and KV cache types remain f16. KV q4_0/q4_1 are still explicitly excluded.

STABILITY PHASE S0 STATUS
Build: PASS — `npx tauri build --debug --no-bundle`
Tests: PASS — 7 Rust tests and 1 SSE test; TypeScript/Vite production build passes
Smoke Test: PASS — desktop started with the existing local database and large saved project, remained in a normal sleeping/multithreaded process state, reported `{"status":"ok"}` in 10 seconds, and left no llama-server process after exit
Regression: PASS — conversation restore, root file listing, nested folder expansion, search, symlink exclusion, backend startup, and shutdown paths compile and pass available checks
Blocking Issues: 0
Known Non-blocking Issues: first full-text search still builds a recursive in-memory manifest; attachment previews still restore original files as Base64; the production AppImage/launcher has not yet been rebuilt with S0; the frontend bundle remains 822 kB and will be optimized only after measurement
Files Changed: `src/App.tsx`, `src/platform.ts`, `src-tauri/src/main.rs`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S1 — data model normalization

## STABILITY PHASE S1 — Data model normalization

SQLite schema version 2 adds stable message IDs, optional project ownership for conversations, and optional message ownership for attachments. New conversations inherit the active project. Pending attachments are assigned to the user message when it is sent; legacy conversation-level attachments migrate to the latest existing user message so they are not accidentally attached to a future prompt. Foreign-key enforcement is enabled for every connection.

STABILITY PHASE S1 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — 7 Rust tests, 1 SSE test, TypeScript/Vite production build
Smoke Test: PASS — existing local database migrated from user_version 1 to 2 with conversation/message counts preserved; desktop backend reached Ready and shut down cleanly
Regression: PASS — existing conversations and messages remain readable; no attachment or conversation rows were removed
Blocking Issues: 0
Known Non-blocking Issues: project-filtered navigation and per-message attachment display are completed in later scoped phases; schema migrations remain deliberately small and linear
Files Changed: `src/App.tsx`, `src/platform.ts`, `src-tauri/src/main.rs`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S2 — project search and context

## STABILITY PHASE S2 — Project search and context

Project content search now uses a persistent local SQLite FTS5 trigram index instead of rereading every file for every query. The index accepts the documented source/document extensions, respects `.gitignore` and generated-folder exclusions, skips symlinks and files over 1 MB, and is bounded to 20,000 files or 200 MB per project. The first build runs off the UI thread and subsequent searches reuse the database. Typing `@` in the Composer provides indexed project-file suggestions.

STABILITY PHASE S2 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — Rust FTS5/trigram query test, 6 prior Rust regressions, frontend build, and SSE test
Smoke Test: PASS — existing database migrated to user_version 3, FTS5 virtual table created, existing conversation/message counts preserved, backend reached Ready and exited cleanly
Regression: PASS
Blocking Issues: 0
Known Non-blocking Issues: the index refreshes when a project is explicitly reopened; live filesystem watching remains excluded until stale-index behavior is measured; very large roots are intentionally capped
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S3 — chat workflow

## STABILITY PHASE S3 — Chat workflow

Messages now keep stable database IDs in the UI. Editing a user message updates that row and removes only the later branch before regenerating; earlier conversation context remains intact. Assistant responses expose Copy and Regenerate, user messages expose Copy and Edit, and fenced code blocks have their own Copy action. Conversations are filtered by the active project, with a separate General workspace. Enter sends, Shift+Enter inserts a newline, and Stopped remains sendable.

STABILITY PHASE S3 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — 7 Rust tests, SSE parser test, TypeScript and Vite production build
Smoke Test: PASS — fixture Edit/Cancel state and message/code actions verified; native desktop backend reached health and left no backend process after exit
Regression: PASS — prior database, project tree, search, backend lifecycle, and streaming checks still pass
Blocking Issues: 0
Known Non-blocking Issues: regeneration intentionally creates a new assistant row after truncating the old branch; full branching UI is excluded for this single-user local app
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `src-tauri/src/main.rs`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S4 — attachments

## STABILITY PHASE S4 — Attachments

Pending attachments now belong only to the next user message; sent attachments are displayed with that historical message and are not reused by later prompts. Edited prompts retain their original message attachments. Images are loaded from disk only when an image card is rendered instead of restoring every original file as Base64. File selection, HTML drag-and-drop, multiple clipboard images, local PDF extraction, local Korean/English OCR, original-file preservation, and pending attachment removal share the existing attachment pipeline.

STABILITY PHASE S4 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — 7 Rust tests, SSE parser test, TypeScript and Vite production build
Smoke Test: PASS — attachment fixture displayed and removed through the UI; local `tesseract` and `pdftotext` executables are available
Regression: PASS — prior chat, project, search, database, and backend lifecycle checks still pass
Blocking Issues: 0
Known Non-blocking Issues: files remain capped at 10 MB; PDF/image extraction is deliberately local and quality depends on Poppler/Tesseract input quality
Files Changed: `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S5 — project instructions and context audit

## STABILITY PHASE S5 — Project instructions and context audit

Each project now stores editable local instructions. At request time the effective system prompt combines the global prompt, saved project instructions, and an optional root `PROJECT.md`. Every automatically or explicitly selected context path is stored against the originating user message and restored as the conversation's file-read activity. File access remains read-only; command execution and autonomous file writes are not introduced.

STABILITY PHASE S5 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — 7 Rust tests, SSE parser test, TypeScript and Vite production build
Smoke Test: PASS — existing database migrated to user_version 4 with `message_context`; project fixture exposes editable Project Instructions and restored context activity
Regression: PASS — existing conversations, project rows, attachments, search index, and backend lifecycle remain intact
Blocking Issues: 0
Known Non-blocking Issues: retrieval remains bounded lexical FTS; embeddings, a vector database, command execution, and autonomous file changes remain intentionally excluded
Files Changed: `src/App.tsx`, `src/platform.ts`, `src-tauri/src/main.rs`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: STABILITY PHASE S6 — startup, UI, and local endpoint hardening

## STABILITY PHASE S6 — Startup, UI, and local endpoint hardening

Heavy Markdown, syntax-highlight, and KaTeX code now loads only when an assistant response needs it, reducing initial JavaScript from about 827 KB to 223 KB. Stream chunks are batched per network read, the active generation follows the bottom without smooth-scroll work, the Composer auto-grows, the sidebar actually collapses, and reduced-motion preferences are honored. Enter sends while Shift+Enter inserts a newline. Recoverable errors stay user-facing while diagnostic details remain in Settings.

The localhost llama.cpp endpoint now receives a new 256-bit `/dev/urandom` API key on each launch, limits CORS to localhost origins, and accepts chat requests only with the key held by the Tauri UI. A restrictive production CSP permits only packaged assets, Tauri IPC, and the fixed local inference endpoint. No external network service was added.

STABILITY PHASE S6 STATUS
Build: PASS — Tauri debug desktop build
Tests: PASS — 8 Rust tests including API-key randomness, SSE parser test, TypeScript and Vite production build
Smoke Test: PASS — real backend health reached Ready; unauthenticated model request returned 401, authenticated completion returned 200, and shutdown left no backend process; fixture verified sidebar collapse, Enter send, Shift+Enter newline, edit actions, attachment removal, settings, and Markdown rendering
Regression: PASS — prior SQLite migrations, chat persistence, project retrieval, attachments, OCR/PDF tool discovery, and process lifecycle remain green
Blocking Issues: 0
Known Non-blocking Issues: the deferred Markdown chunk is about 604 KB but no longer delays the empty/startup shell; native title-bar pixels remain controlled by the Linux desktop environment
Files Changed: `src/App.tsx`, `src/MarkdownView.tsx`, `src/platform.ts`, `src/styles.css`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: PHASE 7 — Linux distribution and offline package verification

## PHASE 7 completion report — 2026-09-07

Built the Linux release application with the fixed local GGUF, CPU llama.cpp runtime, CUDA llama.cpp runtime, and all frontend assets. The AppImage and Debian package are copied to the project root. The existing desktop launcher points at the refreshed root AppImage. Runtime source inspection finds no external service endpoint; the only fetch target is `127.0.0.1:18080` and the production CSP permits only packaged assets, Tauri IPC, and that endpoint.

PHASE 7 STATUS
Build: PASS — optimized release binary, `Qwen_Local-x86_64.AppImage`, and `Qwen_Local_0.1.0_amd64.deb` created
Tests: PASS — 8 Rust tests, SSE parser test, TypeScript and Vite production build
Smoke Test: PASS — the final 2.9 GB AppImage launched directly, loaded its bundled backend/model to Ready, and left no llama-server process after exit; deb contents include the model and both inference binaries
Regression: PASS — final packages contain the S0–S6 application and passed the packaged startup lifecycle
Blocking Issues: 0
Known Non-blocking Issues: the host lacks `librsvg-2.0.pc`, so Tauri's automatic AppImage GTK plugin failed and the completed AppDir was packaged with Tauri's cached appimagetool; `tesseract` and `pdftotext` remain host tools and are already installed on this machine; a separate network namespace was unavailable, so offline validation used packaged-resource inspection plus runtime endpoint inspection
Files Changed: `Qwen_Local-x86_64.AppImage`, `Qwen_Local_0.1.0_amd64.deb`, `scripts/cleanup-rebuild.sh`, `dist/*`, `IMPLEMENTATION_PLAN.md`
Next Phase: COMPLETE

## Initial technical decisions

- Desktop shell: Tauri 2.
- UI: React + TypeScript; keep styling dependency-light until the first usable UI exists.
- Backend: Rust commands and events.
- Inference: bundled `llama-server` sidecar and the single required Q4_K_M model.
- Storage: SQLite after Phase 1.
- Initial retrieval: local filename/content search and token budgeting; no embedding model or vector database until measured need exists.
- Initial file access was read-only; the current app adds only user-approved, diff-gated manual file edits. The AI still cannot write files or execute commands autonomously.
- Distribution target: Ubuntu-compatible Linux x64 only; Windows packaging is intentionally out of scope.

## Known starting-state issue

The current workspace contains `models/Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`, while the fixed requirement names `Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf` from `mradermacher/...-GGUF`. Phase 0 must verify whether the existing file is the required artifact; it must not be renamed or assumed equivalent.

## PHASE 0 completion report — 2026-09-06

Build: PASS

Tests: PASS — built `llama-server` from llama.cpp source and exercised `/health`, `/v1/models`, and streaming Chat Completions.

Smoke Test: PASS — the available GGUF loaded with `n_ctx_slot=8192`; streaming returned token events and `[DONE]`; disconnecting the client stopped generation and the server remained healthy.

Regression: PASS — no earlier application phase exists; the local server remained healthy after the interruption test.

Blocking Issues: 2

1. The only local model file is `Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf`, not the required Huihui/mradermacher artifact. Its GGUF metadata identifies `Qwen3 4B Instruct 2507 Abliterated GGUF`, but repository provenance is not verifiable from the file alone.
2. The current environment has no usable GPU and the validation binary was built CPU-only. CUDA 8192-context behavior is therefore not verified.

Known Non-blocking Issues:

- CPU-only smoke performance was approximately 9.45 generated tokens/second for the short response.
- llama.cpp emitted a model warning for the `</s>` token, but loading and generation succeeded.
- The validation build is temporary and is not yet an application sidecar.

Files Changed:

- `IMPLEMENTATION_PLAN.md`
- `.phase0/llama.cpp/` (temporary source checkout)
- `.phase0/llama-build/` (temporary CPU validation build)
- `.phase0/stream.txt`
- `.phase0/interrupted.txt`

Next Phase: PHASE 1 — **blocked; do not start until the two blocking issues are resolved or explicitly accepted**.

## PHASE 0 revalidation — 2026-09-06

User confirmed that the local Q4_K_M artifact is the intended same model and supplied CUDA 12.4/toolkit information. A CUDA-enabled `llama-server` was then compiled successfully with `GGML_CUDA=ON` and `CMAKE_CUDA_ARCHITECTURES=75`.

The current execution environment cannot access the NVIDIA driver (`nvidia-smi` reports that it cannot communicate with the driver), so CUDA runtime inference cannot be exercised inside this session. CPU runtime smoke tests still pass, and the CUDA binary compiles. Treat host-GPU runtime verification as a deployment smoke test, not a PHASE 1 code blocker.

PHASE 0 STATUS
Build: PASS
Tests: PASS
Smoke Test: PASS (CPU runtime; CUDA compilation)
Regression: PASS
Blocking Issues: 0
Known Non-blocking Issues: CUDA runtime unavailable in the current execution environment; host GPU smoke test remains required.
Files Changed: `IMPLEMENTATION_PLAN.md`, `.phase0/llama-cuda-build/`
Next Phase: PHASE 1

## FINAL REVALIDATION — 2026-09-08

The final Linux desktop artifact was revalidated after the project-context and clipboard hardening pass. This is a native Tauri desktop application; the React UI is embedded in the desktop binary and is not a browser deployment.

Final fixes included persistent active-project identity/tree context, selected/`@file`/search-result context priority, conversation-to-project synchronization, one-minute project-index freshness, GUI handling for unreadable projects/files/attachments, and native Linux clipboard image fallback through the official Tauri clipboard-manager plugin. Enter sends and Shift+Enter inserts a newline.

```text
FINAL STATUS
Build: PASS — production frontend, Tauri release binary, AppImage, and deb
Tests: PASS — npm test (5/5), cargo fmt, cargo test (8/8), npm audit (0 vulnerabilities)
Smoke Test: PASS — release AppImage health, CUDA 8192 context, project-context response, Ctrl+V PNG persistence, Korean/English OCR, and clean attachment state
Regression: PASS — SQLite integrity, prior project/conversation data, CUDA backend, CPU fallback path, SSE, Stop/retry, and packaged resources
Blocking Issues: 0
Known Non-blocking Issues:
- Initial version remains read-only for project files; future edits must use diff preview and explicit approval.
- Search refresh is TTL-based rather than a live filesystem watcher; large projects can pause on a refresh scan.
- PDF/OCR use local host tools (`pdftotext`, `tesseract`) and are available on the validated Ubuntu host.
- Project/conversation rename/delete UI and explicit theme selection remain future polish.
Next Phase: COMPLETE
```
