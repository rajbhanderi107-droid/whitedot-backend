/**
 * SECURITY DOME — Layer 5: Watchtower
 * Observes and logs all security events. Notifies admins on critical events.
 */
import type { Request } from "express";
import { prisma } from "../config/prisma.js";
import { notifyAdmins } from "./notification.service.js";

export type SecurityEventType =
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "LOGIN_SUCCESS_SUPERADMIN"
  | "LOGOUT_TOKEN_REVOKED"
  | "SCANNER_BLOCKED"
  | "PROBE_BLOCKED"
  | "RATE_LIMITED"
  | "CORS_VIOLATION"
  | "TOKEN_REPLAY_BLOCKED"
  | "UNKNOWN_ROUTE_PROBE";

/** Write a security event to ActivityLog and optionally notify admins */
export async function logSecurityEvent(
  event: SecurityEventType,
  req: Request,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const ip = getIp(req);
  const ua = req.headers["user-agent"]?.slice(0, 200) ?? "unknown";

  try {
    await prisma.activityLog.create({
      data: {
        action: `SECURITY::${event}`,
        entityType: "USER",
        ipAddress: ip,
        userAgent: ua,
        metadata: { event, path: req.path, method: req.method, ...metadata } as never,
      },
    });
  } catch {
    // Never let logging crash the request
  }

  // Notify admins on critical events
  const critical: SecurityEventType[] = [
    "LOGIN_LOCKED",
    "LOGIN_SUCCESS_SUPERADMIN",
    "TOKEN_REPLAY_BLOCKED",
  ];
  if (critical.includes(event)) {
    const msg = buildNotificationMessage(event, ip, metadata);
    notifyAdmins(`🔒 Security alert: ${event}`, msg, "WARNING").catch(() => {});
  }
}

function buildNotificationMessage(
  event: SecurityEventType,
  ip: string,
  meta?: Record<string, unknown>,
): string {
  switch (event) {
    case "LOGIN_LOCKED":
      return `Account ${meta?.email ?? "unknown"} locked after repeated failed login attempts from ${ip}.`;
    case "LOGIN_SUCCESS_SUPERADMIN":
      return `Super Admin ${meta?.email ?? "unknown"} logged in from ${ip}.`;
    case "TOKEN_REPLAY_BLOCKED":
      return `Revoked token replay attempt blocked from ${ip} for user ${meta?.userId ?? "unknown"}.`;
    default:
      return `Security event from ${ip}: ${event}`;
  }
}

function getIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip ?? "unknown";
}
