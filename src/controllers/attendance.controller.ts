import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { logActivity } from "../services/activity.service.js";
import { AppError } from "../middleware/error.middleware.js";

/* ── Office config ──────────────────────────────────────────── */
const OFFICE_TZ = "Asia/Kolkata";
const LATE_AFTER_MIN = 9 * 60 + 45; // 09:45 IST → marked LATE
const MAX_WORK_MINUTES = 16 * 60; // sanity cap (16h) on a single day

/** Office-local date (YYYY-MM-DD) + minutes-since-midnight for a moment. */
function officeParts(d = new Date()): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // some runtimes emit 24 at midnight
  const minutes = hour * 60 + parseInt(p.minute, 10);
  return { date, minutes };
}

interface GeoBody {
  lat?: number;
  lng?: number;
  accuracy?: number | null;
}

/** Validate an optional geolocation fix. Returns null when not supplied. */
function readGeo(body: GeoBody): { lat: number; lng: number; accuracy: number | null } | null {
  const { lat, lng, accuracy } = body;
  if (lat === undefined || lat === null || lng === undefined || lng === null) return null;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new AppError(400, "BAD_LOCATION", "Invalid location coordinates");
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError(400, "BAD_LOCATION", "Location coordinates out of range");
  }
  const acc = typeof accuracy === "number" && !Number.isNaN(accuracy) ? accuracy : null;
  return { lat, lng, accuracy: acc };
}

/* ── Employee actions (self) ────────────────────────────────── */

/** Punch In — starts (or re-opens) today's attendance and records location. */
export async function punchIn(req: Request, res: Response) {
  const userId = req.currentUser!.id;
  const geo = readGeo(req.body as GeoBody);
  const now = new Date();
  const { date, minutes } = officeParts(now);
  const status = minutes > LATE_AFTER_MIN ? "LATE" : "PRESENT";

  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date } },
  });

  let record;
  if (!existing) {
    record = await prisma.attendanceDay.create({
      data: {
        userId, date, firstPunchIn: now, status,
        finalized: false, workedMinutes: 0,
        inLat: geo?.lat ?? null, inLng: geo?.lng ?? null, inAccuracy: geo?.accuracy ?? null,
      },
    });
  } else {
    // Re-open if they had already punched out earlier; keep the original
    // firstPunchIn so "office time starts from the first punch-in".
    record = await prisma.attendanceDay.update({
      where: { userId_date: { userId, date } },
      data: {
        finalized: false,
        lastPunchOut: null,
        ...(existing.inLat == null && geo
          ? { inLat: geo.lat, inLng: geo.lng, inAccuracy: geo.accuracy }
          : {}),
      },
    });
  }

  if (geo) {
    await prisma.locationPing.create({
      data: { userId, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, kind: "punch_in", date },
    });
  }

  await logActivity({
    userId, action: "PUNCH_IN", entityType: "USER", entityId: userId,
    metadata: { date, located: !!geo },
  });

  return sendSuccess(res, record, "Punched in");
}

/** Punch Out — finalizes today's attendance (marks it complete) + location. */
export async function punchOut(req: Request, res: Response) {
  const userId = req.currentUser!.id;
  const geo = readGeo(req.body as GeoBody);
  const now = new Date();
  const { date } = officeParts(now);

  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (!existing) {
    throw new AppError(400, "NOT_PUNCHED_IN", "You must punch in before punching out");
  }

  const worked = Math.min(
    MAX_WORK_MINUTES,
    Math.max(0, Math.round((now.getTime() - existing.firstPunchIn.getTime()) / 60000)),
  );

  const record = await prisma.attendanceDay.update({
    where: { userId_date: { userId, date } },
    data: {
      lastPunchOut: now,
      finalized: true,
      workedMinutes: worked,
      outLat: geo?.lat ?? null, outLng: geo?.lng ?? null, outAccuracy: geo?.accuracy ?? null,
    },
  });

  if (geo) {
    await prisma.locationPing.create({
      data: { userId, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, kind: "punch_out", date },
    });
  }

  await logActivity({
    userId, action: "PUNCH_OUT", entityType: "USER", entityId: userId,
    metadata: { date, workedMinutes: worked, located: !!geo },
  });

  return sendSuccess(res, record, "Punched out — attendance marked");
}

