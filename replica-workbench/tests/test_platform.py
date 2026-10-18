import json
import tempfile
import unittest
from pathlib import Path

from replica_platform.case import add_evidence, create_case
from replica_platform.agent_protocol import handle_request, process_json, process_stream
from replica_platform.cli import _agent_output_ok
from replica_platform.preflight import inspect
from replica_platform.report import write_report
from replica_platform.scope import validate, validate_loopback_endpoint, validate_replay_page


class PlatformTests(unittest.TestCase):
    def test_case_evidence_and_report_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            case = create_case(root, "demo", str(target), "javascript", "v1", "owned fixture")
            case_data = json.loads((case / "case.json").read_text())
            self.assertEqual(case_data["authorization"]["status"], "pending")
            self.assertIsNone(case_data["authorization"]["expires_at"])
            evidence = add_evidence(case, "observation", "initial", {"ok": True})
            self.assertTrue(evidence.is_file())
            self.assertEqual(json.loads((case / "case.json").read_text())["evidence"]["count"], 1)

    def test_case_requires_explicit_authorization_expiry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            with self.assertRaisesRegex(ValueError, "expiry is required"):
                create_case(root, "missing-expiry", str(target), "javascript", "v1", "owned fixture", authorize=True)
            case = create_case(root, "authorized", str(target), "javascript", "v1", "owned fixture",
                               authorize=True, expires_at="2099-01-01T00:00:00Z")
            self.assertEqual(json.loads((case / "case.json").read_text())["authorization"]["status"], "granted")

    def test_scope_rejects_unlisted_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            allowed = root / "allowed"
            outside = root / "outside"
            allowed.mkdir(); outside.mkdir()
            scope = {"authorization": {"status": "granted", "basis": "owned", "expires_at": "2099-01-01T00:00:00Z"},
                     "actions": ["static"], "network": {"mode": "offline"}, "targets": {"paths": [str(allowed)]}}
            with self.assertRaises(ValueError): validate(scope, "static", str(outside))

    def test_replay_page_requires_exact_allowlisted_origin(self):
        scope = {"authorization": {"status": "granted", "basis": "owned", "expires_at": "2099-01-01T00:00:00Z"},
                 "actions": ["runtime"], "network": {"mode": "loopback"},
                 "targets": {"paths": [], "origins": ["http://127.0.0.1:8765"],
                             "cdp_endpoints": ["http://127.0.0.1:9222"]}}
        validate_replay_page(scope, "runtime", "http://127.0.0.1:8765/game", "http://127.0.0.1:9222")
        with self.assertRaisesRegex(ValueError, "exact allowlist"):
            validate_replay_page(scope, "runtime", "http://127.0.0.1:3000/private", "http://127.0.0.1:9222")
        with self.assertRaisesRegex(ValueError, "exact endpoint allowlist"):
            validate_loopback_endpoint(scope, "runtime", "http://127.0.0.1:1")
        with self.assertRaisesRegex(ValueError, "numeric loopback"):
            validate_loopback_endpoint(scope, "runtime", "http://localhost:9222")

    def test_preflight_has_core_ready(self):
        self.assertEqual(inspect()["capabilities"]["core"], "READY")

    def test_report_accepts_raw_adapter_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            case = create_case(root, "artifact", str(target), "web", "v1", "owned fixture")
            (case / "evidence" / "runtime.json").write_text('{"schema":"runtime"}\n', encoding="utf-8")
            report = write_report(case)
            text = report.read_text(encoding="utf-8")
            self.assertIn("Artifact: runtime.json", text)
            self.assertIn("No fresh verification run has been recorded.", text)

    def test_agent_protocol_capabilities_and_jsonl(self):
        response = handle_request({"schema": "replica-agent/v1", "request_id": "r1",
                                   "operation": "capabilities", "params": {}})
        self.assertTrue(response["ok"])
        self.assertIn("verify", response["result"]["operations"])
        lines = process_stream([
            '{"schema":"replica-agent/v1","request_id":"a","operation":"capabilities","params":{}}',
            '{"schema":"wrong","operation":"capabilities","params":{}}',
        ])
        self.assertEqual(len(lines), 2)
        self.assertTrue(json.loads(lines[0])["ok"])
        self.assertFalse(json.loads(lines[1])["ok"])

    def test_agent_cli_exit_status_parses_json_fields(self):
        self.assertTrue(_agent_output_ok('{"ok":true}'))
        self.assertFalse(_agent_output_ok('{"ok":false,"error":{"message":"literal \\"ok\\":true"}}'))
        self.assertFalse(_agent_output_ok('{"ok":true}\n{"ok":false}', jsonl=True))

    def test_agent_protocol_reuses_case_authorization(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            pending = create_case(root, "pending", str(target), "javascript", "v1", "owned fixture")
            result = handle_request({"schema": "replica-agent/v1", "operation": "analyze",
                                     "params": {"case": str(pending), "target": str(target)}}, root)
            self.assertFalse(result["ok"])
            self.assertIn("authorization", result["error"]["message"])

    def test_agent_protocol_cannot_self_grant_or_write_outside_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            self_grant = handle_request({
                "schema": "replica-agent/v1", "operation": "init",
                "params": {"name": "self-grant", "target": str(target), "type": "javascript",
                           "basis": "agent supplied", "authorize": True,
                           "authorization_expires_at": "2099-01-01T00:00:00Z"},
            }, root)
            self.assertFalse(self_grant["ok"])
            self.assertIn("cannot grant authorization", self_grant["error"]["message"])
            case = create_case(root, "scoped", str(target), "javascript", "v1", "owned fixture")
            outside = root / "outside-rebuild"
            rebuild = handle_request({
                "schema": "replica-agent/v1", "operation": "rebuild",
                "params": {"case": str(case), "output": str(outside)},
            }, root)
            self.assertFalse(rebuild["ok"])
            self.assertIn("inside the workbench work folder", rebuild["error"]["message"])
            self.assertFalse(outside.exists())

    def test_agent_evidence_rejects_symlinked_case_storage(self):
        for child in ("evidence", "case.json"):
            with self.subTest(child=child), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                target = root / "target"
                target.mkdir()
                case = create_case(root, "symlinked-storage", str(target), "javascript", "v1", "owned fixture")
                outside = root / "outside"
                outside.mkdir()
                if child == "evidence":
                    (case / child).rmdir()
                    link = case / child
                    link_target = outside
                    kwargs = {"target_is_directory": True}
                else:
                    link = case / child
                    link.unlink()
                    link_target = outside / "case.json"
                    link_target.write_text('{"outside":true}', encoding="utf-8")
                    kwargs = {}
                try:
                    link.symlink_to(link_target, **kwargs)
                except (OSError, NotImplementedError) as exc:
                    self.skipTest(f"symlink creation is unavailable: {exc}")

                response = handle_request({
                    "schema": "replica-agent/v1", "operation": "evidence.add",
                    "params": {"case": str(case), "kind": "observation", "title": "probe", "data": {"x": 1}},
                }, root)
                self.assertFalse(response["ok"])
                self.assertIn("symlinks or reparse points", response["error"]["message"])
                if child == "evidence":
                    self.assertEqual(list(outside.iterdir()), [])
                else:
                    self.assertEqual(link_target.read_text(encoding="utf-8"), '{"outside":true}')

    def test_agent_protocol_rejects_case_outside_work_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            outside = root / "case"
            outside.mkdir()
            (outside / "case.json").write_text("{}", encoding="utf-8")
            response = handle_request({"schema": "replica-agent/v1", "operation": "status",
                                       "params": {"case": str(outside)}}, root)
            self.assertFalse(response["ok"])
            self.assertIn("inside the workbench work folder", response["error"]["message"])

    def test_agent_protocol_status(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target"
            target.mkdir()
            case = create_case(root, "status", str(target), "javascript", "v1", "owned fixture")
            response = json.loads(process_json(json.dumps({
                "schema": "replica-agent/v1", "request_id": "status-1", "operation": "status",
                "params": {"case": str(case)},
            }), root))
            self.assertTrue(response["ok"])
            self.assertEqual(response["result"]["evidence_count"], 0)
            self.assertIsNone(response["result"]["latest_verification"])


if __name__ == "__main__":
    unittest.main()
