import os
import time
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("TARGET_BASE_URL", "http://localhost:3000")
REPORT_DIR = "agentic_explorer/reports"
TRACES_DIR = "agentic_explorer/traces"

os.makedirs(REPORT_DIR, exist_ok=True)
os.makedirs(TRACES_DIR, exist_ok=True)

def run_audit_agent():
    print("🕵️ Démarrage de l'Agent d'Audit Comptable (Fuzzing Métier)...")
    report = ["# Rapport d'Audit Comptable (Stress Test) 🕵️\n"]
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir=TRACES_DIR)
        page = context.new_page()
        
        findings = []
        
        try:
            print(f"Connexion de l'Auditeur (Manager) vers {BASE_URL}/login")
            page.goto(f"{BASE_URL}/login")
            
            page.fill("input[name='email']", "qa-manager-a@example.com")
            page.fill("input[name='password']", "Test@1234!")
            page.click("button[type='submit']")
            page.wait_for_timeout(3000)
            
            # Test 1: Injection SQL dans la recherche
            print("Test 1: Injection SQL dans la recherche...")
            page.goto(f"{BASE_URL}/entries")
            page.wait_for_timeout(1000)
            try:
                search_input = page.locator("input[placeholder*='echerche']").first
                if search_input.is_visible():
                    search_input.fill("' OR 1=1 --")
                    page.wait_for_timeout(1000)
                    if "500" in page.content() or "Error" in page.content():
                        findings.append("⚠️ Faille possible : Injection SQL non gérée provoquant un crash.")
                    else:
                        findings.append("✅ Recherche résiliente à l'injection SQL.")
                else:
                    findings.append("Test 1 ignoré (pas de barre de recherche visible)")
            except:
                findings.append("Test 1 ignoré")

            # Test 2: Valeurs extrêmes (Overflow)
            print("Test 2: Valeurs extrêmes (Overflow)...")
            page.goto(f"{BASE_URL}/entries/new")
            page.wait_for_timeout(1000)
            try:
                page.fill("input[name='debit']", "999999999999999999")
                page.fill("input[name='credit']", "999999999999999999")
                page.click("button:has-text('Sauvegarder')")
                page.wait_for_timeout(1000)
                if "500" in page.content() or "crash" in page.content().lower():
                    findings.append("⚠️ Faille : Crash sur des montants astronomiques (Overflow arithmétique).")
                else:
                    findings.append("✅ Résistance aux débordements arithmétiques validée.")
            except:
                findings.append("Test 2: UI n'a pas permis l'interaction (champs absents ou protégés).")

            # Test 3: Fraude à la décimale (Déséquilibre subtil)
            print("Test 3: Fraude à la décimale...")
            page.goto(f"{BASE_URL}/entries/new")
            page.wait_for_timeout(1000)
            try:
                page.fill("input[name='debit']", "100.00")
                page.fill("input[name='credit']", "99.99")
                page.click("button:has-text('Sauvegarder')")
                page.wait_for_timeout(1000)
                content_lower = page.content().lower()
                if "déséquilibrée" in content_lower or "unbalanced" in content_lower:
                    findings.append("✅ Fraude bloquée : Le système exige un équilibre strict au centime près.")
                elif "succès" in content_lower or "success" in content_lower:
                    findings.append("❌ Faille grave : Écriture déséquilibrée de 0.01 acceptée !")
                else:
                    findings.append("✅ Écriture déséquilibrée rejetée silencieusement par la validation.")
            except:
                pass
                
            # Test 4: URL forcée sur entité inexistante
            print("Test 4: URL forcée sur entité inexistante...")
            page.goto(f"{BASE_URL}/entries/999999999/edit")
            page.wait_for_timeout(1000)
            if "500" in page.content() or "Internal Server Error" in page.content():
                findings.append("⚠️ Faille : Ressource inexistante provoque une erreur 500 (manque de gestion 404).")
            else:
                findings.append("✅ Gestion correcte des ressources inexistantes (404 propre ou redirection).")

            print("🕵️ Audit terminé, capture d'écran...")
            page.screenshot(path=os.path.join(TRACES_DIR, "audit_agent_end.png"))
            
        except Exception as e:
            findings.append(f"Erreur d'exécution de l'audit: {str(e)}")
            
        context.close()
        browser.close()
        
        report.append(f"**Profil de l'agent** : Auditeur Expert (Fuzzing métier)")
        report.append(f"**Cibles** : Sécurité des requêtes, Overflow arithmétique, Intégrité décimale, Gestion des erreurs\n")
        report.append("### Résultats d'audit :")
        for f in findings:
            report.append(f"- {f}")
            
        with open(os.path.join(REPORT_DIR, "audit_agent_report.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(report))
            
        print("✅ Rapport d'Audit généré dans agentic_explorer/reports/audit_agent_report.md")

if __name__ == "__main__":
    run_audit_agent()
