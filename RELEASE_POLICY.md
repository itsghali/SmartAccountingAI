# SmartAccountingAI — Release Freeze & Production Deployment Policy

**Current Policy Status:** `RELEASE FREEZE ACTIVE (Sprint 0.1)`  
**Effective Date:** Sprint 0.1 Freeze (October 2026)  
**Target:** Production Releases and Deployment Pipelines  

---

## 1. Executive Summary & Policy Scope

A strict **Release Freeze** is active for SmartAccountingAI. Production release and deployment are halted until all Sprint 0.1 security and deployment-safety criteria have been independently audited, approved, and formally signed off.

Under this policy:
- No automated deployments to production may execute.
- All deployment scripts fail closed unless an explicit, authorized bypass is provided.
- Production configurations must not contain insecure fallback secrets or default passwords.
- Internal services (PostgreSQL, OCR, Redis) must not expose host-level ports to public networks.
- Production releases remain blocked until Sprint 0.1 is accepted and subsequent security/quality gates are authorized.

---

## 2. Mandatory Release Gates

Before the release freeze can be lifted, all of the following gates must be satisfied and verified:

| Gate ID | Name | Requirement | Status |
|---|---|---|---|
| **GATE-01** | Fail-Closed Secrets | Production configuration rejects missing or default secrets immediately on startup. | **VERIFIED (Code & Compose)** |
| **GATE-02** | Network Isolation | PostgreSQL, Redis, Redis HTTP proxy, and OCR have no host port bindings in production. | **VERIFIED (Compose Config)** |
| **GATE-03** | OCR Health & Warmup | OCR reports HTTP 503 while initializing/warming up, and HTTP 200 only after successful model warmup. Fails closed on error. | **VERIFIED (Runtime & Source)** |
| **GATE-04** | Dependency Health Wait | Web application (`nextjs`) waits for healthy `postgres`, `redis-http-proxy`, and `ocr-service` before starting. | **VERIFIED (Compose Config)** |
| **GATE-05** | Credential Rotation | Historical default credentials identified and rotated in deployment platform/secret store. | **PENDING EXTERNAL ROTATION (`NOT VERIFIED`)** |
| **GATE-06** | Platform Protections | GitHub environment protection rules, protected branches, and secret managers configured. | **PENDING PLATFORM ACCESS (`NOT VERIFIED`)** |

---

## 3. Credential Exposure & Rotation Checklist

Default fallback credentials previously existed in repository commit history (`cf346b0` / `29c04ca`) and local test containers. The following credentials must be rotated in the production environment:

### Rotation Procedure & Checklist

1. **PostgreSQL Database Password (`POSTGRES_PASSWORD`)**
   - **Historical Exposure:** Hardcoded fallback values in previous `docker-compose.prod.yml` revisions.
   - **Remediation Action:** Generate a high-entropy password (min 24 characters) in the production secret store. Update PostgreSQL role password:
     ```sql
     ALTER USER <username> WITH PASSWORD '<new_secure_password>';
     ```
   - **Verification:** `NOT VERIFIED` (requires production database administrative access).

2. **NextAuth / Auth.js Signing Secret (`AUTH_SECRET`)**
   - **Historical Exposure:** Insecure default string in earlier Compose revisions.
   - **Remediation Action:** Generate a new 32+ byte cryptographic key:
     ```bash
     openssl rand -base64 32
     ```
   - **Session Invalidation Procedure:** Auth.js uses JWT tokens signed with `AUTH_SECRET`. Upon rotating `AUTH_SECRET`, all existing sessions signed with previous secrets become invalid immediately. Users will receive HTTP 401 / redirect to `/login` on subsequent requests and must re-authenticate. No manual database token purge is required since session tokens are stateless JWTs signed by this secret.
   - **Verification:** `NOT VERIFIED` (requires production secret manager deployment).

3. **Serverless Redis HTTP Token (`REDIS_HTTP_TOKEN` / `UPSTASH_REDIS_REST_TOKEN`)**
   - **Historical Exposure:** Static token in previous compose configuration.
   - **Remediation Action:** Generate a new random token:
     ```bash
     openssl rand -hex 24
     ```
     Update `REDIS_HTTP_TOKEN` across `redis-http-proxy` and `nextjs` services simultaneously.
   - **Verification:** `NOT VERIFIED` (requires production environment access).

4. **External AI API Credentials (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)**
   - **Exposure Audit:** No real API keys were committed to git history (only empty strings or placeholders). Real keys in local `.env` remain untracked.
   - **Remediation Action:** Audit provider consoles (Groq, OpenRouter, OpenAI) to ensure keys used for financial document processing are restricted by IP or scoped per environment.
   - **Verification:** `NOT VERIFIED` (requires external provider console access).

---

## 4. Platform-Level Security Settings Checklist

The following settings must be verified on the production hosting and version control platforms before releasing to production:

- [ ] **GitHub Protected Branch (`main`)**: Require pull request reviews, status check passes (`quality-gate`), and prohibit force pushes.  
  *Status:* **NOT VERIFIED** (requires GitHub repository admin settings).
- [ ] **GitHub Environment Protection Rules (`production`)**: Configure a required review gate before deployments can run.  
  *Status:* **NOT VERIFIED** (requires GitHub repository admin settings).
- [ ] **Cloud Firewall / Ingress Security Group**: Verify that only port 443/80 (HTTPS/HTTP) is open to the internet on the application reverse proxy / load balancer. PostgreSQL (5432), Redis (6379/80), and OCR (8000) must be closed to the internet.  
  *Status:* **NOT VERIFIED** (requires production firewall / VPC console review).
- [ ] **Secret Manager Integration**: Verify that production secrets are injected via secure secret store rather than plaintext `.env` files on disk.  
  *Status:* **NOT VERIFIED** (requires production infrastructure review).

---

## 5. Release Bypass Procedure

In the event of an emergency release during the freeze, the deployment must be authorized in writing by the designated Security Lead. The following environment variable must be explicitly injected for the deployment job:

```bash
RELEASE_FREEZE_BYPASS_APPROVED=true
```

Any attempt to deploy without this approved bypass flag will immediately abort with exit code 1.
