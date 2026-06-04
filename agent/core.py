import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types

from .models import AgentState, AgentStep, DischargeSummary, Flag
from .pdf_reader import should_use_oneshot, upload_pdf, read_document_for_agent
from .prompts import SYSTEM_PROMPT, ONESHOT_USER_PROMPT, LOOP_USER_PROMPT_TEMPLATE
from .tools import execute_tool, get_tools_for_mode

MAX_STEPS = 25
MODEL_NAME = "gemini-2.5-pro"
PREFETCH_WORKERS = 4  # parallel PDF extraction threads per patient


class DischargeAgent:
    def __init__(self, patient_dir: str, patient_id: str, verbose: bool = True):
        api_key = os.environ.get("GEMINI_API_KEY", "").strip().strip('"').strip("'")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set.")
        if api_key == "your_gemini_api_key_here" or not api_key.startswith("AIza"):
            raise ValueError(
                "GEMINI_API_KEY is not a valid Google AI Studio API key. "
                "Create a key at https://aistudio.google.com/app/apikey and put it in the root .env file."
            )

        self.client = genai.Client(api_key=api_key)
        self.patient_dir = patient_dir
        self.patient_id = patient_id
        self.verbose = verbose
        self.state = AgentState(patient_id=patient_id)
        self.steps: list[AgentStep] = []
        self.step_count = 0

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self) -> tuple[DischargeSummary, list[AgentStep]]:
        pdf_paths = self._list_pdf_paths()
        if not pdf_paths:
            self.state.flags.append(Flag("documents", "No PDF documents found in patient folder.", "critical"))
            return self._build_summary(), self.steps

        if should_use_oneshot(pdf_paths):
            if self.verbose:
                print(f"\n{'#'*60}")
                print(f"  MODE: ONE-SHOT  |  Patient: {self.patient_id}")
                print(f"  PDF: {os.path.basename(pdf_paths[0])}")
                print(f"{'#'*60}")
            self._run_oneshot(pdf_paths[0])
        else:
            if self.verbose:
                print(f"\n{'#'*60}")
                print(f"  MODE: AGENT LOOP  |  Patient: {self.patient_id}")
                print(f"  Documents: {[os.path.basename(p) for p in pdf_paths]}")
                print(f"{'#'*60}")
            self._run_loop(pdf_paths)

        return self._build_summary(), self.steps

    # ------------------------------------------------------------------
    # Mode 1: One-shot
    # ------------------------------------------------------------------

    def _run_oneshot(self, pdf_path: str):
        tool = get_tools_for_mode("oneshot")
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[tool],
        )

        if self.verbose:
            print("  Uploading PDF to Gemini Files API...")
        try:
            uploaded = upload_pdf(self.client, pdf_path)
        except Exception as e:
            self.state.flags.append(Flag("documents", f"PDF upload failed: {e}", "critical"))
            return

        contents = [
            types.Content(role="user", parts=[
                types.Part.from_uri(file_uri=uploaded.uri, mime_type="application/pdf"),
                types.Part.from_text(text=ONESHOT_USER_PROMPT),
            ])
        ]

        self._run_content_loop(contents, config, patient_dir=None)

        try:
            self.client.files.delete(name=uploaded.name)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Mode 2: Agent loop
    # ------------------------------------------------------------------

    def _run_loop(self, pdf_paths: list[str]):
        tool = get_tools_for_mode("loop")
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            tools=[tool],
        )

        # Pre-fetch all documents in parallel so read_document tool calls
        # return from cache instead of blocking on sequential Gemini Vision calls.
        self._prefetch_documents(pdf_paths)

        doc_names = [os.path.basename(p) for p in pdf_paths]
        user_msg = LOOP_USER_PROMPT_TEMPLATE.format(
            patient_id=self.patient_id,
            doc_list="\n".join(f"  - {n}" for n in doc_names),
        )

        contents = [types.Content(role="user", parts=[types.Part.from_text(text=user_msg)])]
        self._run_content_loop(contents, config, patient_dir=self.patient_dir)

    def _prefetch_documents(self, pdf_paths: list[str]):
        if self.verbose:
            print(f"\n  [Prefetch] Extracting {len(pdf_paths)} document(s) in parallel...")

        def _extract(path: str) -> tuple[str, str]:
            filename = os.path.basename(path)
            content = read_document_for_agent(self.client, path, MODEL_NAME)
            return filename, content

        workers = min(len(pdf_paths), PREFETCH_WORKERS)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_extract, p): p for p in pdf_paths}
            for future in as_completed(futures):
                try:
                    filename, content = future.result()
                    self.state.doc_cache[filename] = content
                    if self.verbose:
                        print(f"  [Prefetch] {filename} ready ({len(content):,} chars)")
                except Exception as e:
                    path = futures[future]
                    filename = os.path.basename(path)
                    self.state.doc_cache[filename] = f"[PREFETCH ERROR: {e}]"
                    if self.verbose:
                        print(f"  [Prefetch] {filename} failed: {e}")

    # ------------------------------------------------------------------
    # Shared multi-turn loop
    # ------------------------------------------------------------------

    def _run_content_loop(self, contents: list, config, patient_dir):
        while self.step_count < MAX_STEPS:
            response = self._call_with_retry(contents, config)
            if response is None:
                break

            # Append model turn to history
            contents.append(response.candidates[0].content)

            fn_calls = [p for p in response.candidates[0].content.parts if p.function_call and p.function_call.name]

            if not fn_calls:
                if self.verbose:
                    text = "".join(p.text for p in response.candidates[0].content.parts if hasattr(p, "text") and p.text)
                    print(f"\n[Step {self.step_count}] No tool call — agent finished.\n{text[:300]}")
                break

            # Extract reasoning once per response — shared across all fn_calls in this batch
            reasoning = self._extract_text(response)

            tool_result_parts = []
            finalized = False

            for part in fn_calls:
                self.step_count += 1
                fn = part.function_call
                tool_name = fn.name
                inputs = dict(fn.args)

                if tool_name == "finalize_summary":
                    result = {"status": "finalized", "sections": list(inputs.keys())}
                    self.state.finalized_data = dict(inputs)
                    finalized = True
                else:
                    result = execute_tool(
                        tool_name=tool_name,
                        inputs=inputs,
                        state=self.state,
                        patient_dir=patient_dir,
                        client=self.client,
                        model_name=MODEL_NAME,
                    )

                step = AgentStep(
                    step_num=self.step_count,
                    reasoning=reasoning,
                    action=tool_name,
                    inputs=inputs,
                    result=result,
                    next_decision="finalizing" if finalized else "continuing",
                )
                self.steps.append(step)
                if self.verbose:
                    self._print_step(step)

                tool_result_parts.append(
                    types.Part.from_function_response(
                        name=tool_name,
                        response={"result": json.dumps(result, default=str)},
                    )
                )

            # Append tool results as a user turn
            contents.append(types.Content(role="user", parts=tool_result_parts))

            if finalized:
                break

        if self.step_count >= MAX_STEPS and not self.state.finalized_data:
            self.state.flags.append(Flag(
                "system",
                f"Agent hit the {MAX_STEPS}-step limit without finalizing. Summary may be incomplete.",
                "critical",
            ))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _call_with_retry(self, contents, config):
        for attempt in range(3):
            try:
                return self.client.models.generate_content(
                    model=MODEL_NAME,
                    contents=contents,
                    config=config,
                )
            except Exception as e:
                err = str(e)
                if "rate" in err.lower() or "429" in err:
                    wait = 2 ** (attempt + 1)
                    if self.verbose:
                        print(f"  [Rate limit] Waiting {wait}s...")
                    time.sleep(wait)
                else:
                    if self.verbose:
                        print(f"  [API error] {e} — retry {attempt+1}/3")
                    if attempt == 2:
                        self.state.flags.append(Flag("system", f"LLM API error: {e}", "critical"))
                        return None
                    time.sleep(1)
        return None

    def _list_pdf_paths(self) -> list[str]:
        if not os.path.exists(self.patient_dir):
            return []
        return sorted(
            os.path.join(self.patient_dir, f)
            for f in os.listdir(self.patient_dir)
            if f.lower().endswith(".pdf")
        )

    def _extract_text(self, response) -> str:
        try:
            parts = response.candidates[0].content.parts
            segments = []
            for p in parts:
                if not hasattr(p, "text") or not p.text:
                    continue
                if getattr(p, "thought", False):
                    # Gemini 2.5 Pro internal thinking — truncate so traces stay readable
                    segments.append(p.text[:600].strip())
                else:
                    segments.append(p.text.strip())
            return " ".join(segments).strip()
        except Exception:
            return ""

    def _build_summary(self) -> DischargeSummary:
        d = self.state.finalized_data or {}
        return DischargeSummary(
            patient_id=self.patient_id,
            demographics=d.get("demographics") or {},
            admission_date=d.get("admission_date"),
            discharge_date=d.get("discharge_date"),
            principal_diagnosis=d.get("principal_diagnosis"),
            secondary_diagnoses=d.get("secondary_diagnoses") or [],
            hospital_course=d.get("hospital_course"),
            procedures=d.get("procedures") or [],
            admission_medications=self._normalize_medications(d.get("admission_medications") or []),
            discharge_medications=self._normalize_medications(d.get("discharge_medications") or []),
            medication_changes=self._normalize_medication_changes(d.get("medication_changes") or []),
            allergies=d.get("allergies") or [],
            follow_up=d.get("follow_up"),
            pending_results=d.get("pending_results") or [],
            discharge_condition=d.get("discharge_condition"),
            flags=self.state.flags,
        )

    def _normalize_medications(self, meds: list) -> list:
        normalized = []
        for med in meds:
            if not isinstance(med, dict):
                normalized.append(med)
                continue

            normalized.append({
                "medication": (
                    med.get("medication")
                    or med.get("medication_name")
                    or med.get("name")
                    or med.get("drug")
                    or "Unknown"
                ),
                "dose": med.get("dose") or med.get("dosage"),
                "frequency": med.get("frequency") or med.get("freq"),
                "duration": med.get("duration"),
            })
        return normalized

    def _normalize_medication_changes(self, changes: list) -> list:
        normalized = []
        for change in changes:
            if not isinstance(change, dict):
                normalized.append(change)
                continue

            normalized.append({
                "medication": change.get("medication") or change.get("drug") or change.get("name") or "Unknown",
                "change": change.get("change") or change.get("change_type") or "",
                "reason": change.get("reason"),
                **({"flagged": change["flagged"]} if "flagged" in change else {}),
            })
        return normalized

    def _print_step(self, step: AgentStep):
        sep = "─" * 56
        print(f"\n┌{sep}┐")
        print(f"│ STEP {step.step_num:02d}  {step.timestamp[:19]}")
        print(f"├{sep}┤")
        if step.reasoning:
            print(f"│ REASONING : {step.reasoning[:300].replace(chr(10), ' ')}")
        print(f"│ ACTION    : {step.action}")
        print(f"│ INPUTS    : {json.dumps(step.inputs, default=str)[:250]}")
        print(f"│ RESULT    : {json.dumps(step.result, default=str)[:300]}")
        print(f"│ NEXT      : {step.next_decision}")
        print(f"└{sep}┘")
