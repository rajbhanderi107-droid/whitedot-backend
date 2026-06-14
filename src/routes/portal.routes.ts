import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import type { AutomationMode, ApprovalRisk, IncidentSeverity, IncidentStage } from "@prisma/client";

const router = Router();
router.use(requireAuth);

// ─── Portal State ─────────────────────────────────────────────────────

router.get("/state", asyncHandler(async (_req, res) => {
  let state = await prisma.portalState.findUnique({ where: { id: "singleton" } });
  if (!state) {
    state = await prisma.portalState.create({ data: { id: "singleton" } });
  }
  res.json({ success: true, data: state });
}));

router.patch("/state", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(async (req, res) => {
  const { automationMode, emergencyStop } = req.body as {
    automationMode?: AutomationMode;
    emergencyStop?: boolean;
  };
  const state = await prisma.portalState.upsert({
    where: { id: "singleton" },
    update: { ...(automationMode !== undefined && { automationMode }), ...(emergencyStop !== undefined && { emergencyStop }) },
    create: { id: "singleton", ...(automationMode && { automationMode }), ...(emergencyStop !== undefined && { emergencyStop }) },
  });
  res.json({ success: true, data: state });
}));

// ─── Automations ──────────────────────────────────────────────────────

router.get("/automations", asyncHandler(async (_req, res) => {
  const rows = await prisma.portalAutomation.findMany({ orderBy: { id: "asc" } });
  res.json({ success: true, data: rows });
}));

router.patch("/automations/:id", asyncHandler(async (req, res) => {
  const { id } = req.params as Record<string, string>;
  const { enabled, mode } = req.body as { enabled?: boolean; mode?: AutomationMode };
  const row = await prisma.portalAutomation.upsert({
    where: { id },
    update: { ...(enabled !== undefined && { enabled }), ...(mode && { mode }) },
    create: { id, ...(enabled !== undefined && { enabled }), ...(mode && { mode }) },
  });
  res.json({ success: true, data: row });
}));

// ─── AI Agents ────────────────────────────────────────────────────────

router.get("/ai-agents", asyncHandler(async (_req, res) => {
  const rows = await prisma.portalAiAgent.findMany({ orderBy: { id: "asc" } });
  res.json({ success: true, data: rows });
}));

router.patch("/ai-agents/:id", asyncHandler(async (req, res) => {
  const { id } = req.params as Record<string, string>;
  const { enabled, mode } = req.body as { enabled?: boolean; mode?: AutomationMode };
  const row = await prisma.portalAiAgent.upsert({
    where: { id },
    update: { ...(enabled !== undefined && { enabled }), ...(mode && { mode }) },
    create: { id, ...(enabled !== undefined && { enabled }), ...(mode && { mode }) },
  });
  res.json({ success: true, data: row });
}));

router.post("/ai-agents/:id/run", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "ANTHROPIC_API_KEY not set" } });
    return;
  }
  const { id } = req.params as Record<string, string>;
  const { input, context } = req.body as { input: string; context?: string };
  if (!input?.trim()) {
    res.status(400).json({ success: false, error: { code: "MISSING_INPUT", message: "input is required" } });
    return;
  }

  const prompt = context ? `Context:\n${context}\n\nTask:\n${input}` : input;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: (err as { error?: { message?: string } }).error?.message ?? "LLM call failed" } });
    return;
  }
  const llm = await resp.json() as {
    id: string;
    content: { text: string }[];
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  };
  const output = llm.content[0]?.text ?? "";
  const inputTokens = llm.usage?.input_tokens ?? 0;
  const outputTokens = llm.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens * 0.00000025) + (outputTokens * 0.00000125);

  const run = await prisma.agentRun.create({
    data: { agentId: id, input, output, model: llm.model, inputTokens, outputTokens, costUsd },
  });
  res.json({ success: true, data: { runId: run.id, agentId: id, output, model: run.model, inputTokens, outputTokens, costUsd, createdAt: run.createdAt } });
}));

// ─── AI Tools ─────────────────────────────────────────────────────────

