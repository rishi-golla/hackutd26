"""Integration checks against a disposable local SpacetimeDB runtime, never Maincloud.

Publish this module as handoff-hospital-test on http://127.0.0.1:3900, then:
    python -m unittest discover -s spacetime/test -v
"""
import json
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:3900"
DATABASE = "handoff-hospital-test"


class SessionIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with urlopen(Request(f"{BASE}/v1/identity", method="POST")) as response:
            cls.token = json.load(response)["token"]

    def request(self, endpoint, body, content_type="application/json"):
        request = Request(f"{BASE}/v1/database/{DATABASE}/{endpoint}", data=body.encode(), method="POST",
                          headers={"Authorization": f"Bearer {self.token}", "Content-Type": content_type})
        with urlopen(request) as response:
            result = response.read()
            return json.loads(result) if result else None

    def call(self, reducer, args):
        return self.request(f"call/{reducer}", json.dumps(args))

    def rows(self, sql):
        result = self.request("sql", sql, "text/plain")
        return result[0]["rows"]

    def setUp(self):
        self.call("demo_control", ["reset", ""])

    def test_new_session_creates_patient_and_retry_cannot_reopen_closed_call(self):
        self.call("start_bodycam_session", ["bodycam-test", "session-a", "Test Unit"])
        first = self.rows("SELECT id FROM incident")[0][0]
        self.call("start_bodycam_session", ["bodycam-test", "session-a", "Test Unit"])
        self.assertEqual(len(self.rows("SELECT id FROM incident")), 1)
        self.call("demo_control", ["close", ""])
        self.call("start_bodycam_session", ["bodycam-test", "session-a", "Test Unit"])
        self.assertEqual(self.rows("SELECT status FROM incident"), [["closed"]])
        self.call("start_bodycam_session", ["bodycam-test", "session-b", "Test Unit"])
        self.call("start_bodycam_session", ["bodycam-test", "session-c", "Test Unit"])
        self.assertEqual(len(self.rows("SELECT id FROM incident")), 2, "new camera reconnect reuses the active encounter")
        self.assertIn([first], self.rows("SELECT id FROM incident"))

    def test_actual_relay_readings_are_assigned_and_survive_closing_patient(self):
        self.call("start_bodycam_session", ["bodycam-test", "sensor-session", "Test Unit"])
        incident = self.rows("SELECT id FROM incident")[0][0]
        self.call("push_vitals", ["relay-test", json.dumps({"hr": 73, "spo2": 98, "status": "pulse", "simulated": False})])
        self.call("demo_control", ["close", ""])
        # SQL encodes an optional f32 as [0, value] (Some), rather than a bare number.
        self.assertEqual(self.rows("SELECT incident_id, hr FROM vitals"), [[incident, [0, 73.0]]])

    def test_recording_targets_historical_patient_and_rejects_invalid_urls(self):
        self.call("start_bodycam_session", ["bodycam-test", "recording-a", "Test Unit"])
        old = self.rows("SELECT id FROM incident")[0][0]
        self.call("demo_control", ["close", ""])
        self.call("start_bodycam_session", ["bodycam-test", "recording-b", "Test Unit"])
        self.call("demo_control", ["attach_recording", json.dumps({"incidentId": str(old), "url": "https://example.com/clip.mp4", "label": "Training clip"})])
        self.assertEqual(self.rows("SELECT incident_id FROM event WHERE kind = 'session_recording'"), [[old]])
        for url in ["javascript:alert(1)", "http://example.com/clip", "https://user:pass@example.com/video"]:
            with self.assertRaises(HTTPError):
                self.call("demo_control", ["attach_recording", json.dumps({"incidentId": str(old), "url": url})])
        self.call("demo_control", ["attach_recording", json.dumps({"incidentId": str(old), "url": ""})])
        self.assertEqual(len(self.rows("SELECT id FROM event WHERE kind = 'session_recording'")), 2)
        self.assertEqual(self.rows("SELECT id FROM vitals"), [], "playback references cannot invent vitals")

    def test_video_import_is_idempotent_and_cannot_redirect_live_care_or_reports(self):
        self.call("start_bodycam_session", ["bodycam-test", "still-live", "Test Unit"])
        active = self.rows("SELECT id FROM incident")[0][0]
        data = json.dumps({"url": "/recordings/patient-01.mp4", "label": "Recorded patient 01"})
        self.call("demo_control", ["import_recording", data])
        self.call("demo_control", ["import_recording", data])
        self.assertEqual(len(self.rows("SELECT id FROM incident")), 2)

        self.assertEqual(self.rows("SELECT status FROM incident WHERE unit = 'Recorded session'"), [["closed"]])
        self.assertEqual(self.rows("SELECT incident_id FROM patient_record"), [])
        self.call("push_vitals", ["relay-test", json.dumps({"hr": 75, "status": "pulse", "simulated": True})])
        self.assertEqual(self.rows("SELECT incident_id FROM vitals"), [[active]])
        self.call("request_report", [])
        self.assertEqual(self.rows("SELECT incident_id FROM report"), [[active]])
        for url in ["/recordings/../secret.mp4", "//example.com/a.mp4", "/recordings/%2e%2e/a.mp4"]:
            with self.assertRaises(HTTPError):
                self.call("demo_control", ["import_recording", json.dumps({"url": url})])
        self.assertEqual(len(self.rows("SELECT id FROM incident")), 2)

    def test_recording_source_label_cannot_be_used_for_a_real_call(self):
        with self.assertRaises(HTTPError):
            self.call("demo_control", ["start", "Recorded session"])
        self.assertEqual(self.rows("SELECT id FROM incident"), [])


if __name__ == "__main__":
    unittest.main()
