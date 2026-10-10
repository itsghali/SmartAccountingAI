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

def logout_actions():
    return [
        {"action": "click", "target": "button:has-text('Logout')"},
        {"action": "wait", "timeout": 1000},
        {"action": "assert_url", "url": f"{BASE_URL}/login"}
    ]

SCENARIOS = {
    "E2E-001": {
        "name": "Parcours Administrateur Complet",
        "actions": login_actions("qa-admin-a@example.com") + [
            # Check company
            {"action": "navigate", "url": f"{BASE_URL}/settings/company"},
            {"action": "wait", "timeout": 1000},
            # Check fiscal year
            {"action": "navigate", "url": f"{BASE_URL}/settings/fiscal-years"},
            {"action": "wait", "timeout": 1000},
            # Create entry
            {"action": "navigate", "url": f"{BASE_URL}/entries/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "500"},
            {"action": "fill", "target": "input[name='credit']", "value": "500"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            # Validation
            {"action": "click", "target": "button:has-text('Valider')"},
            {"action": "wait", "timeout": 1000},
            # Reports
            {"action": "navigate", "url": f"{BASE_URL}/reports"},
            {"action": "wait", "timeout": 1000}
        ] + logout_actions()
    },
    "E2E-002": {
        "name": "Parcours Gestionnaire (Validation & Interdictions)",
        "actions": login_actions("qa-manager-a@example.com") + [
            # Création proposition
            {"action": "navigate", "url": f"{BASE_URL}/entries/new"},
            {"action": "fill", "target": "input[name='debit']", "value": "200"},
            {"action": "fill", "target": "input[name='credit']", "value": "200"},
            {"action": "click", "target": "button:has-text('Sauvegarder')"},
            {"action": "wait", "timeout": 1000},
            # Validation autorisée pour Manager
            {"action": "click", "target": "button:has-text('Valider')"},
            {"action": "wait", "timeout": 1000},
            # Action non autorisée (ex: settings)
            {"action": "navigate", "url": f"{BASE_URL}/settings"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Unauthorized'"}
        ]
    },
    "E2E-003": {
        "name": "Parcours Collaborateur (Accès restreints)",
        "actions": login_actions("qa-collab-a@example.com") + [
            # Navigation de base
            {"action": "navigate", "url": f"{BASE_URL}/entries"},
            {"action": "wait", "timeout": 1000},
            # Tenter d'accéder aux rapports de clôture (interdit potentiellement)
            {"action": "navigate", "url": f"{BASE_URL}/closing"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Unauthorized'"}
        ]
    },
    "E2E-004": {
        "name": "Test Navigation, États Vides et Messages Utilisateur",
        "actions": login_actions("qa-collab-a@example.com") + [
            # Recherche vide
            {"action": "navigate", "url": f"{BASE_URL}/entries?search=UNFINDABLE_QUERY_999"},
            {"action": "wait", "timeout": 1000},
            {"action": "assert_visible", "target": "text='Aucun résultat'"},
            # Navigation entre pages
            {"action": "navigate", "url": f"{BASE_URL}/journals"},
            {"action": "wait", "timeout": 1000},
            {"action": "navigate", "url": f"{BASE_URL}/reports"},
            {"action": "wait", "timeout": 1000}
        ]
    }
}

def execute_scenarios():
    report = ["# Rapport d'Exploration - Sprint 8 (Parcours E2E)\n"]
    
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
        
    with open(os.path.join(REPORT_DIR, "e2e_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
        
    print("✅ Rapports générés dans agentic_explorer/reports/e2e_report.md")

if __name__ == "__main__":
    execute_scenarios()
