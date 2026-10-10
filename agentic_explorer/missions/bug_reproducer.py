import os
import json
import time
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("TARGET_BASE_URL", "http://localhost:3000")
REPORT_DIR = "agentic_explorer/reports"
TRACES_DIR = "agentic_explorer/traces"

os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(TRACES_DIR, exist_ok=True)

BUG_SCENARIOS = {
    "BUG-AUTH-005": {
        "title": "Absence de redirection sécurisée sur accès hors-session",
        "steps": [
            {"action": "navigate", "url": f"{BASE_URL}/"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_url", "expected": f"{BASE_URL}/login"}
        ]
    },
    "BUG-SEC-004": {
        "title": "Accès URL forcée (Settings) pour un collaborateur",
        "steps": [
            {"action": "navigate", "url": f"{BASE_URL}/login"},
            {"action": "fill", "target": "input[name='email']", "value": "qa-collab-a@example.com"},
            {"action": "fill", "target": "input[name='password']", "value": "Test@1234!"},
            {"action": "click", "target": "button[type='submit']"},
            {"action": "wait", "timeout": 2000},
            {"action": "navigate", "url": f"{BASE_URL}/settings"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_visible", "target": "text='Unauthorized'"}
        ]
    }
}

def execute_bug_reproduction():
    report = ["# Rapport d'Anomalie (Reproduction Minimale) - Sprint 9\n"]
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        for bug_id, scenario in BUG_SCENARIOS.items():
            print(f"Reproduction du bug {bug_id}...")
            context = browser.new_context(record_video_dir=TRACES_DIR)
            page = context.new_page()
            
            http_logs = []
            page.on("response", lambda response: http_logs.append(f"{response.request.method} {response.url} - {response.status}"))
            
            status = "REPRODUCED"
            error_msg = ""
            
            try:
                for step in scenario["steps"]:
                    if step["action"] == "navigate":
                        page.goto(step["url"])
                    elif step["action"] == "click":
                        page.locator(step["target"]).first.click(timeout=3000)
                    elif step["action"] == "fill":
                        page.locator(step["target"]).first.fill(step["value"], timeout=3000)
                    elif step["action"] == "wait":
                        page.wait_for_timeout(step["timeout"])
                    elif step["action"] == "assert_visible":
                        page.locator(step["target"]).first.wait_for(state="visible", timeout=3000)
                    elif step["action"] == "assert_url":
                        current_base = page.url.split('?')[0].rstrip('/')
                        expected_base = step["expected"].rstrip('/')
                        if current_base != expected_base:
                            raise Exception(f"URL mismatch: Expected {expected_base} but got {current_base}")
                            
            except Exception as e:
                status = "REPRODUCED (Assertion failed as expected / Issue present)"
                error_msg = str(e)
            else:
                status = "NOT REPRODUCED (Behavior is now correct)"
                
            screenshot_path = os.path.join(TRACES_DIR, f"{bug_id}_proof.png")
            page.screenshot(path=screenshot_path)
            
            context.close()
            
            report.append(f"## {bug_id}: {scenario['title']}")
            report.append(f"**Status**: `{status}`")
            if error_msg:
                report.append(f"**Détail**: {error_msg}")
            report.append("**HTTP Logs de reproduction**:")
            report.append("```")
            for log in http_logs[-10:]: # Keep last 10 relevant logs
                report.append(log)
            report.append("```")
            report.append(f"**Preuve visuelle**: `traces/{bug_id}_proof.png`\n")
        
        browser.close()
        
    with open(os.path.join(REPORT_DIR, "bug_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
        
    print("✅ Rapport final généré dans agentic_explorer/reports/bug_report.md")

if __name__ == "__main__":
    execute_bug_reproduction()
