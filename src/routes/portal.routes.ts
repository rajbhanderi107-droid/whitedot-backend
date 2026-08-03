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
    system: `You are an expert B2B lead qualification agent for White Dot, authorized marketers of LIMEX material in western India (Gujarat, Rajasthan, Goa, Daman, Diu). LIMEX is a limestone-based sustainable alternative to plastic and paper — 50-80% less plastic, lower CO2. Score leads 1-100, identify buying signals, recommend next action. Be data-driven and concise.`,
    model: "gemma-3-27b-it",
    maxTokens: 2048,
  },
  "content-writer": {
    system: `You are a premium content writer for White Dot / LIMEX sustainable materials. Write in a dark, premium, Apple-level clarity tone. Target audience: FMCG, packaging, manufacturing decision-makers in India. Always emphasize: sustainability, cost savings, material innovation, recyclability. No fluff, no jargon.`,
    model: "gemma-3-27b-it",
    maxTokens: 4096,
  },
  "data-analyst": {
    system: `You are a business intelligence analyst for White Dot CRM. Analyze lead data, conversion funnels, industry trends. Return structured insights with numbers, percentages, and actionable recommendations. Format as bullet points.`,
    model: "gemma-3-27b-it",
    maxTokens: 2048,
  },
  "sales-coach": {
    system: `You are an expert sales coach for B2B sustainable materials. Help sales reps craft responses, handle objections about LIMEX vs traditional plastics, prepare for meetings. Key differentiators: 50-80% less plastic, limestone-based, TBM material tech, recyclable, cost-competitive at scale. Be direct, give scripts they can use verbatim.`,
    model: "gemma-3-27b-it",
    maxTokens: 2048,
  },
  "seo-optimizer": {
    system: `You are an SEO specialist for whitedotindia.in. Analyze content, suggest meta tags, keywords, internal linking, schema markup. Focus on: LIMEX material, sustainable packaging India, plastic alternatives, limestone material. Return actionable recommendations with exact copy to use.`,
    model: "gemma-3n-e4b-it",
    maxTokens: 2048,
  },
  "operations-planner": {
    system: `You are an operations planning agent for a materials distribution company. Help plan logistics, follow-ups, sample dispatches, meeting schedules, and client onboarding workflows. Be specific with timelines and action items.`,
    model: "gemma-3n-e4b-it",
    maxTokens: 1024,
  },
};

const DEFAULT_AGENT = { system: "You are a helpful business assistant for White Dot, a LIMEX sustainable material company in India.", model: "gemma-3n-e4b-it", maxTokens: 1024 };

// ─── Google Gemma helper (Google AI Studio) ───────────────────────────

type LlmResult = { output: string; model: string; inputTokens: number; outputTokens: number };

async function callGemma(opts: { system: string; prompt: string; model: string; maxTokens: number; temperature?: number }): Promise<LlmResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${env.GOOGLE_AI_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens, temperature: opts.temperature ?? 0.7 },
    }),
  });
  if (!resp.ok) {
    const e = await resp.text().catch(() => "");
    throw new Error(`Gemma ${resp.status}: ${e.slice(0, 200)}`);
  }
  const j = (await resp.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };
  return {
    output: j.candidates[0]?.content?.parts[0]?.text ?? "",
    model: opts.model,
    inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// ─── Agent Run (enriched) ────────────────────────────────────────────

router.post("/ai-agents/:id/run", asyncHandler(async (req: Request, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "GOOGLE_AI_KEY not set" } });
    return;
  }
  const { id } = req.params as Record<string, string>;
  const { input, context } = req.body as { input: string; context?: string };
  if (!input?.trim()) {
    res.status(400).json({ success: false, error: { code: "MISSING_INPUT", message: "input is required" } });
    return;
  }
  if (input.length > 10_000) {
    res.status(400).json({ success: false, error: { code: "INPUT_TOO_LONG", message: "input must be under 10,000 characters" } });
    return;
  }
  if (context && context.length > 20_000) {
    res.status(400).json({ success: false, error: { code: "CONTEXT_TOO_LONG", message: "context must be under 20,000 characters" } });
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
    const llm = await callGemma({
      system: agentConfig.system,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      prompt: fullPrompt,
    });

    const output = llm.output;
    const run = await prisma.agentRun.create({
      data: { agentId: id, input, output, model: llm.model || agentConfig.model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, costUsd: 0 },
    });
    res.json({ success: true, data: { runId: run.id, agentId: id, output, model: run.model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, createdAt: run.createdAt } });
  } catch {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "Gemma call failed" } });
  }
}));

