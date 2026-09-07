import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { Prisma, RouteBookMark } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { paramId } from "../utils/params.js";
import { AppError } from "../middleware/error.middleware.js";
import { logActivity } from "../services/activity.service.js";
import {
  eventsQuerySchema,
  createSampleSchema,
  updateSampleSchema,
  putSettingsSchema,
  createOrderSchema,
  updateOrderSchema,
  importSchema,
  type MarkFields,
  type StopFields,
} from "../validators/routeBook.validator.js";
import { mirrorToCrm } from "../services/routeBookCrm.service.js";

/* ─── Seed data ──────────────────────────────────────────────────────────
 * The register-sourced book ships with the backend (prisma/data/…, copied
 * into the runtime image). The first bootstrap call loads it; POST /reseed
 * refreshes register fields in place without touching anyone's marks.   */

interface SeedFamily { id: string; name: string; blurb?: string; sortOrder: number }
interface SeedLeg { id: string; familyId: string; name: string; belt?: string; nav?: string; sortOrder: number }
interface SeedStop {
  id: string; legId: string; name: string; addr?: string; makes?: string; src?: string;
  tags?: { t: string; c: string }[]; precise?: boolean; map?: string; tel?: string; telLabel?: string;
  link?: string; linkLabel?: string; fit?: string; why?: string; sortOrder: number;
}
interface SeedFile { version: number; fams: SeedFamily[]; legs: SeedLeg[]; stops: SeedStop[] }

const SEED_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/data/route-book.json");
const USER_LEG = "M1";
const PARKED_FITS = ["no", "clear"];

let seedCache: SeedFile | null = null;
function loadSeed(): SeedFile {
  if (!seedCache) seedCache = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as SeedFile;
  return seedCache;
}

function seedStopData(s: SeedStop): Prisma.RouteBookStopUncheckedCreateInput {
  return {
    id: s.id, legId: s.legId, name: s.name, addr: s.addr ?? "", makes: s.makes ?? "", src: s.src ?? "",
    tags: (s.tags ?? []) as Prisma.InputJsonValue, precise: !!s.precise, map: s.map ?? "",
    tel: s.tel ?? "", telLabel: s.telLabel ?? "", link: s.link ?? "", linkLabel: s.linkLabel ?? "",
    fit: s.fit ?? "good", why: s.why ?? "", sortOrder: s.sortOrder, userAdded: false,
  };
}

async function applySeed(mode: "create" | "upsert") {
  const seed = loadSeed();
  for (const f of seed.fams) {
    await prisma.routeBookFamily.upsert({
      where: { id: f.id },
      update: { name: f.name, blurb: f.blurb ?? "", sortOrder: f.sortOrder },
      create: { id: f.id, name: f.name, blurb: f.blurb ?? "", sortOrder: f.sortOrder },
    });
  }
  for (const l of seed.legs) {
    await prisma.routeBookLeg.upsert({
      where: { id: l.id },
      update: { name: l.name, belt: l.belt ?? "", nav: l.nav ?? "", sortOrder: l.sortOrder, familyId: l.familyId },
      create: { id: l.id, name: l.name, belt: l.belt ?? "", nav: l.nav ?? "", sortOrder: l.sortOrder, familyId: l.familyId },
    });
  }
  let stops = 0;
  if (mode === "create") {
    for (let i = 0; i < seed.stops.length; i += 300) {
      const r = await prisma.routeBookStop.createMany({
        data: seed.stops.slice(i, i + 300).map(seedStopData),
        skipDuplicates: true,
      });
      stops += r.count;
    }
  } else {
    for (let i = 0; i < seed.stops.length; i += 100) {
      const chunk = seed.stops.slice(i, i + 100);
      await prisma.$transaction(chunk.map((s) => {
        const data = seedStopData(s);
        const { id, userAdded, ...update } = data;
        void id; void userAdded;
        return prisma.routeBookStop.upsert({ where: { id: s.id }, update, create: data });
      }));
      stops += chunk.length;
    }
  }
  return { fams: seed.fams.length, legs: seed.legs.length, stops, version: seed.version };
}

