import os
import json
import time
from playwright.sync_api import sync_playwright
from agentic_explorer.browser_validator import validate_action

BASE_URL = os.environ.get("TARGET_BASE_URL", "http://localhost:3000")
REPORT_DIR = "agentic_explorer/reports"
TRACES_DIR = "agentic_explorer/traces"

os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(TRACES_DIR, exist_ok=True)

# Scénarios de tests définis sous forme d'intentions LLM
SCENARIOS = {
    "AUTH-001": {
        "name": "Connexion avec compte validé",
        "actions": [
            {"action": "navigate", "url": f"{BASE_URL}/login"},
            {"action": "fill", "target": "input[name='email']", "value": "qa-admin-a@example.com"},
            {"action": "fill", "target": "input[name='password']", "value": "Test@1234!"},
            {"action": "click", "target": "button[type='submit']"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_url", "url": f"{BASE_URL}/"}
        ]
    },
    "AUTH-002": {
        "name": "Connexion avec mot de passe invalide",
        "actions": [
            {"action": "navigate", "url": f"{BASE_URL}/login"},
            {"action": "fill", "target": "input[name='email']", "value": "qa-admin-a@example.com"},
            {"action": "fill", "target": "input[name='password']", "value": "WrongPassword!"},
            {"action": "click", "target": "button[type='submit']"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_visible", "target": "text='Invalid credentials'"}
        ]
    },
    "AUTH-003": {
        "name": "Connexion avec compte absent",
        "actions": [
            {"action": "navigate", "url": f"{BASE_URL}/login"},
            {"action": "fill", "target": "input[name='email']", "value": "nobody@example.com"},
            {"action": "fill", "target": "input[name='password']", "value": "Test@1234!"},
            {"action": "click", "target": "button[type='submit']"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_visible", "target": "text='Invalid credentials'"}
        ]
    },
    "AUTH-004": {
        "name": "Accès après déconnexion",
        "actions": [
            {"action": "navigate", "url": f"{BASE_URL}/login"},
            {"action": "fill", "target": "input[name='email']", "value": "qa-admin-a@example.com"},
            {"action": "fill", "target": "input[name='password']", "value": "Test@1234!"},
            {"action": "click", "target": "button[type='submit']"},
            {"action": "wait", "timeout": 2000},
            {"action": "click", "target": "button:has-text('Logout')"},
            {"action": "wait", "timeout": 1000},
            {"action": "navigate", "url": f"{BASE_URL}/"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_url", "url": f"{BASE_URL}/login"}
        ]
    },
    "AUTH-005": {
        "name": "Accès page protégée sans session",
        "actions": [
            {"action": "navigate", "url": f"{BASE_URL}/dashboard"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_url", "url": f"{BASE_URL}/auth/login"}
        ]
    }
}

def execute_scenarios():
    report = ["# Rapport d'Exploration - Sprint 5 (AUTH)\n"]
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        for mission_id, scenario in SCENARIOS.items():
            print(f"Exécution de la mission {mission_id}...")
            context = browser.new_context(record_video_dir=TRACES_DIR)
            context.tracing.start(screenshots=True, snapshots=True, sources=True)
            page = context.new_page()
            
            status = "PASS"
            error_msg = ""
            
            start_time = time.time()
            try:
                for step_idx, action_dict in enumerate(scenario["actions"]):
                    # Validation déterministe via le validator (Sprint 4)
                    action = validate_action(action_dict, step_idx, int((time.time() - start_time) * 1000))
                    
                    if action.action == "navigate":
                        page.goto(action.url)
                    elif action.action == "click":
                        page.locator(action.target).first.click()
                    elif action.action == "fill":
                        page.locator(action.target).first.fill(action.value)
                    elif action.action == "wait":
                        page.wait_for_timeout(action.timeout or 1000)
                    elif action.action == "assert_visible":
                        # We use a short timeout for tests since this is a basic assert
                        # if not visible, it throws an error which is caught as FAIL
                        page.locator(action.target).first.wait_for(state="visible", timeout=3000)
                    elif action.action == "assert_url":
                        current_base = page.url.split('?')[0].rstrip('/')
                        expected_base = action.url.rstrip('/')
                        if current_base != expected_base:
                            raise Exception(f"URL mismatch: Expected {expected_base} but got {current_base}")
                            
            except ValueError as ve:
                status = "BLOCKED" # Blocage par le validator
                error_msg = str(ve)
            except Exception as e:
                status = "FAIL"
                error_msg = str(e)
            
            # Save screenshot on failure
            if status != "PASS":
                screenshot_path = os.path.join(TRACES_DIR, f"{mission_id}_error.png")
                page.screenshot(path=screenshot_path)
            
            context.tracing.stop(path=os.path.join(TRACES_DIR, f"{mission_id}_trace.zip"))
            context.close()
            
            report.append(f"## {mission_id}: {scenario['name']}")
            report.append(f"**Status**: `{status}`")
            if error_msg:
                report.append(f"**Error**: {error_msg}")
            report.append("")
        
        browser.close()
        
    with open(os.path.join(REPORT_DIR, "auth_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
        
    print("✅ Rapports générés dans agentic_explorer/reports/auth_report.md")

if __name__ == "__main__":
    execute_scenarios()
