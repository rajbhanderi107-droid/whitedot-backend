/* Bringing a whole book in from somewhere else.
 *
 * The same work whether it arrives over HTTP from the portal's Import button
 * or from the command line inside the container — so it lives here, once,
 * rather than being written twice and drifting.
 *
 * Marks are written directly rather than through applyMark, because the
 * journal arrives with the import and re-deriving it would stamp every line
 * with today's date, destroying the record the import exists to preserve. The
 * CRM mirror still runs, so imported work reaches Companies and the pipeline
 * exactly like work done in the portal. */

import { prisma } from "../config/prisma.js";
import { logActivity } from "../services/activity.service.js";
import { mirrorToCrm } from "./routeBookCrm.service.js";
import type { BookImport } from "../validators/routeBook.validator.js";

/** What the CRM mirror needs to describe a company it has not met before. */
const STOP_SELECT = { id: true, name: true, legId: true, addr: true, tel: true, makes: true } as const;

export interface ImportResult {
  marks: number;
  events: number;
  duplicateEvents: number;
  days: string[];
  skippedStops: string[];
}

/** What an import would touch, worked out without writing anything.
 *
 *  Both the real import and the preview go through this, so what the preview
 *  reports is what the import does — the two cannot drift into disagreeing. */
async function plan(book: BookImport) {
  const known = new Set(
    (await prisma.routeBookStop.findMany({ where: { deletedAt: null }, select: { id: true } })).map((s) => s.id),
  );
  const marks = book.marks.filter((m) => known.has(m.stopId));
  const events = book.events.filter((e) => known.has(e.stopId));
  const skippedStops = [...new Set(
    [...book.marks.map((m) => m.stopId), ...book.events.map((e) => e.stopId)].filter((id) => !known.has(id)),
  )];

  // One line is "the same line" when the stop, day, kind and instant match, so
  // running the same import twice adds nothing.
  const days = [...new Set(events.map((e) => e.day))];
  const existing = new Set(
    (await prisma.routeBookEvent.findMany({
      where: { day: { in: days } },
      select: { stopId: true, day: true, kind: true, at: true },
    })).map((e) => `${e.stopId}|${e.day}|${e.kind}|${e.at.getTime()}`),
  );
  const fresh = events.filter((e) => !existing.has(`${e.stopId}|${e.day}|${e.kind}|${new Date(e.at).getTime()}`));

  return { marks, events, fresh, days: days.sort(), skippedStops };
}

/** Read-only: what `applyImport` would do, for looking before writing. */
export async function previewImport(book: BookImport): Promise<ImportResult> {
  const p = await plan(book);
  return {
    marks: p.marks.length,
    events: p.fresh.length,
    duplicateEvents: p.events.length - p.fresh.length,
    days: p.days,
    skippedStops: p.skippedStops,
  };
}

export async function applyImport(book: BookImport, userId: string): Promise<ImportResult> {
  const { marks, fresh, events, days, skippedStops } = await plan(book);

  let marksWritten = 0;
  for (const { stopId, ...fields } of marks) {
    await prisma.$transaction(async (tx) => {
      const stop = await tx.routeBookStop.findUnique({ where: { id: stopId }, select: STOP_SELECT });
      if (!stop) return;
      const mark = await tx.routeBookMark.upsert({
        where: { stopId },
        update: { ...fields, updatedById: userId },
        create: { stopId, ...fields, updatedById: userId },
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

  for (let i = 0; i < fresh.length; i += 500) {
    await prisma.routeBookEvent.createMany({
      data: fresh.slice(i, i + 500).map((e) => ({
        stopId: e.stopId, kind: e.kind, value: e.value ?? null, day: e.day, at: new Date(e.at), userId,
      })),
    });
  }

  const result: ImportResult = {
    marks: marksWritten,
    events: fresh.length,
    duplicateEvents: events.length - fresh.length,
    days,
    skippedStops,
  };
  await logActivity({ userId, action: "ROUTE_BOOK_IMPORT", entityType: "ROUTE_BOOK", metadata: { ...result } });
  return result;
}