let seededThisProcess = false;
async function ensureSeeded() {
  if (seededThisProcess) return;
  const n = await prisma.routeBookStop.count();
  if (n === 0) await applySeed("create");
  seededThisProcess = true;
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapUrl(name: string, addr?: string | null): string {
  return "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent([name, addr].filter(Boolean).join(", "));
}

const STOP_SELECT = {
  id: true, legId: true, name: true, addr: true, makes: true, src: true, tags: true, precise: true,
  map: true, tel: true, telLabel: true, link: true, linkLabel: true, fit: true, why: true,
  sortOrder: true, userAdded: true, addedById: true,
  addedBy: { select: { name: true } },
} satisfies Prisma.RouteBookStopSelect;

const MARK_INCLUDE = {
  updatedBy: { select: { id: true, name: true } },
  samples: { orderBy: { givenOn: "desc" }, include: { createdBy: { select: { id: true, name: true } } } },
  orders: { orderBy: { orderedOn: "desc" }, include: { createdBy: { select: { id: true, name: true } } } },
} satisfies Prisma.RouteBookMarkInclude;

type Tx = Prisma.TransactionClient;

/** What the CRM mirror needs to describe a company it has not met before. */
const CRM_STOP_SELECT = { id: true, name: true, legId: true, addr: true, tel: true, makes: true } as const;

/** Turn a partial mark update into journal entries by diffing against the
 *  row that was there before, so the day log only records real changes. */
function diffEvents(prev: RouteBookMark | null, next: MarkFields): { kind: string; value: string | null }[] {
  const ev: { kind: string; value: string | null }[] = [];
  const p = prev;
  const changed = (a: unknown, b: unknown) => (a ?? null) !== (b ?? null);
  if (next.ticked !== undefined && next.ticked !== (p?.ticked ?? false)) {
    ev.push({ kind: next.ticked ? "tick" : "untick", value: next.tickedOn ?? p?.tickedOn ?? null });
  }
  if (next.starred !== undefined && next.starred !== (p?.starred ?? false)) {
    ev.push({ kind: next.starred ? "star" : "unstar", value: null });
  }
  if (next.note !== undefined && (next.note ?? "") !== (p?.note ?? "")) ev.push({ kind: "note", value: next.note ?? "" });
  if (next.outcome !== undefined && changed(next.outcome, p?.outcome)) ev.push({ kind: "out", value: next.outcome ?? "" });
  if (next.dueOn !== undefined && changed(next.dueOn, p?.dueOn)) ev.push({ kind: "due", value: next.dueOn ?? "" });
  if ((next.contactName !== undefined || next.contactPhone !== undefined)) {
    const n = next.contactName ?? p?.contactName ?? "", ph = next.contactPhone ?? p?.contactPhone ?? "";
    if (n !== (p?.contactName ?? "") || ph !== (p?.contactPhone ?? "")) {
      ev.push({ kind: "con", value: [n, ph].filter(Boolean).join(" / ") });
    }
  }
  if (next.addrOverride !== undefined && changed(next.addrOverride, p?.addrOverride)) {
    ev.push({ kind: "addr", value: next.addrOverride ?? "" });
  }
  if (next.dnc !== undefined && next.dnc !== (p?.dnc ?? false)) ev.push({ kind: "dnc", value: next.dnc ? "1" : "0" });
  if (next.removed !== undefined && next.removed !== (p?.removed ?? false)) {
    ev.push({ kind: next.removed ? "removed" : "restored", value: null });
  }
  if (next.dupOf !== undefined && changed(next.dupOf, p?.dupOf)) {
    ev.push({ kind: next.dupOf ? "merged" : "unmerged", value: next.dupOf ?? "" });
  }
  if (next.snoozedOn !== undefined && changed(next.snoozedOn, p?.snoozedOn)) ev.push({ kind: "snooze", value: next.snoozedOn ?? "" });
  if (next.companyId !== undefined && next.companyId && next.companyId !== p?.companyId) {
    ev.push({ kind: "promote", value: next.companyId });
  }
  if (next.followUpId !== undefined && next.followUpId && next.followUpId !== p?.followUpId) {
    ev.push({ kind: "followup", value: next.followUpId });
  }
  if (next.stage !== undefined && next.stage !== (p?.stage ?? "PROSPECT")) {
    ev.push({ kind: "stage", value: next.stage });
  }
  if (next.nextStep !== undefined && changed(next.nextStep, p?.nextStep)) ev.push({ kind: "next", value: next.nextStep ?? "" });
  if (next.quotedRate !== undefined && changed(next.quotedRate, p?.quotedRate == null ? null : Number(p.quotedRate))) {
    ev.push({ kind: "quote", value: next.quotedRate == null ? "" : `${next.quotedRate}/kg` });
  }
  // One "profile" entry covers the whole fit capture — a separate line per
  // field would bury the day's real work under form noise.
  const profileKeys = ["polymers", "processes", "monthlyTonnes", "machines", "fillerPct", "resinRate", "thinWall"] as const;
  if (profileKeys.some((k) => next[k] !== undefined && changed(next[k], p?.[k] == null ? null : String(p[k])))) {
    const bits = [
      next.polymers ?? p?.polymers,
      next.processes ?? p?.processes,
      (next.monthlyTonnes ?? p?.monthlyTonnes) != null ? `${next.monthlyTonnes ?? p?.monthlyTonnes} t/mo` : null,
    ].filter(Boolean).join(" · ");
    ev.push({ kind: "profile", value: bits || "updated" });
  }
  return ev;
}

async function applyMark(tx: Tx, stopId: string, fields: MarkFields, day: string, userId: string) {
  const stop = await tx.routeBookStop.findFirst({ where: { id: stopId, deletedAt: null }, select: CRM_STOP_SELECT });
  if (!stop) throw new AppError(404, "NOT_FOUND", `Stop ${stopId} not found`);
  const prev = await tx.routeBookMark.findUnique({ where: { stopId } });
  const data: MarkFields = { ...fields };
  if (data.ticked === true && !data.tickedOn && !prev?.tickedOn) data.tickedOn = day;
  if (data.ticked === false) data.tickedOn = null;
  // A stage change stamps its own date once, so the books can say when a
  // company became a lead or a customer without anyone typing it in.
  if (data.stage && data.stage !== (prev?.stage ?? "PROSPECT")) {
    if (data.stage === "LEAD" && !data.leadOn && !prev?.leadOn) data.leadOn = day;
    if (data.stage === "CUSTOMER") {
      if (!data.leadOn && !prev?.leadOn) data.leadOn = day;
      if (!data.customerOn && !prev?.customerOn) data.customerOn = day;
    }
    if (data.stage === "LOST" && !data.lostOn) data.lostOn = day;
    if (data.stage !== "LOST") { data.lostOn = null; data.lostReason = null; }
  }
  const events = diffEvents(prev, data);
  let mark = await tx.routeBookMark.upsert({
    where: { stopId },
    update: { ...data, updatedById: userId },
    create: { stopId, ...data, updatedById: userId },
    include: MARK_INCLUDE,
  });
  // Keep the CRM and the pipeline board in step with the book. Cheap when
  // nothing has happened at this stop yet — the mirror returns immediately.
  const ids = await mirrorToCrm(tx, stop, mark);
  if (ids.companyId !== mark.companyId || ids.inquiryId !== mark.inquiryId) {
    mark = await tx.routeBookMark.update({
      where: { stopId },
      data: { companyId: ids.companyId, inquiryId: ids.inquiryId },
      include: MARK_INCLUDE,
    });
    if (ids.companyId && ids.companyId !== prev?.companyId) {
      events.push({ kind: "promote", value: ids.companyId });
    }
  }
  if (events.length) {
    await tx.routeBookEvent.createMany({
      data: events.map((e) => ({ stopId, kind: e.kind, value: e.value, day, userId })),
    });
  }
  return mark;
}

/* ─── Read ─────────────────────────────────────────────────────────────── */

export async function bootstrap(req: Request, res: Response) {
  const user = req.currentUser!;
  await ensureSeeded();
  const [fams, legs, stops, marks, legMarks, views, pref, settings] = await Promise.all([
    prisma.routeBookFamily.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.routeBookLeg.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.routeBookStop.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, select: STOP_SELECT }),
    prisma.routeBookMark.findMany({ include: MARK_INCLUDE }),
    prisma.routeBookLegMark.findMany(),
    prisma.routeBookView.findMany({ orderBy: { createdAt: "asc" }, include: { createdBy: { select: { id: true, name: true } } } }),
    prisma.routeBookPref.findUnique({ where: { userId: user.id } }),
    prisma.routeBookSetting.findUnique({ where: { id: "singleton" } }),
  ]);
  return sendSuccess(res, {
    fams, legs, stops, marks, legMarks, views, settings,
    prefs: (pref?.data as Record<string, unknown> | undefined) ?? {},
    me: { id: user.id, name: user.name, role: user.role },
    serverDay: todayUtc(),
    userLeg: USER_LEG,
  });
}

