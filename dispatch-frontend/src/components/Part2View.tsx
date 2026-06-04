import { useState, useEffect, useRef } from "react";
import { Play, RefreshCw, Brain, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";

const API_BASE = "http://localhost:8001";

interface CurvePoint {
  iteration: number;
  patient_id: string;
  edit_distance: number;
  reward: number;
  rules_in_prompt: number;
  rules_learned_after: number;
}

interface RunSummary {
  run_at: string;
  total_patients: number;
  curve: CurvePoint[];
  before: number;
  after: number;
  improvement: number;
  memory: { learned_rules: any[]; history: any[]; total_rules_learned: number };
}

interface PatientComparison {
  patient_id: string;
  draft: any;
  edited: any;
  metrics: any;
}

function ImprovementChart({ curve }: { curve: CurvePoint[] }) {
  if (!curve.length) return null;

  const W = 600, H = 220, PAD = 48;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const maxD = Math.max(...curve.map(p => p.edit_distance), 0.01);
  const minD = 0;

  const toX = (i: number) => PAD + (i / (curve.length - 1 || 1)) * innerW;
  const toY = (d: number) => PAD + innerH - ((d - minD) / (maxD - minD)) * innerH;

  const pathD = curve
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.edit_distance).toFixed(1)}`)
    .join(" ");

  const areaD = [
    `M ${toX(0).toFixed(1)} ${(PAD + innerH).toFixed(1)}`,
    ...curve.map((p, i) => `L ${toX(i).toFixed(1)} ${toY(p.edit_distance).toFixed(1)}`),
    `L ${toX(curve.length - 1).toFixed(1)} ${(PAD + innerH).toFixed(1)} Z`,
  ].join(" ");

  const yTicks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Grid lines */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = minD + ((maxD - minD) * i) / yTicks;
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={PAD} y1={y} x2={PAD + innerW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#94a3b8">
              {val.toFixed(3)}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaD} fill="#3b82f6" fillOpacity="0.08" />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Points */}
      {curve.map((p, i) => (
        <g key={i}>
          <circle cx={toX(i)} cy={toY(p.edit_distance)} r="5" fill="#3b82f6" stroke="white" strokeWidth="2" />
          <text x={toX(i)} y={PAD + innerH + 20} textAnchor="middle" fontSize="10" fill="#64748b">
            P{p.iteration}
          </text>
        </g>
      ))}

      {/* Axes */}
      <line x1={PAD} y1={PAD} x2={PAD} y2={PAD + innerH} stroke="#cbd5e1" strokeWidth="1.5" />
      <line x1={PAD} y1={PAD + innerH} x2={PAD + innerW} y2={PAD + innerH} stroke="#cbd5e1" strokeWidth="1.5" />

      {/* Labels */}
      <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="12" fill="#64748b">Patient (iteration)</text>
      <text x={14} y={H / 2} textAnchor="middle" fontSize="12" fill="#64748b" transform={`rotate(-90, 14, ${H / 2})`}>
        Edit Distance
      </text>
    </svg>
  );
}

function DiffField({ label, draftVal, editedVal }: { label: string; draftVal: any; editedVal: any }) {
  const d = JSON.stringify(draftVal, null, 2);
  const e = JSON.stringify(editedVal, null, 2);
  const changed = d !== e;
  return (
    <div className={`rounded-lg border p-3 ${changed ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
        {changed && <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">Edited</span>}
      </div>
      {changed ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-red-500 font-medium mb-1">Draft</p>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words">{d}</pre>
          </div>
          <div>
            <p className="text-xs text-green-600 font-medium mb-1">After Doctor Edit</p>
            <pre className="text-xs text-slate-800 whitespace-pre-wrap break-words">{e}</pre>
          </div>
        </div>
      ) : (
        <pre className="text-xs text-slate-500 whitespace-pre-wrap break-words">{d}</pre>
      )}
    </div>
  );
}