// ─── Agent Batch Run ─────────────────────────────────────────────────

router.post("/ai-agents/batch", asyncHandler(async (req: Request, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "GOOGLE_AI_KEY not set" } });
    return;
  }
  const { tasks } = req.body as { tasks: { agentId: string; input: string; context?: string }[] };
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 10) {
    res.status(400).json({ success: false, error: { code: "INVALID_BATCH", message: "1-10 tasks required" } });
    return;
  }
  for (const task of tasks) {
    if (!task.input || typeof task.input !== "string" || task.input.length > 10_000) {
      res.status(400).json({ success: false, error: { code: "INVALID_TASK_INPUT", message: "Each task input must be a non-empty string under 10,000 characters" } });
      return;
    }
    if (task.context && (typeof task.context !== "string" || task.context.length > 20_000)) {
      res.status(400).json({ success: false, error: { code: "INVALID_TASK_CONTEXT", message: "Each task context must be a string under 20,000 characters" } });
      return;
    }
  }

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const agentConfig = AGENT_SYSTEMS[task.agentId] ?? DEFAULT_AGENT;
      const llm = await callGemma({
        system: agentConfig.system,
        model: agentConfig.model,
        maxTokens: agentConfig.maxTokens,
        prompt: task.context ? `Context:\n${task.context}\n\nTask:\n${task.input}` : task.input,
      });
      const run = await prisma.agentRun.create({
        data: { agentId: task.agentId, input: task.input, output: llm.output, model: llm.model || agentConfig.model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, costUsd: 0 },
      });
      return { runId: run.id, agentId: task.agentId, output: llm.output, model: run.model };
    })
  );

  const data = results.map((r, i) => r.status === "fulfilled" ? r.value : { agentId: tasks[i].agentId, error: "failed" });
  res.json({ success: true, data });
}));

// ─── AI Tools (enriched) ─────────────────────────────────────────────

const TOOL_CONFIGS: Record<string, { system: string; model: string }> = {
  "lead-scorer": { system: "Score this B2B lead 1-100 for LIMEX material potential. Consider: industry fit, company size, sustainability commitment, geographic match (western India preferred). Return JSON: { score, reasons[], nextAction }.", model: "gemma-3-27b-it" },
  "email-writer": { system: "Write a professional B2B email for LIMEX sustainable material. Premium tone, concise, focused on value. Include subject line.", model: "gemma-3-27b-it" },
  "competitor-analyzer": { system: "Analyze competitive positioning for LIMEX vs traditional plastics/paper. Focus on: cost, sustainability, durability, regulatory advantage.", model: "gemma-3-27b-it" },
  "meeting-prep": { system: "Prepare a meeting brief for a LIMEX material sales call. Include: talking points, objection handlers, relevant case studies to reference, questions to ask.", model: "gemma-3-27b-it" },
  "report-generator": { system: "Generate a structured business report. Use headers, bullet points, data tables where relevant. Be analytical and actionable.", model: "gemma-3-27b-it" },
  "whatsapp-drafter": { system: "Write a WhatsApp business message. Under 300 chars, warm but professional, include a clear CTA.", model: "gemma-3n-e4b-it" },
  "proposal-writer": { system: "Write a professional proposal section for LIMEX material supply. Highlight: sustainability metrics, cost comparison, delivery capability, quality assurance.", model: "gemma-3-27b-it" },
  "social-media": { system: "Write social media content for White Dot / LIMEX. Platform-native format, sustainability angle, engaging hooks. Include hashtag suggestions.", model: "gemma-3n-e4b-it" },
};

