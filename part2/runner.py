"""
Part 2 Runner — Learning Loop

For each synthetic patient (in order):
  1. Read their notes.txt
  2. Generate discharge summary draft using Gemini (with current correction memory injected)
  3. Simulated doctor applies editing policy → edited version
  4. Compute edit distance metrics
  5. Update correction memory with what was changed
  6. Record results

Edit distance should decrease as the memory accumulates corrections.
"""

import json
import os
import time
from datetime import datetime

import google.genai as genai
from google.genai import types

from .doctor import apply_editing_policy
from .memory import CorrectionMemory
from .metrics import compute_all_metrics

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
PATIENTS_DIR = os.path.join(os.path.dirname(__file__), "synthetic_patients")
MODEL_NAME = "gemini-2.5-pro"

BASE_SYSTEM_PROMPT = """You are a clinical AI assistant. Given a patient's clinical notes,
produce a structured discharge summary as a JSON object.

RULES:
- Never invent or guess any clinical fact. Use null for missing fields.
- Use the exact information from the notes.
- Output ONLY valid JSON — no markdown, no explanation.

Output this exact JSON structure:
{
  "patient_id": "string",
  "demographics": {"name": "string|null", "age": "string|null", "sex": "string|null", "mrn": "string|null", "attending_physician": "string|null"},
  "admission_date": "string|null",
  "discharge_date": "string|null",
  "principal_diagnosis": "string|null",
  "secondary_diagnoses": ["string"],
  "hospital_course": "string|null",
  "procedures": ["string"],
  "admission_medications": [{"medication": "string", "dose": "string|null", "frequency": "string|null"}],
  "discharge_medications": [{"medication": "string", "dose": "string|null", "frequency": "string|null", "duration": "string|null"}],
  "medication_changes": [{"medication": "string", "change": "string", "reason": "string|null"}],
  "allergies": ["string"],
  "follow_up": "string|null",
  "pending_results": ["string"],
  "discharge_condition": "string|null",
  "flags": [{"section": "string", "issue": "string", "severity": "info|warning|critical"}]
}"""


def _clean_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0]
    return text.strip()


def generate_draft(client, notes_text: str, patient_id: str, memory_injection: str) -> dict:
    system = BASE_SYSTEM_PROMPT + memory_injection

    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=[
                    types.Content(role="user", parts=[
                        types.Part.from_text(text=f"Patient ID: {patient_id}\n\nClinical Notes:\n\n{notes_text}")
                    ])
                ],
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.1,
                )
            )
            raw = response.text
            parsed = json.loads(_clean_json(raw))
            parsed["patient_id"] = patient_id
            return parsed
        except json.JSONDecodeError as e:
            if attempt == 2:
                return {"patient_id": patient_id, "error": f"JSON parse failed: {e}", "raw": raw}
            time.sleep(2)
        except Exception as e:
            if attempt == 2:
                return {"patient_id": patient_id, "error": str(e)}
            time.sleep(2 ** attempt)


def run_learning_loop(api_key: str, progress_callback=None) -> dict:
    os.makedirs(RESULTS_DIR, exist_ok=True)

    client = genai.Client(api_key=api_key)
    memory = CorrectionMemory()
    memory.reset()  # Fresh run each time

    patient_dirs = sorted(
        d for d in os.listdir(PATIENTS_DIR)
        if os.path.isdir(os.path.join(PATIENTS_DIR, d))
    )

    all_results = []
    curve = []  # list of {iteration, patient_id, edit_distance, reward, rules_learned}

    for i, patient_folder in enumerate(patient_dirs):
        patient_id = patient_folder
        notes_path = os.path.join(PATIENTS_DIR, patient_folder, "notes.txt")

        if not os.path.exists(notes_path):
            continue

        with open(notes_path) as f:
            notes_text = f.read()

        iteration = i + 1
        if progress_callback:
            progress_callback(f"Processing {patient_id} (iteration {iteration}/{len(patient_dirs)})...")

        # Get current memory injection
        memory_injection = memory.build_prompt_injection()

        # Generate draft
        draft = generate_draft(client, notes_text, patient_id, memory_injection)

        if "error" in draft:
            if progress_callback:
                progress_callback(f"  ERROR: {draft['error']}")
            continue

        # Doctor edits
        edited = apply_editing_policy(draft)

        # Metrics
        metrics = compute_all_metrics(draft, edited, patient_id, iteration)
        metrics["rules_in_prompt"] = len(memory.learned_rules)

        # Update memory
        memory.update(draft, edited, metrics)
        metrics["rules_learned_after"] = len(memory.learned_rules)

        # Save individual patient outputs
        patient_out_dir = os.path.join(RESULTS_DIR, patient_id)
        os.makedirs(patient_out_dir, exist_ok=True)
        with open(os.path.join(patient_out_dir, "draft.json"), "w") as f:
            json.dump(draft, f, indent=2, default=str)
        with open(os.path.join(patient_out_dir, "edited.json"), "w") as f:
            json.dump(edited, f, indent=2, default=str)
        with open(os.path.join(patient_out_dir, "metrics.json"), "w") as f:
            json.dump(metrics, f, indent=2)

        all_results.append(metrics)
        curve.append({
            "iteration": iteration,
            "patient_id": patient_id,
            "edit_distance": metrics["overall_edit_distance"],
            "reward": metrics["reward"],
            "rules_in_prompt": metrics["rules_in_prompt"],
            "rules_learned_after": metrics["rules_learned_after"],
        })

        if progress_callback:
            progress_callback(
                f"  ✓ Edit distance: {metrics['overall_edit_distance']:.4f} | "
                f"Reward: {metrics['reward']:.4f} | "
                f"Rules learned: {metrics['rules_learned_after']}"
            )

        # Small delay to avoid rate limits
        time.sleep(3)

    # Save curve
    summary = {
        "run_at": datetime.now().isoformat(),
        "total_patients": len(all_results),
        "curve": curve,
        "before": curve[0]["edit_distance"] if curve else None,
        "after": curve[-1]["edit_distance"] if curve else None,
        "improvement": round((curve[0]["edit_distance"] - curve[-1]["edit_distance"]) / max(curve[0]["edit_distance"], 0.001), 4) if len(curve) >= 2 else 0,
        "memory": memory.to_dict(),
    }

    with open(os.path.join(RESULTS_DIR, "run_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)

    return summary