function PatientDiffCard({ patientId }: { patientId: string }) {
  const [data, setData] = useState<PatientComparison | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (data) { setOpen(o => !o); return; }
    const res = await fetch(`${API_BASE}/part2/patient/${patientId}`);
    if (res.ok) { setData(await res.json()); setOpen(true); }
  };

  const FIELDS = ["principal_diagnosis", "secondary_diagnoses", "demographics",
    "discharge_medications", "allergies", "follow_up", "pending_results"];

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={load} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left">
        <span className="font-medium text-slate-800 text-sm">{patientId}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>
      {open && data && (
        <div className="p-4 space-y-3">
          <div className="flex gap-4 text-sm mb-3">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-medium">
              Edit Distance: {data.metrics.overall_edit_distance}
            </span>
            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-medium">
              Reward: {data.metrics.reward}
            </span>
            <span className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full font-medium">
              Rules in prompt: {data.metrics.rules_in_prompt}
            </span>
          </div>
          {FIELDS.map(f => (
            <DiffField key={f} label={f} draftVal={data.draft[f]} editedVal={data.edited[f]} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Part2View() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<RunSummary | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load existing results on mount
  useEffect(() => {
    fetch(`${API_BASE}/part2/results`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setResults(d); })
      .catch(() => {});
  }, []);

  const startRun = async () => {
    setStatus("running");
    setLog([]);
    await fetch(`${API_BASE}/part2/run`, { method: "POST" });
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${API_BASE}/part2/status`);
      const data = await res.json();
      setLog(data.log || []);
      if (data.status === "done" || data.status === "error") {
        clearInterval(pollRef.current!);
        setStatus(data.status);
        if (data.status === "done") {
          const r = await fetch(`${API_BASE}/part2/results`);
          if (r.ok) setResults(await r.json());
        }
      }
    }, 3000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const improvement = results ? Math.round(results.improvement * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" /> Part 2 — Learning from Doctor Edits
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Runs the agent on 8 synthetic patients. After each patient, a simulated doctor applies
              a fixed editing policy. The agent's correction memory accumulates these patterns,
              reducing edit distance over successive patients.
            </p>
          </div>
          <button
            onClick={startRun}
            disabled={status === "running"}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            {status === "running"
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Running...</>
              : <><Play className="w-4 h-4" /> {results ? "Re-run" : "Run Learning Loop"}</>
            }
          </button>
        </div>
      </div>

      {/* Live log */}
      {(status === "running" || log.length > 0) && (
        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-mono mb-2">Agent log</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {log.map((line, i) => (
              <p key={i} className="text-xs font-mono text-green-400">{line}</p>
            ))}
            {status === "running" && (
              <p className="text-xs font-mono text-yellow-400 animate-pulse">● Processing...</p>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
              <p className="text-3xl font-bold text-slate-800">{results.before?.toFixed(4)}</p>
              <p className="text-sm text-slate-500 mt-1">Edit Distance — Patient 1</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
              <p className="text-3xl font-bold text-slate-800">{results.after?.toFixed(4)}</p>
              <p className="text-sm text-slate-500 mt-1">Edit Distance — Patient 8</p>
            </div>
            <div className={`rounded-xl border p-5 text-center ${improvement > 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <p className={`text-3xl font-bold ${improvement > 0 ? "text-green-700" : "text-red-700"}`}>
                {improvement > 0 ? "↓" : "↑"} {Math.abs(improvement)}%
              </p>
              <p className={`text-sm mt-1 ${improvement > 0 ? "text-green-600" : "text-red-600"}`}>
                {improvement > 0 ? "Improvement in edit distance" : "Change in edit distance"}
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-blue-600" /> Edit Distance per Patient (lower = better)
            </h3>
            <ImprovementChart curve={results.curve} />
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-700">Per-Patient Results</h3>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Patient</th>
                  <th className="px-4 py-3 text-left font-medium">Edit Distance</th>
                  <th className="px-4 py-3 text-left font-medium">Reward</th>
                  <th className="px-4 py-3 text-left font-medium">Rules in Prompt</th>
                  <th className="px-4 py-3 text-left font-medium">Rules Learned After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.curve.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{p.iteration}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.patient_id}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${p.edit_distance < (results.before ?? 1) * 0.8 ? "text-green-600" : "text-slate-700"}`}>
                        {p.edit_distance.toFixed(4)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{p.reward.toFixed(4)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.rules_in_prompt}</td>
                    <td className="px-4 py-3">
                      <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-xs font-medium">
                        {p.rules_learned_after}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Correction memory */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-700 mb-4">
              Correction Memory ({results.memory.total_rules_learned} rules learned)
            </h3>
            {results.memory.learned_rules.length === 0 ? (
              <p className="text-slate-400 text-sm italic">No rules learned yet.</p>
            ) : (
              <div className="space-y-2">
                {results.memory.learned_rules.map((rule: any, i: number) => (
                  <div key={i} className="flex gap-3 bg-purple-50 border border-purple-100 rounded-lg p-3">
                    <span className="text-purple-600 font-bold text-sm shrink-0">{i + 1}.</span>
                    <div>
                      <p className="text-xs text-purple-500 mb-0.5">{rule.trigger} — {rule.pattern}</p>
                      <p className="text-sm text-slate-700">{rule.instruction}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-patient diffs */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-700 mb-4">Draft vs Doctor Edit — Per Patient</h3>
            <p className="text-sm text-slate-500 mb-4">Click a patient to see exactly what the doctor changed.</p>
            <div className="space-y-2">
              {results.curve.map((p, i) => (
                <PatientDiffCard key={i} patientId={p.patient_id} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!results && status === "idle" && (
        <div className="text-center py-20 text-slate-400">
          <Brain className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No results yet</p>
          <p className="text-sm mt-1">Click "Run Learning Loop" to start Part 2</p>
        </div>
      )}
    </div>
  );
}
