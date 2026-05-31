import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Find the super admin
  const superAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true, isActive: true, role: true },
  });

  if (!superAdmin) {
    console.log("No SUPER_ADMIN user found.");
    return;
  }

  console.log("Found:", superAdmin.email, "| isActive:", superAdmin.isActive);

  const newHash = await bcrypt.hash("Admin@WhiteDot2026!", 12);

  await prisma.user.update({
    where: { id: superAdmin.id },
    data: {
      isActive: true,
      password: newHash,
    },
  });

  console.log("✓ Super admin re-activated and password reset to: Admin@WhiteDot2026!");
  console.log("  Change this password immediately after logging in.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
