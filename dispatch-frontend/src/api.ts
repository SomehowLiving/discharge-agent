import { Job } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8001";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (typeof data.error === "string") return data.error;
  } catch {
    // Use fallback below.
  }
  return fallback;
}

export async function submitFiles(files: FileList | File[], patientId?: string): Promise<Job> {
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append("files", files[i]);
  }

  const params = new URLSearchParams();
  if (patientId?.trim()) {
    params.set("patient_id", patientId.trim());
  }
  const url = `${API_BASE}/process${params.toString() ? `?${params}` : ""}`;

  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(await readError(res, "Failed to submit files"));
  }

  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) {
    throw new Error(await readError(res, "Failed to fetch job"));
  }
  return res.json();
}

export async function listJobs(): Promise<Job[]> {
  const res = await fetch(`${API_BASE}/jobs`);
  if (!res.ok) {
    throw new Error(await readError(res, "Failed to list jobs"));
  }
  return res.json();
}
