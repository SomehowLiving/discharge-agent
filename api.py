import os
import uuid
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from agent.core import DischargeAgent
from agent.output_formatter import save_outputs

app = FastAPI(title="Discharge Summary Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory stores
jobs: dict[str, dict] = {}
batches: dict[str, dict] = {}

BATCH_WORKERS = 3  # max parallel agents

UPLOAD_BASE = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "outputs")


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def _run_agent(job_id: str, patient_dir: str, patient_id: str):
    jobs[job_id]["status"] = "processing"
    try:
        agent = DischargeAgent(patient_dir=patient_dir, patient_id=patient_id, verbose=True)
        summary, steps = agent.run()

        output_dir = os.path.join(OUTPUT_BASE, patient_id)
        md_path, json_path, trace_path = save_outputs(summary, steps, output_dir)

        jobs[job_id].update({
            "status": "done",
            "summary": summary.to_dict(),
            "steps": [s.to_dict() for s in steps],
            "output_dir": output_dir,
            "completed_at": datetime.now().isoformat(),
        })
    except Exception as e:
        jobs[job_id].update({
            "status": "error",
            "error": str(e),
            "completed_at": datetime.now().isoformat(),
        })


def _run_batch(batch_id: str, job_ids: list[str]):
    with ThreadPoolExecutor(max_workers=BATCH_WORKERS) as pool:
        futures = {
            pool.submit(
                _run_agent,
                jid,
                os.path.join(UPLOAD_BASE, jobs[jid]["patient_id"]),
                jobs[jid]["patient_id"],
            ): jid
            for jid in job_ids
        }
        for future in as_completed(futures):
            future.result()  # exceptions already handled inside _run_agent

    any_error = any(jobs[j]["status"] == "error" for j in job_ids)
    all_done = all(jobs[j]["status"] == "done" for j in job_ids)
    batches[batch_id].update({
        "status": "done" if all_done else ("error" if any_error else "partial"),
        "completed_at": datetime.now().isoformat(),
    })


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"service": "Discharge Summary Agent", "status": "running"}


@app.post("/process")
async def process_patient(
    background_tasks: BackgroundTasks,
    patient_id: Optional[str] = None,
    files: list[UploadFile] = File(...),
):
    """
    Upload one or more patient PDF files. Returns a job_id to poll for results.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    job_id = str(uuid.uuid4())
    pid = patient_id or f"patient_{job_id[:8]}"
    patient_dir = os.path.join(UPLOAD_BASE, pid)
    os.makedirs(patient_dir, exist_ok=True)

    # Save uploaded files
    saved = []
    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{f.filename} is not a PDF.")
        dest = os.path.join(patient_dir, f.filename)
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(f.filename)

    jobs[job_id] = {
        "job_id": job_id,
        "patient_id": pid,
        "status": "queued",
        "files": saved,
        "created_at": datetime.now().isoformat(),
    }

    background_tasks.add_task(_run_agent, job_id, patient_dir, pid)

    return {"job_id": job_id, "patient_id": pid, "files": saved, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    """
    Poll this to get job status. When status == 'done', the full summary and trace are included.
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return jobs[job_id]


@app.get("/jobs")
def list_jobs():
    """List all jobs with their status (no summary payload)."""
    return [
        {k: v for k, v in job.items() if k not in ("summary", "steps")}
        for job in jobs.values()
    ]


@app.post("/batch")
async def process_batch(background_tasks: BackgroundTasks, request: Request):
    """
    Submit PDFs for multiple patients in a single request.
    Use the patient_id as the multipart field name for each file group:

        form.append("patient_001", file_a)   # patient_001 gets file_a
        form.append("patient_001", file_b)   # patient_001 also gets file_b
        form.append("patient_002", file_c)   # separate patient

    Returns a batch_id and the list of individual job_ids.
    Poll /batch/{batch_id} for overall progress, or /jobs/{job_id} per patient.
    """
    form = await request.form()
    patients: dict[str, list] = {}
    for field_name, value in form.multi_items():
        if not hasattr(value, "filename"):
            continue
        if not value.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{value.filename} is not a PDF.")
        patients.setdefault(field_name, []).append(value)

    if not patients:
        raise HTTPException(status_code=400, detail="No PDF files found in request.")

    batch_id = str(uuid.uuid4())
    job_ids = []

    for pid, files in patients.items():
        job_id = str(uuid.uuid4())
        patient_dir = os.path.join(UPLOAD_BASE, pid)
        os.makedirs(patient_dir, exist_ok=True)

        saved = []
        for f in files:
            dest = os.path.join(patient_dir, f.filename)
            with open(dest, "wb") as out:
                shutil.copyfileobj(f.file, out)
            saved.append(f.filename)

        jobs[job_id] = {
            "job_id": job_id,
            "patient_id": pid,
            "status": "queued",
            "files": saved,
            "created_at": datetime.now().isoformat(),
            "batch_id": batch_id,
        }
        job_ids.append(job_id)

    batches[batch_id] = {
        "batch_id": batch_id,
        "job_ids": job_ids,
        "total": len(job_ids),
        "status": "processing",
        "created_at": datetime.now().isoformat(),
    }

    background_tasks.add_task(_run_batch, batch_id, job_ids)

    return {
        "batch_id": batch_id,
        "job_ids": job_ids,
        "total": len(job_ids),
        "status": "processing",
    }


@app.get("/batch/{batch_id}")
def get_batch(batch_id: str):
    """Overall batch status plus a per-job summary (no payload)."""
    if batch_id not in batches:
        raise HTTPException(status_code=404, detail="Batch not found.")
    batch = dict(batches[batch_id])
    batch["jobs"] = [
        {k: v for k, v in jobs[jid].items() if k not in ("summary", "steps")}
        for jid in batch["job_ids"]
        if jid in jobs
    ]
    batch["completed"] = sum(1 for jid in batch["job_ids"] if jobs.get(jid, {}).get("status") == "done")
    batch["errors"] = sum(1 for jid in batch["job_ids"] if jobs.get(jid, {}).get("status") == "error")
    return batch


@app.get("/batches")
def list_batches():
    """List all batch runs (no per-job payloads)."""
    return [
        {k: v for k, v in b.items() if k != "job_ids"}
        for b in batches.values()
    ]


@app.post("/process/sync")
def process_patient_sync(
    patient_id: Optional[str] = None,
    files: list[UploadFile] = File(...),
):
    """
    Same as /process but blocks until done and returns result directly.
    Useful for testing — for production use /process + poll /jobs/{job_id}.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    job_id = str(uuid.uuid4())
    pid = patient_id or f"patient_{job_id[:8]}"
    patient_dir = os.path.join(UPLOAD_BASE, pid)
    os.makedirs(patient_dir, exist_ok=True)

    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{f.filename} is not a PDF.")
        dest = os.path.join(patient_dir, f.filename)
        with open(dest, "wb") as out:
            shutil.copyfileobj(f.file, out)

    jobs[job_id] = {"job_id": job_id, "patient_id": pid, "status": "queued"}
    _run_agent(job_id, patient_dir, pid)
    return jobs[job_id]
