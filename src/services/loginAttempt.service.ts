/**
 * SECURITY DOME — Layer 3: Auth Citadel — Login Lockout
 * Tracks failed login attempts per account. Locks account after MAX_FAILURES.
 */
import { prisma } from "../config/prisma.js";

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 30;

/** Check if an account is currently locked. Returns true if locked. */
export async function isAccountLocked(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { lockedUntil: true },
  });
  if (!user?.lockedUntil) return false;
  if (user.lockedUntil > new Date()) return true;
  // Lock expired — clear it
  await prisma.user.update({
    where: { email },
    data: { lockedUntil: null, failedLoginAttempts: 0 },
  });
  return false;
}

/** Record a failed login attempt. Locks account after MAX_FAILURES. */
export async function recordFailedLogin(email: string): Promise<{ locked: boolean; attempts: number }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, failedLoginAttempts: true },
  });
  if (!user) return { locked: false, attempts: 0 };

  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= MAX_FAILURES;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
    : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      ...(lockedUntil && { lockedUntil }),
    },
  });

  return { locked: shouldLock, attempts };
}

/** Clear failed login counter on successful login. */
export async function clearFailedLogins(email: string): Promise<void> {
  await prisma.user.update({
    where: { email },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  }).catch(() => {}); // user may not exist — safe to ignore
}
