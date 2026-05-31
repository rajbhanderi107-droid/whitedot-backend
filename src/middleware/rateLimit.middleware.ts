import rateLimit from "express-rate-limit";

/** Public form endpoints — generous but safe */
export const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,                     // 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please try again in a few minutes.",
    },
  },
});

/** Auth endpoints — Security dome Layer 1: 5 attempts per 15min (down from 10) */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many login attempts. Please try again later.",
    },
  },
});

/** Admin endpoints — reasonable for dashboard use, protects against abuse */
export const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,   // 1 minute
  max: 120,                    // 120 req/min — covers rapid page navigation
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please slow down.",
    },
  },
});
