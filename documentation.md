# Discharge Summary Agent — Documentation

> **DRAFT TOOL — All output must be reviewed, corrected, and signed by the responsible clinician before use in any clinical or administrative context.**

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Repository Layout](#repository-layout)
4. [Architecture & Data Flow](#architecture--data-flow)
5. [Agent Modes](#agent-modes)
6. [Tools](#tools)
7. [PDF Extraction Logic](#pdf-extraction-logic)
8. [Data Models](#data-models)
9. [API Reference](#api-reference)
10. [Frontend](#frontend)
11. [Safety Design](#safety-design)
12. [Running the Project](#running-the-project)
13. [Outputs](#outputs)
14. [Known Limitations](#known-limitations)

---

## Overview

The Discharge Summary Agent is an AI-powered system that ingests patient PDF documents and produces a structured hospital discharge summary draft for clinician review.

Given one or more PDF files for a patient (admission notes, progress notes, lab results, medication records, handwritten charts), the agent:

- Extracts all relevant clinical information
- Reconciles medications between admission and discharge
- Checks for known drug-drug interactions
- Flags missing fields, conflicts between documents, and patient safety concerns
- Outputs a structured summary in both Markdown and JSON

The entire pipeline is surfaced through a REST API and a React web UI.

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Model | Gemini 2.5 Pro (`google-genai` SDK) |
| Backend | FastAPI + Python 3.13 |
| PDF Extraction | PyMuPDF (fitz) + Gemini Vision OCR fallback |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| HTTP Server | uvicorn |

---

## Repository Layout

```
discharge-summary-agent/
├── api.py                       # FastAPI HTTP server — all endpoints
├── main.py                      # CLI entry point (standalone, not used by API)
├── requirements.txt             # Python dependencies
├── .env                         # GEMINI_API_KEY (not committed)
│
├── agent/
│   ├── __init__.py
│   ├── core.py                  # DischargeAgent class — main orchestrator
│   ├── models.py                # Dataclasses: Flag, AgentStep, AgentState, DischargeSummary
│   ├── tools.py                 # Tool definitions (Gemini function declarations) + dispatcher
│   ├── pdf_reader.py            # PDF text extraction with OCR fallback
│   ├── prompts.py               # System prompt + user prompt templates
│   └── output_formatter.py     # Renders Markdown, JSON, and trace files
│
├── dispatch-frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx              # Root component — Part 1 / Part 2 tabs
│       ├── api.ts               # Typed HTTP client for the backend
│       ├── types.ts             # TypeScript interfaces mirroring backend models
│       └── components/
│           ├── UploadAndJobsView.tsx   # Upload UI, job table, polling logic
│           ├── Part2View.tsx           # Learning-loop metrics, curve, and diffs
│           ├── SummaryView.tsx         # Summary layout (flags + sections + trace)
│           ├── SummarySections.tsx     # Individual summary cards
│           ├── FlagsPanel.tsx          # Color-coded flag sidebar
│           └── TraceTimeline.tsx       # Collapsible agent step debugger
│
├── part2/
│   ├── doctor.py                # Deterministic simulated reviewer
│   ├── memory.py                # Correction-memory rules
│   ├── metrics.py               # Edit-distance reward metrics
│   ├── runner.py                # Part 2 learning-loop runner
│   ├── synthetic_patients/      # Synthetic note text for feedback simulation
│   └── results/                 # Draft/edit pairs, metrics, and learning curve
│
├── data/
│   └── <patient_id>/            # Uploaded PDFs (auto-created per job)
│
└── outputs/
    └── <patient_id>/            # Per-run outputs (auto-created)
        ├── discharge_summary.md
        ├── discharge_summary.json
        └── agent_trace.json
```

---

## Architecture & Data Flow

```
Browser (React)
    │
    │  POST /process  (multipart PDF upload)
    ▼
api.py  ──  saves PDFs to  data/<patient_id>/
            creates job   { status: "queued" }
            starts background thread
    ▼
agent/core.py — DischargeAgent.run()
    │
    ├── ONE-SHOT MODE  (1 PDF, ≤ 100 pages)
    │     Upload PDF to Gemini Files API
    │     Single prompt with PDF in context
    │     Gemini calls tools directly (no read_document)
    │
    └── LOOP MODE  (multiple PDFs or > 100 pages)
          Multi-turn agentic loop (max 25 steps)
          Gemini calls read_document for each file
          Accumulates context across turns
    │
    ▼ (both modes converge here)
agent/tools.py — execute_tool()
    ├── read_document          →  pdf_reader.py
    ├── check_drug_interactions →  local lookup table
    ├── flag_for_review        →  appends to AgentState.flags
    └── finalize_summary       →  writes AgentState.finalized_data, stops loop
    │
    ▼
agent/output_formatter.py — save_outputs()
    Writes: discharge_summary.md
            discharge_summary.json
            agent_trace.json
    │
    ▼
api.py  ──  updates job  { status: "done", summary: {...}, steps: [...] }
    │
    ▼
Browser polls  GET /jobs/{job_id}  every 3 seconds
    └── renders SummaryView when status == "done"
```

---

## Agent Modes

### Mode 1: One-Shot

**Triggered when:** exactly one PDF is uploaded and it has 100 pages or fewer.

The PDF is uploaded to the Gemini Files API and included directly in the model's context window. Gemini reads the whole document in one shot and calls the tools in sequence:

1. `check_drug_interactions` — with the full discharge medication list
2. `flag_for_review` — once per issue found
3. `finalize_summary` — delivers all structured fields

**Advantage:** fast, single API call, full document context at once.

### Mode 2: Agent Loop

**Triggered when:** multiple PDFs are uploaded, or a single PDF exceeds 100 pages.

Gemini is given a list of available filenames and must call `read_document` for each one. The loop runs until `finalize_summary` is called or the 25-step cap is hit.

Typical step sequence:
```
Step 1:  read_document("admission_note.pdf")
Step 2:  read_document("lab_results.pdf")
Step 3:  read_document("medication_chart.pdf")
Step 4:  check_drug_interactions([...full med list...])
Step 5:  flag_for_review("medications", "Warfarin added with no documented reason", "warning")
Step 6:  flag_for_review("pending_results", "CBC result pending", "info")
Step 7:  finalize_summary({...all fields...})
```

If the agent hits 25 steps without finalizing, a critical flag is added and the partial summary is returned.

---

## Tools

All tools are declared as Gemini `FunctionDeclaration` objects and executed by the Python dispatcher in `agent/tools.py`.

### `read_document`
**Available in:** Loop mode only

Reads and extracts the full text from a named PDF file in the patient folder. The agent calls this once per document before synthesizing anything.

```
Input:  { filename: "admission_note.pdf" }
Output: { filename: str, content: str, error: str | null }
```

Internally delegates to `pdf_reader.read_document_for_agent()` — see [PDF Extraction Logic](#pdf-extraction-logic).

---

### `check_drug_interactions`
**Available in:** Both modes

Checks a list of medication names against a known interaction database. The system prompt instructs the agent to always call this after assembling the complete discharge medication list.

```
Input:  { medications: ["warfarin", "aspirin", "metformin"] }
Output: {
  interactions_found: [{ severity: "critical", description: "..." }],
  interaction_count: 1,
  safe: false
}
```

Current known pairs in the database (`agent/tools.py`):

| Pair | Severity |
|---|---|
| Warfarin + Aspirin | critical |
| Warfarin + Ibuprofen | critical |
| Amiodarone + Warfarin | critical |
| Azithromycin + Amiodarone | critical |
| Metformin + Contrast | warning |
| Lisinopril + Potassium | warning |
| SSRI + Tramadol | warning |
| Ofloxacin + Meftal Spas | warning |
| Loperamide + Ondansetron | warning |

---

### `flag_for_review`
**Available in:** Both modes

Appends a clinical flag to the summary. The agent is instructed to call this for every issue it encounters — missing required fields, document conflicts, unexplained medication changes, pending results, and drug interactions.

```
Input:  { section: "medications", issue: "Aspirin added — no reason documented", severity: "warning" }
Output: { flagged: true, section: str, severity: str }
```

Severity levels: `info` · `warning` · `critical`

---

### `finalize_summary`
**Available in:** Both modes

Delivers the completed structured summary as a single function call. This is the terminal action — calling it stops the agent loop. Every field not found in the documents must be `null`.

```
Input: {
  demographics:          { name, age, sex, mrn, attending_physician },
  admission_date:        str | null,
  discharge_date:        str | null,
  principal_diagnosis:   str | null,
  secondary_diagnoses:   str[],
  hospital_course:       str | null,
  procedures:            str[],
  admission_medications: [{ name, dose, frequency, ... }],
  discharge_medications: [{ name, dose, frequency, ... }],
  medication_changes:    [{ drug, change_type, reason }],
  allergies:             str[],
  follow_up:             str | null,
  pending_results:       str[],
  discharge_condition:   str | null
}
```

Required fields: `demographics`, `principal_diagnosis`, `hospital_course`, `discharge_medications`, `medication_changes`, `allergies`.

---

## PDF Extraction Logic

`agent/pdf_reader.py` uses a hybrid strategy to handle both digital (typed) and handwritten clinical documents.

```
For each page in the PDF:
  1. Extract embedded text via PyMuPDF (fitz)
  2. If embedded text length > 100 characters:
       → Use it directly  (fast, accurate for typed docs)
  3. Else:
       → Render the page to a 2× PNG image
       → Send to Gemini Vision with prompt:
         "Transcribe ALL text including handwritten content.
          Mark illegible text as [ILLEGIBLE].
          Preserve structure (tables, lists, sections)."
       → Use the transcription
```

The 100-character threshold distinguishes typed pages (thousands of chars) from scanned/handwritten pages (near-zero embedded text).

For one-shot mode, `upload_pdf()` uploads the entire PDF to the Gemini Files API and polls until the upload state is `ACTIVE` before proceeding. The file is deleted from the Files API after the run.

---

## Data Models

All models are plain Python dataclasses in `agent/models.py`.

### `Flag`
```python
section:  str   # which summary section the issue belongs to
issue:    str   # human-readable description
severity: str   # "info" | "warning" | "critical"
```

### `AgentStep`
Records every tool call the agent made — used for the audit trace.
```python
step_num:      int
reasoning:     str    # model's text output before the function call
action:        str    # tool name
inputs:        dict   # arguments passed to the tool
result:        dict   # what the tool returned
next_decision: str    # "continuing" | "finalizing"
timestamp:     str    # ISO 8601
```

### `AgentState`
Mutable state accumulated across all steps in a single run.
```python
patient_id:      str
flags:           list[Flag]   # appended by flag_for_review
finalized_data:  dict | None  # set by finalize_summary
documents_read:  list[str]    # filenames processed so far
```

### `DischargeSummary`
The final output object, built from `AgentState.finalized_data`.
```python
patient_id, demographics, admission_date, discharge_date,
principal_diagnosis, secondary_diagnoses, hospital_course,
procedures, admission_medications, discharge_medications,
medication_changes, allergies, follow_up, pending_results,
discharge_condition, flags
```

---

## API Reference

Base URL: `http://localhost:8001`

All job processing runs in a background thread. Job state is stored in-memory and cleared on server restart.

---

### `GET /`
Health check.

**Response:**
```json
{ "service": "Discharge Summary Agent", "status": "running" }
```

---

### `POST /process`
Upload one or more patient PDFs. Returns immediately with a `job_id` to poll.

**Request:** `multipart/form-data`
- `files` (required): one or more `.pdf` files
- `patient_id` (optional): custom ID; defaults to `patient_<first 8 chars of job UUID>`

**Response `202`:**
```json
{
  "job_id": "a1b2c3d4-...",
  "patient_id": "MRN-12345",
  "files": ["note.pdf", "labs.pdf"],
  "status": "queued"
}
```

---

### `GET /jobs/{job_id}`
Poll for job status. When `status == "done"`, the full summary and step trace are included.

**Response (processing):**
```json
{
  "job_id": "...",
  "patient_id": "...",
  "status": "processing",
  "files": ["note.pdf"],
  "created_at": "2026-06-03T10:00:00"
}
```

**Response (done):**
```json
{
  "job_id": "...",
  "status": "done",
  "summary": { ...DischargeSummary fields... },
  "steps": [ ...AgentStep list... ],
  "completed_at": "2026-06-03T10:02:14"
}
```

**Response (error):**
```json
{
  "status": "error",
  "error": "LLM API error: ...",
  "completed_at": "..."
}
```

---

### `GET /jobs`
List all jobs. Summary and step payloads are omitted to keep the response small.

**Response:** array of job objects (status fields only)

---

### `POST /process/sync`
Same as `/process` but blocks until the agent finishes and returns the full result directly. Intended for testing only — do not use in production.

---

## Frontend

The React app (`dispatch-frontend/`) is a single-page application with Part 1 and Part 2 tabs.

### `UploadAndJobsView`
Shown on load and after navigating back from a summary.

- **Upload area:** drag-and-drop or click-to-select PDF files, optional Patient ID input
- **Run Agent button:** calls `POST /process`, then polls `GET /jobs/{job_id}` every 3 seconds while the job is active
- **Jobs table:** lists all past jobs with status badges; "View Summary" fetches the full payload and switches views

### `SummaryView`
Shown when a completed job is selected.

Layout is a two-column grid:

```
┌─────────────────┬──────────────────────────────┐
│  FlagsPanel     │  PatientInfoCard              │
│                 │  DiagnosesCard                │
│  Color-coded    │  HospitalCourseCard           │
│  critical /     │  MedicationsCard              │
│  warning /      │  ListsCard                    │
│  info flags     │  (allergies, follow-up,       │
│                 │   pending results)            │
└─────────────────┴──────────────────────────────┘
         TraceTimeline (collapsible, full width)
```

### `TraceTimeline`
A collapsible timeline at the bottom of the summary view. Each agent step is rendered as a card showing:
- Step number and timestamp
- Tool name (color-coded: green for `finalize_summary`, amber for `flag_for_review`)
- Model reasoning (italicized)
- Raw inputs and result JSON

This provides full auditability of what the agent did and why.

---

## Safety Design

Six hard constraints are built into the system prompt (`agent/prompts.py`) and cannot be overridden by document content:

| Rule | Enforcement |
|---|---|
| No fabrication | `null` for any field not explicitly found in documents |
| Flag conflicts | If two documents disagree, call `flag_for_review` — never pick one arbitrarily |
| Mark pending results | Awaited lab/imaging results go to `pending_results`, not estimated |
| Medication reconciliation | Admission vs discharge diff; any change without a documented reason is flagged |
| Drug interaction check | Mandatory `check_drug_interactions` call after assembling discharge meds |
| Draft labeling | Hardcoded in the Markdown output header, the UI header banner, and the footer |

The step cap (25) prevents runaway loops. If hit, a critical flag is attached to the summary noting it may be incomplete.

---

## Running the Project

### Prerequisites

```bash
# Python dependencies
pip install -r requirements.txt

# Frontend dependencies
cd dispatch-frontend && npm install
```

### Environment

Create `.env` in the project root:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

### Backend

```bash
python -m uvicorn api:app --host 0.0.0.0 --port 8001
```

Use `python -m uvicorn` (not the `uvicorn` binary directly) to ensure the correct Python environment is used.

### Frontend

```bash
cd dispatch-frontend
npm run dev     # development server on port 3000
npm run build   # production build
```

The frontend calls `http://localhost:8001` by default. Set `VITE_API_BASE` in `dispatch-frontend/.env` to use a different backend URL. Frontend and backend must be running simultaneously.

---

## Outputs

Each completed run writes three files to `outputs/<patient_id>/`:

### `discharge_summary.md`
Human-readable Markdown formatted for clinician review. Flags appear at the top for immediate visibility. All missing fields are labeled `NOT FOUND IN DOCUMENTS`. Medication changes with no documented reason are marked `⚠ REASON NOT DOCUMENTED`. Ends with a mandatory disclaimer.

### `discharge_summary.json`
Machine-readable JSON of the full `DischargeSummary` object. Suitable for downstream system integration or structured storage.

### `agent_trace.json`
Array of all `AgentStep` objects in execution order. Each step includes the tool name, inputs, result, model reasoning, and timestamp. Provides a complete audit trail of agent decision-making.

---

## Known Limitations

- **In-memory job store** — all job state is lost on server restart; no database persistence
- **Drug interaction database** — hard-coded mock with 9 known pairs; not a real clinical decision support system
- **No authentication** — all API endpoints are open; not suitable for production deployment as-is
- **No file size limits** — no server-side enforcement beyond Gemini Files API's own quotas
- **Rate limiting** — Gemini API rate limits are handled with exponential backoff (up to 3 retries), but sustained load may hit quota limits
- **Loop mode latency** — each `read_document` call is a separate Gemini API round-trip; many large documents will be slow
- **No persistent file cleanup** — uploaded PDFs in `data/` and output files in `outputs/` accumulate indefinitely
