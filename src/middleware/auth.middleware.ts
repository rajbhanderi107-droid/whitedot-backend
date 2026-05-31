import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { verifyToken } from "../utils/tokens.js";
import { AppError } from "./error.middleware.js";
import { isTokenRevoked } from "../services/tokenBlacklist.service.js";
import { logSecurityEvent } from "../services/watchtower.service.js";

/** Verify JWT from Authorization header or cookie and attach currentUser to request.
 *  Header takes precedence — cross-origin frontends (GitHub Pages ↔ Render) can't
 *  use cookies because browsers block third-party cookies.
 *  Security dome Layer 3: also checks jti blacklist to block replayed/stolen tokens. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    let token = req.cookies?.token;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }
    if (!token) throw new AppError(401, "UNAUTHORIZED", "Authentication required");

    const payload = verifyToken(token);

    // Layer 3: reject revoked tokens (logout, suspected compromise)
    if (payload.jti && await isTokenRevoked(payload.jti)) {
      logSecurityEvent("TOKEN_REPLAY_BLOCKED", req, { userId: payload.userId }).catch(() => {});
      throw new AppError(401, "TOKEN_REVOKED", "Session has been invalidated. Please sign in again.");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, "UNAUTHORIZED", "Account inactive or not found");
    }

    req.currentUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }
}

/** Factory: require one of the specified roles */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    }
    if (!roles.includes(req.currentUser.role)) {
      return next(new AppError(403, "FORBIDDEN", "Insufficient permissions"));
    }
    next();
  };
}
