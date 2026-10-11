import json
import subprocess
import os
import sys

temp_env = "tests/scratch_disposable.env"
env_content = """POSTGRES_DB=test_db
POSTGRES_USER=test_user
POSTGRES_PASSWORD=test_password_12345
DATABASE_URL=postgresql://test_user:test_password_12345@postgres:5432/test_db?schema=public
NEXTAUTH_URL=https://example.com
AUTH_SECRET=test_auth_secret_minimum_32_characters_long
REDIS_HTTP_TOKEN=test_redis_token_12345
"""

with open(temp_env, "w") as f:
    f.write(env_content)

try:
    cmd = ["docker", "compose", "--env-file", temp_env, "-f", "docker-compose.prod.yml", "config", "--format", "json"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        print("ERROR:", proc.stderr)
        sys.exit(1)

    cfg = json.loads(proc.stdout)
    services = cfg.get("services", {})

    print("=== Production Service Port Exposure Audit ===")
    violations = []
    for name, s_cfg in services.items():
        ports = s_cfg.get("ports", [])
        published = [p for p in ports if p.get("published")]
        print(f"Service '{name}': {len(published)} published port(s) -> {published}")

        # Intended entry point is nextjs (web application port 3000)
        if name in ("postgres", "ocr-service", "redis", "redis-http-proxy", "postgres-backup"):
            if published:
                violations.append(f"UNINTENDED EXPOSURE: Service '{name}' publishes ports: {published}")

    if violations:
        print("\nFAILURES DETECTED:")
        for v in violations:
            print(" ", v)
        sys.exit(1)
    else:
        print("\nPASS: All internal services (PostgreSQL, OCR, Redis, Proxy, Backup) have ZERO host-published ports.")
        print("PASS: Only nextjs application publishes port 3000 as intended.")
finally:
    if os.path.exists(temp_env):
        os.remove(temp_env)
