#!/usr/bin/env python3
import argparse
import os
import sys
from dotenv import load_dotenv

load_dotenv()

from agent.core import DischargeAgent
from agent.output_formatter import save_outputs


def main():
    parser = argparse.ArgumentParser(description="Discharge Summary Agent")
    parser.add_argument("patient_dir", help="Path to the folder containing patient PDFs")
    parser.add_argument("--patient-id", default=None, help="Patient identifier (defaults to folder name)")
    parser.add_argument("--output-dir", default=None, help="Where to save outputs (defaults to ./outputs/<patient_id>)")
    parser.add_argument("--quiet", action="store_true", help="Suppress step-by-step trace output")
    args = parser.parse_args()

    patient_dir = os.path.abspath(args.patient_dir)
    if not os.path.isdir(patient_dir):
        print(f"ERROR: {patient_dir} is not a directory.", file=sys.stderr)
        sys.exit(1)

    patient_id = args.patient_id or os.path.basename(patient_dir)
    output_dir = args.output_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "outputs", patient_id
    )

    agent = DischargeAgent(
        patient_dir=patient_dir,
        patient_id=patient_id,
        verbose=not args.quiet,
    )

    summary, steps = agent.run()

    md_path, json_path, trace_path = save_outputs(summary, steps, output_dir)

    print(f"\n{'='*60}")
    print(f"  DONE — Patient: {patient_id}")
    print(f"  Mode used: {'ONE-SHOT' if len(steps) <= 5 else 'AGENT LOOP'}")
    print(f"  Steps taken: {len(steps)}")
    print(f"  Flags raised: {len(summary.flags)}")
    print(f"\n  Outputs saved to: {output_dir}")
    print(f"    Summary (markdown): {md_path}")
    print(f"    Summary (JSON):     {json_path}")
    print(f"    Agent trace:        {trace_path}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
