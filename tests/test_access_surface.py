from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend_core.access.settings import local_bind_host, local_bind_scheme
from hub_backend.runtime import HubRuntime
from hub_backend.server_helpers import format_session_chat_url, resolve_external_origin
from hub_backend.session_query import host_without_port


class PwaBindTests(unittest.TestCase):
    def test_pwa_off_is_http_loopback(self) -> None:
        with patch("backend_core.access.settings.pwa_https_enabled", return_value=False):
            self.assertEqual(local_bind_host(), "127.0.0.1")
            self.assertEqual(local_bind_scheme(), "http")

    def test_pwa_on_is_https_lan_and_does_not_fall_back_to_http(self) -> None:
        with patch("backend_core.access.settings.pwa_https_enabled", return_value=True):
            self.assertEqual(local_bind_host(), "0.0.0.0")
            with self.assertRaises(SystemExit):
                local_bind_scheme()
            with tempfile.TemporaryDirectory() as tmp:
                cert = Path(tmp) / "cert.pem"
                key = Path(tmp) / "key.pem"
                cert.write_text("cert\n", encoding="utf-8")
                key.write_text("key\n", encoding="utf-8")
                self.assertEqual(local_bind_scheme(cert_file=str(cert), key_file=str(key)), "https")


class SessionChatUrlTests(unittest.TestCase):
    def test_only_the_public_hostname_is_public(self) -> None:
        origin_kw = {
            "host_without_port_fn": host_without_port,
            "public_host": "hub.example.com",
            "public_hub_port": 443,
            "hub_port": 8788,
            "scheme": "https",
        }
        lan = resolve_external_origin("192.168.0.10:8788", 8761, **origin_kw)
        tailscale = resolve_external_origin("100.64.0.10:8788", 8761, **origin_kw)
        public = resolve_external_origin("hub.example.com", 8761, **origin_kw)
        self.assertFalse(lan["is_public"])
        self.assertFalse(tailscale["is_public"])
        self.assertTrue(public["is_public"])

    def test_lan_or_tailscale_stays_port_direct(self) -> None:
        url = format_session_chat_url(
            "192.168.3.13:8788",
            "Agent-Window",
            8761,
            "/?follow=1",
            resolve_external_origin_fn=lambda _header, _port: {
                "origin": "https://192.168.3.13:8788",
                "is_public": False,
            },
            format_external_url_fn=lambda _header, port, path: f"https://192.168.3.13:{port}{path}",
            url_quote_fn=lambda name: name,
        )
        self.assertEqual(url, "https://192.168.3.13:8761/?follow=1")
        self.assertNotIn("/session/", url)

    def test_cloudflare_hostname_uses_session_prefix(self) -> None:
        url = format_session_chat_url(
            "hub.example.com",
            "Agent-Window",
            8761,
            "/?follow=1",
            resolve_external_origin_fn=lambda _header, _port: {
                "origin": "https://hub.example.com",
                "is_public": True,
            },
            format_external_url_fn=lambda *_args: self.fail("public chat must not use the port-direct URL"),
            url_quote_fn=lambda name: name,
        )
        self.assertEqual(url, "https://hub.example.com/session/Agent-Window/?follow=1")


class HubRuntimeSchemeTests(unittest.TestCase):
    def test_scheme_follows_pwa_without_hub_main(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "agent-index"
            script.write_text("", encoding="utf-8")
            with patch("hub_backend.runtime.pwa_https_enabled", return_value=False):
                self.assertEqual(HubRuntime(root, script).hub_scheme, "http")
            with patch("hub_backend.runtime.pwa_https_enabled", return_value=True):
                self.assertEqual(HubRuntime(root, script).hub_scheme, "https")


if __name__ == "__main__":
    unittest.main()
