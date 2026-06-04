# Discharge Summary Agent

> **DRAFT TOOL — All output must be reviewed, corrected, and signed by the responsible clinician before clinical or administrative use.**

An agentic AI system that reads raw patient PDF documents and produces a structured discharge summary draft for clinician review. Built on Gemini 2.5 Pro with a FastAPI backend and a React UI.

---

## Quick Start

```bash
# Backend
pip install -r requirements.txt
cp .env.example .env          # add your GEMINI_API_KEY
python -m uvicorn api:app --host 0.0.0.0 --port 8001

# Integrated frontend (separate terminal)
cd dispatch-frontend && npm install && npm run dev   # http://localhost:3000

# CLI (single patient, no server needed)
python main.py data/patient_57dee4f4/
```

---

## Agent Loop Design

The agent is a multi-turn tool-calling loop built directly against the Gemini SDK — no framework. `DischargeAgent.run()` selects one of two modes based on the input:

**One-shot mode** (single PDF ≤ 100 pages): The PDF is uploaded to the Gemini Files API and placed directly in the context window. Gemini reads the full document and calls all tools in a single response batch — typically `check_drug_interactions` → `flag_for_review` (×N) → `finalize_summary`.

**Loop mode** (multiple PDFs or > 100 pages): Gemini is given a list of filenames and must call `read_document` for each one. Context accumulates across turns. After reading all documents Gemini assembles the medication list, calls `check_drug_interactions`, raises any flags, and calls `finalize_summary` to terminate the loop.

The agent has four tools:

| Tool | Purpose |
|---|---|
| `read_document` | Extract text from a named PDF (loop mode only) |
| `check_drug_interactions` | Check discharge meds against a known-interaction table |
| `flag_for_review` | Append a `critical` / `warning` / `info` flag to the summary |
| `finalize_summary` | Deliver all structured fields and terminate the loop |

The loop cap is **25 steps**. If the agent hits it without finalizing, a `critical` flag is attached noting the summary is incomplete.