/** Live location ping — accepted only while the user is punched in (active). */
export async function ping(req: Request, res: Response) {
  const userId = req.currentUser!.id;
  const geo = readGeo(req.body as GeoBody);
  if (!geo) throw new AppError(400, "BAD_LOCATION", "Location is required for a ping");

  const { date } = officeParts();
  const active = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (!active || active.finalized) {
    // Not on the clock — silently ignore so a stale tab can't keep pinging.
    return sendSuccess(res, { accepted: false }, "Not punched in");
  }

  await prisma.locationPing.create({
    data: { userId, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, kind: "live", date },
  });

  return sendSuccess(res, { accepted: true }, "Location recorded");
}

/** The signed-in user's own attendance — today + recent history. */
export async function myAttendance(req: Request, res: Response) {
  const userId = req.currentUser!.id;
  const { date } = officeParts();

  const [today, history] = await Promise.all([
    prisma.attendanceDay.findUnique({ where: { userId_date: { userId, date } } }),
    prisma.attendanceDay.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 30,
    }),
  ]);

  return sendSuccess(res, { today: today ?? null, history });
}

/* ── Admin board (ADMIN+) ───────────────────────────────────── */

/** Today's attendance board — everyone's punch state. Location NOT included. */
export async function attendanceToday(req: Request, res: Response) {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : officeParts().date;

  const rows = await prisma.attendanceDay.findMany({
    where: { date },
    orderBy: { firstPunchIn: "asc" },
    select: {
      id: true, userId: true, date: true, firstPunchIn: true, lastPunchOut: true,
      status: true, finalized: true, workedMinutes: true,
      user: { select: { name: true, email: true, role: true, jobTitle: true, department: true } },
    },
  });

  return sendSuccess(res, { date, rows });
}

/* ── Location board (SUPER_ADMIN only) ──────────────────────── */

/** Latest known location per employee for a day + on-the-clock flag. */
export async function liveLocations(req: Request, res: Response) {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : officeParts().date;

  const [days, pings] = await Promise.all([
    prisma.attendanceDay.findMany({
      where: { date },
      select: {
        userId: true, status: true, finalized: true, firstPunchIn: true, lastPunchOut: true,
        user: { select: { name: true, email: true, role: true, jobTitle: true, department: true } },
      },
    }),
    prisma.locationPing.findMany({
      where: { date },
      orderBy: { createdAt: "desc" },
      select: { userId: true, lat: true, lng: true, accuracy: true, kind: true, createdAt: true },
    }),
  ]);

  // Reduce to the most-recent ping per user (pings are desc-ordered).
  const latest = new Map<string, (typeof pings)[number]>();
  for (const p of pings) if (!latest.has(p.userId)) latest.set(p.userId, p);

  const locations = days.map((d) => {
    const last = latest.get(d.userId) ?? null;
    return {
      userId: d.userId,
      name: d.user.name,
      email: d.user.email,
      role: d.user.role,
      jobTitle: d.user.jobTitle,
      department: d.user.department,
      onClock: !d.finalized,
      status: d.status,
      firstPunchIn: d.firstPunchIn,
      lastPunchOut: d.lastPunchOut,
      lastLat: last?.lat ?? null,
      lastLng: last?.lng ?? null,
      lastAccuracy: last?.accuracy ?? null,
      lastSeen: last?.createdAt ?? null,
      lastKind: last?.kind ?? null,
    };
  });

  return sendSuccess(res, { date, locations });
}

/** Full location trail (path) for one employee on a day. */
export async function employeeTrail(req: Request, res: Response) {
  const userId = String(req.params.userId || "");
  if (!userId) throw new AppError(400, "BAD_REQUEST", "userId is required");
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : officeParts().date;

  const [user, trail] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, jobTitle: true, department: true },
    }),
    prisma.locationPing.findMany({
      where: { userId, date },
      orderBy: { createdAt: "asc" },
      select: { lat: true, lng: true, accuracy: true, kind: true, createdAt: true },
    }),
  ]);

  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Employee not found");
  return sendSuccess(res, { date, user, trail });
}
