import os
import random
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("TARGET_BASE_URL", "http://localhost:3000")
REPORT_DIR = "agentic_explorer/reports"
TRACES_DIR = "agentic_explorer/traces"

os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(TRACES_DIR, exist_ok=True)

def run_chaos_monkey():
    print("🐵 Démarrage du Chaos Monkey...")
    report = ["# Rapport du Chaos Monkey 🐵\n"]
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir=TRACES_DIR)
        page = context.new_page()
        
        crashes = []
        page.on("pageerror", lambda err: crashes.append(f"Erreur JS Console: {err}"))
        page.on("response", lambda resp: crashes.append(f"Erreur HTTP: {resp.status} - {resp.url}") if resp.status >= 500 else None)
        
        try:
            print(f"Navigation vers {BASE_URL}/login")
            page.goto(f"{BASE_URL}/login")
            
            # Login initial pour accéder à l'app
            page.fill("input[name='email']", "qa-admin-a@example.com")
            page.fill("input[name='password']", "Test@1234!")
            page.click("button[type='submit']")
            page.wait_for_timeout(2000)
            
            # Fuzzing aléatoire sur 25 étapes
            for step in range(1, 26):
                print(f"Étape de fuzzing {step}/25...")
                try:
                    page.wait_for_load_state("networkidle", timeout=2000)
                except:
                    pass # Ignore timeout si la page charge en continu
                
                clickable_elements = page.locator("a, button").all()
                inputs = page.locator("input[type='text'], input[type='number'], textarea").all()
                
                action_choice = random.choice(["click", "type", "scroll"])
                
                try:
                    if action_choice == "click" and clickable_elements:
                        target = random.choice(clickable_elements)
                        if target.is_visible():
                            target.click(timeout=500)
                    elif action_choice == "type" and inputs:
                        target = random.choice(inputs)
                        if target.is_visible() and target.is_editable():
                            target.fill("Chaos Text " + str(random.randint(0,100)), timeout=500)
                    else:
                        page.mouse.wheel(0, random.randint(-800, 800))
                except Exception:
                    # Ignore les erreurs d'interaction (élément disparu, non cliquable, etc.)
                    pass
                
                page.wait_for_timeout(500)
            
            print("🐒 Exploration terminée, capture d'écran...")
            page.screenshot(path=os.path.join(TRACES_DIR, "chaos_end.png"))
            
        except Exception as e:
            crashes.append(f"Crash fatal du test: {str(e)}")
            
        context.close()
        browser.close()
        
        report.append(f"**Nombre d'étapes de fuzzing aléatoire exécutées** : 25")
        report.append(f"**Anomalies critiques détectées (Crash UI / Serveur 500)** : {len(crashes)}\n")
        if crashes:
            report.append("### Détails des erreurs :")
            for c in crashes:
                report.append(f"- {c}")
        else:
            report.append("> ✅ L'application a survécu au Chaos Monkey ! Aucun crash JavaScript ou HTTP 500 n'a été provoqué par ce comportement chaotique.")
            
        with open(os.path.join(REPORT_DIR, "chaos_report.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(report))
            
        print("✅ Rapport Chaos Monkey généré dans agentic_explorer/reports/chaos_report.md")

if __name__ == "__main__":
    run_chaos_monkey()
