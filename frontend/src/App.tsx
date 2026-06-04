/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { UploadAndJobsView } from "./components/UploadAndJobsView";
import { SummaryView } from "./components/SummaryView";
import { Job } from "./types";

export default function App() {
  const [currentJob, setCurrentJob] = useState<Job | null>(null);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Discharge Summary Agent</h1>
          <span className="bg-red-100 text-red-800 text-xs font-bold px-2.5 py-1 rounded border border-red-200 uppercase tracking-wide">
            DRAFT — Not a clinical document
          </span>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-10">
        {currentJob ? (
          <SummaryView job={currentJob} onBack={() => setCurrentJob(null)} />
        ) : (
          <UploadAndJobsView onViewSummary={(job) => setCurrentJob(job)} />
        )}
      </main>

      <footer className="bg-slate-50 border-t border-slate-200 p-4 text-center mt-auto">
        <p className="text-sm font-medium text-amber-700 bg-amber-50 px-4 py-2 rounded-lg inline-block border border-amber-200">
          <span className="font-bold mr-1">⚠</span>
          This is an AI-generated draft. It must be reviewed, corrected, and signed by the responsible clinician before use in any clinical or administrative context.
        </p>
      </footer>
    </div>
  );
}

