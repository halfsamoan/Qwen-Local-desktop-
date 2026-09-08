# DESIGN.md

# Qwen Local Desktop — Reference-Fidelity UI/UX Specification

## 0. Status and intent

This file is the **visual source of truth** for Qwen Local Desktop.

The primary reference is the supplied **Codex Desktop screenshot**. The target is to reproduce its non-proprietary desktop layout, density, hierarchy, spacing, interaction patterns, panel behavior, conversation presentation, composer behavior, and overall visual restraint as closely as practical.

Do **not** copy or ship proprietary logos, wordmarks, illustrations, icons, screenshots, or brand assets.

Qwen Local must use its own product name and open-source iconography.

This revision intentionally overrides looser wording from earlier versions of DESIGN.md. Terms such as “approximate”, “inspired by”, or “starting point” must not be used as justification for visible drift from the reference.

---

# 1. Current mismatch diagnosis

The current Qwen Local preview differs materially from the reference.

The following mismatches must be treated as design bugs rather than optional polish.

## 1.1 Empty state is too web-app-like

Current implementation:

- large centered icon
- large “How can I help?” headline
- explanatory subtitle
- large empty central composition

Reference behavior:

- conversation canvas remains visually quiet
- composer is the dominant interaction point
- there is no marketing-style hero section
- empty state does not look like a landing page

### Required fix

Remove the large centered hero composition.

For a new empty chat, render either:

```text
[mostly empty conversation canvas]

                    composer near bottom
```

or a very small muted hint above the composer.

Do not use a large headline or decorative central icon.

---

## 1.2 Sidebar is too spacious and too web-dashboard-like

Current implementation has:

- large gaps between navigation rows
- uppercase section labels
- a persistent “Search chats” field
- oversized row typography
- strong section separation

Reference is denser and quieter.

### Required fix

Use:

- compact 34–38px navigation rows
- 14–15px primary text
- 12–13px secondary/section text
- no permanent large search field in the sidebar
- search invoked from top icon or `Ctrl+P`
- recent conversation rows directly under a small muted section label
- selected row uses a low-contrast neutral fill
- hover state lighter than selected state

---

## 1.3 Main header composition is not close enough

Reference header has a compact structure:

```text
[context/project icon]  conversation/project title  […]        [secondary actions]
```

Current Qwen header feels more like a generic web application toolbar.

### Required fix

Header must remain compact and visually secondary.

No large button group.

Prefer icon-only actions with tooltips.

---

## 1.4 Typography scale is too large

Current Qwen preview uses text and headings that feel larger and heavier than the reference.

### Required fix

Baseline:

```text
Sidebar primary rows       14px
Sidebar section labels     12px
Main header title          15px / 600
Conversation body          15px
Secondary metadata         12–13px
Composer textarea          15px
Code                       13px
```

Do not use 20px+ text for ordinary navigation.

Do not use 28px+ headings inside the standard chat surface.

---

## 1.5 Composer is not yet the visual anchor

The reference uses a compact floating composer near the bottom.

### Required fix

The composer must be visible in both empty and populated chats.

It must:

- float above the bottom edge
- be horizontally centered in the main pane
- use a subtle border
- use a soft low-radius shadow
- remain narrower than the full content pane
- grow vertically with input
- keep controls in a compact lower row

---

## 1.6 Error presentation is too visually dominant

Current browser preview shows a large red error bar:

```text
Cannot read properties of undefined (reading 'invoke')
```

This must never be part of visual baseline screenshots.

### Required fix

Normal user error pattern:

```text
Local backend unavailable.
[Retry] [Diagnostics]
```

Use a compact inline status or toast.

Raw JavaScript, Rust, Tauri, or llama.cpp errors belong in Diagnostics.

---

## 1.7 Browser preview is not a valid final desktop comparison

The current Qwen screenshot includes Chrome tabs and address bar.

The reference is a desktop app.

This makes direct visual comparison misleading.

### Required fix

Final design approval must use:

- Tauri desktop window screenshots
- or a browser visual-fixture mode that removes backend errors and exactly reproduces the Tauri content viewport

