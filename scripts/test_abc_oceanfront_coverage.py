import tempfile
import unittest
import zipfile
from pathlib import Path

from abc_oceanfront_coverage import (
    active_license_candidates,
    build_coverage_report,
    read_xlsx_rows,
)


class AbcOceanfrontCoverageTests(unittest.TestCase):
    def test_reads_shared_string_workbook_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            workbook = Path(directory) / "fixture.xlsx"
            with zipfile.ZipFile(workbook, "w") as archive:
                archive.writestr(
                    "xl/sharedStrings.xml",
                    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    '<si><t>LICENSE #</t></si><si><t>ABC-1</t></si></sst>',
                )
                archive.writestr(
                    "xl/worksheets/sheet1.xml",
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
                    '<row r="2"><c r="A2" t="s"><v>1</v></c></row>'
                    '</sheetData></worksheet>',
                )
            self.assertEqual(read_xlsx_rows(workbook), [["LICENSE #"], ["ABC-1"]])

    def test_filters_to_active_long_term_on_premise_licensees(self):
        base = {
            "LICENSE #": "1",
            "RECORD TYPE": "Retail Restaurant or Caterer License",
            "FACILITY OR ESTABLISHMENT NAME": "Atlantic Pints",
            "ESTABLISHMENT TYPE": "Restaurant",
            "BEER/WINE STATUS": "Active",
            "MIXED BEVERAGE STATUS": "Active",
            "CONSUMPTION LOCATION": "On and Off Premises",
            "ADDRESS": "2314 Atlantic Ave",
            "CITY": "Virginia Beach",
            "STATE": "VA",
            "ZIP": "23451",
        }
        rows = [
            base,
            {**base, "LICENSE #": "2", "RECORD TYPE": "Industry Brewery License"},
            {**base, "LICENSE #": "3", "FACILITY OR ESTABLISHMENT NAME": "Store", "CONSUMPTION LOCATION": "Off Premises"},
            {**base, "LICENSE #": "4", "FACILITY OR ESTABLISHMENT NAME": "Old Bar", "BEER/WINE STATUS": "Expired", "MIXED BEVERAGE STATUS": ""},
            {**base, "LICENSE #": "5", "FACILITY OR ESTABLISHMENT NAME": "Party", "RECORD TYPE": "Banquet License"},
        ]
        candidates = active_license_candidates(rows)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["licenseNumbers"], ["1", "2"])
        self.assertEqual(len(candidates[0]["recordTypes"]), 2)

    def test_coverage_keeps_license_evidence_separate_from_live_truth(self):
        prepared = {
            "source": {"authority": "Virginia ABC"},
            "candidates": [
                {"candidateId": "1", "name": "The Beach Pub", "address": "1001 Laskin Rd", "recordTypes": ["Retail Restaurant or Caterer License"]},
                {"candidateId": "2", "name": "Atlantic Pints", "address": "2314 Atlantic Ave", "recordTypes": ["Retail Restaurant or Caterer License"]},
                {"candidateId": "3", "name": "Dinner House", "address": "2400 Atlantic Ave", "recordTypes": ["Retail Restaurant or Caterer License"]},
                {"candidateId": "4", "name": "Far Away Pub", "address": "Outside", "recordTypes": ["Retail Restaurant or Caterer License"]},
            ],
        }
        geocodes = {
            "1": {"latitude": 36.8573, "longitude": -75.9913, "matchType": "Exact", "matchedAddress": "1001 LASKIN RD"},
            "2": {"latitude": 36.8513, "longitude": -75.9759, "matchType": "Exact", "matchedAddress": "2314 ATLANTIC AVE"},
            "3": {"latitude": 36.852, "longitude": -75.976, "matchType": "Exact", "matchedAddress": "2400 ATLANTIC AVE"},
            "4": {"latitude": 36.9, "longitude": -76.1, "matchType": "Exact", "matchedAddress": "OUTSIDE"},
        }
        inventory = {
            "success": True,
            "priorityScopes": [{
                "id": "virginia-beach-oceanfront",
                "database": {"inventory": [{
                    "id": "beach-pub",
                    "name": "Beach Pub",
                    "city": "Virginia Beach",
                    "address": "1001 Laskin Road, Virginia Beach, VA 23451",
                    "category": "Bars",
                    "type": "Pub / Restaurant",
                    "kinds": ["nightlife", "food"],
                }]},
            }],
        }
        report = build_coverage_report(prepared, geocodes, inventory)
        self.assertEqual(report["coverage"]["inScopeCandidates"], 3)
        self.assertEqual(report["coverage"]["matchedCandidates"], 1)
        self.assertEqual(report["coverage"]["unmatchedReviewCandidates"], 2)
        self.assertEqual(report["coverage"]["nightlifeHintCandidates"], 2)
        self.assertEqual(report["coverage"]["unmatchedNightlifeHints"], 1)
        self.assertIn("not that a venue is a bar, club, currently open, busy, or Live", report["truthNote"])


if __name__ == "__main__":
    unittest.main()
