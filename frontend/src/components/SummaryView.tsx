import { Job } from "../types";
import { FlagsPanel } from "./FlagsPanel";
import { 
  PatientInfoCard, 
  DiagnosesCard, 
  HospitalCourseCard, 
  MedicationsCard,
  ListsCard
} from "./SummarySections";
import { TraceTimeline } from "./TraceTimeline";

interface SummaryViewProps {
  job: Job;
  onBack: () => void;
}

export function SummaryView({ job, onBack }: SummaryViewProps) {
  const summary = job.summary;

  if (!summary) return null;

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <button 
        onClick={onBack}
        className="mb-6 text-sm text-blue-600 hover:text-blue-800 font-medium inline-flex items-center"
      >
        ← Back to Jobs
      </button>

      <div className="flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Flags */}
        <div className="w-full lg:w-1/3 shrink-0 space-y-6">
          <FlagsPanel flags={summary.flags} />
        </div>

        {/* Right Column: Content */}
        <div className="w-full lg:w-2/3 space-y-6">
          <PatientInfoCard summary={summary} />
          <DiagnosesCard summary={summary} />
          <HospitalCourseCard summary={summary} />
          <MedicationsCard summary={summary} />
          <ListsCard summary={summary} />
        </div>

      </div>

      <TraceTimeline steps={job.steps} />
    </div>
  );
}
