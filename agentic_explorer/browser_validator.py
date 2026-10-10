import re
import json
import logging
from typing import Dict, Any

from .schemas import BrowserAction

# Configuration du Action Tape (enregistrement inaltérable des actions)
tape_logger = logging.getLogger("ActionTape")
tape_logger.setLevel(logging.INFO)
file_handler = logging.FileHandler("action_tape.log")
file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
tape_logger.addHandler(file_handler)

MAX_STEPS = 50
MAX_TIME_MS = 600000  # 10 minutes

# Patterns interdits (XPath, pseudo-classes non stables, scripts)
BANNED_SELECTORS = [r"//", r"xpath", r"nth\(", r"nth=", r"<script", r"javascript:"]

def validate_action(action_dict: Dict[str, Any], current_step: int, elapsed_time_ms: int = 0) -> BrowserAction:
    """
    Valide de manière déterministe qu'une action LLM est sûre et conforme.
    """
    # 1. Vérifier les limites de steps et temps
    if current_step >= MAX_STEPS:
        raise ValueError(f"BLOCKED: Limite de steps atteinte ({MAX_STEPS} max).")
    
    if elapsed_time_ms >= MAX_TIME_MS:
        raise ValueError(f"BLOCKED: Limite de temps d'exploration atteinte.")

    # 2. Valider le schéma JSON (Actions autorisées uniquement)
    try:
        action = BrowserAction(**action_dict)
    except Exception as e:
        raise ValueError(f"BLOCKED: Schéma d'action invalide ou action non autorisée : {e}")

    # 3. Validateur de cible (Interdiction de XPath, nth, etc.)
    if action.target:
        for banned in BANNED_SELECTORS:
            if re.search(banned, action.target, re.IGNORECASE):
                raise ValueError(f"SECURITY BLOCK: Le sélecteur '{action.target}' utilise une syntaxe interdite (XPath, nth, script).")

    # 4. Enregistrement dans la bande (Action Tape)
    tape_logger.info(json.dumps(action_dict))
    
    return action
