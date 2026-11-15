import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "triage-reviews.py"


def load_script():
    google = types.ModuleType("google")
    oauth2 = types.ModuleType("google.oauth2")
    service_account = types.ModuleType("google.oauth2.service_account")
    discovery = types.ModuleType("googleapiclient.discovery")
    service_account.Credentials = Mock()
    discovery.build = Mock()
    oauth2.service_account = service_account
    google.oauth2 = oauth2
    with patch.dict(
        sys.modules,
        {
            "google": google,
            "google.oauth2": oauth2,
            "google.oauth2.service_account": service_account,
            "googleapiclient": types.ModuleType("googleapiclient"),
            "googleapiclient.discovery": discovery,
        },
    ):
        spec = importlib.util.spec_from_file_location("triage_reviews", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module


triage = load_script()


def gh_result(payload, returncode=0, stderr=""):
    return Mock(returncode=returncode, stdout=payload, stderr=stderr)


class TriageReviewsTests(unittest.TestCase):
    def test_failed_lookup_is_uncertain(self):
        with patch.object(triage.subprocess, "run", return_value=gh_result("", 1, "offline")):
            with self.assertRaises(triage.IssueLookupError):
                triage.find_existing_issue()

    def test_malformed_lookup_is_uncertain(self):
        with patch.object(triage.subprocess, "run", return_value=gh_result("{bad")):
            with self.assertRaises(triage.IssueLookupError):
                triage.find_existing_issue()

    def test_ambiguous_lookup_is_uncertain(self):
        issues = [{"number": 1, "title": triage.ISSUE_TITLE, "body": "a"},
                  {"number": 2, "title": triage.ISSUE_TITLE, "body": "b"}]
        with patch.object(triage.subprocess, "run", return_value=gh_result(json.dumps(issues))):
            with self.assertRaises(triage.IssueLookupError):
                triage.find_existing_issue()

    def test_empty_lookup_allows_create(self):
        with patch.object(triage.subprocess, "run", return_value=gh_result("[]")):
            self.assertIsNone(triage.find_existing_issue())

    def test_failed_lookup_prevents_write(self):
        reviews = [{"review_id": "r1", "rating": 1, "text": "bad", "date": "2026-11-15", "lang": "en"}]
        with patch.object(triage, "env_client"), patch.object(triage, "fetch_reviews", return_value=reviews), \
             patch.object(triage.subprocess, "run", return_value=gh_result("", 1, "offline")), \
             patch.object(triage, "write_issue") as write_issue:
            self.assertEqual(triage.main(), 1)
            write_issue.assert_not_called()

    def test_empty_lookup_reaches_create(self):
        reviews = [{"review_id": "r1", "rating": 1, "text": "bad", "date": "2026-11-15", "lang": "en"}]
        with patch.object(triage, "env_client"), patch.object(triage, "fetch_reviews", return_value=reviews), \
             patch.object(triage.subprocess, "run", return_value=gh_result("[]")), \
             patch.object(triage, "write_issue") as write_issue:
            self.assertIsNone(triage.main())
            write_issue.assert_called_once()
            self.assertIsNone(write_issue.call_args.args[0])

    def test_existing_issue_updates(self):
        reviews = [{"review_id": "r1", "rating": 1, "text": "bad", "date": "2026-11-15", "lang": "en"}]
        issue = {"number": 7, "title": triage.ISSUE_TITLE, "body": "<!-- review-triage:old -->"}
        with patch.object(triage, "env_client"), patch.object(triage, "fetch_reviews", return_value=reviews), \
             patch.object(triage.subprocess, "run", return_value=gh_result(json.dumps([issue]))), \
             patch.object(triage, "write_issue") as write_issue:
            self.assertIsNone(triage.main())
            write_issue.assert_called_once()
            self.assertEqual(write_issue.call_args.args[0], issue)

    def test_unchanged_marker_is_no_op(self):
        reviews = [{"review_id": "r1", "rating": 1, "text": "bad", "date": "2026-11-15", "lang": "en"}]
        issue = {"number": 7, "title": triage.ISSUE_TITLE, "body": "<!-- review-triage:r1 -->"}
        with patch.object(triage, "env_client"), patch.object(triage, "fetch_reviews", return_value=reviews), \
             patch.object(triage.subprocess, "run", return_value=gh_result(json.dumps([issue]))), \
             patch.object(triage, "write_issue") as write_issue:
            self.assertIsNone(triage.main())
            write_issue.assert_not_called()

    def test_uncertain_lookup_prevents_write(self):
        reviews = [{"review_id": "r1", "rating": 1, "text": "bad", "date": "2026-11-15", "lang": "en"}]
        responses = [
            gh_result("{bad"),
            gh_result(json.dumps([{"number": 1, "title": triage.ISSUE_TITLE, "body": "a"},
                                  {"number": 2, "title": triage.ISSUE_TITLE, "body": "b"}])),
        ]
        for response in responses:
            with self.subTest(response=response.stdout), patch.object(triage, "env_client"), \
                 patch.object(triage, "fetch_reviews", return_value=reviews), \
                 patch.object(triage.subprocess, "run", return_value=response), \
                 patch.object(triage, "write_issue") as write_issue:
                self.assertEqual(triage.main(), 1)
                write_issue.assert_not_called()


if __name__ == "__main__":
    unittest.main()
