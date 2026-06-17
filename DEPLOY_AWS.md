# WhiteDot Backend — AWS Deployment Runbook

Target: **ECS Fargate + ALB** (AWS Copilot) in **ap-south-1 (Mumbai)**, **RDS Postgres**,
secrets in **SSM Parameter Store**, CI via **GitHub Actions + OIDC**.
Container image (`Dockerfile`) runs `prisma migrate deploy` on every boot, so DB schema
(including the workforce-os migration) auto-applies.

## Prerequisites (one-time, needs the AWS account owner)
1. AWS account + an IAM admin (or SSO) profile locally: `aws configure --profile whitedot`
   (region `ap-south-1`). Install AWS CLI v2 first — it is NOT installed on this machine yet.
2. Docker Desktop running (Copilot builds the image locally on first deploy).
3. A domain plan: `api.whitedotindia.in` → ALB (ACM cert in ap-south-1 + CNAME at GoDaddy).

## Step 1 — Database (RDS Postgres 16)
Create a db.t3.micro Postgres 16 in ap-south-1 (single-AZ to start). Note the connection
string. Either via console or:
```
aws rds create-db-instance --db-instance-identifier whitedot-prod \
  --engine postgres --engine-version 16 --db-instance-class db.t3.micro \
  --allocated-storage 20 --master-username wdadmin --master-user-password '<STRONG_PW>' \
  --publicly-accessible --region ap-south-1
```
DATABASE_URL = `postgresql://wdadmin:<PW>@<endpoint>:5432/postgres?schema=public`

## Step 2 — Secrets into SSM
```
AWS_PROFILE=whitedot AWS_REGION=ap-south-1 \
DATABASE_URL='postgresql://...rds...' \
JWT_SECRET='<64-char-random>' \
GOOGLE_CLIENT_ID='...' GOOGLE_CLIENT_SECRET='...' \
ADMIN_SEED_EMAIL='admin@whitedotindia.in' ADMIN_SEED_PASSWORD='<STRONG_PW>' \
bash deploy/secrets.sh
```

## Step 3 — First deploy (Copilot)
```
copilot app init whitedot
copilot env init --name prod --profile whitedot --default-config
copilot env deploy --name prod
copilot deploy --name api --env prod      # builds image, pushes ECR, creates ALB+ECS
```
Copilot prints the ALB URL. Hit `<alb-url>/api/health` → expect `{"status":"ok"}`.

## Step 4 — Data from Render (optional)
Only if the Render DB is reachable (it was suspended 2026-06-17 — may need a temporary resume,
or skip and start fresh; migrations + admin seed recreate the schema and a login).
```
SRC_URL='<render external DATABASE_URL>' DST_URL='<rds DATABASE_URL>' \
  bash deploy/migrate-render-to-rds.sh
```

## Step 5 — Domain + point the frontend
1. ACM cert for `api.whitedotindia.in` (ap-south-1), validate via DNS at GoDaddy.
2. Uncomment `alias: api.whitedotindia.in` in `copilot/api/manifest.yml`, redeploy.
3. Frontend: set `VITE_API_URL=https://api.whitedotindia.in` (already the value in
   `.github/workflows/deploy-frontend-aws.yml`; for GitHub Pages, also update
   `.github/workflows/pages.yml`). Rebuild/redeploy the frontend.

## Step 6 — Enable CI auto-deploy
1. Create a GitHub OIDC IAM role; add its ARN as repo secret `AWS_DEPLOY_ROLE_ARN`.
2. Uncomment the `push:` block in `.github/workflows/deploy-backend.yml`
   (branch is **master**). Pushes to `master` then auto-deploy via `copilot deploy`.

## Cost (ap-south-1, rough monthly)
ALB ~$18 + Fargate 0.25vCPU/0.5GB ~$9 + RDS db.t3.micro ~$13 ≈ **~$40/mo**.
Cheaper alt if cost matters: AWS App Runner (scale-to-low) + managed Postgres
(Neon/Supabase free tier) ≈ **$0–15/mo**. Say the word and I'll re-scaffold for that.
