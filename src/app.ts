import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { requestLogger } from "./middleware/logger.middleware.js";
import { requestTimeout } from "./middleware/timeout.middleware.js";
import { adminLimiter, authLimiter, publicLimiter } from "./middleware/rateLimit.middleware.js";
import {
  blockScanners,
  blockProbes,
  sanitizeBody,
  extraSecurityHeaders,
} from "./middleware/security.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import publicRoutes from "./routes/public.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import portalRoutes from "./routes/portal.routes.js";
import { prisma } from "./config/prisma.js";
import { pruneExpiredTokens } from "./services/tokenBlacklist.service.js";

const app = express();

// ════════════════════════════════════════════════════════════════════
//  SECURITY DOME — 5 LAYERS
// ════════════════════════════════════════════════════════════════════

// ─── Layer 1 + 4: Helmet security headers (hardened) ────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }),
);

// Layer 4: Extra headers not in Helmet defaults
app.use(extraSecurityHeaders);

// ─── Layer 1: Perimeter — block scanners and probes immediately ──────
app.use(blockScanners);
app.use(blockProbes);

// ─── Layer 1: CORS — strict whitelist ───────────────────────────────
const ALLOWED_ORIGINS = [
  env.FRONTEND_URL,
  "https://rajbhanderi107-droid.github.io",
  "https://whitedotindia.in",
  "https://www.whitedotindia.in",
];
if (!env.isProduction) {
  ALLOWED_ORIGINS.push("http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173");
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.some((o) => origin.startsWith(o))) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

// ─── Layer 1: Body limits — 50kb for public, 500kb for admin ────────
// Applied per-route below; global fallback here
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));
app.use(cookieParser());

// ─── Layer 2: Input sanitization on all incoming bodies ─────────────
app.use(sanitizeBody);

// ─── Logging + timeout ───────────────────────────────────────────────
app.use(requestLogger);
app.use(requestTimeout(30_000));

// ════════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════════

app.get("/", (_req, res) => {
  res.json({ service: "White Dot LLP — LIMEX CRM API", status: "ok" });
});

// Layer 4: Health endpoint — no internal data exposed
app.get("/api/health", async (_req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Prune expired revoked tokens opportunistically on each health check
    pruneExpiredTokens().catch(() => {});
    res.json({ status: "ok", latency: `${Date.now() - start}ms` });
  } catch {
    res.status(503).json({ status: "degraded" });
  }
});

// Layer 1+3: Auth routes — body limit 10kb
app.use("/api/auth", express.json({ limit: "10kb" }), authRoutes);

// Layer 1: Public form routes — 30/15min, body limit 50kb
app.use("/api/public", publicLimiter, express.json({ limit: "50kb" }), publicRoutes);

// Layer 1+3: Admin routes — 120/min
app.use("/api", adminLimiter, adminRoutes);

// Portal routes — same auth/rate-limit as admin
app.use("/api/portal", adminLimiter, portalRoutes);

// Layer 5: Unknown route probe detection
app.use("/api/*path", (req, res) => {
  // Fire-and-forget security log for unknown API probes
  prisma.activityLog.create({
    data: {
      action: "SECURITY::UNKNOWN_ROUTE_PROBE",
      entityType: "USER",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]?.slice(0, 200),
      metadata: { path: req.path, method: req.method } as never,
    },
  }).catch(() => {});

  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "API endpoint not found" },
  });
});

// ─── Global error handler (must be last) ────────────────────────────
app.use(errorHandler);

export default app;
