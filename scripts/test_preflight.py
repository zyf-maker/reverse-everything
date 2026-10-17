import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import preflight
import scope


class ReadinessTests(unittest.TestCase):
    def doctor(self):
        return {"identity": {"cli_package_version": "6.5.0", "skill": {"state": "aligned"},
                "registrations": [{"client": "cursor", "state": "aligned"},
                                  {"client": "codex", "state": "missing"}]},
                "providerInspections": [{"id": "ghidra", "available": True},
                                        {"id": "jadx", "available": False}],
                "scope_checks": [{"name": "hopper", "ok": False}]}

    def test_aligned_skill_is_present(self):
        self.assertEqual(preflight.parse_doctor(self.doctor(), "codex")["skill"], "ok")

    def test_other_client_registration_never_satisfies_codex(self):
        self.assertEqual(preflight.parse_doctor(self.doctor(), "codex")["registration"], "missing")

    def test_doctor_does_not_prove_active_session(self):
        self.assertEqual(preflight.parse_doctor(self.doctor(), "cursor")["active_session"], "unknown")

    def test_one_native_provider_does_not_enable_android(self):
        rea = preflight.parse_doctor(self.doctor(), "codex") | {"cli": "ok"}
        cap = preflight.capabilities(rea, "unknown", {"daemon": "ok", "services": "ok"})
        self.assertEqual(cap["binary"], "READY")
        self.assertEqual(cap["mobile"], "DEGRADED")

    def test_node_or_cli_without_cdp_cannot_prove_web(self):
        self.assertEqual(preflight.capabilities({"cli": "ok"}, "unknown", {})["web"], "DEGRADED")
        self.assertEqual(preflight.capabilities({}, "ok", {})["web"], "BLOCKED")

    def test_running_services_cannot_prove_pentest(self):
        self.assertEqual(preflight.capabilities({}, "unknown", {"daemon": "ok", "services": "ok"})["pentest"], "DEGRADED")

    def test_missing_jadx_remains_degraded(self):
        self.assertEqual(preflight.capabilities({"cli": "ok", "providers": {}}, "ok", {})["mobile"], "DEGRADED")

    def test_cdp_refuses_external_endpoint(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=AssertionError("must not request")):
            self.assertEqual(preflight.cdp_probe("http://example.com:9222", 1)[0], "blocked")

    def test_cdp_blocks_external_websocket(self):
        import io
        class Response:
            def __enter__(self):
                return io.StringIO(json.dumps({"webSocketDebuggerUrl":"ws://external.invalid/devtools"}))
            def __exit__(self,*args): pass
        class Opener:
            def open(self,*args,**kwargs): return Response()
        with patch("urllib.request.build_opener",return_value=Opener()):
            self.assertEqual(preflight.cdp_probe("http://127.0.0.1:9227",1)[0],"blocked")

    def test_cdp_requires_same_loopback_host(self):
        import io
        class Response:
            def __enter__(self):
                return io.StringIO(json.dumps({"webSocketDebuggerUrl":"ws://127.0.0.2:9227/devtools"}))
            def __exit__(self,*args): pass
        class Opener:
            def open(self,*args,**kwargs): return Response()
        with patch("urllib.request.build_opener",return_value=Opener()):
            self.assertEqual(preflight.cdp_probe("http://127.0.0.1:9227",1)[0],"blocked")

    def test_cdp_redirect_handler_refuses_external_location(self):
        captured={}
        class Opener:
            def open(self, request, timeout):
                handler=next(h for h in captured["handlers"]
                    if isinstance(h,preflight.urllib.request.HTTPRedirectHandler))
                captured["redirect"]=handler.redirect_request(request,None,302,"Found",{},
                    "http://external.invalid/json/version")
                raise RuntimeError("controlled redirect")
        def build_opener(*handlers):
            captured["handlers"]=handlers
            return Opener()
        with patch.object(preflight.urllib.request,"build_opener",side_effect=build_opener):
            result=preflight.cdp_probe("http://127.0.0.1:9227",1)
        self.assertIsNone(captured["redirect"])
        self.assertEqual(result[0],"blocked")

    def test_malformed_provider_false_cannot_enable_native(self):
        parsed=preflight.parse_doctor({"providerInspections":[{"id":"ghidra","available":"false"}]},"codex")|{"cli":"ok"}
        self.assertEqual(preflight.capabilities(parsed,"unknown",{})["binary"],"DEGRADED")

    def test_subprocess_timeout_is_bounded_failure(self):
        import subprocess
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("rea", 1)):
            self.assertEqual(preflight.run(["rea"], 1)[0], -1)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.file = self.root / "allowed.txt"
        self.file.write_text("owned fixture")
        self.scope = {"auth": {"status": "granted", "basis": "Explicit user instruction for owned fixtures",
                     "expires_at": "2099-01-01T00:00:00Z"}, "actions": ["static", "runtime", "network"],
                     "network": {"mode": "loopback"}, "targets": {"paths": [str(self.root)],
                     "origins": ["http://127.0.0.1:9000"]}}

    def tearDown(self):
        self.temp.cleanup()

    def test_granted_local_path(self):
        self.assertEqual(scope.validate(self.scope, "static", str(self.file))["status"], "granted")

    def test_pending_denied(self):
        self.scope["auth"]["status"] = "pending"
        with self.assertRaises(ValueError): scope.validate(self.scope, "static", str(self.file))

    def test_expired_denied(self):
        self.scope["auth"]["expires_at"] = "2000-01-01T00:00:00Z"
        with self.assertRaises(ValueError): scope.validate(self.scope, "static", str(self.file))

    def test_unlisted_action_denied(self):
        with self.assertRaises(ValueError): scope.validate(self.scope, "pentest", str(self.file))

    def test_sibling_directory_denied(self):
        with self.assertRaises(ValueError): scope.validate(self.scope, "static", str(self.root.parent))

    def test_exact_origin(self):
        self.assertEqual(scope.validate(self.scope, "network", "http://127.0.0.1:9000/game")["status"], "granted")
        with self.assertRaises(ValueError): scope.validate(self.scope, "network", "http://127.0.0.1:9001/game")
        self.scope["targets"]["origins"] = ["http://127.0.0.1:80"]
        scope.validate(self.scope,"network","http://127.0.0.1:80/")
        with self.assertRaises(ValueError): scope.validate(self.scope,"network","http://127.0.0.1:0/")

    def test_credentials_and_external_domains_denied(self):
        for url in ("http://user@127.0.0.1:9000", "http://example.com"):
            with self.assertRaises(ValueError): scope.validate(self.scope, "network", url)

    def test_offline_network_denied(self):
        self.scope["network"]["mode"] = "offline"
        with self.assertRaises(ValueError): scope.validate(self.scope, "network", "http://127.0.0.1:9000")

    def test_symbolic_link_escape_denied(self):
        with tempfile.TemporaryDirectory() as other:
            dest = Path(other) / "outside.txt"
            dest.write_text("outside")
            link = self.root / "link"
            try: link.symlink_to(dest)
            except OSError: self.skipTest("Symlink privilege unavailable")
            with self.assertRaises(ValueError): scope.validate(self.scope, "static", str(link))


if __name__ == "__main__":
    unittest.main(verbosity=2)