Every LLM response is recorded as one or more `AgentStep` entries: reasoning (including Gemini 2.5 Pro's internal chain-of-thought) → tool chosen → inputs → result → next decision. These are written to `agent_trace.json` alongside the summary.

---

## No-Fabrication Guardrail

This is the central safety constraint, enforced at three layers:

1. **System prompt — absolute rules.** The prompt opens with six rules labeled "ABSOLUTE — never violate." Rule 1: "Never invent, infer, or guess any clinical fact. If information is not explicitly in the documents, use null. A plausible value is still a fabricated value."

2. **Schema enforcement.** The `finalize_summary` tool declaration marks all optional fields as nullable. Gemini cannot omit them — it must pass `null` for any field not found. There is no free-text fallback that could sneak in a hallucination.

3. **Flag-first default.** The prompt instructs the agent to call `flag_for_review` for every missing required field, every conflict, every undocumented medication change, and every pending result — before finalizing. The output format makes missing data visible (`NOT FOUND IN DOCUMENTS`) rather than silent.

The output is structurally incapable of looking complete when it isn't: flags appear at the top of the Markdown draft in a dedicated "⚠ FLAGS REQUIRING CLINICIAN REVIEW" block.

---

## Failure and Conflict Handling

**API failures:** `_call_with_retry` retries up to 3 times with exponential backoff (2s, 4s, 8s) for rate-limit errors (HTTP 429). Other errors are retried twice, then a `critical` system flag is added and the agent exits gracefully with whatever data it has — it never crashes or returns a silent partial result.

**PDF extraction failures:** Each page is attempted independently. If embedded text is sparse (< 100 characters, indicating a handwritten or scanned page), the page is rendered to PNG and sent to Gemini Vision for OCR. If OCR itself fails, the page is annotated `[OCR FAILED: <reason>]` in the extracted content so the agent knows the information is unavailable rather than absent.

**Conflicting information:** The system prompt explicitly instructs the agent: "If two documents disagree, call `flag_for_review` — do not pick one arbitrarily." In practice this produces `critical` flags for diagnosis conflicts (e.g., one note says "Acute Gastroenteritis", the ER chart says "DKA") and `warning` flags for softer disagreements. The conflicting values are both preserved in the flag's issue text.

**Missing documents:** If the patient folder contains no PDFs, a `critical` flag is added immediately and an empty-but-valid `DischargeSummary` is returned.

---

## Part 2 — Learning from Doctor Edits

Part 2 is implemented in `part2/` and exposed in the `dispatch-frontend` "Part 2 — Learning Loop" tab.

**Reward signal:** Normalized character-level edit distance between the agent's draft JSON and the simulated doctor-edited JSON, with per-section edit distance for diagnosis, demographics, medications, allergies, follow-up, pending results, and other high-value sections. Lower edit distance means less clinician editing; reward is `1.0 - edit_distance`.

**Simulated reviewer:** `part2/doctor.py` applies a deterministic hidden editing policy to every draft. It adds ICD-10 codes, replaces unverifiable demographic nulls with an explicit verification phrase, marks missing medication doses for prescriber verification, standardizes allergy wording, appends a clinician-signature reminder, and ensures pending-result flags are reflected in `pending_results`.

**Learning mechanism:** `part2/memory.py` compares each draft with the edited version. When a section changes meaningfully, it records the relevant correction rule in a persistent correction memory. On the next synthetic patient, `part2/runner.py` injects the learned rules into the Gemini system prompt so later drafts should need fewer edits.

**Improvement measurement:** `POST /part2/run` runs the loop across `part2/synthetic_patients/`, writes per-patient draft/edited/metrics files under `part2/results/`, and writes a learning curve to `part2/results/run_summary.json`. The frontend polls `/part2/status`, visualizes the before/after edit-distance curve, and lets you inspect draft-vs-edited diffs per patient.

**Limitations of the learning approach (discussed further below).**

---

## Limitations

**Drug interaction database** is a hand-coded mock with 9 known pairs. It is not a real clinical decision support system (e.g., Lexicomp, Micromedex). In production this tool would call a licensed API.

**In-memory job store** — all job state is lost on server restart. A production deployment would use a database.

**No authentication** — all API endpoints are open. Not suitable for production deployment without an auth layer.

**One-shot reasoning** — in one-shot mode Gemini returns all tool calls in a single response batch. The reasoning field in the trace reflects the model's thinking for the entire batch, not per-tool. Loop mode produces richer per-step reasoning because each `read_document` response is a separate turn.

**Part 2 learning risks:** Optimizing purely for reduced edit distance can be gamed — an agent can lower its score by being vaguer (shorter text = fewer edits) or by mimicking clinician writing style without getting the medicine right. The safety guarantees from Part 1 (null for missing, flag for conflicts) are enforced at the schema and prompt level and cannot be overridden by the learned prompt modifications; the correction memory only affects formatting and structure, not clinical fact decisions.

**Cold start:** The simulated reviewer's editing policy is itself a model — it may not reflect what real clinicians would change. Any improvement measured against simulated edits may not transfer to real clinical workflow without a validation study.

---

## What I Would Do With More Time

- **Real drug interaction API** (Lexicomp or an open alternative like OpenFDA) to replace the mock table
- **Persistent job store** (PostgreSQL or SQLite) so the UI survives server restarts
- **Structured conflict resolution UI** — let the clinician resolve flagged conflicts in the browser and feed the decision back to the agent for future similar cases
- **Streaming trace** — push agent steps to the frontend via SSE as they happen so the clinician can watch the agent reason in real time
- **Multi-patient batch CLI** — run the agent across all patients in a directory in parallel and generate a summary report
- **Part 2 with real feedback** — instrument the UI so clinician edits are captured, replace the simulated reviewer with actual edit data, and validate that edit-distance reduction correlates with clinical accuracy rather than just style conformity

---

## Submission Checklist

- [x] Source code with run instructions
- [x] Generated discharge summaries and step traces for all patients in the provided set (`outputs/`)
- [x] Part 2: simulated reviewer, learning mechanism, before/after metric
- [ ] Video demo (3–5 min, two patients, trace walkthrough, flag/escalate moment)
