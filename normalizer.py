import re
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class NormalizedText:
    raw: str
    normalized: str
    phones: List[str]
    osu_matches: List[str]
    zero_loaded_items: List[str]


ITEM_SYNONYMS: Dict[str, str] = {
    # Vaccines
    "bcg": "BCG",
    "opv": "OPV",
    "bopv": "OPV",
    "ipv": "IPV",
    "pcv": "PCV",
    "pcv13": "PCV",
    "mr": "Measles-Rubella Vaccine",
    "measles": "Measles-Rubella Vaccine",
    "measles rubella": "Measles-Rubella Vaccine",
    "yf": "Yellow Fever Vaccine",
    "yfv": "Yellow Fever Vaccine",
    "yellow fever": "Yellow Fever Vaccine",
    "penta": "Pentavalent Vaccine",
    "pentavalent": "Pentavalent Vaccine",
    "td": "Tetanus-Diphtheria Vaccine",
    "tt": "Tetanus-Diphtheria Vaccine",
    "rota": "Rotavirus Vaccine",
    "rotavirus": "Rotavirus Vaccine",
    "hpv": "HPV Vaccine",
    "men": "Meningitis Vaccine",
    "menafrivac": "Meningitis Vaccine",
    "moderna": "COVID-19 Vaccine",
    "pfizer": "COVID-19 Vaccine",
    "janssen": "COVID-19 Vaccine",
    "covishield": "COVID-19 Vaccine",
    "rts,s": "Malaria Vaccine",
    "mosquirix": "Malaria Vaccine",

    # Medical products
    "act": "Artemether Lumefantrine",
    "al": "Artemether Lumefantrine",
    "coartem": "Artemether Lumefantrine",
    "artemether lumefantrine": "Artemether Lumefantrine",
    "artemether + lumefantrine": "Artemether Lumefantrine",

    "pcm": "Paracetamol",
    "apap": "Paracetamol",
    "panadol": "Paracetamol",
    "paracetamol": "Paracetamol",

    "amox": "Amoxicillin",
    "amoxicillin": "Amoxicillin",
    "amoxil": "Amoxicillin",

    "oxy": "Oxytocin",
    "oxytocin": "Oxytocin",
    "syntocinon": "Oxytocin",

    "as": "Artesunate",
    "artesunate": "Artesunate",
    "inj artesunate": "Artesunate",

    "ifa": "Iron Folic Acid",
    "iron folic acid": "Iron Folic Acid",
    "feso4 folic": "Iron Folic Acid",
    "ferrous sulfate folic acid": "Iron Folic Acid",

    "ors": "ORS",
    "ort": "ORS",

    "zinc dt": "Zinc Dispersible Tablets",
    "zinc dispersible": "Zinc Dispersible Tablets",
    "zinc tablets": "Zinc Dispersible Tablets",

    "ns": "Normal Saline",
    "normal saline": "Normal Saline",
    "d5": "Dextrose 5%",
    "dextrose 5": "Dextrose 5%",
    "rl": "Ringers Lactate",
    "ringers lactate": "Ringers Lactate",
    "ringer's lactate": "Ringers Lactate",
    "hartmanns": "Ringers Lactate",
    "dns": "Dextrose Normal Saline",

    # Blood products
    "wb": "Whole Blood",
    "whole blood": "Whole Blood",
    "prbc": "Packed Red Blood Cells",
    "packed cells": "Packed Red Blood Cells",
    "packed red blood cells": "Packed Red Blood Cells",
    "ffp": "Fresh Frozen Plasma",
    "fresh frozen plasma": "Fresh Frozen Plasma",
    "plt": "Platelets",
    "pc": "Platelets",
    "platelets": "Platelets",
    "platelet concentration": "Platelets",

    # Consumables
    "syringe": "Syringe",
    "syringes": "Syringe",
    "cannula": "Cannula",
    "cannulas": "Cannula",
    "glove": "Gloves",
    "gloves": "Gloves",
    "mrdt": "Malaria RDT",
    "rdt": "Malaria RDT",
    "malaria rdt": "Malaria RDT",
    "giving set": "Giving Set",
    "iv giving set": "Giving Set",
    "blood giving set": "Giving Set",
    "cotton": "Cotton Wool",
    "cotton wool": "Cotton Wool",
    "gauze": "Gauze",
    "gauze bandage": "Gauze",
}


BLOOD_TYPE_SYNONYMS: Dict[str, str] = {
    "o positive": "O+",
    "o pos": "O+",
    "o+": "O+",
    "o negative": "O-",
    "o neg": "O-",
    "o-": "O-",
    "a positive": "A+",
    "a pos": "A+",
    "a+": "A+",
    "a negative": "A-",
    "a neg": "A-",
    "a-": "A-",
    "b positive": "B+",
    "b pos": "B+",
    "b+": "B+",
    "b negative": "B-",
    "b neg": "B-",
    "b-": "B-",
    "ab positive": "AB+",
    "ab pos": "AB+",
    "ab+": "AB+",
    "ab negative": "AB-",
    "ab neg": "AB-",
    "ab-": "AB-",
}


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)

    if digits.startswith("233") and len(digits) == 12:
        return digits

    if digits.startswith("0") and len(digits) == 10:
        return "233" + digits[1:]

    if len(digits) == 9:
        return "233" + digits

    return digits


