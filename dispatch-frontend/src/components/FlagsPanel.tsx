import { Job } from "../types";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

export function FlagsPanel({ flags }: { flags: Job["summary"]["flags"] }) {
  if (!flags || flags.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 p-4 rounded-xl text-green-800 flex items-start">
        <CheckCircle className="w-5 h-5 mr-3 mt-0.5 shrink-0" />
        <div>
          <h3 className="font-semibold text-sm">No flags raised</h3>
          <p className="text-xs mt-1 text-green-700">The agent did not detect any conflicting or missing critical information.</p>
        </div>
      </div>
    );
  }

  // Sort: critical -> warning -> info
  const sortedFlags = [...flags].sort((a, b) => {
    const weights = { critical: 3, warning: 2, info: 1 };
    return weights[b.severity] - weights[a.severity];
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-red-50 border-b border-red-100 px-6 py-4 flex items-center">
        <AlertTriangle className="w-5 h-5 text-red-600 mr-2" />
        <h3 className="font-semibold text-red-800">Clinician Review Required</h3>
      </div>
      
      <div className="p-4 space-y-3">
        {sortedFlags.map((flag, i) => {
          let bg = "bg-blue-50 border-blue-200 text-blue-800";
          let icon = <Info className="w-4 h-4 text-blue-500 mr-2 shrink-0 mt-0.5" />;
          
          if (flag.severity === "critical") {
            bg = "bg-red-50 border-red-300 text-red-900 font-medium";
            icon = <AlertCircle className="w-4 h-4 text-red-600 mr-2 shrink-0 mt-0.5" />;
          } else if (flag.severity === "warning") {
            bg = "bg-amber-50 border-amber-300 text-amber-900";
            icon = <AlertTriangle className="w-4 h-4 text-amber-600 mr-2 shrink-0 mt-0.5" />;
          }

          return (
            <div key={i} className={`p-3 rounded-lg border flex items-start text-sm ${bg}`}>
              {icon}
              <div>
                <span className="font-bold mr-2 opacity-80 uppercase text-xs tracking-wider border-b border-current pb-0.5 mb-1 inline-block">{flag.section}</span>
                <p className="mt-0.5">{flag.issue}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Just for the no flags case
import { CheckCircle } from "lucide-react";
