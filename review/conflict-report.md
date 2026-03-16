# Conflict Report

Generated: 2026-03-15T06:07:50Z
Source: ../../PycharmProjects/webrtc/review/claim-ledger.yaml

**5 conflict(s) detected:**

## Conflict 1: inconsistent_statement [RESOLVED: DEC-001]

- **Claims:** CLM-cand-004, CLM-cand-032
- **Source ref:** specs/overview/spec.md:Domains
- **Truth kind:** candidate_inference
- **Statements:**
  - spec-gen identified only one domain: chrome-extension, which handles DOM export with XPath annotations
  - spec-gen only produced specs for one domain (chrome-extension) despite recognizing three components in the overview (chrome-extension, AI automation service, device/OTA management)

## Conflict 2: inconsistent_statement [RESOLVED: DEC-002]

- **Claims:** CLM-cand-006, CLM-cand-029, CLM-cand-034
- **Source ref:** specs/chrome-extension/spec.md:Sub-components
- **Truth kind:** candidate_inference
- **Statements:**
  - The chrome-extension domain is structured as a DOMExporterService orchestrator with 15 sub-components
  - The chrome-extension domain follows an orchestrator pattern where DOMExporterService coordinates 15 sub-components for DOM export
  - Many chrome-extension sub-component scenarios are unnamed placeholders with generic GIVEN/WHEN/THEN statements that provide no behavioral detail

## Conflict 3: inconsistent_statement [RESOLVED: DEC-003]

- **Claims:** CLM-cand-008, CLM-cand-030
- **Source ref:** specs/chrome-extension/spec.md:Requirement Exportdomtreewithxpath
- **Truth kind:** candidate_inference
- **Statements:**
  - exportDOMTreeWithXPath is the main entry point that coordinates DOM tree export; it accepts an optional rootElement parameter and defaults to document.body
  - The XPath generation pipeline follows a multi-stage process: build index, compute XPath per element, optimize XPath, handle iframe contexts

## Conflict 4: inconsistent_statement [RESOLVED: DEC-004]

- **Claims:** CLM-doc-042, CLM-doc-043
- **Source ref:** raw-docs/CLAUDE.md:§Headless Chrome Bridge
- **Truth kind:** intended_rule
- **Statements:**
  - The selector_generator produces 6 selector types (ARIA, testid, ID, text, CSS, XPath) with stability scoring. Each selector has a stability score from 0 to 1, and higher-stability selectors are prioritized. Dynamic attributes (like random class names) are marked as low stability.
  - The step_merger merges consecutive input/click steps with a target reduction rate of >85%.

## Conflict 5: inconsistent_statement [RESOLVED: DEC-005]

- **Claims:** CLM-cand-001, CLM-cand-002
- **Source ref:** specs/overview/spec.md:Technical Stack
- **Truth kind:** candidate_inference
- **Statements:**
  - The system is a monorepo with TypeScript as its primary language
  - The system uses Puppeteer and Chrome Extension as key frameworks