Chrome browser chrome must not be included in final fidelity comparisons.

---

# 2. Absolute design rules

These rules are mandatory.

## DO

- match the supplied screenshot's density
- match panel hierarchy
- match restrained neutral styling
- keep the interface flat
- use subtle neutral borders
- use small icons
- use system-like typography
- keep the sidebar compact
- constrain conversation width
- keep the composer near the bottom
- keep tool/activity rows compact
- use whitespace rather than cards for hierarchy

## DO NOT

- create a generic SaaS dashboard
- create a marketing landing page
- use giant empty-state headlines
- use large decorative AI icons
- use purple or blue AI gradients
- use glassmorphism
- use thick drop shadows
- put every section in a rounded card
- use giant pill buttons
- use a permanent sidebar search box unless the approved reference changes
- use oversized uppercase section labels
- expose raw backend errors in the main canvas
- copy proprietary Codex/OpenAI assets

---

# 3. Layout geometry

Geometry must be implemented using design tokens.

```css
:root {
  --app-topbar-h: 36px;

  --sidebar-w: 300px;
  --sidebar-min-w: 260px;
  --sidebar-max-w: 340px;

  --main-header-h: 54px;

  --content-max-w: 760px;
  --composer-max-w: 720px;

  --sidebar-row-h: 36px;
  --sidebar-section-gap: 14px;

  --page-pad-x: 28px;
  --page-pad-bottom: 20px;

  --radius-xs: 5px;
  --radius-sm: 7px;
  --radius-md: 10px;
  --radius-composer: 18px;
}
```

These values may be adjusted by at most roughly 10% during screenshot convergence.

Larger changes require evidence from side-by-side comparison.

## Sidebar ratio

At common desktop sizes the sidebar should generally occupy about 18–24% of the application width.

At narrow split-screen widths it may occupy more.

It must not visually dominate the application.

## Conversation column

Main conversation content must be centered.

```css
.conversation-column {
  width: min(calc(100% - 48px), var(--content-max-w));
  margin-inline: auto;
}
```

Assistant text should not stretch across the entire main pane.

---

# 4. Colors

Use neutral colors only.

## Light theme

```css
:root {
  --bg-app: #ffffff;
  --bg-sidebar: #f7f7f6;
  --bg-hover: #f1f1ef;
  --bg-selected: #ebebe9;
  --bg-elevated: #ffffff;

  --text-primary: #252523;
  --text-secondary: #777772;
  --text-tertiary: #a0a09a;

  --border-subtle: #e9e9e6;
  --border-medium: #deded9;

  --status-error-bg: #fff6f4;
  --status-error-border: #f0c9c1;
  --status-error-text: #a74f43;

  --shadow-composer:
    0 1px 2px rgba(0,0,0,.04),
    0 5px 18px rgba(0,0,0,.055);
}
```

Avoid pure black text.

Avoid colored accents unless they convey state.

---

# 5. Typography

Use system UI fonts.

```css
font-family:
  Inter,
  ui-sans-serif,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "Noto Sans KR",
  Roboto,
  Helvetica,
  Arial,
  sans-serif;
```

Do not bundle proprietary fonts.

Code:

```css
font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

## Typography tokens

```css
--font-xs: 12px;
--font-sm: 13px;
--font-md: 14px;
--font-chat: 15px;
--font-header: 15px;
```

Line heights:

```text
navigation      1.25
metadata        1.35
chat prose      1.60–1.70
code            1.50
```

---

# 6. Sidebar specification

Target structure:

```text
Qwen Local ▾                       search  status

New chat
Projects
Search

RECENT
Conversation A
Conversation B
Conversation C
...
```

If Projects requires a dedicated list:

```text
PROJECTS
Project A
Project B

