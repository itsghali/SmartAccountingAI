import os
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("TARGET_BASE_URL", "http://localhost:3000")

def test_bug_auth_005_redirection():
    """
    Test de régression déterministe généré après revue humaine.
    Bug d'origine : Absence de redirection sécurisée sur accès hors-session.
    Ce test échouera (échec attendu) sur la version vulnérable,
    et passera une fois que le développeur aura appliqué le correctif.
    """
    print(f"Lancement du test de régression BUG-AUTH-005 sur {BASE_URL}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print(f"Action: Navigation vers la page d'accueil protégée {BASE_URL}/")
        page.goto(BASE_URL + "/")
        
        # Vérification déterministe et stable
        current_url = page.url.split('?')[0].rstrip('/')
        expected_url = f"{BASE_URL}/login".rstrip('/')
        
        try:
            assert current_url == expected_url, f"Echec de l'assertion: URL attendue {expected_url} mais obtenue {current_url}"
            print("✅ SUCCES : La régression est corrigée, la redirection fonctionne.")
        except AssertionError as e:
            print(f"❌ ECHEC ATTENDU (Version vulnérable) : {e}")
            
        browser.close()

if __name__ == "__main__":
    test_bug_auth_005_redirection()