router.post("/ai/tool", asyncHandler(async (req, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "ANTHROPIC_API_KEY not set" } });
    return;
  }
  const { tool, inputs } = req.body as { tool: string; inputs: Record<string, string> };
  const prompt = `You are a business AI tool. Tool: "${tool}"\nInputs: ${JSON.stringify(inputs)}\n\nProvide a concise, professional response.`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2048, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "AI tool call failed" } });
    return;
  }
  const llm = await resp.json() as {
    id: string;
    content: { text: string }[];
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  };
  const output = llm.content[0]?.text ?? "";
  const inputTokens = llm.usage?.input_tokens ?? 0;
  const outputTokens = llm.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens * 0.00000025) + (outputTokens * 0.00000125);
  const runId = `tool-${Date.now()}`;
  res.json({ success: true, data: { runId, tool, output, model: llm.model, inputTokens, outputTokens, costUsd, createdAt: new Date().toISOString() } });
}));

// ─── AI Draft ─────────────────────────────────────────────────────────

router.post("/ai-draft", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  const { kind, lead } = req.body as {
    kind: "followup_email" | "followup_whatsapp" | "proposal_intro" | "reactivation";
    lead: { name: string; company?: string; status?: string; industry?: string; product?: string; notes?: string };
  };
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "ANTHROPIC_API_KEY not set" } });
    return;
  }
  const prompts: Record<string, string> = {
    followup_email: `Write a professional follow-up email for lead: ${lead.name} from ${lead.company ?? "unknown company"}, industry: ${lead.industry ?? "N/A"}, status: ${lead.status ?? "N/A"}. Product: LIMEX sustainable material. Keep it warm, brief, 3 paragraphs.`,
    followup_whatsapp: `Write a WhatsApp follow-up message (under 200 chars) for ${lead.name} from ${lead.company ?? ""}. LIMEX material enquiry. Friendly, professional.`,
    proposal_intro: `Write a proposal introduction paragraph for ${lead.name}, ${lead.company ?? ""}, ${lead.industry ?? ""} interested in LIMEX material. Highlight sustainability + cost savings.`,
    reactivation: `Write a reactivation outreach for ${lead.name} from ${lead.company ?? ""} who went cold. LIMEX material. Reference their previous interest in ${lead.product ?? "LIMEX"}. Max 3 sentences.`,
  };
  const prompt = prompts[kind] ?? prompts.followup_email;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "Draft generation failed" } });
    return;
  }
  const llm = await resp.json() as { content: { text: string }[] };
  const preview = llm.content[0]?.text ?? "";

  const approval = await prisma.approval.create({
    data: {
      title: `AI Draft: ${kind} for ${lead.name}`,
      kind,
      risk: "LOW",
      preview,
      ...(req.user?.id && { createdById: req.user.id }),
    },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.json({ success: true, data: approval });
}));

// ─── AI Stats ─────────────────────────────────────────────────────────

router.get("/ai/stats", asyncHandler(async (_req, res) => {
  const [pending, approved, rejected, aiDrafts] = await Promise.all([
    prisma.approval.count({ where: { status: "PENDING" } }),
    prisma.approval.count({ where: { status: "APPROVED" } }),
    prisma.approval.count({ where: { status: "REJECTED" } }),
    prisma.approval.count({ where: { kind: { in: ["followup_email", "followup_whatsapp", "proposal_intro", "reactivation"] } } }),
  ]);
  const decided = approved + rejected;
  res.json({ success: true, data: {
    pending, approved, rejected, decided, aiDrafts,
    approvalRate: decided > 0 ? Math.round((approved / decided) * 100) / 100 : null,
    llmConfigured: env.llmConfigured,
  }});
}));

// ─── Integrations ─────────────────────────────────────────────────────

router.get("/integrations", asyncHandler(async (_req, res) => {
  const rows = await prisma.portalIntegration.findMany({ orderBy: { id: "asc" } });
  res.json({ success: true, data: rows });
}));

router.patch("/integrations/:id", asyncHandler(async (req, res) => {
  const { id } = req.params as Record<string, string>;
  const { connected, environment } = req.body as { connected?: boolean; environment?: "sandbox" | "production" };
  const row = await prisma.portalIntegration.upsert({
    where: { id },
    update: { ...(connected !== undefined && { connected }), ...(environment && { environment }) },
    create: { id, ...(connected !== undefined && { connected }), ...(environment && { environment }) },
  });
  res.json({ success: true, data: row });
}));

// ─── Approvals ────────────────────────────────────────────────────────

router.get("/approvals", asyncHandler(async (req, res) => {
  const status = req.query.status as string;
  const where = status === "ALL" ? {} : { status: "PENDING" as const };
  const rows = await prisma.approval.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.json({ success: true, data: rows });
}));