RECENT
Conversation A
...
```

But do not show empty section chrome unnecessarily.

## Sidebar row

```css
.sidebar-row {
  min-height: 36px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 14px;
}
```

Icon:

```text
16px
1.5–1.75px stroke
```

Do not use 20px+ icons.

## Search

Primary pattern:

```text
top search icon
Ctrl+P
```

Remove the persistent large “Search chats” box from the normal sidebar baseline.

If chat search is needed, open it as a command/search overlay.

---

# 7. Main header

Use:

```text
[folder/project icon]  New chat / project title   […]       [optional actions]
```

Height:

```text
50–56px
```

Border:

```text
1px bottom border using --border-subtle
```

Buttons:

- icon-only where obvious
- 28–32px hit area
- tooltip on hover
- no heavy backgrounds unless hovered

“Share” should only exist if the local app actually implements an equivalent action.

Do not add fake reference features only to match the screenshot.

---

# 8. Empty chat state

This section is strict.

## Forbidden baseline

Do not render:

```text
large decorative icon
How can I help?
large subtitle
```

## Required baseline

Render a quiet blank canvas.

Optional muted text:

```text
Ask Qwen Local
```

must be:

- <= 14px
- low contrast
- near the composer
- not centered as a hero title

The composer remains the primary visible interaction.

---

# 9. Conversation presentation

## User messages

Use a small neutral rounded surface where appropriate.

```text
max width: 65–75% of conversation column
background: neutral selected/hover tone
radius: 14–18px
```

Do not use strong brand colors.

## Assistant messages

Render primarily as document-style text.

No outer card.

Use direct Markdown on main background.

## Message spacing

```text
between user and assistant group: 22–30px
between paragraphs: 10–14px
between activity rows: 5–8px
```

---

# 10. Activity rows

This is a major fidelity feature.

Use activity rows for:

- file reads
- project searches
- OCR
- PDF extraction
- backend restart
- context build
- model load

Example:

```text
▾ Files read
   main.rs
   Cargo.toml

⌕ Searched main.rs for contextBudget
```

Rules:

- 13px text
- muted gray
- compact
- no outer card by default
- completed groups collapse
- running item may remain expanded
- state icon <= 16px

---

# 11. Composer

The composer must visually converge before other polish.

## Geometry

```css
.composer {
  width: min(calc(100% - 48px), 720px);
  min-height: 88px;
  border: 1px solid var(--border-medium);
  border-radius: 18px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-composer);
}
```

Bottom offset:

```text
16–24px
```

The composer should appear visually similar to the reference in scale.

## Layout

```text
[attachment/context chips]

Prompt textarea...

+       context/status             model/status      mic       send/stop
```

Controls should not compete with the text area.

## Send / Stop

Idle:

```text
small circular or compact send control
```

Generating:

```text
dark circular Stop control
```

Generation state must not resize the composer.

---

# 12. Project and file UI

Project file browsing should feel like part of the same desktop tool.

File tree:

```text
row height          28–32px
font                13px
icon                14–16px
indent              12px per level
```

Avoid VS Code-level visual noise.

Project context chips:

```text
@App.tsx
@main.rs
```

Keep them compact.

---

# 13. Menus, popovers, dialogs

Use accessible open primitives.

Preferred:

- Radix UI
- shadcn/ui as scaffolding only
- Lucide icons

Do not ship stock shadcn styling unchanged.

Every primitive must be restyled to match this file.

Menus should have:

```text
font 13–14px
row 30–34px
radius 8–10px
subtle shadow
```

---

# 14. Visual fixture mode

A deterministic visual mode is mandatory.

The current browser preview fails because Tauri `invoke` is not available.

Create a platform abstraction so UI can run without real Tauri APIs.

Suggested architecture:

```text
UI
 ↓
PlatformAdapter
 ├── TauriPlatformAdapter
 └── VisualFixtureAdapter
