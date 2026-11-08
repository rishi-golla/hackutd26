import unittest
from unittest.mock import patch

import hub_bridge as bridge


class CameraSessionTest(unittest.TestCase):
    def setUp(self):
        bridge.latest.clear()

    def test_old_replay_and_button_alone_cannot_create_patient(self):
        self.assertTrue(bridge.accept_camera_message(
            {"what": "camera", "value": "live", "session": "old", "replay": True}, 100))
        self.assertFalse(bridge.accept_camera_message({"what": "bodycam", "value": "on"}, 100))
        self.assertNotIn("camera_session", bridge.latest)

    def test_failed_registration_retries_and_blocks_forwarding_then_deduplicates(self):
        bridge.accept_camera_message({"what": "camera", "value": "live", "session": "new"}, 100)
        with patch.object(bridge.time, "monotonic", return_value=101), patch.object(bridge, "call", side_effect=[False, True]) as call:
            self.assertEqual(bridge.register_camera_session(None), (None, True))
            self.assertEqual(bridge.register_camera_session(None), ("new", False))
            self.assertEqual(bridge.register_camera_session("new"), ("new", False))
            self.assertEqual(call.call_count, 2)
            call.assert_called_with("start_bodycam_session", [bridge.BODYCAM_DEVICE, "new", bridge.UNIT])

    def test_stale_camera_never_starts_patient(self):
        bridge.accept_camera_message({"what": "camera", "value": "live", "session": "stale"}, 100)
        with patch.object(bridge.time, "monotonic", return_value=110), patch.object(bridge, "call") as call:
            self.assertEqual(bridge.register_camera_session(None), (None, False))
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
