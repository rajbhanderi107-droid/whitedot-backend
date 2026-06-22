# Hostinger VPS Deployment Runbook — whitedot-backend

Backend: `api.whitedotindia.in` → Hostinger VPS port 4000 (Docker) via Nginx reverse proxy.

---

## One-time VPS Setup (do once via SSH)

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # re-login after this

# 2. Install Nginx + Certbot
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

# 3. Clone repo
sudo mkdir -p /opt/whitedot-backend
sudo chown $USER:$USER /opt/whitedot-backend
git clone https://github.com/rajbhanderi107-droid/whitedot-backend.git /opt/whitedot-backend

# 4. Create .env on the server (copy from .env.example, fill real values)
cp /opt/whitedot-backend/.env.example /opt/whitedot-backend/.env
nano /opt/whitedot-backend/.env
```

### .env values needed on VPS
```
DATABASE_URL=postgresql://...   # Neon / Supabase / Hostinger managed PG
DIRECT_URL=postgresql://...     # same as DATABASE_URL unless connection pooling
JWT_SECRET=<long-random-string>
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://whitedotindia.in
FRONTEND_ORIGINS=https://whitedotindia.in,https://rajbhanderi107-droid.github.io
ADMIN_SEED_EMAIL=admin@whitedot.in
ADMIN_SEED_PASSWORD=<strong-password>
GOOGLE_CLIENT_ID=689571813571-q5ctmgkmu8vt1cvgbeeubqdmabs2a7ec.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<from-gcp-console>
ANTHROPIC_API_KEY=<from-anthropic-console>
ANTHROPIC_MODEL=claude-sonnet-4-6
```

---

## 5. First deploy (manual)
```bash
cd /opt/whitedot-backend
docker compose up --build -d
docker compose logs -f   # watch for "Server running on port 4000"
```

---

## 6. Nginx + SSL

```bash
# Copy nginx config
sudo cp /opt/whitedot-backend/nginx/api.whitedotindia.in.conf /etc/nginx/sites-available/api.whitedotindia.in
sudo ln -s /etc/nginx/sites-available/api.whitedotindia.in /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue SSL cert (requires api.whitedotindia.in A record → VPS IP already set in GoDaddy)
sudo certbot --nginx -d api.whitedotindia.in --non-interactive --agree-tos -m rajbhanderi107@gmail.com

# Auto-renew is set up by certbot automatically (systemd timer)
```

---

## 7. GoDaddy DNS

Go to GoDaddy → DNS → add/update:
```
Type: A
Name: api
Value: <Hostinger VPS public IP>
TTL: 600
```

Wait ~5 min for propagation, then verify: `curl https://api.whitedotindia.in/api/health`

---

## 8. GitHub Actions secrets (for auto-deploy on push)

In GitHub repo → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `VPS_HOST` | Hostinger VPS public IP |
| `VPS_USER` | SSH username (usually `root` or your user) |
| `VPS_SSH_KEY` | Private key (paste contents of `~/.ssh/id_rsa`) |
| `VPS_PORT` | SSH port (default 22, skip if default) |

After this, every push to `master` that touches `src/`, `prisma/`, `Dockerfile`, etc. auto-deploys.

---

## Useful commands on VPS

```bash
# Logs
docker compose -f /opt/whitedot-backend/docker-compose.yml logs -f

# Restart
docker compose -f /opt/whitedot-backend/docker-compose.yml restart

# Shell into container
docker compose -f /opt/whitedot-backend/docker-compose.yml exec api sh

# Rebuild manually
cd /opt/whitedot-backend && git pull && docker compose up --build -d && docker image prune -f
```

---

## Keep-alive cron (frontend)

`keep-alive.yml` in `whitedot-limex.in` already pings `api.whitedotindia.in/api/health` — no change needed.
