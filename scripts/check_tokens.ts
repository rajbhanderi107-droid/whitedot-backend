import { prisma } from "../src/config/prisma.js";

async function main() {
  const tokens = await prisma.passwordResetToken.findMany({
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 5,
  });
  console.log("Latest reset tokens in database:", JSON.stringify(tokens, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
