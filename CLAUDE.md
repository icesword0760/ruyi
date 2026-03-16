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

This project is indexed by GitNexus as **webrtc** (11341 symbols, 31881 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/webrtc/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/webrtc/context` | Codebase overview, check index freshness |
| `gitnexus://repo/webrtc/clusters` | All functional areas |
| `gitnexus://repo/webrtc/processes` | All execution flows |
| `gitnexus://repo/webrtc/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
