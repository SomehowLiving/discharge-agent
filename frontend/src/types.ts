export interface Demographics {
  name: string | null;
  age: string | null;
  sex: string | null;
  mrn: string | null;
  attending_physician: string | null;
}

export interface Medication {
  medication: string;
  dose?: string;
  frequency?: string;
  duration?: string;
}

export interface MedicationChange {
  medication: string;
  change: string; // STOPPED, ADDED, MODIFIED
  reason: string;
}

export interface Flag {
  section: string;
  issue: string;
  severity: "critical" | "warning" | "info";
}

export interface TraceStep {
  step: number;
  timestamp: string;
  reasoning: string;
  action: string;
  inputs: any;
  result: any;
  next_decision: string;
}

export interface SummaryData {
  patient_id: string;
  demographics: Demographics;
  admission_date: string | null;
  discharge_date: string | null;
  principal_diagnosis: string | null;
  secondary_diagnoses: string[];
  hospital_course: string | null;
  procedures: string[];
  admission_medications: Medication[];
  discharge_medications: Medication[];
  medication_changes: MedicationChange[];
  allergies: string[];
  follow_up: string | null;
  pending_results: string[];
  discharge_condition: string | null;
  flags: Flag[];
}

export interface Job {
  job_id: string;
  patient_id?: string;
  status: "queued" | "processing" | "done" | "error";
  error?: string;
  summary?: SummaryData;
  steps?: TraceStep[];
  created_at?: string;
}