def extract_phones(text: str) -> List[str]:
    candidates = re.findall(
        r"(?:\+233|233|0)?\s?\d{2,3}[\s\-]?\d{3}[\s\-]?\d{4}",
        text or "",
    )

    phones = []

    for candidate in candidates:
        phone = normalize_phone(candidate)
        if len(phone) >= 9 and phone not in phones:
            phones.append(phone)

    return phones


def normalize_blood_types(text: str) -> str:
    normalized = text or ""

    for synonym, canonical in sorted(
        BLOOD_TYPE_SYNONYMS.items(),
        key=lambda x: len(x[0]),
        reverse=True,
    ):
        normalized = re.sub(
            rf"\b{re.escape(synonym)}\b",
            canonical,
            normalized,
            flags=re.IGNORECASE,
        )

    return normalized


def normalize_items(text: str) -> str:
    normalized = text or ""

    for synonym, canonical in sorted(
        ITEM_SYNONYMS.items(),
        key=lambda x: len(x[0]),
        reverse=True,
    ):
        normalized = re.sub(
            rf"\b{re.escape(synonym)}\b",
            canonical,
            normalized,
            flags=re.IGNORECASE,
        )

    return normalized


def normalize_osu_items(osu_items: List[str]) -> List[str]:
    normalized = []

    for item in osu_items or []:
        clean = normalize_items(item).strip()
        if clean and clean not in normalized:
            normalized.append(clean)

    return normalized


def detect_osu_matches(text: str, normalized_osu_items: List[str]) -> List[str]:
    matches = []
    normalized_text = normalize_items(text).lower()

    for item in normalized_osu_items:
        if item.lower() in normalized_text and item not in matches:
            matches.append(item)

    return matches


def detect_zero_loaded_items(text: str) -> List[str]:
    found = []
    normalized = normalize_items(text or "")

    patterns = [
        r"(?P<item>[A-Za-z0-9,+/%\-\s]+?)\s*[:\-]?\s*0\s*/\s*\d+",
        r"(?P<item>[A-Za-z0-9,+/%\-\s]+?)\s*[:\-]?\s*0\s+of\s+\d+",
        r"(?P<item>[A-Za-z0-9,+/%\-\s]+?)\s*[:\-]?\s*0\s+loaded",
        r"(?P<item>[A-Za-z0-9,+/%\-\s]+?)\s*[:\-]?\s*0\s+units",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, normalized, flags=re.IGNORECASE):
            item_raw = re.sub(r"\s+", " ", match.group("item")).strip()
            item_normalized = normalize_items(item_raw).strip()

            words = item_normalized.split()
            if len(words) > 5:
                item_normalized = " ".join(words[-5:])

            if item_normalized and item_normalized not in found:
                found.append(item_normalized)

    return found


def normalize_message(text: str, osu_items: List[str] | None = None) -> NormalizedText:
    osu_items = osu_items or []
    normalized_osu_items = normalize_osu_items(osu_items)

    normalized = text or ""
    normalized = normalize_blood_types(normalized)
    normalized = normalize_items(normalized)

    return NormalizedText(
        raw=text or "",
        normalized=normalized,
        phones=extract_phones(normalized),
        osu_matches=detect_osu_matches(normalized, normalized_osu_items),
        zero_loaded_items=detect_zero_loaded_items(normalized),
    )


def build_normalized_context(
    whatsapp_message: str,
    fulfillment_confirmation: str,
    osu_items: List[str],
) -> dict:
    normalized_osu_items = normalize_osu_items(osu_items)

    whatsapp = normalize_message(
        whatsapp_message,
        osu_items=normalized_osu_items,
    )

    fulfillment = normalize_message(
        fulfillment_confirmation,
        osu_items=normalized_osu_items,
    )

    return {
        "whatsapp": {
            "raw": whatsapp.raw,
            "normalized": whatsapp.normalized,
            "phones": whatsapp.phones,
            "osu_matches": whatsapp.osu_matches,
            "zero_loaded_items": whatsapp.zero_loaded_items,
        },
        "fulfillment": {
            "raw": fulfillment.raw,
            "normalized": fulfillment.normalized,
            "phones": fulfillment.phones,
            "osu_matches": fulfillment.osu_matches,
            "zero_loaded_items": fulfillment.zero_loaded_items,
        },
        "normalized_osu_items": normalized_osu_items,
        "python_preprocessing_notes": {
            "phones": "Phones were normalized to Ghana 233-format before model review.",
            "items": "Known item abbreviations and medical synonyms were normalized before model review.",
            "facility": (
                "Facility names were NOT normalized or auto-matched in Python. "
                "The model must compare raw facility names carefully. "
                "Do not assume HC, Health Centre, Hospital, Clinic, CHPS, Polyclinic, etc. are equivalent."
            ),
            "osu": (
                "OSU items and zero-loaded items were detected before model review. "
                "If present, mark affected requested items as out of stock."
            ),
        },
    }