router.post("/ai/tool", asyncHandler(async (req, res) => {
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "GOOGLE_AI_KEY not set" } });
    return;
  }
  const { tool, inputs } = req.body as { tool: string; inputs: Record<string, string> };
  if (!tool || typeof tool !== "string" || tool.length > 100) {
    res.status(400).json({ success: false, error: { code: "INVALID_TOOL", message: "tool must be a string under 100 chars" } });
    return;
  }
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    res.status(400).json({ success: false, error: { code: "INVALID_INPUTS", message: "inputs must be an object" } });
    return;
  }
  const toolConfig = TOOL_CONFIGS[tool];
  const system = toolConfig?.system ?? `You are a business AI tool. Tool: "${tool}". Provide a concise, professional response.`;
  const model = toolConfig?.model ?? "gemma-3n-e4b-it";
  const prompt = Object.entries(inputs).map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const llm = await callGemma({ system, model, maxTokens: 2048, prompt });
    const runId = `tool-${Date.now()}`;
    res.json({ success: true, data: { runId, tool, output: llm.output, model: llm.model || model, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, createdAt: new Date().toISOString() } });
  } catch {
    res.status(502).json({ success: false, error: { code: "LLM_ERROR", message: "Gemma tool call failed" } });
  }
}));

// ─── AI Draft (enriched with lead history) ───────────────────────────

