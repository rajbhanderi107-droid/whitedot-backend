import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  PORT: parseInt(process.env.PORT || "4000", 10),
  NODE_ENV: (process.env.NODE_ENV || "development") as "development" | "production" | "test",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  ADMIN_SEED_EMAIL: process.env.ADMIN_SEED_EMAIL || "admin@whitedot.in",
  ADMIN_SEED_PASSWORD: process.env.ADMIN_SEED_PASSWORD,
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,

  // Google OAuth (optional — leave blank to disable Google login)
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",

  // SMTP (optional). If unset, password-reset emails are logged to the console
  // instead of being sent — so the flow still works in dev/preview.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_SECURE: process.env.SMTP_SECURE === "true",
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@whitedot-limex.in",

  get isProduction() {
    return this.NODE_ENV === "production";
  },

  get googleOAuthEnabled() {
    return Boolean(this.GOOGLE_CLIENT_ID && this.GOOGLE_CLIENT_SECRET);
  },

  GOOGLE_AI_KEY: process.env.GOOGLE_AI_KEY || "",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
  GITHUB_REPO: process.env.GITHUB_REPO || "rajbhanderi107-droid/whitedot-limex.in",

  get smtpConfigured() {
    return Boolean(this.SMTP_HOST && this.SMTP_USER && this.SMTP_PASS);
  },

  get llmConfigured() {
    return Boolean(this.GOOGLE_AI_KEY);
  },
} as const;