export async function summary(_req: Request, res: Response) {
  await ensureSeeded();
  const today = todayUtc();
  const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [total, sellable, ticked, tickedWeek, interested, samples, starred, dueToday, lastEvent, leads, customers, orderAgg] = await Promise.all([
    prisma.routeBookStop.count({ where: { deletedAt: null } }),
    prisma.routeBookStop.count({
      where: { deletedAt: null, fit: { notIn: PARKED_FITS }, OR: [{ mark: null }, { mark: { removed: false } }] },
    }),
    prisma.routeBookMark.count({ where: { ticked: true } }),
    prisma.routeBookMark.count({ where: { ticked: true, tickedOn: { gte: weekAgo } } }),
    prisma.routeBookMark.count({ where: { outcome: "int" } }),
    prisma.routeBookMark.count({ where: { outcome: "smp" } }),
    prisma.routeBookMark.count({ where: { starred: true } }),
    prisma.routeBookMark.count({ where: { dueOn: { lte: today } } }),
    prisma.routeBookEvent.findFirst({ orderBy: { at: "desc" }, select: { at: true, kind: true, user: { select: { name: true } } } }),
    prisma.routeBookMark.count({ where: { stage: "LEAD" } }),
    prisma.routeBookMark.count({ where: { stage: "CUSTOMER" } }),
    prisma.routeBookOrder.aggregate({
      where: { status: { not: "CANCELLED" } },
      _sum: { quantityMt: true, amount: true },
      _count: { _all: true },
    }),
  ]);
  return sendSuccess(res, {
    total, sellable, ticked, tickedWeek, interested, samples, starred, dueToday, lastEvent,
    leads, customers,
    orders: orderAgg._count._all,
    orderedMt: Number(orderAgg._sum.quantityMt ?? 0),
    orderedValue: orderAgg._sum.amount == null ? null : Number(orderAgg._sum.amount),
  });
}

