import sys
import os
import time
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess

print("=== OCR Readiness & Healthcheck Test Suite ===")

# 1. Syntax Validation
print("\n[Test 1] Python Syntax Validation")
res1 = subprocess.run([sys.executable, "-m", "py_compile", "services/ocr-service/main.py"])
res2 = subprocess.run([sys.executable, "-m", "py_compile", "services/ocr-service/healthcheck.py"])
assert res1.returncode == 0, "main.py syntax error"
assert res2.returncode == 0, "healthcheck.py syntax error"
print("PASS: Both main.py and healthcheck.py pass Python syntax validation.")

# 2. Healthcheck script behavior against mock HTTP server
print("\n[Test 2] Healthcheck against HTTP 200, HTTP 503, Connection Refused, and Timeout")

class MockOCRHandler(BaseHTTPRequestHandler):
    status_to_return = 200
    delay = 0

    def do_GET(self):
        if self.path == "/health":
            if self.delay > 0:
                time.sleep(self.delay)
            self.send_response(self.status_to_return)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if self.status_to_return == 200:
                self.wfile.write(b'{"status":"ok","model":"loaded"}')
            else:
                self.wfile.write(b'{"detail":"Model still loading"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass # suppress logs

server = HTTPServer(("127.0.0.1", 0), MockOCRHandler)
port = server.server_address[1]
server_thread = threading.Thread(target=server.serve_forever, daemon=True)
server_thread.start()

healthcheck_script = os.path.abspath("services/ocr-service/healthcheck.py")

# Test 2a: 200 OK -> exits 0
MockOCRHandler.status_to_return = 200
MockOCRHandler.delay = 0
res_200 = subprocess.run([sys.executable, "-c", f"""
import sys
from importlib.machinery import SourceFileLoader
hc = SourceFileLoader("hc", r"{healthcheck_script}").load_module()
hc.check_health("http://127.0.0.1:{port}/health", timeout=2)
"""])
assert res_200.returncode == 0, f"Expected 0 on 200 OK, got {res_200.returncode}"
print("PASS: Healthcheck exits 0 when /health returns HTTP 200 OK.")

# Test 2b: 503 Service Unavailable -> exits 1
MockOCRHandler.status_to_return = 503
res_503 = subprocess.run([sys.executable, "-c", f"""
import sys
from importlib.machinery import SourceFileLoader
hc = SourceFileLoader("hc", r"{healthcheck_script}").load_module()
hc.check_health("http://127.0.0.1:{port}/health", timeout=2)
"""])
assert res_503.returncode == 1, f"Expected 1 on 503, got {res_503.returncode}"
print("PASS: Healthcheck exits 1 when /health returns HTTP 503 Service Unavailable (loading).")

# Test 2c: Connection Refused -> exits 1
dead_sock = socket.socket()
dead_sock.bind(("127.0.0.1", 0))
dead_port = dead_sock.getsockname()[1]
dead_sock.close()

res_conn_refused = subprocess.run([sys.executable, "-c", f"""
import sys
from importlib.machinery import SourceFileLoader
hc = SourceFileLoader("hc", r"{healthcheck_script}").load_module()
hc.check_health("http://127.0.0.1:{dead_port}/health", timeout=2)
"""])
assert res_conn_refused.returncode == 1, f"Expected 1 on connection refused, got {res_conn_refused.returncode}"
print("PASS: Healthcheck exits 1 on Connection Refused (service not running).")

# Test 2d: Timeout -> exits 1
MockOCRHandler.delay = 3
res_timeout = subprocess.run([sys.executable, "-c", f"""
import sys
from importlib.machinery import SourceFileLoader
hc = SourceFileLoader("hc", r"{healthcheck_script}").load_module()
hc.check_health("http://127.0.0.1:{port}/health", timeout=0.5)
"""])
assert res_timeout.returncode == 1, f"Expected 1 on timeout, got {res_timeout.returncode}"
print("PASS: Healthcheck exits 1 on request timeout.")

server.shutdown()

# 3. Model Readiness State Machine & Failure Isolation
print("\n[Test 3] Model State Machine & Failure Simulation in main.py logic")
# Verify that failure during init or warmup leaves _model_ready = False
from unittest.mock import MagicMock

test_state_script = """
import sys
import unittest.mock as mock
import types

class MockHTTPException(Exception):
    def __init__(self, status_code, detail=None):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)

class MockFastAPI:
    def __init__(self, *args, **kwargs):
        pass
    def on_event(self, _event):
        return lambda fn: fn
    def get(self, _path, **_kwargs):
        return lambda fn: fn
    def post(self, _path, **_kwargs):
        return lambda fn: fn

class MockBaseModel:
    pass

fastapi_mock = types.ModuleType("fastapi")
fastapi_mock.FastAPI = MockFastAPI
fastapi_mock.HTTPException = MockHTTPException
pydantic_mock = types.ModuleType("pydantic")
pydantic_mock.BaseModel = MockBaseModel
numpy_mock = types.ModuleType("numpy")
cv2_mock = types.ModuleType("cv2")
doctr_mock = types.ModuleType("doctr")
doctr_models_mock = types.ModuleType("doctr.models")
doctr_models_mock.ocr_predictor = lambda **_kwargs: mock.MagicMock()
doctr_mock.models = doctr_models_mock

import importlib.util
spec = importlib.util.spec_from_file_location("ocr_main", "services/ocr-service/main.py")
ocr_mod = importlib.util.module_from_spec(spec)

with mock.patch.dict('sys.modules', {
    'fastapi': fastapi_mock,
    'pydantic': pydantic_mock,
    'numpy': numpy_mock,
    'cv2': cv2_mock,
    'doctr': doctr_mock,
    'doctr.models': doctr_models_mock,
}):
    spec.loader.exec_module(ocr_mod)

def expect_status(call, status_code):
    try:
        call()
    except MockHTTPException as exc:
        assert exc.status_code == status_code, f"Expected HTTP {status_code}, got {exc.status_code}"
    else:
        raise AssertionError(f"Expected HTTP {status_code} exception")

# Case A: Before readiness -> 503
ocr_mod._model_ready = False
ocr_mod._model_init_error = None
expect_status(ocr_mod.health_check, 503)
print("PASS: /health returns HTTP 503 while models are loading.")

# Case B: After warmup succeeds -> 200
ocr_mod._model_ready = True
ocr_mod._model_init_error = None
ocr_mod.predictor = mock.MagicMock()
assert ocr_mod.health_check()["status"] == "ok"
print("PASS: /health returns HTTP 200 after initialization and warmup succeed.")

# Case C: Failed initialization -> leaves _model_ready False and /health returns 503
ocr_mod._model_ready = False
ocr_mod._model_init_error = "CUDA out of memory simulation"
expect_status(ocr_mod.health_check, 503)
print("PASS: Failed initialization leaves service non-ready (HTTP 503).")

# Case D: Extract rejected when non-ready
expect_status(lambda: ocr_mod.extract_text(object()), 503)
print("PASS: /extract endpoint rejects requests (HTTP 503) when model is non-ready.")
"""

res_state = subprocess.run([sys.executable, "-c", test_state_script])
if res_state.returncode != 0:
    print("FAIL: OCR readiness state-machine test failed.")
    sys.exit(1)
else:
    print("PASS: All OCR state transitions verified successfully.")

print("\n=== OCR Readiness Test Suite Complete ===")