router.post("/ai-draft", asyncHandler(async (req: Request, res) => {
  const { kind, lead } = req.body as {
    kind: "followup_email" | "followup_whatsapp" | "proposal_intro" | "reactivation" | "cold_outreach" | "thank_you" | "objection_handler";
    lead: { name: string; company?: string; status?: string; industry?: string; product?: string; notes?: string; email?: string };
  };
  if (!env.llmConfigured) {
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "GOOGLE_AI_KEY not set" } });
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
    objection_handler: `The lead ${lead.name} from ${lead.company ?? ""} raised concerns. Their notes: "${lead.notes ?? "price concerns"}". Write a response addressing their objections about LIMEX material. Use data: 50-80% less plastic, competitive pricing at scale, TBM-grade quality, fully recyclable. Be empathetic but confident.${leadHistory}`,
  };

  const prompt = prompts[kind] ?? prompts.followup_email;

  try {
    const llm = await callGemma({ prompt, model: "gemma-3-27b-it", maxTokens: 1024, temperature: 0.8, system: "You are a premium B2B sales writer for White Dot / LIMEX sustainable material. Write in a professional, warm tone that reflects engineering precision and Indian warmth." });
    const preview = llm.output;

    const risk = kind === "cold_outreach" ? "MEDIUM" as const : "LOW" as const;
    const approval = await prisma.approval.create({
      data: {
        title: `AI Draft: ${kind} for ${lead.name}`,
        kind,
        risk,
        preview,
        ...(req.currentUser?.id && { createdById: req.currentUser.id }),
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
    res.status(503).json({ success: false, error: { code: "LLM_NOT_CONFIGURED", message: "GOOGLE_AI_KEY not set" } });
    return;
  }
  const { steps } = req.body as { steps: { agent: string; input: string }[] };
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 5) {
    res.status(400).json({ success: false, error: { code: "INVALID_CHAIN", message: "1-5 steps required" } });
    return;
  }
  for (const step of steps) {
    if (!step.input || typeof step.input !== "string" || step.input.length > 10_000) {
      res.status(400).json({ success: false, error: { code: "INVALID_STEP_INPUT", message: "Each step input must be a non-empty string under 10,000 characters" } });
      return;
    }
  }

  const results: { agent: string; output: string }[] = [];
  let prevOutput = "";

  for (const step of steps) {
    const agentConfig = AGENT_SYSTEMS[step.agent] ?? DEFAULT_AGENT;
    const enrichedInput = prevOutput ? `Previous step output:\n${prevOutput}\n\nNew task:\n${step.input}` : step.input;
    const llm = await callGemma({
      system: agentConfig.system,
      model: agentConfig.model,
      maxTokens: agentConfig.maxTokens,
      prompt: enrichedInput,
    });
    prevOutput = llm.output;
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

router.post("/approvals", asyncHandler(async (req: Request, res) => {
  const { title, kind, automationId, risk, preview } = req.body as {
    title: string; kind: string; automationId?: string; risk?: ApprovalRisk; preview: string;
  };
  const row = await prisma.approval.create({
    data: { title, kind, automationId, risk: risk ?? "LOW", preview, ...(req.currentUser?.id && { createdById: req.currentUser.id }) },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.status(201).json({ success: true, data: row });
}));

router.post("/approvals/:id/decide", asyncHandler(async (req: Request, res) => {
  const { id } = req.params as Record<string, string>;
  const { decision } = req.body as { decision: "APPROVED" | "REJECTED" };
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    res.status(400).json({ success: false, error: { code: "INVALID_DECISION", message: "decision must be APPROVED or REJECTED" } });
    return;
  }
  const row = await prisma.approval.update({
    where: { id },
    data: { status: decision, decidedAt: new Date(), ...(req.currentUser?.id && { decidedById: req.currentUser.id }) },
    include: { createdBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  res.json({ success: true, data: row });
}));

// ─── Workflows ────────────────────────────────────────────────────────

router.get("/workflows", asyncHandler(async (_req, res) => {
  const rows = await prisma.workflow.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data: rows });
}));

router.post("/workflows", asyncHandler(async (req: Request, res) => {
  const { name, trigger, condition, action } = req.body as { name: string; trigger: string; condition: string; action: string };
  if (!name || !trigger || !condition || !action) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name, trigger, condition, action are required" } });
    return;
  }
  const row = await prisma.workflow.create({
    data: { name, trigger, condition, action, ...(req.currentUser?.id && { createdById: req.currentUser.id }) },
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

  const [monthlyLeads, funnelGroups, industryGroups, quoteCount, sampleCount, calcCount, quotationAgg, orderAgg, campaignAgg] = await Promise.all([
    Promise.all(months.map(m => prisma.inquiry.count({ where: { createdAt: { gte: m.start, lt: m.end } } }))),
    prisma.inquiry.groupBy({ by: ["status"], _count: { status: true } }),
    prisma.inquiry.groupBy({ by: ["industry"], _count: { industry: true }, orderBy: { _count: { industry: "desc" } }, take: 5 }),
    prisma.quoteRequest.count(),
    prisma.sampleRequest.count(),
    prisma.calculatorSubmission.count(),
    prisma.quotation.aggregate({ _count: { id: true }, _sum: { total: true } }),
    prisma.order.aggregate({ _count: { id: true }, _sum: { amount: true } }),
    prisma.campaign.aggregate({ _count: { id: true }, _sum: { budget: true, spend: true, leads: true } }),
  ]);

  const funnel: Record<string, number> = {};
  for (const g of funnelGroups) if (g.status) funnel[g.status] = g._count.status;

  res.json({ success: true, data: {
    monthlyLeads: months.map((m, i) => ({ key: m.key, label: m.label, count: monthlyLeads[i] })),
    funnel,
    topIndustries: industryGroups.map(g => ({ industry: g.industry ?? "Unknown", count: g._count.industry })),
    totals: {
      quotes: quoteCount, samples: sampleCount, calculators: calcCount,
      quotations: quotationAgg._count.id, quotationValue: quotationAgg._sum.total ?? 0,
      orders: orderAgg._count.id, orderValue: orderAgg._sum.amount ?? 0,
      campaigns: campaignAgg._count.id, campaignBudget: campaignAgg._sum.budget ?? 0,
      campaignSpend: campaignAgg._sum.spend ?? 0, campaignLeads: campaignAgg._sum.leads ?? 0,
    },
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

type ResourceHandler = {
  list: (q?: Record<string, string>) => Promise<unknown[]>;
  create?: (body: unknown) => Promise<unknown>;
  patch?: (id: string, body: unknown) => Promise<unknown>;
  del?: (id: string) => Promise<unknown>;
};

const RESOURCE_MAP: Record<string, ResourceHandler> = {
  "quote-requests": {
    list: () => prisma.quoteRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["status", "priority", "assignedToId", "companyId", "message", "contactPerson", "email", "phone", "productCategory", "currentMaterial", "currentPlasticGrade", "monthlyQuantity", "targetApplication", "strengthRequirement", "foodContactRequired", "colorRequirement", "sustainabilityGoal", "expectedPriceRange"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      return prisma.quoteRequest.update({ where: { id }, data });
    },
  },
  "sample-requests": {
    list: () => prisma.sampleRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["status", "remarks", "companyId", "contactPerson", "email", "phone", "requestedMaterialType", "application", "quantity", "deliveryAddress", "courierTracking"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      return prisma.sampleRequest.update({ where: { id }, data });
    },
  },
  "calculator-submissions": {
    list: () => prisma.calculatorSubmission.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  },
  "follow-ups": {
    list: () => prisma.followUpTask.findMany({ orderBy: { dueDate: "asc" }, take: 100 }),
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["title", "description", "dueDate", "status", "assignedToId", "companyId", "inquiryId", "quoteRequestId", "sampleRequestId"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      return prisma.followUpTask.update({ where: { id }, data });
    },
  },
  "agent-runs": {
    list: () => prisma.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  },
  "security-events": {
    list: () => prisma.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  },

  // ─── Business modules ────────────────────────────────────
  "quotations": {
    list: () => prisma.quotation.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.quotation.create({ data: {
        number: b.number as string | undefined,
        customer: String(b.customer ?? ""),
        subtotal: Number(b.subtotal ?? 0),
        gstPct: Number(b.gstPct ?? 18),
        transport: Number(b.transport ?? 0),
        discount: Number(b.discount ?? 0),
        total: Number(b.total ?? 0),
        validUntil: b.validUntil ? new Date(String(b.validUntil)) : undefined,
        notes: b.notes as string | undefined,
        status: String(b.status ?? "DRAFT"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["number", "customer", "subtotal", "gstPct", "transport", "discount", "total", "validUntil", "notes", "status"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      if (b.validUntil) data.validUntil = new Date(String(b.validUntil));
      if (b.subtotal !== undefined) data.subtotal = Number(b.subtotal);
      if (b.gstPct !== undefined) data.gstPct = Number(b.gstPct);
      if (b.transport !== undefined) data.transport = Number(b.transport);
      if (b.discount !== undefined) data.discount = Number(b.discount);
      if (b.total !== undefined) data.total = Number(b.total);
      return prisma.quotation.update({ where: { id }, data: data as never });
    },
    del: (id) => prisma.quotation.delete({ where: { id } }),
  },

  "orders": {
    list: () => prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.order.create({ data: {
        customer: String(b.customer ?? ""),
        quotationRef: b.quotationId as string | undefined ?? b.quotationRef as string | undefined,
        amount: Number(b.amount ?? 0),
        invoiceNumber: b.invoiceNumber as string | undefined,
        paymentStatus: String(b.paymentStatus ?? "UNPAID"),
        status: String(b.status ?? "CREATED"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["customer", "quotationRef", "quotationId", "amount", "invoiceNumber", "paymentStatus", "status"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      if (b.amount !== undefined) data.amount = Number(b.amount);
      if (b.quotationId !== undefined) { data.quotationRef = b.quotationId; delete data.quotationId; }
      return prisma.order.update({ where: { id }, data: data as never });
    },
    del: (id) => prisma.order.delete({ where: { id } }),
  },

  "campaigns": {
    list: () => prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.campaign.create({ data: {
        name: String(b.name ?? ""),
        type: b.type as string | undefined,
        channel: b.channel as string | undefined,
        budget: Number(b.budget ?? 0),
        spend: Number(b.spend ?? 0),
        leads: Number(b.leads ?? 0),
        startDate: b.startDate ? new Date(String(b.startDate)) : undefined,
        endDate: b.endDate ? new Date(String(b.endDate)) : undefined,
        status: String(b.status ?? "DRAFT"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["name", "type", "channel", "budget", "spend", "leads", "startDate", "endDate", "status"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      if (b.startDate) data.startDate = new Date(String(b.startDate));
      if (b.endDate) data.endDate = new Date(String(b.endDate));
      if (b.budget !== undefined) data.budget = Number(b.budget);
      if (b.spend !== undefined) data.spend = Number(b.spend);
      if (b.leads !== undefined) data.leads = Number(b.leads);
      return prisma.campaign.update({ where: { id }, data: data as never });
    },
    del: (id) => prisma.campaign.delete({ where: { id } }),
  },

  "content": {
    list: (q) => prisma.content.findMany({
      where: q?.kind ? { kind: q.kind } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.content.create({ data: {
        title: String(b.title ?? ""),
        kind: String(b.kind ?? "SOCIAL"),
        channel: b.channel as string | undefined,
        body: b.body as string | undefined,
        scheduledFor: b.scheduledFor ? new Date(String(b.scheduledFor)) : undefined,
        status: String(b.status ?? "DRAFT"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["title", "kind", "channel", "body", "scheduledFor", "status"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      if (b.scheduledFor) data.scheduledFor = new Date(String(b.scheduledFor));
      return prisma.content.update({ where: { id }, data: data as never });
    },
    del: (id) => prisma.content.delete({ where: { id } }),
  },

  "products": {
    list: () => prisma.product.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.product.create({ data: {
        name: String(b.name ?? ""),
        code: b.code as string | undefined,
        category: b.category as string | undefined,
        status: String(b.status ?? "DRAFT"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const k of ["name", "code", "category", "status"]) if (b[k] !== undefined) data[k] = b[k];
      return prisma.product.update({ where: { id }, data });
    },
    del: (id) => prisma.product.delete({ where: { id } }),
  },

  "inventory": {
    list: () => prisma.inventoryItem.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.inventoryItem.create({ data: {
        name: String(b.name ?? ""),
        sku: b.sku as string | undefined,
        location: b.location as string | undefined,
        totalStock: Number(b.totalStock ?? 0),
        reservedStock: Number(b.reservedStock ?? 0),
        sampleStock: Number(b.sampleStock ?? 0),
        reorderPoint: Number(b.reorderPoint ?? 0),
        status: String(b.status ?? "ACTIVE"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const allowed = ["name", "sku", "location", "totalStock", "reservedStock", "sampleStock", "reorderPoint", "status"];
      const data: Record<string, unknown> = {};
      for (const k of allowed) if (b[k] !== undefined) data[k] = b[k];
      if (b.totalStock !== undefined) data.totalStock = Number(b.totalStock);
      if (b.reservedStock !== undefined) data.reservedStock = Number(b.reservedStock);
      if (b.sampleStock !== undefined) data.sampleStock = Number(b.sampleStock);
      if (b.reorderPoint !== undefined) data.reorderPoint = Number(b.reorderPoint);
      return prisma.inventoryItem.update({ where: { id }, data: data as never });
    },
    del: (id) => prisma.inventoryItem.delete({ where: { id } }),
  },

  "bugs": {
    list: () => prisma.bug.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    create: (body) => {
      const b = body as Record<string, unknown>;
      return prisma.bug.create({ data: {
        title: String(b.title ?? ""),
        severity: String(b.severity ?? "MEDIUM"),
        source: String(b.source ?? "MANUAL"),
        detail: b.detail as string | undefined,
        status: String(b.status ?? "OPEN"),
      }});
    },
    patch: (id, body) => {
      const b = body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const k of ["title", "severity", "source", "detail", "status"]) if (b[k] !== undefined) data[k] = b[k];
      return prisma.bug.update({ where: { id }, data });
    },
    del: (id) => prisma.bug.delete({ where: { id } }),
  },
};

router.get("/r/:resource", asyncHandler(async (req, res) => {
  const p = req.params as Record<string, string>;
  const handler = RESOURCE_MAP[p.resource];
  if (!handler) { res.status(404).json({ success: false, error: { code: "NOT_FOUND" } }); return; }
  const data = await handler.list(req.query as Record<string, string>);
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
