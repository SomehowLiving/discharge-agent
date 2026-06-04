"""
Correction Memory — accumulates patterns from (draft, edited) pairs
and injects them into future prompts so the agent improves over time.
"""

import json
import os
from typing import Optional

MEMORY_FILE = os.path.join(os.path.dirname(__file__), "results", "correction_memory.json")

# Static correction rules derived from the doctor's editing policy.
# These are discovered incrementally as the agent makes mistakes and the doctor corrects them.
CORRECTION_RULES = [
    {
        "trigger": "principal_diagnosis",
        "pattern": "diagnosis lacks ICD-10 code",
        "instruction": "Always append the ICD-10 code in parentheses to every diagnosis. Example: 'Pneumonia (ICD-10: J18.9)'.",
    },
    {
        "trigger": "secondary_diagnoses",
        "pattern": "secondary diagnoses lack ICD-10 codes",
        "instruction": "Always append ICD-10 codes to all secondary diagnoses as well.",
    },
    {
        "trigger": "demographics",
        "pattern": "null demographic fields left as null",
        "instruction": "For any demographic field (name, age, sex, MRN, attending) that cannot be found in the documents, write 'UNVERIFIED - CONFIRM WITH RECORDS' instead of null.",
    },
    {
        "trigger": "discharge_medications",
        "pattern": "medication dose is null",
        "instruction": "For any medication with no dose documented, write '[TO VERIFY WITH PRESCRIBER]' in the dose field rather than leaving it null.",
    },
    {
        "trigger": "allergies",
        "pattern": "allergy listed as Not Known",
        "instruction": "Never write 'Not Known' for allergies. Use 'No Known Drug Allergies (NKDA) - Verify with patient' instead.",
    },
    {
        "trigger": "follow_up",
        "pattern": "missing clinician signature note",
        "instruction": "Always end the follow_up section with: 'Clinician signature required before discharge.'",
    },
    {
        "trigger": "pending_results",
        "pattern": "pending results empty despite flags mentioning pending items",
        "instruction": "If any flag mentions a pending result, ensure pending_results is not empty. Add 'Review all flagged pending results with clinician' if specific results are unknown.",
    },
]


class CorrectionMemory:
    def __init__(self, memory_path: str = MEMORY_FILE):
        self.memory_path = memory_path
        os.makedirs(os.path.dirname(memory_path), exist_ok=True)
        self._load()

    def _load(self):
        if os.path.exists(self.memory_path):
            with open(self.memory_path) as f:
                data = json.load(f)
            self.learned_rules: list[dict] = data.get("learned_rules", [])
            self.history: list[dict] = data.get("history", [])
        else:
            self.learned_rules = []
            self.history = []

    def _save(self):
        with open(self.memory_path, "w") as f:
            json.dump({"learned_rules": self.learned_rules, "history": self.history}, f, indent=2)

    def update(self, draft: dict, edited: dict, metrics: dict):
        """
        Compare draft vs edited. For each section that changed significantly,
        discover and store the applicable correction rule.
        """
        section_distances = metrics.get("section_distances", {})

        for rule in CORRECTION_RULES:
            trigger = rule["trigger"]
            # If this section has meaningful edit distance AND rule not already learned
            dist = section_distances.get(trigger, 0.0)
            already_learned = any(r["trigger"] == trigger for r in self.learned_rules)

            if dist > 0.05 and not already_learned:
                self.learned_rules.append(rule)

        self.history.append({
            "patient_id": metrics.get("patient_id"),
            "iteration": metrics.get("iteration"),
            "overall_edit_distance": metrics.get("overall_edit_distance"),
            "rules_learned_so_far": len(self.learned_rules),
        })
        self._save()

    def reset(self):
        self.learned_rules = []
        self.history = []
        self._save()

    def build_prompt_injection(self) -> str:
        """Return a block of correction rules to inject into the system prompt."""
        if not self.learned_rules:
            return ""
        lines = [
            "\n## CORRECTIONS LEARNED FROM PREVIOUS CASES\n",
            "Apply these corrections — they were consistently missed and corrected by the reviewing clinician:\n",
        ]
        for i, rule in enumerate(self.learned_rules, 1):
            lines.append(f"{i}. {rule['instruction']}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "learned_rules": self.learned_rules,
            "history": self.history,
            "total_rules_learned": len(self.learned_rules),
        }
