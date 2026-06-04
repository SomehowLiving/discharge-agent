import { Job } from "../types";
import { NullField } from "./ui/NullField";

export function PatientInfoCard({ summary }: { summary: Job["summary"] }) {
  if (!summary) return null;
  const d = summary.demographics;
  
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Patient Information</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-sm">
        <div><span className="text-slate-500 block mb-1">Name</span> {d.name || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">MRN</span> {d.mrn || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">Age</span> {d.age || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">Sex</span> {d.sex || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">Attending Physician</span> {d.attending_physician || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">Admission Date</span> {summary.admission_date || <NullField />}</div>
        <div><span className="text-slate-500 block mb-1">Discharge Date</span> {summary.discharge_date || <NullField />}</div>
        <div className="md:col-span-2"><span className="text-slate-500 block mb-1">Discharge Condition</span> {summary.discharge_condition || <NullField />}</div>
      </div>
    </div>
  );
}

export function DiagnosesCard({ summary }: { summary: Job["summary"] }) {
  if (!summary) return null;
  
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Diagnoses</h3>
      
      <div className="mb-6">
        <h4 className="text-sm text-slate-500 mb-1">Principal Diagnosis</h4>
        <div className="text-xl text-slate-900 font-medium">
          {summary.principal_diagnosis || <NullField />}
        </div>
      </div>

      <div>
        <h4 className="text-sm text-slate-500 mb-2">Secondary Diagnoses</h4>
        {summary.secondary_diagnoses && summary.secondary_diagnoses.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {summary.secondary_diagnoses.map((diag, i) => (
              <span key={i} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-md text-sm border border-slate-200">
                {diag}
              </span>
            ))}
          </div>
        ) : <NullField />}
      </div>
    </div>
  );
}

export function HospitalCourseCard({ summary }: { summary: Job["summary"] }) {
  if (!summary) return null;
  
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Hospital Course</h3>
      <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
        {summary.hospital_course || <NullField />}
      </div>
    </div>
  );
}

export function MedicationsCard({ summary }: { summary: Job["summary"] }) {
  if (!summary) return null;

  const renderTable = (meds: typeof summary.admission_medications) => {
    if (!meds || meds.length === 0) return <div className="mt-2 text-sm"><NullField /></div>;
    return (
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2 font-medium">Medication</th>
              <th className="px-4 py-2 font-medium">Dose</th>
              <th className="px-4 py-2 font-medium">Frequency</th>
              <th className="px-4 py-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {meds.map((m, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium text-slate-800">{m.medication}</td>
                <td className="px-4 py-2 text-slate-600">{m.dose || "-"}</td>
                <td className="px-4 py-2 text-slate-600">{m.frequency || "-"}</td>
                <td className="px-4 py-2 text-slate-600">{m.duration || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-4 border-b pb-2">Medications</h3>
      
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-md inline-block">On Admission</h4>
          {renderTable(summary.admission_medications)}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-md inline-block">On Discharge</h4>
          {renderTable(summary.discharge_medications)}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-3">Medication Changes</h4>
        {summary.medication_changes && summary.medication_changes.length > 0 ? (
          <div className="space-y-3">
            {summary.medication_changes.map((change, i) => {
              const bg = change.change === "STOPPED" ? "bg-red-100 text-red-800 border-red-200" :
                         change.change === "ADDED" ? "bg-green-100 text-green-800 border-green-200" :
                         "bg-amber-100 text-amber-800 border-amber-200";
              const missingReason = !change.reason || change.reason.includes("No reason documented");
              return (
                <div key={i} className="flex items-start bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className={`mt-0.5 px-2 py-0.5 rounded text-xs font-bold border shrink-0 w-20 text-center ${bg}`}>
                    {change.change}
                  </div>
                  <div className="ml-4">
                    <div className="text-sm font-medium text-slate-900">{change.medication}</div>
                    <div className="text-sm text-slate-600 mt-1 flex items-start">
                      {missingReason && <span className="text-amber-500 mr-1.5">⚠</span>}
                      {change.reason || <span className="italic text-slate-400">No reason documented</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <NullField />}
      </div>
    </div>
  );
}

export function ListsCard({ summary }: { summary: Job["summary"] }) {
  if (!summary) return null;
  return (
    <div className="space-y-6">
      {/* Procedures */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-3 border-b pb-2">Procedures</h3>
        {summary.procedures && summary.procedures.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            {summary.procedures.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        ) : <NullField />}
      </div>

      {/* Allergies */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-3 border-b pb-2">Allergies</h3>
        {summary.allergies && summary.allergies.length > 0 ? (
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
            {summary.allergies.map((a, i) => {
              const notKnown = a.toLowerCase().includes("not known");
              return (
                <li key={i}>
                  {a} {notKnown && <span className="text-red-600 font-bold ml-2 text-xs">VERIFY WITH PATIENT</span>}
                </li>
              );
            })}
          </ul>
        ) : <NullField />}
      </div>

      {/* pending results banner */}
      {summary.pending_results && summary.pending_results.length > 0 && (
         <div className="bg-amber-50 p-6 rounded-xl shadow-sm border border-amber-200">
           <h3 className="text-lg font-semibold text-amber-900 mb-3 border-b border-amber-200 pb-2 flex items-center">
             <span className="mr-2">⚠</span> Pending Results
           </h3>
           <ul className="list-disc pl-5 text-sm text-amber-800 space-y-1">
             {summary.pending_results.map((p, i) => <li key={i}>{p}</li>)}
           </ul>
         </div>
      )}

      {/* Follow-up */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-3 border-b pb-2">Follow-up</h3>
        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {summary.follow_up || <NullField />}
        </div>
      </div>
    </div>
  );
}
