from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime


@dataclass
class Flag:
    section: str
    issue: str
    severity: str  # "info" | "warning" | "critical"

    def to_dict(self):
        return {"section": self.section, "issue": self.issue, "severity": self.severity}


@dataclass
class AgentStep:
    step_num: int
    reasoning: str
    action: str
    inputs: dict
    result: dict
    next_decision: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self):
        return {
            "step": self.step_num,
            "timestamp": self.timestamp,
            "reasoning": self.reasoning,
            "action": self.action,
            "inputs": self.inputs,
            "result": self.result,
            "next_decision": self.next_decision,
        }


@dataclass
class AgentState:
    patient_id: str
    flags: list = field(default_factory=list)
    finalized_data: Optional[dict] = None
    documents_read: list = field(default_factory=list)
    doc_cache: dict = field(default_factory=dict)  # filename -> pre-extracted text


@dataclass
class DischargeSummary:
    patient_id: str
    demographics: dict = field(default_factory=dict)
    admission_date: Optional[str] = None
    discharge_date: Optional[str] = None
    principal_diagnosis: Optional[str] = None
    secondary_diagnoses: list = field(default_factory=list)
    hospital_course: Optional[str] = None
    procedures: list = field(default_factory=list)
    admission_medications: list = field(default_factory=list)
    discharge_medications: list = field(default_factory=list)
    medication_changes: list = field(default_factory=list)
    allergies: list = field(default_factory=list)
    follow_up: Optional[str] = None
    pending_results: list = field(default_factory=list)
    discharge_condition: Optional[str] = None
    flags: list = field(default_factory=list)

    def to_dict(self):
        return {
            "patient_id": self.patient_id,
            "demographics": self.demographics,
            "admission_date": self.admission_date,
            "discharge_date": self.discharge_date,
            "principal_diagnosis": self.principal_diagnosis,
            "secondary_diagnoses": self.secondary_diagnoses,
            "hospital_course": self.hospital_course,
            "procedures": self.procedures,
            "admission_medications": self.admission_medications,
            "discharge_medications": self.discharge_medications,
            "medication_changes": self.medication_changes,
            "allergies": self.allergies,
            "follow_up": self.follow_up,
            "pending_results": self.pending_results,
            "discharge_condition": self.discharge_condition,
            "flags": [f.to_dict() if isinstance(f, Flag) else f for f in self.flags],
        }
