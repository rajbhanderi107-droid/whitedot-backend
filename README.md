# WhiteDot Backend

Production backend for the WhiteDot / LIMEX website — CRM, lead management, quote workflows, sample tracking, and admin dashboard.

## Stack

- **Runtime:** Node.js + TypeScript
- **Framework:** Express 5
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Validation:** Zod
- **Auth:** JWT with secure HTTP-only cookies

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# 3. Generate Prisma client
npm run prisma:generate

# 4. Run database migrations
npm run prisma:migrate

# 5. Seed the admin user
npm run seed

# 6. Start development server
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing |
| `PORT` | No | Server port (default: 4000) |
| `NODE_ENV` | No | development / production |
| `FRONTEND_URL` | No | CORS origin (default: http://localhost:5173) |
| `ADMIN_SEED_EMAIL` | For seed | Admin email for initial user |
| `ADMIN_SEED_PASSWORD` | For seed | Admin password for initial user |

## API Routes

### Public (rate-limited)
- `POST /api/public/inquiry` — Contact form
- `POST /api/public/quote-request` — LIMEX quote request
- `POST /api/public/sample-request` — Sample request
- `POST /api/public/calculator-submission` — Calculator results

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Admin (auth required)
- `GET /api/dashboard` — Dashboard stats
- `/api/inquiries` — CRUD
- `/api/quote-requests` — CRUD
- `/api/sample-requests` — CRUD
- `/api/companies` — CRUD
- `/api/calculator-submissions` — List + convert to lead
- `/api/follow-ups` — CRUD
- `/api/documents` — CRUD
- `/api/website-settings` — Read + update
- `/api/users` — SUPER_ADMIN only
- `/api/notifications` — User notifications
- `/api/activity-log` — Audit trail

## Database Models

User, Company, Inquiry, QuoteRequest, SampleRequest, CalculatorSubmission, AdminNote, FollowUpTask, DocumentAsset, WebsiteSetting, ActivityLog, Notification

## Deployment

**Backend:** Railway or Render
**Database:** Supabase PostgreSQL or Neon

Production checklist:
1. Set `NODE_ENV=production`
2. Use strong `JWT_SECRET`
3. Set `FRONTEND_URL` to production domain
4. Run `npm run prisma:migrate:deploy`
5. Run `npm run seed`

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm run start` | Start production server |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run DB migrations (dev) |
| `npm run prisma:migrate:deploy` | Run DB migrations (prod) |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run seed` | Seed admin user + settings |