router.post("/approvals", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  const { title, kind, automationId, risk, preview } = req.body as {
    title: string; kind: string; automationId?: string; risk?: ApprovalRisk; preview: string;
  };
  const row = await prisma.approval.create({
    data: { title, kind, automationId, risk: risk ?? "LOW", preview, ...(req.user?.id && { createdById: req.user.id }) },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.status(201).json({ success: true, data: row });
}));

router.post("/approvals/:id/decide", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  const { id } = req.params as Record<string, string>;
  const { decision } = req.body as { decision: "APPROVED" | "REJECTED" };
  const row = await prisma.approval.update({
    where: { id },
    data: { status: decision, decidedAt: new Date(), ...(req.user?.id && { decidedById: req.user.id }) },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.json({ success: true, data: row });
}));

// ─── Workflows ────────────────────────────────────────────────────────

router.get("/workflows", asyncHandler(async (_req, res) => {
  const rows = await prisma.workflow.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: rows });
}));

router.post("/workflows", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  const { name, trigger, condition, action } = req.body as { name: string; trigger: string; condition: string; action: string };
  const row = await prisma.workflow.create({
    data: { name, trigger, condition, action, ...(req.user?.id && { createdById: req.user.id }) },
  });
  res.status(201).json({ success: true, data: row });
}));

router.delete("/workflows/:id", asyncHandler(async (_req, res) => {
  const { id } = (_req as Request).params as Record<string, string>;
  await prisma.workflow.delete({ where: { id } });
  res.json({ success: true, data: null });
}));

// ─── Incidents ────────────────────────────────────────────────────────

router.get("/incidents", asyncHandler(async (_req, res) => {
  const rows = await prisma.incident.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: rows });
}));

router.post("/incidents", asyncHandler(async (req, res) => {
  const { title, severity, playbook } = req.body as { title: string; severity: IncidentSeverity; playbook: string };
  const row = await prisma.incident.create({ data: { title, severity, playbook } });
  // SEV0/SEV1 auto-trigger lockdown
  if (severity === "SEV0" || severity === "SEV1") {
    await prisma.portalState.upsert({
      where: { id: "singleton" },
      update: { automationMode: "LOCKDOWN", emergencyStop: true },
      create: { id: "singleton", automationMode: "LOCKDOWN", emergencyStop: true },
    });
  }
  res.status(201).json({ success: true, data: row });
}));

router.patch("/incidents/:id", asyncHandler(async (req, res) => {
  const { id } = req.params as Record<string, string>;
  const { stage } = req.body as { stage: IncidentStage };
  const data: Record<string, unknown> = { stage };
  if (stage === "RESOLVED") data.resolvedAt = new Date();
  const row = await prisma.incident.update({ where: { id }, data });
  res.json({ success: true, data: row });
}));

router.delete("/incidents/:id", asyncHandler(async (req, res) => {
  await prisma.incident.delete({ where: { id: (req.params as Record<string, string>).id } });
  res.json({ success: true, data: null });
}));

// ─── Security ─────────────────────────────────────────────────────────

router.get("/security/summary", asyncHandler(async (_req, res) => {
  const since24h = new Date(Date.now() - 86_400_000);
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const [events24h, total7d, recentEvents] = await Promise.all([
    prisma.securityEvent.groupBy({ by: ["kind"], where: { createdAt: { gte: since24h } }, _count: { kind: true } }),
    prisma.securityEvent.count({ where: { createdAt: { gte: since7d } } }),
    prisma.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const counts24h: Record<string, number> = { AUTH_FAILURE: 0, RATE_LIMITED: 0, VALIDATION_REJECTED: 0, LOCKDOWN_BLOCK: 0 };
  for (const g of events24h) counts24h[g.kind] = g._count.kind;
  const high24h = await prisma.securityEvent.count({ where: { createdAt: { gte: since24h }, severity: { in: ["HIGH", "CRITICAL"] } } });
  res.json({ success: true, data: { counts24h, high24h, total7d, events: recentEvents } });
}));

// ─── BI Summary ───────────────────────────────────────────────────────

router.get("/bi/summary", asyncHandler(async (_req, res) => {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("default", { month: "short" }), start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
  });

  const [monthlyLeads, funnelGroups, industryGroups, quoteCount, sampleCount, calcCount] = await Promise.all([
    Promise.all(months.map(m => prisma.inquiry.count({ where: { createdAt: { gte: m.start, lt: m.end } } }))),
    prisma.inquiry.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.inquiry.groupBy({ by: ["industry"], _count: { industry: true }, orderBy: { _count: { industry: "desc" } }, take: 5 }),
    prisma.quoteRequest.count(),
    prisma.sampleRequest.count(),
    prisma.calculatorSubmission.count(),
  ]);

  const funnel: Record<string, number> = {};
  for (const g of funnelGroups) if (g.status) funnel[g.status] = g._count.status;

  res.json({ success: true, data: {
    monthlyLeads: months.map((m, i) => ({ key: m.key, label: m.label, count: monthlyLeads[i] })),
    funnel,
    topIndustries: industryGroups.map(g => ({ industry: g.industry ?? "Unknown", count: g._count.industry })),
    totals: { quotes: quoteCount, samples: sampleCount, calculators: calcCount, quotations: 0, quotationValue: 0, orders: 0, orderValue: 0, campaigns: 0, campaignBudget: 0, campaignSpend: 0, campaignLeads: 0 },
  }});
}));

