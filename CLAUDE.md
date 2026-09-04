# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebRTC remote control system: a headless Chrome instance controlled via CDP (Chrome DevTools Protocol), with screen streaming (MJPEG/H.264) and user interaction recording/playback. Includes a self-healing element locator engine (`webrtc_healing`) for robust test automation.

## Python Environment

All Python commands MUST use the conda `omni` environment:
```bash
/opt/anaconda3/envs/omni/bin/python
/opt/anaconda3/envs/omni/bin/pip
```
Never use bare `python`, `python3`, or `pip` without the full path.

## Common Commands

### Start all services
```bash
./start.sh            # Full startup (Flask + AI + OCR + UI build)
./start.sh --no-ocr   # Skip optional OCR service
```

### Start Flask server only
```bash
/opt/anaconda3/envs/omni/bin/python server.py
```

### Start OCR service
```bash
/opt/anaconda3/envs/omni/bin/python ai_service/ocr_service.py
```

### Build controller UI (React + Vite)
```bash
cd controller_ui && npm run build
```
Build output goes to `static/controller-app/`.

### Install dependencies
```bash
/opt/anaconda3/envs/omni/bin/pip install -r requirements.txt
/opt/anaconda3/envs/omni/bin/pip install -e .   # webrtc_healing package (dev mode)
cd ai_service && npm install
cd controller_ui && npm install
```

### Tests
Tests are in `archive_unused/2026-02-28/tests/` (archived). No active test suite in the main tree.

## Architecture

### Backend (Python/Flask) — `server.py`
Flask app on port 5566. Runs an async event loop in a background thread for CDP/WebRTC operations. Routes:
- `/controller` — serves the React controller SPA
- `/api/webrtc/offer` — WebRTC SDP negotiation
- `/api/session/*` — browser session lifecycle
- Various CDP proxy endpoints (navigate, click, input, screenshots)

### Headless Chrome Bridge — `headless/`
- `chrome_manager.py` — launches/manages headless Chrome with CDP
- `cdp_client.py` — CDP protocol communication (screenshots, input dispatch, DOM)
- `webrtc_bridge.py` — WebRTC peer connection management via aiortc
- `stream_server.py` / `mjpeg_server.py` — screen streaming (port 5567), supports MJPEG and H.264 modes
- `websocket_recorder_handler.py` — WebSocket-based recording handler
- `selector_generator.py` — generates 6 selector types (ARIA, testid, ID, text, CSS, XPath) with stability scoring
- `step_merger.py` — merges consecutive input/click steps (>85% reduction)
- `recorder_inject.js` / `recorder_inject_v2.js` / `recorder_inject_v3.js` — JS injected into pages to capture user events

### Self-Healing Locator Engine — `webrtc_healing/`
Installable Python package (`pip install -e .`). 7-strategy element location with automatic fallback:
1. XPath → 2. CSS Selector → 3. Text Content (DOM/OCR) → 4. Image Template (Airtest) → 5. Normalized Coords → 6. AI Locate (Midscene) → 99. Raw Coords

- `healing_locator.py` — `HealingLocator` class, tries strategies in priority order
- `step_executor.py` — action dispatcher (navigate, click, input, hover, scroll, keypress, wait)
- `services.py` — external service integrations (OCR, Midscene AI)

### AI Service — `ai_service/`
Node.js service on port 3100. Provides AI-powered element location via Midscene integration. OCR service on port 9788.

### Controller UI — `controller_ui/`
React + TypeScript + Vite + Tailwind CSS. Source in `controller_ui/src/`. Key areas:
- `src/controller/` — core controller logic including `aiCore.ts` (logic steps)
- `src/modules/` — feature modules
- `src/store/` — state management
- `src/ui/` — shared UI components

### Chrome Extension — `chrome_extension/`
Browser extension for DOM export and element location assistance.

## Key Ports
| Port | Service |
|------|---------|
| 5566 | Flask main server |
| 5567 | Stream server (MJPEG/H.264) |
| 9222 | Chrome remote debugging (CDP) |
| 3100 | AI service (Node.js) |
| 9788 | OCR service |

## Configuration
`config.py` — server host/port, Chrome settings, encoding mode (mjpeg/h264), logging.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ruyi** (2293 symbols, 7195 relationships, 192 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ruyi/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ruyi/clusters` | All functional areas |
| `gitnexus://repo/ruyi/processes` | All execution flows |
| `gitnexus://repo/ruyi/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
