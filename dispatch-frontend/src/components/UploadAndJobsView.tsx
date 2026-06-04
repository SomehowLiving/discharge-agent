import { useState, useEffect, useRef } from "react";
import { Upload, FileText, Activity, AlertCircle, CheckCircle } from "lucide-react";
import { Job } from "../types";
import { submitFiles, listJobs, getJob } from "../api";
import { format } from "date-fns";

interface UploadAndJobsViewProps {
  onViewSummary: (job: Job) => void;
}

export function UploadAndJobsView({ onViewSummary }: UploadAndJobsViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [patientId, setPatientId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Poll for active job
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (activeJob && (activeJob.status === "queued" || activeJob.status === "processing")) {
      interval = setInterval(async () => {
        try {
          const updatedJob = await getJob(activeJob.job_id);
          setActiveJob(updatedJob);
          // If it finishes, refresh the jobs list
          if (updatedJob.status === "done" || updatedJob.status === "error") {
            refreshJobs();
          }
        } catch (err) {
          console.error("Failed to poll job:", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeJob]);

  // Initial load of jobs
  useEffect(() => {
    refreshJobs();
  }, []);

  const refreshJobs = async () => {
    try {
      setIsLoadingJobs(true);
      const jobsList = await listJobs();
      // Sort by created_at descending if possible, assuming backend returns them in some order.
      setJobs(jobsList);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Failed to load past jobs. Make sure the backend is running at http://localhost:8001");
    } finally {
      setIsLoadingJobs(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const startProcessing = async () => {
    if (files.length === 0) return;
    try {
      setError(null);
      const job = await submitFiles(files, patientId);
      setActiveJob(job);
      setFiles([]);
      setPatientId("");
      refreshJobs();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to submit files for processing.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Upload Area */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-xl font-medium text-slate-800 mb-4">New Discharge Summary</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Patient ID (Optional)</label>
            <input 
              type="text" 
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. MRN-12345"
            />
          </div>

          <div 
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mx-auto h-8 w-8 text-slate-400 mb-3" />
            <p className="text-sm text-slate-600 mb-1">
              Drag and drop PDF files here, or <span className="text-blue-600 cursor-pointer hover:underline">click to select</span>
            </p>
            <p className="text-xs text-slate-400">Supported formats: PDF</p>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              accept="application/pdf"
              onChange={handleFileChange}
            />
          </div>

          {files.length > 0 && (
            <div className="bg-slate-50 p-4 rounded-md border border-slate-200">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Selected Files ({files.length})</h4>
              <ul className="space-y-2 mb-4">
                {files.map((f, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-center">
                    <FileText className="h-4 w-4 mr-2 text-slate-400" />
                    {f.name}
                  </li>
                ))}
              </ul>
              <button 
                onClick={(e) => { e.stopPropagation(); startProcessing(); }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-md transition-colors shadow-sm"
              >
                Run Agent
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Job Status */}
      {activeJob && (activeJob.status === "queued" || activeJob.status === "processing") && (
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-xl flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="animate-spin text-blue-600">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-blue-900">
                {activeJob.status === "queued" ? "Uploading & Queued..." : "Agent Processing..."}
              </h3>
              <p className="text-xs text-blue-700">Job ID: {activeJob.job_id}</p>
            </div>
          </div>
        </div>
      )}

      {activeJob && activeJob.status === "error" && (
        <div className="bg-red-50 border border-red-200 p-6 rounded-xl">
          <div className="flex items-start space-x-4">
            <AlertCircle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-red-900">Agent run failed</h3>
              <p className="text-xs text-red-700 mt-1">Job ID: {activeJob.job_id}</p>
              <p className="text-sm text-red-800 mt-3 whitespace-pre-wrap">
                {activeJob.error || "The backend reported an error but did not include details."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div>
        <h2 className="text-xl font-medium text-slate-800 mb-4">Past Jobs</h2>
        
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {isLoadingJobs ? (
          <div className="text-center py-8 text-slate-500">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-500">
            No previous jobs found.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-6 py-3 font-medium">Job ID</th>
                  <th className="px-6 py-3 font-medium">Patient ID</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                  <th className="px-6 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {jobs.map(job => (
                  <tr key={job.job_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{job.job_id.substring(0, 8)}...</td>
                    <td className="px-6 py-4">{job.patient_id || <span className="text-slate-400 italic">None</span>}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        job.status === 'done' ? 'bg-green-100 text-green-800' :
                        job.status === 'error' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {job.status === 'done' && <CheckCircle className="w-3 h-3 justify-center mr-1" />}
                        {job.status === 'error' && <AlertCircle className="w-3 h-3 justify-center mr-1" />}
                        {(job.status === 'queued' || job.status === 'processing') && <Activity className="w-3 h-3 justify-center mr-1 animate-pulse" />}
                        {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {job.created_at ? format(new Date(job.created_at), "MMM d, yyyy HH:mm") : "Unknown"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {job.status === 'done' && (
                        <button
                          onClick={async () => {
                            const full = await getJob(job.job_id);
                            onViewSummary(full);
                          }}
                          className="text-blue-600 hover:text-blue-800 font-medium text-sm transition-colors"
                        >
                          View Summary
                        </button>
                      )}
                      {job.status === 'error' && job.error && (
                        <span className="inline-block max-w-xs truncate text-red-600 text-xs" title={job.error}>
                          {job.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