// ─── Health Detailed ──────────────────────────────────────────────────

router.get("/health/detailed", asyncHandler(async (_req, res) => {
  const t0 = Date.now();
  const [dbResult, siteResult] = await Promise.allSettled([
    prisma.$queryRaw<[{ one: number }]>`SELECT 1 AS one`,
    fetch("https://whitedotindia.in", { signal: AbortSignal.timeout(5000) }),
  ]);
  const dbOk = dbResult.status === "fulfilled";
  const dbLatency = Date.now() - t0;
  const site = siteResult.status === "fulfilled" ? siteResult.value : null;

  const [sitemapResult, robotsResult] = await Promise.allSettled([
    fetch("https://whitedotindia.in/sitemap.xml", { signal: AbortSignal.timeout(3000) }),
    fetch("https://whitedotindia.in/robots.txt", { signal: AbortSignal.timeout(3000) }),
  ]);

  const mem = process.memoryUsage();
  res.json({ success: true, data: {
    backend: { ok: true, uptimeSec: Math.floor(process.uptime()), node: process.version, memoryMb: Math.round(mem.rss / 1_048_576), env: env.NODE_ENV },
    database: { ok: dbOk, latencyMs: dbLatency },
    site: { ok: site?.ok ?? false, status: site?.status ?? 0, latencyMs: Date.now() - t0, url: "https://whitedotindia.in" },
    seoFiles: {
      sitemap: sitemapResult.status === "fulfilled" && sitemapResult.value.ok,
      robots: robotsResult.status === "fulfilled" && robotsResult.value.ok,
    },
    services: { smtp: env.smtpConfigured, llm: env.llmConfigured, googleAnalytics: false },
    checkedAt: new Date().toISOString(),
  }});
}));

// ─── SEO Audit ────────────────────────────────────────────────────────

