#!/usr/bin/env python3
"""Build a review-only Oceanfront coverage report from Virginia ABC licenses."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import zipfile
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree


ABC_DIRECTORY_URL = "https://www.abc.virginia.gov/licenses/find-a-license"
ABC_WORKBOOK_URL = "https://salicenseeexport.blob.core.windows.net/export/LicenseSearchReport.xlsx"
CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
OCEANFRONT_CENTER = (36.8529, -75.978)
OCEANFRONT_RADIUS_MILES = 1.8
ALLOWED_RECORD_TYPES = {
    "Retail Restaurant or Caterer License",
    "Retail Hotel License",
    "Retail Private Club License",
    "Retail Annual Mixed Beverage License",
    "Industry Brewery License",
    "Industry Distillery License",
}
INDUSTRY_RECORD_TYPES = {"Industry Brewery License", "Industry Distillery License"}
NIGHTLIFE_NAME = re.compile(
    r"\b(?:ale house|bar|brewery|brewing|brewhouse|cantina|club|distillery|"
    r"lounge|night club|nightclub|pints|pub|raw bar|saloon|sports lounge|"
    r"tap house|taphouse|taproom|tavern|wine bar)\b",
    re.IGNORECASE,
)
XML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MAX_WORKBOOK_MEMBER_BYTES = 180_000_000
MAX_WORKBOOK_UNCOMPRESSED_BYTES = 200_000_000


def clean(value: Any) -> str:
    return str(value or "").strip()


def normalize(value: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", clean(value).lower().replace("&", " and ")).split())


def canonical_name(value: Any) -> str:
    tokens = normalize(value).split()
    if tokens[:1] == ["the"]:
        tokens = tokens[1:]
    return " ".join(token for token in tokens if token not in {"corporation", "corp", "inc", "llc"})


def street_address(value: Any) -> str:
    first = clean(value).split(",")[0]
    normalized = normalize(first)
    replacements = {
        "avenue": "ave",
        "boulevard": "blvd",
        "drive": "dr",
        "highway": "hwy",
        "road": "rd",
        "street": "st",
    }
    for source, target in replacements.items():
        normalized = re.sub(rf"\b{source}\b", target, normalized)
    return re.sub(r"\b(?:suite|ste|unit)\b.*$", "", normalized).strip()


def distance_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 3958.7613
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    if not letters:
        return 0
    result = 0
    for character in letters.group(0):
        result = result * 26 + ord(character) - ord("A") + 1
    return result - 1


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    path = "xl/sharedStrings.xml"
    if path not in archive.namelist():
        return []
    strings: list[str] = []
    with archive.open(path) as source:
        for _event, element in ElementTree.iterparse(source, events=("end",)):
            if element.tag == f"{XML_NS}si":
                strings.append("".join(node.text or "" for node in element.iter(f"{XML_NS}t")))
                element.clear()
    return strings


def read_xlsx_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if sum(member.file_size for member in members) > MAX_WORKBOOK_UNCOMPRESSED_BYTES:
            raise ValueError("Virginia ABC workbook expands beyond the safety limit")
        if any(member.file_size > MAX_WORKBOOK_MEMBER_BYTES for member in members):
            raise ValueError("Virginia ABC workbook contains an oversized member")
        strings = shared_strings(archive)
        sheet_path = "xl/worksheets/sheet1.xml"
        if sheet_path not in archive.namelist():
            raise ValueError("Virginia ABC workbook has no first worksheet")
        rows: list[list[str]] = []
        with archive.open(sheet_path) as source:
            for _event, element in ElementTree.iterparse(source, events=("end",)):
                if element.tag != f"{XML_NS}row":
                    continue
                values: list[str] = []
                for cell in element.findall(f"{XML_NS}c"):
                    index = column_index(cell.attrib.get("r", "A1"))
                    while len(values) <= index:
                        values.append("")
                    cell_type = cell.attrib.get("t")
                    raw = cell.findtext(f"{XML_NS}v") or ""
                    if cell_type == "s" and raw.isdigit() and int(raw) < len(strings):
                        values[index] = strings[int(raw)]
                    elif cell_type == "inlineStr":
                        values[index] = "".join(node.text or "" for node in cell.iter(f"{XML_NS}t"))
                    else:
                        values[index] = raw
                rows.append(values)
                element.clear()
    return rows


def workbook_records(path: Path) -> tuple[str | None, list[dict[str, str]]]:
    rows = read_xlsx_rows(path)
    run_as_of = next((value for row in rows for value in row if clean(value).startswith("Run As of ")), None)
    header_index = next((
        index for index, row in enumerate(rows)
        if "LICENSE #" in row and "FACILITY OR ESTABLISHMENT NAME" in row
    ), -1)
    if header_index < 0:
        raise ValueError("Virginia ABC workbook headers were not found")
    headers = [clean(value) for value in rows[header_index]]
    records: list[dict[str, str]] = []
    for row in rows[header_index + 1:]:
        record = {header: clean(row[index]) if index < len(row) else "" for index, header in enumerate(headers) if header}
        if any(record.values()):
            records.append(record)
    return run_as_of, records


def active_license_candidates(records: Iterable[dict[str, str]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for record in records:
        record_type = clean(record.get("RECORD TYPE"))
        active = "ACTIVE" in {
            clean(record.get("BEER/WINE STATUS")).upper(),
            clean(record.get("MIXED BEVERAGE STATUS")).upper(),
        }
        consumption = clean(record.get("CONSUMPTION LOCATION"))
        on_premises = bool(re.search(r"\bon\b", consumption, re.IGNORECASE)) or record_type in INDUSTRY_RECORD_TYPES
        name = clean(record.get("FACILITY OR ESTABLISHMENT NAME"))
        address = clean(record.get("ADDRESS"))
        if not (
            active
            and record_type in ALLOWED_RECORD_TYPES
            and on_premises
            and normalize(record.get("CITY")) == "virginia beach"
            and clean(record.get("ZIP")).startswith("23451")
            and name
            and address
        ):
            continue
        key = f"{canonical_name(name)}|{street_address(address)}"
        candidate = grouped.setdefault(key, {
            "candidateId": clean(record.get("LICENSE #")),
            "licenseNumbers": [],
            "name": name,
            "address": address,
            "city": "Virginia Beach",
            "state": "VA",
            "zip": clean(record.get("ZIP")),
            "recordTypes": [],
            "establishmentTypes": [],
            "consumptionLocations": [],
            "beerWineStatus": clean(record.get("BEER/WINE STATUS")) or None,
            "mixedBeverageStatus": clean(record.get("MIXED BEVERAGE STATUS")) or None,
        })
        for field, value in (
            ("licenseNumbers", clean(record.get("LICENSE #"))),
            ("recordTypes", record_type),
            ("establishmentTypes", clean(record.get("ESTABLISHMENT TYPE"))),
            ("consumptionLocations", consumption),
        ):
            if value and value not in candidate[field]:
                candidate[field].append(value)
    return sorted(grouped.values(), key=lambda item: (street_address(item["address"]), canonical_name(item["name"])))


def prepare_workbook(path: Path) -> dict[str, Any]:
    run_as_of, records = workbook_records(path)
    candidates = active_license_candidates(records)
    if len(candidates) < 50:
        raise ValueError(f"Virginia ABC candidate count is unexpectedly low: {len(candidates)}")
    return {
        "success": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "authority": "Virginia Alcoholic Beverage Control Authority",
            "directoryUrl": ABC_DIRECTORY_URL,
            "workbookUrl": ABC_WORKBOOK_URL,
            "workbookRunAsOf": run_as_of,
            "workbookSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        },
        "recordsEvaluated": len(records),
        "candidates": candidates,
    }


def parse_census_geocodes(path: Path) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    with path.open(newline="", encoding="utf-8") as source:
        for row in csv.reader(source):
            if len(row) < 6 or row[2] != "Match" or "," not in row[5]:
                continue
            try:
                longitude, latitude = (float(value) for value in row[5].split(",", 1))
            except ValueError:
                continue
            results[clean(row[0])] = {
                "latitude": latitude,
                "longitude": longitude,
                "matchType": clean(row[3]),
                "matchedAddress": clean(row[4]),
            }
    return results


def oceanfront_inventory(report: dict[str, Any]) -> list[dict[str, Any]]:
    if report.get("success") is not True:
        raise ValueError("Production official-nightlife inventory report was not successful")
    for scope in report.get("priorityScopes") or []:
        if scope.get("id") == "virginia-beach-oceanfront":
            return list(((scope.get("database") or {}).get("inventory")) or [])
    raise ValueError("Production inventory report has no Oceanfront scope")


def best_inventory_match(candidate: dict[str, Any], inventory: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    candidate_name = canonical_name(candidate.get("name"))
    candidate_address = street_address(candidate.get("address"))
    matches: list[tuple[float, dict[str, Any]]] = []
    for venue in inventory:
        venue_name = canonical_name(venue.get("name"))
        similarity = SequenceMatcher(None, candidate_name, venue_name).ratio()
        address_match = bool(candidate_address and candidate_address == street_address(venue.get("address")))
        substring_match = min(len(candidate_name), len(venue_name)) >= 5 and (
            candidate_name in venue_name or venue_name in candidate_name
        )
        if similarity < 0.92 and not (address_match and (similarity >= 0.72 or substring_match)):
            continue
        matches.append((similarity + (0.2 if address_match else 0), venue))
    return max(matches, key=lambda item: item[0])[1] if matches else None


def nightlife_hint(candidate: dict[str, Any]) -> bool:
    return bool(NIGHTLIFE_NAME.search(clean(candidate.get("name")))) or bool(
        INDUSTRY_RECORD_TYPES.intersection(candidate.get("recordTypes") or [])
    )


def build_coverage_report(
    prepared: dict[str, Any],
    geocodes: dict[str, dict[str, Any]],
    inventory_report: dict[str, Any],
) -> dict[str, Any]:
    inventory = oceanfront_inventory(inventory_report)
    matched: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    in_scope = 0
    nightlife_hints = 0
    unmatched_nightlife_hints = 0
    for candidate in prepared.get("candidates") or []:
        geocode = geocodes.get(clean(candidate.get("candidateId")))
        if not geocode:
            continue
        distance = distance_miles(
            geocode["latitude"], geocode["longitude"], OCEANFRONT_CENTER[0], OCEANFRONT_CENTER[1],
        )
        if distance > OCEANFRONT_RADIUS_MILES:
            continue
        in_scope += 1
        hint = nightlife_hint(candidate)
        nightlife_hints += int(hint)
        summary = {
            **candidate,
            **geocode,
            "distanceMiles": round(distance, 3),
            "evidenceTier": "official-license-nightlife-hint" if hint else "official-license-on-premise",
        }
        venue = best_inventory_match(candidate, inventory)
        if venue:
            matched.append({**summary, "matchedVenue": {
                "id": venue.get("id"),
                "name": venue.get("name"),
                "city": venue.get("city"),
                "address": venue.get("address"),
                "category": venue.get("category"),
                "type": venue.get("type"),
                "kinds": venue.get("kinds"),
            }})
        else:
            unmatched_nightlife_hints += int(hint)
            review.append(summary)
    source_count = len(prepared.get("candidates") or [])
    geocoded_count = len(geocodes)
    return {
        "success": True,
        "mode": "read-only-review",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": prepared.get("source"),
        "geocoder": {
            "authority": "U.S. Census Bureau",
            "url": CENSUS_GEOCODER_URL,
            "benchmark": "Public_AR_Current",
        },
        "district": {
            "id": "virginia-beach-oceanfront",
            "center": {"latitude": OCEANFRONT_CENTER[0], "longitude": OCEANFRONT_CENTER[1]},
            "radiusMiles": OCEANFRONT_RADIUS_MILES,
        },
        "coverage": {
            "sourceCandidates": source_count,
            "geocodedCandidates": geocoded_count,
            "geocodeFailures": max(0, source_count - geocoded_count),
            "inScopeCandidates": in_scope,
            "matchedCandidates": len(matched),
            "unmatchedReviewCandidates": len(review),
            "nightlifeHintCandidates": nightlife_hints,
            "unmatchedNightlifeHints": unmatched_nightlife_hints,
        },
        "matched": sorted(matched, key=lambda item: (item["distanceMiles"], canonical_name(item["name"]))),
        "reviewCandidates": sorted(review, key=lambda item: (not item["evidenceTier"].endswith("hint"), item["distanceMiles"], canonical_name(item["name"]))),
        "truthNote": (
            "Virginia ABC records prove an alcohol license was active in the downloaded workbook, not that a venue is a bar, club, currently open, busy, or Live. "
            "Name-based nightlife labels are review hints only. Census coordinates are address-range estimates. Every unmatched candidate requires current first-party verification before import."
        ),
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def command_prepare(args: argparse.Namespace) -> None:
    prepared = prepare_workbook(Path(args.workbook))
    write_json(Path(args.output), prepared)
    with Path(args.geocode_input).open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        for candidate in prepared["candidates"]:
            writer.writerow([
                candidate["candidateId"], candidate["address"], candidate["city"], candidate["state"], candidate["zip"],
            ])
    print(json.dumps({
        "recordsEvaluated": prepared["recordsEvaluated"],
        "candidates": len(prepared["candidates"]),
        "workbookRunAsOf": (prepared.get("source") or {}).get("workbookRunAsOf"),
        "workbookSha256": (prepared.get("source") or {}).get("workbookSha256"),
    }))


def command_report(args: argparse.Namespace) -> None:
    prepared = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    inventory = json.loads(Path(args.inventory).read_text(encoding="utf-8"))
    report = build_coverage_report(prepared, parse_census_geocodes(Path(args.geocodes)), inventory)
    coverage = report["coverage"]
    if coverage["inScopeCandidates"] < 50:
        raise ValueError(f"Oceanfront in-scope candidate count is unexpectedly low: {coverage['inScopeCandidates']}")
    if coverage["matchedCandidates"] + coverage["unmatchedReviewCandidates"] != coverage["inScopeCandidates"]:
        raise ValueError("Oceanfront coverage totals do not balance")
    write_json(Path(args.output), report)
    print(json.dumps(coverage))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--workbook", required=True)
    prepare.add_argument("--output", required=True)
    prepare.add_argument("--geocode-input", required=True)
    prepare.set_defaults(handler=command_prepare)
    report = commands.add_parser("report")
    report.add_argument("--candidates", required=True)
    report.add_argument("--geocodes", required=True)
    report.add_argument("--inventory", required=True)
    report.add_argument("--output", required=True)
    report.set_defaults(handler=command_report)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    arguments.handler(arguments)
