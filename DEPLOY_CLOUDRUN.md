# Google Cloud Run Deployment — whitedot-backend

**Stack:** Cloud Run (Docker) + Supabase Postgres  
**Domain:** `api.whitedotindia.in` → Cloud Run service  
**GCP Project:** `fresh-strategy-497720-q7`  
**Region:** `asia-south1` (Mumbai)

---

## PHASE 1 — Get Supabase connection strings

1. Go to https://supabase.com → Project `whitedot` → **Settings → Database**
2. Under **"Connection string"** tab, copy:
   - **Transaction** (port 6543) → this is your `DATABASE_URL`
   - **Session** (port 5432) → this is your `DIRECT_URL`
3. Both look like: `postgresql://postgres.yrsqtsejbvjwzegtkmkr:PASSWORD@aws-0-ap-northeast-1.pooler.supabase.com:PORT/postgres`

Add `?pgbouncer=true` to the end of `DATABASE_URL` only.

---

## PHASE 2 — Enable GCP APIs

In GCP Console (`fresh-strategy-497720-q7`) → search and enable:

```
Cloud Run API
Artifact Registry API
```

Or run (if gcloud is installed):
```bash
gcloud config set project fresh-strategy-497720-q7
gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

---

## PHASE 3 — Create Artifact Registry repo

In GCP Console → Artifact Registry → **Create Repository**:
- Name: `whitedot`
- Format: `Docker`
- Region: `asia-south1`
- Click Create

Or via gcloud:
```bash
gcloud artifacts repositories create whitedot \
  --repository-format=docker \
  --location=asia-south1
```

---

## PHASE 4 — Create Service Account for GitHub Actions

1. GCP Console → IAM & Admin → **Service Accounts** → Create Service Account
   - Name: `github-actions-deploy`
   - Description: `GitHub Actions Cloud Run deployer`
2. Grant these roles:
   - `Cloud Run Admin`
   - `Artifact Registry Writer`
   - `Service Account User`
3. Click Done → open the service account → **Keys** tab → **Add Key → JSON**
4. Download the JSON file

---

## PHASE 5 — Add GitHub Actions secrets

Go to GitHub → `whitedot-backend` repo → **Settings → Secrets and variables → Actions**

Add these secrets:

| Secret | Value |
|---|---|
| `GCP_SA_KEY` | Paste entire contents of the downloaded JSON key file |
| `DATABASE_URL` | Supabase Transaction URL (port 6543) + `?pgbouncer=true` |
| `DIRECT_URL` | Supabase Session URL (port 5432) |
| `JWT_SECRET` | Run `openssl rand -hex 32` and paste output |
| `FRONTEND_URL` | `https://whitedotindia.in` |
| `FRONTEND_ORIGINS` | `https://whitedotindia.in,https://rajbhanderi107-droid.github.io` |
| `ADMIN_SEED_EMAIL` | `admin@whitedot.in` |
| `ADMIN_SEED_PASSWORD` | Your admin portal password |
| `GOOGLE_CLIENT_ID` | `689571813571-q5ctmgkmu8vt1cvgbeeubqdmabs2a7ec.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | From GCP Console → OAuth 2.0 credentials |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |

---

## PHASE 6 — First deploy

Push to master (or trigger manually):

```bash
cd /c/Users/rbhan/whitedot-backend
git push origin master
```

Or go to GitHub → `whitedot-backend` → **Actions → Deploy backend (Google Cloud Run) → Run workflow**

Watch the Actions tab — takes ~3-5 minutes.

---

## PHASE 7 — Custom domain (api.whitedotindia.in)

After first deploy succeeds, Cloud Run gives you a URL like `https://whitedot-backend-xxxx-uc.a.run.app`.

To use `api.whitedotindia.in`:

1. GCP Console → Cloud Run → `whitedot-backend` → **Custom Domains** tab
2. Add domain: `api.whitedotindia.in`
3. GCP will show you a **CNAME record** to add in GoDaddy
4. GoDaddy → `whitedotindia.in` DNS → add:
   - Type: `CNAME`
   - Name: `api`
   - Value: `ghs.googlehosted.com` (or whatever GCP shows)
5. Wait ~15 min → verify: `curl https://api.whitedotindia.in/api/health`

---

## PHASE 8 — Run Prisma migrations + seed

After first deploy, run migrations once:

```bash
# Install gcloud locally, then:
gcloud run jobs create whitedot-migrate \
  --image asia-south1-docker.pkg.dev/fresh-strategy-497720-q7/whitedot/backend:latest \
  --region asia-south1 \
  --set-env-vars="DATABASE_URL=YOUR_URL,DIRECT_URL=YOUR_URL,NODE_ENV=production" \
  --command="npx,prisma,migrate,deploy" \
  --execute-now
```

Or — the `docker-entrypoint.sh` already runs `prisma migrate deploy` on every container start, so the first deploy handles it automatically.

---

## Useful commands

```bash
# View logs
gcloud run services logs read whitedot-backend --region asia-south1

# Describe service (get URL, config)
gcloud run services describe whitedot-backend --region asia-south1

# Manual deploy (trigger workflow)
# GitHub → Actions → Deploy backend → Run workflow
```
