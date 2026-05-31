/**
 * SECURITY DOME — Layer 3: Auth Citadel — Token Blacklist
 * Tracks revoked JWT IDs (jti) so stolen tokens can't be replayed after logout.
 */
import { prisma } from "../config/prisma.js";

/** Record a revoked token jti. Called on logout. */
export async function revokeToken(jti: string, userId: string, expiresAt: Date): Promise<void> {
  await prisma.revokedToken.upsert({
    where: { jti },
    create: { jti, userId, expiresAt },
    update: {},
  });
}

/** Returns true if the jti has been revoked (i.e. this token must be rejected). */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const record = await prisma.revokedToken.findUnique({
    where: { jti },
    select: { id: true },
  });
  return Boolean(record);
}

/** Purge expired revoked tokens (run periodically — called from health check). */
export async function pruneExpiredTokens(): Promise<void> {
  await prisma.revokedToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
