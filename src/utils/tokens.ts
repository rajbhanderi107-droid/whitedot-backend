import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { Response } from "express";
import { env } from "../config/env.js";

export interface JWTPayload {
  userId: string;
  role: string;
  jti: string;    // unique token ID — enables revocation
  exp?: number;   // set by jwt.sign
}

// Security dome — Layer 3: shortened from 7d → 1d
const TOKEN_EXPIRY = "1d";
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

export function signToken(payload: Omit<JWTPayload, "jti">): string {
  const jti = crypto.randomBytes(16).toString("hex");
  return jwt.sign({ ...payload, jti }, env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/** Decode without verification — safe for reading jti from an already-verified token */
export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, env.JWT_SECRET) as JWTPayload;
}

/** Attach JWT as a secure HTTP-only cookie */
export function setAuthCookie(res: Response, token: string) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    maxAge: COOKIE_MAX_AGE, // 1 day
    path: "/",
  });
}

/** Clear the auth cookie on logout */
export function clearAuthCookie(res: Response) {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    path: "/",
  });
}
