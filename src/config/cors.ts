import { env } from "./env.js";

const ALLOWED_ORIGINS = [
  env.FRONTEND_URL,
  "https://rajbhanderi107-droid.github.io",
  "https://whitedotindia.in",
  "https://www.whitedotindia.in",
];
if (!env.isProduction) {
  ALLOWED_ORIGINS.push("http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173");
}

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin);
}
