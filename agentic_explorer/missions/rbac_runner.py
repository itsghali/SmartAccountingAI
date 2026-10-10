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

def login_actions(email):
    return [
        {"action": "navigate", "url": f"{BASE_URL}/login"},
        {"action": "fill", "target": "input[name='email']", "value": email},
        {"action": "fill", "target": "input[name='password']", "value": "Test@1234!"},
        {"action": "click", "target": "button[type='submit']"},
        {"action": "wait", "timeout": 2000}
    ]

SCENARIOS = {
    "SEC-001": {
        "name": "Accès MANAGER (Entreprise A)",
        "actions": login_actions("qa-manager-a@example.com") + [
            {"action": "navigate", "url": f"{BASE_URL}/"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_url", "url": f"{BASE_URL}/"}
        ]
    },
    "SEC-002": {
        "name": "Accès COLLABORATOR (Entreprise A)",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{BASE_URL}/"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_url", "url": f"{BASE_URL}/"}
        ]
    },
    "SEC-003": {
        "name": "Escalade de privilèges UI (COLLABORATOR)",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{BASE_URL}/"},
            # Tentative de cliquer sur les paramètres (le lien ne devrait pas exister ou bloquer)
            {"action": "click", "target": "a[href='/settings']"},
            {"action": "wait", "timeout": 2000},
            # Le collaborateur ne devrait pas atterrir sur /settings
            {"action": "assert_url", "url": f"{BASE_URL}/"}
        ]
    },
    "SEC-004": {
        "name": "Escalade de privilèges URL (COLLABORATOR vers Settings)",
        "actions": login_actions("qa-collab-a@example.com") + [
            # Tentative d'accès forcé via l'URL
            {"action": "navigate", "url": f"{BASE_URL}/settings"},
            {"action": "wait", "timeout": 2000},
            # L'application doit rediriger ou afficher une page non autorisée, pas le contenu
            {"action": "assert_visible", "target": "text='Unauthorized'"}
        ]
    },
    "SEC-005": {
        "name": "Fuite de données / Isolation Tenant (Admin A vers B via API)",
        "actions": login_actions("qa-admin-a@example.com") + [
            {"action": "navigate", "url": f"{BASE_URL}/api/companies/qa-company-b"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_text", "target": "body", "value": "Forbidden"}
        ]
    },
    "SEC-006": {
        "name": "IDOR sur entités (Écritures de l'entreprise B par Collab A)",
        "actions": login_actions("qa-collab-a@example.com") + [
            # Accéder manuellement à la ressource d'une autre entreprise
            {"action": "navigate", "url": f"{BASE_URL}/api/journal-entries?companyId=qa-company-b"},
            {"action": "wait", "timeout": 2000},
            {"action": "assert_text", "target": "body", "value": "Forbidden"}
        ]
    }
}

def execute_scenarios():
    report = ["# Rapport d'Exploration - Sprint 6 (RBAC & SEC)\n"]
    
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
                    action = validate_action(action_dict, step_idx, int((time.time() - start_time) * 1000))
                    
                    if action.action == "navigate":
                        page.goto(action.url)
                    elif action.action == "click":
                        page.locator(action.target).first.click(timeout=3000)
                    elif action.action == "fill":
                        page.locator(action.target).first.fill(action.value, timeout=3000)
                    elif action.action == "wait":
                        page.wait_for_timeout(action.timeout or 1000)
                    elif action.action == "assert_visible":
                        page.locator(action.target).first.wait_for(state="visible", timeout=3000)
                    elif action.action == "assert_text":
                        content = page.locator(action.target).first.text_content(timeout=3000)
                        if action.value.lower() not in (content or "").lower():
                            raise Exception(f"Text mismatch: Expected '{action.value}' not found.")
                    elif action.action == "assert_url":
                        current_base = page.url.split('?')[0].rstrip('/')
                        expected_base = action.url.rstrip('/')
                        if current_base != expected_base:
                            raise Exception(f"URL mismatch: Expected {expected_base} but got {current_base}")
                            
            except ValueError as ve:
                status = "BLOCKED" 
                error_msg = str(ve)
            except Exception as e:
                status = "FAIL"
                error_msg = str(e)
            
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
        
    with open(os.path.join(REPORT_DIR, "rbac_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
        
    print("✅ Rapports générés dans agentic_explorer/reports/rbac_report.md")

if __name__ == "__main__":
    execute_scenarios()
