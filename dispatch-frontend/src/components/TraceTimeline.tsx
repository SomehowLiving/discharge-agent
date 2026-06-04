import { ChevronDown, ChevronRight, Activity, FileSearch, Flag, CheckCircle2, Wrench } from "lucide-react";
import { useState } from "react";
import { Job } from "../types";

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function extractPageRefs(step: NonNullable<Job["steps"]>[number]): string[] {
  const text = [step.reasoning, stringify(step.inputs), stringify(step.result)].join(" ");
  const refs = new Set<string>();
  for (const match of text.matchAll(/\b(?:page|p\.?)\s*(\d{1,3})\b/gi)) {
    refs.add(`Page ${match[1]}`);
  }
  return [...refs].slice(0, 6);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="px-3 py-2 text-xs leading-relaxed text-slate-700">
        {children}
      </div>
    </div>
  );
}

function DetailDisclosure({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-50">
        {title}
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100">
        {stringify(value)}
      </pre>
    </details>
  );
}

function SummaryValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="italic text-slate-400">Not found in documents</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="italic text-slate-400">None documented</span>;
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            <SummaryValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return (
      <dl className="grid grid-cols-1 gap-2">
        {Object.entries(value as Record<string, unknown>).map(([key, nested]) => (
          <div key={key} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{key.replaceAll("_", " ")}</dt>
            <dd className="mt-1"><SummaryValue value={nested} /></dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

function reportText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not found in documents";
  return String(value);
}

function ReportList({ items }: { items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="italic text-slate-500">None documented</p>;
  }

  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>
          {typeof item === "object" && item !== null ? (
            <span>
              {Object.entries(item as Record<string, unknown>)
                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
                .join("; ")}
            </span>
          ) : (
            <span>{reportText(item)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-3 first:border-t-0 first:pt-0">
      <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-700">{title}</h4>
      <div className="text-xs leading-relaxed text-slate-800">{children}</div>
    </section>
  );
}

function FinalizedSummaryDetails({ summary }: { summary: Record<string, unknown> }) {
  return (
    <Section title="Finalize summary review">
      <div className="space-y-4 bg-white px-4 py-3">
        <ReportSection title="Final status">
          <p><span className="font-semibold">Principal diagnosis:</span> {reportText(summary.principal_diagnosis)}</p>
          <div>
            <p className="font-semibold">Hospital course:</p>
            <div className="mt-1">{formatLongText(reportText(summary.hospital_course))}</div>
          </div>
          <p><span className="font-semibold">Discharge condition:</span> {reportText(summary.discharge_condition)}</p>
          <p><span className="font-semibold">Follow-up:</span> {reportText(summary.follow_up)}</p>
        </ReportSection>

        <ReportSection title="Medication reconciliation">
          <ReportList items={summary.medication_changes} />
        </ReportSection>

        <ReportSection title="Pending results requiring handoff">
          <ReportList items={summary.pending_results} />
        </ReportSection>

        <ReportSection title="Safety fields to verify">
          <p><span className="font-semibold">Allergies:</span></p>
          <ReportList items={summary.allergies} />
        </ReportSection>
      </div>
    </Section>
  );
}

function formatLongText(text: string) {
  const chunks = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="space-y-2">
      {chunks.map((chunk, index) => (
        <p key={index} className="whitespace-pre-wrap">{chunk}</p>
      ))}
    </div>
  );
}

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
              const pageRefs = extractPageRefs(step);
              
              let chipColor = "bg-slate-200 text-slate-700";
              if (isFinal) chipColor = "bg-green-100 text-green-800 border-green-200 border";
              if (isFlag) chipColor = "bg-amber-100 text-amber-800 border-amber-200 border";
              const Icon = isFinal ? CheckCircle2 : isFlag ? Flag : step.action === "read_document" ? FileSearch : Wrench;

              return (
                <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-slate-200 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 text-xs font-bold">
                    {step.step}
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-200 shadow-sm bg-white">
                    <div className="flex items-center justify-between mb-2">
                       <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded ${chipColor}`}>
                         <Icon className="h-3.5 w-3.5" />
                         {step.action}
                       </span>
                       <span className="text-xs text-slate-400 font-mono">
                         {new Date(step.timestamp).toLocaleTimeString()}
                       </span>
                    </div>
                    {pageRefs.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {pageRefs.map((ref) => (
                          <span key={ref} className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            {ref}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="space-y-3">
                      {step.reasoning && (
                        <Section title="Model reasoning">
                          {formatLongText(step.reasoning)}
                        </Section>
                      )}
                      {isFlag && (
                        <Section title="Clinician review flag">
                          <dl className="space-y-1">
                            <div><dt className="inline font-semibold">Section:</dt> <dd className="inline">{step.inputs?.section || "unknown"}</dd></div>
                            <div><dt className="inline font-semibold">Severity:</dt> <dd className="inline">{step.inputs?.severity || "warning"}</dd></div>
                            <div><dt className="inline font-semibold">Issue:</dt> <dd className="inline">{step.inputs?.issue || "No issue text provided."}</dd></div>
                          </dl>
                        </Section>
                      )}
                      {step.action === "check_drug_interactions" && (
                        <Section title="Medication safety check">
                          <p className="font-medium">Medications checked</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {(step.inputs?.medications || []).map((medication: string) => (
                              <span key={medication} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                {medication}
                              </span>
                            ))}
                            {(!step.inputs?.medications || step.inputs.medications.length === 0) && <span>None provided</span>}
                          </div>
                          <p className="mt-2 font-medium">Result</p>
                          <p className="mt-1">{step.result?.safe ? "No known interactions found in the mock interaction table." : `${step.result?.interaction_count || 0} interaction(s) found.`}</p>
                          {step.result?.interactions_found?.length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                              {step.result.interactions_found.map((interaction: any, idx: number) => (
                                <li key={idx}>
                                  <span className="font-semibold">{interaction.severity}</span>: {interaction.description}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Section>
                      )}
                      {isFinal && (
                        <>
                          <Section title="Finalized sections">
                            <div className="flex flex-wrap gap-1.5">
                              {(step.result?.sections || []).map((section: string) => (
                                <span key={section} className="rounded bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 border border-green-200">
                                  {section}
                                </span>
                              ))}
                            </div>
                          </Section>
                          <FinalizedSummaryDetails summary={step.inputs || {}} />
                        </>
                      )}
                      {!isFlag && step.action !== "check_drug_interactions" && !isFinal && (
                        <Section title="Tool input">
                          <pre className="whitespace-pre-wrap break-words font-mono">{stringify(step.inputs)}</pre>
                        </Section>
                      )}
                      {!isFinal && (
                        <Section title="Tool result">
                          <pre className="whitespace-pre-wrap break-words font-mono">{stringify(step.result)}</pre>
                        </Section>
                      )}
                      {isFinal && (
                        <DetailDisclosure title="Raw finalize payload" value={step.inputs} />
                      )}
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
