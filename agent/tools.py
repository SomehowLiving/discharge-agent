import os
from google.genai import types
from .models import Flag

# ---------------------------------------------------------------------------
# Drug interaction database (mock)
# ---------------------------------------------------------------------------

KNOWN_INTERACTIONS = {
    ("warfarin", "aspirin"):        {"severity": "critical", "description": "Warfarin + Aspirin: significantly increased bleeding risk."},
    ("warfarin", "ibuprofen"):      {"severity": "critical", "description": "Warfarin + Ibuprofen: increased anticoagulant effect and GI bleeding risk."},
    ("metformin", "contrast"):      {"severity": "warning",  "description": "Metformin + IV Contrast: risk of lactic acidosis."},
    ("lisinopril", "potassium"):    {"severity": "warning",  "description": "Lisinopril + Potassium: risk of hyperkalemia."},
    ("amiodarone", "warfarin"):     {"severity": "critical", "description": "Amiodarone + Warfarin: markedly increases warfarin effect."},
    ("ssri", "tramadol"):           {"severity": "warning",  "description": "SSRI + Tramadol: risk of serotonin syndrome."},
    ("azithromycin", "amiodarone"): {"severity": "critical", "description": "Azithromycin + Amiodarone: additive QT prolongation risk."},
    ("ofloxacin", "meftal"):        {"severity": "warning",  "description": "Ofloxacin + Meftal Spas: potential QT prolongation risk."},
    ("loperamide", "ondansetron"):  {"severity": "warning",  "description": "Loperamide + Ondansetron (Emeset): additive QT prolongation risk."},
}


def check_drug_interactions(medications: list[str]) -> dict:
    found = []
    meds = [m.lower().strip() for m in medications]
    for i, a in enumerate(meds):
        for b in meds[i + 1:]:
            for (ka, kb), info in KNOWN_INTERACTIONS.items():
                if (ka in a or a in ka) and (kb in b or b in kb):
                    found.append(info)
                elif (ka in b or b in kb) and (kb in a or a in ka):
                    found.append(info)
    return {
        "interactions_found": found,
        "interaction_count": len(found),
        "safe": len(found) == 0,
    }


# ---------------------------------------------------------------------------
# Tool execution dispatcher
# ---------------------------------------------------------------------------

def execute_tool(tool_name: str, inputs: dict, state, patient_dir: str = None, client=None, model_name: str = None) -> dict:
    try:
        if tool_name == "read_document":
            from .pdf_reader import read_document_for_agent
            filename = inputs.get("filename", "")
            # Serve from pre-fetch cache when available (avoids blocking mid-loop)
            if filename in state.doc_cache:
                content = state.doc_cache[filename]
            else:
                filepath = os.path.join(patient_dir, filename)
                content = read_document_for_agent(client, filepath, model_name)
            state.documents_read.append(filename)
            return {"filename": filename, "content": content, "error": None}

        elif tool_name == "check_drug_interactions":
            medications = inputs.get("medications", [])
            if not medications:
                return {"error": "No medications provided", "interactions_found": [], "safe": True}
            return check_drug_interactions(medications)

        elif tool_name == "flag_for_review":
            flag = Flag(
                section=inputs.get("section", "unknown"),
                issue=inputs.get("issue", ""),
                severity=inputs.get("severity", "warning"),
            )
            state.flags.append(flag)
            return {"flagged": True, "section": flag.section, "severity": flag.severity}

        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        return {"error": f"Tool '{tool_name}' failed: {e}"}


# ---------------------------------------------------------------------------
# Gemini tool schemas (new google.genai SDK format)
# ---------------------------------------------------------------------------

def _schema(type_, **kwargs):
    return types.Schema(type=type_, **kwargs)


