import asyncio
import unittest

from app import app


class CorsPreflightTests(unittest.TestCase):
    def test_export_preflight_does_not_require_trial_cookie(self) -> None:
        messages = []
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "OPTIONS",
            "scheme": "http",
            "path": "/api/projects/demo/exports",
            "raw_path": b"/api/projects/demo/exports",
            "query_string": b"",
            "root_path": "",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 50000),
            "headers": [
                (b"host", b"testserver"),
                (b"origin", b"http://localhost:3000"),
                (b"access-control-request-method", b"POST"),
                (b"access-control-request-headers", b"content-type"),
            ],
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        asyncio.run(app(scope, receive, send))
        response_start = next(message for message in messages if message["type"] == "http.response.start")
        headers = {key.decode(): value.decode() for key, value in response_start["headers"]}

        self.assertEqual(response_start["status"], 200)
        self.assertEqual(headers["access-control-allow-origin"], "http://localhost:3000")
        self.assertIn("POST", headers["access-control-allow-methods"])


if __name__ == "__main__":
    unittest.main()
