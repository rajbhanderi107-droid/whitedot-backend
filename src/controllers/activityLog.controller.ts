import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendPaginated, sendSuccess } from "../utils/apiResponse.js";
import { paginationSchema } from "../validators/admin.validator.js";
import { paramId } from "../utils/params.js";

export async function listActivityLogs(req: Request, res: Response) {
  const { page, limit } = paginationSchema.parse(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.activityLog.findMany({
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.activityLog.count(),
  ]);

  return sendPaginated(res, data, total, page, limit);
}

export async function deleteActivityLog(req: Request, res: Response) {
  const id = paramId(req);
  await prisma.activityLog.delete({
    where: { id },
  });
  return sendSuccess(res, null, "Activity log entry deleted");
}

export async function deleteAllActivityLogs(req: Request, res: Response) {
  await prisma.activityLog.deleteMany({});
  return sendSuccess(res, null, "All activity log entries deleted");
}
