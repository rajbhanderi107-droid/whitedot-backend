import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import publicRoutes from "./routes/public.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const app = express();

// ─── Security headers ───────────────────────────
app.use(helmet());

// ─── CORS — whitelist frontend origin ───────────
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);

// ─── Body parsing ───────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Root landing — friendly status for browsers hitting / ──
app.get("/", (_req, res) => {
  res.json({
    service: "White Dot LLP — LIMEX CRM API",
    status: "ok",
    docs: "/api/health for health check",
  });
});

// ─── Health check ───────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Routes ─────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api", adminRoutes);

// ─── 404 for unknown API routes ─────────────────
app.use("/api/*path", (_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "API endpoint not found" },
  });
});

// ─── Global error handler (must be last) ────────
app.use(errorHandler);

export default app;
