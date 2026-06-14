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

// ─── Agent System Prompts (specialization per agent) ─────────────────

const AGENT_SYSTEMS: Record<string, { system: string; model: string; maxTokens: number }> = {
  "lead-qualifier": {
    system: `You are an expert B2B lead qualification agent for White Dot LLP, authorized marketers of LIMEX material in western India (Gujarat, Rajasthan, Goa, Daman, Diu). LIMEX is a Japanese limestone-based sustainable alternative to plastic and paper — 50-80% less plastic, lower CO2. Score leads 1-100, identify buying signals, recommend next action. Be data-driven and concise.`,
    model: "gpt-4o",
    maxTokens: 2048,
  },
  "content-writer": {
    system: `You are a premium content writer for White Dot LLP / LIMEX sustainable materials. Write in a dark, premium, Apple-level clarity tone. Target audience: FMCG, packaging, manufacturing decision-makers in India. Always emphasize: sustainability, cost savings, Japanese innovation, recyclability. No fluff, no jargon.`,
    model: "gpt-4o",
    maxTokens: 4096,
  },
  "data-analyst": {
    system: `You are a business intelligence analyst for White Dot LLP CRM. Analyze lead data, conversion funnels, industry trends. Return structured insights with numbers, percentages, and actionable recommendations. Format as bullet points.`,
    model: "gpt-4o",
    maxTokens: 2048,
  },
  "sales-coach": {
    system: `You are an expert sales coach for B2B sustainable materials. Help sales reps craft responses, handle objections about LIMEX vs traditional plastics, prepare for meetings. Key differentiators: 50-80% less plastic, limestone-based, Japanese tech (TBM Co.), recyclable, cost-competitive at scale. Be direct, give scripts they can use verbatim.`,
    model: "gpt-4o",
    maxTokens: 2048,
  },
  "seo-optimizer": {
    system: `You are an SEO specialist for whitedotindia.in. Analyze content, suggest meta tags, keywords, internal linking, schema markup. Focus on: LIMEX material, sustainable packaging India, plastic alternatives, limestone material. Return actionable recommendations with exact copy to use.`,
    model: "gpt-4o-mini",
    maxTokens: 2048,
  },
  "operations-planner": {
    system: `You are an operations planning agent for a materials distribution company. Help plan logistics, follow-ups, sample dispatches, meeting schedules, and client onboarding workflows. Be specific with timelines and action items.`,
    model: "gpt-4o-mini",
    maxTokens: 1024,
  },
};

const DEFAULT_AGENT = { system: "You are a helpful business assistant for White Dot LLP, a LIMEX sustainable material company in India.", model: "gpt-4o-mini", maxTokens: 1024 };

// ─── n8n helper ──────────────────────────────────────────────────────

type N8nResponse = { output?: string; model?: string; inputTokens?: number; outputTokens?: number; steps?: string[] };

