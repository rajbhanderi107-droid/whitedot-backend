import app from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.PORT, () => {
  console.log(`
╭─────────────────────────────────────────╮
│  WhiteDot Backend                       │
│  Mode:  ${env.NODE_ENV.padEnd(30)}  │
│  Port:  ${String(env.PORT).padEnd(30)}  │
│  CORS:  ${env.FRONTEND_URL.padEnd(30).slice(0, 30)}  │
╰─────────────────────────────────────────╯
  `);

  // ─── Keep-alive self-ping (Render free tier sleeps after 15 min) ──
  // Ping own health endpoint every 14 min to prevent cold starts.
  if (env.isProduction) {
    const KEEP_ALIVE_MS = 14 * 60 * 1000; // 14 minutes
    const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT}`;
    setInterval(() => {
      fetch(`${selfUrl}/api/health`).catch(() => {});
    }, KEEP_ALIVE_MS);
    console.log(`  Keep-alive ping every 14m → ${selfUrl}/api/health`);
  }
});

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down gracefully...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
