import { Job } from "./types";

const API_BASE = "http://localhost:8001";

export async function submitFiles(files: FileList | File[], patientId?: string): Promise<Job> {
  const formData = new FormData();
  if (patientId) {
    formData.append("patient_id", patientId);
  }
  for (let i = 0; i < files.length; i++) {
    formData.append("files", files[i]);
  }

  const res = await fetch(`${API_BASE}/process`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error("Failed to submit files");
  }

  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) {
    throw new Error("Failed to fetch job");
  }
  return res.json();
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) {
    throw new Error("Failed to list jobs");
  }
  return res.json();
}
