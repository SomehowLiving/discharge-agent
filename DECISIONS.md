# Design Decisions & Thought Process

## 1. Why Not Extend AI?

The first instinct was to use Extend AI — a document processing platform with extraction, classification, and workflow APIs. It looked like a natural fit since the task is "extract structured data from documents."

We ruled it out for three reasons:
- Extend is optimised for **production pipelines with known schemas at scale**. This task is about building an agent with reasoning, not a data extraction pipeline.
- The assignment explicitly evaluates **agent design** — planning, tool use, recovery, conflict detection. Extend would abstract all of that away.
- Simple approach won: Claude/Gemini can read PDFs natively with vision, handle both typed and handwritten content, and reason about what it finds — all in one call.

**Decision: Use Gemini directly. No Extend.**

---

## 2. PDF Ingestion — Why Vision, Not pdfplumber

The patient PDFs turned out to be a mix of:
- Typed discharge summaries (easy — embedded text)
- Handwritten ER charts, nursing notes, investigation forms (hard)
- Scanned forms with partially filled handwriting

`pdfplumber` extracts embedded text only. It returns nothing useful for handwritten pages.

**Decision: Smart hybrid extraction.**
- Try embedded text first (fast, free)
- If a page yields < 100 characters of embedded text → it's handwritten → run Gemini vision OCR on that page as an image
- This keeps costs low (most typed pages skip the vision call) while handling all document types

---

## 3. Two-Mode Architecture

Not all patient folders are equal:
- A single short PDF (≤ 100 pages) → everything fits in Gemini's context window → **one-shot mode**: upload the PDF via Files API, one generate_content call, done.
- Multiple PDFs or edge cases → **agent loop mode**: agent has a `read_document` tool, reads files one at a time, fills fields incrementally.

The mode is detected automatically at runtime. Both modes produce identical output format. Both run the same post-extraction tools.

**Why this matters:** One-shot is faster and cheaper. Agent loop is necessary when documents can't all fit in one call. The assignment required demonstrating a real agent loop — so both modes had to exist and be testable.

---

## 4. Tool Design — What the Agent Actually Needs

Early thinking was: tools = extraction helpers. Wrong.

The tools aren't for extraction — Gemini reads the documents itself. The tools are for **post-extraction actions** the agent takes based on what it finds:

| Tool | Purpose |
|------|---------|
| `read_document` | (Loop mode only) Load a specific file into context |
| `check_drug_interactions` | Called after assembling discharge med list — mock DB lookup |
| `flag_for_review` | Called whenever agent finds a conflict, missing field, or pending result |
| `finalize_summary` | Submits the completed structured JSON — ends the loop |

The agent decides **when** to call each tool. That decision-making is what makes it an agent rather than a script.

---

## 5. SDK Switch — google-generativeai → google-genai

Initial implementation used `google-generativeai` (the older SDK). On first run it threw:

```
FutureWarning: All support for the google.generativeai package has ended.
KeyError: 'object'  ← Schema type enum mismatch
```

The package was deprecated. Migrated to `google-genai` (v2.x), which has a different API surface:
- `genai.Client(api_key=...)` instead of `genai.configure(...)`
- `client.models.generate_content(...)` instead of `model.generate_content(...)`
- `types.Schema(type=types.Type.OBJECT, ...)` instead of raw dicts
- Multi-turn managed manually via a `contents` list

The migration also required all `Part.from_text()`, `Part.from_uri()` calls to use keyword arguments (`text=`, `file_uri=`) — the new SDK is keyword-only.

---

## 6. No Fabrication Guardrail — How It's Enforced

The assignment's hardest requirement: the agent must never invent a clinical fact.

Enforced at three layers:
1. **System prompt**: Explicit rule — "null for anything not found in documents. A plausible value is still a fabricated value."
2. **`finalize_summary` schema**: All clinical fields accept null. The schema communicates that null is a valid and expected value.
3. **`flag_for_review` tool**: Agent is instructed to call this for every null required field, pending result, and conflict — making the gap visible rather than silently filled.

The agent cannot finish without calling `finalize_summary`, and the prompt instructs it to call `flag_for_review` before finalizing. Any field it cannot source gets a flag.

---

## 7. Real Conflicts Found in the Patient 2 PDF

The actual test PDF had a genuine clinical conflict baked in:
- **Discharge summary**: "Acute Gastroenteritis + UTI"
- **ER observation chart**: "DKA" (Diabetic Ketoacidosis), blood glucose 443 mg/dl, insulin given

The agent correctly flagged this as a critical conflict without prompting. This validated the approach — the flag_for_review tool was called autonomously with the right severity.

---

## 8. Part 2 — Learning from Doctor Edits

**The problem:** No real doctor-edited data exists. Had to manufacture the feedback loop.

**Simulated doctor:** A deterministic Python function applying 6 fixed rules to every draft:
1. Add ICD-10 codes to all diagnoses
2. Replace null demographics with "UNVERIFIED - CONFIRM WITH RECORDS"
3. Replace null medication doses with "[TO VERIFY WITH PRESCRIBER]"
4. Standardise "Not Known" allergies to full NKDA statement
5. Append "Clinician signature required before discharge." to follow-up
6. Add pending results reminder when flags mention pending items

The policy is hidden from the agent. The agent has to learn it from seeing corrections.

**Reward signal:** Normalised Levenshtein edit distance between draft and edited version. Lower = better (less the doctor had to change).

**Learning mechanism:** Correction memory. After each patient, compare which sections changed. For sections with edit distance > 0.05, add the corresponding correction rule to the system prompt for subsequent patients. By patient 4, all 6 rules are injected — edit distance drops measurably, from 0.0345 with zero rules to 0.0 by iteration 4, where it stays for all remaining patients.

**Why this approach:** Simpler and more interpretable than DPO or reward modelling. No training data required. Works with a handful of examples. The mechanism is transparent — you can read exactly what the agent learned and why.

**A note on the 100% improvement figure:** The run summary reports `before: 0.0339, after: 0.0, improvement: 1.0`. That result is expected, not suspicious — it's a direct consequence of the setup: a deterministic simulated doctor applying fixed rules, and a correction memory that is capable of learning exactly those rules. Both sides of the loop are controlled and synthetic. This is intentional: the goal was to demonstrate that the feedback mechanism works correctly in a closed loop, not to claim production-grade clinical improvement. In a real deployment the doctor's edits would be noisy, varied, and partially contradictory — the improvement curve would be slower and noisier, and edit distance alone would be an insufficient signal.

**Limitation acknowledged:** The agent can game this by being vaguer or mimicking the doctor's style without actually getting the medicine right. Edit distance is a proxy for quality, not a clinical accuracy measure. A real system would need clinician-validated ground truth.

---

## 9. Frontend — Why Keep It Simple

The frontend is React + TypeScript + Tailwind, no state management library, no routing. Two views: upload/jobs and summary. One tab for Part 2.

The Part 2 tab state loss bug (log disappearing on tab switch) was fixed by keeping both tab components mounted and toggling visibility with CSS `hidden` rather than conditional rendering — unmounting destroyed the local state.

The View Summary bug (blank page on click) was fixed by fetching the full job before opening the summary view. The jobs list endpoint strips `summary` and `steps` for payload size — clicking "View Summary" needed a separate `GET /jobs/{job_id}` call to get the full data.
