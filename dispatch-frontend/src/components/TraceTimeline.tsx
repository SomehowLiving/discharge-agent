import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import { useState } from "react";
import { Job } from "../types";

export function TraceTimeline({ steps }: { steps: Job["steps"] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden mt-8">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-slate-100 hover:bg-slate-200 transition-colors text-slate-800 font-medium"
      >
        <div className="flex items-center">
          <Activity className="w-5 h-5 mr-2 text-slate-500" />
          Agent Trace Timeline
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5 text-slate-500" /> : <ChevronRight className="w-5 h-5 text-slate-500" />}
      </button>

      {isOpen && (
        <div className="p-6">
          <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-slate-200">
            {steps.map((step, i) => {
              const isFinal = step.action === "finalize_summary";
              const isFlag = step.action === "flag_for_review";
              
              let chipColor = "bg-slate-200 text-slate-700";
              if (isFinal) chipColor = "bg-green-100 text-green-800 border-green-200 border";
              if (isFlag) chipColor = "bg-amber-100 text-amber-800 border-amber-200 border";

              return (
                <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-slate-200 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-xs font-bold">
                    {step.step}
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-200 shadow-sm bg-white">
                    <div className="flex items-center justify-between mb-2">
                       <span className={`text-xs font-bold px-2 py-1 rounded ${chipColor}`}>
                         {step.action}
                       </span>
                       <span className="text-xs text-slate-400 font-mono">
                         {new Date(step.timestamp).toLocaleTimeString()}
                       </span>
                    </div>
                    <div className="text-sm text-slate-700 mb-2 italic">
                      "{step.reasoning}"
                    </div>
                    
                    <div className="mt-3 text-xs bg-slate-50 p-2 rounded border border-slate-100 text-slate-600">
                      <strong>Inputs:</strong> {JSON.stringify(step.inputs)}
                    </div>
                    <div className="mt-1 text-xs bg-slate-50 p-2 rounded border border-slate-100 text-slate-600">
                      <strong>Result:</strong> {JSON.stringify(step.result)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