/* ─── Live sync ────────────────────────────────────────────────────────────
   Two phones open on the same book have to agree. Re-fetching the whole
   bootstrap every few seconds would burn a salesperson's mobile data on a
   1,400-stop book, so this returns only what moved since the caller last
   looked — usually an empty array. */

export async function changes(req: Request, res: Response) {
  const raw = typeof req.query.since === "string" ? req.query.since : "";
  const since = new Date(raw);
  if (!raw || Number.isNaN(since.getTime())) throw new AppError(400, "BAD_SINCE", "`since` must be an ISO timestamp");
  const at = new Date().toISOString();

  // A changed order or trial result does not touch its mark row, so collect
  // the affected stops from all three tables before reading the marks back.
  const [touchedMarks, touchedOrders, touchedSamples, stops, gone] = await Promise.all([
    prisma.routeBookMark.findMany({ where: { updatedAt: { gt: since } }, select: { stopId: true } }),
    prisma.routeBookOrder.findMany({ where: { updatedAt: { gt: since } }, select: { stopId: true } }),
    prisma.routeBookSample.findMany({ where: { updatedAt: { gt: since } }, select: { stopId: true } }),
    prisma.routeBookStop.findMany({ where: { updatedAt: { gt: since }, deletedAt: null }, select: STOP_SELECT }),
    prisma.routeBookStop.findMany({ where: { updatedAt: { gt: since }, deletedAt: { not: null } }, select: { id: true } }),
  ]);
  const stopIds = [...new Set([...touchedMarks, ...touchedOrders, ...touchedSamples].map((r) => r.stopId))];
  const marks = stopIds.length
    ? await prisma.routeBookMark.findMany({ where: { stopId: { in: stopIds } }, include: MARK_INCLUDE })
    : [];
  return sendSuccess(res, { marks, stops, removedStopIds: gone.map((g) => g.id), at });
}

export async function listEvents(req: Request, res: Response) {
  const q = eventsQuerySchema.parse(req.query);
  const where: Prisma.RouteBookEventWhereInput = {};
  if (q.stopId) where.stopId = q.stopId;
  if (q.day) where.day = q.day;
  else if (q.from || q.to) {
    where.day = { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) };
  } else if (!q.stopId) where.day = todayUtc();
  const events = await prisma.routeBookEvent.findMany({
    where, orderBy: { at: "asc" }, take: 3000,
    include: { user: { select: { id: true, name: true } }, stop: { select: { name: true, legId: true } } },
  });
  return sendSuccess(res, events);
}

export async function listDays(_req: Request, res: Response) {
  const rows = await prisma.routeBookEvent.groupBy({ by: ["day", "kind"], _count: { _all: true } });
  const days: Record<string, Record<string, number>> = {};
  for (const r of rows) (days[r.day] ??= {})[r.kind] = r._count._all;
  return sendSuccess(res, days);
}

/* ─── Marks ────────────────────────────────────────────────────────────── */

export async function patchMark(req: Request, res: Response) {
  const user = req.currentUser!;
  const stopId = paramId(req, "stopId");
  const { day = todayUtc(), ...fields } = req.body as MarkFields & { day?: string };
  const mark = await prisma.$transaction((tx) => applyMark(tx, stopId, fields, day, user.id));
  return sendSuccess(res, mark);
}

export async function bulkMarks(req: Request, res: Response) {
  const user = req.currentUser!;
  const { day = todayUtc(), items } = req.body as { day?: string; items: (MarkFields & { stopId: string })[] };
  const marks = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const { stopId, ...fields } of items) out.push(await applyMark(tx, stopId, fields, day, user.id));
    return out;
  }, { timeout: 30_000 });
  return sendSuccess(res, marks);
}