READ_DOCUMENT_TOOL = types.FunctionDeclaration(
    name="read_document",
    description=(
        "Read and extract full text from a patient document. "
        "Use this to load admission notes, progress notes, lab results, and medication records. "
        "Handles both typed and handwritten PDFs."
    ),
    parameters=_schema(
        types.Type.OBJECT,
        properties={"filename": _schema(types.Type.STRING, description="Exact filename in the patient folder.")},
        required=["filename"],
    ),
)

CHECK_DRUG_INTERACTIONS_TOOL = types.FunctionDeclaration(
    name="check_drug_interactions",
    description=(
        "Check a list of medications for known clinically significant drug-drug interactions. "
        "Always call this after assembling the complete discharge medication list."
    ),
    parameters=_schema(
        types.Type.OBJECT,
        properties={
            "medications": _schema(
                types.Type.ARRAY,
                items=_schema(types.Type.STRING),
                description="List of discharge medication names.",
            )
        },
        required=["medications"],
    ),
)

FLAG_FOR_REVIEW_TOOL = types.FunctionDeclaration(
    name="flag_for_review",
    description=(
        "Flag an issue for mandatory clinician review. "
        "Use for: missing required fields, conflicting information, "
        "medication changes with no documented reason, pending results, drug interactions."
    ),
    parameters=_schema(
        types.Type.OBJECT,
        properties={
            "section": _schema(types.Type.STRING, description="Which summary section this flag applies to."),
            "issue":   _schema(types.Type.STRING, description="Clear description of the issue."),
            "severity": _schema(types.Type.STRING, description="One of: info, warning, critical."),
        },
        required=["section", "issue", "severity"],
    ),
)

FINALIZE_SUMMARY_TOOL = types.FunctionDeclaration(
    name="finalize_summary",
    description=(
        "Submit the completed discharge summary. Call this once you have read all documents. "
        "Use null for any field not found — never invent values."
    ),
    parameters=_schema(
        types.Type.OBJECT,
        properties={
            "demographics":          _schema(types.Type.OBJECT,  description="Patient name, age, sex, MRN, attending physician."),
            "admission_date":        _schema(types.Type.STRING,  description="Admission date. Null if not found."),
            "discharge_date":        _schema(types.Type.STRING,  description="Discharge date. Null if not found."),
            "principal_diagnosis":   _schema(types.Type.STRING,  description="Primary diagnosis. Null if not found."),
            "secondary_diagnoses":   _schema(types.Type.ARRAY,   items=_schema(types.Type.STRING), description="Secondary diagnoses."),
            "hospital_course":       _schema(types.Type.STRING,  description="Narrative of the clinical stay."),
            "procedures":            _schema(types.Type.ARRAY,   items=_schema(types.Type.STRING), description="Procedures performed."),
            "admission_medications": _schema(types.Type.ARRAY,   items=_schema(types.Type.OBJECT), description="Medications on admission."),
            "discharge_medications": _schema(types.Type.ARRAY,   items=_schema(types.Type.OBJECT), description="Discharge medications with dose/frequency/duration."),
            "medication_changes":    _schema(types.Type.ARRAY,   items=_schema(types.Type.OBJECT), description="Changes between admission and discharge meds."),
            "allergies":             _schema(types.Type.ARRAY,   items=_schema(types.Type.STRING), description="Documented allergies."),
            "follow_up":             _schema(types.Type.STRING,  description="Follow-up instructions."),
            "pending_results":       _schema(types.Type.ARRAY,   items=_schema(types.Type.STRING), description="Results pending at discharge."),
            "discharge_condition":   _schema(types.Type.STRING,  description="Patient condition at discharge."),
        },
        required=["demographics", "principal_diagnosis", "hospital_course", "discharge_medications", "medication_changes", "allergies"],
    ),
)


def get_tools_for_mode(mode: str) -> types.Tool:
    decls = [CHECK_DRUG_INTERACTIONS_TOOL, FLAG_FOR_REVIEW_TOOL, FINALIZE_SUMMARY_TOOL]
    if mode == "loop":
        decls = [READ_DOCUMENT_TOOL] + decls
    return types.Tool(function_declarations=decls)
