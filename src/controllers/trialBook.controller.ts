import type { Request, Response } from "express";
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
  const last = rows.length ? rows[rows.length - 1].trialNo : 0;
  return sendSuccess(res, { trials: rows, nextTrialNo: last + 1 });
}

export async function getOne(req: Request, res: Response) {
  const id = paramId(req, "id");
  const trial = await prisma.trialReport.findUnique({ where: { id }, select: SELECT });
  if (!trial) throw new AppError(404, "TRIAL_NOT_FOUND", "Trial not found");
  return sendSuccess(res, { trial });
}

/** The next free number, so the form can show it before anything is saved. */
export async function nextNumber(_req: Request, res: Response) {
  const top = await prisma.trialReport.findFirst({ orderBy: { trialNo: "desc" }, select: { trialNo: true } });
  return sendSuccess(res, { nextTrialNo: (top?.trialNo ?? 0) + 1 });
}

export async function create(req: Request, res: Response) {
  const body = req.body as TrialFields;
  const userId = req.currentUser?.id;

  /* Take the number and the row in one transaction. Two people saving at the
   * same instant would otherwise both read the same "last" number. */
  const trial = await prisma.$transaction(async (tx) => {
    const top = await tx.trialReport.findFirst({ orderBy: { trialNo: "desc" }, select: { trialNo: true } });
    return tx.trialReport.create({
      data: {
        ...body,
        imageDriveUrl: body.imageDriveUrl || null,
        trialNo: (top?.trialNo ?? 0) + 1,
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
  await prisma.trialReport.delete({ where: { id } });
  await logActivity({
    userId: req.currentUser?.id,
    action: "TRIAL_DELETED",
    entityType: "ROUTE_BOOK",
    entityId: id,
    metadata: { trialNo: trial.trialNo },
  });
  return sendSuccess(res, null, "Trial removed");
}
