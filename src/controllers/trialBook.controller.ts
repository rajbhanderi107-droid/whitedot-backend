import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { paramId } from "../utils/params.js";
import { AppError } from "../middleware/error.middleware.js";
import { logActivity } from "../services/activity.service.js";
import type { TrialFields } from "../validators/trialBook.validator.js";

/* ── The Trial Book ───────────────────────────────────────────────────────
 * One row per LIMEX trial, in the same fifteen heads as the workbook on the
 * laptop. The laptop folder stays the record of truth: this book is where a
 * trial is typed, and portal_sync.py writes it out to
 * "TRIAL WEEKLY LIST\<n>. WHITEDOT BY SEVENDOT - ....xlsx" and reports the
 * file name back through POST /:id/synced.
 *
 * The number is handed out here rather than by the laptop so that two trials
 * typed on the same day can never collide, and so the portal and the folder
 * always agree about which trial is which.                               */

const SELECT = {
  id: true, trialNo: true,
  projectBackground: true, mouldingProcess: true, limexGrade: true,
  mixBatch: true, mixResin: true, mixLimex: true,
  colouring: true, product: true, brandOwner: true, originalResin: true,
  barrelTemp: true, originalWeight: true, trialWeight: true,
  result: true, problems: true, nextStep: true,
  imageName: true, imageDriveUrl: true, imageLocal: true,
  stopId: true, company: true, trialOn: true,
  fileName: true, syncedAt: true,
  createdAt: true, updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

/** Oldest first, so the newest trial always reads at the bottom — the way the
 *  workbook and the master list are ordered. */
export async function list(req: Request, res: Response) {
  const unsynced = req.query.unsynced === "1";
  const rows = await prisma.trialReport.findMany({
    where: unsynced ? { syncedAt: null } : undefined,
    orderBy: { trialNo: "asc" },
    select: SELECT,
  });
  // Not the last row's number + 1: with ?unsynced=1 the last row returned is not
  // the highest, and neither accounts for the numbers the folder already used.
  return sendSuccess(res, { trials: rows, nextTrialNo: await nextTrialNo(prisma) });
}

export async function getOne(req: Request, res: Response) {
  const id = paramId(req, "id");
  const trial = await prisma.trialReport.findUnique({ where: { id }, select: SELECT });
  if (!trial) throw new AppError(404, "TRIAL_NOT_FOUND", "Trial not found");
  return sendSuccess(res, { trial });
}

/** The next trial number. Never one the laptop folder has already used: the
 *  folder on Raj's PC decides every Sr number, and it was numbering trials long
 *  before this book existed. Without the floor the first trial typed here would
 *  be "1", clash with the folder's own trial 1, and knock one of them out of the
 *  trial master. */
async function nextTrialNo(tx: Prisma.TransactionClient | typeof prisma): Promise<number> {
  const [top, state] = await Promise.all([
    tx.trialReport.findFirst({ orderBy: { trialNo: "desc" }, select: { trialNo: true } }),
    tx.trialBookState.findUnique({ where: { id: "singleton" }, select: { folderHighest: true } }),
  ]);
  return Math.max(top?.trialNo ?? 0, state?.folderHighest ?? 0) + 1;
}

/** The next free number, so the form can show it before anything is saved. */
export async function nextNumber(_req: Request, res: Response) {
  return sendSuccess(res, { nextTrialNo: await nextTrialNo(prisma) });
}

/** The laptop reports the highest trial number already in the folder. The
 *  floor only ever goes up, so a stale or mistaken report cannot open the door
 *  to a number the folder has used. */
export async function folderHighest(req: Request, res: Response) {
  const highest = (req.body as { highest: number }).highest;
  const state = await prisma.$transaction(async (tx) => {
    const now = await tx.trialBookState.findUnique({ where: { id: "singleton" } });
    const next = Math.max(now?.folderHighest ?? 0, highest);
    return tx.trialBookState.upsert({
      where: { id: "singleton" },
      update: { folderHighest: next, reportedAt: new Date() },
      create: { id: "singleton", folderHighest: next, reportedAt: new Date() },
      select: { folderHighest: true, reportedAt: true },
    });
  });
  return sendSuccess(res, { folderHighest: state.folderHighest, nextTrialNo: await nextTrialNo(prisma) });
}

export async function create(req: Request, res: Response) {
  const body = req.body as TrialFields;
  const userId = req.currentUser?.id;

  /* Take the number and the row in one transaction. Two people saving at the
   * same instant would otherwise both read the same "last" number. */
  const trial = await prisma.$transaction(async (tx) => {
    const trialNo = await nextTrialNo(tx);
    return tx.trialReport.create({
      data: {
        ...body,
        imageDriveUrl: body.imageDriveUrl || null,
        trialNo,
        createdById: userId ?? null,
      },
      select: SELECT,
    });
  });

  await logActivity({
    userId,
    action: "TRIAL_CREATED",
    entityType: "ROUTE_BOOK",
    entityId: trial.id,
    metadata: { trialNo: trial.trialNo, product: trial.product ?? null },
  });
  return sendSuccess(res, { trial }, "Trial recorded", 201);
}

export async function update(req: Request, res: Response) {
  const id = paramId(req, "id");
  const body = req.body as TrialFields;
  const existing = await prisma.trialReport.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError(404, "TRIAL_NOT_FOUND", "Trial not found");

  /* Editing a trial means the workbook on the laptop is now behind, so the
   * sync is asked to write it again. */
  const trial = await prisma.trialReport.update({
    where: { id },
    data: { ...body, imageDriveUrl: body.imageDriveUrl || null, syncedAt: null },
    select: SELECT,
  });
  await logActivity({
    userId: req.currentUser?.id,
    action: "TRIAL_UPDATED",
    entityType: "ROUTE_BOOK",
    entityId: id,
    metadata: { trialNo: trial.trialNo },
  });
  return sendSuccess(res, { trial }, "Trial updated");
}

/** The laptop calls this once the workbook exists in the folder. */
export async function markSynced(req: Request, res: Response) {
  const id = paramId(req, "id");
  const { fileName } = req.body as { fileName: string };
  const trial = await prisma.trialReport.update({
    where: { id },
    data: { fileName, syncedAt: new Date() },
    select: SELECT,
  });
  return sendSuccess(res, { trial }, "Trial marked as written out");
}

/** Numbers are never reused: deleting trial 34 leaves the next one at 35, so a
 *  workbook already sent to a customer can never be re-issued to someone else. */
export async function remove(req: Request, res: Response) {
  const id = paramId(req, "id");
  const trial = await prisma.trialReport.findUnique({ where: { id }, select: { trialNo: true } });
  if (!trial) throw new AppError(404, "TRIAL_NOT_FOUND", "Trial not found");
  /* The next number is the highest one still standing + 1, so deleting the
   * newest trial would hand its number straight back out. Raising the floor to
   * the deleted number first is what actually keeps the promise above. */
  await prisma.$transaction(async (tx) => {
    const now = await tx.trialBookState.findUnique({ where: { id: "singleton" } });
    await tx.trialBookState.upsert({
      where: { id: "singleton" },
      update: { folderHighest: Math.max(now?.folderHighest ?? 0, trial.trialNo) },
      create: { id: "singleton", folderHighest: trial.trialNo },
    });
    await tx.trialReport.delete({ where: { id } });
  });
  await logActivity({
    userId: req.currentUser?.id,
    action: "TRIAL_DELETED",
    entityType: "ROUTE_BOOK",
    entityId: id,
    metadata: { trialNo: trial.trialNo },
  });
  return sendSuccess(res, null, "Trial removed");
}
