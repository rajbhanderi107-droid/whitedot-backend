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

  get isProduction() {
    return this.NODE_ENV === "production";
  },

  get googleOAuthEnabled() {
    return Boolean(this.GOOGLE_CLIENT_ID && this.GOOGLE_CLIENT_SECRET);
  },
} as const;
