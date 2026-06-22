# Hostinger VPS Deployment Runbook — whitedot-backend

**Stack:** Node.js (Docker) + Postgres (Docker) + Nginx reverse proxy  
**Domain:** `api.whitedotindia.in` → port 4000

---

## PHASE 1 — Buy Hostinger VPS

1. Go to https://www.hostinger.com/vps-hosting
2. Click **KVM 1** → Add to cart
3. During checkout:
   - Billing: 1 month
   - **OS: Ubuntu 24.04 LTS** (important — pick this exact one)
   - Set a root password (save it)
   - Complete payment
4. After purchase → go to **hPanel** → VPS section
5. Copy the **VPS public IP address** (you'll need it for DNS + GitHub secrets)

---

## PHASE 2 — GoDaddy DNS (do this while VPS boots)

1. Log in to GoDaddy → My Products → Domains → `whitedotindia.in` → DNS
2. Find existing `api` record (type A) — edit it, or add new:
   ```
   Type:  A
   Name:  api
   Value: <YOUR_VPS_IP>
   TTL:   600
   ```
3. Save. Takes 5–15 min to propagate.

---

## PHASE 3 — First SSH into VPS

```bash
ssh root@<YOUR_VPS_IP>
```

(Use the password you set during checkout, or SSH key if you added one)

---

## PHASE 4 — Install Docker + Nginx + Certbot

Paste this entire block — runs as one script:

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Nginx + Certbot
apt install -y nginx certbot python3-certbot-nginx git

# Enable services
systemctl enable nginx docker
systemctl start nginx docker

echo "Done. Docker + Nginx + Certbot installed."
```

---

## PHASE 5 — Clone repo + create .env

```bash
# Clone backend repo
git clone https://github.com/rajbhanderi107-droid/whitedot-backend.git /opt/whitedot-backend
cd /opt/whitedot-backend

# Create .env from example
cp .env.example .env
nano .env
```

**Edit these values in nano** (Ctrl+O to save, Ctrl+X to exit):

| Variable | What to set |
|---|---|
| `POSTGRES_PASSWORD` | Pick a strong password (e.g. `Wd@2026#Secure!`) |
| `DATABASE_URL` | Replace `CHANGE_ME` with same password |
| `DIRECT_URL` | Same as `DATABASE_URL` |
| `JWT_SECRET` | Random 64-char string (run: `openssl rand -hex 32`) |
| `ADMIN_SEED_EMAIL` | `admin@whitedot.in` |
| `ADMIN_SEED_PASSWORD` | Your admin login password |
| `GOOGLE_CLIENT_SECRET` | From GCP Console |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |

---

## PHASE 6 — Start containers

```bash
cd /opt/whitedot-backend
docker compose up --build -d
```

This will:
- Pull Postgres 16 image
- Build the Node.js app
- Run `prisma migrate deploy` (creates all tables)
- Start both containers

Check logs:
```bash
docker compose logs -f
# Should see: "Server running on port 4000" and "db connected"
# Ctrl+C to stop watching logs
```

Test locally on the VPS:
```bash
curl http://localhost:4000/api/health
# Should return: {"status":"ok","db":"connected"}
```

---

## PHASE 7 — Nginx SSL setup

```bash
# Copy Nginx config
cp /opt/whitedot-backend/nginx/api.whitedotindia.in.conf /etc/nginx/sites-available/api.whitedotindia.in
ln -s /etc/nginx/sites-available/api.whitedotindia.in /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issue SSL certificate (DNS must be propagated first — test: ping api.whitedotindia.in)
certbot --nginx -d api.whitedotindia.in --non-interactive --agree-tos -m rajbhanderi107@gmail.com
```

Test from your laptop:
```bash
curl https://api.whitedotindia.in/api/health
```

---

## PHASE 8 — GitHub Actions auto-deploy secrets

In GitHub → `whitedot-backend` repo → Settings → Secrets and variables → Actions → New secret:

| Name | Value |
|---|---|
| `VPS_HOST` | Your VPS public IP |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Contents of your SSH private key |

**To generate an SSH key for GitHub Actions (run on VPS):**
```bash
ssh-keygen -t ed25519 -C "github-actions" -f /root/.ssh/github_deploy -N ""
cat /root/.ssh/github_deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/github_deploy   # copy this → paste as VPS_SSH_KEY secret
```

After this, every push to `master` auto-deploys.

---

## Useful commands

```bash
# View logs
docker compose -f /opt/whitedot-backend/docker-compose.yml logs -f

# Restart app only
docker compose -f /opt/whitedot-backend/docker-compose.yml restart api

# Manual redeploy
cd /opt/whitedot-backend && git pull && docker compose up --build -d && docker image prune -f

# Postgres shell
docker compose -f /opt/whitedot-backend/docker-compose.yml exec db psql -U whitedot -d whitedot
```

---

## Backup Postgres data

```bash
# Dump
docker compose -f /opt/whitedot-backend/docker-compose.yml exec db \
  pg_dump -U whitedot whitedot > backup_$(date +%Y%m%d).sql

# Restore
cat backup_YYYYMMDD.sql | docker compose -f /opt/whitedot-backend/docker-compose.yml exec -T db \
  psql -U whitedot -d whitedot
```