```

Visual fixture mode must:

- never call real Tauri `invoke`
- load deterministic fake projects
- load deterministic conversations
- simulate tool activities
- simulate generating state
- simulate attachments
- never show backend errors
- disable network requirements

Example route or flag:

```text
?visual-fixture=conversation
?visual-fixture=empty
?visual-fixture=generating
```

This allows Playwright screenshot tests in a browser without corrupting the visual baseline with Tauri errors.

---

# 15. Required visual fixtures

Create deterministic states:

```text
empty-chat
normal-chat
long-chat
tool-running
tool-complete
code-answer
project-context
attachments
generating
backend-recoverable-error
command-palette
settings
dark-theme
```

The empty-chat fixture must specifically verify that no marketing hero exists.

---

# 16. Reference convergence workflow

Do not redesign from memory.

For each major visual phase:

```text
1. Open the supplied Codex reference.
2. Open Qwen Local at the same approximate content size.
3. Put them side by side.
4. Compare one region at a time.
5. Fix geometry first.
6. Fix typography second.
7. Fix spacing third.
8. Fix colors/borders fourth.
9. Fix micro-interactions last.
10. Capture a new screenshot.
```

Review order:

```text
A. outer shell
B. sidebar
C. main header
D. conversation width
E. message typography
F. activity rows
G. composer
H. menus/popovers
```

Do not attempt to fix all regions simultaneously.

---

# 17. Visual regression gate

Visual regression is not optional.

Use Playwright screenshot tests for browser fixture mode.

Example concept:

```ts
await page.goto('/?visual-fixture=normal-chat');
await expect(page).toHaveScreenshot('normal-chat.png');
```

Use fixed viewport sizes.

Recommended:

```text
1440 × 900
1280 × 800
1024 × 768
```

The 1024-width fixture is important because the supplied comparison is similar to a split-screen desktop layout.

## Baseline policy

There are two image types.

### External visual reference

The supplied Codex screenshot.

Use for manual side-by-side comparison only.

Do not ship it.

### Qwen Local golden baseline

After Qwen reaches acceptable fidelity, create Qwen-owned baseline screenshots.

Automated regression tests compare only against these Qwen Local baselines.

Do not automatically update golden screenshots after failures.

Update them only after explicit design review.

---

# 18. Pixel-drift discipline

When a screenshot visually differs, do not immediately redesign components.

Classify the mismatch:

```text
geometry
typography
spacing
color
icon
state
content
```

Fix the smallest source.

Example:

```text
sidebar feels too large
```

Do not rebuild Sidebar.

Measure:

```text
width
row height
font size
padding
section gap
```

Then adjust tokens.

This avoids visual drift across the rest of the app.

---

# 19. UI review scorecard

Every visual review must report these separately.

```text
Shell geometry        /10
Sidebar fidelity      /10
Header fidelity       /10
Conversation density  /10
Composer fidelity     /10
Typography            /10
Spacing               /10
Color/border fidelity /10
Interaction quality   /10
Accessibility         /10
```

A design phase does not pass if any of these is below 8/10:

```text
Shell geometry
Sidebar fidelity
Composer fidelity
Typography
```

Do not average away a major mismatch.

---

# 20. Current Qwen-specific corrections

Before further visual polish, Codex should implement these exact changes.

## Correction A

Remove:

```text
large centered sparkle icon
How can I help?
large explanatory subtitle
```

from empty chat.

## Correction B

Remove the permanent sidebar search input from the default layout.

Expose search through:

```text
search icon
Ctrl+P
```

## Correction C

Reduce sidebar navigation typography and vertical spacing.

## Correction D

Make the main header more compact.

## Correction E

Always show the floating composer in empty chat.

## Correction F

Replace raw red backend exception panels with compact recoverable status UI.

## Correction G

Perform screenshot comparison in Tauri or visual-fixture mode, never in a broken browser/Tauri hybrid state.

---

# 21. Performance constraints

Visual fidelity must not damage responsiveness.

Streaming:

- do not rerender the entire conversation for every token
- batch visual updates when needed
- preserve typing responsiveness
- only auto-scroll while user remains near bottom

Large histories:

- use virtualization only after measurement shows need
- TanStack Virtual is acceptable

Heavy modules:

- lazy-load Shiki
- lazy-load KaTeX
- lazy-load PDF rendering
- lazy-load OCR-specific UI

---

# 22. Accessibility

Follow WAI-ARIA APG.

Required:

- visible focus
- semantic buttons
- labels for icon-only buttons
- dialog focus trap
- correct menu/listbox behavior
- focus restoration
- reduced motion support

Do not announce streaming token-by-token to screen readers.

---

# 23. Open-source reference stack

Use these as implementation references where compatible.

```text
Radix UI
https://www.radix-ui.com/primitives

