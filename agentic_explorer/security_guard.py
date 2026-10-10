import os
import sys
import yaml
from dotenv import load_dotenv

def validate_environment():
    # Load environment variables from .env file
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
    
    target_env = os.environ.get("TARGET_ENV", "").strip().upper()
    database_env = os.environ.get("DATABASE_ENV", "").strip().upper()
    production = os.environ.get("PRODUCTION", "true").strip().lower()
    target_base_url = os.environ.get("TARGET_BASE_URL", "").strip()

    # Load YAML configuration
    config_path = os.path.join(os.path.dirname(__file__), 'config.yaml')
    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
    except Exception as e:
        print(f"SECURITY BLOCK: Failed to load config.yaml: {e}")
        sys.exit(1)

    approved_targets = config.get("approved_targets", [])

    errors = []

    # Check Environment Variables
    if target_env != "QA":
        errors.append(f"TARGET_ENV is not 'QA' (Found: '{target_env}')")
        
    if database_env != "QA":
        errors.append(f"DATABASE_ENV is not 'QA' (Found: '{database_env}')")
        
    if production != "false":
        errors.append(f"PRODUCTION is not 'false' (Found: '{production}')")
        
    if target_base_url not in approved_targets:
        errors.append(f"TARGET_BASE_URL '{target_base_url}' is not in approved targets list: {approved_targets}")
        
    if not os.environ.get("GROQ_API_KEY"):
        errors.append("GROQ_API_KEY is not set.")
        
    if not os.environ.get("GROQ_MODEL"):
        errors.append("GROQ_MODEL is not set.")

    if errors:
        print("SECURITY BLOCK: The environment does not meet safety requirements.")
        for err in errors:
            print(f" - {err}")
        print("\nAborting execution to prevent unauthorized or ambiguous actions.")
        sys.exit(1)

    print("Security Guard Check Passed: Environment is correctly configured for QA.")
    return config

if __name__ == "__main__":
    validate_environment()
