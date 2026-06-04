# Discharge Summary Agent

An agentic AI system that reads messy patient PDFs and produces structured discharge summary drafts for clinician review.

---

## What It Does

- Reads patient PDFs (typed notes, handwritten charts, lab reports — all of it)
- Extracts a structured discharge summary with demographics, diagnoses, medications, procedures, follow-up, and pending results
- Flags conflicts, missing fields, pending labs, and medication changes with no documented reason
- Checks drug interactions on the discharge medication list
- Never invents a clinical fact — missing data is explicitly marked, not guessed
- **Part 2**: Runs a learning loop over synthetic patients where a simulated doctor's edits are used to improve future drafts via correction memory

---

## Stack

| Layer | Tech |
|-------|------|
| LLM | Gemini 2.5 Pro (via `google-genai`) |
| PDF parsing | PyMuPDF (embedded text) + Gemini vision (handwriting OCR) |
| Backend | FastAPI + Uvicorn |
| Frontend | React 18 + TypeScript + Tailwind CSS + Vite |

---

## Project Structure

```
discharge-summary-agent/
├── agent/
│   ├── core.py            # Agent loop — mode detection, Gemini calls, tool dispatch
│   ├── tools.py           # Tool implementations + Gemini FunctionDeclaration schemas
│   ├── pdf_reader.py      # Smart PDF extraction (text + vision OCR fallback)
│   ├── prompts.py         # System prompts for both modes
│   ├── models.py          # Dataclasses (DischargeSummary, Flag, AgentStep)
│   └── output_formatter.py # Markdown + JSON + trace output
├── part2/
│   ├── doctor.py          # Simulated doctor reviewer (fixed editing policy)
│   ├── memory.py          # Correction memory — learns from edits, injects into prompt
│   ├── metrics.py         # Normalised edit distance + per-section accuracy
│   ├── runner.py          # Learning loop over 8 synthetic patients
│   └── synthetic_patients/ # 8 synthetic patient note files
├── dispatch-frontend/     # React frontend (Part 1 + Part 2 UI)
├── api.py                 # FastAPI app — Part 1 + Part 2 endpoints
├── main.py                # CLI entry point
├── DECISIONS.md           # Full design decisions and thought process
└── requirements.txt
```

---

## Setup

```bash
# 1. Clone / unzip
cd discharge-summary-agent

# 2. Set API key
echo "GEMINI_API_KEY=your_key_here" > .env

# 3. Install Python deps
pip install -r requirements.txt

# 4. Install frontend deps
cd dispatch-frontend && npm install && cd ..
```

---

## Running

**Backend** (terminal 1):
```bash
python -m uvicorn api:app --host 0.0.0.0 --port 8001
```

**Frontend** (terminal 2):
```bash
cd dispatch-frontend
npm run dev
```

Open **http://localhost:3000** (or whichever port Vite picks if 3000 is busy).

**CLI (no frontend):**
```bash
python3 main.py /path/to/patient/folder/ --patient-id patient1
# Output saved to outputs/patient1/
```

---

## API Endpoints

### Part 1

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/process` | Upload PDFs → returns `job_id` |
| `GET` | `/jobs/{job_id}` | Poll for status + result |
| `GET` | `/jobs` | List all jobs |

### Part 2

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/part2/run` | Start the learning loop (background) |
| `GET` | `/part2/status` | Poll while running |
| `GET` | `/part2/results` | Full curve + improvement metrics |
| `GET` | `/part2/memory` | Current correction memory |
| `GET` | `/part2/patient/{id}` | Draft vs doctor-edited comparison |

---

## How the Agent Works

### Mode detection
- Single PDF ≤ 100 pages → **one-shot mode**: PDF uploaded to Gemini Files API, one call
- Multiple PDFs or large doc → **agent loop mode**: agent calls `read_document` per file

### Tools
- `read_document` — loads a file (loop mode only)
- `check_drug_interactions` — mock drug-drug interaction lookup, always called after discharge med list is assembled
- `flag_for_review` — records conflicts, missing fields, pending results, safety concerns
- `finalize_summary` — submits completed structured JSON, ends the loop

### No-fabrication guardrail
- System prompt prohibits guessing
- All schema fields accept null
- Any null required field triggers a `flag_for_review` call automatically
- Output is always marked as a draft requiring clinician review

---

## Part 2 — Learning Loop

1. Agent generates draft from synthetic patient notes (with current correction memory injected into prompt)
2. Simulated doctor applies a fixed hidden editing policy to the draft
3. Edit distance between draft and edited version is computed (reward = 1 - edit_distance)
4. Sections that changed significantly → corresponding correction rule added to memory
5. Next patient gets the updated prompt with accumulated corrections
6. Edit distance drops as memory grows

**Results (8 synthetic patients):**

| Iteration | Edit Distance | Reward | Rules in Prompt |
|-----------|--------------|--------|-----------------|
| 1 | 0.0345 | 0.9655 | 0 |
| 2 | 0.0621 | 0.9379 | 3 |
| 3 | 0.0265 | 0.9735 | 5 |
| 4–8 | 0.0000 | 1.0000 | 6 |

**Doctor's editing policy (6 rules):**
1. Add ICD-10 codes to all diagnoses
2. Replace null demographics with "UNVERIFIED - CONFIRM WITH RECORDS"
3. Replace null medication doses with "[TO VERIFY WITH PRESCRIBER]"
4. Standardise "Not Known" allergies to NKDA statement
5. Append clinician signature requirement to follow-up
6. Add pending results reminder when flags mention pending items

---

## Limitations

- Edit distance measures style/format changes, not clinical accuracy
- Correction memory is rule-based, not model fine-tuning — it won't generalise beyond the 6 policy rules
- Handwriting OCR quality depends on image resolution and Gemini's vision accuracy
- In-memory job store — restarts clear all job history
- Simulated doctor policy is deterministic, not probabilistic — real doctor edits would be noisier

---

## Submission Checklist

- [x] Source code with run instructions
- [x] Generated discharge summaries and step traces for all patients in the provided set (`outputs/`)
- [x] Part 2: simulated reviewer, learning mechanism, before/after metric and improvement curve
- [x] Video demo: https://www.loom.com/share/3c6d722caf324ef1aa85dc6f247021a2
