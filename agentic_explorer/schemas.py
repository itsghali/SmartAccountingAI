from pydantic import BaseModel, Field
from typing import Optional, Literal

ActionType = Literal[
    "navigate", "click", "fill", "select", "check", "uncheck",
    "press", "wait", "screenshot", "assert_visible", "assert_text", "assert_url"
]

class BrowserAction(BaseModel):
    action: ActionType = Field(description="L'action à effectuer dans le navigateur.")
    target: Optional[str] = Field(None, description="Sélecteur CSS de l'élément cible. STRICTEMENT INTERDIT d'utiliser XPath ou nth().")
    value: Optional[str] = Field(None, description="La valeur à saisir ou le texte à vérifier.")
    url: Optional[str] = Field(None, description="L'URL cible pour la navigation ou l'assertion.")
    timeout: Optional[int] = Field(None, description="Temps d'attente en millisecondes.")
