import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { signToken, setAuthCookie } from "../utils/tokens.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { logActivity } from "../services/activity.service.js";
import { AppError } from "../middleware/error.middleware.js";

/**
 * Google OAuth handler — Token Client flow.
 *
 * Flow:
 *   1. Frontend opens Google consent screen via initTokenClient (implicit/token flow)
 *   2. Google returns an access_token directly to the frontend callback
 *   3. Frontend POSTs { accessToken } to this endpoint
 *   4. We call the Google userinfo endpoint with the token to verify identity
 *   5. Match email to an existing User row (no auto-registration — admin-only)
 *   6. Issue our JWT
 */

interface GoogleUserInfo {
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

/** Verify an access token by fetching the Google userinfo endpoint */
async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new AppError(401, "GOOGLE_AUTH_FAILED", "Failed to fetch Google user info — token may be invalid or expired");
  }

  return res.json() as Promise<GoogleUserInfo>;
}

/**
 * POST /api/auth/google
 * Body: { accessToken: string }
 *
 * Verifies a Google access token and issues a session.
 * Only allows login for existing, active users — no auto-registration.
 */
export async function googleLogin(req: Request, res: Response) {
  if (!env.googleOAuthEnabled) {
    throw new AppError(501, "GOOGLE_AUTH_DISABLED", "Google authentication is not configured");
  }

  const { accessToken } = req.body;
  if (!accessToken || typeof accessToken !== "string") {
    throw new AppError(400, "INVALID_TOKEN", "Google access token is required");
  }

  // Verify the access token and get user profile
  const googleUser = await getGoogleUserInfo(accessToken);

  if (googleUser.email_verified === false) {
    throw new AppError(401, "EMAIL_NOT_VERIFIED", "Google email is not verified");
  }

  // Find matching user in our database
  const user = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (!user) {
    throw new AppError(
      403,
      "USER_NOT_FOUND",
      `No account exists for ${googleUser.email}. Contact an administrator to create your account.`
    );
  }

  if (!user.isActive) {
    throw new AppError(403, "ACCOUNT_INACTIVE", "Account is inactive. Contact an administrator.");
  }

  // Issue JWT
  const token = signToken({ userId: user.id, role: user.role });
  setAuthCookie(res, token);

  await logActivity({
    userId: user.id,
    action: "LOGIN_GOOGLE",
    entityType: "USER",
    entityId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  return sendSuccess(
    res,
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    },
    "Google login successful"
  );
}

/**
 * GET /api/auth/google/config
 * Returns the Google OAuth client ID + redirect URI for the frontend.
 * No secrets exposed.
 */
export async function googleConfig(_req: Request, res: Response) {
  if (!env.googleOAuthEnabled) {
    return sendSuccess(res, { enabled: false });
  }

  return sendSuccess(res, {
    enabled: true,
    clientId: env.GOOGLE_CLIENT_ID,
  });
}
