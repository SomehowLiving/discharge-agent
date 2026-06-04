import json
from datetime import datetime
from .models import DischargeSummary, Flag


SEVERITY_EMOJI = {"critical": "🔴 CRITICAL", "warning": "🟡 WARNING", "info": "🔵 INFO"}


def format_markdown(summary: DischargeSummary) -> str:
    d = summary
    lines = [
        f"# DISCHARGE SUMMARY DRAFT",
        f"> **⚠ DRAFT FOR CLINICIAN REVIEW ONLY — NOT A FINALIZED CLINICAL DOCUMENT**",
        f"> Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  Patient ID: {d.patient_id}",
        "",
    ]

    # Flags at the top for visibility
    if d.flags:
        lines += ["## ⚠ FLAGS REQUIRING CLINICIAN REVIEW", ""]
        for f in d.flags:
            if isinstance(f, Flag):
                tag = SEVERITY_EMOJI.get(f.severity, f.severity.upper())
                lines.append(f"- **[{tag}]** `{f.section}`: {f.issue}")
            elif isinstance(f, dict):
                tag = SEVERITY_EMOJI.get(f.get("severity", "info"), "INFO")
                lines.append(f"- **[{tag}]** `{f.get('section','?')}`: {f.get('issue','')}")
        lines.append("")

    # Demographics
    lines += ["## Patient Demographics", ""]
    dem = d.demographics or {}
    if dem:
        for k, v in dem.items():
            lines.append(f"- **{k.replace('_',' ').title()}**: {v or 'NOT FOUND IN DOCUMENTS'}")
    else:
        lines.append("- _Demographics not found in documents_")
    lines.append("")

    # Admission / Discharge
    lines += [
        "## Admission & Discharge",
        "",
        f"- **Admission Date**: {d.admission_date or 'NOT FOUND IN DOCUMENTS'}",
        f"- **Discharge Date**: {d.discharge_date or 'NOT FOUND IN DOCUMENTS'}",
        f"- **Discharge Condition**: {d.discharge_condition or 'NOT FOUND IN DOCUMENTS'}",
        "",
    ]

    # Diagnoses
    lines += ["## Diagnoses", ""]
    lines.append(f"**Principal Diagnosis**: {d.principal_diagnosis or 'NOT FOUND IN DOCUMENTS'}")
    if d.secondary_diagnoses:
        lines.append("\n**Secondary Diagnoses**:")
        for dx in d.secondary_diagnoses:
            lines.append(f"- {dx}")
    else:
        lines.append("\n**Secondary Diagnoses**: None documented")
    lines.append("")

    # Hospital Course
    lines += [
        "## Hospital Course",
        "",
        d.hospital_course or "_Hospital course not documented in source notes._",
        "",
    ]

    # Procedures
    lines += ["## Procedures", ""]
    if d.procedures:
        for p in d.procedures:
            lines.append(f"- {p}")
    else:
        lines.append("- None documented")
    lines.append("")

    # Medications
    lines += ["## Medications", ""]
    lines.append("### Admission Medications")
    if d.admission_medications:
        for m in d.admission_medications:
            if isinstance(m, dict):
                name = m.get("name", m.get("drug", str(m)))
                dose = m.get("dose", m.get("dosage", ""))
                freq = m.get("frequency", m.get("freq", ""))
                lines.append(f"- {name}" + (f" {dose}" if dose else "") + (f" {freq}" if freq else ""))
            else:
                lines.append(f"- {m}")
    else:
        lines.append("- _Not documented_")

    lines.append("\n### Discharge Medications")
    if d.discharge_medications:
        for m in d.discharge_medications:
            if isinstance(m, dict):
                name = m.get("name", m.get("drug", str(m)))
                dose = m.get("dose", m.get("dosage", ""))
                freq = m.get("frequency", m.get("freq", ""))
                lines.append(f"- {name}" + (f" {dose}" if dose else "") + (f" {freq}" if freq else ""))
            else:
                lines.append(f"- {m}")
    else:
        lines.append("- _Not documented_")

    lines.append("\n### Medication Changes from Admission")
    if d.medication_changes:
        for c in d.medication_changes:
            if isinstance(c, dict):
                drug = c.get("drug", c.get("name", "Unknown"))
                change = c.get("change_type", c.get("change", ""))
                reason = c.get("reason", "")
                flagged = c.get("flagged", False)
                flag_str = " ⚠ **REASON NOT DOCUMENTED — FLAG FOR RECONCILIATION**" if flagged or not reason else ""
                lines.append(f"- **{drug}** — {change}" + (f" (reason: {reason})" if reason else "") + flag_str)
            else:
                lines.append(f"- {c}")
    else:
        lines.append("- No changes documented")
    lines.append("")

    # Allergies
    lines += ["## Allergies", ""]
    if d.allergies:
        for a in d.allergies:
            lines.append(f"- {a}")
    else:
        lines.append("- _No allergies documented — VERIFY WITH PATIENT_")
    lines.append("")

    # Follow-up
    lines += [
        "## Follow-up Instructions",
        "",
        d.follow_up or "_No follow-up instructions documented._",
        "",
    ]

    # Pending Results
    lines += ["## Pending Results", ""]
    if d.pending_results:
        for r in d.pending_results:
            lines.append(f"- {r}")
    else:
        lines.append("- None noted")
    lines.append("")

    lines += [
        "---",
        "_This document was generated by an AI discharge summary agent and **must be reviewed, "
        "corrected, and signed by the responsible clinician** before use in any clinical or "
        "administrative context._",
    ]

    return "\n".join(lines)


def save_outputs(summary: DischargeSummary, steps, output_dir: str):
    import os
    os.makedirs(output_dir, exist_ok=True)

    # Markdown summary
    md_path = os.path.join(output_dir, "discharge_summary.md")
    with open(md_path, "w") as f:
        f.write(format_markdown(summary))

    # JSON summary
    json_path = os.path.join(output_dir, "discharge_summary.json")
    with open(json_path, "w") as f:
        json.dump(summary.to_dict(), f, indent=2, default=str)

    # Step trace
    trace_path = os.path.join(output_dir, "agent_trace.json")
    with open(trace_path, "w") as f:
        json.dump([s.to_dict() for s in steps], f, indent=2, default=str)

    return md_path, json_path, trace_path
