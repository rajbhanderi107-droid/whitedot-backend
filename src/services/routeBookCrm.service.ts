/* ─── Route Book → CRM mirror ──────────────────────────────────────────────
 *
 * The books and the CRM pipeline have to be the same companies, not two lists
 * that someone reconciles by hand. So every stop that has actually been worked
 * — ticked, starred, or moved past PROSPECT — gets a Company row, and every one
 * in a live deal also gets an Inquiry, which is what the pipeline board draws.
 *
 * The mirror only ever moves a card forward. If someone dragged a card to
 * PROPOSAL_SENT on the board, a routine tick out on the road must not drag it
 * back to CONTACTED. WON and LOST are the two exceptions: those are decisions,
 * so they always win.
 */

import type { Prisma, RouteBookMark, InquiryStatus, Priority } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** How far along the board a status sits. WON and LOST share the end. */
const RANK: Record<InquiryStatus, number> = {
  NEW: 0, CONTACTED: 1, QUALIFIED: 2, PROPOSAL_SENT: 3, WON: 4, LOST: 4, ARCHIVED: 5,
};
const TERMINAL: InquiryStatus[] = ["WON", "LOST"];

const INDUSTRY = "Plastics processing";
const SOURCE = "LIMEX Route Book";

type StopLite = {
  id: string; name: string; legId: string;
  addr: string | null; tel: string | null; makes: string | null;
};

/** What the pipeline should say about this company, read off the book. */
function desiredStatus(m: RouteBookMark): InquiryStatus | null {
  if (m.stage === "CUSTOMER") return "WON";
  if (m.stage === "LOST" || m.dnc) return "LOST";
  if (m.stage === "LEAD") return m.quotedRate != null ? "PROPOSAL_SENT" : "QUALIFIED";
  if (m.outcome === "smp") return "QUALIFIED";
  if (m.ticked || m.starred) return "CONTACTED";
  return null;
}

/** Bigger tonnage is worth chasing harder — nothing else here is a judgement. */
function priorityFor(m: RouteBookMark): Priority {
  const t = Number(m.expectedMt ?? m.monthlyTonnes ?? 0);
  if (m.starred || t >= 50) return "HIGH";
  if (t >= 10) return "MEDIUM";
  return "LOW";
}

function contactOf(m: RouteBookMark, stop: StopLite) {
  return {
    person: m.contactName?.trim() || null,
    phone: m.contactPhone?.trim() || stop.tel?.trim() || null,
    address: m.addrOverride?.trim() || stop.addr?.trim() || null,
  };
}

/**
 * Bring the CRM in line with one stop's mark. Safe to call on every change:
 * it creates what is missing, refreshes contact details, and never regresses a
 * status a human moved. Returns the ids so the mark can hold on to them.
 */
export async function mirrorToCrm(
  tx: Tx,
  stop: StopLite,
  mark: RouteBookMark,
): Promise<{ companyId: string | null; inquiryId: string | null }> {
  const status = desiredStatus(mark);
  // Nothing has happened here yet — an untouched prospect is not CRM clutter.
  if (!status) return { companyId: mark.companyId, inquiryId: mark.inquiryId };

  const c = contactOf(mark, stop);
  const companyStatus = mark.stage === "CUSTOMER" ? "ACTIVE_CLIENT" : mark.stage === "LOST" || mark.dnc ? "INACTIVE" : "LEAD";

  // ── Company ────────────────────────────────────────────────────────────
  let companyId = mark.companyId;
  if (companyId) {
    const exists = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
    if (!exists) companyId = null;
    else {
      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(c.person && { contactPerson: c.person }),
          ...(c.phone && { phone: c.phone }),
          ...(c.address && { address: c.address }),
          ...(mark.gstNumber && { gstNumber: mark.gstNumber }),
          // Only promote a client, never demote one that someone set by hand.
          ...(companyStatus === "ACTIVE_CLIENT" && exists.status !== "ACTIVE_CLIENT" && { status: "ACTIVE_CLIENT" as const }),
        },
      });
    }
  }
  if (!companyId) {
    const created = await tx.company.create({
      data: {
        companyName: stop.name,
        industry: INDUSTRY,
        contactPerson: c.person,
        phone: c.phone,
        address: c.address,
        gstNumber: mark.gstNumber,
        status: companyStatus,
        notes: [`Added from the ${SOURCE} (leg ${stop.legId}).`, stop.makes && `Makes: ${stop.makes}`]
          .filter(Boolean).join(" "),
      },
      select: { id: true },
    });
    companyId = created.id;
  }

  // ── Inquiry (the pipeline card) ────────────────────────────────────────
  let inquiryId = mark.inquiryId;
  const shared = {
    name: c.person || stop.name,
    phone: c.phone,
    companyName: stop.name,
    industry: INDUSTRY,
    inquiryType: "LIMEX supply",
    sourcePage: SOURCE,
    priority: priorityFor(mark),
    companyId,
    followUpDate: mark.dueOn ? new Date(`${mark.dueOn}T00:00:00.000Z`) : null,
    internalNotes: [mark.note?.trim(), mark.nextStep?.trim() && `Next: ${mark.nextStep.trim()}`]
      .filter(Boolean).join(" · ") || null,
  };

  if (inquiryId) {
    const existing = await tx.inquiry.findUnique({ where: { id: inquiryId }, select: { id: true, status: true } });
    if (!existing) inquiryId = null;
    else {
      const advance = TERMINAL.includes(status) || RANK[status] > RANK[existing.status];
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { ...shared, ...(advance && { status }) },
      });
    }
  }
  if (!inquiryId) {
    const created = await tx.inquiry.create({
      // The book records a phone number and a plant, not an email address, and
      // an invented one would be worse than an empty field.
      data: { ...shared, email: "", status, message: mark.note ?? null },
      select: { id: true },
    });
    inquiryId = created.id;
  }

  return { companyId, inquiryId };
}
