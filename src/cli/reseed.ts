/* Refresh the Route Book register from prisma/data/route-book.json.
 *
 *   node dist/cli/reseed.js
 *
 * Same code path as the portal command "Refresh register data (admin)":
 * families, legs and stops are upserted; ticks, notes, visits and orders
 * are not touched. Needed after a register file grows (new plants) because
 * bootstrap only seeds an empty database.
 */

import { prisma } from "../config/prisma.js";
import { applySeed } from "../controllers/routeBook.controller.js";

async function main() {
  const before = await prisma.routeBookStop.count({ where: { deletedAt: null } });
  console.log(`Register currently holds ${before} companies`);
  const result = await applySeed("upsert");
  const after = await prisma.routeBookStop.count({ where: { deletedAt: null } });
  console.log(JSON.stringify(result));
  console.log(
    `Register now holds ${after} companies (${after - before >= 0 ? "+" : ""}${after - before}). ` +
    `${result.fams} families, ${result.legs} legs, seed version ${result.version}. Marks untouched.`,
  );
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