async function callN8n(path: string, payload: Record<string, unknown>): Promise<N8nResponse> {
  const resp = await fetch(`${env.N8N_WEBHOOK_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`n8n ${path} failed: ${resp.status}`);
  return resp.json() as Promise<N8nResponse>;
}

// ─── Agent Run (enriched) ────────────────────────────────────────────

router.post("/ai-agents/:id/run", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "N8N_WEBHOOK_URL not set" } });
    return;
  }
  const { id } = req.params as Record<string, string>;
  const { input, context, history } = req.body as { input: string; context?: string; history?: { role: string; content: string }[] };
  if (!input?.trim()) {
    res.status(400).json({ success: false, error: { code: "MISSING_INPUT", message: "input is required" } });
    return;
  }

  const agentConfig = AGENT_SYSTEMS[id] ?? DEFAULT_AGENT;

  // Enrich: pull last 5 runs for this agent as conversation memory
  const recentRuns = await prisma.agentRun.findMany({
    where: { agentId: id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { input: true, output: true },
  });
  const memoryContext = recentRuns.length
    ? `\n\nPrevious conversation (most recent first):\n${recentRuns.map((r, i) => `[${i + 1}] User: ${r.input.slice(0, 200)}\nAssistant: ${r.output.slice(0, 300)}`).join("\n")}`
    : "";

  // Enrich: pull live CRM stats for data-analyst agent
  let crmContext = "";
  if (id === "data-analyst") {
    const [inquiryCount, quoteCount, sampleCount] = await Promise.all([
      prisma.inquiry.count(),
      prisma.quoteRequest.count(),
      prisma.sampleRequest.count(),
    ]);
    crmContext = `\n\nLive CRM: ${inquiryCount} inquiries, ${quoteCount} quotes, ${sampleCount} sample requests.`;
  }

  const fullPrompt = context ? `Context:\n${context}${memoryContext}${crmContext}\n\nTask:\n${input}` : `${input}${memoryContext}${crmContext}`;

  try {
    const llm = await callN8n("/agent-run", {
      agentId: id,
      system: agentConfig.system,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      prompt: fullPrompt,
      history: history ?? [],
    });

    const output = llm.output ?? "";
    const run = await prisma.agentRun.create({
      data: { agentId: id, input, output, model: llm.model ?? agentConfig.model, inputTokens: llm.inputTokens ?? 0, outputTokens: llm.outputTokens ?? 0, costUsd: 0 },
    });
    res.json({ success: true, data: { runId: run.id, agentId: id, output, model: run.model, steps: llm.steps, inputTokens: llm.inputTokens ?? 0, outputTokens: llm.outputTokens ?? 0, createdAt: run.createdAt } });
  } catch {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "n8n agent call failed" } });
  }
}));

// ─── Agent Batch Run ─────────────────────────────────────────────────

router.post("/ai-agents/batch", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "N8N_WEBHOOK_URL not set" } });
    return;
  }
  const { tasks } = req.body as { tasks: { agentId: string; input: string; context?: string }[] };
  if (!tasks?.length || tasks.length > 10) {
    res.status(400).json({ success: false, error: { code: "INVALID_BATCH", message: "1-10 tasks required" } });
    return;
  }

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const agentConfig = AGENT_SYSTEMS[task.agentId] ?? DEFAULT_AGENT;
      const llm = await callN8n("/agent-run", {
        agentId: task.agentId,
        system: agentConfig.system,
        model: agentConfig.model,
        maxTokens: agentConfig.maxTokens,
        prompt: task.context ? `Context:\n${task.context}\n\nTask:\n${task.input}` : task.input,
        history: [],
      });
      const run = await prisma.agentRun.create({
        data: { agentId: task.agentId, input: task.input, output: llm.output ?? "", model: llm.model ?? agentConfig.model, inputTokens: llm.inputTokens ?? 0, outputTokens: llm.outputTokens ?? 0, costUsd: 0 },
      });
      return { runId: run.id, agentId: task.agentId, output: llm.output ?? "", model: run.model };
    })
  );

  const data = results.map((r, i) => r.status === "fulfilled" ? r.value : { agentId: tasks[i].agentId, error: "failed" });
  res.json({ success: true, data });
}));

// ─── AI Tools (enriched) ─────────────────────────────────────────────

const TOOL_CONFIGS: Record<string, { system: string; model: string }> = {
  "lead-scorer": { system: "Score this B2B lead 1-100 for LIMEX material potential. Consider: industry fit, company size, sustainability commitment, geographic match (western India preferred). Return JSON: { score, reasons[], nextAction }.", model: "gpt-4o" },
  "email-writer": { system: "Write a professional B2B email for LIMEX sustainable material. Premium tone, concise, focused on value. Include subject line.", model: "gpt-4o" },
  "competitor-analyzer": { system: "Analyze competitive positioning for LIMEX vs traditional plastics/paper. Focus on: cost, sustainability, durability, regulatory advantage.", model: "gpt-4o" },
  "meeting-prep": { system: "Prepare a meeting brief for a LIMEX material sales call. Include: talking points, objection handlers, relevant case studies to reference, questions to ask.", model: "gpt-4o" },
  "report-generator": { system: "Generate a structured business report. Use headers, bullet points, data tables where relevant. Be analytical and actionable.", model: "gpt-4o" },
  "whatsapp-drafter": { system: "Write a WhatsApp business message. Under 300 chars, warm but professional, include a clear CTA.", model: "gpt-4o-mini" },
  "proposal-writer": { system: "Write a professional proposal section for LIMEX material supply. Highlight: sustainability metrics, cost comparison, delivery capability, quality assurance.", model: "gpt-4o" },
  "social-media": { system: "Write social media content for White Dot LLP / LIMEX. Platform-native format, sustainability angle, engaging hooks. Include hashtag suggestions.", model: "gpt-4o-mini" },
};

router.post("/ai/tool", asyncHandler(async (req, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "N8N_WEBHOOK_URL not set" } });
    return;
  }
  const { tool, inputs } = req.body as { tool: string; inputs: Record<string, string> };
  const toolConfig = TOOL_CONFIGS[tool];
  const system = toolConfig?.system ?? `You are a business AI tool. Tool: "${tool}". Provide a concise, professional response.`;
  const model = toolConfig?.model ?? "gpt-4o-mini";
  const prompt = Object.entries(inputs).map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const llm = await callN8n("/ai-tool", { tool, system, model, prompt });
    const output = llm.output ?? "";
    const runId = `tool-${Date.now()}`;
    res.json({ success: true, data: { runId, tool, output, model: llm.model ?? model, inputTokens: llm.inputTokens ?? 0, outputTokens: llm.outputTokens ?? 0, createdAt: new Date().toISOString() } });
  } catch {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "AI tool call failed" } });
  }
}));

// ─── AI Draft (enriched with lead history) ───────────────────────────

router.post("/ai-draft", asyncHandler(async (req: Request & { user?: { id: string } }, res) => {
  const { kind, lead } = req.body as {
    kind: "followup_email" | "followup_whatsapp" | "proposal_intro" | "reactivation" | "cold_outreach" | "thank_you" | "objection_handler";
    lead: { name: string; company?: string; status?: string; industry?: string; product?: string; notes?: string; email?: string };
  };
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "N8N_WEBHOOK_URL not set" } });
    return;
  }

  // Enrich: pull inquiry history for this lead if email given
  let leadHistory = "";
  if (lead.email) {
    const inquiries = await prisma.inquiry.findMany({
      where: { email: lead.email },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { status: true, message: true, createdAt: true, industry: true },
    });
    if (inquiries.length) {
      leadHistory = `\n\nLead history (${inquiries.length} interactions):\n${inquiries.map(i => `- ${i.createdAt.toISOString().slice(0, 10)}: status=${i.status}, industry=${i.industry ?? "N/A"}, msg="${(i.message ?? "").slice(0, 100)}"`).join("\n")}`;
    }
  }

  const prompts: Record<string, string> = {
    followup_email: `Write a professional follow-up email for lead: ${lead.name} from ${lead.company ?? "unknown company"}, industry: ${lead.industry ?? "N/A"}, status: ${lead.status ?? "N/A"}. Product: LIMEX sustainable material. Keep it warm, brief, 3 paragraphs. Include subject line.${leadHistory}`,
    followup_whatsapp: `Write a WhatsApp follow-up message (under 200 chars) for ${lead.name} from ${lead.company ?? ""}. LIMEX material enquiry. Friendly, professional.${leadHistory}`,
    proposal_intro: `Write a proposal introduction paragraph for ${lead.name}, ${lead.company ?? ""}, ${lead.industry ?? ""} interested in LIMEX material. Highlight sustainability + cost savings.${leadHistory}`,
    reactivation: `Write a reactivation outreach for ${lead.name} from ${lead.company ?? ""} who went cold. LIMEX material. Reference their previous interest in ${lead.product ?? "LIMEX"}. Max 3 sentences.${leadHistory}`,
    cold_outreach: `Write a cold outreach email for ${lead.name} at ${lead.company ?? ""} in ${lead.industry ?? "manufacturing"}. Introduce LIMEX as a sustainable alternative to plastic/paper. Concise, value-first, include subject line. End with a soft CTA (meeting/sample).`,
    thank_you: `Write a thank-you follow-up for ${lead.name} from ${lead.company ?? ""} after a meeting/call about LIMEX material. Reference their interest in ${lead.product ?? "LIMEX products"}. Brief, professional, include next steps.${leadHistory}`,
    objection_handler: `The lead ${lead.name} from ${lead.company ?? ""} raised concerns. Their notes: "${lead.notes ?? "price concerns"}". Write a response addressing their objections about LIMEX material. Use data: 50-80% less plastic, competitive pricing at scale, Japanese quality (TBM Co.), fully recyclable. Be empathetic but confident.${leadHistory}`,
  };

  const prompt = prompts[kind] ?? prompts.followup_email;

  try {
    const llm = await callN8n("/ai-draft", { kind, prompt, model: "gpt-4o", system: "You are a premium B2B sales writer for White Dot LLP / LIMEX sustainable material. Write in a professional, warm tone that reflects Japanese precision and Indian warmth." });
    const preview = llm.output ?? "";

    const risk = kind === "cold_outreach" ? "MEDIUM" as const : "LOW" as const;
    const approval = await prisma.approval.create({
      data: {
        title: `AI Draft: ${kind} for ${lead.name}`,
        kind,
        risk,
        preview,
        ...(req.user?.id && { createdById: req.user.id }),
      },
      include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
    });
    res.json({ success: true, data: approval });
  } catch {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "Draft generation failed" } });
  }
}));

// ─── AI Chain (multi-step reasoning) ─────────────────────────────────

router.post("/ai/chain", asyncHandler(async (req, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "N8N_WEBHOOK_URL not set" } });
    return;
  }
  const { steps } = req.body as { steps: { agent: string; input: string }[] };
  if (!steps?.length || steps.length > 5) {
    res.status(400).json({ success: false, error: { code: "INVALID_CHAIN", message: "1-5 steps required" } });
    return;
  }

  const results: { agent: string; output: string }[] = [];
  let prevOutput = "";

  for (const step of steps) {
    const agentConfig = AGENT_SYSTEMS[step.agent] ?? DEFAULT_AGENT;
    const enrichedInput = prevOutput ? `Previous step output:\n${prevOutput}\n\nNew task:\n${step.input}` : step.input;
    const llm = await callN8n("/agent-run", {
      agentId: step.agent,
      system: agentConfig.system,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      prompt: enrichedInput,
      history: [],
    });
    prevOutput = llm.output ?? "";
    results.push({ agent: step.agent, output: prevOutput });
  }

  res.json({ success: true, data: { results, finalOutput: prevOutput } });
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
