import os
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

ENTRIES_URL = f"{BASE_URL}/entries"

SCENARIOS = {
    "COMPTA-001": {
        "name": "Créer une écriture équilibrée",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "100"},
            {"action": "fill", "target": "input[name='credit']", "value": "100"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Succès'"}
        ]
    },
    "COMPTA-002": {
        "name": "Valider une écriture brouillon",
        "actions": login_actions("qa-manager-a@example.com") + [
            {"action": "navigate", "url": ENTRIES_URL},
            {"action": "click", "target": "button:has-text('Valider')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Validé'"}
        ]
    },
    "COMPTA-003": {
        "name": "Modifier une écriture validée (Doit échouer)",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/1/edit"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_text", "target": "body", "value": "Lecture seule"}
        ]
    },
    "COMPTA-004": {
        "name": "Tenter de supprimer une écriture validée",
        "actions": login_actions("qa-manager-a@example.com") + [
            {"action": "navigate", "url": ENTRIES_URL},
            {"action": "click", "target": "button.delete-validated"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Impossible de supprimer'"}
        ]
    },
    "COMPTA-005": {
        "name": "Tester une écriture non équilibrée",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "100"},
            {"action": "fill", "target": "input[name='credit']", "value": "50"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='déséquilibrée'"}
        ]
    },
    "COMPTA-006": {
        "name": "Tester un montant nul",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "0"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='supérieur à zéro'"}
        ]
    },
    "COMPTA-007": {
        "name": "Tester un montant négatif",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "-100"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='négatif'"}
        ]
    },
    "COMPTA-008": {
        "name": "Tester une écriture sur un compte inexistant",
        "actions": login_actions("qa-collab-a@example.com") + [
            {"action": "navigate", "url": f"{ENTRIES_URL}/new"},
            {"action": "fill", "target": "input[name='account']", "value": "999999"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='inexistant'"}
        ]
    }
}

def execute_scenarios():
    report = ["# Rapport d'Exploration - Sprint 7 (Intégrité Comptable)\n"]
    
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
        
    with open(os.path.join(REPORT_DIR, "compta_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
        
    print("✅ Rapports générés dans agentic_explorer/reports/compta_report.md")

if __name__ == "__main__":
    execute_scenarios()
