"""Deterministic clinical tools: EHR search, allergy check, dose range. The model only phrases their results.

Synthetic prototype. The dose table is a demo reference for adult cardiac-arrest drugs, not clinical guidance.
"""
import re

import httpx

DOSE_TABLE: dict[str, dict] = {
    "epinephrine": {"unit": "mg", "min": 1.0, "max": 1.0, "note": "1 mg IV/IO every 3 to 5 min in arrest"},
    "amiodarone": {"unit": "mg", "min": 150.0, "max": 300.0, "note": "300 mg first dose, 150 mg second"},
    "naloxone": {"unit": "mg", "min": 0.4, "max": 2.0, "note": "0.4 to 2 mg"},
    "adenosine": {"unit": "mg", "min": 6.0, "max": 12.0, "note": "6 mg, then 12 mg"},
    "atropine": {"unit": "mg", "min": 0.5, "max": 1.0, "note": "0.5 to 1 mg"},
}
ALIASES = {"epi": "epinephrine", "adrenaline": "epinephrine", "amio": "amiodarone", "narcan": "naloxone"}

MONTHS = {m: i + 1 for i, m in enumerate(
    "january february march april may june july august september october november december".split())}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})


def normalize_drug(name: str) -> str:
    n = re.sub(r"[^a-z]", "", name.lower())
    return ALIASES.get(n, n)


def check_allergy(drug: str, record: dict | None) -> dict:
    d = normalize_drug(drug)
    if not record:
        return {"drug": d, "allergic": None, "text": f"Allergies unknown: no patient record yet. Ask about {d} allergy."}
    src = "cached copy" if record.get("source") == "cached" else "EHR"
    hits = [a for a in record.get("allergies", []) if d and (d in a.lower() or a.lower() in d)]
    if hits:
        return {"drug": d, "allergic": True, "text": f"Allergy on record: {hits[0]} ({src})."}
    return {"drug": d, "allergic": False, "text": f"No {d} allergy on record ({src})."}


def check_dose(drug: str, dose: float | None, unit: str = "mg") -> dict:
    d = normalize_drug(drug)
    ref = DOSE_TABLE.get(d)
    if not ref:
        return {"drug": d, "in_range": None, "text": f"No dose reference for {d}."}
    if dose is None:
        return {"drug": d, "in_range": None, "text": f"{d} reference: {ref['note']}."}
    u = unit.lower().strip()
    mg = dose / 1000 if u in ("mcg", "ug", "microgram", "micrograms") else dose * 1000 if u in ("g", "gram", "grams") else dose
    ok = ref["min"] <= mg <= ref["max"]
    word = "within" if ok else "outside"
    return {"drug": d, "in_range": ok, "text": f"{d} {dose:g} {unit} is {word} the reference ({ref['note']})."}


NUMBER_WORDS = {"half": "0.5", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
                "ten": "10", "twelve": "12", "fifty": "50", "one hundred fifty": "150", "three hundred": "300"}


def parse_dose(text: str) -> tuple[float, str] | None:
    text = text.lower()
    for w in sorted(NUMBER_WORDS, key=len, reverse=True):
        text = re.sub(rf"\b{w}\b", NUMBER_WORDS[w], text)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|milligrams?|micrograms?|grams?)\b", text.lower())
    if not m:
        return None
    unit = {"milligram": "mg", "milligrams": "mg", "microgram": "mcg", "micrograms": "mcg", "gram": "g", "grams": "g"}
    return float(m.group(1)), unit.get(m.group(2), m.group(2))


UNITS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9,
            "tenth": 10, "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
            "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19, "twentieth": 20, "thirtieth": 30}


def _small(words: list[str]) -> int | None:
    """0-99 from words like ['sixty', 'eight'] or ['fourteenth']."""
    if len(words) == 1:
        w = words[0]
        return UNITS.index(w) if w in UNITS else TENS.get(w, ORDINALS.get(w))
    if len(words) == 2 and words[0] in TENS:
        tail = UNITS.index(words[1]) if words[1] in UNITS[1:10] else ORDINALS.get(words[1]) if ORDINALS.get(words[1], 99) < 10 else None
        return None if tail is None else TENS[words[0]] + tail
    return None


def spoken_numbers(text: str) -> str:
    """'march fourteenth nineteen sixty-eight' -> 'march 14 1968'."""
    num = "|".join(UNITS + list(TENS) + list(ORDINALS))
    group = rf"(?:(?:{'|'.join(TENS)})[ -](?:{'|'.join(UNITS[1:10] + [o for o, v in ORDINALS.items() if v < 10])})|{num})"

    def year(m: re.Match) -> str:
        hi, lo = _small(m.group(1).replace("-", " ").split()), _small(m.group(2).replace("-", " ").split())
        return m.group(0) if hi is None or lo is None else str(hi * 100 + lo)

    t = re.sub(rf"\b(nineteen|twenty)[ -]({group})\b", year, text)
    t = re.sub(rf"\b({group})\b", lambda m: str(v) if (v := _small(m.group(1).replace('-', ' ').split())) is not None else m.group(0), t)
    return t


def dates_in(text: str) -> set[str]:
    """ISO dates written in a line: 1968-03-14, 3/14/1968, March 14th 1968, 14 March 1968, spoken words too."""
    t = spoken_numbers(text.lower())
    out: set[str] = set()
    for y, m, d in re.findall(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", t):
        out.add(f"{int(y):04d}-{int(m):02d}-{int(d):02d}")
    for m, d, y in re.findall(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", t):
        out.add(f"{int(y):04d}-{int(m):02d}-{int(d):02d}")
    month = "|".join(sorted(MONTHS, key=len, reverse=True))
    for mo, d, y in re.findall(rf"\b({month})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?[.,]?\s+(\d{{4}})\b", t):
        out.add(f"{int(y):04d}-{MONTHS[mo]:02d}-{int(d):02d}")
    for d, mo, y in re.findall(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({month})\.?,?\s+(\d{{4}})\b", t):
        out.add(f"{int(y):04d}-{MONTHS[mo]:02d}-{int(d):02d}")
    return out


def date_heard(iso: str, text: str) -> bool:
    """The year, month and day of an ISO date all appear in what was said, even split across STT lines."""
    if iso in dates_in(text):
        return True
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", iso)
    if not m:
        return False
    y, mo, d = m.group(1), int(m.group(2)), int(m.group(3))
    t = spoken_numbers(text.lower())
    months = [k for k, v in MONTHS.items() if v == mo]
    return (re.search(rf"\b{y}\b", t) is not None
            and any(re.search(rf"\b{k}\b", t) for k in months)
            and re.search(rf"\b{d}(?:st|nd|rd|th)?\b", t) is not None)


def name_in(name: str, text: str) -> bool:
    words = re.findall(r"[a-z']+", name.lower())
    have = set(re.findall(r"[a-z']+", text.lower()))
    return len(words) >= 2 and all(w in have for w in words)


class Ehr:
    def __init__(self, base_url: str):
        self.base = base_url
        self.client = httpx.AsyncClient(timeout=3)

    async def search(self, name: str, birth_date: str) -> list[dict]:
        r = await self.client.get(f"{self.base}/Patient", params={"name": name, "birthdate": birth_date})
        r.raise_for_status()
        out = []
        for e in r.json().get("entry", []):
            p = e["resource"]
            n = (p.get("name") or [{}])[0]
            out.append({"id": p["id"], "name": " ".join(n.get("given", []) + [n.get("family", "")]).strip(),
                        "birth_date": p.get("birthDate", "")})
        return out
