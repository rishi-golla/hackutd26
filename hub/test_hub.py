import os
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen

data = tempfile.TemporaryDirectory()
os.environ["HUB_DATA"] = data.name
import hub


class FrameSessionTest(unittest.TestCase):
    def test_new_phone_session_accepts_first_frame_and_rejects_late_frames_from_previous_session(self):
        server = hub.ThreadingHTTPServer(("127.0.0.1", 0), hub.H)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def frame(session, number):
                request = Request(f"http://127.0.0.1:{server.server_port}/frame?n={number}&session={session}",
                                  data=b"\xff\xd8test-frame", method="POST")
                with urlopen(request) as response:
                    self.assertEqual(response.status, 200)
            frame("first", 100)
            self.assertEqual(hub.latest["camera"]["session"], "first")
            frame("second", 1)
            self.assertEqual(hub.latest["camera"]["session"], "second")
            sequence = hub.frame["seq"]
            frame("first", 101)
            self.assertEqual(hub.frame["seq"], sequence)
            frame("second", 2)
            self.assertEqual(hub.frame["seq"], sequence + 1)
        finally:
            server.shutdown()
            server.server_close()


def tearDownModule():
    hub.LOG.close()
    data.cleanup()


if __name__ == "__main__":
    unittest.main()
