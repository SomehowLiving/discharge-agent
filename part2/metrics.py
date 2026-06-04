"""
Metrics for measuring edit distance between agent draft and doctor-edited version.
"""

import json


def _serialise(obj) -> str:
    """Flatten a dict to a canonical string for edit distance computation."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str)


def _levenshtein(s1: str, s2: str) -> int:
    """Standard Levenshtein edit distance (character-level)."""
    if s1 == s2:
        return 0
    len1, len2 = len(s1), len(s2)
    if len1 == 0:
        return len2
    if len2 == 0:
        return len1

    # Use two-row DP for memory efficiency
    prev = list(range(len2 + 1))
    curr = [0] * (len2 + 1)
    for i in range(1, len1 + 1):
        curr[0] = i
        for j in range(1, len2 + 1):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[len2]


def normalised_edit_distance(draft: dict, edited: dict) -> float:
    """
    Normalised edit distance between draft and edited summary (0.0 = identical, 1.0 = completely different).
    Computed on the full JSON serialisation.
    """
    s1 = _serialise(draft)
    s2 = _serialise(edited)
    dist = _levenshtein(s1, s2)
    max_len = max(len(s1), len(s2), 1)
    return round(dist / max_len, 4)


SECTION_KEYS = [
    "principal_diagnosis",
    "secondary_diagnoses",
    "demographics",
    "discharge_medications",
    "admission_medications",
    "allergies",
    "follow_up",
    "pending_results",
    "hospital_course",
    "medication_changes",
]


def section_edit_distances(draft: dict, edited: dict) -> dict[str, float]:
    """Compute normalised edit distance per section."""
    result = {}
    for key in SECTION_KEYS:
        d_val = draft.get(key)
        e_val = edited.get(key)
        s1 = _serialise(d_val)
        s2 = _serialise(e_val)
        dist = _levenshtein(s1, s2)
        max_len = max(len(s1), len(s2), 1)
        result[key] = round(dist / max_len, 4)
    return result


def compute_all_metrics(draft: dict, edited: dict, patient_id: str, iteration: int) -> dict:
    overall = normalised_edit_distance(draft, edited)
    sections = section_edit_distances(draft, edited)
    most_changed = max(sections, key=sections.get)
    return {
        "patient_id": patient_id,
        "iteration": iteration,
        "overall_edit_distance": overall,
        "section_distances": sections,
        "most_changed_section": most_changed,
        "reward": round(1.0 - overall, 4),  # higher = better (less editing needed)
    }
