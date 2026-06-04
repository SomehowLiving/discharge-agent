/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { UploadAndJobsView } from "./components/UploadAndJobsView";
import { SummaryView } from "./components/SummaryView";
import { Part2View } from "./components/Part2View";
import { Job } from "./types";

type Tab = "part1" | "part2";

export default function App() {
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<Tab>("part1");

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Discharge Summary Agent</h1>
        </div>
        {!currentJob && (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setTab("part1")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "part1" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Part 1 — Agent
            </button>
            <button
              onClick={() => setTab("part2")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === "part2" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              Part 2 — Learning Loop
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 p-6 md:p-10">
        {currentJob ? (
          <SummaryView job={currentJob} onBack={() => setCurrentJob(null)} />
        ) : (
          <>
            <div className={tab === "part1" ? "" : "hidden"}>
              <UploadAndJobsView onViewSummary={(job) => setCurrentJob(job)} />
            </div>
            <div className={tab === "part2" ? "" : "hidden"}>
              <Part2View />
            </div>
          </>
        )}
      </main>

      <footer className="bg-slate-50 border-t border-slate-200 p-4 text-center mt-auto">
        <p className="text-sm font-medium text-amber-700 bg-amber-50 px-4 py-2 rounded-lg inline-block border border-amber-200">
          <span className="font-bold mr-1">!</span>
          This is an AI-generated draft. It must be reviewed, corrected, and signed by the responsible clinician before use in any clinical or administrative context.
        </p>
      </footer>
    </div>
  );
}
