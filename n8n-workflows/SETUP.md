# n8n + Render Setup (5 minutes)

## Step 1: n8n Cloud (free)

1. Go to https://app.n8n.cloud/register → sign up free
2. Once in, go to **Credentials** → **Add Credential** → **OpenAI API**
3. Paste your OpenAI key → Save
4. Go to **Workflows** → **Import from file** → select `whitedot-ai-agents.json`
5. In each OpenAI node, select your OpenAI credential from the dropdown
6. Click **Activate** (top-right toggle)
7. Copy your webhook base URL — it looks like:
   `https://YOUR-INSTANCE.app.n8n.cloud/webhook/`
   (visible when you click any Webhook node → "Production URL")

## Step 2: Render env var

1. Go to https://dashboard.render.com → whitedot-backend service → Environment
2. Add: `N8N_WEBHOOK_URL` = `https://YOUR-INSTANCE.app.n8n.cloud/webhook`
   (no trailing slash, no path — the backend appends /agent-run, /ai-tool, /ai-draft)
3. Save → auto-redeploys

## Done

All portal AI features are now live with GPT-4o/GPT-4o-mini via n8n.

## OpenAI Free Tier

- gpt-4o-mini: free tier gives ~3 RPM / 200 RPD
- gpt-4o: requires $5+ credit (pay-as-you-go, ~$0.005/call)
- For production: add $10 credit → handles hundreds of agent calls/day