shadcn/ui
https://ui.shadcn.com/docs

Lucide
https://lucide.dev/

cmdk
https://github.com/pacocoursey/cmdk

TanStack Virtual
https://tanstack.com/virtual/latest

Playwright visual snapshots
https://playwright.dev/docs/test-snapshots

WAI-ARIA APG
https://www.w3.org/WAI/ARIA/apg/
```

The UI/UX Pro skill may be used for visual review when available.

It must review against this document and the supplied screenshot.

It must not substitute generic trend-based styling for reference fidelity.

---

# 24. Component boundaries

Do not centralize the visual implementation in `App.tsx`.

Target:

```text
AppShell
├── Sidebar
│   ├── SidebarHeader
│   ├── NavRow
│   ├── ProjectList
│   └── RecentConversationList
│
└── MainPane
    ├── ConversationHeader
    ├── ConversationViewport
    │   ├── UserMessage
    │   ├── AssistantMessage
    │   ├── ActivityGroup
    │   └── CodeBlock
    │
    └── Composer
        ├── AttachmentStrip
        ├── PromptInput
        └── ComposerToolbar
```

Tokens belong in a single theme/style source.

Do not duplicate dimensions across components.

---

# 25. Implementation phases

## VISUAL PHASE A — Reference shell

Only:

- sidebar width
- main header height
- main canvas
- composer geometry

No typography polish.

Pass when geometry is visibly close.

## VISUAL PHASE B — Density

Only:

- row heights
- font sizes
- icon sizes
- padding
- section gaps

Pass when the sidebar and header no longer feel like a generic web dashboard.

## VISUAL PHASE C — Conversation

Only:

- user bubble
- assistant prose
- tool/activity rows
- code blocks
- content width

## VISUAL PHASE D — Empty state

Verify:

- no hero
- no giant icon
- no large title
- composer is dominant

## VISUAL PHASE E — Interaction

- hover
- selected
- focus
- menus
- search
- stop/send
- error/recovery

## VISUAL PHASE F — Screenshot convergence

Run deterministic fixtures.

Generate comparison screenshots.

Fix remaining measurable drift.

Do not proceed to unrelated functionality during this phase.

---

# 26. Completion criteria

UI/UX work is not complete until:

- Tauri content is visually comparable without browser chrome
- empty chat does not resemble a landing page
- sidebar density is close to the supplied reference
- main header is compact
- conversation width is restrained
- composer is consistently visible and reference-like
- raw backend errors never appear in baseline views
- visual fixture mode works without Tauri `invoke`
- screenshot regression fixtures exist
- light theme passes first
- dark theme is derived after light theme convergence
- proprietary assets are not copied
- all existing Qwen features remain functional

---

# 27. Final instruction to Codex

Read this file before modifying UI.

Treat every visible mismatch against the supplied Codex Desktop screenshot as a defect to classify and reduce.

Prioritize:

```text
geometry
→ density
→ typography
→ spacing
→ color
→ microinteraction
```

Do not invent additional UI while reference convergence is incomplete.

Do not use a large “How can I help?” hero empty state.

Do not use a permanent large sidebar search field.

Do not compare a Chrome-hosted page containing Tauri errors against the desktop reference.

Build a deterministic browser visual-fixture adapter or capture the actual Tauri window.

Use open-source primitives and Qwen Local branding.

Preserve existing functionality.

At the end of each visual phase, provide:

```text
VISUAL PHASE STATUS
Shell geometry:
Sidebar fidelity:
Header fidelity:
Conversation density:
Composer fidelity:
Typography:
Spacing:
Color/borders:
Regression tests:
Known mismatches:
Screenshots captured:
```

Stop after each visual phase for review.