export async function patchLegMark(req: Request, res: Response) {
  const user = req.currentUser!;
  const legId = paramId(req, "legId");
  const { day = todayUtc(), ...fields } = req.body as { ticked?: boolean; starred?: boolean; note?: string | null; day?: string };
  const leg = await prisma.routeBookLeg.findUnique({ where: { id: legId }, select: { id: true } });
  if (!leg) throw new AppError(404, "NOT_FOUND", "Leg not found");
  const prev = await prisma.routeBookLegMark.findUnique({ where: { legId } });
  const mark = await prisma.routeBookLegMark.upsert({
    where: { legId },
    update: { ...fields, updatedById: user.id },
    create: { legId, ...fields, updatedById: user.id },
  });
  if (fields.ticked !== undefined && fields.ticked !== (prev?.ticked ?? false)) {
    await prisma.routeBookEvent.create({
      data: { legId, kind: fields.ticked ? "leg-tick" : "leg-untick", day, userId: user.id },
    });
  }
  return sendSuccess(res, mark);
}

/* ─── Companies added on the road ──────────────────────────────────────── */

async function insertStop(tx: Tx, f: StopFields, day: string, user: { id: string; name: string }) {
  const legId = f.legId || USER_LEG;
  const leg = await tx.routeBookLeg.findUnique({ where: { id: legId }, select: { id: true } });
  if (!leg) throw new AppError(400, "BAD_LEG", `Leg ${legId} does not exist`);
  const sortOrder = (await tx.routeBookStop.count({ where: { legId } })) + 1;
  const stop = await tx.routeBookStop.create({
    data: {
      legId, name: f.name, addr: f.addr ?? "", tel: f.tel ?? "", makes: f.makes ?? "",
      fit: f.fit ?? "good", why: "Added by you", src: `Added by ${user.name} on ${day}`,
      precise: !!f.addr, map: mapUrl(f.name, f.addr), telLabel: f.tel ? "Call" : "", link: "", linkLabel: "",
      tags: [{ t: "Yours", c: "big" }] as Prisma.InputJsonValue,
      sortOrder, userAdded: true, addedById: user.id,
    },
    select: STOP_SELECT,
  });
  await tx.routeBookEvent.create({ data: { stopId: stop.id, kind: "added", value: stop.name, day, userId: user.id } });
  return stop;
}

export async function createStop(req: Request, res: Response) {
  const user = req.currentUser!;
  const { day = todayUtc(), ...fields } = req.body as StopFields & { day?: string };
  const stop = await prisma.$transaction((tx) => insertStop(tx, fields, day, user));
  return sendSuccess(res, stop, "Added to the book", 201);
}

export async function bulkStops(req: Request, res: Response) {
  const user = req.currentUser!;
  const { day = todayUtc(), items } = req.body as { day?: string; items: StopFields[] };
  const stops = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const f of items) out.push(await insertStop(tx, f, day, user));
    return out;
  }, { timeout: 30_000 });
  return sendSuccess(res, stops, `${stops.length} added to the book`, 201);
}

async function ownStop(id: string) {
  const stop = await prisma.routeBookStop.findUnique({ where: { id }, select: { id: true, userAdded: true, name: true, addr: true } });
  if (!stop) throw new AppError(404, "NOT_FOUND", "Stop not found");
  if (!stop.userAdded) throw new AppError(403, "REGISTER_STOP", "Register-sourced companies can be removed from the book (marks), not deleted");
  return stop;
}

export async function updateStop(req: Request, res: Response) {
  const id = paramId(req);
  const cur = await ownStop(id);
  const f = req.body as Partial<StopFields>;
  const name = f.name ?? cur.name, addr = f.addr ?? cur.addr ?? "";
  const stop = await prisma.routeBookStop.update({
    where: { id },
    data: {
      ...(f.name !== undefined && { name: f.name }),
      ...(f.addr !== undefined && { addr: f.addr, precise: !!f.addr }),
      ...(f.tel !== undefined && { tel: f.tel, telLabel: f.tel ? "Call" : "" }),
      ...(f.makes !== undefined && { makes: f.makes }),
      ...(f.fit !== undefined && { fit: f.fit }),
      map: mapUrl(name, addr),
    },
    select: STOP_SELECT,
  });
  return sendSuccess(res, stop, "Updated");
}

export async function deleteStop(req: Request, res: Response) {
  const user = req.currentUser!;
  const id = paramId(req);
  const stop = await ownStop(id);
  await prisma.routeBookStop.update({ where: { id }, data: { deletedAt: new Date() } });
  await prisma.routeBookEvent.create({ data: { stopId: id, kind: "deleted", value: stop.name, day: todayUtc(), userId: user.id } });
  return sendSuccess(res, null, "Removed");
}

export async function restoreStop(req: Request, res: Response) {
  const user = req.currentUser!;
  const id = paramId(req);
  await ownStop(id);
  const stop = await prisma.routeBookStop.update({ where: { id }, data: { deletedAt: null }, select: STOP_SELECT });
  await prisma.routeBookEvent.create({ data: { stopId: id, kind: "undeleted", value: stop.name, day: todayUtc(), userId: user.id } });
  return sendSuccess(res, stop, "Restored");
}

/* ─── Views & preferences ──────────────────────────────────────────────── */