router.get("/seo/audit", asyncHandler(async (_req, res) => {
  const url = "https://whitedotindia.in";
  const t0 = Date.now();
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const fetchMs = Date.now() - t0;
  const html = resp ? await resp.text().catch(() => "") : "";

  const checks = [
    { name: "Site reachable", pass: resp?.ok ?? false, detail: resp ? `HTTP ${resp.status}` : "Fetch failed", weight: 20 },
    { name: "Title tag", pass: /<title>[^<]+<\/title>/i.test(html), detail: html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "Missing", weight: 15 },
    { name: "Meta description", pass: /meta[^>]+name=["']description["'][^>]+content=["'][^"']{50,}/i.test(html), detail: "≥50 chars", weight: 15 },
    { name: "OG tags", pass: /og:title/i.test(html), detail: html.includes("og:title") ? "Present" : "Missing", weight: 10 },
    { name: "Canonical URL", pass: /rel=["']canonical["']/i.test(html), detail: html.includes("canonical") ? "Present" : "Missing", weight: 10 },
    { name: "Sitemap", pass: false, detail: "Check /sitemap.xml separately", weight: 10 },
    { name: "Robots.txt", pass: false, detail: "Check /robots.txt separately", weight: 10 },
    { name: "Fast response (<2s)", pass: fetchMs < 2000, detail: `${fetchMs}ms`, weight: 10 },
  ];
  const score = Math.round(checks.filter(c => c.pass).reduce((s, c) => s + c.weight, 0));
  res.json({ success: true, data: { url, status: resp?.status ?? 0, fetchMs, score, checks, auditedAt: new Date().toISOString() } });
}));

// ─── DevOps Runs ──────────────────────────────────────────────────────

router.get("/devops/runs", asyncHandler(async (_req, res) => {
  const repo = env.GITHUB_REPO;
  if (!env.GITHUB_TOKEN) {
    res.json({ success: true, data: { repo, runs: [] } });
    return;
  }
  const ghResp = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=10`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!ghResp?.ok) {
    res.json({ success: true, data: { repo, runs: [] } });
    return;
  }
  const json = await ghResp.json() as { workflow_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; head_branch: string; head_sha: string; event: string; created_at: string; html_url: string }> };
  const runs = (json.workflow_runs ?? []).map(r => ({
    id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
    branch: r.head_branch, sha: r.head_sha.slice(0, 7), event: r.event,
    createdAt: r.created_at, url: r.html_url,
  }));
  res.json({ success: true, data: { repo, runs } });
}));

// ─── Backup Stats ─────────────────────────────────────────────────────

router.get("/backup/stats", asyncHandler(async (_req, res) => {
  const [users, companies, inquiries, quotes, samples, calculators, followUps, documents, approvals, workflows, incidents] = await Promise.all([
    prisma.user.count(),
    prisma.company.count(),
    prisma.inquiry.count(),
    prisma.quoteRequest.count(),
    prisma.sampleRequest.count(),
    prisma.calculatorSubmission.count(),
    prisma.followUpTask.count(),
    prisma.documentAsset.count(),
    prisma.approval.count(),
    prisma.workflow.count(),
    prisma.incident.count(),
  ]);
  const tables = { users, companies, inquiries, quotes, samples, calculators, followUps, documents, approvals, workflows, incidents };
  const totalRows = Object.values(tables).reduce((a, b) => a + b, 0);
  res.json({ success: true, data: { tables, totalRows, note: "Row counts only — no data exported." } });
}));

// ─── Generic Resource CRUD ────────────────────────────────────────────

const RESOURCE_MAP: Record<string, { list: () => Promise<unknown[]>; create?: (body: unknown) => Promise<unknown>; patch?: (id: string, body: unknown) => Promise<unknown>; del?: (id: string) => Promise<unknown> }> = {
  "quote-requests": {
    list: () => prisma.quoteRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    patch: (id, body) => prisma.quoteRequest.update({ where: { id }, data: body as never }),
  },
  "sample-requests": {
    list: () => prisma.sampleRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    patch: (id, body) => prisma.sampleRequest.update({ where: { id }, data: body as never }),
  },
  "calculator-submissions": {
    list: () => prisma.calculatorSubmission.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  },
  "follow-ups": {
    list: () => prisma.followUpTask.findMany({ orderBy: { dueDate: "asc" }, take: 100 }),
    patch: (id, body) => prisma.followUpTask.update({ where: { id }, data: body as never }),
  },
  "agent-runs": {
    list: () => prisma.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  },
  "security-events": {
    list: () => prisma.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  },
};

router.get("/r/:resource", asyncHandler(async (req, res) => {
  const p = req.params as Record<string, string>;
  const handler = RESOURCE_MAP[p.resource];
  if (!handler) { res.status(404).json({ success: false, error: { code: "NOT_FOUND" } }); return; }
  const data = await handler.list();
  res.json({ success: true, data });
}));

router.post("/r/:resource", asyncHandler(async (req, res) => {
  const p = req.params as Record<string, string>;
  const handler = RESOURCE_MAP[p.resource];
  if (!handler?.create) { res.status(404).json({ success: false, error: { code: "NOT_FOUND" } }); return; }
  const data = await handler.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.patch("/r/:resource/:id", asyncHandler(async (req, res) => {
  const p = req.params as Record<string, string>;
  const handler = RESOURCE_MAP[p.resource];
  if (!handler?.patch) { res.status(404).json({ success: false, error: { code: "NOT_FOUND" } }); return; }
  const data = await handler.patch(p.id, req.body);
  res.json({ success: true, data });
}));

router.delete("/r/:resource/:id", asyncHandler(async (req, res) => {
  const p = req.params as Record<string, string>;
  const handler = RESOURCE_MAP[p.resource];
  if (!handler?.del) { res.status(404).json({ success: false, error: { code: "NOT_FOUND" } }); return; }
  await handler.del(p.id);
  res.json({ success: true, data: null });
}));

export default router;
