"""Tools Nemotron can call during a voice turn. Every call writes a trace row."""
import re
import time

from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

from . import clinical
from .state import StateWatcher
from .stdb import Stdb

WF = "Voice"
EVENT_KIND = re.compile(r"^(med_[a-z]+|shock|airway|finding|procedure|mark)$")


class Grounding:
    """Text the spoken reply may draw facts from: state, tool results, what was heard and seen."""

    def __init__(self, state: StateWatcher):
        self.state = state
        self._items: list[tuple[float, str]] = []

    def add(self, text: str) -> None:
        self._items.append((time.time(), text))
        self._items = self._items[-40:]

    def heard_or_seen(self) -> str:
        return " ".join(t for _, t in self._items[-20:]) + " " + self.state.recent_text()

    def text(self) -> str:
        return self.state.summary() + " " + self.heard_or_seen()


SCHEMAS = [
    FunctionSchema("get_state", "Current incident state: status, vitals, CPR, timers, patient record, recent events.", {}, []),
    FunctionSchema(
        "search_ehr",
        "Search the EHR. Only with a full name AND a birth date the medic said or the ID card showed.",
        {"name": {"type": "string", "description": "Full name as said"},
         "birth_date": {"type": "string", "description": "YYYY-MM-DD"}},
        ["name", "birth_date"],
    ),
    FunctionSchema("check_allergy", "Deterministic allergy check against the patient record.",
                   {"drug": {"type": "string", "description": "Generic drug name"}}, ["drug"]),
    FunctionSchema(
        "check_dose_range", "Deterministic dose-range check for a drug.",
        {"drug": {"type": "string"}, "dose": {"type": "number"}, "unit": {"type": "string", "enum": ["mg", "mcg", "g"]}},
        ["drug"],
    ),
    FunctionSchema(
        "log_event", "Log something the medic said was done (drug given, shock, airway, procedure, finding).",
        {"kind": {"type": "string", "description": "med_<generic drug name> (e.g. med_epinephrine), shock, airway, procedure, finding or mark"},
         "label": {"type": "string", "description": "Short label using only the medic's words, e.g. 'Epinephrine 1 mg IV'"}},
        ["kind", "label"],
    ),
    FunctionSchema("look", "Look through the bodycam now and report what is visible. Use when the medic says 'look'.", {}, []),
]
TOOLS = ToolsSchema(standard_tools=SCHEMAS)


class VoiceTools:
    def __init__(self, stdb: Stdb, state: StateWatcher, ehr: clinical.Ehr, grounding: Grounding, look):
        self.stdb, self.state, self.ehr, self.grounding, self._look_now = stdb, state, ehr, grounding, look

    def register(self, llm) -> None:
        for name in ("get_state", "search_ehr", "check_allergy", "check_dose_range", "log_event", "look"):
            llm.register_function(name, getattr(self, f"_{name}"))

    async def _reply(self, params: FunctionCallParams, tool: str, text: str) -> None:
        self.grounding.add(text)
        await self.stdb.step(WF, tool, f"{_args(params.arguments)} → {text}")
        await params.result_callback({"result": text})

    async def _get_state(self, params: FunctionCallParams) -> None:
        await self._reply(params, "get_state", self.state.summary())

    async def _search_ehr(self, params: FunctionCallParams) -> None:
        name = str(params.arguments.get("name", "")).strip()
        dob = str(params.arguments.get("birth_date", "")).strip()
        await self._reply(params, "search_ehr", await self.search(name, dob, "voice"))

    async def search(self, name: str, dob: str, method: str) -> str:
        """Shared by voice and the ID-card vision path. Never guesses among matches."""
        heard = self.grounding.heard_or_seen()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
            return "Need the birth date before searching. Ask for it."
        if method == "voice" and (not clinical.name_in(name, heard) or not clinical.date_heard(dob, heard)):
            return "That name and birth date were not both heard. Ask the medic to say them."
        try:
            matches = await self.ehr.search(name, dob)
        except Exception as e:
            logger.warning(f"EHR search failed: {e}")
            return "EHR unreachable. Record not pulled."
        if not matches:
            return f"No EHR match for {name}, {dob}."
        if len(matches) > 1:
            return f"{len(matches)} records match. Ask to confirm the birth date; do not guess."
        m = matches[0]
        inc = self.state.incident
        if inc and inc.get("patient_ref") == m["id"]:
            return f"Already identified: {m['name']}, born {m['birth_date']}."
        ok = await self.stdb.call("identify_patient", m["id"], method)
        await self.stdb.step(WF if method == "voice" else "Vision", "identify_patient", f"{m['id']} ({method})" + ("" if ok else " failed"))
        return f"One match: {m['name']}, born {m['birth_date']}. Identified; the record is being pulled." if ok else "Identify failed."

    async def _check_allergy(self, params: FunctionCallParams) -> None:
        drug = str(params.arguments.get("drug", ""))
        await self._reply(params, "check_allergy", clinical.check_allergy(drug, self.state.record)["text"])

    async def _check_dose_range(self, params: FunctionCallParams) -> None:
        a = params.arguments
        dose = a.get("dose")
        res = clinical.check_dose(str(a.get("drug", "")), float(dose) if dose is not None else None, str(a.get("unit") or "mg"))
        await self._reply(params, "check_dose_range", res["text"])

    async def _log_event(self, params: FunctionCallParams) -> None:
        kind = str(params.arguments.get("kind", "")).strip().lower()
        label = str(params.arguments.get("label", "")).strip()[:80]
        if kind.startswith("med_"):
            drug = clinical.normalize_drug(kind[4:])
            if drug not in clinical.DOSE_TABLE and label:  # e.g. "med_generic": take the drug from the label
                drug = clinical.normalize_drug(label.split()[0])
            kind = "med_" + drug
        if not EVENT_KIND.match(kind) or not label:
            return await self._reply(params, "log_event", f"Not logged: bad kind '{kind}'.")
        detail = self.state.transcripts[-1]["text"] if self.state.transcripts else label
        ok = await self.stdb.call("log_event", kind, label, "voice", detail[:200])
        await self._reply(params, "log_event", f"Logged {label}." if ok else "Not logged: no active incident.")

    async def _look(self, params: FunctionCallParams) -> None:
        self._look_now()
        await self._reply(params, "look", "Looking now; the camera result is spoken separately. Say nothing.")


def _args(a) -> str:
    return ", ".join(f"{k}={v}" for k, v in dict(a).items()) or "()"
