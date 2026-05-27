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
});

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down gracefully...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
