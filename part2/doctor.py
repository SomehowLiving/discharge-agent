"""
Simulated Doctor Reviewer — applies a fixed, consistent editing policy to discharge summary drafts.
This policy is hidden from the agent. The agent must learn to anticipate these corrections.

Policy rules (applied deterministically, not probabilistically):
  1. Add ICD-10 codes to all diagnoses that lack them
  2. Replace null demographics fields with "UNVERIFIED - CONFIRM WITH RECORDS"
  3. Replace null medication doses with "Dose: [TO VERIFY WITH PRESCRIBER]"
  4. Standardise "Not Known" allergies to "No Known Drug Allergies (NKDA) - Verify with patient"
  5. Append "Clinician signature required before discharge." to follow_up
  6. If pending_results is empty but flags mention pending → add a reminder entry
"""

import copy
import json
import re

# ICD-10 lookup (common diagnoses — deterministic, not AI-generated)
ICD10_MAP = {
    "nstemi": "I21.4",
    "non-st elevation myocardial infarction": "I21.4",
    "stemi": "I21.9",
    "myocardial infarction": "I21.9",
    "diabetic ketoacidosis": "E11.10",
    "dka": "E11.10",
    "type 2 diabetes": "E11",
    "diabetes mellitus": "E11",
    "community acquired pneumonia": "J18.9",
    "pneumonia": "J18.9",
    "sepsis": "A41.9",
    "acute appendicitis": "K37",
    "appendicitis": "K37",
    "subarachnoid haemorrhage": "I60.9",
    "subarachnoid hemorrhage": "I60.9",
    "sah": "I60.9",
    "hypertension": "I10",
    "aki": "N17.9",
    "acute kidney injury": "N17.9",
    "chronic kidney disease": "N18.9",
    "ckd": "N18.9",
    "febrile seizure": "R56.0",
    "otitis media": "H66.9",
    "acute otitis media": "H66.0",
    "paracetamol overdose": "T39.1",
    "acetaminophen overdose": "T39.1",
    "major depressive disorder": "F32.9",
    "depression": "F32.9",
    "uti": "N39.0",
    "urinary tract infection": "N39.0",
    "acute gastroenteritis": "K59.1",
    "gastroenteritis": "K59.1",
    "hepatotoxicity": "K71.9",
    "hyperkalaemia": "E87.5",
    "hyponatremia": "E87.1",
    "anaemia": "D64.9",
    "dyslipidemia": "E78.5",
    "hypothyroidism": "E03.9",
    "fluid overload": "E87.70",
}


def _add_icd10(diagnosis_str: str) -> str:
    if not diagnosis_str:
        return diagnosis_str
    if "ICD-10" in diagnosis_str:
        return diagnosis_str
    lower = diagnosis_str.lower()
    for term, code in ICD10_MAP.items():
        if term in lower:
            return f"{diagnosis_str} (ICD-10: {code})"
    return diagnosis_str


def apply_editing_policy(draft: dict) -> dict:
    """
    Apply the doctor's deterministic editing policy to a draft summary dict.
    Returns an edited copy — the original is not mutated.
    """
    edited = copy.deepcopy(draft)

    # Rule 1: Add ICD-10 codes to diagnoses
    if edited.get("principal_diagnosis"):
        edited["principal_diagnosis"] = _add_icd10(edited["principal_diagnosis"])

    edited["secondary_diagnoses"] = [
        _add_icd10(d) for d in (edited.get("secondary_diagnoses") or [])
    ]

    # Rule 2: Null demographics → "UNVERIFIED - CONFIRM WITH RECORDS"
    demo = edited.get("demographics") or {}
    for field in ["name", "age", "sex", "mrn", "attending_physician"]:
        if not demo.get(field):
            demo[field] = "UNVERIFIED - CONFIRM WITH RECORDS"
    edited["demographics"] = demo

    # Rule 3: Null medication doses → "[TO VERIFY WITH PRESCRIBER]"
    for med_list_key in ["discharge_medications", "admission_medications"]:
        meds = edited.get(med_list_key) or []
        for med in meds:
            if isinstance(med, dict) and not med.get("dose"):
                med["dose"] = "[TO VERIFY WITH PRESCRIBER]"
        edited[med_list_key] = meds

    # Rule 4: Standardise allergies
    allergies = edited.get("allergies") or []
    standardised = []
    for a in allergies:
        if isinstance(a, str) and a.lower() in ("not known", "none known", "nkda", "none", "nil"):
            standardised.append("No Known Drug Allergies (NKDA) - Verify with patient")
        else:
            standardised.append(a)
    if not allergies:
        standardised = ["No Known Drug Allergies (NKDA) - Verify with patient"]
    edited["allergies"] = standardised

    # Rule 5: Append signature requirement to follow_up
    follow_up = edited.get("follow_up") or ""
    sig_note = "Clinician signature required before discharge."
    if follow_up and sig_note not in follow_up:
        edited["follow_up"] = follow_up.rstrip() + f"\n{sig_note}"
    elif not follow_up:
        edited["follow_up"] = sig_note

    # Rule 6: Ensure pending_results not empty when flags mention pending
    flags = edited.get("flags") or []
    flag_text = " ".join(f.get("issue", "") if isinstance(f, dict) else str(f) for f in flags).lower()
    if "pending" in flag_text and not edited.get("pending_results"):
        edited["pending_results"] = ["Review all flagged pending results with clinician"]

    return edited


def compute_policy_description() -> str:
    """Return a human-readable description of the editing policy (for README/reporting)."""
    return """Simulated Doctor Editing Policy:
1. Add ICD-10 codes to all diagnoses lacking them
2. Replace null demographic fields with 'UNVERIFIED - CONFIRM WITH RECORDS'
3. Replace null medication doses with '[TO VERIFY WITH PRESCRIBER]'
4. Standardise 'Not Known' allergies to 'No Known Drug Allergies (NKDA) - Verify with patient'
5. Append 'Clinician signature required before discharge.' to follow-up instructions
6. Add pending results reminder when flags mention pending items but pending_results is empty
"""
