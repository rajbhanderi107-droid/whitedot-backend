/* Import a Route Book from a JSON file, from inside the container.
 *
 *   node dist/cli/import-book.js /tmp/book.json     (in the container)
 *   npx tsx src/cli/import-book.ts /tmp/book.json  (locally)
 *
 * It lives at src/cli/ rather than scripts/ for two reasons: .gitignore has a
 * bare `scripts/` rule, which matches that directory at any depth and would
 * silently leave this file uncommitted; and the runtime image carries only
 * compiled dist plus production dependencies, so a script outside src could
 * not run in the one place it is actually needed.
 *
 * Same code path as the portal's Import button — it calls the same service —
 * but it runs server-side, so it needs no portal session. That is the point:
 * a one-off migration should not require anyone's password.
 *
 * The work is attributed to the oldest SUPER_ADMIN, so the journal lines and
 * the activity log name a real person rather than a ghost account. */

import { readFileSync } from "node:fs";
import { prisma } from "../config/prisma.js";
import { importSchema } from "../validators/routeBook.validator.js";
import { applyImport } from "../services/routeBookImport.service.js";
import { ensureSeeded } from "../controllers/routeBook.controller.js";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: tsx scripts/import-book.ts <book.json>");

  const book = importSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  console.log(`Read ${book.marks.length} marks and ${book.events.length} journal lines from ${path}`);

  // The register seeds lazily on the first bootstrap call. A CLI run never
  // makes that call, so without this a fresh server would import nothing and
  // report every stop as "not in this book".
  await ensureSeeded();
  const stops = await prisma.routeBookStop.count({ where: { deletedAt: null } });
  console.log(`Register holds ${stops} companies`);

  const actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (!actor) throw new Error("No SUPER_ADMIN to attribute the import to");
  console.log(`Attributing to ${actor.name} <${actor.email}>`);

  const result = await applyImport(book, actor.id);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `\nImported ${result.marks} companies and ${result.events} journal lines` +
    ` across ${result.days.length} day(s).` +
    (result.duplicateEvents ? ` ${result.duplicateEvents} already present, skipped.` : "") +
    (result.skippedStops.length ? ` ${result.skippedStops.length} stop(s) are not in this book.` : ""),
  );
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
