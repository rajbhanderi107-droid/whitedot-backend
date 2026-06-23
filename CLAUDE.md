# WhiteDot Backend — CLAUDE.md

## STRICT DEPLOYMENT RULES — DO NOT VIOLATE

**Infrastructure is LOCKED to Hostinger VPS. These rules are permanent until Raj explicitly changes them.**

- Backend runs in Docker on VPS `187.127.185.57`
- nginx proxies `api.whitedotindia.in` → `http://127.0.0.1:4000`
- Deploy: GitHub Actions SSH (`.github/workflows/deploy-backend.yml`) pushes to `/opt/whitedot-backend` and runs `docker compose up --build -d`
- Database: PostgreSQL in Docker (`db` service in `docker-compose.yml`)
- Secrets managed via `/opt/whitedot-backend/.env` on the VPS

**NEVER suggest, add, or reference:**
- Render / render.com / onrender.com / `RENDER_EXTERNAL_URL`
- Vercel / Railway / Heroku / Fly.io / Supabase hosted backend
- Any platform other than Hostinger VPS

If a new platform is needed, Raj must explicitly say so first.

---

## Project Structure

- `src/` — Express 5 + TypeScript source
- `prisma/` — Prisma schema + migrations
- `nginx/` — nginx config files for `whitedotindia.in` and `api.whitedotindia.in`
- `Dockerfile` + `docker-compose.yml` — production container setup
- `.github/workflows/deploy-backend.yml` — VPS deploy via SSH
