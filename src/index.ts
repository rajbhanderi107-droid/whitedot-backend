import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`
╭─────────────────────────────────────────╮
│  WhiteDot Backend                       │
│  Mode:  ${env.NODE_ENV.padEnd(30)}  │
│  Port:  ${String(env.PORT).padEnd(30)}  │
│  CORS:  ${env.FRONTEND_URL.padEnd(30).slice(0, 30)}  │
╰─────────────────────────────────────────╯
  `);

});

// ─── Graceful shutdown ──────────────────────────
const shutdown = async (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // 1. Stop accepting new connections
  server.close(async () => {
    try {
      // 2. Disconnect Prisma (releases DB connection pool)
      await prisma.$disconnect();
      console.log("  Prisma disconnected.");
    } catch (err) {
      console.error("  Error disconnecting Prisma:", err);
    }
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    console.error("  Forced shutdown after 10s timeout.");
    process.exit(1);
  }, 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Uncaught error safety net ──────────────────
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
  // Don't crash — log and continue serving
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
  // Crash on uncaught exceptions — something is fundamentally wrong
  shutdown("UNCAUGHT_EXCEPTION");
});
