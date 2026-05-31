/**
 * SECURITY DOME — Layer 1: Edge Shield
 * Blocks malicious requests at the outermost perimeter before they touch
 * any business logic.
 */
import type { Request, Response, NextFunction } from "express";
import { AppError } from "./error.middleware.js";
import { logSecurityEvent } from "../services/watchtower.service.js";

// ─── Blocked user-agent patterns (scanners, exploit tools) ──────────────────
const BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /dirbuster/i,
  /gobuster/i,
  /wfuzz/i,
  /hydra/i,
  /metasploit/i,
  /python-requests\/[0-1]\./i, // very old python-requests (common in exploit scripts)
  /go-http-client\/1\./i,       // common in scanner bots
];

// ─── Suspicious path probe patterns ─────────────────────────────────────────
const PROBE_PATTERNS = [
  /\.env/i,
  /wp-admin/i,
  /wp-login/i,
  /phpmyadmin/i,
  /\.git\//i,
  /etc\/passwd/i,
  /proc\/self/i,
  /\.\.\//,          // path traversal
  /<script/i,        // XSS in URL
  /union.*select/i,  // SQL injection in URL
  /exec\(/i,
  /eval\(/i,
];

/** Block known scanner user-agents */
export function blockScanners(req: Request, _res: Response, next: NextFunction) {
  const ua = req.headers["user-agent"] || "";
  if (BLOCKED_UA_PATTERNS.some((p) => p.test(ua))) {
    logSecurityEvent("SCANNER_BLOCKED", req, { ua });
    throw new AppError(403, "FORBIDDEN", "Access denied");
  }
  next();
}

/** Block URL path probing patterns */
export function blockProbes(req: Request, _res: Response, next: NextFunction) {
  const path = req.path + (req.originalUrl || "");
  if (PROBE_PATTERNS.some((p) => p.test(path))) {
    logSecurityEvent("PROBE_BLOCKED", req, { path: req.path });
    throw new AppError(404, "NOT_FOUND", "Not found");
  }
  next();
}

/** Strip and sanitize all string fields in req.body recursively.
 *  Layer 2: Input Fortress — prevents stored XSS. */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }
  next();
}

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === "string") return stripHtml(obj);
  if (Array.isArray(obj)) return obj.slice(0, 50).map(deepSanitize); // cap array length
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (count++ > 100) break; // cap object keys
      out[k] = deepSanitize(v);
    }
    return out;
  }
  return obj;
}

/** Remove HTML tags and dangerous characters from a string */
function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, "")           // strip all HTML tags
    .replace(/javascript:/gi, "")       // kill JS protocol
    .replace(/on\w+\s*=/gi, "")        // kill event handlers
    .replace(/\x00/g, "")              // null bytes
    .trim();
}

/** Add extra security response headers not covered by Helmet */
export function extraSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.removeHeader("X-Powered-By");
  next();
}