export async function listViews(_req: Request, res: Response) {
  const views = await prisma.routeBookView.findMany({
    orderBy: { createdAt: "asc" }, include: { createdBy: { select: { id: true, name: true } } },
  });
  return sendSuccess(res, views);
}

export async function createView(req: Request, res: Response) {
  const user = req.currentUser!;
  const { name, filters } = req.body as { name: string; filters: Record<string, unknown> };
  const view = await prisma.routeBookView.create({
    data: { name, filters: filters as Prisma.InputJsonValue, createdById: user.id },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return sendSuccess(res, view, "View saved", 201);
}

export async function deleteView(req: Request, res: Response) {
  const user = req.currentUser!;
  const id = paramId(req);
  const view = await prisma.routeBookView.findUnique({ where: { id } });
  if (!view) throw new AppError(404, "NOT_FOUND", "View not found");
  const mayDelete = view.createdById === user.id || ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  if (!mayDelete) throw new AppError(403, "FORBIDDEN", "Only the creator or an admin can delete this view");
  await prisma.routeBookView.delete({ where: { id } });
  return sendSuccess(res, null, "View deleted");
}

export async function getPrefs(req: Request, res: Response) {
  const user = req.currentUser!;
  const pref = await prisma.routeBookPref.findUnique({ where: { userId: user.id } });
  return sendSuccess(res, (pref?.data as Record<string, unknown> | undefined) ?? {});
}

export async function putPrefs(req: Request, res: Response) {
  const user = req.currentUser!;
  const { data } = req.body as { data: Record<string, unknown> };
  const pref = await prisma.routeBookPref.upsert({
    where: { userId: user.id },
    update: { data: data as Prisma.InputJsonValue },
    create: { userId: user.id, data: data as Prisma.InputJsonValue },
  });
  return sendSuccess(res, pref.data);
}

/* ─── Maintenance ──────────────────────────────────────────────────────── */

/* ─── Samples ──────────────────────────────────────────────────────────────
   A sample only means something attached to the plant that took it, so the
   mark row is created on demand if this is the first thing recorded here. */

async function ensureMark(tx: Tx, stopId: string, userId: string) {
  const stop = await tx.routeBookStop.findFirst({ where: { id: stopId, deletedAt: null }, select: { id: true } });
  if (!stop) throw new AppError(404, "NOT_FOUND", `Stop ${stopId} not found`);
  await tx.routeBookMark.upsert({ where: { stopId }, update: {}, create: { stopId, updatedById: userId } });
}

export async function createSample(req: Request, res: Response) {
  const user = req.currentUser!;
  const stopId = paramId(req, "stopId");
  const body = createSampleSchema.parse(req.body);
  const givenOn = body.givenOn ?? todayUtc();
  const sample = await prisma.$transaction(async (tx) => {
    await ensureMark(tx, stopId, user.id);
    const row = await tx.routeBookSample.create({
      data: { ...body, givenOn, stopId, createdById: user.id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    // A sample handed over is a visit that happened; keep the book honest.
    await tx.routeBookMark.update({
      where: { stopId },
      data: { ticked: true, tickedOn: givenOn, outcome: "smp", updatedById: user.id },
    });
    await tx.routeBookEvent.create({
      data: { stopId, kind: "sample", value: `${body.grade} · ${body.kg} kg`, day: givenOn, userId: user.id },
    });
    return row;
  });
  return sendSuccess(res, sample, "Sample recorded", 201);
}

export async function updateSample(req: Request, res: Response) {
  const user = req.currentUser!;
  const id = paramId(req, "id");
  const body = updateSampleSchema.parse(req.body);
  const prev = await prisma.routeBookSample.findUnique({ where: { id } });
  if (!prev) throw new AppError(404, "NOT_FOUND", "Sample not found");
  const sample = await prisma.$transaction(async (tx) => {
    const row = await tx.routeBookSample.update({
      where: { id }, data: body,
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (body.result && body.result !== prev.result) {
      await tx.routeBookEvent.create({
        data: {
          stopId: prev.stopId, kind: "trial", value: `${prev.grade}: ${body.result}`,
          day: body.resultOn ?? todayUtc(), userId: user.id,
        },
      });
    }
    return row;
  });
  return sendSuccess(res, sample);
}

export async function deleteSample(req: Request, res: Response) {
  const id = paramId(req, "id");
  const prev = await prisma.routeBookSample.findUnique({ where: { id } });
  if (!prev) throw new AppError(404, "NOT_FOUND", "Sample not found");
  await prisma.routeBookSample.delete({ where: { id } });
  return sendSuccess(res, { id });
}

/** Samples handed out with no trial result yet — where deals go quiet. */
export async function openSamples(_req: Request, res: Response) {
  const rows = await prisma.routeBookSample.findMany({
    where: { result: "PENDING" },
    orderBy: { givenOn: "asc" },
    take: 500,
    include: {
      createdBy: { select: { id: true, name: true } },
      mark: { select: { stopId: true, contactName: true, contactPhone: true, stop: { select: { name: true, legId: true } } } },
    },
  });
  return sendSuccess(res, rows);
}

/* ─── Clearing a line from the day record ──────────────────────────────────
   A tick logged against the wrong company is worse than no tick: the record
   is what the round gets judged on. This removes one company's lines from one
   day and nothing else — the mark itself, and every other day, stay. */

export async function clearDayRow(req: Request, res: Response) {
  const user = req.currentUser!;
  const day = String(req.params.day ?? "");
  const stopId = paramId(req, "stopId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(400, "BAD_DAY", "Expected a YYYY-MM-DD day");
  const { count } = await prisma.routeBookEvent.deleteMany({ where: { day, stopId } });
  if (count) {
    await logActivity({
      userId: user.id, action: "ROUTE_BOOK_CLEAR_DAY_ROW", entityType: "ROUTE_BOOK",
      metadata: { day, stopId, removed: count },
    });
  }
  return sendSuccess(res, { day, stopId, removed: count }, count ? "Cleared from the record" : "Nothing to clear");
}

/* ─── Import ───────────────────────────────────────────────────────────────
   Brings a book kept somewhere else — the standalone Route Book app — into
   the portal, marks and day record together. Marks are written directly
   rather than through applyMark, because the journal arrives with the import
   and re-deriving it would date every line today. The CRM mirror still runs,
   so imported work reaches the pipeline like any other. Re-running the same
   import is safe: identical journal lines are skipped, not duplicated. */

export async function importBook(req: Request, res: Response) {
  const user = req.currentUser!;
  const body = importSchema.parse(req.body);

  const known = new Set(
    (await prisma.routeBookStop.findMany({ where: { deletedAt: null }, select: { id: true } })).map((s) => s.id),
  );
  const marks = body.marks.filter((m) => known.has(m.stopId));
  const events = body.events.filter((e) => known.has(e.stopId));
  const skippedStops = [...new Set(
    [...body.marks.map((m) => m.stopId), ...body.events.map((e) => e.stopId)].filter((id) => !known.has(id)),
  )];

  let marksWritten = 0;
  for (const { stopId, ...fields } of marks) {
    await prisma.$transaction(async (tx) => {
      const stop = await tx.routeBookStop.findUnique({ where: { id: stopId }, select: CRM_STOP_SELECT });
      if (!stop) return;
      const mark = await tx.routeBookMark.upsert({
        where: { stopId },
        update: { ...fields, updatedById: user.id },
        create: { stopId, ...fields, updatedById: user.id },
      });
      const ids = await mirrorToCrm(tx, stop, mark);
      if (ids.companyId !== mark.companyId || ids.inquiryId !== mark.inquiryId) {
        await tx.routeBookMark.update({
          where: { stopId },
          data: { companyId: ids.companyId, inquiryId: ids.inquiryId },
        });
      }
      marksWritten++;
    });
  }

  // One line is "the same line" when the stop, day, kind and instant match.
  const days = [...new Set(events.map((e) => e.day))];
  const existing = new Set(
    (await prisma.routeBookEvent.findMany({
      where: { day: { in: days } },
      select: { stopId: true, day: true, kind: true, at: true },
    })).map((e) => `${e.stopId}|${e.day}|${e.kind}|${e.at.getTime()}`),
  );
  const fresh = events.filter((e) => !existing.has(`${e.stopId}|${e.day}|${e.kind}|${new Date(e.at).getTime()}`));
  for (let i = 0; i < fresh.length; i += 500) {
    await prisma.routeBookEvent.createMany({
      data: fresh.slice(i, i + 500).map((e) => ({
        stopId: e.stopId, kind: e.kind, value: e.value ?? null, day: e.day, at: new Date(e.at), userId: user.id,
      })),
    });
  }

  const result = {
    marks: marksWritten,
    events: fresh.length,
    duplicateEvents: events.length - fresh.length,
    days: days.sort(),
    skippedStops,
  };
  await logActivity({ userId: user.id, action: "ROUTE_BOOK_IMPORT", entityType: "ROUTE_BOOK", metadata: result });
  return sendSuccess(res, result, `Imported ${marksWritten} companies and ${fresh.length} journal lines`);
}

/* ─── Orders ───────────────────────────────────────────────────────────────
   LIMEX is sold by the metric tonne. Quantity is MT, the rate is per kg the
   way converters quote resin, and the rupee amount is worked out here rather
   than in the browser so an exported invoice can never disagree with the
   screen it was printed from. */

const MT_TO_KG = 1000;

/** WD-2026-0001 — readable on a phone call, sortable in a spreadsheet. */
async function nextOrderNo(tx: Tx, day: string) {
  const year = day.slice(0, 4);
  const prefix = `WD-${year}-`;
  const last = await tx.routeBookOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const n = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

function orderAmount(quantityMt: number, rate: number | null | undefined) {
  return rate == null ? null : Number((quantityMt * MT_TO_KG * rate).toFixed(2));
}

const ORDER_INCLUDE = { createdBy: { select: { id: true, name: true } } } satisfies Prisma.RouteBookOrderInclude;

export async function createOrder(req: Request, res: Response) {
  const user = req.currentUser!;
  const stopId = paramId(req, "stopId");
  const body = createOrderSchema.parse(req.body);
  const orderedOn = body.orderedOn ?? todayUtc();
  const result = await prisma.$transaction(async (tx) => {
    await ensureMark(tx, stopId, user.id);
    const rate = body.rate ?? null;
    const order = await tx.routeBookOrder.create({
      data: {
        ...body,
        orderedOn,
        rate,
        amount: orderAmount(body.quantityMt, rate),
        orderNo: await nextOrderNo(tx, orderedOn),
        stopId,
        createdById: user.id,
      },
      include: ORDER_INCLUDE,
    });
    // An order is the definition of a customer — the book should not need a
    // second click to agree with itself.
    const mark = await applyMark(tx, stopId, { stage: "CUSTOMER" }, orderedOn, user.id);
    await tx.routeBookEvent.create({
      data: {
        stopId, kind: "order", day: orderedOn, userId: user.id,
        value: `${order.orderNo} · ${body.quantityMt} MT ${body.grade}`,
      },
    });
    return { order, mark };
  }, { timeout: 30_000 });
  return sendSuccess(res, result, "Order recorded", 201);
}

export async function updateOrder(req: Request, res: Response) {
  const user = req.currentUser!;
  const id = paramId(req, "id");
  const body = updateOrderSchema.parse(req.body);
  const prev = await prisma.routeBookOrder.findUnique({ where: { id } });
  if (!prev) throw new AppError(404, "NOT_FOUND", "Order not found");
  const quantityMt = body.quantityMt ?? Number(prev.quantityMt);
  const rate = body.rate !== undefined ? body.rate : prev.rate == null ? null : Number(prev.rate);
  const order = await prisma.routeBookOrder.update({
    where: { id },
    data: { ...body, amount: orderAmount(quantityMt, rate) },
    include: ORDER_INCLUDE,
  });
  if (body.status && body.status !== prev.status) {
    await prisma.routeBookEvent.create({
      data: {
        stopId: prev.stopId, kind: "order", day: todayUtc(), userId: user.id,
        value: `${prev.orderNo}: ${body.status.toLowerCase()}`,
      },
    });
  }
  return sendSuccess(res, order, "Order updated");
}

export async function deleteOrder(req: Request, res: Response) {
  const id = paramId(req, "id");
  const prev = await prisma.routeBookOrder.findUnique({ where: { id } });
  if (!prev) throw new AppError(404, "NOT_FOUND", "Order not found");
  await prisma.routeBookOrder.delete({ where: { id } });
  return sendSuccess(res, { id }, "Order removed");
}

/** Every order across the book, for the Customer Book ledger and exports. */
export async function listOrders(_req: Request, res: Response) {
  const orders = await prisma.routeBookOrder.findMany({
    orderBy: { orderedOn: "desc" },
    take: 2000,
    include: {
      ...ORDER_INCLUDE,
      mark: { select: { stopId: true, gstNumber: true, contactName: true, contactPhone: true, stop: { select: { name: true, legId: true } } } },
    },
  });
  return sendSuccess(res, orders);
}

/* ─── Commercial settings ─────────────────────────────────────────────────
   Every rupee figure the Route Book shows is derived from these, so they are
   entered once by an admin rather than guessed anywhere in the code. */

export async function getSettings(_req: Request, res: Response) {
  const row = await prisma.routeBookSetting.findUnique({ where: { id: "singleton" } });
  return sendSuccess(res, row ?? { id: "singleton", limexRate: null, substitutionPct: 30, currency: "INR" });
}

export async function putSettings(req: Request, res: Response) {
  const user = req.currentUser!;
  const body = putSettingsSchema.parse(req.body);
  const row = await prisma.routeBookSetting.upsert({
    where: { id: "singleton" },
    update: { ...body, updatedById: user.id },
    create: { id: "singleton", ...body, updatedById: user.id },
  });
  return sendSuccess(res, row);
}

export async function reseed(req: Request, res: Response) {
  const user = req.currentUser!;
  const result = await applySeed("upsert");
  seededThisProcess = true;
  await logActivity({ userId: user.id, action: "ROUTE_BOOK_RESEED", entityType: "ROUTE_BOOK", metadata: result });
  return sendSuccess(res, result, "Register refreshed — marks untouched");
}
