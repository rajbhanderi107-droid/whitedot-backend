/* Look at, and correct, the Customer Book from inside the container.
 *
 *   node dist/cli/customer-book.js list
 *   node dist/cli/customer-book.js remove <stopId>
 *   node dist/cli/customer-book.js remove --trial       (the one you added)
 *
 * Same effect as the portal's "Not a customer" button, but server-side, so a
 * correction does not need anyone's password. It deletes the company's orders
 * — they are the whole reason it is in this book — and puts it back in the
 * Lead Book. The visit, the notes and the day record are untouched.
 *
 * `list` writes nothing and is the default, because the destructive half
 * should never be what happens when someone runs this to have a look.
 *
 * A note on the pipeline card: the CRM mirror never walks a status backwards
 * (see routeBookCrm.service.ts), so a card already at WON stays at WON. That
 * is exactly what the button in the portal does too — this tool is a second
 * doorway to the same operation, not a different one — but it means a card
 * left over from a trial has to be moved on the board by hand.
 */

import { prisma } from "../config/prisma.js";
import { mirrorToCrm } from "../services/routeBookCrm.service.js";
import { logActivity } from "../services/activity.service.js";

const STOP_SELECT = { id: true, name: true, legId: true, addr: true, tel: true, makes: true } as const;

async function customers() {
  return prisma.routeBookMark.findMany({
    where: { stage: "CUSTOMER" },
    select: {
      stopId: true, customerOn: true, contactName: true,
      stop: { select: { name: true, userAdded: true, legId: true } },
      orders: { select: { id: true, orderNo: true, quantityMt: true, status: true } },
    },
    orderBy: { customerOn: "asc" },
  });
}

const mt = (rows: { quantityMt: unknown }[]) =>
  rows.reduce((a, o) => a + Number(o.quantityMt ?? 0), 0);

async function list() {
  const rows = await customers();
  if (!rows.length) {
    console.log("The Customer Book is empty.");
    return;
  }
  console.log(`${rows.length} customer${rows.length === 1 ? "" : "s"}:\n`);
  for (const r of rows) {
    const live = r.orders.filter((o) => o.status !== "CANCELLED");
    console.log(
      `  ${r.stop.userAdded ? "[added by hand] " : ""}${r.stop.name}\n` +
      `    stopId    ${r.stopId}\n` +
      `    since     ${r.customerOn ?? "—"}\n` +
      `    orders    ${live.length} (${Number(mt(live).toFixed(3))} MT)\n`,
    );
  }
  const added = rows.filter((r) => r.stop.userAdded);
  if (added.length === 1) {
    console.log(`One customer was added by hand rather than coming from the register: ${added[0].stop.name}.`);
    console.log(`If that is the trial entry, remove it with:  remove ${added[0].stopId}`);
  } else if (added.length > 1) {
    console.log(`${added.length} customers were added by hand — name the one you mean explicitly.`);
  }
}

/** The trial entry, only when there is exactly one candidate. Guessing which
 *  of several real customers to delete is not a thing a script should do. */
async function findTrial(): Promise<string> {
  const added = (await customers()).filter((r) => r.stop.userAdded);
  if (added.length === 0) throw new Error("No hand-added customer to remove. Run `list` and pass the stopId you mean.");
  if (added.length > 1) {
    throw new Error(
      `${added.length} hand-added customers: ${added.map((r) => r.stop.name).join(", ")}. ` +
      "Pass the stopId you mean rather than --trial.",
    );
  }
  return added[0].stopId;
}

async function remove(stopId: string, apply: boolean) {
  const mark = await prisma.routeBookMark.findUnique({
    where: { stopId },
    select: { stopId: true, stage: true, orders: { select: { id: true, quantityMt: true, status: true } },
      stop: { select: { name: true } } },
  });
  if (!mark) throw new Error(`No record for ${stopId}`);
  if (mark.stage !== "CUSTOMER") throw new Error(`${mark.stop.name} is not in the Customer Book (stage ${mark.stage})`);

  const live = mark.orders.filter((o) => o.status !== "CANCELLED");
  console.log(`${mark.stop.name} (${stopId})`);
  console.log(`  ${mark.orders.length} order${mark.orders.length === 1 ? "" : "s"} would be deleted` +
    ` (${Number(mt(live).toFixed(3))} MT live)`);
  console.log("  stage CUSTOMER -> LEAD; the visit, notes and day record are untouched");

  if (!apply) {
    console.log("\nDRY RUN — nothing was written. Pass --apply to make the change.");
    return;
  }

  const actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true },
  });
  if (!actor) throw new Error("No SUPER_ADMIN to attribute the change to");

  await prisma.$transaction(async (tx) => {
    await tx.routeBookOrder.deleteMany({ where: { stopId } });
    const updated = await tx.routeBookMark.update({
      where: { stopId },
      data: { stage: "LEAD", customerOn: null, updatedById: actor.id },
    });
    const stop = await tx.routeBookStop.findUnique({ where: { id: stopId }, select: STOP_SELECT });
    if (stop) await mirrorToCrm(tx, stop, updated);
  });

  await logActivity({
    userId: actor.id, action: "ROUTE_BOOK_UNMAKE_CUSTOMER", entityType: "ROUTE_BOOK",
    metadata: { stopId, name: mark.stop.name, ordersDeleted: mark.orders.length },
  });
  console.log(`\nDone. ${mark.stop.name} is back in the Lead Book, attributed to ${actor.name}.`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cmd = args.find((a) => !a.startsWith("--")) ?? "list";

  if (cmd === "list") return list();
  if (cmd === "remove") {
    const rest = args.filter((a) => !a.startsWith("--") && a !== "remove");
    const stopId = args.includes("--trial") ? await findTrial() : rest[0];
    if (!stopId) throw new Error("Usage: customer-book remove <stopId> [--apply]   (or --trial)");
    return remove(stopId, apply);
  }
  throw new Error(`Unknown command "${cmd}". Use: list | remove <stopId> [--apply]`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
